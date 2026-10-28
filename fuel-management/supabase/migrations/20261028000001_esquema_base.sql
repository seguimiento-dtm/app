-- Fuel Management | Frac Operations — Fase 1: esquema base.
-- Volúmenes en litros (numeric). Identificadores uuid. Fechas con zona horaria.
-- Las reglas operativas se aplican en la base de datos, no solo en la interfaz.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tipos
create type public.app_role as enum ('administrador', 'operaciones', 'logistica', 'supervision');
create type public.stage_status as enum ('planificada', 'realizada', 'cancelada');
create type public.order_status as enum ('borrador', 'solicitado', 'enviado', 'entregado_parcial', 'entregado', 'cancelado');
create type public.notification_status as enum ('no_enviado', 'pendiente', 'aceptado', 'error');
create type public.movement_type as enum (
  'stock_inicial',        -- existencia de arranque de un PAD
  'ajuste_ingreso',       -- corrección que suma
  'ajuste_egreso',        -- corrección que resta
  'salida',               -- salida no asociada a etapas (devolución, otro equipo)
  'transferencia',        -- traslado de un PAD a otro
  'verificacion_fisica'   -- medición física: no altera el stock estimado
);

-- ---------------------------------------------------------------- utilidades
create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------- perfiles
-- Un perfil por usuario de Supabase Auth. Sin rol o inactivo = sin acceso a datos.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role public.app_role,
  active boolean not null default false,
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_activo_requiere_rol check (not active or role is not null)
);

-- ---------------------------------------------------------------- PADs y pozos
create table public.pads (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  area text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  constraint pads_code_formato check (code = btrim(code) and length(code) between 1 and 60),
  constraint pads_name_no_vacio check (length(btrim(name)) between 1 and 120)
);
create unique index pads_code_unico on public.pads (lower(code));

create table public.wells (
  id uuid primary key default gen_random_uuid(),
  pad_id uuid not null references public.pads (id) on delete restrict,
  code text not null,
  name text not null,
  planned_stages integer,
  operational_status text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  constraint wells_code_formato check (code = btrim(code) and length(code) between 1 and 60),
  constraint wells_name_no_vacio check (length(btrim(name)) between 1 and 120),
  constraint wells_etapas_planificadas check (planned_stages is null or planned_stages between 0 and 200)
);
create unique index wells_code_unico on public.wells (lower(code));
create index wells_pad_idx on public.wells (pad_id);

-- ---------------------------------------------------------------- etapas de fractura
create table public.fracture_stages (
  id uuid primary key default gen_random_uuid(),
  well_id uuid not null references public.wells (id) on delete restrict,
  stage_number integer not null,
  status public.stage_status not null default 'planificada',
  planned_date date,
  executed_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  constraint stages_numero_valido check (stage_number between 1 and 200),
  constraint stages_realizada_con_fecha check (status <> 'realizada' or executed_at is not null),
  constraint stages_unica_por_pozo unique (well_id, stage_number)
);

-- ---------------------------------------------------------------- pedidos de combustible
create table public.order_counters (
  year integer primary key,
  last_number integer not null
);

create table public.fuel_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  pad_id uuid not null references public.pads (id) on delete restrict,
  trips integer not null,
  -- Capacidad vigente al crear el pedido: si cambia en el futuro, los pedidos anteriores no se recalculan.
  trip_capacity_liters numeric(12, 2) not null default 43000,
  requested_liters numeric(14, 2) generated always as (trips * trip_capacity_liters) stored,
  required_date date not null,
  status public.order_status not null default 'borrador',
  notification_status public.notification_status not null default 'no_enviado',
  notes text not null default '',
  cancel_reason text not null default '',
  requested_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  constraint orders_viajes_validos check (trips between 1 and 100),
  constraint orders_capacidad_valida check (trip_capacity_liters > 0),
  constraint orders_cancelacion_con_motivo check (status <> 'cancelado' or length(btrim(cancel_reason)) > 0)
);
create index fuel_orders_pad_idx on public.fuel_orders (pad_id);

-- ---------------------------------------------------------------- entregas (único ingreso de stock)
create table public.fuel_deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.fuel_orders (id) on delete restrict,
  delivered_at timestamptz not null,
  liters numeric(12, 2) not null,
  document_number text not null,
  carrier text not null default '',
  notes text not null default '',
  received_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  constraint deliveries_litros_positivos check (liters > 0),
  constraint deliveries_remito_no_vacio check (length(btrim(document_number)) > 0)
);
create unique index fuel_deliveries_remito_unico on public.fuel_deliveries (lower(btrim(document_number)));
create index fuel_deliveries_order_idx on public.fuel_deliveries (order_id);

