import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Search } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { can } from '../lib/roles';
import { errorMessage } from '../lib/errors';
import { dateTime, fromLocalInput, liters, parseLiters, toLocalInput } from '../lib/format';
import { OPERATIONAL_KEYS, TRIP_CAPACITY_LITERS, rows, useOrders } from '../lib/queries';
import type { Delivery, Order } from '../lib/types';
import { Alert, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Textarea, useToast } from '../components/ui';
import { OrderDetail } from '../components/OrderDetail';

const RECEIVABLE = ['solicitado', 'enviado', 'entregado_parcial'];

export default function DeliveriesPage() {
  const { profile } = useAuth();
  const canManage = can.manageOrders(profile?.role ?? null);
  const [params, setParams] = useSearchParams();
  const orders = useOrders('abiertos');
  const deliveries = useQuery({
    queryKey: ['deliveries'],
    queryFn: () => rows<Delivery[]>(supabase.from('v_deliveries').select('*').order('delivered_at', { ascending: false }).limit(500)),
  });
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Delivery | null>(null);
  const [orderOpen, setOrderOpen] = useState<string | null>(null);

  const list = useMemo(() => {
    const t = search.trim().toLowerCase();
    return (deliveries.data ?? []).filter((d) => !t || [d.document_number, d.order_number, d.pad_code, d.carrier].some((x) => x.toLowerCase().includes(t)));
  }, [deliveries.data, search]);

  return (
    <>
      <PageHeader eyebrow="Logística" title="Entregas de Combustible"
        description="Entregas reales recibidas en locación. Son el único ingreso de stock: cada una suma al PAD del pedido." />
      <div className="grid gap-6 xl:grid-cols-[440px_minmax(0,1fr)]">
        <Card>
          <h2 className="mb-5 font-display text-lg font-bold text-navy-950">Registrar entrega</h2>
          {!canManage ? <Alert tone="info">El registro de entregas corresponde a Logística o Administrador.</Alert>
            : orders.isLoading ? <Spinner />
            : <DeliveryForm orders={(orders.data ?? []).filter((o) => RECEIVABLE.includes(o.status))} preselect={params.get('pedido')}
                onSaved={() => params.has('pedido') && setParams({}, { replace: true })} />}
        </Card>
        <Card flush>
          <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-4 sm:p-5">
            <h2 className="mr-auto font-display text-lg font-bold text-navy-950">Entregas registradas</h2>
            <div className="relative w-full sm:w-72"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <Input type="search" aria-label="Buscar entregas" className="pl-9" placeholder="Remito, pedido, PAD o transportista" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          </div>
          {deliveries.isLoading && <Spinner />}
          {deliveries.error && <div className="p-5"><Alert tone="error">{errorMessage(deliveries.error)}</Alert></div>}
          {deliveries.data && list.length === 0 && <div className="p-5"><EmptyState title={deliveries.data.length ? 'Sin resultados' : 'Todavía no hay entregas registradas'} /></div>}
          {list.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-[13.5px]">
                <thead><tr className="bg-slate-50 text-left text-[11.5px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Fecha</th><th className="px-4 py-3">Remito</th><th className="px-4 py-3">Pedido</th><th className="px-4 py-3">PAD</th>
                  <th className="px-4 py-3 text-right">Litros</th><th className="px-4 py-3">Transportista</th><th className="px-4 py-3">Recibió</th>{canManage && <th />}
                </tr></thead>
                <tbody>
                  {list.map((d) => (
                    <tr key={d.id} className="border-t border-slate-100">
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums">{dateTime(d.delivered_at)}</td>
                      <td className="px-4 py-3 font-mono">{d.document_number}</td>
                      <td className="px-4 py-3"><button className="font-mono font-semibold text-navy-700 hover:underline" onClick={() => setOrderOpen(d.order_id)}>{d.order_number}</button></td>
                      <td className="px-4 py-3 font-semibold">{d.pad_code}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{liters(d.liters)}</td>
                      <td className="px-4 py-3">{d.carrier || '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{d.received_by_name || '—'}</td>
                      {canManage && <td className="px-4 py-3 text-right"><Button size="sm" variant="ghost" onClick={() => setEditing(d)}><Pencil className="h-3.5 w-3.5" /> Corregir</Button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
      {editing && <EditDelivery delivery={editing} onClose={() => setEditing(null)} />}
      {orderOpen && <OrderDetail orderId={orderOpen} onClose={() => setOrderOpen(null)} />}
    </>
  );
}

function DeliveryForm({ orders, preselect, onSaved }: { orders: Order[]; preselect: string | null; onSaved: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState({ order_id: '', delivered_at: toLocalInput(), liters: '', document_number: '', carrier: '', notes: '' });
  const [error, setError] = useState<string | null>(null);
  const order = orders.find((o) => o.id === v.order_id);

  useEffect(() => {
    if (preselect && orders.some((o) => o.id === preselect)) setV((x) => ({ ...x, order_id: preselect }));
  }, [preselect, orders]);
  useEffect(() => {
    if (order) setV((x) => ({ ...x, liters: x.liters || String(Math.min(TRIP_CAPACITY_LITERS, Number(order.pending_liters) || TRIP_CAPACITY_LITERS)) }));
  }, [order]);

  const save = useMutation({
    mutationFn: async () => {
      const r = await supabase.from('fuel_deliveries').insert({
        order_id: v.order_id, delivered_at: fromLocalInput(v.delivered_at), liters: parseLiters(v.liters),
        document_number: v.document_number.trim(), carrier: v.carrier.trim(), notes: v.notes.trim(),
      }).select('id').single();
      if (r.error) throw r.error;
    },
    onSuccess: () => {
      for (const k of OPERATIONAL_KEYS) qc.invalidateQueries({ queryKey: k });
      toast(`Entrega de ${liters(parseLiters(v.liters))} registrada en ${order?.pad_code}.`, 'success');
      setV({ order_id: '', delivered_at: toLocalInput(), liters: '', document_number: '', carrier: v.carrier, notes: '' });
      onSaved();
    },
    onError: (e) => setError(/remito_unico|duplicate/i.test(String((e as Error).message)) ? 'Ese remito ya fue registrado.' : errorMessage(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const l = parseLiters(v.liters);
    if (!v.order_id) return setError('Seleccione el pedido.');
    if (!fromLocalInput(v.delivered_at)) return setError('Ingrese la fecha y hora de la entrega.');
    if (new Date(fromLocalInput(v.delivered_at)!) > new Date(Date.now() + 3600e3)) return setError('La fecha de entrega no puede ser futura.');
    if (!Number.isFinite(l) || l <= 0) return setError('Los litros entregados deben ser mayores que cero.');
    if (!v.document_number.trim()) return setError('Ingrese el número de remito.');
    save.mutate();
  }

  if (orders.length === 0) return <EmptyState title="No hay pedidos para recibir">Las entregas se registran sobre pedidos solicitados o enviados.</EmptyState>;
  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <Field label="Pedido" htmlFor="d-order" required>
        <Select id="d-order" value={v.order_id} onChange={(e) => setV({ ...v, order_id: e.target.value, liters: '' })}>
          <option value="">Seleccione el pedido…</option>
          {orders.map((o) => <option key={o.id} value={o.id}>{o.order_number} · {o.pad_code} · pendiente {liters(o.pending_liters)}</option>)}
        </Select>
      </Field>
      {order && (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          Solicitado {liters(order.requested_liters)} · entregado {liters(order.delivered_liters)} · <span className="font-semibold text-navy-900">pendiente {liters(order.pending_liters)}</span>
        </p>
      )}
      <Field label="Fecha y hora de la entrega" htmlFor="d-date" required><Input id="d-date" type="datetime-local" value={v.delivered_at} onChange={(e) => setV({ ...v, delivered_at: e.target.value })} /></Field>
      <Field label="Litros recibidos" htmlFor="d-liters" required hint="Volumen real según remito o medición.">
        <Input id="d-liters" inputMode="decimal" value={v.liters} onChange={(e) => setV({ ...v, liters: e.target.value })} />
      </Field>
      <Field label="N.º de remito" htmlFor="d-doc" required hint="No se puede repetir."><Input id="d-doc" value={v.document_number} onChange={(e) => setV({ ...v, document_number: e.target.value })} /></Field>
      <Field label="Transportista" htmlFor="d-carrier"><Input id="d-carrier" value={v.carrier} onChange={(e) => setV({ ...v, carrier: e.target.value })} /></Field>
      <Field label="Observaciones" htmlFor="d-notes"><Textarea id="d-notes" maxLength={1000} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      {error && <Alert tone="error">{error}</Alert>}
      <Button type="submit" variant="primary" loading={save.isPending} className="min-h-[46px]">Registrar entrega</Button>
    </form>
  );
}

function EditDelivery({ delivery: d, onClose }: { delivery: Delivery; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState({ delivered_at: toLocalInput(d.delivered_at), liters: String(d.liters), document_number: d.document_number, carrier: d.carrier, notes: d.notes });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      const l = parseLiters(v.liters);
      if (!Number.isFinite(l) || l <= 0) throw new Error('Los litros deben ser mayores que cero.');
      const r = await supabase.from('fuel_deliveries').update({
        delivered_at: fromLocalInput(v.delivered_at), liters: l, document_number: v.document_number.trim(), carrier: v.carrier.trim(), notes: v.notes.trim(),
      }).eq('id', d.id).select('id');
      if (r.error) throw r.error;
      if (!r.data?.length) throw new Error('Su rol no tiene permiso para corregir entregas.');
    },
    onSuccess: () => { for (const k of OPERATIONAL_KEYS) qc.invalidateQueries({ queryKey: k }); toast('Entrega corregida. El cambio queda en la auditoría.', 'success'); onClose(); },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Modal open title={`Corregir entrega ${d.document_number}`} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Guardar corrección</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Alert tone="info" className="sm:col-span-2">Pedido {d.order_number} · {d.pad_code}. La corrección actualiza el stock y queda registrada con su usuario.</Alert>
        <Field label="Fecha y hora" htmlFor="e-date"><Input id="e-date" type="datetime-local" value={v.delivered_at} onChange={(e) => setV({ ...v, delivered_at: e.target.value })} /></Field>
        <Field label="Litros" htmlFor="e-liters"><Input id="e-liters" inputMode="decimal" value={v.liters} onChange={(e) => setV({ ...v, liters: e.target.value })} /></Field>
        <Field label="N.º de remito" htmlFor="e-doc"><Input id="e-doc" value={v.document_number} onChange={(e) => setV({ ...v, document_number: e.target.value })} /></Field>
        <Field label="Transportista" htmlFor="e-carrier"><Input id="e-carrier" value={v.carrier} onChange={(e) => setV({ ...v, carrier: e.target.value })} /></Field>
        <Field label="Observaciones" htmlFor="e-notes" className="sm:col-span-2"><Textarea id="e-notes" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
        {error && <Alert tone="error" className="sm:col-span-2">{error}</Alert>}
      </div>
    </Modal>
  );
}
