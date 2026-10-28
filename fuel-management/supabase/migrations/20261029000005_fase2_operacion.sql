-- Fuel Management | Frac Operations — Fase 2: pedidos, etapas, entregas e inventario.

-- ---------------------------------------------------------------- parámetros generales
create table public.app_settings (
  key text primary key,
  value text not null,
  description text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);
insert into public.app_settings (key, value, description) values
  ('order_recipient', 'mperez5@pan-energy.com', 'Destinatario de las solicitudes de combustible');

create trigger app_settings_updated_at before update on public.app_settings for each row execute function public.set_updated_at();
create trigger app_settings_actor before update on public.app_settings for each row execute function public.stamp_actor();
create trigger app_settings_audit after insert or update or delete on public.app_settings for each row execute function public.audit_row();

alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;
grant select on public.app_settings to authenticated;
grant update (value) on public.app_settings to authenticated;
create policy settings_select on public.app_settings for select to authenticated using (public.is_active_user());
create policy settings_update on public.app_settings for update to authenticated
  using (public.has_role('administrador')) with check (public.has_role('administrador'));

-- La auditoría de app_settings usa "key" como identificador (no tiene id uuid).
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare rid text := coalesce(to_jsonb(new) ->> 'id', to_jsonb(old) ->> 'id');
begin
  insert into public.audit_logs (table_name, record_id, action, old_data, new_data, changed_by)
  values (
    tg_table_name,
    case when rid ~ '^[0-9a-f-]{36}$' then rid::uuid end,
    lower(tg_op),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end,
    auth.uid());
  return null;
end $$;

-- ---------------------------------------------------------------- pedidos: PAD activo y transiciones de estado
create or replace function public.fuel_orders_pad_activo() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (tg_op = 'INSERT' or new.pad_id <> old.pad_id)
     and not exists (select 1 from public.pads p where p.id = new.pad_id and p.active) then
    raise exception 'El PAD seleccionado está inactivo y no admite pedidos nuevos.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger fuel_orders_pad_activo before insert or update on public.fuel_orders for each row execute function public.fuel_orders_pad_activo();

-- Reemplaza la regla de la Fase 1 agregando las transiciones permitidas.
create or replace function public.fuel_orders_before_update() returns trigger
language plpgsql set search_path = '' as $$
declare
  internal boolean := coalesce(current_setting('fuel.internal', true), '') = 'on';
  has_deliveries boolean := exists (select 1 from public.fuel_deliveries d where d.order_id = old.id);
begin
  if new.order_number <> old.order_number or new.trip_capacity_liters <> old.trip_capacity_liters then
    raise exception 'El número de pedido y la capacidad por viaje no se pueden modificar.' using errcode = 'check_violation';
  end if;
  if old.status = 'cancelado' and not internal
     and (new.status, new.pad_id, new.trips, new.required_date, new.notes, new.cancel_reason)
         is distinct from (old.status, old.pad_id, old.trips, old.required_date, old.notes, old.cancel_reason) then
    raise exception 'Un pedido cancelado no se puede modificar.' using errcode = 'check_violation';
  end if;
  if new.status is distinct from old.status and not internal then
    if new.status in ('entregado_parcial', 'entregado') then
      raise exception 'El estado de entrega se calcula a partir de las entregas registradas.' using errcode = 'check_violation';
    end if;
    if not ((old.status = 'borrador' and new.status = 'solicitado')
         or (old.status = 'solicitado' and new.status = 'enviado')
         or (new.status = 'cancelado' and old.status in ('borrador', 'solicitado', 'enviado'))) then
      raise exception 'No se permite pasar un pedido de % a %.', old.status, new.status using errcode = 'check_violation';
    end if;
    if new.status = 'cancelado' and has_deliveries then
      raise exception 'El pedido tiene entregas registradas y no se puede cancelar.' using errcode = 'check_violation';
    end if;
  end if;
  if (new.pad_id, new.trips, new.required_date) is distinct from (old.pad_id, old.trips, old.required_date) then
    if has_deliveries then
      raise exception 'No se puede cambiar el PAD, los viajes ni la fecha de un pedido con entregas registradas.' using errcode = 'check_violation';
    end if;
    if old.status not in ('borrador', 'solicitado') then
      raise exception 'Solo se pueden modificar pedidos en borrador o solicitados (estado actual: %).', old.status using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- etapas: pozo activo al crear
create or replace function public.fracture_stages_pozo_activo() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (tg_op = 'INSERT' or new.well_id <> old.well_id)
     and not exists (select 1 from public.wells w join public.pads p on p.id = w.pad_id where w.id = new.well_id and w.active and p.active) then
    raise exception 'El pozo o su PAD están inactivos: no admiten etapas nuevas.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger fracture_stages_pozo_activo before insert or update on public.fracture_stages for each row execute function public.fracture_stages_pozo_activo();

