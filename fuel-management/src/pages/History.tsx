import { useMemo, useState } from 'react';
import { Download, Search } from 'lucide-react';
import { errorMessage } from '../lib/errors';
import { date, dateTime, downloadCsv, liters, todayIso } from '../lib/format';
import { ORDER_STATUS_LABEL } from '../lib/labels';
import { useOrders } from '../lib/queries';
import type { Order, OrderStatus } from '../lib/types';
import { Alert, Button, Card, EmptyState, Field, Input, PageHeader, Select, Spinner } from '../components/ui';
import { OrderDetail, OrderStatusBadge } from '../components/OrderDetail';

type SortKey = 'created_at' | 'required_date' | 'pad_code' | 'requested_liters';

export default function HistoryPage() {
  const q = useOrders('todos');
  const [f, setF] = useState({ text: '', status: '', pad: '', from: '', to: '' });
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'created_at', dir: -1 });
  const [selected, setSelected] = useState<string | null>(null);

  const pads = useMemo(() => [...new Set((q.data ?? []).map((o) => o.pad_code))].sort(), [q.data]);
  const list = useMemo(() => {
    const t = f.text.trim().toLowerCase();
    const day = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(iso));
    return (q.data ?? [])
      .filter((o) => !t || o.order_number.toLowerCase().includes(t) || o.pad_code.toLowerCase().includes(t))
      .filter((o) => !f.status || o.status === f.status)
      .filter((o) => !f.pad || o.pad_code === f.pad)
      .filter((o) => !f.from || day(o.created_at) >= f.from)
      .filter((o) => !f.to || day(o.created_at) <= f.to)
      .sort((a, b) => {
        const x = a[sort.key]; const y = b[sort.key];
        return (typeof x === 'number' || typeof y === 'number' ? Number(x) - Number(y) : String(x).localeCompare(String(y))) * sort.dir;
      });
  }, [q.data, f, sort]);

  const totals = list.reduce((s, o) => (o.status === 'cancelado' ? s : { req: s.req + Number(o.requested_liters), del: s.del + Number(o.delivered_liters) }), { req: 0, del: 0 });

  function exportCsv() {
    downloadCsv(`historial_pedidos_${todayIso()}.csv`,
      ['Pedido', 'Fecha de creación', 'PAD', 'Viajes', 'Litros solicitados', 'Litros entregados', 'Pendiente', 'Fecha requerida', 'Estado', 'Solicitante', 'Observaciones', 'Motivo de cancelación'],
      list.map((o) => [o.order_number, dateTime(o.created_at), o.pad_code, o.trips, o.requested_liters, o.delivered_liters, o.pending_liters, date(o.required_date),
        ORDER_STATUS_LABEL[o.status], o.requested_by_name ?? '', o.notes, o.cancel_reason]));
  }

  const th = (key: SortKey, label: string, right = false) => (
    <th className={`px-4 py-3 ${right ? 'text-right' : ''}`}>
      <button className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-navy-900" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : key === 'pad_code' ? 1 : -1 }))}>
        {label}<span className={sort.key === key ? 'text-brand-600' : 'opacity-40'}>{sort.key === key ? (sort.dir === 1 ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );

  return (
    <>
      <PageHeader eyebrow="Trazabilidad" title="Historial de Pedidos" description="Todos los pedidos registrados, incluidos los cancelados. Los pedidos no se borran." />
      {q.isLoading && <Spinner />}
      {q.error && <Alert tone="error">{errorMessage(q.error)}</Alert>}
      {q.data && (
        <Card flush>
          <div className="grid gap-3 border-b border-slate-200 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-[2fr_repeat(4,minmax(0,1fr))]">
            <Field label="Buscar" htmlFor="h-text">
              <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                <Input id="h-text" type="search" className="pl-9" placeholder="N.º de pedido o PAD" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} /></div>
            </Field>
            <Field label="Estado" htmlFor="h-status">
              <Select id="h-status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
                <option value="">Todos</option>
                {(Object.keys(ORDER_STATUS_LABEL) as OrderStatus[]).map((s) => <option key={s} value={s}>{ORDER_STATUS_LABEL[s]}</option>)}
              </Select>
            </Field>
            <Field label="PAD" htmlFor="h-pad">
              <Select id="h-pad" value={f.pad} onChange={(e) => setF({ ...f, pad: e.target.value })}><option value="">Todos</option>{pads.map((p) => <option key={p}>{p}</option>)}</Select>
            </Field>
            <Field label="Creado desde" htmlFor="h-from"><Input id="h-from" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
            <Field label="Creado hasta" htmlFor="h-to"><Input id="h-to" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
          </div>
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
            <p className="mr-auto text-sm text-slate-600">{list.length} pedido(s) · solicitado {liters(totals.req)} · entregado {liters(totals.del)} <span className="text-slate-400">(sin cancelados)</span></p>
            <Button size="sm" onClick={() => setF({ text: '', status: '', pad: '', from: '', to: '' })}>Limpiar filtros</Button>
            <Button size="sm" onClick={exportCsv} disabled={!list.length}><Download className="h-4 w-4" /> Exportar a Excel (CSV)</Button>
          </div>
          {list.length === 0 ? <div className="p-5"><EmptyState title={q.data.length ? 'Sin resultados para los filtros' : 'Todavía no hay pedidos'} /></div> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-[13.5px]">
                <thead>
                  <tr className="border-t border-slate-200 bg-slate-50 text-left text-[11.5px] font-semibold text-slate-500">
                    <th className="px-4 py-3 uppercase tracking-wider">Pedido</th>{th('created_at', 'Creado')}{th('pad_code', 'PAD')}
                    {th('requested_liters', 'Solicitado', true)}<th className="px-4 py-3 text-right uppercase tracking-wider">Entregado</th>
                    {th('required_date', 'Requerido')}<th className="px-4 py-3 uppercase tracking-wider">Estado</th><th className="px-4 py-3 uppercase tracking-wider">Solicitante</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((o: Order) => (
                    <tr key={o.id} tabIndex={0} onClick={() => setSelected(o.id)} onKeyDown={(e) => e.key === 'Enter' && setSelected(o.id)}
                      className={`cursor-pointer border-t border-slate-100 transition-colors hover:bg-navy-50/50 ${o.status === 'cancelado' ? 'text-slate-400' : ''}`}>
                      <td className="whitespace-nowrap px-4 py-3 font-mono font-semibold text-navy-900">{o.order_number}</td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums">{dateTime(o.created_at)}</td>
                      <td className="px-4 py-3 font-semibold">{o.pad_code}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{liters(o.requested_liters)}<span className="block text-xs text-slate-500">{o.trips} viaje(s)</span></td>
                      <td className="px-4 py-3 text-right tabular-nums">{liters(o.delivered_liters)}</td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums">{date(o.required_date)}</td>
                      <td className="px-4 py-3"><OrderStatusBadge status={o.status} /></td>
                      <td className="px-4 py-3">{o.requested_by_name || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      {selected && <OrderDetail orderId={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
