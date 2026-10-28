-- Fuel Management | Frac Operations — Fase 1: cálculos.
-- Todo se calcula desde los registros operativos; no hay totales guardados que puedan desincronizarse.
-- security_invoker: cada vista respeta la seguridad por fila de quien consulta.

-- Libro de stock: una línea por cada hecho que mueve combustible en un PAD.
create view public.v_stock_ledger with (security_invoker = true) as
  select m.pad_id, m.occurred_at, m.liters as delta, m.movement_type::text as source, m.id as source_id
  from public.inventory_movements m
  where m.movement_type in ('stock_inicial', 'ajuste_ingreso')
  union all
  select m.pad_id, m.occurred_at, -m.liters, m.movement_type::text, m.id
  from public.inventory_movements m
  where m.movement_type in ('ajuste_egreso', 'salida')
  union all
  select m.pad_id, m.occurred_at, -m.liters, 'transferencia_salida', m.id
  from public.inventory_movements m
  where m.movement_type = 'transferencia'
  union all
  select m.to_pad_id, m.occurred_at, m.liters, 'transferencia_ingreso', m.id
  from public.inventory_movements m
  where m.movement_type = 'transferencia'
  union all
  -- Entregas efectivas: único ingreso operativo. Un pedido sin entrega no suma stock.
  select o.pad_id, d.delivered_at, d.liters, 'entrega', d.id
  from public.fuel_deliveries d
  join public.fuel_orders o on o.id = d.order_id
  union all
  -- Consumos por etapa realizada.
  select w.pad_id, s.executed_at, -c.liters, 'consumo', c.id
  from public.fuel_consumption c
  join public.fracture_stages s on s.id = c.stage_id
  join public.wells w on w.id = s.well_id;

-- Consumo por pozo: etapas realizadas con consumo y promedio.
create view public.v_well_consumption with (security_invoker = true) as
  select
    w.id as well_id, w.code as well_code, w.name as well_name, w.pad_id,
    count(s.id) filter (where s.status = 'realizada') as stages_done,
    count(c.id) as stages_with_consumption,
    coalesce(sum(c.liters), 0) as consumption_liters,
    case when count(c.id) > 0 then round(sum(c.liters) / count(c.id), 2) end as avg_liters_per_stage
  from public.wells w
  left join public.fracture_stages s on s.well_id = w.id
  left join public.fuel_consumption c on c.stage_id = s.id
  group by w.id;

-- Consumo por PAD = suma de los consumos de todos sus pozos.
-- Promedio por etapa = consumo acumulado / etapas realizadas con consumo registrado (las canceladas no cuentan).
create view public.v_pad_consumption with (security_invoker = true) as
  select
    p.id as pad_id, p.code as pad_code, p.name as pad_name,
    count(distinct w.id) as wells,
    coalesce(sum(wc.stages_done), 0) as stages_done,
    coalesce(sum(wc.stages_with_consumption), 0) as stages_with_consumption,
    coalesce(sum(wc.consumption_liters), 0) as consumption_liters,
    case when coalesce(sum(wc.stages_with_consumption), 0) > 0
         then round(sum(wc.consumption_liters) / sum(wc.stages_with_consumption), 2) end as avg_liters_per_stage
  from public.pads p
  left join public.wells w on w.pad_id = p.id
  left join public.v_well_consumption wc on wc.well_id = w.id
  group by p.id;

-- Stock estimado por PAD y comparación con la última verificación física.
create view public.v_stock_by_pad with (security_invoker = true) as
  with totals as (
    select pad_id,
      sum(delta) filter (where source = 'stock_inicial') as initial_liters,
      sum(delta) filter (where source = 'entrega') as delivered_liters,
      -sum(delta) filter (where source = 'consumo') as consumed_liters,
      sum(delta) filter (where source in ('ajuste_ingreso', 'ajuste_egreso')) as adjustments_liters,
      -sum(delta) filter (where source = 'salida') as outflow_liters,
      sum(delta) filter (where source in ('transferencia_ingreso', 'transferencia_salida')) as transfers_net_liters,
      sum(delta) as estimated_liters
    from public.v_stock_ledger
    group by pad_id
  ),
  last_check as (
    select distinct on (pad_id) pad_id, liters as verified_liters, occurred_at as verified_at
    from public.inventory_movements
    where movement_type = 'verificacion_fisica'
    order by pad_id, occurred_at desc, created_at desc
  )
  select
    p.id as pad_id, p.code as pad_code, p.name as pad_name, p.active,
    coalesce(t.initial_liters, 0) as initial_liters,
    coalesce(t.delivered_liters, 0) as delivered_liters,
    coalesce(t.consumed_liters, 0) as consumed_liters,
    coalesce(t.adjustments_liters, 0) as adjustments_liters,
    coalesce(t.outflow_liters, 0) as outflow_liters,
    coalesce(t.transfers_net_liters, 0) as transfers_net_liters,
    coalesce(t.estimated_liters, 0) as estimated_liters,
    lc.verified_liters,
    lc.verified_at,
    -- Estimado a la fecha de la verificación, para medir la diferencia en el mismo momento.
    (select coalesce(sum(l.delta), 0) from public.v_stock_ledger l where l.pad_id = p.id and l.occurred_at <= lc.verified_at) as estimated_at_verification,
    lc.verified_liters - (select coalesce(sum(l.delta), 0) from public.v_stock_ledger l where l.pad_id = p.id and l.occurred_at <= lc.verified_at) as verification_difference
  from public.pads p
  left join totals t on t.pad_id = p.id
  left join last_check lc on lc.pad_id = p.id;

-- Consolidado general.
create view public.v_stock_total with (security_invoker = true) as
  select
    coalesce(sum(initial_liters), 0) as initial_liters,
    coalesce(sum(delivered_liters), 0) as delivered_liters,
    coalesce(sum(consumed_liters), 0) as consumed_liters,
    coalesce(sum(adjustments_liters), 0) as adjustments_liters,
    coalesce(sum(outflow_liters), 0) as outflow_liters,
    coalesce(sum(estimated_liters), 0) as estimated_liters
  from public.v_stock_by_pad;

grant select on public.v_stock_ledger, public.v_well_consumption, public.v_pad_consumption, public.v_stock_by_pad, public.v_stock_total to authenticated;
