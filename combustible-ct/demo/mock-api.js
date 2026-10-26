'use strict';
/* VERSIÓN DE PRUEBA (solo para revisar diseño y flujo).
   Reemplaza el servidor por una API simulada en el navegador: datos de ejemplo,
   sin base de datos real y SIN envío de correo. No usar para operar. */
(() => {
  const PADS = window.__DEMO_PADS__ || [];
  const TZ = 'America/Argentina/Buenos_Aires';
  const KEY = 'combustible-ct-demo-v2';
  const SIM = ' (SIMULADO: la versión de prueba no envía correos)';
  const ORDER_STATUS = ['Borrador', 'Solicitado', 'Enviado a transportista', 'Entregado', 'Cancelado'];
  const NOTIF_STATUS = ['Pendiente de envío', 'Enviado correctamente', 'Error de envío'];
  const WHOLE_PAD = 'PAD completo (varios pozos)';
  const USERS = [
    { id: 1, username: 'admin', full_name: 'Administrador de prueba', email: '', role: 'administrador', active: true, created_at: new Date().toISOString() },
    { id: 2, username: 'operador', full_name: 'Operador de prueba', email: '', role: 'operador', active: true, created_at: new Date().toISOString() },
  ];
  const split = (s) => String(s || '').split(/[,;\n]/).map((w) => w.trim()).filter(Boolean);
  const nf = new Intl.NumberFormat('es-AR');
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  const localDate = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso));
  const fDate = (d) => d.split('-').reverse().join('/');

  let db;
  function seed() {
    const now = Date.now();
    const s = {
      user: null, seq: {}, nid: 1, eid: 1, oid: 1, mode: 'err',
      settings: { mail_to: 'mperez5@pan-energy.com', mail_cc: '', unidad_operativa: 'Coiled Tubing' },
      pads: PADS.map((p, i) => ({ id: i + 1, code: p.code, wells: p.wells.join(', '), area: '', active: 1, created_at: new Date(now).toISOString() })),
      users: USERS.map((u) => ({ ...u })), orders: [], notifications: [], audit: [],
    };
    db = s;
    // Pedidos de ejemplo distribuidos en los últimos meses (datos de prueba).
    const pick = ['LA-WP130', 'APO-WP038', 'CASE-WP007', 'APO-WP036', 'LA-WP087', 'CASE-WP021', 'LGu-WP019C', 'APO-WP069'];
    const plan = [
      [150, 18000, 'Entregado', true], [128, 22000, 'Entregado', true], [104, 15000, 'Entregado', true], [86, 30000, 'Entregado', true],
      [63, 12000, 'Cancelado', true], [45, 25000, 'Entregado', true], [27, 20000, 'Entregado', true], [12, 16000, 'Enviado a transportista', true],
      [5, 24000, 'Enviado a transportista', true], [2, 10000, 'Solicitado', false], [1, 8000, 'Borrador', null],
    ];
    plan.forEach(([daysAgo, liters, status, sent], i) => {
      const pad = s.pads.find((p) => p.code === pick[i % pick.length]) || s.pads[i];
      const wells = split(pad.wells);
      const req = new Date(now - daysAgo * 864e5 - 3 * 3600e3);
      const due = localDate(new Date(req.getTime() + 2 * 864e5).toISOString());
      const user = s.users[i % 2];
      const o = insertOrder({
        pad, well: wells[i % wells.length] || WHOLE_PAD, liters, request_date: req.toISOString(), required_date: due,
        observations: 'Pedido de ejemplo (datos de prueba).', user, status: status === 'Borrador' ? 'Borrador' : 'Solicitado',
      });
      if (sent !== null) {
        logNotif(o, user, sent, sent ? null : 'Ejemplo de error: el servidor de correo no respondió (datos de prueba).', req.toISOString());
        o.notification_status = sent ? 'Enviado correctamente' : 'Error de envío';
        if (sent) o.status = 'Enviado a transportista';
      }
      if (status === 'Entregado' || status === 'Cancelado') {
        o.status = status;
        if (status === 'Cancelado') o.cancel_reason = 'Ejemplo: operación reprogramada (datos de prueba).';
        audit(user, status === 'Cancelado' ? 'cancelacion' : 'cambio_estado', o.id, { de: 'Enviado a transportista', a: status, motivo: o.cancel_reason || undefined }, new Date(req.getTime() + 2 * 864e5).toISOString());
      }
    });
    return s;
  }

  function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* almacenamiento no disponible */ } }
  function load() {
    try { const raw = localStorage.getItem(KEY); if (raw) { db = JSON.parse(raw); return; } } catch { /* sin almacenamiento */ }
    seed(); save();
  }

  function audit(user, action, entityId, details = {}, at, entity = 'pedido') {
    db.audit.push({ id: db.eid++, at: at || new Date().toISOString(), user_id: user ? user.id : null, user_name: user ? user.full_name : 'sistema', action, entity, entity_id: entityId, details: JSON.stringify(details) });
  }
  function nextNumber(year) { db.seq[year] = (db.seq[year] || 0) + 1; return `CT-${year}-${String(db.seq[year]).padStart(5, '0')}`; }
  function insertOrder({ pad, well, liters, request_date, required_date, observations, user, status, key }) {
    const o = {
      id: db.oid++, order_number: nextNumber(localDate(request_date).slice(0, 4)), unit: db.settings.unidad_operativa, pad_id: pad.id, pad_code: pad.code,
      pad_wells: pad.wells, pad_area: pad.area, well, liters, request_date, required_date, observations, requester_id: user.id, requester_name: user.full_name,
      status, notification_status: 'Pendiente de envío', cancel_reason: '', idempotency_key: key || null, created_at: request_date, updated_at: request_date,
    };
    db.orders.push(o);
    audit(user, status === 'Borrador' ? 'creacion_borrador' : 'creacion', o.id, { numero: o.order_number, pad: pad.code, pozo: well, litros: liters, fecha_requerida: required_date, fecha_solicitud: request_date }, request_date);
    return o;
  }
  function logNotif(o, user, ok, error, at) {
    const subject = `[PEDIDO DE COMBUSTIBLE CT] – ${o.pad_code} – ${fDate(o.required_date)}`;
    db.notifications.push({ id: db.nid++, order_id: o.id, attempted_at: at || new Date().toISOString(), recipients: db.settings.mail_to, subject, success: ok ? 1 : 0, message_id: null, error, triggered_by: user.id, triggered_by_name: user.full_name });
    audit(user, 'envio_notificacion', o.id, { resultado: ok ? 'enviado' : 'error', destinatarios: [db.settings.mail_to], error }, at);
  }
  function notify(o, user, action) {
    const ok = db.mode === 'ok';
    const error = ok ? null : 'Versión de prueba: no se envió ningún correo. Los correos reales solo salen desde la app instalada en el servidor con el correo configurado.';
    const subject = `[PEDIDO DE COMBUSTIBLE CT] – ${o.pad_code} – ${fDate(o.required_date)}`;
    db.notifications.push({ id: db.nid++, order_id: o.id, attempted_at: new Date().toISOString(), recipients: db.settings.mail_to + (ok ? SIM : ''), subject, success: ok ? 1 : 0, message_id: null, error, triggered_by: user.id, triggered_by_name: user.full_name });
    o.notification_status = ok ? 'Enviado correctamente' : 'Error de envío';
    audit(user, action, o.id, { resultado: ok ? 'enviado' : 'error', destinatarios: [db.settings.mail_to], error });
    if (ok && o.status === 'Solicitado') { o.status = 'Enviado a transportista'; audit(user, 'cambio_estado', o.id, { de: 'Solicitado', a: o.status, motivo: 'Notificación enviada a transportista' }); }
    return { ok, error };
  }

  class E extends Error { constructor(st, m) { super(m); this.status = st; } }
  const me = () => db.users.find((u) => u.id === db.user);
  const isAdmin = (u) => u.role === 'administrador';
  function perms(u, o) {
    const admin = isAdmin(u); const mine = admin || o.requester_id === u.id;
    return {
      edit: (['Borrador', 'Solicitado'].includes(o.status) && mine) || (o.status === 'Enviado a transportista' && admin),
      submit: o.status === 'Borrador' && mine,
      cancel: (['Borrador', 'Solicitado'].includes(o.status) && mine) || (o.status === 'Enviado a transportista' && admin),
      deliver: ['Solicitado', 'Enviado a transportista'].includes(o.status) && mine,
      markSent: o.status === 'Solicitado' && admin,
      resend: !['Borrador', 'Cancelado'].includes(o.status),
      editRequestDate: admin,
    };
  }
  function validate(b, u, reqIso, prev) {
    const pad = db.pads.find((p) => p.id === Number(b.pad_id));
    if (!pad) throw new E(400, 'Seleccione un PAD / locación válido.');
    if (!pad.active && !(prev && prev.pad_id === pad.id)) throw new E(400, `El PAD ${pad.code} está inactivo.`);
    const liters = Number(b.liters);
    if (!Number.isInteger(liters) || liters <= 0) throw new E(400, 'La cantidad de litros debe ser un entero mayor que cero.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.required_date || '')) throw new E(400, 'Ingrese una fecha requerida de entrega válida.');
    if (b.required_date < localDate(reqIso)) throw new E(400, 'La fecha requerida de entrega no puede ser anterior a la fecha de solicitud.');
    const wells = split(pad.wells);
    let well = String(b.well || '');
    if (!wells.length) well = WHOLE_PAD;
    else if (!well) throw new E(400, 'Seleccione el pozo al que corresponde el pedido.');
    else if (well !== WHOLE_PAD && !wells.includes(well) && !(prev && prev.well === well)) throw new E(400, `El pozo ${well} no pertenece al PAD ${pad.code}.`);
    return { pad, well, liters, required_date: b.required_date, observations: String(b.observations || '').trim() };
  }
  function reqDate(b, u, fallback) {
    if (!b.request_date) return fallback;
    if (!isAdmin(u)) throw new E(403, 'Solo un administrador puede modificar la fecha de solicitud.');
    const d = new Date(`${b.request_date}:00-03:00`);
    if (Number.isNaN(d.getTime())) throw new E(400, 'Fecha de solicitud inválida.');
    return d.toISOString();
  }
  function filterOrders(q) {
    let rows = db.orders.slice();
    const t = (q.get('q') || '').toLowerCase();
    if (t) rows = rows.filter((o) => [o.order_number, o.pad_code, o.well].some((x) => String(x).toLowerCase().includes(t)));
    if (q.get('from')) rows = rows.filter((o) => localDate(o.request_date) >= q.get('from'));
    if (q.get('to')) rows = rows.filter((o) => localDate(o.request_date) <= q.get('to'));
    if (q.get('status')) rows = rows.filter((o) => o.status === q.get('status'));
    if (q.get('notif')) rows = rows.filter((o) => o.notification_status === q.get('notif'));
    if (q.get('requester')) rows = rows.filter((o) => o.requester_id === Number(q.get('requester')));
    const col = { fecha: 'request_date', entrega: 'required_date', cantidad: 'liters', pad: 'pad_code', numero: 'order_number' }[q.get('sort')] || 'request_date';
    const dir = q.get('dir') === 'asc' ? 1 : -1;
    rows.sort((a, b) => (a[col] > b[col] ? dir : a[col] < b[col] ? -dir : (a.id - b.id) * dir));
    return rows;
  }
  function trend(period) {
    const rows = db.orders.filter((o) => !['Borrador', 'Cancelado'].includes(o.status));
    const t = new Date(`${today()}T00:00:00Z`); const out = [];
    if (period === 'month') {
      for (let i = 11; i >= 0; i--) { const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - i, 1)); out.push({ key: d.toISOString().slice(0, 7), label: `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`, liters: 0, orders: 0 }); }
    } else {
      const mon = new Date(t); mon.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
      for (let i = 11; i >= 0; i--) { const d = new Date(mon); d.setUTCDate(mon.getUTCDate() - 7 * i); const k = d.toISOString().slice(0, 10); out.push({ key: k, label: fDate(k).slice(0, 5), liters: 0, orders: 0 }); }
    }
    for (const o of rows) {
      const ld = localDate(o.request_date); let k = ld.slice(0, 7);
      if (period === 'week') { const d = new Date(`${ld}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); k = d.toISOString().slice(0, 10); }
      const b = out.find((x) => x.key === k); if (b) { b.liters += o.liters; b.orders += 1; }
    }
    return out;
  }

  function handle(method, url, body) {
    const u = new URL(url, location.href); const p = u.pathname.replace(/^.*\/api\//, ''); const q = u.searchParams;
    if (p === 'login' && method === 'POST') {
      const user = db.users.find((x) => x.username === String(body.username || '').toLowerCase() && x.active);
      if (!user || body.password !== 'prueba') throw new E(401, 'Usuario o contraseña incorrectos. En la versión de prueba use admin u operador, contraseña: prueba.');
      db.user = user.id; save(); return { user, csrf: 'demo' };
    }
    const user = me();
    if (p === 'me') { if (!user) throw new E(401, 'Sesión no iniciada.'); return { user, csrf: 'demo' }; }
    if (!user) throw new E(401, 'Sesión no iniciada.');
    const admin = isAdmin(user);
    const needAdmin = () => { if (!admin) throw new E(403, 'Acción reservada a administradores.'); };
    let m;
    if (p === 'logout') { db.user = null; return { ok: true }; }
    if (p === 'me/password') throw new E(400, 'En la versión de prueba no se cambian contraseñas.');
    if (p === 'meta') return { unit: db.settings.unidad_operativa, orderStatus: ORDER_STATUS, notifStatus: NOTIF_STATUS, today: today(), tz: TZ, mail: { provider: 'smtp', configured: true, missing: [], to: db.settings.mail_to + (db.mode === 'ok' ? SIM : ' (versión de prueba: no se envía)'), cc: db.settings.mail_cc } };
    if (p === 'pads' && method === 'GET') {
      const all = q.get('all') === '1' && admin;
      return db.pads.filter((x) => all || x.active).map((x) => ({ ...x, orders_count: db.orders.filter((o) => o.pad_id === x.id).length })).sort((a, b) => a.code.localeCompare(b.code, 'es', { sensitivity: 'base' }));
    }
    if (p === 'pads/import') { needAdmin(); throw new E(400, 'La importación de Excel funciona en la app instalada. En esta versión de prueba ya están cargados los 92 Well PAD del listado.'); }
    if (p === 'pads' && method === 'POST') {
      needAdmin(); const code = String(body.code || '').trim(); if (!code) throw new E(400, 'El código del PAD es obligatorio.');
      if (db.pads.some((x) => x.code.toLowerCase() === code.toLowerCase())) throw new E(409, 'Ya existe un PAD con ese código.');
      const pad = { id: Math.max(0, ...db.pads.map((x) => x.id)) + 1, code, wells: split(body.wells).join(', '), area: String(body.area || ''), active: body.active === false ? 0 : 1 };
      db.pads.push(pad); audit(user, 'alta_pad', pad.id, { code }, null, 'pad'); return pad;
    }
    if ((m = p.match(/^pads\/(\d+)$/)) && method === 'PUT') {
      needAdmin(); const pad = db.pads.find((x) => x.id === Number(m[1])); if (!pad) throw new E(404, 'PAD inexistente.');
      if (body.code !== undefined) pad.code = String(body.code).trim();
      if (body.wells !== undefined) pad.wells = split(body.wells).join(', ');
      if (body.area !== undefined) pad.area = String(body.area);
      if (body.active !== undefined) pad.active = body.active ? 1 : 0;
      audit(user, 'modificacion_pad', pad.id, { code: pad.code }, null, 'pad'); return pad;
    }
    if (p === 'orders' && method === 'GET') return filterOrders(q);
    if (p === 'orders' && method === 'POST') {
      if (body.idempotency_key) { const ex = db.orders.find((o) => o.idempotency_key === body.idempotency_key); if (ex) return { order: ex, duplicate: true, email: null }; }
      const ri = reqDate(body, user, new Date().toISOString()); const v = validate(body, user, ri);
      const o = insertOrder({ ...v, request_date: ri, user, status: body.draft ? 'Borrador' : 'Solicitado', key: body.idempotency_key });
      const email = body.draft ? null : notify(o, user, 'envio_notificacion');
      return { order: o, email };
    }
    if ((m = p.match(/^orders\/(\d+)(?:\/(\w+))?$/))) {
      const o = db.orders.find((x) => x.id === Number(m[1])); if (!o) throw new E(404, 'Pedido inexistente.');
      const pr = perms(user, o); const act = m[2];
      if (!act && method === 'GET') {
        return { order: o, notifications: db.notifications.filter((n) => n.order_id === o.id).reverse(), events: db.audit.filter((e) => e.entity === 'pedido' && e.entity_id === o.id).sort((a, b) => (a.at < b.at ? 1 : -1)), permissions: pr };
      }
      if (!act && method === 'PUT') {
        if (!pr.edit) throw new E(403, `No tiene permisos para modificar un pedido en estado "${o.status}".`);
        const ri = reqDate(body, user, o.request_date); const v = validate(body, user, ri, o);
        const ch = {};
        if (v.pad.id !== o.pad_id) ch.pad = [o.pad_code, v.pad.code];
        if (v.well !== o.well) ch.pozo = [o.well, v.well];
        if (v.liters !== o.liters) ch.litros = [o.liters, v.liters];
        if (v.required_date !== o.required_date) ch.fecha_requerida = [o.required_date, v.required_date];
        if (v.observations !== o.observations) ch.observaciones = [o.observations, v.observations];
        if (!Object.keys(ch).length) return { order: o, changed: false };
        Object.assign(o, { pad_id: v.pad.id, pad_code: v.pad.code, pad_wells: v.pad.wells, pad_area: v.pad.area, well: v.well, liters: v.liters, required_date: v.required_date, observations: v.observations, request_date: ri });
        if (o.status !== 'Borrador' && o.notification_status === 'Enviado correctamente') o.notification_status = 'Pendiente de envío';
        audit(user, 'modificacion', o.id, ch); return { order: o, changed: true };
      }
      if (act === 'submit') {
        if (!pr.submit) throw new E(403, 'Solo se pueden enviar borradores propios.');
        o.status = 'Solicitado'; audit(user, 'cambio_estado', o.id, { de: 'Borrador', a: 'Solicitado' });
        return { order: o, email: notify(o, user, 'envio_notificacion') };
      }
      if (act === 'resend') {
        if (!pr.resend) throw new E(400, `No se puede reenviar la notificación de un pedido en estado "${o.status}".`);
        return { order: o, email: notify(o, user, o.notification_status === 'Enviado correctamente' ? 'reenvio_notificacion' : 'reintento_notificacion') };
      }
      if (act === 'status') {
        const to = body.status; const ok = { Cancelado: pr.cancel, Entregado: pr.deliver, 'Enviado a transportista': pr.markSent }[to];
        if (!ok) throw new E(403, `No se permite pasar de "${o.status}" a "${to}" con su perfil.`);
        if (to === 'Cancelado' && !String(body.reason || '').trim()) throw new E(400, 'Indique el motivo de la cancelación.');
        audit(user, to === 'Cancelado' ? 'cancelacion' : 'cambio_estado', o.id, { de: o.status, a: to, motivo: body.reason || undefined });
        o.status = to; if (to === 'Cancelado') o.cancel_reason = String(body.reason).trim();
        return { order: o };
      }
    }
    if (p === 'requesters') { const seen = new Map(); db.orders.forEach((o) => seen.set(o.requester_id, o.requester_name)); return [...seen].map(([id, name]) => ({ id, name })); }
    if (p === 'dashboard') {
      const nd = db.orders.filter((o) => o.status !== 'Borrador'); const act = nd.filter((o) => o.status !== 'Cancelado');
      const byPad = new Map(); act.forEach((o) => { const b = byPad.get(o.pad_code) || { pad: o.pad_code, liters: 0, orders: 0 }; b.liters += o.liters; b.orders += 1; byPad.set(o.pad_code, b); });
      const period = q.get('period') === 'week' ? 'week' : 'month';
      return {
        period,
        kpi: {
          total: nd.length, liters: act.reduce((a, o) => a + o.liters, 0), pending: nd.filter((o) => ['Solicitado', 'Enviado a transportista'].includes(o.status)).length,
          sent_ok: nd.filter((o) => o.notification_status === 'Enviado correctamente').length, notif_errors: act.filter((o) => o.notification_status === 'Error de envío').length,
          drafts: db.orders.length - nd.length, delivered: nd.filter((o) => o.status === 'Entregado').length,
        },
        byPad: [...byPad.values()].sort((a, b) => b.liters - a.liters), trend: trend(period),
        recent: nd.slice().sort((a, b) => (a.request_date < b.request_date ? 1 : -1)).slice(0, 6),
      };
    }
    if (p === 'users' && method === 'GET') { needAdmin(); return db.users; }
    if (p.startsWith('users')) { needAdmin(); throw new E(400, 'En la versión de prueba no se crean ni modifican usuarios.'); }
    if (p === 'settings' && method === 'GET') { needAdmin(); return { settings: db.settings, mail: { provider: 'smtp', configured: false, missing: ['(versión de prueba: sin servidor de correo)'] } }; }
    if (p === 'settings' && method === 'PUT') { needAdmin(); db.settings.mail_to = String(body.mail_to || '').trim() || db.settings.mail_to; db.settings.mail_cc = String(body.mail_cc || '').trim(); audit(user, 'modificacion_configuracion', null, { mail_to: db.settings.mail_to }, null, 'configuracion'); return { settings: db.settings }; }
    if (p === 'settings/test-mail') { needAdmin(); return { ok: false, error: 'Versión de prueba: no hay servidor de correo. En la app instalada este botón envía un correo real.' }; }
    if (p === 'audit') { needAdmin(); return db.audit.slice().sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 500); }
    throw new E(404, 'Recurso inexistente.');
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, opt = {}) => {
    if (typeof url !== 'string' || !url.includes('/api/')) return realFetch(url, opt);
    await new Promise((r) => setTimeout(r, 180));
    let status = 200; let out;
    try {
      const body = opt.body && typeof opt.body === 'string' ? JSON.parse(opt.body) : {};
      out = handle((opt.method || 'GET').toUpperCase(), url, body);
      if ((opt.method || 'GET').toUpperCase() === 'POST' && /\/api\/(orders|pads)$/.test(url)) status = 201;
      save();
    } catch (e) { status = e.status || 500; out = { error: e.message }; }
    return new Response(JSON.stringify(out), { status, headers: { 'content-type': 'application/json' } });
  };

  // Exportación: los archivos no se descargan dentro del visor de prueba.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href*="/api/orders/export.csv"]');
    if (!a) return;
    e.preventDefault();
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = 'En la app instalada este botón descarga el CSV para Excel. La versión de prueba no permite descargas.';
    document.getElementById('toasts').appendChild(t); setTimeout(() => t.remove(), 6000);
  }, true);

  // Barra de la versión de prueba.
  function bar() {
    const el = document.getElementById('demoBar');
    el.innerHTML = `<b>VERSIÓN DE PRUEBA</b><span>Datos de ejemplo · <b>no envía correos reales</b> · usuarios <code>admin</code> u <code>operador</code>, contraseña <code>prueba</code></span>
      <label>Resultado del envío: <select id="demoMode"><option value="err">Sin envío (muestra error)</option><option value="ok">Simular envío correcto (no envía)</option></select></label>
      <button type="button" id="demoReset">Restablecer datos</button>`;
    const sel = document.getElementById('demoMode'); sel.value = db.mode;
    sel.addEventListener('change', () => { db.mode = sel.value; save(); location.reload(); });
    document.getElementById('demoReset').addEventListener('click', () => { const u = db.user; seed(); db.user = u; save(); location.hash = '#/inicio'; location.reload(); });
  }
  load();
  document.addEventListener('DOMContentLoaded', bar);
})();
