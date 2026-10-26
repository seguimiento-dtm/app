'use strict';
/* Gestión de Pedidos de Combustible – Unidad Coiled Tubing (frontend SPA, sin dependencias). */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const state = { user: null, csrf: null, meta: null, pads: [], hist: { sort: 'fecha', dir: 'desc' }, period: 'month' };

  // ---------- formato ----------
  const nf = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
  const L = (n) => `${nf.format(Number(n) || 0)} L`;
  const N = (n) => nf.format(Number(n) || 0);
  const fDate = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
  function parts(iso) {
    return Object.fromEntries(new Intl.DateTimeFormat('es-AR', {
      timeZone: state.meta ? state.meta.tz : undefined, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  }
  const fDateTime = (iso) => { if (!iso) return ''; const p = parts(iso); return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`; };
  const fDateOnly = (iso) => { if (!iso) return ''; const p = parts(iso); return `${p.day}/${p.month}/${p.year}`; };
  const toLocalInput = (iso) => { const p = parts(iso); return `${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}`; };
  const parseLiters = (s) => { const t = String(s ?? '').trim().replace(/\s|L$/gi, '').replace(/\./g, ''); return t === '' ? NaN : Number(t.replace(',', '.')); };
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

  const STATUS_CLASS = { Borrador: 'b-borrador', Solicitado: 'b-solicitado', 'Enviado a transportista': 'b-enviado', Entregado: 'b-entregado', Cancelado: 'b-cancelado' };
  const NOTIF_CLASS = { 'Enviado correctamente': 'b-n-ok', 'Pendiente de envío': 'b-n-pend', 'Error de envío': 'b-n-err' };
  const statusBadge = (s) => `<span class="badge ${STATUS_CLASS[s] || ''}">${esc(s)}</span>`;
  const notifLabel = (o) => (o.status === 'Borrador' ? 'Sin enviar (borrador)' : (o.notification_status === 'Error de envío' ? 'Error de envío – pendiente de notificación' : o.notification_status));
  const notifBadge = (o) => `<span class="badge ${o.status === 'Borrador' ? 'b-borrador' : NOTIF_CLASS[o.notification_status] || ''}">${esc(o.status === 'Borrador' ? 'Sin enviar' : o.notification_status)}</span>`;

  // ---------- iconos ----------
  const I = {
    home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    pin: '<path d="M12 22s7-7 7-12a7 7 0 0 0-14 0c0 5 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M16 4a3.5 3.5 0 0 1 0 7M18 15c2.5.5 4 2.5 4 6"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    log: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
    ok: '<circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-6"/>',
    warn: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/>',
    drop: '<path d="M12 2.7s-6 6.8-6 11.3a6 6 0 0 0 12 0c0-4.5-6-11.3-6-11.3z"/>',
  };
  const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n]}</svg>`;

  // ---------- API ----------
  async function api(method, url, body) {
    const opt = { method, headers: {}, credentials: 'same-origin' };
    if (state.csrf) opt.headers['x-csrf-token'] = state.csrf;
    if (body !== undefined) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
    let r;
    try { r = await fetch(url, opt); } catch { throw new Error('No se pudo contactar al servidor. Verifique la conexión.'); }
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && url !== '/api/login' && url !== '/api/me') { state.user = null; renderLogin('Su sesión venció. Ingrese nuevamente.'); throw new Error('Sesión vencida.'); }
    if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
    return j;
  }

  function toast(msg, kind = '') {
    const t = document.createElement('div');
    t.className = `toast ${kind}`; t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), kind === 'err' ? 8000 : 4500);
  }

  // ---------- modal ----------
  function modal({ title, body, foot = '', wide = false, onClose }) {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="mdl-t">
      <div class="modal-h"><h2 id="mdl-t">${title}</h2><button class="x" data-close aria-label="Cerrar">×</button></div>
      <div class="modal-b">${body}</div>${foot ? `<div class="modal-f">${foot}</div>` : ''}</div>`;
    const prevFocus = document.activeElement;
    const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); if (prevFocus && prevFocus.focus) prevFocus.focus(); if (onClose) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(bg);
    const f = bg.querySelector('[autofocus]') || bg.querySelector('.modal-f .btn.primary, .modal-f .btn.ok, .modal-f .btn, .x');
    if (f) f.focus();
    return { el: bg, close };
  }

  function busy(btn, on, label) {
    if (!btn) return;
    if (on) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.textContent = label || 'Procesando…'; } else { btn.disabled = false; if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
  }

  // ---------- login ----------
  function renderLogin(msg) {
    $('#root').innerHTML = `<div class="login"><form class="card" id="loginForm" novalidate>
      <h1>${icon('drop').replace('<svg', '<svg width="22" height="22"')} Pedidos de Combustible</h1>
      <p class="sub">Unidad Coiled Tubing · Logística de combustible</p>
      ${msg ? `<div class="alert warn">${icon('warn')}<p>${esc(msg)}</p></div>` : ''}
      <div class="field"><label for="lu">Usuario</label><input class="input" id="lu" name="username" autocomplete="username" required autofocus></div>
      <div class="field"><label for="lp">Contraseña</label><input class="input" id="lp" name="password" type="password" autocomplete="current-password" required></div>
      <div id="loginErr"></div>
      <button class="btn primary" type="submit">Ingresar</button>
    </form></div>`;
    $('#lu').focus();
    $('#loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button');
      busy(btn, true, 'Ingresando…');
      try {
        const r = await api('POST', '/api/login', { username: $('#lu').value.trim(), password: $('#lp').value });
        state.user = r.user; state.csrf = r.csrf;
        await boot();
      } catch (err) {
        $('#loginErr').innerHTML = `<div class="alert err">${icon('warn')}<p>${esc(err.message)}</p></div>`;
        busy(btn, false);
      }
    });
  }

  // ---------- shell ----------
  const isAdmin = () => state.user && state.user.role === 'administrador';
  const ROUTES = [
    { path: 'inicio', label: 'Inicio', icon: 'home', render: renderHome },
    { path: 'nuevo', label: 'Nuevo Pedido', icon: 'plus', render: renderNew },
    { path: 'historial', label: 'Historial de Pedidos', icon: 'list', render: renderHistory },
    { path: 'pads', label: 'Administración de PAD', icon: 'pin', render: renderPads, admin: true },
    { path: 'usuarios', label: 'Usuarios', icon: 'users', render: renderUsers, admin: true, group: 'Administración' },
    { path: 'config', label: 'Configuración', icon: 'gear', render: renderConfig, admin: true },
    { path: 'auditoria', label: 'Auditoría', icon: 'log', render: renderAudit, admin: true },
  ];

  function shell() {
    const nav = ROUTES.filter((r) => !r.admin || isAdmin()).map((r) => `${r.group ? `<li class="sep">${r.group}</li>` : ''}
      <li><a href="#/${r.path}" data-path="${r.path}">${icon(r.icon)}<span>${r.label}</span></a></li>`).join('');
    $('#root').innerHTML = `<div class="layout">
      <aside class="side" id="side">
        <div class="brand"><div class="t1">Logística Oil &amp; Gas</div><div class="t2"><span class="drop"></span>Combustible CT</div></div>
        <ul class="nav">${nav}</ul>
        <div class="who"><b>${esc(state.user.full_name)}</b><span class="role">${esc(state.user.role)}</span><br>
          <button id="pwBtn">Cambiar contraseña</button><button id="logoutBtn">Salir</button></div>
      </aside>
      <div class="main">
        <div class="topbar"><button id="menuBtn" aria-label="Abrir menú">${icon('menu')}</button><b>Combustible CT</b></div>
        <main class="content" id="view"></main>
      </div></div>`;
    $('#menuBtn').addEventListener('click', () => toggleMenu(true));
    $('#side').addEventListener('click', (e) => { if (e.target.closest('a')) toggleMenu(false); });
    $('#logoutBtn').addEventListener('click', async () => { try { await api('POST', '/api/logout'); } catch { /* ignorar */ } state.user = null; state.csrf = null; location.hash = ''; renderLogin(); });
    $('#pwBtn').addEventListener('click', changePassword);
  }

  function toggleMenu(open) {
    $('#side').classList.toggle('open', open);
    const sc = $('.scrim');
    if (open && !sc) { const d = document.createElement('div'); d.className = 'scrim'; d.addEventListener('click', () => toggleMenu(false)); document.body.appendChild(d); }
    if (!open && sc) sc.remove();
  }

  function route() {
    if (!state.user) return;
    const [path, qs] = (location.hash.replace(/^#\/?/, '') || 'inicio').split('?');
    let r = ROUTES.find((x) => x.path === path && (!x.admin || isAdmin()));
    if (!r) r = ROUTES[0];
    $$('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.path === r.path));
    document.title = `${r.label} · Pedidos de Combustible CT`;
    const view = $('#view');
    view.innerHTML = '<div class="empty">Cargando…</div>';
    window.scrollTo(0, 0);
    Promise.resolve(r.render(view, new URLSearchParams(qs || ''))).catch((e) => { view.innerHTML = `<div class="alert err">${icon('warn')}<p>${esc(e.message)}</p></div>`; });
  }

  async function boot() {
    try {
      if (!state.user) { const me = await api('GET', '/api/me'); state.user = me.user; state.csrf = me.csrf; }
    } catch { return renderLogin(); }
    state.meta = await api('GET', '/api/meta');
    shell();
    route();
  }
  window.addEventListener('hashchange', route);

  function mailBanner() {
    const m = state.meta.mail;
    if (m.configured) return '';
    return `<div class="alert warn">${icon('warn')}<div><p><b>El envío de correo no está configurado en el servidor.</b> Los pedidos se registran igual, quedan con notificación “Error de envío” y se pueden reintentar cuando se complete la configuración.</p>
      ${isAdmin() ? `<p>Faltan variables (${esc(m.provider)}): ${esc(m.missing.join(', '))}. Ver <a href="#/config">Configuración</a> y el README.</p>` : '<p>Informe a un administrador.</p>'}</div></div>`;
  }

  // =============== INICIO ===============
  async function renderHome(view) {
    const d = await api('GET', `/api/dashboard?period=${state.period}`);
    const k = d.kpi;
    view.innerHTML = `
      <div class="page-h"><h1>Panel de pedidos de combustible</h1><p class="sub">Unidad ${esc(state.meta.unit)} · datos actualizados al ${fDateTime(new Date().toISOString())}</p></div>
      ${mailBanner()}
      <div class="shortcuts">
        <a class="shortcut primary" href="#/nuevo">${icon('plus')}<span>Nuevo Pedido<small>Solicitar combustible para un PAD</small></span></a>
        <a class="shortcut" href="#/historial">${icon('list')}<span>Historial de Pedidos<small>Consultar, filtrar y exportar</small></span></a>
      </div>
      <div class="kpis">
        <a class="kpi" href="#/historial"><div class="l">Pedidos generados</div><div class="v num">${N(k.total)}</div><div class="s">${N(k.delivered)} entregados${k.drafts ? ` · ${N(k.drafts)} borradores` : ''}</div></a>
        <div class="kpi"><div class="l">Litros solicitados</div><div class="v num">${L(k.liters)}</div><div class="s">Excluye cancelados y borradores</div></div>
        <a class="kpi warn" href="#/historial?pend=1"><div class="l">Pendientes de entrega</div><div class="v num">${N(k.pending)}</div><div class="s">Solicitados o enviados a transportista</div></a>
        <a class="kpi ok" href="#/historial?notif=${encodeURIComponent('Enviado correctamente')}"><div class="l">Notificados correctamente</div><div class="v num">${N(k.sent_ok)}</div><div class="s">Correo enviado a transportista</div></a>
        <a class="kpi ${k.notif_errors ? 'err' : 'ok'}" href="#/historial?notif=${encodeURIComponent('Error de envío')}"><div class="l">Errores de notificación</div><div class="v num">${N(k.notif_errors)}</div><div class="s">${k.notif_errors ? 'Requieren reintento de envío' : 'Sin pendientes'}</div></a>
      </div>
      <div class="dash-cols">
        <section class="card"><div class="chart-h"><h2>Litros solicitados por PAD</h2></div>${padBars(d.byPad)}</section>
        <section class="card"><div class="chart-h"><h2>Evolución de la demanda (litros)</h2>
          <div class="seg" role="group" aria-label="Período"><button data-p="month" class="${state.period === 'month' ? 'on' : ''}">Mensual</button><button data-p="week" class="${state.period === 'week' ? 'on' : ''}">Semanal</button></div></div>
          ${trendChart(d.trend, d.period)}</section>
        <section class="card wide"><div class="chart-h"><h2>Últimos pedidos</h2><a class="btn sm" href="#/historial">Ver historial</a></div>
          ${d.recent.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>N.º pedido</th><th>Solicitud</th><th>Entrega requerida</th><th>PAD</th><th class="r">Litros</th><th>Estado</th><th>Notificación</th></tr></thead><tbody>
          ${d.recent.map((o) => `<tr class="click" data-id="${o.id}"><td class="mono">${esc(o.order_number)}</td><td>${fDateOnly(o.request_date)}</td><td>${fDate(o.required_date)}</td><td>${esc(o.pad_code)}</td><td class="r num">${L(o.liters)}</td><td>${statusBadge(o.status)}</td><td>${notifBadge(o)}</td></tr>`).join('')}
          </tbody></table></div>` : '<div class="empty">Todavía no hay pedidos registrados.</div>'}</section>
      </div>`;
    $$('.seg button', view).forEach((b) => b.addEventListener('click', () => { state.period = b.dataset.p; renderHome(view); }));
    $$('tr[data-id]', view).forEach((tr) => tr.addEventListener('click', () => openDetail(tr.dataset.id, () => renderHome(view))));
    $$('.fill[data-w]', view).forEach((f) => { f.style.width = `${f.dataset.w}%`; });
    bindChartTips(view);
  }

  function padBars(rows) {
    if (!rows.length) return '<div class="empty">Sin pedidos activos para graficar.</div>';
    const max = Math.max(...rows.map((r) => r.liters));
    const top = rows.slice(0, 12);
    return `<div class="hbars">${top.map((r) => `<div class="hbar" title="${esc(r.pad)}: ${L(r.liters)} en ${r.orders} pedido(s)">
        <span class="name">${esc(r.pad)}</span><span class="track"><span class="fill" data-w="${(r.liters / max * 100).toFixed(2)}"></span></span><span class="val num">${L(r.liters)}</span></div>`).join('')}</div>
      ${rows.length > top.length ? `<p class="muted">Se muestran los ${top.length} PAD con mayor demanda de ${rows.length}.</p>` : ''}
      <details class="tbl-view"><summary>Ver como tabla</summary><table class="tbl"><thead><tr><th>PAD</th><th class="r">Pedidos</th><th class="r">Litros</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(r.pad)}</td><td class="r num">${N(r.orders)}</td><td class="r num">${L(r.liters)}</td></tr>`).join('')}</tbody></table></details>`;
  }

  function niceMax(v) {
    if (v <= 0) return 1000;
    const p = 10 ** Math.floor(Math.log10(v));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }

  function trendChart(rows, period) {
    const total = rows.reduce((a, r) => a + r.liters, 0);
    if (!total) return `<div class="empty">Sin pedidos en los últimos 12 ${period === 'month' ? 'meses' : 'semanas'}.</div>`;
    const W = 560; const H = 240; const pl = 64; const pb = 26; const pt = 10;
    const max = niceMax(Math.max(...rows.map((r) => r.liters)));
    const cw = (W - pl) / rows.length; const bw = Math.min(28, cw * 0.62);
    const y = (v) => pt + (H - pt - pb) * (1 - v / max);
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
    const grid = ticks.map((t) => `<line class="grid-l" x1="${pl}" x2="${W}" y1="${y(t)}" y2="${y(t)}"/><text class="axis-t" x="${pl - 8}" y="${y(t) + 4}" text-anchor="end">${N(t)}</text>`).join('');
    const bars = rows.map((r, i) => {
      const x = pl + i * cw + (cw - bw) / 2; const top = y(r.liters); const h = (H - pb) - top;
      const lbl = period === 'month' ? `Mes ${r.label}` : `Semana del ${r.label}`;
      const path = h > 0 ? `<path class="bar" d="M${x},${H - pb} V${top + Math.min(4, h)} q0,-${Math.min(4, h)} ${Math.min(4, h)},-${Math.min(4, h)} H${x + bw - Math.min(4, h)} q${Math.min(4, h)},0 ${Math.min(4, h)},${Math.min(4, h)} V${H - pb} Z"/>` : '';
      const show = rows.length <= 12 && (i % 2 === (rows.length - 1) % 2);
      return `<g class="col" data-tip="${esc(lbl)}: ${esc(L(r.liters))} · ${r.orders} pedido(s)" data-x="${(x + bw / 2) / W}" data-y="${top / H}">
        ${path}<rect class="hit" x="${pl + i * cw}" y="${pt}" width="${cw}" height="${H - pt}"/>
        ${show ? `<text class="axis-t" x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(r.label)}</text>` : ''}</g>`;
    }).join('');
    return `<div class="vchart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Litros solicitados por ${period === 'month' ? 'mes' : 'semana'}">${grid}${bars}</svg></div>
      <details class="tbl-view"><summary>Ver como tabla</summary><table class="tbl"><thead><tr><th>${period === 'month' ? 'Mes' : 'Semana desde'}</th><th class="r">Pedidos</th><th class="r">Litros</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(r.label)}</td><td class="r num">${N(r.orders)}</td><td class="r num">${L(r.liters)}</td></tr>`).join('')}</tbody></table></details>`;
  }

  function bindChartTips(view) {
    $$('.vchart', view).forEach((c) => {
      let tip = null;
      c.addEventListener('mouseover', (e) => {
        const g = e.target.closest('g.col'); if (!g) return;
        if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; c.appendChild(tip); }
        tip.textContent = g.dataset.tip;
        const svg = c.querySelector('svg').getBoundingClientRect();
        tip.style.left = `${Number(g.dataset.x) * svg.width}px`;
        tip.style.top = `${Number(g.dataset.y) * svg.height}px`;
      });
      c.addEventListener('mouseleave', () => { if (tip) { tip.remove(); tip = null; } });
    });
  }

  // =============== NUEVO PEDIDO ===============
  async function renderNew(view, qs) {
    const editId = qs.get('editar');
    state.pads = await api('GET', '/api/pads');
    let order = null; let perms = null;
    if (editId) {
      const d = await api('GET', `/api/orders/${encodeURIComponent(editId)}`);
      order = d.order; perms = d.permissions;
      if (!perms.edit) { view.innerHTML = `<div class="alert err">${icon('warn')}<p>No tiene permisos para modificar el pedido ${esc(order.order_number)} (estado “${esc(order.status)}”).</p></div>`; return; }
    }
    const pads = state.pads.slice();
    if (order && !pads.some((p) => p.id === order.pad_id)) pads.unshift({ id: order.pad_id, code: `${order.pad_code} (inactivo)`, area: order.pad_area, wells: order.pad_wells });
    const admin = isAdmin();
    const nowLocal = toLocalInput(new Date().toISOString());
    let idemKey = uuid();

    view.innerHTML = `
      <div class="page-h"><h1>${order ? `Modificar pedido ${esc(order.order_number)}` : 'Nuevo Pedido'}</h1>
        <p class="sub">${order ? `Estado actual: ${esc(order.status)}` : 'Complete los datos y envíe la solicitud. La transportista será notificada por correo electrónico.'}</p></div>
      ${order ? '' : mailBanner()}
      <div id="result"></div>
      ${!pads.length ? `<div class="alert warn">${icon('warn')}<p>No hay PAD activos cargados. ${admin ? 'Cárguelos en <a href="#/pads">Administración de PAD</a>.' : 'Solicite a un administrador que los cargue.'}</p></div>` : ''}
      <form class="card form" id="orderForm" novalidate>
        <div class="field"><label for="f-unit">Unidad operativa</label><input class="input" id="f-unit" value="${esc(order ? order.unit : state.meta.unit)}" readonly></div>
        <div class="field"><label for="f-req">Solicitante</label><input class="input" id="f-req" value="${esc(order ? order.requester_name : state.user.full_name)}" readonly></div>
        <div class="field full"><label for="f-pad">PAD / Locación <span class="req">*</span></label>
          <select class="input" id="f-pad" required><option value="">Seleccione el PAD de destino…</option>
          ${pads.map((p) => `<option value="${p.id}" ${order && order.pad_id === p.id ? 'selected' : ''}>${esc(p.code)}${p.area ? ` — ${esc(p.area)}` : ''}</option>`).join('')}</select>
          <div class="pad-info hidden" id="padInfo"></div><div class="err-msg" data-err="pad_id"></div></div>
        <div class="field"><label for="f-lit">Cantidad de combustible solicitada <span class="req">*</span></label>
          <div class="input-suffix"><input class="input num" id="f-lit" inputmode="numeric" autocomplete="off" placeholder="Ej.: 15.000" value="${order ? N(order.liters) : ''}" required><span>litros</span></div>
          <div class="err-msg" data-err="liters"></div></div>
        <div class="field"><label for="f-date">Fecha requerida de entrega <span class="req">*</span></label>
          <input class="input" id="f-date" type="date" min="${state.meta.today}" value="${order ? esc(order.required_date) : ''}" required>
          <div class="hint" id="dateHint">Formato DD/MM/AAAA</div><div class="err-msg" data-err="required_date"></div></div>
        <div class="field"><label for="f-rdate">Fecha de solicitud</label>
          <input class="input" id="f-rdate" type="datetime-local" value="${order ? toLocalInput(order.request_date) : nowLocal}" max="${nowLocal}" ${admin ? '' : 'readonly'}>
          <div class="hint">${admin ? 'Se completa automáticamente; como administrador puede modificarla.' : 'Se completa automáticamente al registrar el pedido.'}</div></div>
        <div class="field full"><label for="f-obs">Observaciones</label>
          <textarea class="input" id="f-obs" maxlength="2000" placeholder="Instrucciones para la transportista, acceso a locación, contacto en campo, horario de descarga…">${esc(order ? order.observations : '')}</textarea></div>
        <div class="form-actions">
          ${order
            ? `<button class="btn primary" type="submit">Guardar cambios</button><a class="btn" href="#/historial">Volver</a>`
            : `<button class="btn primary" type="submit" ${pads.length ? '' : 'disabled'}>${icon('mail')} Enviar solicitud</button>
               <button class="btn" type="button" id="draftBtn" ${pads.length ? '' : 'disabled'}>Guardar borrador</button>
               <span class="spacer"></span><button class="btn" type="reset" id="clearBtn">Limpiar formulario</button>`}
        </div>
      </form>`;

    const form = $('#orderForm');
    const padSel = $('#f-pad'); const lit = $('#f-lit'); const dt = $('#f-date');
    const showPad = () => {
      const p = pads.find((x) => String(x.id) === padSel.value);
      const info = $('#padInfo');
      if (!p) { info.classList.add('hidden'); return; }
      info.textContent = [p.area && `Área / yacimiento: ${p.area}`, p.wells && `Pozos: ${p.wells}`].filter(Boolean).join(' · ') || 'Sin datos adicionales del PAD.';
      info.classList.remove('hidden');
    };
    const showDate = () => { $('#dateHint').textContent = dt.value ? `Entrega requerida: ${fDate(dt.value)}` : 'Formato DD/MM/AAAA'; };
    padSel.addEventListener('change', () => { showPad(); clearErr('pad_id'); });
    dt.addEventListener('change', () => { showDate(); clearErr('required_date'); });
    lit.addEventListener('blur', () => { const v = parseLiters(lit.value); if (Number.isFinite(v) && v > 0 && Number.isInteger(v)) lit.value = N(v); });
    lit.addEventListener('input', () => clearErr('liters'));
    showPad(); showDate();

    function clearErr(k) { const e = $(`[data-err="${k}"]`, form); if (e) e.textContent = ''; const inp = { pad_id: padSel, liters: lit, required_date: dt }[k]; if (inp) inp.classList.remove('bad'); }
    function setErr(k, msg) { const e = $(`[data-err="${k}"]`, form); if (e) e.textContent = msg; const inp = { pad_id: padSel, liters: lit, required_date: dt }[k]; if (inp) inp.classList.add('bad'); }

    function collect() {
      ['pad_id', 'liters', 'required_date'].forEach(clearErr);
      const data = { pad_id: Number(padSel.value) || null, liters: parseLiters(lit.value), required_date: dt.value, observations: $('#f-obs').value.trim() };
      if (admin && $('#f-rdate').value) data.request_date = $('#f-rdate').value;
      let ok = true;
      if (!data.pad_id) { setErr('pad_id', 'Seleccione el PAD / locación de destino.'); ok = false; }
      if (!Number.isFinite(data.liters)) { setErr('liters', 'Ingrese la cantidad en litros.'); ok = false; }
      else if (data.liters <= 0) { setErr('liters', 'La cantidad debe ser mayor que cero.'); ok = false; }
      else if (!Number.isInteger(data.liters)) { setErr('liters', 'Ingrese litros enteros, sin decimales.'); ok = false; }
      else if (data.liters > 1000000) { setErr('liters', 'La cantidad no puede superar 1.000.000 L.'); ok = false; }
      const minDate = (data.request_date || nowLocal).slice(0, 10);
      if (!dt.value) { setErr('required_date', 'Ingrese la fecha requerida de entrega.'); ok = false; }
      else if (dt.value < minDate) { setErr('required_date', 'La fecha requerida no puede ser anterior a la fecha de solicitud.'); ok = false; }
      if (!ok) { const first = $('.input.bad', form); if (first) first.focus(); return null; }
      return data;
    }

    if (!order) {
      $('#clearBtn').addEventListener('click', () => {
        setTimeout(() => { $('#f-unit').value = state.meta.unit; $('#f-req').value = state.user.full_name; $('#f-rdate').value = toLocalInput(new Date().toISOString()); showPad(); showDate(); ['pad_id', 'liters', 'required_date'].forEach(clearErr); $('#result').innerHTML = ''; idemKey = uuid(); });
      });
      $('#draftBtn').addEventListener('click', async (e) => {
        const data = collect(); if (!data) return;
        busy(e.currentTarget, true, 'Guardando…');
        try {
          const r = await api('POST', '/api/orders', { ...data, draft: true, idempotency_key: idemKey });
          idemKey = uuid(); form.reset(); $('#f-unit').value = state.meta.unit; $('#f-req').value = state.user.full_name; showPad(); showDate();
          $('#result').innerHTML = `<div class="alert info">${icon('info')}<p>Borrador <b>${esc(r.order.order_number)}</b> guardado. No se notificó a la transportista. Puede enviarlo desde el <a href="#/historial">Historial de Pedidos</a>.</p></div>`;
          toast(`Borrador ${r.order.order_number} guardado.`, 'ok');
        } catch (err) { toast(err.message, 'err'); } finally { busy(e.currentTarget, false); }
      });
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = collect(); if (!data) return;
      const pad = pads.find((p) => p.id === data.pad_id);
      if (order) return saveEdit(data);
      const m = modal({
        title: 'Confirmar pedido de combustible',
        body: `<p>Verifique los datos antes de enviar. Se registrará el pedido y se notificará por correo a <b>${esc(state.meta.mail.to)}</b>.</p>
          <div class="confirm-sum"><div><div class="l">PAD / Locación</div><div class="v">${esc(pad ? pad.code : '')}</div></div>
          <div><div class="l">Litros solicitados</div><div class="v num">${L(data.liters)}</div></div>
          <div><div class="l">Fecha requerida</div><div class="v">${fDate(data.required_date)}</div></div></div>
          ${data.observations ? `<p class="muted"><b>Observaciones:</b> ${esc(data.observations)}</p>` : ''}`,
        foot: '<button class="btn" data-close>Volver y corregir</button><button class="btn primary" id="cfmBtn">Confirmar y enviar</button>',
      });
      $('#cfmBtn', m.el).addEventListener('click', async (ev) => {
        busy(ev.currentTarget, true, 'Registrando y enviando…');
        try {
          const r = await api('POST', '/api/orders', { ...data, idempotency_key: idemKey });
          m.close();
          idemKey = uuid();
          form.reset(); $('#f-unit').value = state.meta.unit; $('#f-req').value = state.user.full_name; $('#f-rdate').value = toLocalInput(new Date().toISOString()); showPad(); showDate();
          showResult(r);
        } catch (err) { busy(ev.currentTarget, false); toast(err.message, 'err'); }
      });
    });

    async function saveEdit(data) {
      const btn = $('button[type=submit]', form);
      busy(btn, true, 'Guardando…');
      try {
        const r = await api('PUT', `/api/orders/${order.id}`, data);
        if (!r.changed) { toast('No hubo cambios para guardar.'); busy(btn, false); return; }
        toast(`Pedido ${r.order.order_number} modificado.`, 'ok');
        if (r.order.status !== 'Borrador' && r.order.notification_status !== 'Enviado correctamente') {
          toast('Recuerde reenviar el correo a la transportista con los datos actualizados.');
        }
        location.hash = '#/historial';
        setTimeout(() => openDetail(r.order.id), 50);
      } catch (err) { busy(btn, false); toast(err.message, 'err'); }
    }

    function showResult(r) {
      const o = r.order;
      const box = $('#result');
      const okMail = r.email && r.email.ok;
      box.innerHTML = `<div class="alert ok">${icon('ok')}<p><b>Pedido ${esc(o.order_number)} registrado.</b> ${esc(o.pad_code)} · ${L(o.liters)} · entrega requerida ${fDate(o.required_date)}.</p></div>
        ${okMail
          ? `<div class="alert ok">${icon('mail')}<p><b>Correo enviado correctamente</b> a ${esc(state.meta.mail.to)}. Estado del pedido: ${esc(o.status)}.</p></div>`
          : `<div class="alert err">${icon('warn')}<div><p><b>El correo no pudo enviarse.</b> El pedido quedó guardado con estado “Pendiente de notificación”.</p>
             <p class="muted">${esc(r.email ? r.email.error : '')}</p>
             <p><button class="btn sm warn" id="retryBtn">${icon('mail')} Reintentar envío</button> <button class="btn sm" id="seeBtn">Ver pedido</button></p></div></div>`}`;
      toast(`Pedido ${o.order_number} registrado${okMail ? ' y notificado' : ''}.`, okMail ? 'ok' : '');
      if (!okMail) {
        $('#retryBtn').addEventListener('click', async (e) => {
          busy(e.currentTarget, true, 'Reenviando…');
          try { const rr = await api('POST', `/api/orders/${o.id}/resend`); showResult({ order: rr.order, email: rr.email }); } catch (err) { busy(e.currentTarget, false); toast(err.message, 'err'); }
        });
        $('#seeBtn').addEventListener('click', () => openDetail(o.id));
      }
      box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // =============== HISTORIAL ===============
  async function renderHistory(view, qs) {
    const requesters = await api('GET', '/api/requesters');
    const h = state.hist;
    if (qs.get('notif')) { Object.assign(h, { notif: qs.get('notif'), status: '', pend: '' }); }
    if (qs.get('pend')) { Object.assign(h, { pend: '1', notif: '', status: '' }); }
    const opt = (list, cur) => list.map((s) => `<option ${s === cur ? 'selected' : ''}>${esc(s)}</option>`).join('');
    view.innerHTML = `
      <div class="page-h"><h1>Historial de Pedidos</h1><p class="sub">Todos los pedidos registrados, incluidos los cancelados.</p></div>
      <div class="card">
        <form class="filters" id="filters" autocomplete="off">
          <div class="field"><label for="h-q">Buscar por N.º de pedido o PAD</label><input class="input" id="h-q" type="search" placeholder="Ej.: CT-2026-00012 o nombre del PAD" value="${esc(h.q || '')}"></div>
          <div class="field"><label for="h-from">Solicitud desde</label><input class="input" id="h-from" type="date" value="${esc(h.from || '')}"></div>
          <div class="field"><label for="h-to">Solicitud hasta</label><input class="input" id="h-to" type="date" value="${esc(h.to || '')}"></div>
          <div class="field"><label for="h-status">Estado del pedido</label><select class="input" id="h-status"><option value="">Todos</option>
            <option value="__pend" ${h.pend ? 'selected' : ''}>Pendientes de entrega</option>${opt(state.meta.orderStatus, h.status)}</select></div>
          <div class="field"><label for="h-notif">Notificación</label><select class="input" id="h-notif"><option value="">Todas</option>${opt(state.meta.notifStatus, h.notif)}</select></div>
          <div class="field"><label for="h-req">Solicitante</label><select class="input" id="h-req"><option value="">Todos</option>
            ${requesters.map((r) => `<option value="${r.id}" ${String(r.id) === String(h.requester || '') ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div>
        </form>
        <div class="toolbar"><span class="count" id="h-count"></span>
          <button class="btn sm" id="h-clear" type="button">Limpiar filtros</button>
          <a class="btn sm" id="h-export" href="#">${icon('download')} Exportar a Excel (CSV)</a></div>
        <div class="tbl-wrap"><table class="tbl" id="h-table"><thead><tr>
          <th>${sortBtn('numero', 'N.º pedido')}</th><th>${sortBtn('fecha', 'Fecha solicitud')}</th><th>${sortBtn('entrega', 'Fecha requerida')}</th>
          <th>${sortBtn('pad', 'PAD / Locación')}</th><th class="r">${sortBtn('cantidad', 'Litros')}</th><th>Solicitante</th><th>Estado</th><th>Notificación</th></tr></thead>
          <tbody><tr><td colspan="8" class="empty">Cargando…</td></tr></tbody></table></div>
      </div>`;

    function sortBtn(k, label) {
      const on = h.sort === k;
      return `<button type="button" data-sort="${k}" aria-label="Ordenar por ${label}">${label}<span class="arrow ${on ? 'on' : ''}">${on ? (h.dir === 'asc' ? '▲' : '▼') : '↕'}</span></button>`;
    }

    const query = () => {
      const p = new URLSearchParams();
      for (const k of ['q', 'from', 'to', 'notif', 'requester']) if (h[k]) p.set(k, h[k]);
      if (h.status) p.set('status', h.status);
      p.set('sort', h.sort); p.set('dir', h.dir);
      return p;
    };

    let timer = null;
    async function load() {
      const p = query();
      $('#h-export').href = `/api/orders/export.csv?${p}`;
      let rows = await api('GET', `/api/orders?${p}`);
      if (h.pend) rows = rows.filter((o) => o.status === 'Solicitado' || o.status === 'Enviado a transportista');
      const total = rows.reduce((a, o) => a + (o.status === 'Cancelado' || o.status === 'Borrador' ? 0 : o.liters), 0);
      $('#h-count').textContent = `${N(rows.length)} pedido(s) · ${L(total)} activos`;
      $('#h-table tbody').innerHTML = rows.length ? rows.map((o) => `<tr class="click ${o.status === 'Cancelado' ? 'off' : ''}" data-id="${o.id}" tabindex="0">
          <td class="mono">${esc(o.order_number)}</td><td>${fDateTime(o.request_date)}</td><td>${fDate(o.required_date)}</td>
          <td>${esc(o.pad_code)}${o.pad_area ? `<br><span class="muted">${esc(o.pad_area)}</span>` : ''}</td><td class="r num">${L(o.liters)}</td>
          <td>${esc(o.requester_name)}</td><td>${statusBadge(o.status)}</td><td>${notifBadge(o)}</td></tr>`).join('')
        : '<tr><td colspan="8" class="empty">No se encontraron pedidos con los filtros aplicados.</td></tr>';
    }

    const f = $('#filters');
    const sync = () => {
      h.q = $('#h-q').value.trim(); h.from = $('#h-from').value; h.to = $('#h-to').value;
      const st = $('#h-status').value; h.pend = st === '__pend' ? '1' : ''; h.status = st === '__pend' ? '' : st;
      h.notif = $('#h-notif').value; h.requester = $('#h-req').value;
    };
    f.addEventListener('input', (e) => { sync(); clearTimeout(timer); timer = setTimeout(load, e.target.id === 'h-q' ? 250 : 0); });
    f.addEventListener('submit', (e) => e.preventDefault());
    $('#h-clear').addEventListener('click', () => { Object.assign(h, { q: '', from: '', to: '', status: '', notif: '', requester: '', pend: '' }); renderHistory(view, new URLSearchParams()); });
    $('#h-export').addEventListener('click', (e) => { if (h.pend) { e.preventDefault(); toast('Para exportar, filtre por un estado específico (Solicitado o Enviado a transportista).'); } });
    $('#h-table thead').addEventListener('click', (e) => {
      const b = e.target.closest('[data-sort]'); if (!b) return;
      if (h.sort === b.dataset.sort) h.dir = h.dir === 'asc' ? 'desc' : 'asc'; else { h.sort = b.dataset.sort; h.dir = b.dataset.sort === 'pad' ? 'asc' : 'desc'; }
      $$('[data-sort]', view).forEach((x) => { x.outerHTML = sortBtn(x.dataset.sort, x.firstChild.textContent); });
      load();
    });
    const tbody = $('#h-table tbody');
    tbody.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) openDetail(tr.dataset.id, load); });
    tbody.addEventListener('keydown', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDetail(tr.dataset.id, load); } });
    await load();
  }

  // =============== DETALLE ===============
  const ACTION_LABEL = {
    creacion: 'Pedido creado y solicitado', creacion_borrador: 'Borrador creado', modificacion: 'Pedido modificado', cancelacion: 'Pedido cancelado',
    cambio_estado: 'Cambio de estado', envio_notificacion: 'Notificación por correo', reintento_notificacion: 'Reintento de notificación', reenvio_notificacion: 'Reenvío de notificación',
  };
  function eventDetail(ev) {
    let d = {}; try { d = JSON.parse(ev.details || '{}'); } catch { /* ignorar */ }
    if (ev.action === 'cambio_estado' || ev.action === 'cancelacion') return `${esc(d.de)} → ${esc(d.a)}${d.motivo ? ` · Motivo: ${esc(d.motivo)}` : ''}`;
    if (ev.action.includes('notificacion')) return d.resultado === 'enviado' ? `Enviado a ${esc((d.destinatarios || []).join(', '))}` : `Error: ${esc(d.error)}`;
    if (ev.action === 'modificacion') {
      const fmtv = (k, v) => (k === 'litros' ? L(v) : k === 'fecha_requerida' ? fDate(v) : k === 'fecha_solicitud' ? fDateTime(v) : v || '—');
      return Object.entries(d).map(([k, [a, b]]) => `${esc(k.replace('_', ' '))}: ${esc(fmtv(k, a))} → ${esc(fmtv(k, b))}`).join(' · ');
    }
    if (ev.action.startsWith('creacion')) return `${esc(d.pad)} · ${L(d.litros)} · entrega ${fDate(d.fecha_requerida)}`;
    return '';
  }

  async function openDetail(id, onChange) {
    let d;
    try { d = await api('GET', `/api/orders/${encodeURIComponent(id)}`); } catch (e) { toast(e.message, 'err'); return; }
    const o = d.order; const p = d.permissions;
    const notifAlert = o.status === 'Borrador' ? `<div class="alert info">${icon('info')}<p>Borrador: todavía no se notificó a la transportista.</p></div>`
      : o.notification_status === 'Error de envío' ? `<div class="alert err">${icon('warn')}<p><b>Pendiente de notificación.</b> El último intento de envío falló. Use “Reintentar envío”; no se generará un pedido nuevo.</p></div>`
        : o.notification_status === 'Pendiente de envío' && o.status !== 'Cancelado' ? `<div class="alert warn">${icon('warn')}<p>El pedido fue modificado o aún no se notificó. Reenvíe el correo para informar a la transportista.</p></div>` : '';
    const body = `${notifAlert}
      <dl class="kv">
        <dt>Número de pedido</dt><dd class="mono">${esc(o.order_number)}</dd>
        <dt>Unidad operativa</dt><dd>${esc(o.unit)}</dd>
        <dt>PAD / Locación</dt><dd><b>${esc(o.pad_code)}</b>${o.pad_area ? ` — ${esc(o.pad_area)}` : ''}</dd>
        <dt>Pozos asociados</dt><dd>${esc(o.pad_wells || '—')}</dd>
        <dt>Cantidad solicitada</dt><dd class="num"><b>${L(o.liters)}</b></dd>
        <dt>Fecha y hora de solicitud</dt><dd>${fDateTime(o.request_date)}</dd>
        <dt>Fecha requerida de entrega</dt><dd><b>${fDate(o.required_date)}</b></dd>
        <dt>Solicitante</dt><dd>${esc(o.requester_name)}</dd>
        <dt>Observaciones</dt><dd>${esc(o.observations || '—')}</dd>
        <dt>Estado del pedido</dt><dd>${statusBadge(o.status)}${o.cancel_reason ? ` <span class="muted">Motivo: ${esc(o.cancel_reason)}</span>` : ''}</dd>
        <dt>Notificación por correo</dt><dd>${notifBadge(o)} <span class="muted">${esc(notifLabel(o))}</span></dd>
      </dl>
      <div class="section-t">Intentos de notificación (${d.notifications.length})</div>
      ${d.notifications.length ? `<ul class="timeline">${d.notifications.map((n) => `<li class="${n.success ? 'ok' : 'err'}"><b>${n.success ? 'Enviado correctamente' : 'Error de envío'}</b>
        <span class="when">· ${fDateTime(n.attempted_at)} · ${esc(n.triggered_by_name || '')}</span><div class="det">Para: ${esc(n.recipients)}<br>Asunto: ${esc(n.subject)}${n.error ? `<br>Error: ${esc(n.error)}` : ''}</div></li>`).join('')}</ul>` : '<p class="muted">Sin intentos de envío.</p>'}
      <div class="section-t">Registro de eventos</div>
      <ul class="timeline">${d.events.map((ev) => `<li><b>${esc(ACTION_LABEL[ev.action] || ev.action)}</b> <span class="when">· ${fDateTime(ev.at)} · ${esc(ev.user_name || '')}</span><div class="det">${eventDetail(ev)}</div></li>`).join('')}</ul>`;
    const foot = [
      p.submit && '<button class="btn primary" data-act="submit">Enviar solicitud</button>',
      p.resend && `<button class="btn ${o.notification_status === 'Enviado correctamente' ? '' : 'warn'}" data-act="resend">${icon('mail')} ${o.notification_status === 'Enviado correctamente' ? 'Reenviar correo' : 'Reintentar envío'}</button>`,
      p.markSent && '<button class="btn" data-act="sent">Marcar enviado a transportista</button>',
      p.deliver && '<button class="btn ok" data-act="deliver">Marcar entregado</button>',
      p.edit && '<button class="btn" data-act="edit">Modificar</button>',
      p.cancel && '<button class="btn danger" data-act="cancel">Cancelar pedido</button>',
      '<button class="btn" data-close>Cerrar</button>',
    ].filter(Boolean).join('');
    const m = modal({ title: `Pedido ${esc(o.order_number)}`, body, foot, wide: true });
    const refresh = () => { m.close(); if (onChange) onChange(); openDetail(id, onChange); };
    m.el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const act = b.dataset.act;
      try {
        if (act === 'edit') { m.close(); location.hash = `#/nuevo?editar=${o.id}`; return; }
        if (act === 'cancel') return askCancel(o, refresh);
        if (act === 'deliver' && !confirm(`¿Confirma que el pedido ${o.order_number} (${L(o.liters)} en ${o.pad_code}) fue ENTREGADO en locación?`)) return;
        busy(b, true);
        if (act === 'submit' || act === 'resend') {
          const r = await api('POST', `/api/orders/${o.id}/${act}`);
          r.email.ok ? toast('Correo enviado correctamente.', 'ok') : toast(`Error de envío: ${r.email.error}`, 'err');
        } else {
          const status = act === 'deliver' ? 'Entregado' : 'Enviado a transportista';
          await api('POST', `/api/orders/${o.id}/status`, { status });
          toast(`Pedido ${o.order_number}: ${status}.`, 'ok');
        }
        refresh();
      } catch (err) { busy(b, false); toast(err.message, 'err'); }
    });
  }

  function askCancel(o, done) {
    const m = modal({
      title: `Cancelar pedido ${esc(o.order_number)}`,
      body: `<p>El pedido se conservará en el historial con estado “Cancelado”.${o.status === 'Enviado a transportista' ? ' <b>La transportista ya fue notificada:</b> comuníquele la cancelación.' : ''}</p>
        <div class="field"><label for="c-reason">Motivo de la cancelación <span class="req">*</span></label><textarea class="input" id="c-reason" maxlength="500" autofocus></textarea></div>`,
      foot: '<button class="btn" data-close>Volver</button><button class="btn danger" id="c-ok">Cancelar pedido</button>',
    });
    $('#c-reason', m.el).focus();
    $('#c-ok', m.el).addEventListener('click', async (e) => {
      const reason = $('#c-reason', m.el).value.trim();
      if (!reason) { $('#c-reason', m.el).classList.add('bad'); return; }
      busy(e.currentTarget, true);
      try { await api('POST', `/api/orders/${o.id}/status`, { status: 'Cancelado', reason }); m.close(); toast(`Pedido ${o.order_number} cancelado.`, 'ok'); done(); } catch (err) { busy(e.currentTarget, false); toast(err.message, 'err'); }
    });
  }

  // =============== PAD ===============
  async function renderPads(view) {
    const pads = await api('GET', '/api/pads?all=1');
    view.innerHTML = `
      <div class="page-h"><h1>Administración de PAD</h1><button class="btn primary" id="padNew">${icon('plus')} Nuevo PAD</button>
        <p class="sub">Solo los PAD activos aparecen en el formulario de nuevos pedidos. Los pedidos históricos conservan el nombre del PAD al momento de la solicitud.</p></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>PAD / Código</th><th>Área / Yacimiento</th><th>Pozos asociados</th><th class="r">Pedidos</th><th>Estado</th><th></th></tr></thead><tbody>
      ${pads.length ? pads.map((p) => `<tr class="${p.active ? '' : 'off'}"><td><b>${esc(p.code)}</b></td><td>${esc(p.area || '—')}</td><td>${esc(p.wells || '—')}</td><td class="r num">${N(p.orders_count)}</td>
        <td>${p.active ? '<span class="badge b-entregado">Activo</span>' : '<span class="badge b-borrador">Inactivo</span>'}</td>
        <td class="r"><div class="actions"><button class="btn sm" data-edit="${p.id}">Modificar</button><button class="btn sm ${p.active ? 'warn' : 'ok'}" data-toggle="${p.id}">${p.active ? 'Desactivar' : 'Activar'}</button></div></td></tr>`).join('')
        : '<tr><td colspan="6" class="empty">No hay PAD cargados. Use “Nuevo PAD” para cargar los PAD reales de la operación.</td></tr>'}
      </tbody></table></div>`;
    $('#padNew').addEventListener('click', () => padForm(null, () => renderPads(view)));
    $$('[data-edit]', view).forEach((b) => b.addEventListener('click', () => padForm(pads.find((p) => p.id === Number(b.dataset.edit)), () => renderPads(view))));
    $$('[data-toggle]', view).forEach((b) => b.addEventListener('click', async () => {
      const p = pads.find((x) => x.id === Number(b.dataset.toggle));
      busy(b, true);
      try { await api('PUT', `/api/pads/${p.id}`, { active: !p.active }); toast(`${p.code} ${p.active ? 'desactivado' : 'activado'}.`, 'ok'); renderPads(view); } catch (e) { busy(b, false); toast(e.message, 'err'); }
    }));
  }

  function padForm(p, done) {
    const m = modal({
      title: p ? `Modificar PAD ${esc(p.code)}` : 'Nuevo PAD',
      body: `<form class="form" id="padF" novalidate>
        <div class="field full"><label for="p-code">Nombre o código del PAD <span class="req">*</span></label><input class="input" id="p-code" maxlength="80" value="${esc(p ? p.code : '')}" autofocus></div>
        <div class="field full"><label for="p-area">Área / Yacimiento</label><input class="input" id="p-area" maxlength="120" value="${esc(p ? p.area : '')}"></div>
        <div class="field full"><label for="p-wells">Pozos asociados</label><textarea class="input" id="p-wells" maxlength="500" placeholder="Identificación de los pozos, separados por coma">${esc(p ? p.wells : '')}</textarea></div>
        <div class="field full"><label><input type="checkbox" id="p-active" ${!p || p.active ? 'checked' : ''}> Activo (disponible para nuevos pedidos)</label></div>
        ${p && p.orders_count ? `<div class="field full"><div class="hint">Este PAD tiene ${N(p.orders_count)} pedido(s). Los cambios no alteran los datos registrados en esos pedidos.</div></div>` : ''}
        </form>`,
      foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="p-save">Guardar</button>',
    });
    $('#p-code', m.el).focus();
    const save = async () => {
      const body = { code: $('#p-code', m.el).value.trim(), area: $('#p-area', m.el).value.trim(), wells: $('#p-wells', m.el).value.trim(), active: $('#p-active', m.el).checked };
      if (!body.code) { $('#p-code', m.el).classList.add('bad'); $('#p-code', m.el).focus(); return; }
      const b = $('#p-save', m.el); busy(b, true);
      try { await api(p ? 'PUT' : 'POST', p ? `/api/pads/${p.id}` : '/api/pads', body); m.close(); toast(`${body.code} guardado.`, 'ok'); done(); } catch (e) { busy(b, false); toast(e.message, 'err'); }
    };
    $('#p-save', m.el).addEventListener('click', save);
    $('#padF', m.el).addEventListener('submit', (e) => { e.preventDefault(); save(); });
  }

  // =============== USUARIOS ===============
  async function renderUsers(view) {
    const users = await api('GET', '/api/users');
    view.innerHTML = `
      <div class="page-h"><h1>Usuarios</h1><button class="btn primary" id="uNew">${icon('plus')} Nuevo usuario</button>
        <p class="sub">Operador: genera pedidos y consulta el historial. Administrador: además gestiona PAD, usuarios y configuración.</p></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Nombre</th><th>Usuario</th><th>Correo</th><th>Perfil</th><th>Estado</th><th></th></tr></thead><tbody>
      ${users.map((u) => `<tr class="${u.active ? '' : 'off'}"><td><b>${esc(u.full_name)}</b></td><td>${esc(u.username)}</td><td>${esc(u.email || '—')}</td>
        <td>${u.role === 'administrador' ? 'Administrador' : 'Operador'}</td><td>${u.active ? '<span class="badge b-entregado">Activo</span>' : '<span class="badge b-borrador">Inactivo</span>'}</td>
        <td class="r"><button class="btn sm" data-edit="${u.id}">Modificar</button></td></tr>`).join('')}</tbody></table></div>`;
    $('#uNew').addEventListener('click', () => userForm(null, () => renderUsers(view)));
    $$('[data-edit]', view).forEach((b) => b.addEventListener('click', () => userForm(users.find((u) => u.id === Number(b.dataset.edit)), () => renderUsers(view))));
  }

  function userForm(u, done) {
    const m = modal({
      title: u ? `Modificar usuario ${esc(u.username)}` : 'Nuevo usuario',
      body: `<form class="form" id="uF" novalidate autocomplete="off">
        <div class="field"><label for="u-name">Nombre completo <span class="req">*</span></label><input class="input" id="u-name" value="${esc(u ? u.full_name : '')}"></div>
        <div class="field"><label for="u-user">Usuario <span class="req">*</span></label><input class="input" id="u-user" value="${esc(u ? u.username : '')}" autocomplete="off"></div>
        <div class="field"><label for="u-mail">Correo electrónico</label><input class="input" id="u-mail" type="email" value="${esc(u ? u.email : '')}"></div>
        <div class="field"><label for="u-role">Perfil</label><select class="input" id="u-role"><option value="operador">Operador</option><option value="administrador" ${u && u.role === 'administrador' ? 'selected' : ''}>Administrador</option></select></div>
        <div class="field full"><label for="u-pw">${u ? 'Nueva contraseña (dejar vacío para no cambiarla)' : 'Contraseña inicial <span class="req">*</span>'}</label><input class="input" id="u-pw" type="password" autocomplete="new-password" minlength="10"><div class="hint">Mínimo 10 caracteres. Comuníquela al usuario por un canal seguro.</div></div>
        <div class="field full"><label><input type="checkbox" id="u-active" ${!u || u.active ? 'checked' : ''}> Usuario activo</label></div>
      </form>`,
      foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="u-save">Guardar</button>',
    });
    $('#u-name', m.el).focus();
    $('#u-save', m.el).addEventListener('click', async (e) => {
      const body = { full_name: $('#u-name', m.el).value.trim(), username: $('#u-user', m.el).value.trim(), email: $('#u-mail', m.el).value.trim(), role: $('#u-role', m.el).value, active: $('#u-active', m.el).checked };
      const pw = $('#u-pw', m.el).value; if (pw) body.password = pw;
      busy(e.currentTarget, true);
      try { await api(u ? 'PUT' : 'POST', u ? `/api/users/${u.id}` : '/api/users', body); m.close(); toast('Usuario guardado.', 'ok'); done(); } catch (err) { busy(e.currentTarget, false); toast(err.message, 'err'); }
    });
  }

  function changePassword() {
    const m = modal({
      title: 'Cambiar contraseña',
      body: `<div class="form"><div class="field full"><label for="pw-c">Contraseña actual</label><input class="input" id="pw-c" type="password" autocomplete="current-password"></div>
        <div class="field full"><label for="pw-n">Nueva contraseña</label><input class="input" id="pw-n" type="password" autocomplete="new-password"><div class="hint">Mínimo 10 caracteres.</div></div></div>`,
      foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pw-ok">Guardar</button>',
    });
    $('#pw-c', m.el).focus();
    $('#pw-ok', m.el).addEventListener('click', async (e) => {
      busy(e.currentTarget, true);
      try { await api('POST', '/api/me/password', { current: $('#pw-c', m.el).value, next: $('#pw-n', m.el).value }); m.close(); toast('Contraseña actualizada.', 'ok'); } catch (err) { busy(e.currentTarget, false); toast(err.message, 'err'); }
    });
  }

  // =============== CONFIGURACIÓN ===============
  async function renderConfig(view) {
    const { settings, mail } = await api('GET', '/api/settings');
    view.innerHTML = `
      <div class="page-h"><h1>Configuración</h1><p class="sub">Parámetros de notificación. Las credenciales del servidor de correo se configuran solo en el servidor (archivo .env), nunca en esta pantalla.</p></div>
      <div class="grid">
        <section class="card"><h2>Estado del servicio de correo</h2>
          ${mail.configured ? `<div class="alert ok">${icon('ok')}<p>Proveedor <b>${esc(mail.provider.toUpperCase())}</b> configurado en el servidor. Use “Enviar correo de prueba” para verificar la conexión.</p></div>`
            : `<div class="alert warn">${icon('warn')}<div><p><b>Correo no configurado.</b> Proveedor seleccionado: ${esc(mail.provider)}. Faltan: ${esc(mail.missing.join(', '))}.</p><p>Complete esas variables en el archivo <code>.env</code> del servidor y reinicie la aplicación (ver README, sección “Configuración del correo”).</p></div></div>`}
          <div class="actions"><button class="btn" id="testBtn">${icon('mail')} Enviar correo de prueba</button></div><div id="testRes"></div>
        </section>
        <section class="card"><h2>Destinatarios de los pedidos</h2>
          <form class="form" id="setF" novalidate>
            <div class="field full"><label for="s-to">Destinatario(s) principal(es) <span class="req">*</span></label><input class="input" id="s-to" value="${esc(settings.mail_to)}"><div class="hint">Separe varias direcciones con punto y coma (;).</div></div>
            <div class="field full"><label for="s-cc">Con copia (CC)</label><input class="input" id="s-cc" value="${esc(settings.mail_cc)}"></div>
            <div class="form-actions"><button class="btn primary" type="submit">Guardar configuración</button></div>
          </form></section>
      </div>`;
    $('#setF').addEventListener('submit', async (e) => {
      e.preventDefault();
      const b = $('button[type=submit]', e.target); busy(b, true);
      try { await api('PUT', '/api/settings', { mail_to: $('#s-to').value, mail_cc: $('#s-cc').value }); state.meta = await api('GET', '/api/meta'); toast('Configuración guardada.', 'ok'); } catch (err) { toast(err.message, 'err'); } finally { busy(b, false); }
    });
    $('#testBtn').addEventListener('click', async (e) => {
      busy(e.currentTarget, true, 'Enviando…');
      try {
        const r = await api('POST', '/api/settings/test-mail', {});
        $('#testRes').innerHTML = r.ok ? `<div class="alert ok">${icon('ok')}<p>Correo de prueba enviado a ${esc(settings.mail_to)}.</p></div>` : `<div class="alert err">${icon('warn')}<p>${esc(r.error)}</p></div>`;
      } catch (err) { toast(err.message, 'err'); } finally { busy(e.currentTarget, false); }
    });
  }

  // =============== AUDITORÍA ===============
  async function renderAudit(view) {
    const rows = await api('GET', '/api/audit?limit=500');
    view.innerHTML = `<div class="page-h"><h1>Auditoría</h1><p class="sub">Últimas 500 acciones registradas (creación, modificación, cancelación, notificaciones, PAD, usuarios y configuración).</p></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Fecha y hora</th><th>Usuario</th><th>Acción</th><th>Entidad</th><th>Detalle</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${fDateTime(r.at)}</td><td>${esc(r.user_name || '')}</td><td>${esc(ACTION_LABEL[r.action] || r.action.replace(/_/g, ' '))}</td><td>${esc(r.entity)}${r.entity_id ? ` #${r.entity_id}` : ''}</td>
        <td class="muted">${r.entity === 'pedido' ? eventDetail(r) : esc(r.details === '{}' ? '' : r.details)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Sin registros.</td></tr>'}</tbody></table></div>`;
  }

  boot();
})();
