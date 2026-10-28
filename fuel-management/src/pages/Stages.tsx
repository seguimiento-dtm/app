import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Plus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { can } from '../lib/roles';
import { errorMessage } from '../lib/errors';
import { date, dateTime, fromLocalInput, integer, liters, parseLiters, toLocalInput } from '../lib/format';
import { STAGE_STATUS_LABEL, STAGE_STATUS_TONE } from '../lib/labels';
import { OPERATIONAL_KEYS, rows, useCatalog } from '../lib/queries';
import type { Stage, Well } from '../lib/types';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Textarea, useToast } from '../components/ui';

const PAD_KEY = 'fm.etapas.pad';
const storedPad = () => { try { return localStorage.getItem(PAD_KEY) ?? ''; } catch { return ''; } };

export default function StagesPage() {
  const { profile } = useAuth();
  const canRecord = can.recordStages(profile?.role ?? null);
  const catalog = useCatalog();
  const [padId, setPadId] = useState(storedPad);
  const [register, setRegister] = useState<{ wellId?: string; stage?: number } | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const [fix, setFix] = useState<Stage | null>(null);
  const [cancel, setCancel] = useState<Stage | null>(null);

  const activePads = (catalog.data?.pads ?? []).filter((p) => p.active);
  useEffect(() => { try { if (padId) localStorage.setItem(PAD_KEY, padId); } catch { /* sin almacenamiento */ } }, [padId]);

  const stages = useQuery({
    queryKey: ['stages', padId],
    enabled: !!padId,
    queryFn: () => rows<Stage[]>(supabase.from('v_stages').select('*').eq('pad_id', padId).order('well_code').order('stage_number')),
  });
  const wells = useMemo(() => (catalog.data?.wells ?? []).filter((w) => w.pad_id === padId), [catalog.data, padId]);
  const byWell = useMemo(() => {
    const m = new Map<string, Stage[]>();
    for (const s of stages.data ?? []) m.set(s.well_id, [...(m.get(s.well_id) ?? []), s]);
    return m;
  }, [stages.data]);
  const padTotals = useMemo(() => {
    const done = (stages.data ?? []).filter((s) => s.status === 'realizada');
    const withCons = done.filter((s) => s.consumption_liters !== null);
    const total = withCons.reduce((a, s) => a + Number(s.consumption_liters), 0);
    return { done: done.length, withCons: withCons.length, total, avg: withCons.length ? total / withCons.length : null };
  }, [stages.data]);

  return (
    <>
      <PageHeader eyebrow="Operaciones" title="Registro de Etapas"
        description="Etapas por pozo y consumo de cada etapa realizada. Un único registro de litros por etapa; las canceladas no cuentan."
        actions={canRecord && padId && <>
          <Button onClick={() => setPlan(wells.find((w) => w.active)?.id ?? '')}><CalendarPlus className="h-4 w-4" /> Planificar etapas</Button>
          <Button variant="primary" onClick={() => setRegister({})}><Plus className="h-4 w-4" /> Registrar etapa realizada</Button>
        </>} />

      <Card className="mb-6">
        <div className="grid gap-4 md:grid-cols-[minmax(0,320px)_1fr] md:items-end">
          <Field label="PAD" htmlFor="s-pad">
            <Select id="s-pad" value={padId} onChange={(e) => setPadId(e.target.value)} disabled={catalog.isLoading}>
              <option value="">Seleccione el PAD…</option>
              {activePads.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
            </Select>
          </Field>
          {padId && stages.data && (
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[['Pozos', integer(wells.length)], ['Etapas realizadas', integer(padTotals.done)], ['Consumo del PAD', liters(padTotals.total)],
                ['Promedio por etapa', padTotals.avg === null ? '—' : liters(padTotals.avg)]].map(([k, v]) => (
                <div key={k} className="rounded-xl bg-slate-50 px-3.5 py-2.5"><dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{k}</dt><dd className="mt-0.5 font-display text-lg font-extrabold tabular-nums text-navy-950">{v}</dd></div>
              ))}
            </dl>
          )}
        </div>
      </Card>

      {!padId && <EmptyState title="Seleccione un PAD">Se mostrarán sus pozos y etapas.</EmptyState>}
      {padId && stages.isLoading && <Spinner />}
      {stages.error && <Alert tone="error">{errorMessage(stages.error)}</Alert>}
      {padId && stages.data && (
        <div className="space-y-5">
          {wells.length === 0 && <EmptyState title="El PAD no tiene pozos cargados" />}
          {wells.map((w) => <WellStages key={w.id} well={w} stages={byWell.get(w.id) ?? []} canRecord={canRecord}
            onRegister={(stage) => setRegister({ wellId: w.id, stage })} onFix={setFix} onCancel={setCancel} />)}
        </div>
      )}

      {register && <RegisterStage wells={wells.filter((w) => w.active)} stages={stages.data ?? []} initial={register} onClose={() => setRegister(null)} />}
      {plan !== null && <PlanStages wells={wells.filter((w) => w.active)} initialWell={plan} onClose={() => setPlan(null)} />}
      {fix && <FixConsumption stage={fix} onClose={() => setFix(null)} />}
      {cancel && <CancelStage stage={cancel} onClose={() => setCancel(null)} />}
    </>
  );
}

