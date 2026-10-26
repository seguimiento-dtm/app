'use strict';
// Pruebas automatizadas. Usan una base en memoria y un servidor SMTP local de PRUEBA
// (solo para tests) para verificar el envío real vía nodemailer sin salir a Internet.
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const dbm = require('../server/db');
const auth = require('../server/auth');
const { createApp } = require('../server/app');
const { createMailer } = require('../server/mailer');

function smtpSink() {
  const messages = [];
  const server = net.createServer((sock) => {
    let data = false; let buf = ''; let cur = { rcpt: [], body: '' };
    sock.write('220 prueba ESMTP\r\n');
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (data) {
          if (line === '.') { data = false; messages.push(cur); cur = { rcpt: [], body: '' }; sock.write('250 OK id=prueba\r\n'); } else cur.body += `${line}\n`;
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO') sock.write('250-prueba\r\n250 8BITMIME\r\n');
        else if (cmd === 'RCPT') { cur.rcpt.push(line); sock.write('250 OK\r\n'); } else if (cmd === 'DATA') { data = true; sock.write('354 go\r\n'); } else if (cmd === 'QUIT') { sock.end('221 bye\r\n'); } else sock.write('250 OK\r\n');
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, messages })));
}

async function setup(env, appUrl = '') {
  const db = dbm.open(':memory:');
  db.prepare("INSERT INTO users (username, full_name, email, role, password_hash) VALUES ('admin','Admin Prueba','admin@example.test','administrador',?)").run(auth.hashPassword('clave-admin-123'));
  db.prepare("INSERT INTO users (username, full_name, role, password_hash) VALUES ('oper','Operador Prueba','operador',?)").run(auth.hashPassword('clave-oper-123'));
  const app = createApp({ db, mailer: createMailer(env), appUrl });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function login(username, password) {
    const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
    const j = await r.json();
    const cookie = r.headers.get('set-cookie').split(';')[0];
    return async (method, url, body) => {
      const res = await fetch(base + url, { method, headers: { cookie, 'x-csrf-token': j.csrf, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      const ct = res.headers.get('content-type') || '';
      return { status: res.status, body: ct.includes('json') ? await res.json() : await res.text() };
    };
  }
  return { db, server, base, login };
}

test('flujo completo con SMTP', async (t) => {
  const sink = await smtpSink();
  const env = { MAIL_PROVIDER: 'smtp', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(sink.port), SMTP_SECURE: 'false', SMTP_REQUIRE_TLS: 'false', MAIL_FROM: 'prueba@example.test' };
  const ctx = await setup(env);
  t.after(() => { ctx.server.close(); sink.server.close(); });
  const admin = await ctx.login('admin', 'clave-admin-123');
  const oper = await ctx.login('oper', 'clave-oper-123');

  // Sin sesión
  assert.equal((await fetch(`${ctx.base}/api/orders`)).status, 401);
  // CSRF
  const noCsrf = await fetch(`${ctx.base}/api/pads`, { method: 'POST' });
  assert.equal(noCsrf.status, 401);

  // PAD: solo admin
  assert.equal((await oper('POST', '/api/pads', { code: 'PAD PRUEBA 1' })).status, 403);
  const pad = (await admin('POST', '/api/pads', { code: 'PAD PRUEBA 1', area: 'Área de prueba', wells: 'POZO-T1, POZO-T2' })).body;
  const pad2 = (await admin('POST', '/api/pads', { code: 'PAD PRUEBA 2' })).body;
  assert.equal((await admin('POST', '/api/pads', { code: 'pad prueba 1' })).status, 409);
  await admin('PUT', `/api/pads/${pad2.id}`, { active: false });
  const visible = (await oper('GET', '/api/pads')).body;
  assert.deepEqual(visible.map((p) => p.code), ['PAD PRUEBA 1']);

  const future = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
  // Validaciones
  assert.equal((await oper('POST', '/api/orders', { pad_id: pad.id, liters: 0, required_date: future })).status, 400);
  assert.equal((await oper('POST', '/api/orders', { pad_id: pad.id, liters: -5, required_date: future })).status, 400);
  assert.equal((await oper('POST', '/api/orders', { pad_id: pad.id, liters: 1000, required_date: '' })).status, 400);
  assert.equal((await oper('POST', '/api/orders', { liters: 1000, required_date: future })).status, 400);
  assert.equal((await oper('POST', '/api/orders', { pad_id: pad2.id, liters: 1000, required_date: future })).status, 400, 'PAD inactivo');
  assert.equal((await oper('POST', '/api/orders', { pad_id: pad.id, liters: 1000, required_date: '2020-01-01' })).status, 400);
  assert.equal((await oper('POST', '/api/orders', { pad_id: pad.id, liters: 1000, required_date: future, request_date: '2026-01-01T10:00' })).status, 403);

  // Creación + correo
  // Pozo obligatorio y perteneciente al PAD
  assert.equal((await oper('POST', '/api/orders', { pad_id: pad.id, liters: 1000, required_date: future })).status, 400);
  assert.equal((await oper('POST', '/api/orders', { pad_id: pad.id, well: 'POZO-AJENO', liters: 1000, required_date: future })).status, 400);

  const r1 = await oper('POST', '/api/orders', { pad_id: pad.id, well: 'POZO-T2', liters: '15.000', required_date: future, observations: 'Prueba', idempotency_key: 'k1' });
  assert.equal(r1.status, 201);
  assert.match(r1.body.order.order_number, /^CT-\d{4}-00001$/);
  assert.equal(r1.body.order.liters, 15000);
  assert.equal(r1.body.order.well, 'POZO-T2');
  assert.equal(r1.body.email.ok, true);
  assert.equal(r1.body.order.status, 'Enviado a transportista');
  assert.equal(r1.body.order.notification_status, 'Enviado correctamente');
  assert.equal(sink.messages.length, 1);
  const msg = sink.messages[0];
  assert.ok(msg.rcpt[0].includes('mperez5@pan-energy.com'));
  const [y, m, d] = future.split('-');
  const subj = /^Subject: (.*(?:\n[ \t].*)*)/m.exec(msg.body)[1].replace(/\n[ \t]/g, '').replace(/=\?UTF-8\?Q\?(.*?)\?=/gi, (_, q) => Buffer.from(q.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (__, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8'));
  assert.equal(subj.replace(/\s+/g, ' '), `[PEDIDO DE COMBUSTIBLE CT] – PAD PRUEBA 1 – ${d}/${m}/${y}`);

  // Idempotencia: no duplica
  const dup = await oper('POST', '/api/orders', { pad_id: pad.id, liters: 15000, required_date: future, idempotency_key: 'k1' });
  assert.equal(dup.body.duplicate, true);
  assert.equal((await oper('GET', '/api/orders')).body.length, 1);

  // Historial conserva nombre de PAD aunque cambie
  await admin('PUT', `/api/pads/${pad.id}`, { code: 'PAD PRUEBA 1 RENOMBRADO' });
  assert.equal((await oper('GET', `/api/orders/${r1.body.order.id}`)).body.order.pad_code, 'PAD PRUEBA 1');

  // Permisos: operador no puede cancelar pedido ya enviado; admin sí con motivo
  assert.equal((await oper('POST', `/api/orders/${r1.body.order.id}/status`, { status: 'Cancelado', reason: 'x' })).status, 403);
  assert.equal((await admin('POST', `/api/orders/${r1.body.order.id}/status`, { status: 'Cancelado' })).status, 400);

  // Borrador -> envío
  const dr = await oper('POST', '/api/orders', { pad_id: pad.id, well: 'PAD completo (varios pozos)', liters: 2000, required_date: future, draft: true });
  assert.equal(dr.body.order.status, 'Borrador');
  assert.equal(sink.messages.length, 1);
  const sub = await oper('POST', `/api/orders/${dr.body.order.id}/submit`);
  assert.equal(sub.body.email.ok, true);
  assert.equal(sink.messages.length, 2);

  // Entrega manual (nunca automática)
  const del = await oper('POST', `/api/orders/${dr.body.order.id}/status`, { status: 'Entregado' });
  assert.equal(del.body.order.status, 'Entregado');

  // Filtros, búsqueda y exportación
  assert.equal((await oper('GET', '/api/orders?q=00002')).body.length, 1);
  assert.equal((await oper('GET', '/api/orders?q=POZO-T2')).body.length, 1);
  assert.equal((await oper('GET', '/api/orders?status=Entregado')).body.length, 1);
  assert.equal((await oper('GET', '/api/orders?from=2000-01-01&to=2000-01-02')).body.length, 0);
  const csv = await oper('GET', '/api/orders/export.csv');
  assert.ok(csv.body.includes('Número de pedido;Fecha de solicitud'));
  assert.ok(csv.body.includes('CT-') && csv.body.includes('POZO-T2'));
  assert.ok(sink.messages[0].body.includes('POZO-T2'));

  // Panel
  const dash = (await oper('GET', '/api/dashboard')).body;
  assert.equal(dash.kpi.total, 2);
  assert.equal(dash.kpi.liters, 17000);
  assert.equal(dash.kpi.sent_ok, 2);

  // Auditoría
  const ev = (await oper('GET', `/api/orders/${dr.body.order.id}`)).body.events.map((e) => e.action);
  assert.ok(ev.includes('creacion_borrador') && ev.includes('envio_notificacion') && ev.includes('cambio_estado'));
});

test('error de envío queda registrado y se reintenta sin duplicar', async (t) => {
  const ctx = await setup({ MAIL_PROVIDER: 'smtp' }); // sin configuración
  t.after(() => ctx.server.close());
  const admin = await ctx.login('admin', 'clave-admin-123');
  const pad = (await admin('POST', '/api/pads', { code: 'PAD PRUEBA X' })).body;
  const future = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const r = await admin('POST', '/api/orders', { pad_id: pad.id, liters: 5000, required_date: future });
  assert.equal(r.status, 201);
  assert.equal(r.body.email.ok, false);
  assert.match(r.body.email.error, /no configurado/);
  assert.equal(r.body.order.notification_status, 'Error de envío');
  assert.equal(r.body.order.status, 'Solicitado');
  const rr = await admin('POST', `/api/orders/${r.body.order.id}/resend`);
  assert.equal(rr.body.email.ok, false);
  const det = (await admin('GET', `/api/orders/${r.body.order.id}`)).body;
  assert.equal(det.notifications.length, 2);
  assert.ok(det.events.some((e) => e.action === 'reintento_notificacion'));
  assert.equal((await admin('GET', '/api/orders')).body.length, 1);
});

test('importación del listado de Well PAD y pozos', async (t) => {
  const ctx = await setup({});
  t.after(() => ctx.server.close());
  const admin = await ctx.login('admin', 'clave-admin-123');
  const oper = await ctx.login('oper', 'clave-oper-123');
  const csv = 'Oper.Well Pad;Pozo\nWP-PRUEBA-1;P-1(h)\nWP-PRUEBA-1;P-2(h)\nWP-PRUEBA-1;P-1(h)\n;Falla1\nWP-PRUEBA-2;P-3(h)\n';
  const up = async (cookieFetch, apply) => {
    const login = await fetch(`${ctx.base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cookieFetch) });
    const j = await login.json(); const cookie = login.headers.get('set-cookie').split(';')[0];
    const r = await fetch(`${ctx.base}/api/pads/import${apply ? '?aplicar=1' : ''}`, { method: 'POST', headers: { cookie, 'x-csrf-token': j.csrf, 'content-type': 'application/octet-stream', 'x-filename': 'listado.csv' }, body: csv });
    return { status: r.status, body: await r.json() };
  };
  assert.equal((await up({ username: 'oper', password: 'clave-oper-123' }, true)).status, 403);
  const prev = await up({ username: 'admin', password: 'clave-admin-123' }, false);
  assert.equal(prev.body.created.length, 2);
  assert.equal(prev.body.skipped.length, 1);
  assert.equal((await admin('GET', '/api/pads')).body.length, 0, 'la vista previa no modifica');
  const done = await up({ username: 'admin', password: 'clave-admin-123' }, true);
  assert.equal(done.body.applied, true);
  const pads = (await oper('GET', '/api/pads')).body;
  assert.deepEqual(pads.map((p) => [p.code, p.wells]), [['WP-PRUEBA-1', 'P-1(h), P-2(h)'], ['WP-PRUEBA-2', 'P-3(h)']]);
  assert.equal((await up({ username: 'admin', password: 'clave-admin-123' }, false)).body.unchanged, 2);
});

test('lectura del Excel real de Well PAD', { skip: !require('node:fs').existsSync(`${__dirname}/../datos/WP_por_Pozos.xlsx`) }, async () => {
  const padImport = require('../server/pad-import');
  const parsed = await padImport.parse(require('node:fs').readFileSync(`${__dirname}/../datos/WP_por_Pozos.xlsx`), 'WP_por_Pozos.xlsx');
  assert.ok(parsed.pads.size > 0);
  assert.deepEqual(parsed.pads.get('LA-WP130'), ['LA-750(h)', 'LA-752(h)']);
  assert.equal(parsed.conflicts.length, 0);
});

test('alta de usuario con aprobación y restablecimiento de contraseña', async (t) => {
  const sink = await smtpSink();
  const env = { MAIL_PROVIDER: 'smtp', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(sink.port), SMTP_SECURE: 'false', SMTP_REQUIRE_TLS: 'false', MAIL_FROM: 'prueba@example.test' };
  const ctx = await setup(env, 'https://combustible.example.test/');
  t.after(() => { ctx.server.close(); sink.server.close(); });
  const post = async (url, body) => {
    const r = await fetch(ctx.base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  // Solicitud de alta
  assert.equal((await post('/api/register', { full_name: 'Nuevo', username: 'nuevo', email: 'mal', password: 'clave-nueva-123' })).status, 400);
  assert.equal((await post('/api/register', { full_name: 'Nuevo', username: 'nuevo', email: 'nuevo@example.test', password: 'corta' })).status, 400);
  assert.equal((await post('/api/register', { full_name: 'Nuevo Usuario', username: 'nuevo', email: 'nuevo@example.test', password: 'clave-nueva-123' })).status, 201);
  assert.equal((await post('/api/register', { full_name: 'Otro', username: 'nuevo', email: 'otro@example.test', password: 'clave-nueva-123' })).status, 409);
  assert.ok(sink.messages.some((m) => m.rcpt[0].includes('admin@example.test')), 'aviso al administrador');
  // Pendiente: no ingresa
  const l1 = await post('/api/login', { username: 'nuevo', password: 'clave-nueva-123' });
  assert.equal(l1.status, 403);
  assert.match(l1.body.error, /pendiente de aprobación/);
  // Admin aprueba
  const admin = await ctx.login('admin', 'clave-admin-123');
  assert.equal((await admin('GET', '/api/meta')).body.pendingUsers, 1);
  const users = (await admin('GET', '/api/users')).body;
  const nuevo = users.find((u) => u.username === 'nuevo');
  assert.equal(nuevo.approval_status, 'pendiente');
  const oper = await ctx.login('oper', 'clave-oper-123');
  assert.equal((await oper('POST', `/api/users/${nuevo.id}/approve`, { role: 'operador' })).status, 403);
  assert.equal((await admin('PUT', `/api/users/${nuevo.id}`, { active: true })).status, 400);
  const ap = await admin('POST', `/api/users/${nuevo.id}/approve`, { role: 'operador' });
  assert.equal(ap.body.approval_status, 'aprobado');
  assert.equal(ap.body.approved_by, 'Admin Prueba');
  assert.ok(sink.messages.some((m) => m.rcpt[0].includes('nuevo@example.test')), 'aviso de aprobación');
  assert.equal((await post('/api/login', { username: 'nuevo', password: 'clave-nueva-123' })).status, 200);

  // Rechazo
  await post('/api/register', { full_name: 'Rechazado', username: 'rech', email: 'rech@example.test', password: 'clave-nueva-123' });
  const rech = (await admin('GET', '/api/users')).body.find((u) => u.username === 'rech');
  await admin('POST', `/api/users/${rech.id}/reject`, { reason: 'No corresponde' });
  assert.match((await post('/api/login', { username: 'rech', password: 'clave-nueva-123' })).body.error, /rechazada: No corresponde/);

  // Olvido de contraseña: respuesta genérica, enlace por correo
  assert.equal((await post('/api/forgot', { user: 'no-existe' })).body.ok, true);
  const before = sink.messages.length;
  assert.equal((await post('/api/forgot', { user: 'nuevo@example.test' })).body.ok, true);
  const mailBody = sink.messages.slice(before).map((m) => m.body.replace(/=\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))).join('\n');
  const token = /restablecer\?token=([A-Za-z0-9_-]+)/.exec(mailBody)[1];
  assert.ok(mailBody.includes('https://combustible.example.test/restablecer?token='));
  assert.ok((await admin('GET', '/api/users')).body.find((u) => u.username === 'nuevo').reset_requested_at);
  assert.equal((await post('/api/reset', { token: 'x', password: 'otra-clave-123' })).status, 400);
  assert.equal((await post('/api/reset', { token, password: 'otra-clave-123' })).status, 200);
  assert.equal((await post('/api/reset', { token, password: 'otra-clave-456' })).status, 400, 'el enlace se usa una sola vez');
  assert.equal((await post('/api/login', { username: 'nuevo', password: 'clave-nueva-123' })).status, 401);
  assert.equal((await post('/api/login', { username: 'nuevo', password: 'otra-clave-123' })).status, 200);
  assert.equal((await admin('GET', '/api/users')).body.find((u) => u.username === 'nuevo').reset_requested_at, null);
});
