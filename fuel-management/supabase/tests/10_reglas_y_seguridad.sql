-- Pruebas de reglas operativas, cálculos y seguridad (datos de PRUEBA, solo en la base local descartable).
-- Cada bloque se ejecuta con el rol "authenticated" y la identidad del usuario indicado, como en Supabase.

create schema tests;
grant usage on schema tests to anon, authenticated;

create function tests.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FALLÓ: %', msg; end if;
end $$;

create function tests.throws(stmt text, expected text, msg text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm !~* expected then
      raise exception 'FALLÓ: % — error inesperado: %', msg, sqlerrm;
    end if;
    return;
  end;
  raise exception 'FALLÓ: % — se esperaba un error y la operación se aceptó', msg;
end $$;

create function tests.login(user_email text) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claims',
    coalesce((select json_build_object('sub', id, 'role', 'authenticated')::text from auth.users where email = user_email), '{}'), false);
end $$;

grant execute on all functions in schema tests to anon, authenticated;

-- ------------------------------------------------------------ usuarios de prueba
insert into auth.users (email, raw_user_meta_data) values
  ('admin@prueba.test', '{"full_name":"Admin Prueba"}'),
  ('ops@prueba.test', '{"full_name":"Operaciones Prueba"}'),
  ('log@prueba.test', '{"full_name":"Logística Prueba"}'),
  ('sup@prueba.test', '{"full_name":"Supervisión Prueba"}'),
  ('pend@prueba.test', '{"full_name":"Pendiente Prueba"}');

select tests.ok((select count(*) = 5 from public.profiles where not active and role is null), 'los usuarios nuevos quedan pendientes y sin rol');
select tests.ok((select full_name = 'Operaciones Prueba' from public.profiles where email = 'ops@prueba.test'), 'el perfil toma el nombre del registro');
select public.bootstrap_admin('admin@prueba.test');
select tests.throws($$select public.bootstrap_admin('ops@prueba.test')$$, 'Ya existe un administrador', 'bootstrap_admin solo sirve una vez');

-- ------------------------------------------------------------ maestro cargado desde el Excel
select tests.ok((select count(*) = 92 from public.pads), 'carga inicial: 92 PADs');
select tests.ok((select count(*) = 227 from public.wells), 'carga inicial: 227 pozos (sin duplicar al repetir la carga)');
select tests.ok((select p.code = 'LA-WP130' from public.wells w join public.pads p on p.id = w.pad_id where w.code = 'LA-750(h)'), 'el pozo LA-750(h) pertenece a LA-WP130');

-- ------------------------------------------------------------ anónimo: sin acceso
set role anon;
select tests.throws($$select count(*) from public.pads$$, 'permission denied', 'anónimo no puede leer PADs');
select tests.throws($$select public.current_app_role()$$, 'permission denied', 'anónimo no puede ejecutar funciones');
reset role;

-- ------------------------------------------------------------ pendiente: solo ve su perfil
select tests.login('pend@prueba.test');
set role authenticated;
select tests.ok((select count(*) = 0 from public.pads), 'usuario pendiente no ve PADs');
select tests.ok((select count(*) = 1 from public.profiles), 'usuario pendiente solo ve su propio perfil');
select tests.throws($$insert into public.pads (code, name) values ('X', 'X')$$, 'row-level security', 'usuario pendiente no puede crear PADs');
reset role;

-- ------------------------------------------------------------ administración de usuarios
select tests.login('admin@prueba.test');
set role authenticated;
select public.admin_update_user((select id from public.profiles where email = 'ops@prueba.test'), 'operaciones', true);
select public.admin_update_user((select id from public.profiles where email = 'log@prueba.test'), 'logistica', true);
select public.admin_update_user((select id from public.profiles where email = 'sup@prueba.test'), 'supervision', true);
select tests.throws($$select public.admin_update_user(auth.uid(), 'supervision', true)$$, 'propio usuario', 'el administrador no puede quitarse el rol');
select tests.throws($$select public.admin_update_user((select id from public.profiles where email = 'pend@prueba.test'), null, true)$$, 'Asigne un rol', 'no se activa un usuario sin rol');
select tests.throws($$update public.profiles set role = 'administrador' where email = 'log@prueba.test'$$, 'permission denied', 'nadie cambia roles por fuera de la función');
select tests.ok((select approved_by = auth.uid() from public.profiles where email = 'ops@prueba.test'), 'se registra quién aprobó al usuario');
reset role;

