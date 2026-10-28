import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Plus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { errorMessage } from '../lib/errors';
import { dateTime, downloadCsv, fromLocalInput, liters, parseLiters, toLocalInput, todayIso } from '../lib/format';
import { LEDGER_SOURCE_LABEL, MOVEMENT_HELP, MOVEMENT_LABEL } from '../lib/labels';
import { OPERATIONAL_KEYS, rows, useCatalog } from '../lib/queries';
import type { AppRole, LedgerRow, Movement, MovementType, StockByPad } from '../lib/types';
import { Alert, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Textarea, useToast } from '../components/ui';

const signed = (n: number | null) => (n === null ? '—' : Number(n) === 0 ? liters(0) : `${Number(n) > 0 ? '+' : ''}${liters(n)}`);

/** Tipos de movimiento que cada rol puede registrar (la base de datos lo vuelve a validar). */
function allowedTypes(role: AppRole | null): MovementType[] {
  if (role === 'administrador' || role === 'logistica') return ['stock_inicial', 'ajuste_ingreso', 'ajuste_egreso', 'salida', 'transferencia', 'verificacion_fisica'];
  if (role === 'operaciones') return ['verificacion_fisica'];
  return [];
}

export default function InventoryPage() {
  const { profile } = useAuth();
  const types = allowedTypes(profile?.role ?? null);
  const stock = useQuery({ queryKey: ['stock'], queryFn: () => rows<StockByPad[]>(supabase.from('v_stock_by_pad').select('*').order('pad_code')) });
  const [showAll, setShowAll] = useState(false);
  const [ledgerPad, setLedgerPad] = useState<StockByPad | null>(null);
  const [newMove, setNewMove] = useState<string | null>(null);

  const withActivity = (s: StockByPad) => [s.initial_liters, s.delivered_liters, s.consumed_liters, s.adjustments_liters, s.outflow_liters, s.transfers_net_liters]
    .some((x) => Number(x) !== 0) || s.verified_liters !== null;
  const list = useMemo(() => (stock.data ?? []).filter((s) => showAll ? s.active || withActivity(s) : withActivity(s)), [stock.data, showAll]);
  const total = useMemo(() => (stock.data ?? []).reduce((a, s) => ({
    initial: a.initial + Number(s.initial_liters), delivered: a.delivered + Number(s.delivered_liters), consumed: a.consumed + Number(s.consumed_liters),
    adjustments: a.adjustments + Number(s.adjustments_liters), outflow: a.outflow + Number(s.outflow_liters), estimated: a.estimated + Number(s.estimated_liters),
  }), { initial: 0, delivered: 0, consumed: 0, adjustments: 0, outflow: 0, estimated: 0 }), [stock.data]);

  function exportCsv() {
    downloadCsv(`stock_por_pad_${todayIso()}.csv`,
      ['PAD', 'Stock inicial', 'Entregas', 'Consumos', 'Ajustes', 'Salidas', 'Transferencias netas', 'Stock estimado', 'Verificado', 'Fecha verificación', 'Diferencia'],
      list.map((s) => [s.pad_code, s.initial_liters, s.delivered_liters, s.consumed_liters, s.adjustments_liters, s.outflow_liters, s.transfers_net_liters,
        s.estimated_liters, s.verified_liters ?? '', s.verified_at ? dateTime(s.verified_at) : '', s.verification_difference ?? '']));
  }

  return (
    <>
      <PageHeader eyebrow="Stock" title="Inventario y Stock"
        description="Stock estimado por PAD y consolidado general, calculado desde entregas, consumos y movimientos. La verificación física se compara con el estimado sin modificarlo."
        actions={types.length > 0 && <Button variant="primary" onClick={() => setNewMove('')}><Plus className="h-4 w-4" /> Registrar movimiento</Button>} />
      {stock.isLoading && <Spinner />}
      {stock.error && <Alert tone="error">{errorMessage(stock.error)}</Alert>}
      {stock.data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {[['Stock inicial', total.initial], ['Entregas', total.delivered], ['Consumos', -total.consumed], ['Ajustes netos', total.adjustments], ['Salidas', -total.outflow]].map(([k, v]) => (
              <div key={k as string} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{k}</p>
                <p className="mt-2 font-display text-xl font-extrabold tabular-nums text-navy-950">{k === 'Stock inicial' || k === 'Entregas' ? liters(v as number) : signed(v as number)}</p>
              </div>
            ))}
            <div className={`rounded-2xl border bg-white p-4 shadow-card ring-4 ${total.estimated < 0 ? 'border-red-200 ring-red-50' : 'border-brand-100 ring-brand-50'}`}>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Stock estimado consolidado</p>
              <p className={`mt-2 font-display text-xl font-extrabold tabular-nums ${total.estimated < 0 ? 'text-red-700' : 'text-brand-700'}`}>{liters(total.estimated)}</p>
            </div>
          </div>

          <Card flush>
            <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-5 py-3.5">
              <h2 className="mr-auto font-display text-lg font-bold text-navy-950">Stock por PAD</h2>
              <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" className="h-4 w-4 accent-brand-600" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Incluir PADs activos sin movimientos</label>
              <Button size="sm" onClick={exportCsv} disabled={!list.length}><Download className="h-4 w-4" /> Exportar CSV</Button>
            </div>
            {list.length === 0 ? (
              <div className="p-5"><EmptyState title="Todavía no hay movimientos de stock">Registre el stock inicial de cada PAD con “Registrar movimiento”. Las entregas y consumos se suman automáticamente.</EmptyState></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-[13.5px]">
                  <thead><tr className="bg-slate-50 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-3 text-left">PAD</th><th className="px-3 py-3">Inicial</th><th className="px-3 py-3">Entregas</th><th className="px-3 py-3">Consumos</th>
                    <th className="px-3 py-3">Ajustes</th><th className="px-3 py-3">Salidas</th><th className="px-3 py-3">Transf.</th><th className="px-3 py-3">Estimado</th>
                    <th className="px-3 py-3">Verificado</th><th className="px-4 py-3">Diferencia</th>
                  </tr></thead>
                  <tbody>
                    {list.map((s) => (
                      <tr key={s.pad_id} tabIndex={0} onClick={() => setLedgerPad(s)} onKeyDown={(e) => e.key === 'Enter' && setLedgerPad(s)}
                        className="cursor-pointer border-t border-slate-100 text-right tabular-nums transition-colors hover:bg-navy-50/50">
                        <td className="px-4 py-3 text-left font-mono font-semibold text-navy-900">{s.pad_code}</td>
                        <td className="px-3 py-3">{liters(s.initial_liters)}</td>
                        <td className="px-3 py-3 text-brand-700">{signed(s.delivered_liters)}</td>
                        <td className="px-3 py-3">{signed(-s.consumed_liters)}</td>
                        <td className="px-3 py-3">{signed(s.adjustments_liters)}</td>
                        <td className="px-3 py-3">{signed(-s.outflow_liters)}</td>
                        <td className="px-3 py-3">{signed(s.transfers_net_liters)}</td>
                        <td className={`px-3 py-3 font-display text-[15px] font-extrabold ${Number(s.estimated_liters) < 0 ? 'text-red-700' : 'text-navy-950'}`}>{liters(s.estimated_liters)}</td>
                        <td className="px-3 py-3">{s.verified_liters === null ? '—' : <>{liters(s.verified_liters)}<span className="block text-[11px] text-slate-500">{dateTime(s.verified_at)}</span></>}</td>
                        <td className={`px-4 py-3 font-semibold ${s.verification_difference === null ? '' : Math.abs(Number(s.verification_difference)) > 0 ? 'text-amber-700' : 'text-brand-700'}`}>{signed(s.verification_difference)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500">
              Estimado = inicial + entregas − consumos ± ajustes − salidas ± transferencias. Diferencia = verificado − estimado a la fecha de la verificación. Un estimado negativo indica consumos sin entrega o stock inicial registrados.
            </p>
          </Card>
        </div>
      )}
      {ledgerPad && <Ledger pad={ledgerPad} onClose={() => setLedgerPad(null)} />}
      {newMove !== null && <MovementForm types={types} onClose={() => setNewMove(null)} />}
    </>
  );
}

function Ledger({ pad, onClose }: { pad: StockByPad; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['movements', 'ledger', pad.pad_id],
    queryFn: async () => {
      const [ledger, moves] = await Promise.all([
        rows<LedgerRow[]>(supabase.from('v_stock_ledger').select('*').eq('pad_id', pad.pad_id).order('occurred_at')),
        rows<Movement[]>(supabase.from('v_movements').select('*').or(`pad_id.eq.${pad.pad_id},to_pad_id.eq.${pad.pad_id}`).order('occurred_at')),
      ]);
      return { ledger, moves };
    },
  });
  const lines = useMemo(() => {
    let bal = 0;
    const byId = new Map((q.data?.moves ?? []).map((m) => [m.id, m]));
    return (q.data?.ledger ?? []).map((l) => {
      bal += Number(l.delta);
      const m = byId.get(l.source_id);
      const detail = m ? (m.movement_type === 'transferencia' ? `${m.pad_code} → ${m.to_pad_code} · ${m.reason}` : m.reason) : '';
      return { ...l, balance: bal, detail, by: m?.created_by_name ?? '' };
    }).reverse();
  }, [q.data]);
  const checks = (q.data?.moves ?? []).filter((m) => m.movement_type === 'verificacion_fisica' && m.pad_id === pad.pad_id).reverse();
  return (
    <Modal open wide title={`Movimientos de ${pad.pad_code}`} onClose={onClose} footer={<Button onClick={onClose}>Cerrar</Button>}>
      {q.isLoading && <Spinner />}
      {q.error && <Alert tone="error">{errorMessage(q.error)}</Alert>}
      {q.data && (
        <>
          <p className="mb-3 text-sm text-slate-600">Stock estimado actual: <span className="font-semibold text-navy-950">{liters(pad.estimated_liters)}</span>. Del más reciente al más antiguo, con saldo acumulado.</p>
          {lines.length === 0 ? <EmptyState title="Sin movimientos" /> : (
            <div className="max-h-[50vh] overflow-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[620px] text-[13px]">
                <thead className="sticky top-0"><tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-3.5 py-2.5">Fecha</th><th className="px-3.5 py-2.5">Tipo</th><th className="px-3.5 py-2.5">Detalle</th><th className="px-3.5 py-2.5 text-right">Litros</th><th className="px-3.5 py-2.5 text-right">Saldo</th>
                </tr></thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={`${l.source}-${l.source_id}`} className="border-t border-slate-100">
                      <td className="whitespace-nowrap px-3.5 py-2 tabular-nums">{dateTime(l.occurred_at)}</td>
                      <td className="px-3.5 py-2">{LEDGER_SOURCE_LABEL[l.source] ?? l.source}</td>
                      <td className="px-3.5 py-2 text-slate-600">{l.detail || '—'}{l.by && <span className="block text-[11px] text-slate-400">{l.by}</span>}</td>
                      <td className={`px-3.5 py-2 text-right font-semibold tabular-nums ${Number(l.delta) < 0 ? 'text-navy-900' : 'text-brand-700'}`}>{signed(l.delta)}</td>
                      <td className="px-3.5 py-2 text-right tabular-nums">{liters(l.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {checks.length > 0 && (
            <>
              <h3 className="mb-2 mt-5 font-display text-base font-bold text-navy-950">Verificaciones físicas</h3>
              <ul className="space-y-1 text-sm">{checks.map((c) => <li key={c.id}><span className="tabular-nums">{dateTime(c.occurred_at)}</span> · <span className="font-semibold">{liters(c.liters)}</span> · {c.created_by_name}{c.reason && ` · ${c.reason}`}</li>)}</ul>
            </>
          )}
        </>
      )}
    </Modal>
  );
}

function MovementForm({ types, onClose }: { types: MovementType[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const catalog = useCatalog();
  const pads = (catalog.data?.pads ?? []).filter((p) => p.active);
  const [v, setV] = useState({ movement_type: types[0], pad_id: '', to_pad_id: '', liters: '', occurred_at: toLocalInput(), reason: '' });
  const [error, setError] = useState<string | null>(null);
  const needsReason = !['stock_inicial', 'verificacion_fisica'].includes(v.movement_type);
  const save = useMutation({
    mutationFn: async () => {
      const r = await supabase.from('inventory_movements').insert({
        movement_type: v.movement_type, pad_id: v.pad_id, to_pad_id: v.movement_type === 'transferencia' ? v.to_pad_id : null,
        liters: parseLiters(v.liters), occurred_at: fromLocalInput(v.occurred_at), reason: v.reason.trim(),
      }).select('id').single();
      if (r.error) throw r.error;
    },
    onSuccess: () => { for (const k of OPERATIONAL_KEYS) qc.invalidateQueries({ queryKey: k }); toast(`${MOVEMENT_LABEL[v.movement_type]} registrado.`, 'success'); onClose(); },
    onError: (e) => setError(/stock_inicial/.test(String((e as Error).message)) ? 'Ese PAD ya tiene stock inicial. Use un ajuste para corregirlo.' : errorMessage(e)),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const l = parseLiters(v.liters);
    if (!v.pad_id) return setError('Seleccione el PAD.');
    if (v.movement_type === 'transferencia' && (!v.to_pad_id || v.to_pad_id === v.pad_id)) return setError('Seleccione un PAD de destino distinto del de origen.');
    if (!Number.isFinite(l) || l < 0 || (l === 0 && v.movement_type !== 'verificacion_fisica')) return setError('Ingrese litros mayores que cero.');
    if (!fromLocalInput(v.occurred_at)) return setError('Ingrese la fecha y hora.');
    if (needsReason && !v.reason.trim()) return setError('Indique el motivo.');
    save.mutate();
  }
  return (
    <Modal open title="Registrar movimiento de stock" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={submit}>Registrar</Button></>}>
      <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Tipo de movimiento" htmlFor="m-type" required hint={MOVEMENT_HELP[v.movement_type]} className="sm:col-span-2">
          <Select id="m-type" value={v.movement_type} onChange={(e) => setV({ ...v, movement_type: e.target.value as MovementType })}>
            {types.map((t) => <option key={t} value={t}>{MOVEMENT_LABEL[t]}</option>)}
          </Select>
        </Field>
        <Field label={v.movement_type === 'transferencia' ? 'PAD de origen' : 'PAD'} htmlFor="m-pad" required>
          <Select id="m-pad" value={v.pad_id} onChange={(e) => setV({ ...v, pad_id: e.target.value })}><option value="">Seleccione…</option>{pads.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</Select>
        </Field>
        {v.movement_type === 'transferencia' ? (
          <Field label="PAD de destino" htmlFor="m-to" required>
            <Select id="m-to" value={v.to_pad_id} onChange={(e) => setV({ ...v, to_pad_id: e.target.value })}><option value="">Seleccione…</option>{pads.filter((p) => p.id !== v.pad_id).map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</Select>
          </Field>
        ) : <div className="hidden sm:block" />}
        <Field label={v.movement_type === 'verificacion_fisica' ? 'Litros medidos' : 'Litros'} htmlFor="m-liters" required><Input id="m-liters" inputMode="decimal" value={v.liters} onChange={(e) => setV({ ...v, liters: e.target.value })} /></Field>
        <Field label="Fecha y hora" htmlFor="m-date" required><Input id="m-date" type="datetime-local" value={v.occurred_at} onChange={(e) => setV({ ...v, occurred_at: e.target.value })} /></Field>
        <Field label={needsReason ? 'Motivo' : 'Observaciones'} htmlFor="m-reason" required={needsReason} className="sm:col-span-2"><Textarea id="m-reason" maxLength={500} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field>
        <p className="text-xs text-slate-500 sm:col-span-2">Los movimientos no se editan ni se borran: para corregir, registre un ajuste con su motivo.</p>
        {error && <Alert tone="error" className="sm:col-span-2">{error}</Alert>}
      </form>
    </Modal>
  );
}