-- ---------------------------------------------------------------- consumo: un único registro por etapa
-- El pozo y el PAD se obtienen de la etapa; no se copian para no duplicar información.
create table public.fuel_consumption (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null unique references public.fracture_stages (id) on delete restrict,
  liters numeric(12, 2) not null,
  notes text not null default '',
  recorded_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  constraint consumption_litros_positivos check (liters > 0)
);

-- ---------------------------------------------------------------- movimientos de inventario
-- Solo lo que no es entrega ni consumo. Entregas y consumos se leen de sus propias tablas.
create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  movement_type public.movement_type not null,
  pad_id uuid not null references public.pads (id) on delete restrict,
  to_pad_id uuid references public.pads (id) on delete restrict,
  liters numeric(12, 2) not null,
  occurred_at timestamptz not null,
  reason text not null default '',
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  constraint movements_litros check (
    (movement_type = 'verificacion_fisica' and liters >= 0) or (movement_type <> 'verificacion_fisica' and liters > 0)),
  constraint movements_transferencia check (
    (movement_type = 'transferencia' and to_pad_id is not null and to_pad_id <> pad_id)
    or (movement_type <> 'transferencia' and to_pad_id is null)),
  constraint movements_motivo check (
    movement_type in ('stock_inicial', 'verificacion_fisica') or length(btrim(reason)) > 0)
);
create unique index inventory_un_stock_inicial_por_pad on public.inventory_movements (pad_id) where movement_type = 'stock_inicial';
create index inventory_movements_pad_idx on public.inventory_movements (pad_id, occurred_at);

