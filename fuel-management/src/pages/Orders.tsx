import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { can } from '../lib/roles';
import { errorMessage } from '../lib/errors';
import { date, liters } from '../lib/format';
import { useOrders } from '../lib/queries';
import { Alert, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { OrderForm } from '../components/OrderForm';
import { OrderDetail, OrderStatusBadge } from '../components/OrderDetail';

export default function OrdersPage() {
  const { profile } = useAuth();
  const canManage = can.manageOrders(profile?.role ?? null);
  const open = useOrders('abiertos');
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <>
      <PageHeader eyebrow="Logística" title="Pedidos de Combustible"
        description="Cada pedido se calcula por cantidad de viajes de 43.000 L. Un pedido no suma stock: el stock aumenta al registrar la entrega." />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <h2 className="mb-5 font-display text-lg font-bold text-navy-950">Nuevo pedido</h2>
          {canManage ? <OrderForm onSaved={(o) => setSelected(o.id)} /> : (
            <Alert tone="info">Su rol puede consultar los pedidos. La carga de pedidos corresponde a Logística o Administrador.</Alert>
          )}
        </Card>
        <Card>
          <h2 className="mb-4 font-display text-lg font-bold text-navy-950">Pedidos abiertos</h2>
          {open.isLoading && <Spinner />}
          {open.error && <Alert tone="error">{errorMessage(open.error)}</Alert>}
          {open.data && open.data.length === 0 && <EmptyState title="No hay pedidos abiertos">Los pedidos entregados o cancelados se consultan en el Historial.</EmptyState>}
          {open.data && open.data.length > 0 && (
            <ul className="divide-y divide-slate-100">
              {open.data.map((o) => {
                const pct = o.requested_liters > 0 ? Math.min(100, (Number(o.delivered_liters) / Number(o.requested_liters)) * 100) : 0;
                return (
                  <li key={o.id}>
                    <button onClick={() => setSelected(o.id)} className="group w-full rounded-lg px-2 py-3 text-left transition hover:bg-navy-50/60">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[13px] font-semibold text-navy-900">{o.order_number}</span>
                        <OrderStatusBadge status={o.status} />
                        <span className="ml-auto text-sm text-slate-500">Requerido {date(o.required_date)}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 text-sm">
                        <span className="font-semibold text-navy-950">{o.pad_code}</span>
                        <span className="tabular-nums text-slate-600">{o.trips} viaje(s) · {liters(o.requested_liters)}</span>
                        {o.status !== 'borrador' && <span className="tabular-nums text-slate-600">· entregado {liters(o.delivered_liters)}</span>}
                      </div>
                      {o.status !== 'borrador' && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-600" style={{ width: `${pct}%` }} /></div>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
      {selected && <OrderDetail orderId={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