select tests.login('log@prueba.test');
set role authenticated;
select tests.throws($$select public.admin_update_user(auth.uid(), 'administrador', true)$$, 'Solo un administrador', 'logística no puede asignarse roles');
select tests.throws($$select public.bootstrap_admin('log@prueba.test')$$, 'permission denied', 'bootstrap_admin no está disponible para la aplicación');
select tests.ok((select count(*) = 5 from public.profiles), 'usuario activo ve el resto de los perfiles');
reset role;

-- ------------------------------------------------------------ catálogo: solo administrador
select tests.login('ops@prueba.test');
set role authenticated;
select tests.ok((select count(*) = 92 from public.pads), 'operaciones ve el catálogo');
select tests.throws($$insert into public.pads (code, name) values ('PRUEBA-PAD-X', 'X')$$, 'row-level security', 'operaciones no crea PADs');
update public.pads set name = 'cambio' where code = 'LA-WP130';  -- la RLS no deja filas visibles para actualizar
reset role;
select tests.ok((select name = 'LA-WP130' from public.pads where code = 'LA-WP130'), 'operaciones no modifica PADs');

select tests.login('admin@prueba.test');
set role authenticated;
insert into public.pads (code, name, area) values ('PRUEBA-PAD-A', 'PAD de prueba A', 'Área de prueba'), ('PRUEBA-PAD-B', 'PAD de prueba B', 'Área de prueba');
insert into public.wells (pad_id, code, name, planned_stages)
  select id, 'PRUEBA-POZO-1', 'Pozo de prueba 1', 20 from public.pads where code = 'PRUEBA-PAD-A';
insert into public.wells (pad_id, code, name, planned_stages)
  select id, 'PRUEBA-POZO-2', 'Pozo de prueba 2', 20 from public.pads where code = 'PRUEBA-PAD-A';
select tests.throws($$insert into public.pads (code, name) values ('prueba-pad-a', 'duplicado')$$, 'duplicate key|pads_code_unico', 'no se duplica un código de PAD (sin distinguir mayúsculas)');
select tests.throws($$insert into public.wells (pad_id, code, name) select id, 'la-750(h)', 'dup' from public.pads where code = 'PRUEBA-PAD-A'$$, 'duplicate key|wells_code_unico', 'no se duplica un código de pozo');
select tests.throws($$insert into public.pads (code, name) values (' ESPACIO', 'x')$$, 'pads_code_formato', 'el código no admite espacios al inicio');
select tests.ok((select created_by = auth.uid() from public.pads where code = 'PRUEBA-PAD-A'), 'se registra quién creó el PAD');
reset role;

-- ------------------------------------------------------------ etapas y consumo: operaciones
select tests.login('log@prueba.test');
set role authenticated;
select tests.throws($$insert into public.fracture_stages (well_id, stage_number) select id, 1 from public.wells where code = 'PRUEBA-POZO-1'$$, 'row-level security', 'logística no registra etapas');
reset role;

select tests.login('ops@prueba.test');
set role authenticated;
insert into public.fracture_stages (well_id, stage_number, status, planned_date)
  select w.id, n, 'planificada', current_date from public.wells w, generate_series(1, 3) n where w.code in ('PRUEBA-POZO-1', 'PRUEBA-POZO-2');
select tests.throws($$insert into public.fracture_stages (well_id, stage_number) select id, 1 from public.wells where code = 'PRUEBA-POZO-1'$$, 'stages_unica_por_pozo', 'no se repite la etapa en el mismo pozo');
select tests.throws($$update public.fracture_stages set status = 'realizada' where stage_number = 1$$, 'stages_realizada_con_fecha', 'una etapa realizada requiere fecha de ejecución');
select tests.throws($$insert into public.fuel_consumption (stage_id, liters) select s.id, 13425 from public.fracture_stages s join public.wells w on w.id = s.well_id where w.code = 'PRUEBA-POZO-1' and s.stage_number = 1$$,
  'etapas realizadas', 'no hay consumo en etapas planificadas');

