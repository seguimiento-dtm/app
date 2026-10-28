-- Pruebas del envío por Outlook (continúa los datos de PRUEBA anteriores).
grant usage on schema tests to service_role;
grant execute on all functions in schema tests to service_role;

-- ------------------------------------------------------------ el navegador no accede a tokens ni al envío
select tests.login('log@prueba.test');
set role authenticated;
select tests.throws($$select * from private.microsoft_tokens$$, 'permission denied', 'el navegador no lee tokens');
select tests.throws($$select public.begin_order_dispatch(gen_random_uuid(), auth.uid(), 'x@y.z', 's')$$, 'permission denied', 'el navegador no inicia envíos');
select tests.throws($$select public.finish_order_dispatch(gen_random_uuid(), true, null, null, null)$$, 'permission denied', 'el navegador no cierra envíos');
select tests.throws($$insert into public.email_dispatches (order_id, attempted_by, sender_email, recipient, subject) select id, auth.uid(), 'a', 'b', 'c' from public.fuel_orders limit 1$$,
  'permission denied', 'el navegador no escribe el registro de envíos');
select tests.ok((select count(*) = 0 from public.my_microsoft_link()), 'sin cuenta Microsoft vinculada');
insert into public.fuel_orders (pad_id, trips, required_date, status, notes) select id, 1, current_date + 1, 'solicitado', 'Envío 1' from public.pads where code = 'PRUEBA-PAD-A';
insert into public.fuel_orders (pad_id, trips, required_date, status, notes) select id, 1, current_date + 1, 'solicitado', 'Envío 2' from public.pads where code = 'PRUEBA-PAD-A';
insert into public.fuel_orders (pad_id, trips, required_date, status, notes) select id, 1, current_date + 1, 'borrador', 'Envío borrador' from public.pads where code = 'PRUEBA-PAD-A';
reset role;

set role service_role;
insert into private.microsoft_tokens (user_id, ms_email, refresh_token_enc)
  select id, 'log@prueba.test', 'cifrado-de-prueba' from public.profiles where email = 'log@prueba.test';
reset role;
select tests.login('log@prueba.test');
set role authenticated;
select tests.ok((select ms_email = 'log@prueba.test' from public.my_microsoft_link()), 'el usuario ve su vinculación sin el token');
reset role;

-- ------------------------------------------------------------ inicio del envío (como la función de servidor)
create temp table ids as select
  (select id from public.profiles where email = 'log@prueba.test') as log_user,
  (select id from public.profiles where email = 'ops@prueba.test') as ops_user,
  (select id from public.fuel_orders where notes = 'Envío 1') as o1,
  (select id from public.fuel_orders where notes = 'Envío 2') as o2,
  (select id from public.fuel_orders where notes = 'Envío borrador') as o3;
grant select on ids to service_role;

set role service_role;
select tests.ok((select public.begin_order_dispatch(o1, log_user, 'log@prueba.test', 'asunto') ->> 'code' = 'deshabilitado' from ids), 'deshabilitado hasta que un administrador lo active');
reset role;
update public.app_settings set value = 'true' where key = 'email_sending_enabled';

set role service_role;
select tests.ok((select public.begin_order_dispatch(o1, ops_user, 'ops@prueba.test', 'asunto') ->> 'code' = 'sin_permiso' from ids), 'operaciones no envía pedidos');
select tests.ok((select public.begin_order_dispatch(o3, log_user, 'log@prueba.test', 'asunto') ->> 'code' = 'estado_invalido' from ids), 'un borrador no se envía');
create temp table b1 as select public.begin_order_dispatch(o1, log_user, 'log@prueba.test', 'Pedido de prueba') as r from ids;
select tests.ok((select (r ->> 'ok')::boolean and r ->> 'recipient' = 'mperez5@pan-energy.com' and r -> 'order' ->> 'pad_code' = 'PRUEBA-PAD-A' from b1),
  'reserva el envío con el destinatario configurado');
