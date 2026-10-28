import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { errorMessage } from '../lib/errors';
import { date, downloadCsv, integer, liters, todayIso } from '../lib/format';
import { rows, useCatalog } from '../lib/queries';
import type { Delivery, Order, Stage, StockTotal } from '../lib/types';
import { Alert, Button, Card, EmptyState, Field, Input, PageHeader, Select, Spinner } from '../components/ui';

const TZ = 'America/Argentina/Buenos_Aires';
const localDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso));
const startIso = (d: string) => new Date(`${d}T00:00:00-03:00`).toISOString();
const endIso = (d: string) => new Date(new Date(`${d}T00:00:00-03:00`).getTime() + 864e5).toISOString();
const firstOfMonth = () => `${todayIso().slice(0, 8)}01`;
/** Lunes de la semana de una fecha AAAA-MM-DD. */
const weekOf = (d: string) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };

export default function ReportPage() {
  const catalog = useCatalog();
  const [f, setF] = useState({ from: firstOfMonth(), to: todayIso(), pad: '' });
  const valid = f.from && f.to && f.from <= f.to;
  const q = useQuery({
    queryKey: ['report', f],
    enabled: !!valid,
    queryFn: async () => {
      const a = startIso(f.from); const b = endIso(f.to);
      let st = supabase.from('v_stages').select('*').eq('status', 'realizada').gte('executed_at', a).lt('executed_at', b);
      let dl = supabase.from('v_deliveries').select('*').gte('delivered_at', a).lt('delivered_at', b);
      let od = supabase.from('v_orders').select('*').neq('status', 'cancelado').neq('status', 'borrador').gte('created_at', a).lt('created_at', b);
      if (f.pad) { st = st.eq('pad_id', f.pad); dl = dl.eq('pad_id', f.pad); od = od.eq('pad_id', f.pad); }
      const [stages, deliveries, orders, stock] = await Promise.all([
        rows<Stage[]>(st), rows<Delivery[]>(dl), rows<Order[]>(od),
        rows<StockTotal | null>(supabase.from('v_stock_total').select('*').maybeSingle()),
      ]);
      return { stages, deliveries, orders, stock };
    },
  });

  const r = useMemo(() => {
    if (!q.data) return null;
    const { stages, deliveries, orders } = q.data;
    const withCons = stages.filter((s) => s.consumption_liters !== null);
    const consumed = withCons.reduce((s, x) => s + Number(x.consumption_liters), 0);
    const delivered = deliveries.reduce((s, x) => s + Number(x.liters), 0);
    const requested = orders.reduce((s, x) => s + Number(x.requested_liters), 0);
    const ordersDelivered = orders.reduce((s, x) => s + Number(x.delivered_liters), 0);
    const pads = new Map<string, { pad: string; stages: number; consumed: number; requested: number; delivered: number }>();
    const row = (code: string) => pads.get(code) ?? pads.set(code, { pad: code, stages: 0, consumed: 0, requested: 0, delivered: 0 }).get(code)!;
    for (const s of withCons) { const x = row(s.pad_code); x.stages += 1; x.consumed += Number(s.consumption_liters); }
    for (const o of orders) row(o.pad_code).requested += Number(o.requested_liters);
    for (const d of deliveries) row(d.pad_code).delivered += Number(d.liters);
    const weeks = new Map<string, { week: string; consumed: number; delivered: number }>();
    for (let w = weekOf(f.from); w <= f.to; ) {
      weeks.set(w, { week: w, consumed: 0, delivered: 0 });
      const nx = new Date(`${w}T00:00:00Z`); nx.setUTCDate(nx.getUTCDate() + 7); w = nx.toISOString().slice(0, 10);
    }
    for (const s of withCons) { const w = weeks.get(weekOf(localDay(s.executed_at!))); if (w) w.consumed += Number(s.consumption_liters); }
    for (const d of deliveries) { const w = weeks.get(weekOf(localDay(d.delivered_at))); if (w) w.delivered += Number(d.liters); }
    return {
      consumed, delivered, requested, stages: withCons.length, avg: withCons.length ? consumed / withCons.length : null,
      fulfillment: requested ? (ordersDelivered / requested) * 100 : null, orders: orders.length,
      byPad: [...pads.values()].sort((a, b) => b.consumed - a.consumed || b.delivered - a.delivered),
      weeks: [...weeks.values()],
    };
  }, [q.data, f.from, f.to]);

  function exportCsv() {
    if (!r) return;
    downloadCsv(`reporte_gerencial_${f.from}_${f.to}.csv`,
      ['PAD', 'Etapas con consumo', 'Consumo (L)', 'Promedio por etapa (L)', 'Solicitado (L)', 'Entregado (L)'],
      r.byPad.map((x) => [x.pad, x.stages, x.consumed, x.stages ? Math.round(x.consumed / x.stages) : '', x.requested, x.delivered]));
  }

  return (
    <>
      <PageHeader eyebrow="Gerencia" title="Reporte Gerencial" description="Indicadores del período seleccionado, calculados desde los registros operativos." />
      <Card className="mb-6">
        <div className="grid gap-4 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto] sm:items-end">
          <Field label="Desde" htmlFor="r-from"><Input id="r-from" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
          <Field label="Hasta" htmlFor="r-to"><Input id="r-to" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
          <Field label="PAD" htmlFor="r-pad">
            <Select id="r-pad" value={f.pad} onChange={(e) => setF({ ...f, pad: e.target.value })}>
              <option value="">Todos los PADs</option>{(catalog.data?.pads ?? []).map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
            </Select>
          </Field>
          <Button onClick={exportCsv} disabled={!r?.byPad.length}><Download className="h-4 w-4" /> Exportar CSV</Button>
        </div>
        {!valid && <Alert tone="warning" className="mt-4">La fecha “desde” debe ser anterior o igual a “hasta”.</Alert>}
      </Card>

      {q.isLoading && <Spinner />}
      {q.error && <Alert tone="error">{errorMessage(q.error)}</Alert>}
      {r && q.data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Consumo del período" value={liters(r.consumed)} sub={`${integer(r.stages)} etapas con consumo`} />
            <Kpi label="Promedio por etapa" value={r.avg === null ? '—' : liters(r.avg)} sub="Consumo / etapas realizadas con consumo" />
            <Kpi label="Entregado en el período" value={liters(r.delivered)} sub={`${integer(q.data.deliveries.length)} entregas`} />
            <Kpi label="Solicitado en el período" value={liters(r.requested)} sub={r.fulfillment === null ? `${r.orders} pedidos` : `${r.orders} pedidos · ${Math.round(r.fulfillment)} % entregado`} />
          </div>
          <Alert tone="info">Stock estimado consolidado a hoy: <span className="font-semibold">{liters(q.data.stock?.estimated_liters ?? 0)}</span> (todos los PADs, sin filtro de período).</Alert>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card><h2 className="mb-4 font-display text-lg font-bold text-navy-950">Consumo por semana</h2><WeekBars data={r.weeks.map((w) => ({ label: w.week, value: w.consumed }))} color="#1B3A63" /></Card>
            <Card><h2 className="mb-4 font-display text-lg font-bold text-navy-950">Entregas por semana</h2><WeekBars data={r.weeks.map((w) => ({ label: w.week, value: w.delivered }))} color="#15803D" /></Card>
          </div>

          <Card flush>
            <h2 className="border-b border-slate-200 px-5 py-3.5 font-display text-lg font-bold text-navy-950">Detalle por PAD</h2>
            {r.byPad.length === 0 ? <div className="p-5"><EmptyState title="Sin actividad en el período" /></div> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-[13.5px]">
                  <thead><tr className="bg-slate-50 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="px-5 py-3 text-left">PAD</th><th className="px-3 py-3">Etapas</th><th className="px-3 py-3">Consumo</th><th className="px-3 py-3">Promedio / etapa</th><th className="px-3 py-3">Solicitado</th><th className="px-5 py-3">Entregado</th>
                  </tr></thead>
                  <tbody>
                    {r.byPad.map((x) => (
                      <tr key={x.pad} className="border-t border-slate-100 text-right tabular-nums">
                        <td className="px-5 py-3 text-left font-mono font-semibold text-navy-900">{x.pad}</td>
                        <td className="px-3 py-3">{x.stages}</td><td className="px-3 py-3 font-semibold">{liters(x.consumed)}</td>
                        <td className="px-3 py-3">{x.stages ? liters(x.consumed / x.stages) : '—'}</td>
                        <td className="px-3 py-3">{liters(x.requested)}</td><td className="px-5 py-3">{liters(x.delivered)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <p className="text-xs text-slate-500">Período del {date(f.from)} al {date(f.to)}. Consumo por fecha de realización de la etapa; entregas por fecha de recepción; pedidos por fecha de creación (sin borradores ni cancelados).</p>
        </div>
      )}
    </>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card">
      <p className="min-h-[30px] text-[11px] font-semibold uppercase leading-tight tracking-wider text-slate-500">{label}</p>
      <p className="mt-2 font-display text-[24px] font-extrabold leading-none tabular-nums text-navy-950">{value}</p>
      <p className="mt-2 text-xs text-slate-500">{sub}</p>
    </div>
  );
}

/** Barras de una sola serie, con valor al pasar el cursor y tabla equivalente. */
function WeekBars({ data, color }: { data: { label: string; value: number }[]; color: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!data.some((d) => d.value > 0)) return <EmptyState title="Sin registros en el período" />;
  const W = 520; const H = 200; const pl = 8; const pb = 22; const pt = 8;
  const max = Math.max(...data.map((d) => d.value));
  const cw = (W - pl) / data.length; const bw = Math.min(36, cw * 0.62);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Litros por semana">
        <line x1={pl} x2={W} y1={H - pb} y2={H - pb} stroke="#E2E8F0" />
        {data.map((d, i) => {
          const h = max ? ((H - pb - pt) * d.value) / max : 0;
          const x = pl + i * cw + (cw - bw) / 2;
          return (
            <g key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={pl + i * cw} y={pt} width={cw} height={H - pt} fill="transparent" />
              {h > 0 && <rect x={x} y={H - pb - h} width={bw} height={h} rx={3} fill={color} opacity={hover === null || hover === i ? 1 : 0.55} />}
              {(data.length <= 8 || i % 2 === 0) && <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize="10.5" fill="#64748B">{date(d.label).slice(0, 5)}</text>}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded-lg bg-navy-900 px-2.5 py-1.5 text-xs text-white shadow-lg">
          Semana del {date(data[hover].label)}: <span className="font-semibold">{liters(data[hover].value)}</span>
        </div>
      )}
      <details className="mt-2 text-sm text-slate-600">
        <summary className="cursor-pointer">Ver como tabla</summary>
        <table className="mt-2 w-full text-[13px]"><tbody>{data.map((d) => <tr key={d.label} className="border-t border-slate-100"><td className="py-1">Semana del {date(d.label)}</td><td className="py-1 text-right tabular-nums">{liters(d.value)}</td></tr>)}</tbody></table>
      </details>
    </div>
  );
}
