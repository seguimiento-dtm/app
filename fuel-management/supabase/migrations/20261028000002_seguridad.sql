-- Fuel Management | Frac Operations — Fase 1: seguridad.
-- Roles:  administrador = configuración y usuarios
--         operaciones   = etapas y consumos
--         logistica     = pedidos, entregas y movimientos de stock
--         supervision   = consulta de indicadores e informes
-- Un usuario sin rol o inactivo no accede a ningún dato. Los permisos se validan aquí,
-- con seguridad a nivel de fila, no ocultando botones en la interfaz.

-- ---------------------------------------------------------------- funciones de rol
create or replace function public.current_app_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.active
$$;

create or replace function public.has_role(variadic roles public.app_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_app_role() = any (roles), false)
$$;

create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.current_app_role() is not null
$$;

-- ---------------------------------------------------------------- privilegios de tabla
-- Supabase otorga todo por defecto; se restringe explícitamente.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, public;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, public;

grant usage on schema public to authenticated;
grant execute on function public.current_app_role(), public.has_role(public.app_role[]), public.is_active_user() to authenticated;

grant select on public.profiles to authenticated;

grant select, delete on public.pads, public.wells to authenticated;
grant insert (code, name, area, active) on public.pads to authenticated;
grant update (code, name, area, active) on public.pads to authenticated;
grant insert (pad_id, code, name, planned_stages, operational_status, active) on public.wells to authenticated;
grant update (pad_id, code, name, planned_stages, operational_status, active) on public.wells to authenticated;

grant select, delete on public.fracture_stages to authenticated;
grant insert (well_id, stage_number, status, planned_date, executed_at, notes) on public.fracture_stages to authenticated;
grant update (well_id, stage_number, status, planned_date, executed_at, notes) on public.fracture_stages to authenticated;

grant select on public.fuel_orders to authenticated;
grant insert (pad_id, trips, required_date, status, notes) on public.fuel_orders to authenticated;
grant update (pad_id, trips, required_date, status, notes, cancel_reason) on public.fuel_orders to authenticated;

grant select on public.fuel_deliveries to authenticated;
grant insert (order_id, delivered_at, liters, document_number, carrier, notes) on public.fuel_deliveries to authenticated;
grant update (delivered_at, liters, document_number, carrier, notes) on public.fuel_deliveries to authenticated;

grant select on public.fuel_consumption to authenticated;
grant insert (stage_id, liters, notes) on public.fuel_consumption to authenticated;
grant update (liters, notes) on public.fuel_consumption to authenticated;

grant select on public.inventory_movements to authenticated;
grant insert (movement_type, pad_id, to_pad_id, liters, occurred_at, reason) on public.inventory_movements to authenticated;

grant select on public.audit_logs to authenticated;

-- ---------------------------------------------------------------- RLS
alter table public.profiles enable row level security;
alter table public.pads enable row level security;
alter table public.wells enable row level security;
alter table public.fracture_stages enable row level security;
alter table public.order_counters enable row level security;
alter table public.fuel_orders enable row level security;
alter table public.fuel_deliveries enable row level security;
alter table public.fuel_consumption enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.audit_logs enable row level security;

-- Perfiles: cada uno ve el suyo (también si está pendiente); los usuarios activos ven al resto
-- para mostrar quién registró cada operación. Los cambios de rol van por función de administración.
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_active_user());

-- Catálogo de PADs y pozos: lectura para usuarios activos; alta y cambios solo administrador.
create policy pads_select on public.pads for select to authenticated using (public.is_active_user());
create policy pads_insert on public.pads for insert to authenticated with check (public.has_role('administrador'));
create policy pads_update on public.pads for update to authenticated using (public.has_role('administrador')) with check (public.has_role('administrador'));
create policy pads_delete on public.pads for delete to authenticated using (public.has_role('administrador'));

create policy wells_select on public.wells for select to authenticated using (public.is_active_user());
create policy wells_insert on public.wells for insert to authenticated with check (public.has_role('administrador'));
create policy wells_update on public.wells for update to authenticated using (public.has_role('administrador')) with check (public.has_role('administrador'));
create policy wells_delete on public.wells for delete to authenticated using (public.has_role('administrador'));

-- Etapas y consumos: Operaciones (y Administrador).
create policy stages_select on public.fracture_stages for select to authenticated using (public.is_active_user());
create policy stages_insert on public.fracture_stages for insert to authenticated with check (public.has_role('administrador', 'operaciones'));
create policy stages_update on public.fracture_stages for update to authenticated
  using (public.has_role('administrador', 'operaciones')) with check (public.has_role('administrador', 'operaciones'));