function WellStages({ well, stages, canRecord, onRegister, onFix, onCancel }:
  { well: Well; stages: Stage[]; canRecord: boolean; onRegister: (n: number) => void; onFix: (s: Stage) => void; onCancel: (s: Stage) => void }) {
  const withCons = stages.filter((s) => s.consumption_liters !== null);
  const total = withCons.reduce((a, s) => a + Number(s.consumption_liters), 0);
  return (
    <Card flush>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-200 px-5 py-3.5">
        <h3 className="mr-auto font-mono text-[15px] font-semibold text-navy-900">{well.code}{!well.active && <span className="ml-2 font-sans text-xs font-normal text-slate-500">(inactivo)</span>}</h3>
        <span className="text-sm text-slate-600">{stages.filter((s) => s.status === 'realizada').length} realizadas{well.planned_stages ? ` de ${well.planned_stages} planificadas` : ''}</span>
        <span className="text-sm text-slate-600">Consumo <span className="font-semibold tabular-nums text-navy-950">{liters(total)}</span></span>
        <span className="text-sm text-slate-600">Promedio <span className="font-semibold tabular-nums text-navy-950">{withCons.length ? liters(total / withCons.length) : '—'}</span></span>
      </div>
      {stages.length === 0 ? <p className="px-5 py-4 text-sm text-slate-500">Sin etapas registradas.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13.5px]">
            <thead><tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <th className="px-5 py-2.5">Etapa</th><th className="px-3 py-2.5">Estado</th><th className="px-3 py-2.5">Planificada</th><th className="px-3 py-2.5">Realizada</th>
              <th className="px-3 py-2.5 text-right">Consumo</th><th className="px-3 py-2.5">Registró</th>{canRecord && <th />}
            </tr></thead>
            <tbody>
              {stages.map((s) => (
                <tr key={s.id} className={`border-t border-slate-100 ${s.status === 'cancelada' ? 'text-slate-400' : ''}`}>
                  <td className="px-5 py-2.5 font-semibold tabular-nums">Etapa {s.stage_number}</td>
                  <td className="px-3 py-2.5"><Badge tone={STAGE_STATUS_TONE[s.status]}>{STAGE_STATUS_LABEL[s.status]}</Badge></td>
                  <td className="px-3 py-2.5 tabular-nums">{date(s.planned_date)}</td>
                  <td className="px-3 py-2.5 tabular-nums">{dateTime(s.executed_at)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{s.consumption_liters === null ? '—' : liters(s.consumption_liters)}</td>
                  <td className="px-3 py-2.5 text-slate-600">{s.recorded_by_name || '—'}</td>
                  {canRecord && (
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {s.status === 'planificada' && well.active && <Button size="sm" variant="ghost" onClick={() => onRegister(s.stage_number)}>Registrar consumo</Button>}
                      {s.status === 'planificada' && <Button size="sm" variant="ghost" onClick={() => onCancel(s)}>Cancelar</Button>}
                      {s.status === 'realizada' && s.consumption_id && <Button size="sm" variant="ghost" onClick={() => onFix(s)}>Corregir litros</Button>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function useRefresh() {
  const qc = useQueryClient();
  return () => { for (const k of OPERATIONAL_KEYS) qc.invalidateQueries({ queryKey: k }); };
}

function RegisterStage({ wells, stages, initial, onClose }: { wells: Well[]; stages: Stage[]; initial: { wellId?: string; stage?: number }; onClose: () => void }) {
  const refresh = useRefresh();
  const toast = useToast();
  const nextStage = (wellId: string) => {
    const s = stages.filter((x) => x.well_id === wellId);
    const pending = s.filter((x) => x.status === 'planificada').map((x) => x.stage_number).sort((a, b) => a - b)[0];
    return pending ?? (s.length ? Math.max(...s.map((x) => x.stage_number)) + 1 : 1);
  };
  const firstWell = initial.wellId ?? wells[0]?.id ?? '';
  const [v, setV] = useState({ well_id: firstWell, stage: String(initial.stage ?? (firstWell ? nextStage(firstWell) : 1)), executed_at: toLocalInput(), liters: '', notes: '' });
  const [error, setError] = useState<string | null>(null);
  const well = wells.find((w) => w.id === v.well_id);
  const save = useMutation({
    mutationFn: async () => {
      const r = await supabase.rpc('register_stage_consumption', {
        p_well_id: v.well_id, p_stage_number: Number(v.stage), p_executed_at: fromLocalInput(v.executed_at), p_liters: parseLiters(v.liters), p_notes: v.notes.trim(),
      });
      if (r.error) throw r.error;
    },
    onSuccess: () => { refresh(); toast(`Pozo ${well?.code}, etapa ${v.stage}: ${liters(parseLiters(v.liters))} registrados.`, 'success'); onClose(); },
    onError: (e) => setError(errorMessage(e)),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const n = Number(v.stage);
    const l = parseLiters(v.liters);
    if (!v.well_id) return setError('Seleccione el pozo.');
    if (!Number.isInteger(n) || n < 1 || n > 200) return setError('El número de etapa debe ser un entero entre 1 y 200.');
    if (!fromLocalInput(v.executed_at)) return setError('Ingrese la fecha y hora de la etapa.');
    if (!Number.isFinite(l) || l <= 0) return setError('El consumo debe ser mayor que cero.');
    save.mutate();
  }
  return (
    <Modal open title="Registrar etapa realizada" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={submit}>Registrar</Button></>}>
      <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Pozo" htmlFor="r-well" required className="sm:col-span-2">
          <Select id="r-well" value={v.well_id} onChange={(e) => setV({ ...v, well_id: e.target.value, stage: String(nextStage(e.target.value)) })}>
            {wells.map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}
          </Select>
        </Field>
        <Field label="Etapa N.º" htmlFor="r-stage" required hint="Se propone la próxima etapa pendiente."><Input id="r-stage" inputMode="numeric" value={v.stage} onChange={(e) => setV({ ...v, stage: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label="Fecha y hora de realización" htmlFor="r-date" required><Input id="r-date" type="datetime-local" value={v.executed_at} onChange={(e) => setV({ ...v, executed_at: e.target.value })} /></Field>
        <Field label="Consumo de la etapa" htmlFor="r-liters" required hint="Litros, por ejemplo 13.425." className="sm:col-span-2">
          <Input id="r-liters" inputMode="decimal" value={v.liters} onChange={(e) => setV({ ...v, liters: e.target.value })} />
        </Field>
        <Field label="Observaciones" htmlFor="r-notes" className="sm:col-span-2"><Textarea id="r-notes" maxLength={1000} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
        {error && <Alert tone="error" className="sm:col-span-2">{error}</Alert>}
      </form>
    </Modal>
  );
}

function PlanStages({ wells, initialWell, onClose }: { wells: Well[]; initialWell: string; onClose: () => void }) {
  const refresh = useRefresh();
  const toast = useToast();
  const w0 = wells.find((w) => w.id === initialWell) ?? wells[0];
  const [v, setV] = useState({ well_id: w0?.id ?? '', count: String(w0?.planned_stages ?? ''), planned_date: '' });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      const r = await supabase.rpc('plan_stages', { p_well_id: v.well_id, p_count: Number(v.count), p_planned_date: v.planned_date || null });
      if (r.error) throw r.error;
      return r.data as number;
    },
    onSuccess: (n) => { refresh(); toast(n ? `${n} etapa(s) planificada(s).` : 'Las etapas ya existían: no se agregó ninguna.', n ? 'success' : 'info'); onClose(); },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Modal open title="Planificar etapas" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={() => {
        setError(null);
        const n = Number(v.count);
        if (!v.well_id) return setError('Seleccione el pozo.');
        if (!Number.isInteger(n) || n < 1 || n > 200) return setError('Indique entre 1 y 200 etapas.');
        save.mutate();
      }}>Planificar</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <p className="text-sm text-slate-600 sm:col-span-2">Crea las etapas 1 a N del pozo como “planificadas”. Las que ya existen no se modifican.</p>
        <Field label="Pozo" htmlFor="p-well" required className="sm:col-span-2">
          <Select id="p-well" value={v.well_id} onChange={(e) => setV({ ...v, well_id: e.target.value })}>{wells.map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}</Select>
        </Field>
        <Field label="Cantidad de etapas" htmlFor="p-count" required><Input id="p-count" inputMode="numeric" value={v.count} onChange={(e) => setV({ ...v, count: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label="Fecha planificada" htmlFor="p-date" hint="Opcional."><Input id="p-date" type="date" value={v.planned_date} onChange={(e) => setV({ ...v, planned_date: e.target.value })} /></Field>
        {error && <Alert tone="error" className="sm:col-span-2">{error}</Alert>}
      </div>
    </Modal>
  );
}

function FixConsumption({ stage, onClose }: { stage: Stage; onClose: () => void }) {
  const refresh = useRefresh();
  const toast = useToast();
  const [value, setValue] = useState(String(stage.consumption_liters ?? ''));
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      const l = parseLiters(value);
      if (!Number.isFinite(l) || l <= 0) throw new Error('El consumo debe ser mayor que cero.');
      const r = await supabase.from('fuel_consumption').update({ liters: l }).eq('id', stage.consumption_id!).select('id');
      if (r.error) throw r.error;
      if (!r.data?.length) throw new Error('Su rol no tiene permiso para corregir consumos.');
    },
    onSuccess: () => { refresh(); toast('Consumo corregido. El cambio queda en la auditoría.', 'success'); onClose(); },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Modal open title={`Corregir consumo · ${stage.well_code}, etapa ${stage.stage_number}`} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Guardar</Button></>}>
      <Field label="Litros consumidos" htmlFor="f-liters" hint={`Valor actual: ${liters(stage.consumption_liters)}.`}><Input id="f-liters" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} /></Field>
      {error && <Alert tone="error" className="mt-4">{error}</Alert>}
    </Modal>
  );
}

function CancelStage({ stage, onClose }: { stage: Stage; onClose: () => void }) {
  const refresh = useRefresh();
  const toast = useToast();
  const [notes, setNotes] = useState('');
  const save = useMutation({
    mutationFn: async () => {
      const r = await supabase.from('fracture_stages').update({ status: 'cancelada', notes: notes.trim() }).eq('id', stage.id).select('id');
      if (r.error) throw r.error;
      if (!r.data?.length) throw new Error('Su rol no tiene permiso para cancelar etapas.');
    },
    onSuccess: () => { refresh(); toast(`Etapa ${stage.stage_number} de ${stage.well_code} cancelada.`, 'success'); onClose(); },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <Modal open title={`Cancelar etapa ${stage.stage_number} · ${stage.well_code}`} onClose={onClose}
      footer={<><Button onClick={onClose}>Volver</Button><Button variant="danger" loading={save.isPending} disabled={!notes.trim()} onClick={() => save.mutate()}>Cancelar etapa</Button></>}>
      <p className="mb-4 text-sm text-slate-600">La etapa queda registrada como cancelada y no se cuenta en promedios ni admite consumo.</p>
      <Field label="Motivo" htmlFor="c-notes" required><Textarea id="c-notes" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </Modal>
  );
}