update public.fracture_stages s set status = 'realizada', executed_at = now() - interval '1 hour'
  from public.wells w where w.id = s.well_id and w.code in ('PRUEBA-POZO-1', 'PRUEBA-POZO-2') and s.stage_number in (1, 2);
update public.fracture_stages s set status = 'cancelada'
  from public.wells w where w.id = s.well_id and w.code = 'PRUEBA-POZO-2' and s.stage_number = 3;

-- Ejemplo del pedido: pozo, etapa 1, 13.425 L.
insert into public.fuel_consumption (stage_id, liters)
  select s.id, v.l from (values ('PRUEBA-POZO-1', 1, 13425), ('PRUEBA-POZO-1', 2, 12575), ('PRUEBA-POZO-2', 1, 14000)) v (w, n, l)
  join public.wells w on w.code = v.w join public.fracture_stages s on s.well_id = w.id and s.stage_number = v.n;
select tests.throws($$insert into public.fuel_consumption (stage_id, liters) select s.id, 100 from public.fracture_stages s join public.wells w on w.id = s.well_id where w.code = 'PRUEBA-POZO-1' and s.stage_number = 1$$,
  'duplicate key|stage_id', 'un único consumo por etapa');
select tests.throws($$insert into public.fuel_consumption (stage_id, liters) select s.id, -5 from public.fracture_stages s join public.wells w on w.id = s.well_id where w.code = 'PRUEBA-POZO-2' and s.stage_number = 2$$,
  'consumption_litros_positivos', 'no hay consumos negativos');
select tests.throws($$insert into public.fuel_consumption (stage_id, liters) select s.id, 0 from public.fracture_stages s join public.wells w on w.id = s.well_id where w.code = 'PRUEBA-POZO-2' and s.stage_number = 2$$,
  'consumption_litros_positivos', 'no hay consumos en cero');
select tests.throws($$insert into public.fuel_consumption (stage_id, liters) select s.id, 5000 from public.fracture_stages s join public.wells w on w.id = s.well_id where w.code = 'PRUEBA-POZO-2' and s.stage_number = 3$$,
  'etapas realizadas', 'no hay consumo en etapas canceladas');
select tests.throws($$update public.fracture_stages s set status = 'cancelada' from public.wells w where w.id = s.well_id and w.code = 'PRUEBA-POZO-1' and s.stage_number = 1$$,
  'tiene consumo registrado', 'no se cancela una etapa con consumo');
select tests.ok((select recorded_by = auth.uid() from public.fuel_consumption limit 1), 'se registra quién cargó el consumo');
reset role;

select tests.login('admin@prueba.test');
set role authenticated;
select tests.throws($$update public.wells set pad_id = (select id from public.pads where code = 'PRUEBA-PAD-B') where code = 'PRUEBA-POZO-1'$$,
  'no se puede asignar a otro PAD', 'un pozo con etapas no cambia de PAD');
select tests.throws($$delete from public.pads where code = 'PRUEBA-PAD-A'$$, 'foreign key', 'no se elimina un PAD con pozos');
reset role;

-- Promedios: PAD = suma de sus pozos; promedio = consumo / etapas realizadas con consumo; canceladas no cuentan.
select tests.ok((select consumption_liters = 26000 and stages_with_consumption = 2 and avg_liters_per_stage = 13000 from public.v_well_consumption where well_code = 'PRUEBA-POZO-1'), 'consumo y promedio del pozo 1');
select tests.ok((select consumption_liters = 40000 and stages_with_consumption = 3 and stages_done = 4 and avg_liters_per_stage = 13333.33 from public.v_pad_consumption where pad_code = 'PRUEBA-PAD-A'),
  'consumo del PAD = suma de pozos; promedio sobre etapas con consumo; la cancelada no cuenta');

-- ------------------------------------------------------------ pedidos y entregas: logística
select tests.login('ops@prueba.test');
set role authenticated;
select tests.throws($$insert into public.fuel_orders (pad_id, trips, required_date) select id, 1, current_date from public.pads where code = 'PRUEBA-PAD-A'$$, 'row-level security', 'operaciones no crea pedidos');
reset role;