-- ---------------------------------------------------------------- auditoría
create table public.audit_logs (
  id bigint generated always as identity primary key,
  table_name text not null,
  record_id uuid,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index audit_logs_record_idx on public.audit_logs (table_name, record_id);
create index audit_logs_changed_at_idx on public.audit_logs (changed_at desc);

-- ================================================================ reglas por trigger

-- updated_at
do $$
declare t text;
begin
  foreach t in array array['profiles', 'pads', 'wells', 'fracture_stages', 'fuel_orders', 'fuel_deliveries', 'fuel_consumption', 'inventory_movements']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
  end loop;
end $$;

-- Quién crea / modifica: lo define el servidor con la sesión, nunca el cliente.
create or replace function public.stamp_actor() returns trigger
language plpgsql set search_path = '' as $$
declare
  uid uuid := auth.uid();
  creator_col text := tg_argv[0];
begin
  if tg_op = 'INSERT' then
    if creator_col is not null then
      new := jsonb_populate_record(new, jsonb_build_object(creator_col, uid));
    end if;
  else
    -- el creador original no se puede cambiar
    if creator_col is not null then
      new := jsonb_populate_record(new, jsonb_build_object(creator_col, to_jsonb(old) -> creator_col));
    end if;
    new := jsonb_populate_record(new, jsonb_build_object('updated_by', uid));
  end if;
  return new;
end $$;

create trigger pads_actor before insert or update on public.pads for each row execute function public.stamp_actor('created_by');
create trigger wells_actor before insert or update on public.wells for each row execute function public.stamp_actor('created_by');
create trigger stages_actor before insert or update on public.fracture_stages for each row execute function public.stamp_actor('created_by');
create trigger orders_actor before insert or update on public.fuel_orders for each row execute function public.stamp_actor('requested_by');
create trigger deliveries_actor before insert or update on public.fuel_deliveries for each row execute function public.stamp_actor('received_by');
create trigger consumption_actor before insert or update on public.fuel_consumption for each row execute function public.stamp_actor('recorded_by');
create trigger movements_actor before insert or update on public.inventory_movements for each row execute function public.stamp_actor('created_by');

-- Número de pedido correlativo por año: PC-2026-00001. La capacidad por viaje no la define el cliente.
create or replace function public.fuel_orders_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  y integer := extract(year from (now() at time zone 'America/Argentina/Buenos_Aires'))::integer;
  n integer;
begin
  insert into public.order_counters (year, last_number) values (y, 1)
  on conflict (year) do update set last_number = public.order_counters.last_number + 1
  returning last_number into n;
  new.order_number := format('PC-%s-%s', y, lpad(n::text, 5, '0'));
  new.trip_capacity_liters := 43000;
  new.notification_status := 'no_enviado';
  if new.status not in ('borrador', 'solicitado') then
    raise exception 'Un pedido nuevo solo puede crearse como borrador o solicitado.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger fuel_orders_numero before insert on public.fuel_orders for each row execute function public.fuel_orders_before_insert();

create or replace function public.fuel_orders_before_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.order_number <> old.order_number or new.trip_capacity_liters <> old.trip_capacity_liters then
    raise exception 'El número de pedido y la capacidad por viaje no se pueden modificar.' using errcode = 'check_violation';
  end if;
  if old.status = 'cancelado' and new.status <> 'cancelado' then
    raise exception 'Un pedido cancelado no se puede reactivar.' using errcode = 'check_violation';
  end if;
  if new.status in ('entregado_parcial', 'entregado') and new.status is distinct from old.status
     and coalesce(current_setting('fuel.internal', true), '') <> 'on' then
    raise exception 'El estado de entrega se calcula a partir de las entregas registradas.' using errcode = 'check_violation';
  end if;
  if (new.pad_id <> old.pad_id or new.trips <> old.trips)
     and exists (select 1 from public.fuel_deliveries d where d.order_id = old.id) then
    raise exception 'No se puede cambiar el PAD ni los viajes de un pedido con entregas registradas.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger fuel_orders_reglas before update on public.fuel_orders for each row execute function public.fuel_orders_before_update();

-- Entregas: solo sobre pedidos vigentes; el estado del pedido se actualiza con lo entregado.
create or replace function public.fuel_deliveries_check() returns trigger
language plpgsql set search_path = '' as $$
declare st public.order_status;
begin
  select status into st from public.fuel_orders where id = new.order_id;
  if st in ('borrador', 'cancelado') then
    raise exception 'No se pueden registrar entregas sobre un pedido en estado %.', st using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and new.order_id <> old.order_id then
    raise exception 'Una entrega no se puede pasar a otro pedido.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger fuel_deliveries_reglas before insert or update on public.fuel_deliveries for each row execute function public.fuel_deliveries_check();

create or replace function public.refresh_order_delivery_status() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  o public.fuel_orders;
  delivered numeric;
  target public.order_status;
begin
  select * into o from public.fuel_orders where id = coalesce(new.order_id, old.order_id);
  if o.status in ('borrador', 'cancelado') then return null; end if;
  select coalesce(sum(liters), 0) into delivered from public.fuel_deliveries where order_id = o.id;
  target := case when delivered >= o.requested_liters then 'entregado'
                 when delivered > 0 then 'entregado_parcial'
                 when o.status in ('entregado', 'entregado_parcial') then 'enviado'
                 else o.status end;
  if target is distinct from o.status then
    perform set_config('fuel.internal', 'on', true);
    update public.fuel_orders set status = target where id = o.id;
    perform set_config('fuel.internal', 'off', true);
  end if;
  return null;
end $$;
create trigger fuel_deliveries_estado_pedido after insert or update or delete on public.fuel_deliveries
  for each row execute function public.refresh_order_delivery_status();

-- Consumo: solo sobre etapas realizadas.
create or replace function public.fuel_consumption_check() returns trigger
language plpgsql set search_path = '' as $$
declare st public.stage_status;
begin
  select status into st from public.fracture_stages where id = new.stage_id;
  if st is distinct from 'realizada' then
    raise exception 'Solo se puede registrar consumo en etapas realizadas (estado actual: %).', st using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and new.stage_id <> old.stage_id then
    raise exception 'Un consumo no se puede pasar a otra etapa.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger fuel_consumption_reglas before insert or update on public.fuel_consumption for each row execute function public.fuel_consumption_check();

-- Etapas: una etapa con consumo no puede dejar de estar realizada ni cambiar de pozo.
create or replace function public.fracture_stages_check() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.fuel_consumption c where c.stage_id = old.id)
     and (new.status <> 'realizada' or new.well_id <> old.well_id) then
    raise exception 'La etapa tiene consumo registrado: no se puede cancelar, volver a planificada ni cambiar de pozo.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger fracture_stages_reglas before update on public.fracture_stages for each row execute function public.fracture_stages_check();

-- Pozos: no se pueden mover de PAD si ya tienen etapas registradas.
create or replace function public.wells_check() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.pad_id <> old.pad_id and exists (select 1 from public.fracture_stages s where s.well_id = old.id) then
    raise exception 'El pozo % tiene etapas registradas: no se puede asignar a otro PAD.', old.code using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger wells_reglas before update on public.wells for each row execute function public.wells_check();

-- Auditoría: registra toda alta, modificación y baja de las tablas operativas.
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_logs (table_name, record_id, action, old_data, new_data, changed_by)
  values (
    tg_table_name,
    coalesce((to_jsonb(new) ->> 'id')::uuid, (to_jsonb(old) ->> 'id')::uuid),
    lower(tg_op),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end,
    auth.uid());
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles', 'pads', 'wells', 'fracture_stages', 'fuel_orders', 'fuel_deliveries', 'fuel_consumption', 'inventory_movements']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()', t || '_audit', t);
  end loop;
end $$;

-- Alta automática de perfil al registrarse un usuario (queda pendiente de aprobación).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), nullif(btrim(new.raw_user_meta_data ->> 'name'), ''), split_part(coalesce(new.email, ''), '@', 1)));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
