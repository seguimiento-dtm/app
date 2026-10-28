import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Mail, Pencil, Send, Truck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { can } from '../lib/roles';
import { errorMessage } from '../lib/errors';
import { date, dateTime, liters } from '../lib/format';
import { NOTIFICATION_LABEL, NOTIFICATION_TONE, ORDER_STATUS_LABEL, ORDER_STATUS_TONE } from '../lib/labels';
import { OPERATIONAL_KEYS, rows, useEmailSending, useMyMicrosoftLink, useOrderRecipient, type Dispatch } from '../lib/queries';
import { invokeFunction } from '../lib/supabase';
import { mailtoLink, orderEmail } from '../lib/orderEmail';
import type { Delivery, Order } from '../lib/types';
import { Alert, Badge, Button, Field, Modal, Spinner, Textarea, buttonClass, useToast } from './ui';
import { OrderForm } from './OrderForm';

export function invalidateOperational(qc: ReturnType<typeof useQueryClient>) {
  for (const k of OPERATIONAL_KEYS) qc.invalidateQueries({ queryKey: k });
}

export function OrderStatusBadge({ status }: { status: Order['status'] }) {
  return <Badge tone={ORDER_STATUS_TONE[status]}>{ORDER_STATUS_LABEL[status]}</Badge>;
}

