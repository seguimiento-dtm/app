import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { errorMessage } from '../lib/errors';
import { date, liters, todayIso } from '../lib/format';
import { OPERATIONAL_KEYS, TRIP_CAPACITY_LITERS, useCatalog } from '../lib/queries';
import type { Order } from '../lib/types';
import { Alert, Button, Field, Input, Modal, Select, Textarea, useToast } from './ui';

interface Values { pad_id: string; trips: string; required_date: string; notes: string }

export function validateOrder(v: Values): Partial<Record<keyof Values, string>> {
  const e: Partial<Record<keyof Values, string>> = {};
  const trips = Number(v.trips);
  if (!v.pad_id) e.pad_id = 'Seleccione el PAD de destino.';
  if (v.trips.trim() === '' || !Number.isInteger(trips)) e.trips = 'Ingrese una cantidad entera de viajes.';
  else if (trips < 1 || trips > 100) e.trips = 'Entre 1 y 100 viajes.';
  if (!v.required_date) e.required_date = 'Ingrese la fecha requerida de entrega.';
  else if (v.required_date < todayIso()) e.required_date = 'La fecha requerida no puede ser anterior a hoy.';
  return e;
}

/** Alta o modificación de pedido. Al crear: borrador o solicitud con confirmación previa. */
export function OrderForm({ order, onClose, onSaved }: { order?: Order; onClose?: () => void; onSaved?: (o: { id: string; order_number: string }) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const catalog = useCatalog();
  const [v, setV] = useState<Values>({
    pad_id: order?.pad_id ?? '', trips: order ? String(order.trips) : '', required_date: order?.required_date ?? '', notes: order?.notes ?? '',
  });
  const [errors, setErrors] = useState<Partial<Record<keyof Values, string>>>({});
  const [confirm, setConfirm] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const trips = Number(v.trips);
  const volume = Number.isInteger(trips) && trips > 0 ? trips * TRIP_CAPACITY_LITERS : null;
  const pads = (catalog.data?.pads ?? []).filter((p) => p.active || p.id === order?.pad_id);
  const pad = pads.find((p) => p.id === v.pad_id);

  const save = useMutation({
    mutationFn: async (status: 'borrador' | 'solicitado') => {
      const body = { pad_id: v.pad_id, trips, required_date: v.required_date, notes: v.notes.trim() };
      const r = order
        ? await supabase.from('fuel_orders').update(body).eq('id', order.id).select('id, order_number').single()
        : await supabase.from('fuel_orders').insert({ ...body, status }).select('id, order_number').single();
      if (r.error) throw r.error;
      return r.data as { id: string; order_number: string };
    },
    onSuccess: (o, status) => {
      for (const k of OPERATIONAL_KEYS) qc.invalidateQueries({ queryKey: k });
      toast(order ? `Pedido ${o.order_number} modificado.` : `Pedido ${o.order_number} ${status === 'borrador' ? 'guardado como borrador' : 'registrado'}.`, 'success');
      setConfirm(false);
      if (!order) setV({ pad_id: '', trips: '', required_date: '', notes: '' });
      onSaved?.(o);
    },
    onError: (e) => { setConfirm(false); setServerError(errorMessage(e)); },
  });

  function check() {
    setServerError(null);
    const e = validateOrder(v);
    setErrors(e);
    return Object.keys(e).length === 0;
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!check()) return;
    if (order) save.mutate(order.status === 'borrador' ? 'borrador' : 'solicitado');
    else setConfirm(true);
  }

  const form = (
    <form onSubmit={submit} noValidate className="grid gap-5 sm:grid-cols-2">
      <Field label="PAD / Locación" htmlFor="o-pad" required error={errors.pad_id} className="sm:col-span-2">
        <Select id="o-pad" value={v.pad_id} onChange={(e) => setV({ ...v, pad_id: e.target.value })} disabled={catalog.isLoading}>
          <option value="">{catalog.isLoading ? 'Cargando PADs…' : 'Seleccione el PAD…'}</option>
          {pads.map((p) => <option key={p.id} value={p.id}>{p.code}{p.name !== p.code ? ` — ${p.name}` : ''}</option>)}
        </Select>
      </Field>
      <Field label="Cantidad de viajes" htmlFor="o-trips" required error={errors.trips} hint={`Cada viaje: ${liters(TRIP_CAPACITY_LITERS)}.`}>
        <Input id="o-trips" inputMode="numeric" value={v.trips} onChange={(e) => setV({ ...v, trips: e.target.value.replace(/\D/g, '') })} placeholder="Ej.: 2" />
      </Field>
      <Field label="Volumen solicitado" htmlFor="o-volume" hint="Calculado: viajes × 43.000 L.">
        <div id="o-volume" className="flex min-h-[44px] items-center rounded-lg border border-dashed border-brand-600/40 bg-brand-50 px-3 font-display text-xl font-extrabold tabular-nums text-brand-700">
          {volume === null ? '—' : liters(volume)}
        </div>
      </Field>
      <Field label="Fecha requerida de entrega" htmlFor="o-date" required error={errors.required_date}>
        <Input id="o-date" type="date" min={todayIso()} value={v.required_date} onChange={(e) => setV({ ...v, required_date: e.target.value })} />
      </Field>
      <div className="hidden sm:block" />
      <Field label="Observaciones" htmlFor="o-notes" className="sm:col-span-2">
        <Textarea id="o-notes" maxLength={1000} placeholder="Acceso a locación, contacto en campo, horario de descarga…" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
      </Field>
      {serverError && <Alert tone="error" className="sm:col-span-2">{serverError}</Alert>}
      {!order && (
        <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-5 sm:col-span-2">
          <Button type="submit" variant="primary" className="min-h-[46px] px-5">Registrar pedido</Button>
          <Button type="button" loading={save.isPending && !confirm} onClick={() => check() && save.mutate('borrador')}>Guardar borrador</Button>
        </div>
      )}
    </form>
  );

  return (
    <>
      {order ? (
        <Modal open title={`Modificar pedido ${order.order_number}`} onClose={onClose ?? (() => {})}
          footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={submit}>Guardar cambios</Button></>}>
          {form}
        </Modal>
      ) : form}
      {confirm && pad && volume !== null && (
        <Modal open title="Confirmar pedido de combustible" onClose={() => setConfirm(false)}
          footer={<><Button onClick={() => setConfirm(false)}>Volver y corregir</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate('solicitado')}>Confirmar pedido</Button></>}>
          <p className="mb-4 text-[15px] text-slate-700">Revise el volumen calculado antes de registrar el pedido.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {[['PAD', pad.code], ['Volumen', `${liters(volume)}`], ['Fecha requerida', date(v.required_date)]].map(([k, val]) => (
              <div key={k} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{k}</p>
                <p className="mt-1.5 font-display text-xl font-extrabold tabular-nums text-navy-950">{val}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm text-slate-600">{trips} viaje(s) × {liters(TRIP_CAPACITY_LITERS)}.</p>
        </Modal>
      )}
    </>
  );
}
