'use strict';
// Envío real de correo. Dos proveedores soportados, configurados por variables de entorno
// del servidor (nunca en el frontend ni en el código):
//   MAIL_PROVIDER=smtp  -> SMTP corporativo (p. ej. smtp.office365.com:587 STARTTLS)
//   MAIL_PROVIDER=graph -> Microsoft Graph API (Microsoft 365, permiso de aplicación Mail.Send)
const nodemailer = require('nodemailer');
const fmt = require('./format');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function buildSubject(order) {
  return `[PEDIDO DE COMBUSTIBLE CT] – ${order.pad_code} – ${fmt.date(order.required_date)}`;
}

function rows(order) {
  return [
    ['Número de pedido', order.order_number],
    ['Unidad operativa', order.unit],
    ['PAD / Locación de destino', order.pad_code + (order.pad_area ? ` (${order.pad_area})` : '')],
    ['Pozo', order.well || '—'],
    ['Cantidad solicitada', fmt.liters(order.liters)],
    ['Fecha y hora de solicitud', fmt.dateTime(order.request_date)],
    ['Fecha requerida de entrega', fmt.date(order.required_date)],
    ['Solicitante', order.requester_name],
    ['Observaciones', order.observations || 'Sin observaciones'],
    ['Estado del pedido', order.status],
  ];
}

function buildText(order) {
  return [
    'PEDIDO DE COMBUSTIBLE – UNIDAD COILED TUBING',
    '',
    ...rows(order).map(([k, v]) => `${k}: ${v}`),
    '',
    'Por favor, confirmar recepción y programación de la entrega en locación.',
    'Mensaje generado automáticamente por el sistema de Gestión de Pedidos de Combustible CT.',
  ].join('\n');
}

function buildHtml(order) {
  const tr = rows(order).map(([k, v], i) => `
      <tr style="background:${i % 2 ? '#F4F6F8' : '#FFFFFF'}">
        <td style="padding:9px 14px;border-bottom:1px solid #DDE2E7;color:#55626E;font-size:13px;width:42%;vertical-align:top">${esc(k)}</td>
        <td style="padding:9px 14px;border-bottom:1px solid #DDE2E7;color:#14212E;font-size:14px;font-weight:600;white-space:pre-wrap">${esc(v)}</td>
      </tr>`).join('');
  return `<!doctype html><html lang="es"><body style="margin:0;padding:0;background:#EEF1F4;font-family:Segoe UI,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF1F4;padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;background:#FFFFFF;border:1px solid #D5DBE1">
        <tr><td style="background:#0B2545;padding:18px 22px;color:#FFFFFF">
          <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.8">Logística de combustible · Coiled Tubing</div>
          <div style="font-size:20px;font-weight:700;margin-top:4px">Pedido de combustible ${esc(order.order_number)}</div>
        </td></tr>
        <tr><td style="padding:18px 22px 6px;color:#14212E;font-size:14px">
          Se solicita la entrega de <b>${esc(fmt.liters(order.liters))}</b> de combustible en <b>${esc(order.pad_code)}</b>${order.well && order.well !== order.pad_code ? ` – pozo <b>${esc(order.well)}</b>` : ''}
          para el día <b>${esc(fmt.date(order.required_date))}</b>.
        </td></tr>
        <tr><td style="padding:12px 22px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #DDE2E7;border-collapse:collapse">${tr}
          </table>
        </td></tr>
        <tr><td style="padding:6px 22px 20px;color:#55626E;font-size:12px;line-height:1.5">
          Por favor, confirmar recepción y programación de la entrega en locación.<br>
          Mensaje generado automáticamente por el sistema de Gestión de Pedidos de Combustible CT. No modificar el asunto al responder.
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

function splitAddresses(s) {
  return String(s || '').split(/[;,]/).map((x) => x.trim()).filter(Boolean);
}

// Devuelve { configured, provider, missing[] } sin exponer secretos.
function configStatus(env = process.env) {
  const provider = (env.MAIL_PROVIDER || 'smtp').toLowerCase();
  const need = provider === 'graph'
    ? ['GRAPH_TENANT_ID', 'GRAPH_CLIENT_ID', 'GRAPH_CLIENT_SECRET', 'GRAPH_SENDER']
    : ['SMTP_HOST', 'SMTP_PORT', 'MAIL_FROM'];
  const missing = need.filter((k) => !env[k]);
  return { provider, configured: missing.length === 0, missing };
}

function createSmtpTransport(env) {
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT),
    secure: String(env.SMTP_SECURE).toLowerCase() === 'true',
    // STARTTLS obligatorio por defecto; SMTP_REQUIRE_TLS=false solo para relays internos sin TLS.
    requireTLS: String(env.SMTP_SECURE).toLowerCase() !== 'true' && String(env.SMTP_REQUIRE_TLS).toLowerCase() !== 'false',
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });
  return async (msg) => {
    const info = await transport.sendMail({ from: env.MAIL_FROM, ...msg });
    if (info.rejected && info.rejected.length) throw new Error(`Destinatarios rechazados: ${info.rejected.join(', ')}`);
    return { messageId: info.messageId };
  };
}

function createGraphTransport(env) {
  let cached = null;
  async function token() {
    if (cached && cached.exp > Date.now() + 60e3) return cached.value;
    const r = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(env.GRAPH_TENANT_ID)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.GRAPH_CLIENT_ID, client_secret: env.GRAPH_CLIENT_SECRET,
        scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials',
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Autenticación Microsoft Graph fallida: ${j.error_description || r.status}`);
    cached = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
    return cached.value;
  }
  return async (msg) => {
    const addr = (list) => list.map((a) => ({ emailAddress: { address: a } }));
    const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(env.GRAPH_SENDER)}/sendMail`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject: msg.subject,
          body: { contentType: 'HTML', content: msg.html },
          toRecipients: addr(msg.to), ccRecipients: addr(msg.cc || []),
        },
        saveToSentItems: true,
      }),
    });
    if (r.status !== 202) {
      const j = await r.json().catch(() => ({}));
      throw new Error(`Microsoft Graph rechazó el envío (${r.status}): ${j.error?.message || 'sin detalle'}`);
    }
    return { messageId: r.headers.get('request-id') || null };
  };
}

// Crea la función send(msg) real según el entorno. Si falta configuración, cada intento
// falla con un error explícito (el pedido queda "Error de envío" y se puede reintentar).
function createMailer(env = process.env) {
  const st = configStatus(env);
  let impl = null;
  return {
    status: () => configStatus(env),
    async send(msg) {
      if (!st.configured) throw new Error(`Correo no configurado en el servidor. Faltan variables: ${st.missing.join(', ')}.`);
      impl = impl || (st.provider === 'graph' ? createGraphTransport(env) : createSmtpTransport(env));
      return impl(msg);
    },
  };
}

module.exports = { createMailer, buildSubject, buildHtml, buildText, splitAddresses, configStatus };
