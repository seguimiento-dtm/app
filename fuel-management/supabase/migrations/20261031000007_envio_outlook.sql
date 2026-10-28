-- Fuel Management | Frac Operations — Fase 4: envío de pedidos desde el Outlook del usuario (Microsoft Graph).
-- Los tokens de Microsoft se guardan cifrados en un esquema privado, sin acceso desde el navegador.
-- El envío lo hace la función de servidor "send-order-email" con la clave service_role.

-- ---------------------------------------------------------------- tokens (privado)
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table private.microsoft_tokens (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  ms_email text not null,                 -- cuenta Microsoft vinculada (mail o UPN)
  refresh_token_enc text not null,        -- token de renovación cifrado (AES-GCM) por la función de servidor
  linked_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
revoke all on private.microsoft_tokens from public, anon, authenticated;
grant select, insert, update, delete on private.microsoft_tokens to service_role;

-- Estado de la vinculación del propio usuario (sin exponer el token).
create or replace function public.my_microsoft_link() returns table (ms_email text, linked_at timestamptz, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select t.ms_email, t.linked_at, t.updated_at from private.microsoft_tokens t where t.user_id = auth.uid()
$$;
create or replace function public.unlink_my_microsoft() returns void
language sql security definer set search_path = '' as $$
  delete from private.microsoft_tokens where user_id = auth.uid()
$$;
grant execute on function public.my_microsoft_link(), public.unlink_my_microsoft() to authenticated;

-- ---------------------------------------------------------------- parámetros
insert into public.app_settings (key, value, description) values
  ('email_sending_enabled', 'false', 'Envío de pedidos desde Outlook (Microsoft 365) habilitado por un administrador')
on conflict (key) do nothing;

-- ---------------------------------------------------------------- registro de envíos
create type public.dispatch_status as enum ('enviando', 'aceptado', 'error');

create table public.email_dispatches (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.fuel_orders (id) on delete restrict,
  attempted_by uuid not null references public.profiles (id),
  sender_email text not null,
  recipient text not null,
  subject text not null,
  status public.dispatch_status not null default 'enviando',
  graph_request_id text,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
-- Un solo envío en curso o aceptado por pedido: evita correos duplicados ante reintentos.
create unique index email_dispatches_un_envio_por_pedido on public.email_dispatches (order_id) where status in ('enviando', 'aceptado');
create index email_dispatches_order_idx on public.email_dispatches (order_id, created_at desc);
create trigger email_dispatches_audit after insert or update or delete on public.email_dispatches for each row execute function public.audit_row();

alter table public.email_dispatches enable row level security;
revoke all on public.email_dispatches from anon, authenticated;
grant select on public.email_dispatches to authenticated;
grant select, insert, update on public.email_dispatches to service_role;
create policy dispatches_select on public.email_dispatches for select to authenticated using (public.is_active_user());

-- ---------------------------------------------------------------- inicio y cierre de un envío (solo servidor)
-- Valida usuario, rol, pedido y configuración; reserva el envío (o informa que ya existe) y devuelve los datos
-- con los que el servidor arma el correo. El destinatario sale de la configuración, nunca del cliente.
create or replace function public.begin_order_dispatch(p_order_id uuid, p_user_id uuid, p_sender_email text, p_subject text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u public.profiles;
  o public.fuel_orders;
  recipient text;
  enabled text;
  existing public.email_dispatches;
  d public.email_dispatches;
begin
  select * into u from public.profiles where id = p_user_id;
  if u.id is null or not u.active or u.role not in ('administrador', 'logistica') then
    return jsonb_build_object('ok', false, 'code', 'sin_permiso', 'message', 'Su rol no tiene permiso para enviar pedidos.');
  end if;
  select value into enabled from public.app_settings where key = 'email_sending_enabled';
  if coalesce(enabled, 'false') <> 'true' then
    return jsonb_build_object('ok', false, 'code', 'deshabilitado', 'message', 'El envío desde Outlook todavía no está habilitado. Use el borrador del correo.');
  end if;
  select value into recipient from public.app_settings where key = 'order_recipient';
  if coalesce(btrim(recipient), '') = '' then
    return jsonb_build_object('ok', false, 'code', 'sin_destinatario', 'message', 'No hay destinatario configurado para los pedidos.');
  end if;
  select * into o from public.fuel_orders where id = p_order_id for update;
  if o.id is null then
    return jsonb_build_object('ok', false, 'code', 'pedido_inexistente', 'message', 'Pedido inexistente.');
  end if;
  if o.status not in ('solicitado', 'enviado', 'entregado_parcial') then
    return jsonb_build_object('ok', false, 'code', 'estado_invalido', 'message', format('No se puede enviar un pedido en estado %s.', o.status));
  end if;

  select * into existing from public.email_dispatches where order_id = o.id and status in ('enviando', 'aceptado');
  if existing.id is not null and existing.status = 'aceptado' then
    return jsonb_build_object('ok', false, 'code', 'ya_enviado', 'dispatch_id', existing.id,
      'message', format('Este pedido ya fue enviado por %s el %s.', existing.sender_email, to_char(existing.finished_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI')));
  end if;
  if existing.id is not null then
    if existing.created_at > now() - interval '10 minutes' then
      return jsonb_build_object('ok', false, 'code', 'en_curso', 'dispatch_id', existing.id, 'message', 'Ya hay un envío en curso para este pedido. Espere unos minutos.');
    end if;
    -- Un intento que quedó sin respuesta: se cierra como error para permitir reintentar.
    update public.email_dispatches set status = 'error', error_code = 'interrumpido', finished_at = now(),
      error_message = 'El intento anterior no terminó. Verifique en Elementos enviados de Outlook antes de reintentar.'
    where id = existing.id;
  end if;

  insert into public.email_dispatches (order_id, attempted_by, sender_email, recipient, subject)
  values (o.id, u.id, p_sender_email, recipient, left(p_subject, 300)) returning * into d;
  update public.fuel_orders set notification_status = 'pendiente' where id = o.id;

  return jsonb_build_object('ok', true, 'dispatch_id', d.id, 'recipient', recipient,
    'order', (select to_jsonb(v) from public.v_orders v where v.id = o.id));
end $$;

create or replace function public.finish_order_dispatch(p_dispatch_id uuid, p_ok boolean, p_request_id text, p_error_code text, p_error_message text)
returns void
language plpgsql security definer set search_path = '' as $$
declare d public.email_dispatches;
begin
  update public.email_dispatches set
    status = case when p_ok then 'aceptado'::public.dispatch_status else 'error'::public.dispatch_status end,
    graph_request_id = p_request_id, error_code = p_error_code, error_message = left(p_error_message, 1000), finished_at = now()
  where id = p_dispatch_id and status = 'enviando' returning * into d;
  if d.id is null then return; end if;
  perform set_config('fuel.internal', 'on', true);
  update public.fuel_orders set
    notification_status = case when p_ok then 'aceptado'::public.notification_status else 'error'::public.notification_status end,
    status = case when p_ok and status = 'solicitado' then 'enviado'::public.order_status else status end
  where id = d.order_id;
  perform set_config('fuel.internal', 'off', true);
end $$;

revoke all on function public.begin_order_dispatch(uuid, uuid, text, text), public.finish_order_dispatch(uuid, boolean, text, text, text) from public, anon, authenticated;
grant execute on function public.begin_order_dispatch(uuid, uuid, text, text), public.finish_order_dispatch(uuid, boolean, text, text, text) to service_role;

-- ---------------------------------------------------------------- acceso a tokens para la función de servidor
-- El esquema "private" no se publica en la API: la función de servidor usa estas funciones (solo service_role).
create or replace function public.ms_token_get(p_user_id uuid) returns table (ms_email text, refresh_token_enc text)
language sql stable security definer set search_path = '' as $$
  select t.ms_email, t.refresh_token_enc from private.microsoft_tokens t where t.user_id = p_user_id
$$;
create or replace function public.ms_token_put(p_user_id uuid, p_ms_email text, p_refresh_token_enc text) returns void
language sql security definer set search_path = '' as $$
  insert into private.microsoft_tokens (user_id, ms_email, refresh_token_enc) values (p_user_id, p_ms_email, p_refresh_token_enc)
  on conflict (user_id) do update set ms_email = excluded.ms_email, refresh_token_enc = excluded.refresh_token_enc, updated_at = now()
$$;
create or replace function public.ms_token_delete(p_user_id uuid) returns void
language sql security definer set search_path = '' as $$
  delete from private.microsoft_tokens where user_id = p_user_id
$$;
revoke all on function public.ms_token_get(uuid), public.ms_token_put(uuid, text, text), public.ms_token_delete(uuid) from public, anon, authenticated;
grant execute on function public.ms_token_get(uuid), public.ms_token_put(uuid, text, text), public.ms_token_delete(uuid) to service_role;