select tests.login('log@prueba.test');
set role authenticated;
insert into public.fuel_orders (pad_id, trips, required_date, notes)
  select id, 2, current_date + 2, 'Pedido de prueba' from public.pads where code = 'PRUEBA-PAD-A';
select tests.ok((select requested_liters = 86000 and trip_capacity_liters = 43000 and order_number ~ '^PC-\d{4}-00001$' and status = 'borrador' and requested_by = auth.uid()
  from public.fuel_orders where notes = 'Pedido de prueba'), 'volumen = viajes × 43.000 L, numeración y solicitante automáticos');
select tests.throws($$insert into public.fuel_orders (pad_id, trips, required_date, trip_capacity_liters) select id, 1, current_date, 1 from public.pads limit 1$$, 'permission denied', 'el cliente no define la capacidad por viaje');
select tests.throws($$insert into public.fuel_orders (pad_id, trips, required_date) select id, 0, current_date from public.pads limit 1$$, 'orders_viajes_validos', 'al menos un viaje');
select tests.throws($$insert into public.fuel_deliveries (order_id, delivered_at, liters, document_number) select id, now(), 43000, 'R-1' from public.fuel_orders where notes = 'Pedido de prueba'$$,
  'estado borrador', 'no hay entregas sobre un borrador');
update public.fuel_orders set status = 'solicitado' where notes = 'Pedido de prueba';
select tests.throws($$update public.fuel_orders set status = 'entregado' where notes = 'Pedido de prueba'$$, 'se calcula a partir de las entregas', 'el estado entregado no se fija a mano');
reset role;
select tests.ok((select count(*) = 0 from public.v_stock_ledger where source = 'entrega'), 'un pedido sin entrega no suma stock');
select tests.ok((select estimated_liters = -40000 from public.v_stock_by_pad where pad_code = 'PRUEBA-PAD-A'), 'antes de entregas: solo consumos (el pedido no suma)');

select tests.login('log@prueba.test');
set role authenticated;
insert into public.fuel_deliveries (order_id, delivered_at, liters, document_number, carrier)
  select id, now() - interval '3 hours', 43000, 'R-0001', 'Transportista de prueba' from public.fuel_orders where notes = 'Pedido de prueba';
select tests.ok((select status = 'entregado_parcial' from public.fuel_orders where notes = 'Pedido de prueba'), 'entrega parcial actualiza el pedido');
select tests.throws($$insert into public.fuel_deliveries (order_id, delivered_at, liters, document_number) select id, now(), 43000, ' r-0001 ' from public.fuel_orders where notes = 'Pedido de prueba'$$,
  'duplicate key|remito_unico', 'no se repite el remito');
select tests.throws($$insert into public.fuel_deliveries (order_id, delivered_at, liters, document_number) select id, now(), -1, 'R-NEG' from public.fuel_orders where notes = 'Pedido de prueba'$$,
  'deliveries_litros_positivos', 'no hay entregas negativas');
insert into public.fuel_deliveries (order_id, delivered_at, liters, document_number)
  select id, now() - interval '2 hours', 43000, 'R-0002' from public.fuel_orders where notes = 'Pedido de prueba';
select tests.ok((select status = 'entregado' from public.fuel_orders where notes = 'Pedido de prueba'), 'entrega completa marca el pedido como entregado');
select tests.throws($$update public.fuel_orders set trips = 3 where notes = 'Pedido de prueba'$$, 'con entregas registradas', 'no se cambian viajes con entregas');
select tests.throws($$delete from public.fuel_orders$$, 'permission denied', 'los pedidos no se borran');

-- ------------------------------------------------------------ stock por PAD y consolidado
insert into public.inventory_movements (movement_type, pad_id, liters, occurred_at)
  select 'stock_inicial', id, 10000, now() - interval '1 day' from public.pads where code = 'PRUEBA-PAD-A';
select tests.throws($$insert into public.inventory_movements (movement_type, pad_id, liters, occurred_at) select 'stock_inicial', id, 1, now() from public.pads where code = 'PRUEBA-PAD-A'$$,
  'duplicate key|stock_inicial', 'un solo stock inicial por PAD');
