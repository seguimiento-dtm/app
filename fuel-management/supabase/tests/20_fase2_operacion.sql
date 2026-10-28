-- Pruebas de la Fase 2 (continúa los datos de PRUEBA de 10_reglas_y_seguridad.sql).

-- ------------------------------------------------------------ parámetros
select tests.login('log@prueba.test');
set role authenticated;
select tests.ok((select value = 'mperez5@pan-energy.com' from public.app_settings where key = 'order_recipient'), 'el destinatario está configurado');
update public.app_settings set value = 'otro@ejemplo.test' where key = 'order_recipient';
reset role;
select tests.ok((select value = 'mperez5@pan-energy.com' from public.app_settings where key = 'order_recipient'), 'logística no cambia el destinatario');
select tests.login('admin@prueba.test');
set role authenticated;
update public.app_settings set value = 'mperez5@pan-energy.com' where key = 'order_recipient';
select tests.ok((select count(*) = 1 from public.audit_logs where table_name = 'app_settings' and action = 'update'), 'el cambio de parámetros queda auditado');
update public.pads set active = false where code = 'PRUEBA-PAD-B';
update public.wells set active = false where code = 'PRUEBA-POZO-2';
reset role;

-- ------------------------------------------------------------ pedidos: transiciones
select tests.login('log@prueba.test');
set role authenticated;
select tests.throws($$insert into public.fuel_orders (pad_id, trips, required_date) select id, 1, current_date from public.pads where code = 'PRUEBA-PAD-B'$$,
  'inactivo', 'no hay pedidos sobre PADs inactivos');
insert into public.fuel_orders (pad_id, trips, required_date, notes)
  select id, 1, current_date + 1, 'Transiciones' from public.pads where code = 'PRUEBA-PAD-A';
select tests.throws($$update public.fuel_orders set status = 'enviado' where notes = 'Transiciones'$$, 'No se permite pasar', 'borrador no pasa directo a enviado');
update public.fuel_orders set status = 'solicitado' where notes = 'Transiciones';
update public.fuel_orders set status = 'enviado' where notes = 'Transiciones';
select tests.throws($$update public.fuel_orders set status = 'solicitado' where notes = 'Transiciones'$$, 'No se permite pasar', 'un pedido enviado no vuelve a solicitado');
select tests.throws($$update public.fuel_orders set trips = 2 where notes = 'Transiciones'$$, 'Solo se pueden modificar', 'un pedido enviado no cambia viajes');
select tests.throws($$update public.fuel_orders set status = 'cancelado' where notes = 'Transiciones'$$, 'orders_cancelacion_con_motivo', 'la cancelación requiere motivo');
update public.fuel_orders set status = 'cancelado', cancel_reason = 'Prueba de cancelación' where notes = 'Transiciones';
select tests.throws($$update public.fuel_orders set notes = 'cambio' where notes = 'Transiciones'$$, 'cancelado no se puede modificar', 'un pedido cancelado no se modifica');

insert into public.fuel_orders (pad_id, trips, required_date, status, notes)
  select id, 2, current_date + 1, 'solicitado', 'Con entrega parcial' from public.pads where code = 'PRUEBA-PAD-A';
insert into public.fuel_deliveries (order_id, delivered_at, liters, document_number)
  select id, now() - interval '10 minutes', 40000, 'R-0100' from public.fuel_orders where notes = 'Con entrega parcial';
select tests.throws($$update public.fuel_orders set status = 'cancelado', cancel_reason = 'x' where notes = 'Con entrega parcial'$$,
  'No se permite pasar|entregas registradas', 'un pedido con entregas no se cancela');
reset role;
select tests.ok((select delivered_liters = 40000 and pending_liters = 46000 and deliveries = 1 and status = 'entregado_parcial' and requested_by_name = 'Logística Prueba'
  from public.v_orders where notes = 'Con entrega parcial'), 'v_orders: entregado, pendiente y solicitante');
