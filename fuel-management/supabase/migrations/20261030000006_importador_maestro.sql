-- Fuel Management | Frac Operations — Fase 3: importador del maestro de PADs y pozos.
-- Las filas llegan como datos JSON (nunca como SQL construido desde el Excel). La función valida,
-- clasifica y, si se confirma, importa los registros válidos en una única transacción.
-- Nunca borra PADs ni pozos ni toca pedidos, entregas, consumos, etapas o inventario.

create table public.import_logs (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  sheet_name text not null default '',
  rows_processed integer not null,
  pads_created integer not null,
  pads_updated integer not null,
  wells_created integer not null,
  wells_updated integer not null,
  unchanged integer not null,
  duplicates integer not null,
  errors integer not null,
  error_rows jsonb not null default '[]',
  imported_by uuid references public.profiles (id),
  imported_at timestamptz not null default now()
);
alter table public.import_logs enable row level security;
revoke all on public.import_logs from anon, authenticated;
grant select on public.import_logs to authenticated;
create policy import_logs_select on public.import_logs for select to authenticated using (public.has_role('administrador', 'supervision'));

/*
  p_rows: [{ "row": 2, "pad_code": "LA-WP130", "pad_name": "...", "well_code": "LA-750(h)", "well_name": "...",
             "planned_stages": "20", "operational_status": "..." }, ...]
  Campos vacíos o ausentes = "no informado": al actualizar se conserva el valor existente.
  Devuelve { summary: {...}, rows: [{ row, status, pad_action, well_action, message }], log_id }.
*/
create or replace function public.import_master(p_file_name text, p_sheet_name text, p_rows jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
  result jsonb;
  log_id uuid;
  s record;
begin
  if not public.has_role('administrador') then
    raise exception 'Solo un administrador puede importar el maestro de PADs y pozos.' using errcode = 'insufficient_privilege';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'El contenido a importar no tiene el formato esperado.' using errcode = 'invalid_parameter_value';
  end if;
  n := jsonb_array_length(p_rows);
  if n = 0 then
    raise exception 'El archivo no tiene filas de datos.' using errcode = 'invalid_parameter_value';
  end if;
  if n > 5000 then
    raise exception 'El archivo tiene % filas; el máximo por importación es 5.000.', n using errcode = 'invalid_parameter_value';
  end if;

  if to_regclass('pg_temp.imp') is not null then drop table pg_temp.imp; end if;
  create temp table imp on commit drop as
  select
    case when e.val ->> 'row' ~ '^\d{1,7}$' then (e.val ->> 'row')::integer else e.ord::integer + 1 end as row_no,
    nullif(btrim(e.val ->> 'pad_code'), '') as pad_code,
    nullif(btrim(e.val ->> 'pad_name'), '') as pad_name,
    nullif(btrim(e.val ->> 'well_code'), '') as well_code,
    nullif(btrim(e.val ->> 'well_name'), '') as well_name,
    nullif(btrim(e.val ->> 'planned_stages'), '') as planned_raw,
    null::integer as planned_stages,
    nullif(btrim(e.val ->> 'operational_status'), '') as op_status,
    null::text as status,       -- error | duplicado | ok
    null::text as message,
    null::text as pad_action,   -- nuevo | actualiza | sin_cambios
    null::text as well_action
  from jsonb_array_elements(p_rows) with ordinality as e(val, ord)
  where jsonb_typeof(e.val) = 'object';

  -- 1. Validaciones de cada fila.
  update imp set status = 'error', message = 'Falta el código del PAD.' where pad_code is null;
  update imp set status = 'error', message = 'El código del PAD supera 60 caracteres.' where status is null and length(pad_code) > 60;
  update imp set status = 'error', message = 'El nombre del PAD supera 120 caracteres.' where status is null and length(pad_name) > 120;
  update imp set status = 'error', message = 'Hay nombre de pozo pero falta su código.' where status is null and well_code is null and well_name is not null;
  update imp set status = 'error', message = 'El código del pozo supera 60 caracteres.' where status is null and length(well_code) > 60;
  update imp set status = 'error', message = 'El nombre del pozo supera 120 caracteres.' where status is null and length(well_name) > 120;
  update imp set status = 'error', message = 'El estado operativo supera 60 caracteres.' where status is null and length(op_status) > 60;
  update imp set status = 'error', message = format('Etapas planificadas inválidas: “%s” (debe ser un entero entre 0 y 200).', planned_raw)
    where status is null and planned_raw is not null and (planned_raw !~ '^\d{1,3}$' or planned_raw::integer > 200);
  update imp set planned_stages = planned_raw::integer where status is null and planned_raw is not null;

  -- 2. Duplicados exactos dentro del archivo: se informan y se ignoran.
  update imp i set status = 'duplicado', message = format('Fila repetida (igual a la fila %s).', d.first_row)
  from (
    select row_no, min(row_no) over (partition by lower(pad_code), lower(coalesce(well_code, '')), pad_name, well_name, planned_stages, op_status) as first_row
    from imp where status is null
  ) d
  where i.row_no = d.row_no and d.row_no <> d.first_row;

  -- 3. Contradicciones dentro del archivo.
  update imp i set status = 'error', message = format('El pozo %s figura en más de un PAD dentro del archivo.', i.well_code)
  where i.status is null and i.well_code is not null and exists (
    select 1 from imp j where j.status is distinct from 'error' and lower(j.well_code) = lower(i.well_code) and lower(j.pad_code) <> lower(i.pad_code));
  update imp i set status = 'error', message = format('El pozo %s tiene datos distintos en otra fila del archivo.', i.well_code)
  where i.status is null and i.well_code is not null and exists (
    select 1 from imp j where j.status is null and j.row_no <> i.row_no and lower(j.well_code) = lower(i.well_code)
      and (j.well_name, j.planned_stages, j.op_status) is distinct from (i.well_name, i.planned_stages, i.op_status));
  update imp i set status = 'error', message = format('El PAD %s tiene nombres distintos dentro del archivo.', i.pad_code)
  where i.status is null and i.pad_name is not null and exists (
    select 1 from imp j where j.status is null and lower(j.pad_code) = lower(i.pad_code) and j.pad_name is not null and j.pad_name <> i.pad_name);

  -- 4. Contra el maestro existente: un pozo no cambia de PAD por importación.
  update imp i set status = 'error',
    message = format('El pozo %s ya existe en el PAD %s. Para moverlo, modifíquelo desde PADs y Pozos.', w.code, p.code)
  from public.wells w join public.pads p on p.id = w.pad_id
  where i.status is null and i.well_code is not null and lower(w.code) = lower(i.well_code) and lower(p.code) <> lower(i.pad_code);

  update imp set status = 'ok' where status is null;

  -- 5. Clasificación de PADs.
  update imp i set pad_action = case
      when p.id is null then 'nuevo'
      when not p.active or (i.pad_name is not null and i.pad_name <> p.name) then 'actualiza'
      else 'sin_cambios' end
  from (select distinct lower(pad_code) as k from imp where status = 'ok') c
  left join public.pads p on lower(p.code) = c.k
  where i.status = 'ok' and lower(i.pad_code) = c.k;

  -- 6. Clasificación de pozos.
  update imp i set well_action = case
      when w.id is null then 'nuevo'
      when (i.well_name is not null and i.well_name <> w.name)
        or (i.planned_stages is not null and i.planned_stages is distinct from w.planned_stages)
        or (i.op_status is not null and i.op_status is distinct from w.operational_status)
        or not w.active then 'actualiza'
      else 'sin_cambios' end
  from (select distinct lower(well_code) as k from imp where status = 'ok' and well_code is not null) c
  left join public.wells w on lower(w.code) = c.k
  where i.status = 'ok' and lower(i.well_code) = c.k;

  -- 7. Aplicar (solo si se confirmó). Todo en esta misma transacción.
  if not p_dry_run then
    insert into public.pads (code, name)
    select distinct on (lower(pad_code)) pad_code, coalesce(pad_name, pad_code)
    from imp where status = 'ok' and pad_action = 'nuevo'
    order by lower(pad_code), row_no;

    update public.pads p set name = coalesce(c.pad_name, p.name), active = true
    from (select distinct on (lower(pad_code)) pad_code, pad_name from imp where status = 'ok' and pad_action = 'actualiza' order by lower(pad_code), row_no) c
    where lower(p.code) = lower(c.pad_code);

    insert into public.wells (pad_id, code, name, planned_stages, operational_status)
    select distinct on (lower(i.well_code)) p.id, i.well_code, coalesce(i.well_name, i.well_code), i.planned_stages, i.op_status
    from imp i join public.pads p on lower(p.code) = lower(i.pad_code)
    where i.status = 'ok' and i.well_action = 'nuevo'
    order by lower(i.well_code), i.row_no;

    update public.wells w set
      name = coalesce(c.well_name, w.name),
      planned_stages = coalesce(c.planned_stages, w.planned_stages),
      operational_status = coalesce(c.op_status, w.operational_status),
      active = true
    from (select distinct on (lower(well_code)) * from imp where status = 'ok' and well_action = 'actualiza' order by lower(well_code), row_no) c
    where lower(w.code) = lower(c.well_code);
  end if;

  select
    count(*) as rows_processed,
    count(distinct lower(pad_code)) filter (where status = 'ok' and pad_action = 'nuevo') as pads_created,
    count(distinct lower(pad_code)) filter (where status = 'ok' and pad_action = 'actualiza') as pads_updated,
    count(distinct lower(well_code)) filter (where status = 'ok' and well_action = 'nuevo') as wells_created,
    count(distinct lower(well_code)) filter (where status = 'ok' and well_action = 'actualiza') as wells_updated,
    count(*) filter (where status = 'ok' and coalesce(well_action, pad_action) = 'sin_cambios') as unchanged,
    count(*) filter (where status = 'duplicado') as duplicates,
    count(*) filter (where status = 'error') as errors
  into s from imp;

  if not p_dry_run then
    insert into public.import_logs (file_name, sheet_name, rows_processed, pads_created, pads_updated, wells_created, wells_updated, unchanged, duplicates, errors, error_rows, imported_by)
    values (left(coalesce(p_file_name, ''), 200), left(coalesce(p_sheet_name, ''), 100), s.rows_processed, s.pads_created, s.pads_updated, s.wells_created, s.wells_updated,
            s.unchanged, s.duplicates, s.errors,
            coalesce((select jsonb_agg(jsonb_build_object('row', row_no, 'message', message) order by row_no) from (select row_no, message from imp where status = 'error' order by row_no limit 500) e), '[]'),
            auth.uid())
    returning id into log_id;
  end if;

  select jsonb_build_object(
    'dry_run', p_dry_run,
    'log_id', log_id,
    'summary', to_jsonb(s),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
        'row', row_no, 'pad_code', pad_code, 'well_code', well_code,
        'status', case when status = 'ok' then coalesce(well_action, pad_action) else status end,
        'pad_action', pad_action, 'well_action', well_action, 'message', message) order by row_no), '[]'))
  into result from imp;
  return result;
end $$;

revoke all on function public.import_master(text, text, jsonb, boolean) from public, anon;
grant execute on function public.import_master(text, text, jsonb, boolean) to authenticated;
