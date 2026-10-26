'use strict';
const path = require('node:path');
const express = require('express');
const dbm = require('./db');
const auth = require('./auth');
const fmt = require('./format');
const mail = require('./mailer');

const { ORDER_STATUS, NOTIF_STATUS } = dbm;
const MAX_LITERS = 1000000;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
  && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

// Convierte 'AAAA-MM-DDTHH:MM' (hora local operativa) a ISO UTC.
function localToIso(local) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(local || ''));
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: fmt.TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const asLocal = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  const d = new Date(guess - (asLocal - guess));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Fecha calendario local (AAAA-MM-DD) de un instante ISO.
function localDate(iso) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: fmt.TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function createApp({ db, mailer, secureCookies = false }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '100kb' }));
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'same-origin');
    res.set('Content-Security-Policy', "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; frame-ancestors 'none'");
    next();
  });
  app.use(auth.sessionMiddleware(db));

  const wrap = (fn) => (req, res, next) => { try { const r = fn(req, res, next); if (r && r.catch) r.catch(next); } catch (e) { next(e); } };
  const api = express.Router();

  // ---------- Autenticación ----------
  const failures = new Map();
  api.post('/login', wrap((req, res) => {
    const { username, password } = req.body || {};
    const key = `${req.ip}|${String(username).toLowerCase()}`;
    const f = failures.get(key);
    if (f && f.count >= 5 && Date.now() - f.at < 15 * 60e3) throw new HttpError(429, 'Demasiados intentos fallidos. Espere 15 minutos.');
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || ''));
    if (!u || !u.active || !auth.verifyPassword(String(password || ''), u.password_hash)) {
      failures.set(key, { count: (f && Date.now() - f.at < 15 * 60e3 ? f.count : 0) + 1, at: Date.now() });
      throw new HttpError(401, 'Usuario o contraseña incorrectos.');
    }
    failures.delete(key);
    const s = auth.createSession(db, u.id);
    res.set('Set-Cookie', auth.cookieHeader(s.token, secureCookies, auth.SESSION_HOURS * 3600));
    dbm.audit(db, u, 'inicio_sesion', 'usuario', u.id);
    res.json({ user: publicUser(u), csrf: s.csrf });
  }));

  api.get('/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Sesión no iniciada.' });
    res.json({ user: req.user, csrf: req.session.csrf });
  });

  api.use(auth.requireAuth);

  api.post('/logout', (req, res) => {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.session.tokenHash);
    res.set('Set-Cookie', auth.cookieHeader('', secureCookies, 0));
    res.json({ ok: true });
  });

  api.post('/me/password', wrap((req, res) => {
    const { current, next: pw } = req.body || {};
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!auth.verifyPassword(String(current || ''), u.password_hash)) throw new HttpError(400, 'La contraseña actual no es correcta.');
    const err = auth.validatePassword(pw);
    if (err) throw new HttpError(400, err);
    db.prepare("UPDATE users SET password_hash = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(auth.hashPassword(pw), u.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(u.id, req.session.tokenHash);
    dbm.audit(db, req.user, 'cambio_contraseña', 'usuario', u.id);
    res.json({ ok: true });
  }));

  // ---------- Metadatos ----------
  api.get('/meta', (req, res) => {
    const s = dbm.getSettings(db);
    res.json({
      unit: s.unidad_operativa,
      orderStatus: ORDER_STATUS,
      notifStatus: NOTIF_STATUS,
      today: fmt.today(),
      tz: fmt.TZ,
      mail: { ...mailer.status(), to: s.mail_to, cc: s.mail_cc },
    });
  });

  // ---------- PAD ----------
  api.get('/pads', (req, res) => {
    const all = req.query.all === '1' && req.user.role === 'administrador';
    const rows = db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM orders o WHERE o.pad_id = p.id) AS orders_count
      FROM pads p ${all ? '' : 'WHERE p.active = 1'} ORDER BY p.code COLLATE NOCASE`).all();
    res.json(rows);
  });

  function padInput(b) {
    const code = String(b.code || '').trim();
    if (!code) throw new HttpError(400, 'El nombre o código del PAD es obligatorio.');
    if (code.length > 80) throw new HttpError(400, 'El código del PAD no puede superar 80 caracteres.');
    return { code, wells: String(b.wells || '').trim().slice(0, 500), area: String(b.area || '').trim().slice(0, 120), active: b.active === false ? 0 : 1 };
  }

  api.post('/pads', auth.requireAdmin, wrap((req, res) => {
    const p = padInput(req.body || {});
    if (db.prepare('SELECT 1 FROM pads WHERE code = ?').get(p.code)) throw new HttpError(409, 'Ya existe un PAD con ese código.');
    const r = db.prepare('INSERT INTO pads (code, wells, area, active) VALUES (?,?,?,?)').run(p.code, p.wells, p.area, p.active);
    dbm.audit(db, req.user, 'alta_pad', 'pad', Number(r.lastInsertRowid), p);
    res.status(201).json(db.prepare('SELECT * FROM pads WHERE id = ?').get(r.lastInsertRowid));
  }));

  api.put('/pads/:id', auth.requireAdmin, wrap((req, res) => {
    const prev = db.prepare('SELECT * FROM pads WHERE id = ?').get(Number(req.params.id));
    if (!prev) throw new HttpError(404, 'PAD inexistente.');
    const p = padInput({ ...prev, ...req.body, active: req.body.active === undefined ? !!prev.active : req.body.active });
    const dup = db.prepare('SELECT id FROM pads WHERE code = ? AND id <> ?').get(p.code, prev.id);
    if (dup) throw new HttpError(409, 'Ya existe otro PAD con ese código.');
    db.prepare("UPDATE pads SET code=?, wells=?, area=?, active=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?")
      .run(p.code, p.wells, p.area, p.active, prev.id);
    const action = prev.active !== p.active ? (p.active ? 'activacion_pad' : 'desactivacion_pad') : 'modificacion_pad';
    dbm.audit(db, req.user, action, 'pad', prev.id, { antes: { code: prev.code, wells: prev.wells, area: prev.area, active: prev.active }, despues: p });
    res.json(db.prepare('SELECT * FROM pads WHERE id = ?').get(prev.id));
  }));

  // ---------- Pedidos ----------
  const getOrder = (id) => db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(id));
  const canTouch = (user, o) => user.role === 'administrador' || o.requester_id === user.id;

  function validateOrder(b, user, { requestIso, keepPad = false }) {
    const pad = db.prepare('SELECT * FROM pads WHERE id = ?').get(Number(b.pad_id));
    if (!pad) throw new HttpError(400, 'Seleccione un PAD / locación válido.');
    if (!pad.active && !keepPad) throw new HttpError(400, `El PAD ${pad.code} está inactivo y no admite nuevos pedidos.`);
    const raw = typeof b.liters === 'string' ? b.liters.replace(/\./g, '').replace(',', '.') : b.liters;
    const liters = Number(raw);
    if (raw === '' || raw == null || !Number.isFinite(liters)) throw new HttpError(400, 'Ingrese la cantidad de combustible en litros.');
    if (liters <= 0) throw new HttpError(400, 'La cantidad de litros debe ser mayor que cero.');
    if (!Number.isInteger(liters)) throw new HttpError(400, 'La cantidad debe expresarse en litros enteros.');
    if (liters > MAX_LITERS) throw new HttpError(400, `La cantidad no puede superar ${fmt.liters(MAX_LITERS)}.`);
    if (!isDate(b.required_date)) throw new HttpError(400, 'Ingrese una fecha requerida de entrega válida.');
    if (b.required_date < localDate(requestIso)) throw new HttpError(400, 'La fecha requerida de entrega no puede ser anterior a la fecha de solicitud.');
    const observations = String(b.observations || '').trim();
    if (observations.length > 2000) throw new HttpError(400, 'Las observaciones no pueden superar 2.000 caracteres.');
    return { pad, liters, required_date: b.required_date, observations };
  }

  function resolveRequestDate(b, user, fallbackIso) {
    if (b.request_date == null || b.request_date === '') return fallbackIso;
    if (user.role !== 'administrador') throw new HttpError(403, 'Solo un administrador puede modificar la fecha de solicitud.');
    const iso = localToIso(b.request_date);
    if (!iso) throw new HttpError(400, 'Fecha de solicitud inválida.');
    if (Date.parse(iso) > Date.now() + 5 * 60e3) throw new HttpError(400, 'La fecha de solicitud no puede ser futura.');
    return iso;
  }

  const sending = new Set();
  async function notify(order, user, action) {
    if (sending.has(order.id)) throw new HttpError(409, 'Ya hay un envío en curso para este pedido.');
    sending.add(order.id);
    try {
      const s = dbm.getSettings(db);
      const to = mail.splitAddresses(s.mail_to);
      const cc = mail.splitAddresses(s.mail_cc);
      const subject = mail.buildSubject(order);
      let ok = false; let messageId = null; let error = null;
      if (!to.length) {
        error = 'No hay destinatario configurado para las notificaciones.';
      } else {
        try {
          const r = await mailer.send({ to, cc, subject, html: mail.buildHtml(order), text: mail.buildText(order) });
          ok = true; messageId = r && r.messageId;
        } catch (e) {
          error = String(e && e.message || e).slice(0, 1000);
        }
      }
      return dbm.tx(db, () => {
        db.prepare('INSERT INTO notifications (order_id, recipients, subject, success, message_id, error, triggered_by, triggered_by_name) VALUES (?,?,?,?,?,?,?,?)')
          .run(order.id, [...to, ...cc.map((c) => `cc:${c}`)].join(', '), subject, ok ? 1 : 0, messageId, error, user.id, user.full_name);
        const cur = getOrder(order.id);
        const newStatus = ok && cur.status === 'Solicitado' ? 'Enviado a transportista' : cur.status;
        db.prepare("UPDATE orders SET notification_status = ?, status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
          .run(ok ? 'Enviado correctamente' : 'Error de envío', newStatus, order.id);
        dbm.audit(db, user, action, 'pedido', order.id, { resultado: ok ? 'enviado' : 'error', destinatarios: to, cc, error, messageId });
        if (newStatus !== cur.status) dbm.audit(db, user, 'cambio_estado', 'pedido', order.id, { de: cur.status, a: newStatus, motivo: 'Notificación enviada a transportista' });
        return { ok, error };
      });
    } finally {
      sending.delete(order.id);
    }
  }

  api.post('/orders', wrap(async (req, res) => {
    const b = req.body || {};
    const key = b.idempotency_key ? String(b.idempotency_key).slice(0, 80) : null;
    if (key) {
      const existing = db.prepare('SELECT * FROM orders WHERE idempotency_key = ?').get(key);
      if (existing) return res.json({ order: existing, duplicate: true, email: null });
    }
    const now = new Date().toISOString();
    const requestIso = resolveRequestDate(b, req.user, now);
    const v = validateOrder(b, req.user, { requestIso });
    const draft = b.draft === true;
    const s = dbm.getSettings(db);
    const id = dbm.tx(db, () => {
      const number = dbm.nextOrderNumber(db, Number(localDate(requestIso).slice(0, 4)));
      const r = db.prepare(`INSERT INTO orders (order_number, unit, pad_id, pad_code, pad_wells, pad_area, liters, request_date, required_date,
          observations, requester_id, requester_name, status, notification_status, idempotency_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(number, s.unidad_operativa, v.pad.id, v.pad.code, v.pad.wells, v.pad.area, v.liters, requestIso, v.required_date,
          v.observations, req.user.id, req.user.full_name, draft ? 'Borrador' : 'Solicitado', 'Pendiente de envío', key);
      const oid = Number(r.lastInsertRowid);
      dbm.audit(db, req.user, draft ? 'creacion_borrador' : 'creacion', 'pedido', oid, {
        numero: number, pad: v.pad.code, litros: v.liters, fecha_requerida: v.required_date, fecha_solicitud: requestIso,
      });
      return oid;
    });
    let email = null;
    if (!draft) email = await notify(getOrder(id), req.user, 'envio_notificacion');
    res.status(201).json({ order: getOrder(id), email });
  }));

  function listFilters(q) {
    const where = []; const args = [];
    if (q.q) { where.push('(order_number LIKE ? OR pad_code LIKE ?)'); args.push(`%${q.q}%`, `%${q.q}%`); }
    if (q.from && isDate(q.from)) { where.push('request_date >= ?'); args.push(localToIso(`${q.from}T00:00`)); }
    if (q.to && isDate(q.to)) { where.push('request_date < ?'); args.push(new Date(Date.parse(localToIso(`${q.to}T00:00`)) + 864e5).toISOString()); }
    if (q.status && ORDER_STATUS.includes(q.status)) { where.push('status = ?'); args.push(q.status); }
    if (q.notif && NOTIF_STATUS.includes(q.notif)) { where.push('notification_status = ?'); args.push(q.notif); }
    if (q.requester) { where.push('requester_id = ?'); args.push(Number(q.requester)); }
    if (q.pad) { where.push('pad_id = ?'); args.push(Number(q.pad)); }
    const cols = { fecha: 'request_date', entrega: 'required_date', cantidad: 'liters', pad: 'pad_code COLLATE NOCASE', numero: 'order_number' };
    const sort = cols[q.sort] || 'request_date';
    const dir = q.dir === 'asc' ? 'ASC' : 'DESC';
    return { sql: `SELECT * FROM orders ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${sort} ${dir}, id ${dir}`, args };
  }

  api.get('/orders', (req, res) => {
    const { sql, args } = listFilters(req.query);
    res.json(db.prepare(sql).all(...args));
  });

  api.get('/orders/export.csv', (req, res) => {
    const { sql, args } = listFilters(req.query);
    const rows = db.prepare(sql).all(...args);
    const head = ['Número de pedido', 'Fecha de solicitud', 'Fecha requerida de entrega', 'Unidad operativa', 'PAD / Locación', 'Área / Yacimiento',
      'Pozos', 'Litros solicitados', 'Solicitante', 'Estado del pedido', 'Estado de notificación', 'Observaciones', 'Motivo de cancelación'];
    const cell = (v) => {
      let s = String(v ?? '');
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // evita inyección de fórmulas en Excel
      return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [head.map(cell).join(';')];
    for (const o of rows) {
      lines.push([o.order_number, fmt.dateTime(o.request_date), fmt.date(o.required_date), o.unit, o.pad_code, o.pad_area, o.pad_wells,
        o.liters, o.requester_name, o.status, o.notification_status, o.observations, o.cancel_reason].map(cell).join(';'));
    }
    dbm.audit(db, req.user, 'exportacion_historial', 'pedido', null, { filtros: req.query, registros: rows.length });
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="historial_pedidos_combustible_CT_${fmt.today()}.csv"`);
    res.send(`﻿${lines.join('\r\n')}\r\n`);
  });

  api.get('/orders/:id', (req, res) => {
    const o = getOrder(req.params.id);
    if (!o) return res.status(404).json({ error: 'Pedido inexistente.' });
    res.json({
      order: o,
      notifications: db.prepare('SELECT * FROM notifications WHERE order_id = ? ORDER BY id DESC').all(o.id),
      events: db.prepare("SELECT * FROM audit_log WHERE entity = 'pedido' AND entity_id = ? ORDER BY id DESC").all(o.id),
      permissions: permissionsFor(req.user, o),
    });
  });

  function permissionsFor(user, o) {
    const admin = user.role === 'administrador';
    const mine = canTouch(user, o);
    return {
      edit: (o.status === 'Borrador' && mine) || (o.status === 'Solicitado' && mine) || (o.status === 'Enviado a transportista' && admin),
      submit: o.status === 'Borrador' && mine,
      cancel: (['Borrador', 'Solicitado'].includes(o.status) && mine) || (o.status === 'Enviado a transportista' && admin),
      deliver: ['Solicitado', 'Enviado a transportista'].includes(o.status) && mine,
      markSent: o.status === 'Solicitado' && admin,
      resend: !['Borrador', 'Cancelado'].includes(o.status),
      editRequestDate: admin,
    };
  }

  api.put('/orders/:id', wrap((req, res) => {
    const o = getOrder(req.params.id);
    if (!o) throw new HttpError(404, 'Pedido inexistente.');
    if (!permissionsFor(req.user, o).edit) throw new HttpError(403, `No tiene permisos para modificar un pedido en estado "${o.status}".`);
    const b = req.body || {};
    const requestIso = resolveRequestDate(b, req.user, o.request_date);
    // Si el PAD del pedido fue desactivado después, se permite conservarlo al editar.
    const v = Number(b.pad_id) === o.pad_id
      ? validateOrder(b, req.user, { requestIso, keepPad: true }) : validateOrder(b, req.user, { requestIso });
    const changes = {};
    if (v.pad.id !== o.pad_id) changes.pad = [o.pad_code, v.pad.code];
    if (v.liters !== o.liters) changes.litros = [o.liters, v.liters];
    if (v.required_date !== o.required_date) changes.fecha_requerida = [o.required_date, v.required_date];
    if (v.observations !== o.observations) changes.observaciones = [o.observations, v.observations];
    if (requestIso !== o.request_date) changes.fecha_solicitud = [o.request_date, requestIso];
    if (!Object.keys(changes).length) return res.json({ order: o, changed: false });
    const pad = changes.pad ? v.pad : { code: o.pad_code, wells: o.pad_wells, area: o.pad_area, id: o.pad_id };
    // Un pedido ya notificado y modificado queda pendiente de reenvío con los datos actualizados.
    const notif = o.status === 'Borrador' ? o.notification_status
      : (o.notification_status === 'Enviado correctamente' ? 'Pendiente de envío' : o.notification_status);
    dbm.tx(db, () => {
      db.prepare(`UPDATE orders SET pad_id=?, pad_code=?, pad_wells=?, pad_area=?, liters=?, required_date=?, observations=?, request_date=?,
        notification_status=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`)
        .run(pad.id, pad.code, pad.wells, pad.area, v.liters, v.required_date, v.observations, requestIso, notif, o.id);
      dbm.audit(db, req.user, 'modificacion', 'pedido', o.id, changes);
    });
    res.json({ order: getOrder(o.id), changed: true });
  }));

  api.post('/orders/:id/submit', wrap(async (req, res) => {
    const o = getOrder(req.params.id);
    if (!o) throw new HttpError(404, 'Pedido inexistente.');
    if (!permissionsFor(req.user, o).submit) throw new HttpError(403, 'Solo se pueden enviar borradores propios.');
    const pad = db.prepare('SELECT * FROM pads WHERE id = ?').get(o.pad_id);
    if (!pad || !pad.active) throw new HttpError(400, 'El PAD del borrador está inactivo. Edite el pedido y seleccione un PAD activo.');
    if (o.required_date < fmt.today()) throw new HttpError(400, 'La fecha requerida de entrega ya pasó. Edite el borrador antes de enviarlo.');
    dbm.tx(db, () => {
      db.prepare("UPDATE orders SET status='Solicitado', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='Borrador'").run(o.id);
      dbm.audit(db, req.user, 'cambio_estado', 'pedido', o.id, { de: 'Borrador', a: 'Solicitado' });
    });
    const email = await notify(getOrder(o.id), req.user, 'envio_notificacion');
    res.json({ order: getOrder(o.id), email });
  }));

  api.post('/orders/:id/resend', wrap(async (req, res) => {
    const o = getOrder(req.params.id);
    if (!o) throw new HttpError(404, 'Pedido inexistente.');
    if (!permissionsFor(req.user, o).resend) throw new HttpError(400, `No se puede reenviar la notificación de un pedido en estado "${o.status}".`);
    const email = await notify(o, req.user, o.notification_status === 'Enviado correctamente' ? 'reenvio_notificacion' : 'reintento_notificacion');
    res.json({ order: getOrder(o.id), email });
  }));

  api.post('/orders/:id/status', wrap((req, res) => {
    const o = getOrder(req.params.id);
    if (!o) throw new HttpError(404, 'Pedido inexistente.');
    const to = String((req.body || {}).status || '');
    const reason = String((req.body || {}).reason || '').trim().slice(0, 500);
    const p = permissionsFor(req.user, o);
    const allowed = { Cancelado: p.cancel, Entregado: p.deliver, 'Enviado a transportista': p.markSent }[to];
    if (!allowed) throw new HttpError(403, `No se permite pasar de "${o.status}" a "${to}" con su perfil.`);
    if (to === 'Cancelado' && !reason) throw new HttpError(400, 'Indique el motivo de la cancelación.');
    dbm.tx(db, () => {
      db.prepare(`UPDATE orders SET status=?, cancel_reason=CASE WHEN ?='Cancelado' THEN ? ELSE cancel_reason END,
        updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).run(to, to, reason, o.id);
      dbm.audit(db, req.user, to === 'Cancelado' ? 'cancelacion' : 'cambio_estado', 'pedido', o.id, { de: o.status, a: to, motivo: reason || undefined });
    });
    res.json({ order: getOrder(o.id) });
  }));

  api.get('/requesters', (req, res) => {
    res.json(db.prepare('SELECT DISTINCT requester_id AS id, requester_name AS name FROM orders ORDER BY requester_name').all());
  });

  // ---------- Panel ----------
  api.get('/dashboard', (req, res) => {
    const period = req.query.period === 'week' ? 'week' : 'month';
    const kpi = db.prepare(`SELECT
        SUM(status <> 'Borrador') AS total,
        COALESCE(SUM(CASE WHEN status NOT IN ('Borrador','Cancelado') THEN liters END), 0) AS liters,
        SUM(status IN ('Solicitado','Enviado a transportista')) AS pending,
        SUM(status <> 'Borrador' AND notification_status = 'Enviado correctamente') AS sent_ok,
        SUM(status NOT IN ('Borrador','Cancelado') AND notification_status = 'Error de envío') AS notif_errors,
        SUM(status = 'Borrador') AS drafts,
        SUM(status = 'Entregado') AS delivered
      FROM orders`).get();
    const byPad = db.prepare(`SELECT pad_code AS pad, SUM(liters) AS liters, COUNT(*) AS orders FROM orders
      WHERE status NOT IN ('Borrador','Cancelado') GROUP BY pad_code ORDER BY liters DESC`).all();
    const rows = db.prepare("SELECT request_date, liters FROM orders WHERE status NOT IN ('Borrador','Cancelado')").all();
    res.json({ kpi: Object.fromEntries(Object.entries(kpi).map(([k, v]) => [k, v || 0])), byPad, trend: trend(rows, period), period,
      recent: db.prepare("SELECT * FROM orders WHERE status <> 'Borrador' ORDER BY request_date DESC, id DESC LIMIT 6").all() });
  });

  function trend(rows, period) {
    const n = 12;
    const today = new Date(`${fmt.today()}T00:00:00Z`);
    const buckets = [];
    if (period === 'month') {
      for (let i = n - 1; i >= 0; i--) {
        const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
        buckets.push({ key: d.toISOString().slice(0, 7), label: `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`, liters: 0, orders: 0 });
      }
    } else {
      const monday = new Date(today); monday.setUTCDate(today.getUTCDate() - ((today.getUTCDay() + 6) % 7));
      for (let i = n - 1; i >= 0; i--) {
        const d = new Date(monday); d.setUTCDate(monday.getUTCDate() - 7 * i);
        const k = d.toISOString().slice(0, 10);
        buckets.push({ key: k, label: fmt.date(k).slice(0, 5), liters: 0, orders: 0 });
      }
    }
    const idx = new Map(buckets.map((b) => [b.key, b]));
    for (const r of rows) {
      const ld = localDate(r.request_date);
      let k = ld.slice(0, 7);
      if (period === 'week') {
        const d = new Date(`${ld}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
        k = d.toISOString().slice(0, 10);
      }
      const b = idx.get(k);
      if (b) { b.liters += r.liters; b.orders += 1; }
    }
    return buckets;
  }

  // ---------- Usuarios (administración) ----------
  function publicUser(u) {
    return { id: u.id, username: u.username, full_name: u.full_name, email: u.email, role: u.role, active: !!u.active, created_at: u.created_at };
  }

  api.get('/users', auth.requireAdmin, (req, res) => {
    res.json(db.prepare('SELECT * FROM users ORDER BY full_name').all().map(publicUser));
  });

  function userInput(b, creating) {
    const out = {};
    if (creating || b.username !== undefined) {
      out.username = String(b.username || '').trim();
      if (!/^[A-Za-z0-9._@-]{3,60}$/.test(out.username)) throw new HttpError(400, 'Usuario inválido (3 a 60 caracteres: letras, números, . _ @ -).');
    }
    if (creating || b.full_name !== undefined) {
      out.full_name = String(b.full_name || '').trim();
      if (!out.full_name) throw new HttpError(400, 'El nombre completo es obligatorio.');
    }
    if (b.email !== undefined) out.email = String(b.email || '').trim();
    if (creating || b.role !== undefined) {
      if (!['operador', 'administrador'].includes(b.role)) throw new HttpError(400, 'Perfil inválido.');
      out.role = b.role;
    }
    if (b.active !== undefined) out.active = b.active ? 1 : 0;
    if (creating || b.password) {
      const err = auth.validatePassword(b.password);
      if (err) throw new HttpError(400, err);
      out.password_hash = auth.hashPassword(b.password);
    }
    return out;
  }

  api.post('/users', auth.requireAdmin, wrap((req, res) => {
    const u = userInput(req.body || {}, true);
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(u.username)) throw new HttpError(409, 'Ese nombre de usuario ya existe.');
    const r = db.prepare('INSERT INTO users (username, full_name, email, role, password_hash, active) VALUES (?,?,?,?,?,?)')
      .run(u.username, u.full_name, u.email || '', u.role, u.password_hash, u.active ?? 1);
    dbm.audit(db, req.user, 'alta_usuario', 'usuario', Number(r.lastInsertRowid), { username: u.username, role: u.role });
    res.status(201).json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid)));
  }));

  api.put('/users/:id', auth.requireAdmin, wrap((req, res) => {
    const prev = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
    if (!prev) throw new HttpError(404, 'Usuario inexistente.');
    const u = userInput(req.body || {}, false);
    if (prev.id === req.user.id && (u.active === 0 || (u.role && u.role !== 'administrador'))) {
      throw new HttpError(400, 'No puede desactivar ni quitar el perfil de administrador a su propio usuario.');
    }
    if (u.username && db.prepare('SELECT 1 FROM users WHERE username = ? AND id <> ?').get(u.username, prev.id)) throw new HttpError(409, 'Ese nombre de usuario ya existe.');
    const keys = Object.keys(u);
    if (keys.length) {
      db.prepare(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
        .run(...keys.map((k) => u[k]), prev.id);
      if (u.active === 0 || u.password_hash) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(prev.id);
      const { password_hash: pw, ...logged } = u;
      dbm.audit(db, req.user, 'modificacion_usuario', 'usuario', prev.id, { ...logged, cambio_contraseña: !!pw });
    }
    res.json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(prev.id)));
  }));

  // ---------- Configuración ----------
  const EMAIL_RE = /^[^\s@;,]+@[^\s@;,]+\.[^\s@;,]+$/;
  api.get('/settings', auth.requireAdmin, (req, res) => {
    res.json({ settings: dbm.getSettings(db), mail: mailer.status() });
  });

  api.put('/settings', auth.requireAdmin, wrap((req, res) => {
    const b = req.body || {};
    const to = mail.splitAddresses(b.mail_to);
    const cc = mail.splitAddresses(b.mail_cc);
    if (!to.length) throw new HttpError(400, 'Debe existir al menos un destinatario principal.');
    const bad = [...to, ...cc].filter((a) => !EMAIL_RE.test(a));
    if (bad.length) throw new HttpError(400, `Direcciones inválidas: ${bad.join(', ')}`);
    const prev = dbm.getSettings(db);
    const next = { mail_to: to.join('; '), mail_cc: cc.join('; ') };
    const up = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
    for (const [k, v] of Object.entries(next)) up.run(v, k);
    dbm.audit(db, req.user, 'modificacion_configuracion', 'configuracion', null, { antes: { mail_to: prev.mail_to, mail_cc: prev.mail_cc }, despues: next });
    res.json({ settings: dbm.getSettings(db), mail: mailer.status() });
  }));

  api.post('/settings/test-mail', auth.requireAdmin, wrap(async (req, res) => {
    const s = dbm.getSettings(db);
    const to = mail.splitAddresses(req.body && req.body.to ? req.body.to : s.mail_to);
    if (!to.length || to.some((a) => !EMAIL_RE.test(a))) throw new HttpError(400, 'Destinatario de prueba inválido.');
    try {
      const r = await mailer.send({
        to, subject: '[PRUEBA] Configuración de correo – Pedidos de Combustible CT',
        text: 'Correo de prueba de configuración. No corresponde a un pedido de combustible.',
        html: '<p style="font-family:Arial,sans-serif">Correo de <b>prueba</b> de configuración. No corresponde a un pedido de combustible.</p>',
      });
      dbm.audit(db, req.user, 'prueba_correo', 'configuracion', null, { destinatarios: to, resultado: 'enviado' });
      res.json({ ok: true, messageId: r && r.messageId });
    } catch (e) {
      dbm.audit(db, req.user, 'prueba_correo', 'configuracion', null, { destinatarios: to, resultado: 'error', error: String(e.message) });
      res.json({ ok: false, error: String(e.message) });
    }
  }));

  api.get('/audit', auth.requireAdmin, (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    res.json(db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit));
  });

  api.use((req, res) => res.status(404).json({ error: 'Recurso inexistente.' }));

  app.use('/api', api);
  app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html', maxAge: 0 }));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Solicitud con formato inválido.' });
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor.' });
  });

  return app;
}

module.exports = { createApp, localToIso, localDate };