select tests.ok((select pad_code = 'PRUEBA-PAD-A' and order_number like 'PC-%' from public.v_deliveries where document_number = 'R-0100'), 'v_deliveries muestra pedido y PAD');

-- ------------------------------------------------------------ etapas y consumo
select tests.login('ops@prueba.test');
set role authenticated;
select tests.ok((select public.plan_stages((select id from public.wells where code = 'PRUEBA-POZO-1'), 5, current_date) = 2), 'planificar 5 etapas crea solo las que faltan (4 y 5)');
select tests.throws($$select public.plan_stages((select id from public.wells where code = 'PRUEBA-POZO-2'), 4)$$, 'inactivos', 'no se planifican etapas en pozos inactivos');
select tests.throws($$select public.plan_stages((select id from public.wells where code = 'PRUEBA-POZO-1'), 0)$$, 'entre 1 y 200', 'cantidad de etapas válida');

select public.register_stage_consumption((select id from public.wells where code = 'PRUEBA-POZO-1'), 4, now() - interval '20 minutes', 13425, 'Etapa planificada que se realiza');
select public.register_stage_consumption((select id from public.wells where code = 'PRUEBA-POZO-1'), 6, now() - interval '10 minutes', 12000);
select tests.ok((select status = 'realizada' and consumption_liters = 13425 and recorded_by_name = 'Operaciones Prueba' from public.v_stages where well_code = 'PRUEBA-POZO-1' and stage_number = 4),
  'una etapa planificada pasa a realizada con su consumo');
select tests.ok((select status = 'realizada' and consumption_liters = 12000 from public.v_stages where well_code = 'PRUEBA-POZO-1' and stage_number = 6), 'una etapa no planificada se crea realizada');
select tests.throws($$select public.register_stage_consumption((select id from public.wells where code = 'PRUEBA-POZO-1'), 1, now(), 100)$$, 'ya tiene consumo', 'no se duplica el consumo de una etapa');
select tests.throws($$select public.register_stage_consumption((select id from public.wells where code = 'PRUEBA-POZO-2'), 3, now(), 100)$$, 'cancelada', 'no hay consumo en etapas canceladas');
select tests.throws($$select public.register_stage_consumption((select id from public.wells where code = 'PRUEBA-POZO-1'), 7, now() + interval '1 day', 100)$$, 'futura', 'la fecha no puede ser futura');
select tests.throws($$select public.register_stage_consumption((select id from public.wells where code = 'PRUEBA-POZO-1'), 7, now(), 0)$$, 'consumption_litros_positivos', 'litros mayores que cero');
select tests.ok((select count(*) = 0 from public.fracture_stages s join public.wells w on w.id = s.well_id where w.code = 'PRUEBA-POZO-1' and s.stage_number = 7),
  'si el consumo falla, la etapa tampoco se crea');
reset role;

select tests.login('log@prueba.test');
set role authenticated;
select tests.throws($$select public.register_stage_consumption((select id from public.wells where code = 'PRUEBA-POZO-1'), 5, now(), 100)$$, 'row-level security', 'logística no registra consumos');
reset role;
select tests.ok((select status = 'planificada' from public.v_stages where well_code = 'PRUEBA-POZO-1' and stage_number = 5), 'el intento rechazado no modificó la etapa');

select tests.login('sup@prueba.test');
set role authenticated;
select tests.throws($$select public.plan_stages((select id from public.wells where code = 'PRUEBA-POZO-1'), 8)$$, 'row-level security', 'supervisión no planifica etapas');
select tests.ok((select count(*) > 0 from public.v_movements where pad_code = 'PRUEBA-PAD-A' and to_pad_code = 'PRUEBA-PAD-B'), 'v_movements muestra origen y destino');
reset role;

-- Consumo del PAD A: 40.000 + 13.425 + 12.000 = 65.425 en 5 etapas con consumo.
select tests.ok((select consumption_liters = 65425 and stages_with_consumption = 5 and avg_liters_per_stage = 13085 from public.v_pad_consumption where pad_code = 'PRUEBA-PAD-A'),
  'consumo y promedio del PAD actualizados');
