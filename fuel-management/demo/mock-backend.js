/* DEMO de Fuel Management | Frac Operations — servidor simulado dentro del navegador.
   Intercepta las llamadas de la aplicación a Supabase y aplica las mismas reglas que la base de datos real
   (permisos por rol, validaciones y cálculos). No hay base de datos real y NO se envían correos.
   Los datos se guardan solo en este navegador. */
(() => {
  'use strict';
  const BASE = 'https://demo.supabase.local';
  const KEY = 'fuel-demo-v1';
  const CATALOG = window.__DEMO_CATALOG__ || { pads: [], wells: [] };
  const TZ = 'America/Argentina/Buenos_Aires';
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => ((Math.random() * 16) | 0).toString(16)));
  const now = () => new Date().toISOString();
  const ago = (days, hours = 0) => new Date(Date.now() - days * 864e5 - hours * 3600e3).toISOString();
  const localDay = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso));
  const fmtL = (n) => `${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(Number(n))} L`;
  const fmtD = (d) => d.split('-').reverse().join('/');

  class DbError extends Error {
    constructor(status, code, message) { super(message); this.status = status; this.code = code; }
  }
  const deny = () => new DbError(403, '42501', 'new row violates row-level security policy');
  const check = (cond, message, code = '23514') => { if (!cond) throw new DbError(400, code, message); };

  // ------------------------------------------------------------------ datos
  let db;
  const USERS = [
    ['admin@demo.test', 'Administrador (demo)', 'administrador'],
    ['logistica@demo.test', 'Logística (demo)', 'logistica'],
    ['operaciones@demo.test', 'Operaciones (demo)', 'operaciones'],
    ['supervision@demo.test', 'Supervisión (demo)', 'supervision'],
  ];

  function seed() {
    db = {
      seq: {}, auditId: 1, users: [], profiles: [], pads: [], wells: [], fracture_stages: [], fuel_orders: [], fuel_deliveries: [],
      fuel_consumption: [], inventory_movements: [], audit_logs: [], import_logs: [], email_dispatches: [], ms_links: {},
      app_settings: [
        { key: 'order_recipient', value: 'mperez5@pan-energy.com', description: 'Destinatario de las solicitudes de combustible' },
        { key: 'email_sending_enabled', value: 'false', description: 'Envío de pedidos desde Outlook habilitado' },
      ],
    };
    const created = ago(30);
    for (const [email, name, role] of USERS) {
      const id = uuid();
      db.users.push({ id, email, password: 'prueba' });
      db.profiles.push({ id, email, full_name: name, role, active: true, approved_by: null, approved_at: created, created_at: created, updated_at: created });
    }
    const pending = uuid();
    db.users.push({ id: pending, email: 'solicitud@demo.test', password: 'prueba' });
    db.profiles.push({ id: pending, email: 'solicitud@demo.test', full_name: 'Solicitud de acceso (demo)', role: null, active: false, approved_by: null, approved_at: null, created_at: ago(0, 3), updated_at: ago(0, 3) });
    const admin = db.profiles[0].id;
    for (const p of CATALOG.pads) db.pads.push({ id: uuid(), code: p, name: p, area: null, active: true, created_at: created, updated_at: created, created_by: null, updated_by: null });
    const padId = new Map(db.pads.map((p) => [p.code, p.id]));
    for (const [pad, w] of CATALOG.wells) db.wells.push({ id: uuid(), pad_id: padId.get(pad), code: w, name: w, planned_stages: null, operational_status: null, active: true, created_at: created, updated_at: created, created_by: null, updated_by: null });
    db.ms_links[db.profiles[1].id] = { ms_email: 'logistica@demo.test', linked_at: ago(2) };
    db.ms_links[admin] = { ms_email: 'admin@demo.test', linked_at: ago(2) };
    exampleData();
  }

  /** Datos de ejemplo, claramente marcados como prueba, para que los indicadores no estén vacíos. */
  function exampleData() {
    const [admin, log, ops] = db.profiles;
    const as = (u, fn) => { const prev = current; current = u; try { fn(); } finally { current = prev; } };
    const pad = (c) => db.pads.find((p) => p.code === c);
    const well = (c) => db.wells.find((w) => w.code === c);
    const A = pad('LA-WP130'); const B = pad('CASE-WP007');
    as(log, () => {
      ins('inventory_movements', { movement_type: 'stock_inicial', pad_id: A.id, liters: 20000, occurred_at: ago(21), reason: '' });
      const o1 = ins('fuel_orders', { pad_id: A.id, trips: 2, required_date: localDay(ago(19)), status: 'solicitado', notes: 'Pedido de ejemplo (demo)' });
      o1.created_at = ago(20);
      ins('fuel_deliveries', { order_id: o1.id, delivered_at: ago(19), liters: 43000, document_number: 'R-0001-000101', carrier: 'Transportista (demo)', notes: '' });
      ins('fuel_deliveries', { order_id: o1.id, delivered_at: ago(18), liters: 43000, document_number: 'R-0001-000102', carrier: 'Transportista (demo)', notes: '' });
      const o2 = ins('fuel_orders', { pad_id: B.id, trips: 3, required_date: localDay(ago(-1)), status: 'solicitado', notes: 'Acceso por picada norte (demo)' });
      o2.created_at = ago(3);
      ins('fuel_deliveries', { order_id: o2.id, delivered_at: ago(1), liters: 43000, document_number: 'R-0001-000140', carrier: 'Transportista (demo)', notes: '' });
      const o3 = ins('fuel_orders', { pad_id: A.id, trips: 1, required_date: localDay(ago(-2)), status: 'solicitado', notes: '' });
      o3.created_at = ago(0, 4);
    });
    as(ops, () => {
      const w750 = well('LA-750(h)'); const w752 = well('LA-752(h)');
      rpc('plan_stages', { p_well_id: w750.id, p_count: 6, p_planned_date: localDay(ago(16)) });
      rpc('plan_stages', { p_well_id: w752.id, p_count: 4, p_planned_date: localDay(ago(10)) });
      [[w750, 1, 15, 13425], [w750, 2, 12, 12575], [w750, 3, 6, 14100], [w752, 1, 9, 13900]].forEach(([w, n, d, l]) =>
        rpc('register_stage_consumption', { p_well_id: w.id, p_stage_number: n, p_executed_at: ago(d), p_liters: l, p_notes: '' }));
      ins('inventory_movements', { movement_type: 'verificacion_fisica', pad_id: A.id, liters: 52600, occurred_at: ago(0, 6), reason: 'Medición de tanques (demo)' });
    });
    as(log, () => ins('inventory_movements', { movement_type: 'transferencia', pad_id: A.id, to_pad_id: B.id, liters: 5000, occurred_at: ago(4), reason: 'Traslado con el set (demo)' }));
    void admin;
  }

  function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* sin almacenamiento */ } }
  function load() {
    try { const raw = localStorage.getItem(KEY); if (raw) { db = JSON.parse(raw); return; } } catch { /* sin almacenamiento */ }
    current = null; seed(); save();
  }

  // ------------------------------------------------------------------ sesión y permisos
  let current = null; // perfil de quien hace la llamada
  const profileOf = (id) => db.profiles.find((p) => p.id === id) || null;
  const role = () => (current && current.active ? current.role : null);
  const has = (...r) => r.includes(role());
  const nameOf = (id) => (profileOf(id) || {}).full_name || null;

  function audit(table, row, action, oldRow) {
    db.audit_logs.push({ id: db.auditId++, table_name: table, record_id: row.id || null, action, old_data: oldRow || null, new_data: action === 'delete' ? null : { ...row }, changed_by: current ? current.id : null, changed_at: now() });
  }

  // ------------------------------------------------------------------ reglas por tabla (espejo de supabase/migrations)
  const WRITE = {
    pads: () => has('administrador'), wells: () => has('administrador'),
    fracture_stages: () => has('administrador', 'operaciones'), fuel_consumption: () => has('administrador', 'operaciones'),
    fuel_orders: () => has('administrador', 'logistica'), fuel_deliveries: () => has('administrador', 'logistica'),
    app_settings: () => has('administrador'),
  };
  const ciEq = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

  function nextOrderNumber() {
    const y = new Date().getFullYear();
    db.seq[y] = (db.seq[y] || 0) + 1;
    return `PC-${y}-${String(db.seq[y]).padStart(5, '0')}`;
  }

  function refreshOrderStatus(orderId) {
    const o = db.fuel_orders.find((x) => x.id === orderId);
    if (!o || ['borrador', 'cancelado'].includes(o.status)) return;
    const delivered = db.fuel_deliveries.filter((d) => d.order_id === o.id).reduce((s, d) => s + Number(d.liters), 0);
    const target = delivered >= o.requested_liters ? 'entregado' : delivered > 0 ? 'entregado_parcial' : ['entregado', 'entregado_parcial'].includes(o.status) ? 'enviado' : o.status;
    if (target !== o.status) { const old = { ...o }; o.status = target; o.updated_at = now(); audit('fuel_orders', o, 'update', old); }
  }

  function ins(table, body) {
    const t = now();
    if (table === 'inventory_movements') {
      const ok = has('administrador', 'logistica') || (body.movement_type === 'verificacion_fisica' && has('operaciones'));
      if (!ok) throw deny();
    } else if (!WRITE[table] || !WRITE[table]()) throw deny();
    let row;
    if (table === 'pads') {
      const code = String(body.code || '');
      check(code === code.trim() && code.length >= 1 && code.length <= 60, 'new row for relation "pads" violates check constraint "pads_code_formato"');
      if (db.pads.some((p) => ciEq(p.code, code))) throw new DbError(409, '23505', 'duplicate key value violates unique constraint "pads_code_unico"');
      row = { id: uuid(), code, name: String(body.name || code).trim(), area: body.area ?? null, active: body.active !== false, created_at: t, updated_at: t, created_by: current.id, updated_by: null };
    } else if (table === 'wells') {
      const code = String(body.code || '');
      check(code === code.trim() && code.length >= 1 && code.length <= 60, 'new row for relation "wells" violates check constraint "wells_code_formato"');
      check(db.pads.some((p) => p.id === body.pad_id), 'insert or update on table "wells" violates foreign key constraint', '23503');
      if (db.wells.some((w) => ciEq(w.code, code))) throw new DbError(409, '23505', 'duplicate key value violates unique constraint "wells_code_unico"');
      row = { id: uuid(), pad_id: body.pad_id, code, name: String(body.name || code).trim(), planned_stages: body.planned_stages ?? null, operational_status: body.operational_status ?? null, active: body.active !== false, created_at: t, updated_at: t, created_by: current.id, updated_by: null };
    } else if (table === 'fracture_stages') {
      const w = db.wells.find((x) => x.id === body.well_id); const p = w && db.pads.find((x) => x.id === w.pad_id);
      if (!w || !w.active || !p.active) throw new DbError(400, '23514', 'El pozo o su PAD están inactivos: no admiten etapas nuevas.');
      check(Number.isInteger(body.stage_number) && body.stage_number >= 1 && body.stage_number <= 200, 'stages_numero_valido');
      if (db.fracture_stages.some((s) => s.well_id === w.id && s.stage_number === body.stage_number)) throw new DbError(409, '23505', 'duplicate key value violates unique constraint "stages_unica_por_pozo"');
      const status = body.status || 'planificada';
      check(status !== 'realizada' || body.executed_at, 'new row violates check constraint "stages_realizada_con_fecha"');
      row = { id: uuid(), well_id: w.id, stage_number: body.stage_number, status, planned_date: body.planned_date || null, executed_at: body.executed_at || null, notes: body.notes || '', created_at: t, updated_at: t, created_by: current.id, updated_by: null };
    } else if (table === 'fuel_consumption') {
      const s = db.fracture_stages.find((x) => x.id === body.stage_id);
      if (!s || s.status !== 'realizada') throw new DbError(400, '23514', `Solo se puede registrar consumo en etapas realizadas (estado actual: ${s ? s.status : 'inexistente'}).`);
      if (db.fuel_consumption.some((c) => c.stage_id === s.id)) throw new DbError(409, '23505', 'duplicate key value violates unique constraint "fuel_consumption_stage_id_key"');
      check(Number(body.liters) > 0, 'new row violates check constraint "consumption_litros_positivos"');
      row = { id: uuid(), stage_id: s.id, liters: Number(body.liters), notes: body.notes || '', recorded_by: current.id, created_at: t, updated_at: t, updated_by: null };
    } else if (table === 'fuel_orders') {
      const p = db.pads.find((x) => x.id === body.pad_id);
      if (!p || !p.active) throw new DbError(400, '23514', 'El PAD seleccionado está inactivo y no admite pedidos nuevos.');
      check(Number.isInteger(body.trips) && body.trips >= 1 && body.trips <= 100, 'new row violates check constraint "orders_viajes_validos"');
      const status = body.status || 'borrador';
      if (!['borrador', 'solicitado'].includes(status)) throw new DbError(400, '23514', 'Un pedido nuevo solo puede crearse como borrador o solicitado.');
      row = { id: uuid(), order_number: nextOrderNumber(), pad_id: p.id, trips: body.trips, trip_capacity_liters: 43000, requested_liters: body.trips * 43000,
        required_date: body.required_date, status, notification_status: 'no_enviado', notes: body.notes || '', cancel_reason: '', requested_by: current.id, created_at: t, updated_at: t, updated_by: null };
    } else if (table === 'fuel_deliveries') {
      const o = db.fuel_orders.find((x) => x.id === body.order_id);
      if (!o || ['borrador', 'cancelado'].includes(o.status)) throw new DbError(400, '23514', `No se pueden registrar entregas sobre un pedido en estado ${o ? o.status : 'inexistente'}.`);
      check(Number(body.liters) > 0, 'new row violates check constraint "deliveries_litros_positivos"');
      const doc = String(body.document_number || '').trim();
      check(doc.length > 0, 'deliveries_remito_no_vacio');
      if (db.fuel_deliveries.some((d) => ciEq(d.document_number.trim(), doc))) throw new DbError(409, '23505', 'duplicate key value violates unique constraint "fuel_deliveries_remito_unico"');
      row = { id: uuid(), order_id: o.id, delivered_at: body.delivered_at, liters: Number(body.liters), document_number: body.document_number, carrier: body.carrier || '', notes: body.notes || '', received_by: current.id, created_at: t, updated_at: t, updated_by: null };
    } else if (table === 'inventory_movements') {
      const type = body.movement_type;
      check(type === 'verificacion_fisica' ? Number(body.liters) >= 0 : Number(body.liters) > 0, 'new row violates check constraint "movements_litros"');
      check(type === 'transferencia' ? body.to_pad_id && body.to_pad_id !== body.pad_id : !body.to_pad_id, 'new row violates check constraint "movements_transferencia"');
      check(['stock_inicial', 'verificacion_fisica'].includes(type) || String(body.reason || '').trim(), 'new row violates check constraint "movements_motivo"');
      if (type === 'stock_inicial' && db.inventory_movements.some((m) => m.movement_type === 'stock_inicial' && m.pad_id === body.pad_id)) {
        throw new DbError(409, '23505', 'duplicate key value violates unique constraint "inventory_un_stock_inicial_por_pad"');
      }
      row = { id: uuid(), movement_type: type, pad_id: body.pad_id, to_pad_id: body.to_pad_id || null, liters: Number(body.liters), occurred_at: body.occurred_at, reason: body.reason || '', created_by: current.id, created_at: t, updated_at: t, updated_by: null };
    } else throw deny();
    db[table].push(row);
    audit(table, row, 'insert');
    if (table === 'fuel_deliveries') refreshOrderStatus(row.order_id);
    return row;
  }

  function upd(table, row, body) {
    if (!WRITE[table] || !WRITE[table]()) return null; // la RLS no deja filas visibles para actualizar
    const old = { ...row };
    const next = { ...row, ...body };
    if (table === 'pads') {
      check(next.code === String(next.code).trim() && next.code.length >= 1, 'pads_code_formato');
      if (db.pads.some((p) => p.id !== row.id && ciEq(p.code, next.code))) throw new DbError(409, '23505', 'duplicate key value violates unique constraint "pads_code_unico"');
    } else if (table === 'wells') {
      if (db.wells.some((w) => w.id !== row.id && ciEq(w.code, next.code))) throw new DbError(409, '23505', 'duplicate key value violates unique constraint "wells_code_unico"');
      if (next.pad_id !== row.pad_id && db.fracture_stages.some((s) => s.well_id === row.id)) throw new DbError(400, '23514', `El pozo ${row.code} tiene etapas registradas: no se puede asignar a otro PAD.`);
    } else if (table === 'fracture_stages') {
      if (db.fuel_consumption.some((c) => c.stage_id === row.id) && (next.status !== 'realizada' || next.well_id !== row.well_id)) {
        throw new DbError(400, '23514', 'La etapa tiene consumo registrado: no se puede cancelar, volver a planificada ni cambiar de pozo.');
      }
      check(next.status !== 'realizada' || next.executed_at, 'new row violates check constraint "stages_realizada_con_fecha"');
    } else if (table === 'fuel_consumption') {
      check(Number(next.liters) > 0, 'new row violates check constraint "consumption_litros_positivos"');
      next.liters = Number(next.liters);
    } else if (table === 'fuel_deliveries') {
      check(Number(next.liters) > 0, 'new row violates check constraint "deliveries_litros_positivos"');
      next.liters = Number(next.liters);
      if (db.fuel_deliveries.some((d) => d.id !== row.id && ciEq(d.document_number.trim(), String(next.document_number).trim()))) throw new DbError(409, '23505', 'duplicate key value violates unique constraint "fuel_deliveries_remito_unico"');
    } else if (table === 'fuel_orders') {
      const hasDeliveries = db.fuel_deliveries.some((d) => d.order_id === row.id);
      if (row.status === 'cancelado') throw new DbError(400, '23514', 'Un pedido cancelado no se puede modificar.');
      if (next.status !== row.status) {
        if (['entregado_parcial', 'entregado'].includes(next.status)) throw new DbError(400, '23514', 'El estado de entrega se calcula a partir de las entregas registradas.');
        const okT = (row.status === 'borrador' && next.status === 'solicitado') || (row.status === 'solicitado' && next.status === 'enviado')
          || (next.status === 'cancelado' && ['borrador', 'solicitado', 'enviado'].includes(row.status));
        if (!okT) throw new DbError(400, '23514', `No se permite pasar un pedido de ${row.status} a ${next.status}.`);
        if (next.status === 'cancelado') {
          if (hasDeliveries) throw new DbError(400, '23514', 'El pedido tiene entregas registradas y no se puede cancelar.');
          check(String(next.cancel_reason || '').trim(), 'new row violates check constraint "orders_cancelacion_con_motivo"');
        }
      }
      if (next.pad_id !== row.pad_id || next.trips !== row.trips || next.required_date !== row.required_date) {
        if (hasDeliveries) throw new DbError(400, '23514', 'No se puede cambiar el PAD, los viajes ni la fecha de un pedido con entregas registradas.');
        if (!['borrador', 'solicitado'].includes(row.status)) throw new DbError(400, '23514', `Solo se pueden modificar pedidos en borrador o solicitados (estado actual: ${row.status}).`);
        const p = db.pads.find((x) => x.id === next.pad_id);
        if (next.pad_id !== row.pad_id && (!p || !p.active)) throw new DbError(400, '23514', 'El PAD seleccionado está inactivo y no admite pedidos nuevos.');
        check(Number.isInteger(next.trips) && next.trips >= 1 && next.trips <= 100, 'new row violates check constraint "orders_viajes_validos"');
        next.requested_liters = next.trips * 43000;
      }
    } else if (table === 'app_settings') {
      Object.assign(row, { value: String(body.value), updated_at: now() });
      audit(table, row, 'update', old);
      return row;
    }
    Object.assign(row, next, { updated_at: now(), updated_by: current.id });
    audit(table, row, 'update', old);
    if (table === 'fuel_deliveries') refreshOrderStatus(row.order_id);
    return row;
  }

  // ------------------------------------------------------------------ vistas
  const padOf = (id) => db.pads.find((p) => p.id === id) || {};
  function vOrders() {
    return db.fuel_orders.map((o) => {
      const ds = db.fuel_deliveries.filter((d) => d.order_id === o.id);
      const delivered = ds.reduce((s, d) => s + d.liters, 0);
      return { ...o, pad_code: padOf(o.pad_id).code, pad_name: padOf(o.pad_id).name, delivered_liters: delivered, pending_liters: Math.max(o.requested_liters - delivered, 0),
        deliveries: ds.length, last_delivery_at: ds.length ? ds.map((d) => d.delivered_at).sort().pop() : null, requested_by_name: nameOf(o.requested_by) };
    });
  }
  const vDeliveries = () => db.fuel_deliveries.map((d) => { const o = db.fuel_orders.find((x) => x.id === d.order_id); return { ...d, order_number: o.order_number, pad_id: o.pad_id, pad_code: padOf(o.pad_id).code, received_by_name: nameOf(d.received_by) }; });
  function vStages() {
    return db.fracture_stages.map((s) => {
      const w = db.wells.find((x) => x.id === s.well_id); const c = db.fuel_consumption.find((x) => x.stage_id === s.id);
      return { ...s, well_code: w.code, pad_id: w.pad_id, pad_code: padOf(w.pad_id).code, consumption_id: c ? c.id : null, consumption_liters: c ? c.liters : null,
        consumption_notes: c ? c.notes : null, recorded_by: c ? c.recorded_by : null, recorded_by_name: c ? nameOf(c.recorded_by) : null };
    });
  }
  const vMovements = () => db.inventory_movements.map((m) => ({ ...m, pad_code: padOf(m.pad_id).code, to_pad_code: m.to_pad_id ? padOf(m.to_pad_id).code : null, created_by_name: nameOf(m.created_by) }));
  function vLedger() {
    const out = [];
    for (const m of db.inventory_movements) {
      if (['stock_inicial', 'ajuste_ingreso'].includes(m.movement_type)) out.push({ pad_id: m.pad_id, occurred_at: m.occurred_at, delta: m.liters, source: m.movement_type, source_id: m.id });
      if (['ajuste_egreso', 'salida'].includes(m.movement_type)) out.push({ pad_id: m.pad_id, occurred_at: m.occurred_at, delta: -m.liters, source: m.movement_type, source_id: m.id });
      if (m.movement_type === 'transferencia') {
        out.push({ pad_id: m.pad_id, occurred_at: m.occurred_at, delta: -m.liters, source: 'transferencia_salida', source_id: m.id });
        out.push({ pad_id: m.to_pad_id, occurred_at: m.occurred_at, delta: m.liters, source: 'transferencia_ingreso', source_id: m.id });
      }
    }
    for (const d of vDeliveries()) out.push({ pad_id: d.pad_id, occurred_at: d.delivered_at, delta: d.liters, source: 'entrega', source_id: d.id });
    for (const s of vStages()) if (s.consumption_id) out.push({ pad_id: s.pad_id, occurred_at: s.executed_at, delta: -s.consumption_liters, source: 'consumo', source_id: s.consumption_id });
    return out;
  }
  function vStockByPad() {
    const ledger = vLedger();
    return db.pads.map((p) => {
      const l = ledger.filter((x) => x.pad_id === p.id);
      const sum = (f) => l.filter(f).reduce((s, x) => s + x.delta, 0);
      const checks = db.inventory_movements.filter((m) => m.pad_id === p.id && m.movement_type === 'verificacion_fisica').sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1));
      const lc = checks[0];
      const atCheck = lc ? l.filter((x) => x.occurred_at <= lc.occurred_at).reduce((s, x) => s + x.delta, 0) : null;
      return { pad_id: p.id, pad_code: p.code, pad_name: p.name, active: p.active,
        initial_liters: sum((x) => x.source === 'stock_inicial'), delivered_liters: sum((x) => x.source === 'entrega'), consumed_liters: -sum((x) => x.source === 'consumo'),
        adjustments_liters: sum((x) => x.source.startsWith('ajuste')), outflow_liters: -sum((x) => x.source === 'salida'),
        transfers_net_liters: sum((x) => x.source.startsWith('transferencia')), estimated_liters: sum(() => true),
        verified_liters: lc ? lc.liters : null, verified_at: lc ? lc.occurred_at : null, estimated_at_verification: atCheck, verification_difference: lc ? lc.liters - atCheck : null };
    });
  }
  function vStockTotal() {
    const s = vStockByPad();
    const t = (k) => s.reduce((a, x) => a + x[k], 0);
    return [{ initial_liters: t('initial_liters'), delivered_liters: t('delivered_liters'), consumed_liters: t('consumed_liters'), adjustments_liters: t('adjustments_liters'), outflow_liters: t('outflow_liters'), estimated_liters: t('estimated_liters') }];
  }
  function vWellConsumption() {
    const st = vStages();
    return db.wells.map((w) => {
      const s = st.filter((x) => x.well_id === w.id); const c = s.filter((x) => x.consumption_id);
      const total = c.reduce((a, x) => a + x.consumption_liters, 0);
      return { well_id: w.id, well_code: w.code, well_name: w.name, pad_id: w.pad_id, stages_done: s.filter((x) => x.status === 'realizada').length,
        stages_with_consumption: c.length, consumption_liters: total, avg_liters_per_stage: c.length ? Math.round((total / c.length) * 100) / 100 : null };
    });
  }
  function vPadConsumption() {
    const wc = vWellConsumption();
    return db.pads.map((p) => {
      const w = wc.filter((x) => x.pad_id === p.id);
      const sc = w.reduce((a, x) => a + x.stages_with_consumption, 0); const total = w.reduce((a, x) => a + x.consumption_liters, 0);
      return { pad_id: p.id, pad_code: p.code, pad_name: p.name, wells: w.length, stages_done: w.reduce((a, x) => a + x.stages_done, 0),
        stages_with_consumption: sc, consumption_liters: total, avg_liters_per_stage: sc ? Math.round((total / sc) * 100) / 100 : null };
    });
  }

  function readable(table) {
    if (table === 'profiles') return role() ? db.profiles : db.profiles.filter((p) => current && p.id === current.id);
    if (!role()) return [];
    switch (table) {
      case 'v_orders': return vOrders();
      case 'v_deliveries': return vDeliveries();
      case 'v_stages': return vStages();
      case 'v_movements': return vMovements();
      case 'v_stock_ledger': return vLedger();
      case 'v_stock_by_pad': return vStockByPad();
      case 'v_stock_total': return vStockTotal();
      case 'v_pad_consumption': return vPadConsumption();
      case 'v_well_consumption': return vWellConsumption();
      case 'audit_logs': case 'import_logs': return has('administrador', 'supervision') ? db[table] : [];
      default: if (Array.isArray(db[table])) return db[table];
    }
    throw new DbError(404, 'PGRST205', `Could not find the table 'public.${table}'`);
  }

  // ------------------------------------------------------------------ RPC
  function rpc(fn, a) {
    if (fn === 'my_microsoft_link') { const l = current && db.ms_links[current.id]; return l ? [{ ...l, updated_at: l.linked_at }] : []; }
    if (fn === 'unlink_my_microsoft') { if (current) delete db.ms_links[current.id]; return null; }
    if (fn === 'update_my_profile') { current.full_name = String(a.new_full_name).trim(); return current; }
    if (fn === 'admin_update_user') {
      if (!has('administrador')) throw new DbError(403, '42501', 'Solo un administrador puede modificar usuarios.');
      const u = profileOf(a.target); if (!u) throw new DbError(404, 'P0002', 'Usuario inexistente.');
      if (u.id === current.id && (a.new_role !== 'administrador' || !a.new_active)) throw new DbError(400, '23514', 'No puede quitarse el rol de administrador ni desactivar su propio usuario.');
      if (a.new_active && !a.new_role) throw new DbError(400, '23514', 'Asigne un rol para activar el usuario.');
      const old = { ...u };
      if (a.new_active && !u.active) { u.approved_by = current.id; u.approved_at = now(); }
      Object.assign(u, { role: a.new_role, active: a.new_active, updated_at: now() });
      audit('profiles', u, 'update', old);
      return u;
    }
    if (fn === 'plan_stages') {
      if (!has('administrador', 'operaciones')) throw deny();
      if (!(a.p_count >= 1 && a.p_count <= 200)) throw new DbError(400, '23514', 'Indique entre 1 y 200 etapas.');
      let n = 0;
      for (let i = 1; i <= a.p_count; i++) {
        if (db.fracture_stages.some((s) => s.well_id === a.p_well_id && s.stage_number === i)) continue;
        ins('fracture_stages', { well_id: a.p_well_id, stage_number: i, status: 'planificada', planned_date: a.p_planned_date || null }); n++;
      }
      return n;
    }
    if (fn === 'register_stage_consumption') {
      if (!has('administrador', 'operaciones')) throw deny();
      const w = db.wells.find((x) => x.id === a.p_well_id); if (!w) throw new DbError(404, 'P0002', 'Pozo inexistente.');
      if (!a.p_executed_at) throw new DbError(400, '23514', 'Indique la fecha y hora de la etapa.');
      if (new Date(a.p_executed_at) > new Date(Date.now() + 3600e3)) throw new DbError(400, '23514', 'La fecha de la etapa no puede ser futura.');
      check(Number(a.p_liters) > 0, 'new row violates check constraint "consumption_litros_positivos"');
      let s = db.fracture_stages.find((x) => x.well_id === w.id && x.stage_number === a.p_stage_number);
      if (s) {
        if (s.status === 'cancelada') throw new DbError(400, '23514', `La etapa ${a.p_stage_number} del pozo ${w.code} está cancelada.`);
        if (db.fuel_consumption.some((c) => c.stage_id === s.id)) throw new DbError(409, '23505', `La etapa ${a.p_stage_number} del pozo ${w.code} ya tiene consumo registrado.`);
        upd('fracture_stages', s, { status: 'realizada', executed_at: a.p_executed_at });
      } else s = ins('fracture_stages', { well_id: w.id, stage_number: a.p_stage_number, status: 'realizada', executed_at: a.p_executed_at });
      return ins('fuel_consumption', { stage_id: s.id, liters: a.p_liters, notes: a.p_notes || '' }).id;
    }
    if (fn === 'import_master') return importMaster(a);
    throw new DbError(404, 'PGRST202', `Could not find the function public.${fn}`);
  }

  function importMaster({ p_file_name, p_sheet_name, p_rows, p_dry_run }) {
    if (!has('administrador')) throw new DbError(403, '42501', 'Solo un administrador puede importar el maestro de PADs y pozos.');
    if (!Array.isArray(p_rows)) throw new DbError(400, '22023', 'El contenido a importar no tiene el formato esperado.');
    if (!p_rows.length) throw new DbError(400, '22023', 'El archivo no tiene filas de datos.');
    if (p_rows.length > 5000) throw new DbError(400, '22023', `El archivo tiene ${p_rows.length} filas; el máximo por importación es 5.000.`);
    const t = (v) => { const s = v === null || v === undefined ? '' : String(v).trim(); return s || null; };
    const R = p_rows.map((r, i) => ({ row_no: Number(r.row) || i + 1, pad_code: t(r.pad_code), pad_name: t(r.pad_name), well_code: t(r.well_code), well_name: t(r.well_name),
      planned_raw: t(r.planned_stages), planned_stages: null, op_status: t(r.operational_status), status: null, message: null, pad_action: null, well_action: null }));
    const err = (r, m) => { r.status = 'error'; r.message = m; };
    for (const r of R) {
      if (!r.pad_code) err(r, 'Falta el código del PAD.');
      else if (r.pad_code.length > 60) err(r, 'El código del PAD supera 60 caracteres.');
      else if (r.pad_name && r.pad_name.length > 120) err(r, 'El nombre del PAD supera 120 caracteres.');
      else if (!r.well_code && r.well_name) err(r, 'Hay nombre de pozo pero falta su código.');
      else if (r.well_code && r.well_code.length > 60) err(r, 'El código del pozo supera 60 caracteres.');
      else if (r.planned_raw && (!/^\d{1,3}$/.test(r.planned_raw) || Number(r.planned_raw) > 200)) err(r, `Etapas planificadas inválidas: “${r.planned_raw}” (debe ser un entero entre 0 y 200).`);
      else if (r.planned_raw) r.planned_stages = Number(r.planned_raw);
    }
    const key = (r) => [r.pad_code.toLowerCase(), (r.well_code || '').toLowerCase(), r.pad_name, r.well_name, r.planned_stages, r.op_status].join('\u0001');
    const first = new Map();
    for (const r of R.filter((x) => !x.status)) { const k = key(r); if (first.has(k)) { r.status = 'duplicado'; r.message = `Fila repetida (igual a la fila ${first.get(k)}).`; } else first.set(k, r.row_no); }
    for (const r of R) if (!r.status && r.well_code && R.some((j) => j.status !== 'error' && j.well_code && ciEq(j.well_code, r.well_code) && !ciEq(j.pad_code, r.pad_code))) err(r, `El pozo ${r.well_code} figura en más de un PAD dentro del archivo.`);
    for (const r of R) if (!r.status && r.well_code && R.some((j) => !j.status && j !== r && ciEq(j.well_code, r.well_code) && (j.well_name !== r.well_name || j.planned_stages !== r.planned_stages || j.op_status !== r.op_status))) err(r, `El pozo ${r.well_code} tiene datos distintos en otra fila del archivo.`);
    for (const r of R) if (!r.status && r.pad_name && R.some((j) => !j.status && ciEq(j.pad_code, r.pad_code) && j.pad_name && j.pad_name !== r.pad_name)) err(r, `El PAD ${r.pad_code} tiene nombres distintos dentro del archivo.`);
    for (const r of R) {
      if (r.status || !r.well_code) continue;
      const w = db.wells.find((x) => ciEq(x.code, r.well_code));
      if (w) { const p = padOf(w.pad_id); if (!ciEq(p.code, r.pad_code)) err(r, `El pozo ${w.code} ya existe en el PAD ${p.code}. Para moverlo, modifíquelo desde PADs y Pozos.`); }
    }
    for (const r of R) if (!r.status) r.status = 'ok';
    const ok = R.filter((r) => r.status === 'ok');
    for (const r of ok) {
      const p = db.pads.find((x) => ciEq(x.code, r.pad_code));
      r.pad_action = !p ? 'nuevo' : !p.active || (r.pad_name && r.pad_name !== p.name) ? 'actualiza' : 'sin_cambios';
      if (r.well_code) {
        const w = db.wells.find((x) => ciEq(x.code, r.well_code));
        r.well_action = !w ? 'nuevo' : (r.well_name && r.well_name !== w.name) || (r.planned_stages !== null && r.planned_stages !== w.planned_stages) || (r.op_status && r.op_status !== w.operational_status) || !w.active ? 'actualiza' : 'sin_cambios';
      }
    }
    // Los PADs se clasifican una vez por código (como en SQL): todas sus filas comparten la acción.
    const padAct = new Map(); for (const r of ok) if (!padAct.has(r.pad_code.toLowerCase())) padAct.set(r.pad_code.toLowerCase(), r.pad_action);
    for (const r of ok) r.pad_action = padAct.get(r.pad_code.toLowerCase());
    const distinct = (f, k) => new Set(ok.filter(f).map((r) => r[k].toLowerCase())).size;
    const summary = { rows_processed: R.length, pads_created: distinct((r) => r.pad_action === 'nuevo', 'pad_code'), pads_updated: distinct((r) => r.pad_action === 'actualiza', 'pad_code'),
      wells_created: distinct((r) => r.well_action === 'nuevo', 'well_code'), wells_updated: distinct((r) => r.well_action === 'actualiza', 'well_code'),
      unchanged: ok.filter((r) => (r.well_action || r.pad_action) === 'sin_cambios').length, duplicates: R.filter((r) => r.status === 'duplicado').length, errors: R.filter((r) => r.status === 'error').length };
    let logId = null;
    if (!p_dry_run) {
      const firstBy = (f, k) => { const m = new Map(); for (const r of ok.filter(f).sort((a, b) => a.row_no - b.row_no)) if (!m.has(r[k].toLowerCase())) m.set(r[k].toLowerCase(), r); return [...m.values()]; };
      for (const r of firstBy((x) => x.pad_action === 'nuevo', 'pad_code')) ins('pads', { code: r.pad_code, name: r.pad_name || r.pad_code });
      for (const r of firstBy((x) => x.pad_action === 'actualiza', 'pad_code')) { const p = db.pads.find((x) => ciEq(x.code, r.pad_code)); upd('pads', p, { name: r.pad_name || p.name, active: true }); }
      for (const r of firstBy((x) => x.well_action === 'nuevo', 'well_code')) ins('wells', { pad_id: db.pads.find((x) => ciEq(x.code, r.pad_code)).id, code: r.well_code, name: r.well_name || r.well_code, planned_stages: r.planned_stages, operational_status: r.op_status });
      for (const r of firstBy((x) => x.well_action === 'actualiza', 'well_code')) {
        const w = db.wells.find((x) => ciEq(x.code, r.well_code));
        upd('wells', w, { name: r.well_name || w.name, planned_stages: r.planned_stages ?? w.planned_stages, operational_status: r.op_status ?? w.operational_status, active: true });
      }
      logId = uuid();
      db.import_logs.unshift({ id: logId, file_name: String(p_file_name || '').slice(0, 200), sheet_name: String(p_sheet_name || '').slice(0, 100), ...summary,
        error_rows: R.filter((r) => r.status === 'error').slice(0, 500).map((r) => ({ row: r.row_no, message: r.message })), imported_by: current.id, imported_at: now() });
    }
    return { dry_run: !!p_dry_run, log_id: logId, summary, rows: R.map((r) => ({ row: r.row_no, pad_code: r.pad_code, well_code: r.well_code,
      status: r.status === 'ok' ? r.well_action || r.pad_action : r.status, pad_action: r.pad_action, well_action: r.well_action, message: r.message })) };
  }

  // ------------------------------------------------------------------ funciones de servidor (simuladas)
  function sendOrderEmail(body) {
    if (!has('administrador', 'logistica')) return [403, { status: 'error', code: 'sin_permiso', message: 'Su rol no tiene permiso para enviar pedidos.' }];
    if ((db.app_settings.find((s) => s.key === 'email_sending_enabled') || {}).value !== 'true') {
      return [409, { status: 'error', code: 'deshabilitado', message: 'El envío desde Outlook todavía no está habilitado. Use el borrador del correo.' }];
    }
    const link = db.ms_links[current.id];
    if (!link) return [409, { status: 'error', code: 'sin_vinculo', message: 'Para enviar desde su Outlook, salga e ingrese con su cuenta Microsoft.' }];
    const o = db.fuel_orders.find((x) => x.id === body.order_id);
    if (!o) return [404, { status: 'error', code: 'pedido_inexistente', message: 'Pedido inexistente.' }];
    if (!['solicitado', 'enviado', 'entregado_parcial'].includes(o.status)) return [409, { status: 'error', code: 'estado_invalido', message: `No se puede enviar un pedido en estado ${o.status}.` }];
    const done = db.email_dispatches.find((d) => d.order_id === o.id && d.status === 'aceptado');
    if (done) return [409, { status: 'error', code: 'ya_enviado', message: `Este pedido ya fue enviado por ${done.sender_email}.` }];
    const recipient = db.app_settings.find((s) => s.key === 'order_recipient').value;
    const d = { id: uuid(), order_id: o.id, attempted_by: current.id, sender_email: link.ms_email, recipient,
      subject: `[PEDIDO DE COMBUSTIBLE] ${o.order_number} – ${padOf(o.pad_id).code} – ${fmtD(o.required_date)}`, status: 'aceptado',
      graph_request_id: 'demo', error_code: null, error_message: null, created_at: now(), finished_at: now() };
    db.email_dispatches.push(d); audit('email_dispatches', d, 'insert');
    const old = { ...o }; o.notification_status = 'aceptado'; if (o.status === 'solicitado') o.status = 'enviado'; audit('fuel_orders', o, 'update', old);
    return [200, { status: 'aceptado', dispatch_id: d.id, sender: link.ms_email, recipient,
      message: `DEMO: no se envió ningún correo real. En producción, Microsoft 365 lo enviaría desde ${link.ms_email} a ${recipient}.` }];
  }

  // ------------------------------------------------------------------ HTTP (formato de Supabase / PostgREST)
  const b64url = (o) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const tokenFor = (id) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.demo`;
  const userJson = (u) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, app_metadata: { provider: 'email' }, user_metadata: {}, created_at: ago(30) });
  const session = (u) => ({ access_token: tokenFor(u.id), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: `r.${u.id}`, user: userJson(u) });
  function whoFromHeader(h) {
    const m = /^Bearer\s+[^.]+\.([^.]+)\./.exec(h || '');
    if (!m) return null;
    try { const sub = JSON.parse(atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))).sub; return profileOf(sub); } catch { return null; }
  }
  const resp = (status, body, headers = {}) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

  function applyQuery(rows, params) {
    let out = rows.slice();
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'offset', 'columns'].includes(k)) continue;
      if (k === 'or') {
        const parts = v.replace(/^\(|\)$/g, '').split(',').map((p) => { const [c, op, ...val] = p.split('.'); return [c, op, val.join('.')]; });
        out = out.filter((r) => parts.some(([c, op, val]) => op === 'eq' && String(r[c]) === val));
        continue;
      }
      const i = v.indexOf('.'); const op = v.slice(0, i); const val = v.slice(i + 1);
      const cmp = (r) => {
        const x = r[k];
        switch (op) {
          case 'eq': return String(x) === val;
          case 'neq': return String(x) !== val;
          case 'in': return val.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')).includes(String(x));
          case 'gte': return x !== null && String(x) >= val;
          case 'gt': return x !== null && String(x) > val;
          case 'lte': return x !== null && String(x) <= val;
          case 'lt': return x !== null && String(x) < val;
          case 'is': return val === 'null' ? x === null || x === undefined : String(x) === val;
          default: return true;
        }
      };
      out = out.filter(cmp);
    }
    const order = params.get('order');
    if (order) {
      const keys = order.split(',').map((o) => { const [c, dir] = o.split('.'); return [c, dir === 'desc' ? -1 : 1]; });
      out.sort((a, b) => { for (const [c, d] of keys) { const x = a[c]; const y = b[c]; if (x === y) continue; if (x === null || x === undefined) return 1; if (y === null || y === undefined) return -1; return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'es', { sensitivity: 'base' })) * d; } return 0; });
    }
    const limit = Number(params.get('limit')); if (limit) out = out.slice(0, limit);
    return out;
  }

  async function handle(url, init) {
    const u = new URL(url); const path = u.pathname; const method = (init.method || 'GET').toUpperCase();
    const headers = new Headers(init.headers || {});
    const body = init.body ? JSON.parse(init.body) : {};
    current = whoFromHeader(headers.get('authorization'));
    try {
      // ---- autenticación
      if (path === '/auth/v1/token') {
        if (u.searchParams.get('grant_type') === 'refresh_token') { const p = profileOf(String(body.refresh_token || '').slice(2)); return p ? resp(200, session(db.users.find((x) => x.id === p.id))) : resp(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' }); }
        const usr = db.users.find((x) => ciEq(x.email, body.email) && x.password === body.password);
        return usr ? resp(200, session(usr)) : resp(400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials', code: 'invalid_credentials' });
      }
      if (path === '/auth/v1/user') { const usr = current && db.users.find((x) => x.id === current.id); return usr ? resp(200, userJson(usr)) : resp(401, { msg: 'invalid JWT' }); }
      if (path === '/auth/v1/logout') return resp(204);
      if (path === '/auth/v1/recover') return resp(200, {});
      if (path === '/auth/v1/signup') {
        if (db.users.some((x) => ciEq(x.email, body.email))) return resp(422, { code: 'user_already_exists', msg: 'User already registered' });
        const id = uuid(); const usr = { id, email: String(body.email).trim(), password: body.password };
        db.users.push(usr);
        const name = (body.data && body.data.full_name) || usr.email.split('@')[0];
        db.profiles.push({ id, email: usr.email, full_name: name, role: null, active: false, approved_by: null, approved_at: null, created_at: now(), updated_at: now() });
        save();
        return resp(200, session(usr));
      }
      // ---- funciones de servidor
      if (path === '/functions/v1/send-order-email') { const [st, b] = sendOrderEmail(body); save(); return resp(st, b); }
      if (path === '/functions/v1/microsoft-link') return resp(503, { linked: false, code: 'no_configurado', message: 'DEMO: el ingreso con Microsoft no está disponible.' });
      // ---- RPC
      if (path.startsWith('/rest/v1/rpc/')) { const r = rpc(path.slice(13), body); save(); return resp(200, r); }
      // ---- tablas y vistas
      const table = path.replace('/rest/v1/', '');
      const wantsObject = (headers.get('accept') || '').includes('vnd.pgrst.object');
      if (method === 'GET' || method === 'HEAD') {
        const rows = applyQuery(readable(table), u.searchParams);
        if (method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}` } });
        if (wantsObject) return rows.length === 1 ? resp(200, rows[0]) : resp(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows`, hint: null });
        return resp(200, rows, { 'content-range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}` });
      }
      if (!current) throw deny();
      if (method === 'POST') {
        const created = (Array.isArray(body) ? body : [body]).map((b) => ins(table, b));
        save();
        const view = created.map((r) => (table === 'fuel_orders' ? vOrders().find((x) => x.id === r.id) : r));
        return wantsObject ? resp(201, view[0]) : resp(201, view);
      }
      if (method === 'PATCH') {
        const targets = applyQuery(table === 'app_settings' ? db.app_settings : readable(table).length ? db[table] : [], u.searchParams);
        const updated = targets.map((r) => upd(table, r, body)).filter(Boolean);
        save();
        return wantsObject ? (updated.length ? resp(200, updated[0]) : resp(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' })) : resp(200, updated);
      }
      if (method === 'DELETE') throw new DbError(403, '42501', `permission denied for table ${table}`);
      return resp(405, { message: 'Método no admitido' });
    } catch (e) {
      if (e instanceof DbError) return resp(e.status, { code: e.code, message: e.message, details: null, hint: null });
      console.error(e);
      return resp(500, { message: String(e && e.message || e) });
    }
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(BASE)) return realFetch(input, init);
    const req = typeof input === 'string' || input instanceof URL ? null : input;
    const merged = { method: init.method || (req && req.method), headers: init.headers || (req && req.headers), body: init.body };
    return new Promise((r) => setTimeout(r, 120)).then(() => handle(url, merged));
  };

  // Las descargas (CSV, reportes) no funcionan dentro del visor del demo: se avisa en lugar de fallar en silencio.
  const realClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.hasAttribute('download')) { notice(`El demo no permite descargar archivos. En la aplicación instalada se descargaría “${this.getAttribute('download')}”.`); return; }
    return realClick.call(this);
  };

  function notice(text) {
    const el = document.getElementById('demo-notice');
    if (!el) return;
    el.textContent = text; el.hidden = false;
    clearTimeout(notice.t); notice.t = setTimeout(() => { el.hidden = true; }, 6000);
  }

  window.__fuelDemoReset = () => {
    try { localStorage.removeItem(KEY); Object.keys(localStorage).filter((k) => k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k)); } catch { /* sin almacenamiento */ }
    current = null; seed(); save(); location.reload();
  };

  load();
})();