-- Planificar etapas 1..N de un pozo (las existentes no se tocan). Corre con los permisos de quien llama.
create or replace function public.plan_stages(p_well_id uuid, p_count integer, p_planned_date date default null)
returns integer
language plpgsql security invoker set search_path = '' as $$
declare created integer;
begin
  if p_count is null or p_count < 1 or p_count > 200 then
    raise exception 'Indique entre 1 y 200 etapas.' using errcode = 'check_violation';
  end if;
  insert into public.fracture_stages (well_id, stage_number, status, planned_date)
  select p_well_id, n, 'planificada', p_planned_date from generate_series(1, p_count) n
  on conflict (well_id, stage_number) do nothing;
  get diagnostics created = row_count;
  return created;
end $$;

-- Registrar una etapa realizada con su consumo, en una sola operación.
-- Si la etapa no existe se crea; si estaba planificada pasa a realizada. Corre con los permisos de quien llama.
create or replace function public.register_stage_consumption(
  p_well_id uuid, p_stage_number integer, p_executed_at timestamptz, p_liters numeric, p_notes text default '')
returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  st public.fracture_stages;
  cid uuid;
  wcode text;
begin
  select code into wcode from public.wells where id = p_well_id;
  if wcode is null then
    raise exception 'Pozo inexistente.' using errcode = 'no_data_found';
  end if;
  if p_executed_at is null then
    raise exception 'Indique la fecha y hora de la etapa.' using errcode = 'check_violation';
  end if;
  if p_executed_at > now() + interval '1 hour' then
    raise exception 'La fecha de la etapa no puede ser futura.' using errcode = 'check_violation';
  end if;
  select * into st from public.fracture_stages where well_id = p_well_id and stage_number = p_stage_number for update;
  if found then
    if st.status = 'cancelada' then
      raise exception 'La etapa % del pozo % está cancelada.', p_stage_number, wcode using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.fuel_consumption c where c.stage_id = st.id) then
      raise exception 'La etapa % del pozo % ya tiene consumo registrado.', p_stage_number, wcode using errcode = 'unique_violation';
    end if;
    update public.fracture_stages set status = 'realizada', executed_at = p_executed_at where id = st.id;
  else
    insert into public.fracture_stages (well_id, stage_number, status, executed_at)
    values (p_well_id, p_stage_number, 'realizada', p_executed_at) returning * into st;
  end if;
  insert into public.fuel_consumption (stage_id, liters, notes) values (st.id, p_liters, coalesce(p_notes, '')) returning id into cid;
  return cid;
end $$;

grant execute on function public.plan_stages(uuid, integer, date), public.register_stage_consumption(uuid, integer, timestamptz, numeric, text) to authenticated;

-- ---------------------------------------------------------------- vistas de detalle
create view public.v_orders with (security_invoker = true) as
  select
    o.*,
    p.code as pad_code, p.name as pad_name,
    coalesce(d.delivered_liters, 0) as delivered_liters,
    greatest(o.requested_liters - coalesce(d.delivered_liters, 0), 0) as pending_liters,
    coalesce(d.deliveries, 0) as deliveries,
    d.last_delivery_at,
    pr.full_name as requested_by_name
  from public.fuel_orders o
  join public.pads p on p.id = o.pad_id
  left join (
    select order_id, sum(liters) as delivered_liters, count(*) as deliveries, max(delivered_at) as last_delivery_at
    from public.fuel_deliveries group by order_id
  ) d on d.order_id = o.id
  left join public.profiles pr on pr.id = o.requested_by;

create view public.v_deliveries with (security_invoker = true) as
  select d.*, o.order_number, o.pad_id, p.code as pad_code, pr.full_name as received_by_name
  from public.fuel_deliveries d
  join public.fuel_orders o on o.id = d.order_id
  join public.pads p on p.id = o.pad_id
  left join public.profiles pr on pr.id = d.received_by;

create view public.v_stages with (security_invoker = true) as
  select
    s.*,
    w.code as well_code, w.pad_id, p.code as pad_code,
    c.id as consumption_id, c.liters as consumption_liters, c.notes as consumption_notes, c.recorded_by,
    pr.full_name as recorded_by_name
  from public.fracture_stages s
  join public.wells w on w.id = s.well_id
  join public.pads p on p.id = w.pad_id
  left join public.fuel_consumption c on c.stage_id = s.id
  left join public.profiles pr on pr.id = c.recorded_by;

create view public.v_movements with (security_invoker = true) as
  select m.*, p.code as pad_code, tp.code as to_pad_code, pr.full_name as created_by_name
  from public.inventory_movements m
  join public.pads p on p.id = m.pad_id
  left join public.pads tp on tp.id = m.to_pad_id
  left join public.profiles pr on pr.id = m.created_by;

grant select on public.v_orders, public.v_deliveries, public.v_stages, public.v_movements to authenticated;