select tests.ok((select public.begin_order_dispatch(o1, log_user, 'log@prueba.test', 'asunto') ->> 'code' = 'en_curso' from ids), 'no hay dos envíos simultáneos del mismo pedido');
select public.finish_order_dispatch((select (r ->> 'dispatch_id')::uuid from b1), true, 'req-123', null, null);
select tests.ok((select status = 'enviado' and notification_status = 'aceptado' from public.fuel_orders where id = (select o1 from ids)), 'aceptado: pedido enviado, notificación aceptada (no entregado)');
select tests.ok((select public.begin_order_dispatch(o1, log_user, 'log@prueba.test', 'asunto') ->> 'code' = 'ya_enviado' from ids), 'un pedido aceptado no se reenvía');
select tests.ok((select count(*) = 1 from public.email_dispatches where order_id = (select o1 from ids)), 'un solo correo registrado para el pedido');

-- Error y reintento seguro.
create temp table b2 as select public.begin_order_dispatch(o2, log_user, 'log@prueba.test', 'Pedido 2') as r from ids;
select public.finish_order_dispatch((select (r ->> 'dispatch_id')::uuid from b2), false, null, 'ErrorAccessDenied', 'Microsoft Graph rechazó el envío.');
select tests.ok((select status = 'solicitado' and notification_status = 'error' from public.fuel_orders where id = (select o2 from ids)), 'error: el pedido se conserva solicitado con notificación en error');
create temp table b3 as select public.begin_order_dispatch(o2, log_user, 'log@prueba.test', 'Pedido 2') as r from ids;
select tests.ok((select (r ->> 'ok')::boolean from b3), 'después de un error se puede reintentar');
-- Intento colgado: pasados 10 minutos se cierra como error y se permite reintentar.
update public.email_dispatches set created_at = now() - interval '20 minutes' where id = (select (r ->> 'dispatch_id')::uuid from b3);
create temp table b4 as select public.begin_order_dispatch(o2, log_user, 'log@prueba.test', 'Pedido 2') as r from ids;
select tests.ok((select (r ->> 'ok')::boolean from b4), 'un intento sin respuesta no bloquea para siempre');
select tests.ok((select status = 'error' and error_code = 'interrumpido' from public.email_dispatches where id = (select (r ->> 'dispatch_id')::uuid from b3)), 'el intento colgado queda registrado como interrumpido');
select public.finish_order_dispatch((select (r ->> 'dispatch_id')::uuid from b4), true, 'req-456', null, null);
select public.finish_order_dispatch((select (r ->> 'dispatch_id')::uuid from b4), false, null, 'x', 'no debe pisar');
select tests.ok((select status = 'aceptado' from public.email_dispatches where id = (select (r ->> 'dispatch_id')::uuid from b4)), 'un envío cerrado no se modifica');
reset role;

select tests.login('sup@prueba.test');
set role authenticated;
select tests.ok((select count(*) = 4 from public.email_dispatches), 'el registro de envíos es visible para usuarios activos');
reset role;
select tests.ok((select count(*) >= 4 from public.audit_logs where table_name = 'email_dispatches' and action = 'insert'), 'los envíos quedan en la auditoría');

-- ------------------------------------------------------------ acceso a tokens solo desde el servidor
select tests.login('log@prueba.test');
set role authenticated;
select tests.throws($$select * from public.ms_token_get(auth.uid())$$, 'permission denied', 'el navegador no obtiene el token cifrado');
select tests.throws($$select public.ms_token_put(auth.uid(), 'otro@x.test', 'x')$$, 'permission denied', 'el navegador no reemplaza tokens');
select public.unlink_my_microsoft();
select tests.ok((select count(*) = 0 from public.my_microsoft_link()), 'el usuario puede desvincular su cuenta');
reset role;
set role service_role;
select public.ms_token_put((select log_user from ids), 'log@prueba.test', 'nuevo-cifrado');
select tests.ok((select refresh_token_enc = 'nuevo-cifrado' from public.ms_token_get((select log_user from ids))), 'el servidor guarda y lee el token cifrado');
reset role;