select tests.throws($$insert into public.inventory_movements (movement_type, pad_id, liters, occurred_at) select 'ajuste_egreso', id, 100, now() from public.pads where code = 'PRUEBA-PAD-A'$$,
  'movements_motivo', 'los ajustes requieren motivo');
select tests.throws($$insert into public.inventory_movements (movement_type, pad_id, liters, occurred_at, reason) select 'transferencia', id, 100, now(), 'x' from public.pads where code = 'PRUEBA-PAD-A'$$,
  'movements_transferencia', 'la transferencia requiere PAD de destino');
insert into public.inventory_movements (movement_type, pad_id, to_pad_id, liters, occurred_at, reason)
  select 'transferencia', a.id, b.id, 5000, now() - interval '30 minutes', 'Traslado con el set (prueba)' from public.pads a, public.pads b where a.code = 'PRUEBA-PAD-A' and b.code = 'PRUEBA-PAD-B';
select tests.throws($$delete from public.inventory_movements$$, 'permission denied', 'los movimientos no se borran');
reset role;

-- A: 10.000 inicial + 86.000 entregado − 40.000 consumido − 5.000 transferido = 51.000.  B: 5.000.
select tests.ok((select estimated_liters = 51000 and delivered_liters = 86000 and consumed_liters = 40000 from public.v_stock_by_pad where pad_code = 'PRUEBA-PAD-A'), 'stock estimado del PAD A');
select tests.ok((select estimated_liters = 5000 from public.v_stock_by_pad where pad_code = 'PRUEBA-PAD-B'), 'la transferencia suma en el PAD B');
select tests.ok((select estimated_liters = 56000 from public.v_stock_total), 'consolidado general = suma de los PADs');

select tests.login('ops@prueba.test');
set role authenticated;
insert into public.inventory_movements (movement_type, pad_id, liters, occurred_at)
  select 'verificacion_fisica', id, 50400, now() from public.pads where code = 'PRUEBA-PAD-A';
select tests.throws($$insert into public.inventory_movements (movement_type, pad_id, liters, occurred_at, reason) select 'ajuste_ingreso', id, 600, now(), 'x' from public.pads where code = 'PRUEBA-PAD-A'$$,
  'row-level security', 'operaciones solo carga verificaciones físicas');
reset role;
select tests.ok((select estimated_liters = 51000 and verified_liters = 50400 and verification_difference = -600 from public.v_stock_by_pad where pad_code = 'PRUEBA-PAD-A'),
  'la verificación física no altera el estimado y muestra la diferencia');

-- ------------------------------------------------------------ supervisión: solo consulta
select tests.login('sup@prueba.test');
set role authenticated;
select tests.ok((select count(*) > 0 from public.v_stock_by_pad), 'supervisión consulta stock');
select tests.throws($$insert into public.fracture_stages (well_id, stage_number) select id, 9 from public.wells where code = 'PRUEBA-POZO-1'$$, 'row-level security', 'supervisión no registra etapas');
select tests.throws($$insert into public.fuel_orders (pad_id, trips, required_date) select id, 1, current_date from public.pads limit 1$$, 'row-level security', 'supervisión no crea pedidos');
select tests.ok((select count(*) > 0 from public.audit_logs where table_name = 'fuel_consumption'), 'supervisión ve la auditoría');
reset role;

-- ------------------------------------------------------------ auditoría
select tests.login('log@prueba.test');
set role authenticated;
select tests.ok((select count(*) = 0 from public.audit_logs), 'logística no ve la auditoría');
select tests.throws($$insert into public.audit_logs (table_name, action) values ('x', 'insert')$$, 'permission denied', 'nadie escribe la auditoría a mano');
reset role;
select tests.ok((select count(*) = 1 from public.audit_logs a join public.profiles p on p.id = a.changed_by
  where a.table_name = 'fuel_orders' and a.action = 'insert' and p.email = 'log@prueba.test'), 'la auditoría registra quién creó el pedido');
select tests.ok((select count(*) >= 2 from public.audit_logs where table_name = 'profiles' and action = 'update' and changed_by is not null), 'la auditoría registra los cambios de rol');

set client_min_messages = warning;
drop schema tests cascade;
