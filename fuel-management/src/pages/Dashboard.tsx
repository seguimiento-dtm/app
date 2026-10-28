import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { errorMessage } from '../lib/errors';
import { integer, liters } from '../lib/format';
import type { PadConsumption, StockTotal } from '../lib/types';
import { Alert, Card, EmptyState, PageHeader, Spinner } from '../components/ui';

async function fetchDashboard() {
  const [pads, wells, cons, stock] = await Promise.all([
    supabase.from('pads').select('id', { count: 'exact', head: true }).eq('active', true),
    supabase.from('wells').select('id', { count: 'exact', head: true }).eq('active', true),
    supabase.from('v_pad_consumption').select('*'),
    supabase.from('v_stock_total').select('*').maybeSingle(),
  ]);
  for (const r of [pads, wells, cons, stock]) if (r.error) throw r.error;
  const byPad = (cons.data as PadConsumption[]).filter((c) => Number(c.consumption_liters) > 0)
    .sort((a, b) => Number(b.consumption_liters) - Number(a.consumption_liters));
  const totalCons = byPad.reduce((s, c) => s + Number(c.consumption_liters), 0);
  const stagesWithCons = byPad.reduce((s, c) => s + Number(c.stages_with_consumption), 0);
  const stagesDone = (cons.data as PadConsumption[]).reduce((s, c) => s + Number(c.stages_done), 0);
  return {
    pads: pads.count ?? 0, wells: wells.count ?? 0, stagesDone, totalCons,
    avg: stagesWithCons ? totalCons / stagesWithCons : null,
    stock: stock.data as StockTotal | null, byPad,
  };
}

export default function DashboardPage() {
  const q = useQuery({ queryKey: ['dashboard'], queryFn: fetchDashboard });
  const d = q.data;
  return (
    <>
      <PageHeader eyebrow="Resumen operativo" title="Dashboard Operativo"
        description="Indicadores calculados en tiempo real desde los registros de la base de datos." />
      {q.isLoading && <Spinner />}
      {q.error && <Alert tone="error" title="No se pudieron cargar los indicadores">{errorMessage(q.error)}</Alert>}
      {d && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi label="PADs activos" value={integer(d.pads)} />
            <Kpi label="Pozos activos" value={integer(d.wells)} />
            <Kpi label="Etapas realizadas" value={integer(d.stagesDone)} />
            <Kpi label="Consumo acumulado" value={liters(d.totalCons)} />
            <Kpi label="Promedio por etapa" value={d.avg === null ? '—' : liters(d.avg)} hint="Consumo / etapas realizadas con consumo" />
            <Kpi label="Stock estimado" value={liters(d.stock?.estimated_liters ?? 0)} hint="Consolidado de todos los PADs" accent />
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
            <Card>
              <h2 className="mb-4 font-display text-lg font-bold text-navy-950">Consumo por PAD</h2>
              {d.byPad.length === 0 ? (
                <EmptyState title="Todavía no hay consumos registrados">
                  Los consumos se cargan por etapa realizada en “Registro de Etapas” (próxima fase). Este gráfico se completa solo a medida que se registran.
                </EmptyState>
              ) : (
                <ul className="space-y-3">
                  {d.byPad.slice(0, 10).map((c) => (
                    <li key={c.pad_id} className="grid grid-cols-[minmax(90px,140px)_1fr_auto] items-center gap-3 text-sm">
                      <span className="truncate font-mono font-semibold text-navy-900">{c.pad_code}</span>
                      <span className="h-2.5 rounded-r bg-slate-100"><span className="block h-full rounded-r bg-navy-600" style={{ width: `${(Number(c.consumption_liters) / Number(d.byPad[0].consumption_liters)) * 100}%` }} /></span>
                      <span className="tabular-nums font-semibold">{liters(c.consumption_liters)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <h2 className="mb-3 font-display text-lg font-bold text-navy-950">Accesos</h2>
              <div className="space-y-2">
                <Shortcut to="/pads" title="PADs y Pozos" text="Maestro operativo y consumo por PAD" />
                <Shortcut to="/pedidos" title="Pedidos de Combustible" text="Viajes de 43.000 L" />
                <Shortcut to="/inventario" title="Inventario y Stock" text="Stock por PAD y consolidado" />
              </div>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

function Kpi({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border bg-white p-4 shadow-card ${accent ? 'border-brand-100 ring-4 ring-brand-50' : 'border-slate-200'}`}>
      <p className="min-h-[30px] text-[11px] font-semibold uppercase leading-tight tracking-wider text-slate-500">{label}</p>
      <p className="mt-2 font-display text-[26px] font-extrabold leading-none tabular-nums text-navy-950">{value}</p>
      {hint && <p className="mt-2 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function Shortcut({ to, title, text }: { to: string; title: string; text: string }) {
  return (
    <Link to={to} className="group flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 transition hover:-translate-y-px hover:border-slate-300 hover:shadow-lift">
      <span className="flex-1"><span className="block font-semibold text-navy-900">{title}</span><span className="text-sm text-slate-500">{text}</span></span>
      <ArrowRight className="h-4 w-4 text-slate-400 transition group-hover:translate-x-1 group-hover:text-brand-600" aria-hidden />
    </Link>
  );
}