create policy stages_delete on public.fracture_stages for delete to authenticated using (public.has_role('administrador', 'operaciones'));

create policy consumption_select on public.fuel_consumption for select to authenticated using (public.is_active_user());
create policy consumption_insert on public.fuel_consumption for insert to authenticated with check (public.has_role('administrador', 'operaciones'));
create policy consumption_update on public.fuel_consumption for update to authenticated
  using (public.has_role('administrador', 'operaciones')) with check (public.has_role('administrador', 'operaciones'));

-- Pedidos y entregas: Logística (y Administrador).
create policy orders_select on public.fuel_orders for select to authenticated using (public.is_active_user());
create policy orders_insert on public.fuel_orders for insert to authenticated with check (public.has_role('administrador', 'logistica'));
create policy orders_update on public.fuel_orders for update to authenticated
  using (public.has_role('administrador', 'logistica')) with check (public.has_role('administrador', 'logistica'));

create policy deliveries_select on public.fuel_deliveries for select to authenticated using (public.is_active_user());
create policy deliveries_insert on public.fuel_deliveries for insert to authenticated with check (public.has_role('administrador', 'logistica'));
create policy deliveries_update on public.fuel_deliveries for update to authenticated
  using (public.has_role('administrador', 'logistica')) with check (public.has_role('administrador', 'logistica'));

-- Movimientos de stock: Logística y Administrador; Operaciones puede cargar verificaciones físicas.
-- No se editan ni borran: las correcciones se hacen con un ajuste nuevo.
create policy movements_select on public.inventory_movements for select to authenticated using (public.is_active_user());
create policy movements_insert on public.inventory_movements for insert to authenticated with check (
  public.has_role('administrador', 'logistica')
  or (movement_type = 'verificacion_fisica' and public.has_role('operaciones')));

-- Auditoría: lectura para Administrador y Supervisión. Solo escriben los triggers.
create policy audit_select on public.audit_logs for select to authenticated using (public.has_role('administrador', 'supervision'));

-- order_counters: sin políticas (solo lo usa el trigger de numeración).

-- ---------------------------------------------------------------- funciones de usuario
-- Administración de usuarios: aprobar, asignar rol, activar o desactivar.
create or replace function public.admin_update_user(target uuid, new_role public.app_role, new_active boolean, new_full_name text default null)
returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  prev public.profiles;
  result public.profiles;
begin
  if not public.has_role('administrador') then
    raise exception 'Solo un administrador puede modificar usuarios.' using errcode = 'insufficient_privilege';
  end if;
  select * into prev from public.profiles where id = target for update;
  if not found then
    raise exception 'Usuario inexistente.' using errcode = 'no_data_found';
  end if;
  if target = me and (new_role is distinct from 'administrador' or not new_active) then
    raise exception 'No puede quitarse el rol de administrador ni desactivar su propio usuario.' using errcode = 'check_violation';
  end if;
  if new_active and new_role is null then
    raise exception 'Asigne un rol para activar el usuario.' using errcode = 'check_violation';
  end if;
  update public.profiles set
    role = new_role,
    active = new_active,
    full_name = coalesce(nullif(btrim(new_full_name), ''), full_name),
    approved_by = case when new_active and not prev.active then me else approved_by end,
    approved_at = case when new_active and not prev.active then now() else approved_at end
  where id = target
  returning * into result;
  return result;
end $$;

create or replace function public.update_my_profile(new_full_name text) returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare result public.profiles;
begin
  if length(btrim(coalesce(new_full_name, ''))) = 0 then
    raise exception 'Ingrese su nombre.' using errcode = 'check_violation';
  end if;
  update public.profiles set full_name = btrim(new_full_name) where id = auth.uid() returning * into result;
  return result;
end $$;

grant execute on function public.admin_update_user(uuid, public.app_role, boolean, text), public.update_my_profile(text) to authenticated;

-- Primer administrador: ejecutar UNA vez desde el SQL Editor de Supabase (no está disponible para la app).
create or replace function public.bootstrap_admin(user_email text) returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare result public.profiles;
begin
  if exists (select 1 from public.profiles where role = 'administrador' and active) then
    raise exception 'Ya existe un administrador activo. Use la pantalla de Usuarios.';
  end if;
  update public.profiles set role = 'administrador', active = true, approved_at = now()
  where lower(email) = lower(btrim(user_email)) returning * into result;
  if result.id is null then
    raise exception 'No existe un usuario registrado con el correo %.', user_email;
  end if;
  return result;
end $$;
revoke all on function public.bootstrap_admin(text) from public, anon, authenticated;