export function OrderDetail({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const { profile } = useAuth();
  const canManage = can.manageOrders(profile?.role ?? null);
  const qc = useQueryClient();
  const toast = useToast();
  const [view, setView] = useState<'detalle' | 'correo' | 'cancelar' | 'editar'>('detalle');
  const [reason, setReason] = useState('');
  const q = useQuery({
    queryKey: ['order', orderId],
    queryFn: async () => {
      const [order, deliveries, dispatches] = await Promise.all([
        rows<Order>(supabase.from('v_orders').select('*').eq('id', orderId).single()),
        rows<Delivery[]>(supabase.from('v_deliveries').select('*').eq('order_id', orderId).order('delivered_at')),
        rows<Dispatch[]>(supabase.from('email_dispatches').select('*').eq('order_id', orderId).order('created_at', { ascending: false })),
      ]);
      return { order, deliveries, dispatches };
    },
  });
  const setStatus = useMutation({
    mutationFn: async (v: { status: Order['status']; cancel_reason?: string }) => {
      const r = await supabase.from('fuel_orders').update(v).eq('id', orderId).select('id');
      if (r.error) throw r.error;
      if (!r.data?.length) throw new Error('Su rol no tiene permiso para modificar este pedido.');
    },
    onSuccess: (_d, v) => { invalidateOperational(qc); toast(`Pedido ${ORDER_STATUS_LABEL[v.status].toLowerCase()}.`, 'success'); setView('detalle'); },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (q.isLoading) return <Modal open title="Pedido" onClose={onClose}><Spinner /></Modal>;
  if (q.error || !q.data) return <Modal open title="Pedido" onClose={onClose}><Alert tone="error">{errorMessage(q.error)}</Alert></Modal>;
  const { order: o, deliveries, dispatches } = q.data;
  if (view === 'editar') return <OrderForm order={o} onClose={() => setView('detalle')} onSaved={() => setView('detalle')} />;
  if (view === 'correo') return <EmailDraft order={o} canSend={canManage} onBack={() => setView('detalle')} onClose={onClose} />;

  const progress = o.requested_liters > 0 ? Math.min(100, (Number(o.delivered_liters) / Number(o.requested_liters)) * 100) : 0;
  const editable = canManage && ['borrador', 'solicitado'].includes(o.status) && o.deliveries === 0;
  const cancellable = canManage && ['borrador', 'solicitado', 'enviado'].includes(o.status) && o.deliveries === 0;
  const receivable = canManage && ['solicitado', 'enviado', 'entregado_parcial'].includes(o.status);

  return (
    <Modal open wide title={`Pedido ${o.order_number}`} onClose={onClose}
      footer={view === 'cancelar' ? (
        <>
          <Button onClick={() => setView('detalle')}>Volver</Button>
          <Button variant="danger" loading={setStatus.isPending} disabled={!reason.trim()} onClick={() => setStatus.mutate({ status: 'cancelado', cancel_reason: reason.trim() })}>Cancelar pedido</Button>
        </>
      ) : (
        <>
          {o.status !== 'cancelado' && <Button onClick={() => setView('correo')}><Mail className="h-4 w-4" /> Correo de solicitud</Button>}
          {editable && <Button onClick={() => setView('editar')}><Pencil className="h-4 w-4" /> Modificar</Button>}
          {cancellable && <Button variant="danger" onClick={() => setView('cancelar')}>Cancelar pedido</Button>}
          {canManage && o.status === 'solicitado' && <Button loading={setStatus.isPending} onClick={() => setStatus.mutate({ status: 'enviado' })}>Marcar como enviado</Button>}
          {canManage && o.status === 'borrador' && <Button variant="primary" loading={setStatus.isPending} onClick={() => setStatus.mutate({ status: 'solicitado' })}>Registrar solicitud</Button>}
          {receivable && <Link to={`/entregas?pedido=${o.id}`} onClick={onClose} className={buttonClass('primary')}><Truck className="h-4 w-4" /> Registrar entrega</Link>}
        </>
      )}>
      {view === 'cancelar' ? (
        <div className="space-y-4">
          <Alert tone="warning">El pedido queda en el historial con estado “Cancelado”. {o.status === 'enviado' && 'Ya fue enviado: avise a la transportista.'}</Alert>
          <Field label="Motivo de la cancelación" htmlFor="c-reason" required>
            <Textarea id="c-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <OrderStatusBadge status={o.status} />
            {o.status !== 'borrador' && <Badge tone={NOTIFICATION_TONE[o.notification_status]}>{NOTIFICATION_LABEL[o.notification_status]}</Badge>}
            {o.status === 'cancelado' && <span className="text-sm text-slate-600">Motivo: {o.cancel_reason}</span>}
          </div>
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ['PAD / Locación', o.pad_code],
              ['Viajes', `${o.trips} × ${liters(o.trip_capacity_liters)}`],
              ['Volumen solicitado', liters(o.requested_liters)],
              ['Fecha requerida', date(o.required_date)],
              ['Entregado', liters(o.delivered_liters)],
              ['Pendiente', liters(o.pending_liters)],
              ['Solicitante', o.requested_by_name || '—'],
              ['Creado', dateTime(o.created_at)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{k}</dt>
                <dd className="mt-1 font-semibold tabular-nums text-navy-950">{v}</dd>
              </div>
            ))}
          </dl>
          {o.status !== 'cancelado' && o.status !== 'borrador' && (
            <div>
              <div className="mb-1.5 flex justify-between text-sm"><span className="font-semibold text-navy-900">Avance de entrega</span><span className="tabular-nums text-slate-600">{Math.round(progress)} %</span></div>
              <div className="h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${progress}%` }} /></div>
            </div>
          )}
          {dispatches.length > 0 && (
            <div>
              <h3 className="mb-2 font-display text-base font-bold text-navy-950">Envíos por Outlook ({dispatches.length})</h3>
              <ul className="space-y-1.5 text-sm">
                {dispatches.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Badge tone={d.status === 'aceptado' ? 'green' : d.status === 'error' ? 'red' : 'amber'}>
                      {d.status === 'aceptado' ? 'Aceptado por Microsoft 365' : d.status === 'error' ? 'Error' : 'En curso'}
                    </Badge>
                    <span className="tabular-nums text-slate-600">{dateTime(d.finished_at ?? d.created_at)}</span>
                    <span className="text-slate-700">de {d.sender_email} a {d.recipient}</span>
                    {d.error_message && <span className="w-full text-red-700">{d.error_message}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {o.notes && <p className="text-sm text-slate-700"><span className="font-semibold">Observaciones:</span> {o.notes}</p>}

          <div>
            <h3 className="mb-2 font-display text-base font-bold text-navy-950">Entregas ({deliveries.length})</h3>
            {deliveries.length === 0 ? <p className="text-sm text-slate-500">Sin entregas registradas. El stock solo aumenta cuando se registra una entrega.</p> : (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[520px] text-[13.5px]">
                  <thead><tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500"><th className="px-3.5 py-2.5">Fecha</th><th className="px-3.5 py-2.5">Remito</th><th className="px-3.5 py-2.5">Transportista</th><th className="px-3.5 py-2.5 text-right">Litros</th><th className="px-3.5 py-2.5">Recibió</th></tr></thead>
                  <tbody>
                    {deliveries.map((d) => (
                      <tr key={d.id} className="border-t border-slate-100">
                        <td className="px-3.5 py-2 tabular-nums">{dateTime(d.delivered_at)}</td>
                        <td className="px-3.5 py-2 font-mono">{d.document_number}</td>
                        <td className="px-3.5 py-2">{d.carrier || '—'}</td>
                        <td className="px-3.5 py-2 text-right tabular-nums font-semibold">{liters(d.liters)}</td>
                        <td className="px-3.5 py-2 text-slate-600">{d.received_by_name || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function EmailDraft({ order, canSend, onBack, onClose }: { order: Order; canSend: boolean; onBack: () => void; onClose: () => void }) {
  const recipient = useOrderRecipient();
  const sending = useEmailSending();
  const link = useMyMicrosoftLink();
  const qc = useQueryClient();
  const toast = useToast();
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);
  const { subject, body } = orderEmail(order);
  const to = recipient.data || '';
  const alreadySent = order.notification_status === 'aceptado';
  const sendable = ['solicitado', 'enviado', 'entregado_parcial'].includes(order.status);
  const send = useMutation({
    mutationFn: () => invokeFunction<{ status?: string; message?: string }>('send-order-email', { order_id: order.id }),
    onSuccess: (r) => {
      setOutcome({ ok: r.status === 'aceptado', text: r.message ?? 'Sin respuesta del servidor.' });
      invalidateOperational(qc);
      qc.invalidateQueries({ queryKey: ['microsoft-link'] });
      if (r.status === 'aceptado') toast('Pedido enviado desde su Outlook.', 'success');
    },
    onError: (e) => setOutcome({ ok: false, text: errorMessage(e) }),
  });
  async function copy() {
    try {
      await navigator.clipboard.writeText(`Para: ${to}\nAsunto: ${subject}\n\n${body}`);
      toast('Texto del correo copiado.', 'success');
    } catch {
      toast('No se pudo copiar automáticamente. Seleccione el texto y cópielo.', 'error');
    }
  }
  const automatic = sending.data === true;
  const canSendNow = automatic && canSend && !!link.data && sendable && !alreadySent && !outcome?.ok;
  return (
    <Modal open wide title={`Correo del pedido ${order.order_number}`} onClose={onClose}
      footer={<>
        <Button onClick={onBack}>Volver</Button>
        <Button onClick={copy}><Copy className="h-4 w-4" /> Copiar texto</Button>
        {to && <a href={mailtoLink(to, subject, body)} className={buttonClass(canSendNow || alreadySent || outcome?.ok ? 'secondary' : 'primary')}><Mail className="h-4 w-4" /> Abrir en Outlook</a>}
        {canSendNow && <Button variant="primary" loading={send.isPending} onClick={() => { setOutcome(null); send.mutate(); }}><Send className="h-4 w-4" /> Enviar desde mi Outlook</Button>}
      </>}>
      {outcome && <Alert tone={outcome.ok ? 'success' : 'error'} className="mb-4" title={outcome.ok ? 'Envío aceptado' : 'No se envió'}>{outcome.text}</Alert>}
      {!outcome && (
        !automatic ? (
          <Alert tone="info" className="mb-4">
            Borrador del correo. “Abrir en Outlook” lo prepara en su propia cuenta para que lo revise y lo envíe. El envío directo desde la aplicación se habilita cuando TI autorice la integración con Microsoft 365.
          </Alert>
        ) : alreadySent ? (
          <Alert tone="success" className="mb-4">Este pedido ya fue enviado y Microsoft 365 aceptó el correo. No se puede enviar otra vez desde la aplicación.</Alert>
        ) : !canSend ? (
          <Alert tone="info" className="mb-4">El envío de pedidos corresponde a Logística o Administrador.</Alert>
        ) : !sendable ? (
          <Alert tone="info" className="mb-4">Registre la solicitud antes de enviarla.</Alert>
        ) : link.data ? (
          <Alert tone="info" className="mb-4">Se enviará desde su cuenta <b>{link.data.ms_email}</b> a <b>{to}</b>. Revise el contenido antes de confirmar.</Alert>
        ) : (
          <Alert tone="warning" className="mb-4">Para enviar desde su Outlook, salga e ingrese con <b>“Ingresar con Microsoft”</b>. Mientras tanto puede usar “Abrir en Outlook”.</Alert>
        )
      )}
      <dl className="mb-3 space-y-1 text-sm">
        <div><dt className="inline font-semibold">Para: </dt><dd className="inline">{to || '—'}</dd></div>
        <div><dt className="inline font-semibold">Asunto: </dt><dd className="inline">{subject}</dd></div>
      </dl>
      <pre className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-4 font-sans text-[14px] text-navy-950">{body}</pre>
    </Modal>
  );
}
