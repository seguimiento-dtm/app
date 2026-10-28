import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Pencil, Plus, Search } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { can } from '../lib/roles';
import { errorMessage } from '../lib/errors';
import { integer, liters } from '../lib/format';
import type { Pad, PadConsumption, Well } from '../lib/types';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, useToast } from '../components/ui';

async function fetchCatalog() {
  const [pads, wells, cons] = await Promise.all([
    supabase.from('pads').select('*').order('code'),
    supabase.from('wells').select('*').order('code'),
    supabase.from('v_pad_consumption').select('*'),
  ]);
  for (const r of [pads, wells, cons]) if (r.error) throw r.error;
  return { pads: pads.data as Pad[], wells: wells.data as Well[], consumption: cons.data as PadConsumption[] };
}

type StatusFilter = 'activos' | 'inactivos' | 'todos';

export default function PadsWellsPage() {
  const { profile } = useAuth();
  const isAdmin = can.manageCatalog(profile?.role ?? null);
  const q = useQuery({ queryKey: ['catalog'], queryFn: fetchCatalog });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('activos');
  const [openPad, setOpenPad] = useState<string | null>(null);
  const [editPad, setEditPad] = useState<Pad | 'new' | null>(null);

  const view = useMemo(() => {
    if (!q.data) return [];
    const term = search.trim().toLowerCase();
    const wellsByPad = new Map<string, Well[]>();
    for (const w of q.data.wells) wellsByPad.set(w.pad_id, [...(wellsByPad.get(w.pad_id) ?? []), w]);
    const consByPad = new Map(q.data.consumption.map((c) => [c.pad_id, c]));
    return q.data.pads
      .filter((p) => (status === 'todos' ? true : status === 'activos' ? p.active : !p.active))
      .map((p) => {
        const wells = wellsByPad.get(p.id) ?? [];
        const matchedWells = term ? wells.filter((w) => w.code.toLowerCase().includes(term) || w.name.toLowerCase().includes(term)) : [];
        return { pad: p, wells, matchedWells, cons: consByPad.get(p.id) };
      })
      .filter(({ pad, matchedWells }) => !term || pad.code.toLowerCase().includes(term) || pad.name.toLowerCase().includes(term)
        || (pad.area ?? '').toLowerCase().includes(term) || matchedWells.length > 0);
  }, [q.data, search, status]);

  const stats = useMemo(() => {
    const d = q.data;
    if (!d) return null;
    const activePads = new Set(d.pads.filter((p) => p.active).map((p) => p.id));
    return {
      pads: activePads.size,
      wells: d.wells.filter((w) => w.active && activePads.has(w.pad_id)).length,
      inactive: d.pads.length - activePads.size,
    };
  }, [q.data]);

  const selected = q.data?.pads.find((p) => p.id === openPad) ?? null;

  return (
    <>
      <PageHeader
        eyebrow="Maestro operativo"
        title="PADs y Pozos"
        description="Catálogo de PADs y sus pozos. Solo los registros activos se ofrecen para nuevas operaciones; los históricos conservan su relación."
        actions={isAdmin && <Button variant="primary" onClick={() => setEditPad('new')}><Plus className="h-4 w-4" /> Nuevo PAD</Button>}
      />

      {q.isLoading && <Spinner />}
      {q.error && <Alert tone="error" title="No se pudo cargar el catálogo">{errorMessage(q.error)}</Alert>}

      {q.data && stats && (
        <>
          <div className="mb-5 grid grid-cols-3 gap-3">
            <Stat label="PADs activos" value={integer(stats.pads)} />
            <Stat label="Pozos activos" value={integer(stats.wells)} />
            <Stat label="PADs inactivos" value={integer(stats.inactive)} />
          </div>

          <Card flush>
            <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-4 sm:p-5">
              <Field label="Buscar PAD o pozo" htmlFor="pw-search" className="min-w-[220px] flex-1">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                  <Input id="pw-search" type="search" placeholder="Ej.: LA-WP130 o LA-750(h)" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
              </Field>
              <Field label="Estado" htmlFor="pw-status" className="w-40">
                <Select id="pw-status" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
                  <option value="activos">Activos</option>
                  <option value="inactivos">Inactivos</option>
                  <option value="todos">Todos</option>
                </Select>
              </Field>
              <p className="pb-2.5 text-sm text-slate-500">{integer(view.length)} PAD(s)</p>
            </div>

            {view.length === 0 ? (
              <div className="p-5">
                <EmptyState title={q.data.pads.length ? 'Sin resultados' : 'Todavía no hay PADs cargados'}>
                  {q.data.pads.length ? 'Pruebe con otro código o cambie el filtro de estado.' : 'Un administrador puede cargarlos con “Nuevo PAD”.'}
                </EmptyState>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-[13.5px]">
                  <thead>
                    <tr className="bg-slate-50 text-left text-[11.5px] font-semibold uppercase tracking-wider text-slate-500">
                      <th className="px-4 py-3">PAD</th>
                      <th className="px-4 py-3">Área / yacimiento</th>
                      <th className="px-4 py-3 text-right">Pozos</th>
                      <th className="px-4 py-3 text-right">Etapas realizadas</th>
                      <th className="px-4 py-3 text-right">Consumo acumulado</th>
                      <th className="px-4 py-3 text-right">Promedio / etapa</th>
                      <th className="px-4 py-3">Estado</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {view.map(({ pad, wells, matchedWells, cons }) => (
                      <tr key={pad.id} onClick={() => setOpenPad(pad.id)} tabIndex={0}
                        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setOpenPad(pad.id))}
                        className="group cursor-pointer border-t border-slate-100 transition-colors hover:bg-navy-50/50 focus:bg-navy-50/60 focus:outline-none">
                        <td className="px-4 py-3">
                          <p className="font-mono font-semibold text-navy-900">{pad.code}</p>
                          {pad.name !== pad.code && <p className="text-slate-500">{pad.name}</p>}
                          {matchedWells.length > 0 && <p className="mt-0.5 text-xs text-brand-700">Pozo: {matchedWells.map((w) => w.code).join(', ')}</p>}
                        </td>
                        <td className="px-4 py-3 text-slate-600">{pad.area || '—'}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{wells.length}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{integer(cons?.stages_done ?? 0)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{liters(cons?.consumption_liters ?? 0)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{cons?.avg_liters_per_stage != null ? liters(cons.avg_liters_per_stage) : '—'}</td>
                        <td className="px-4 py-3">{pad.active ? <Badge tone="green">Activo</Badge> : <Badge>Inactivo</Badge>}</td>
                        <td className="px-4 py-3 text-right"><ChevronRight className="ml-auto h-4 w-4 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-navy-700" aria-hidden /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {selected && q.data && (
        <PadDetail
          pad={selected}
          wells={q.data.wells.filter((w) => w.pad_id === selected.id)}
          allPads={q.data.pads}
          cons={q.data.consumption.find((c) => c.pad_id === selected.id)}
          isAdmin={isAdmin}
          onEdit={() => setEditPad(selected)}
          onClose={() => setOpenPad(null)}
        />
      )}
      {editPad && <PadForm pad={editPad === 'new' ? null : editPad} onClose={() => setEditPad(null)} onSaved={(id) => { setEditPad(null); setOpenPad(id); }} />}
    </>
  );
}

function Stat({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white px-4 py-3.5 shadow-card ${className}`}>
      <p className="text-[11.5px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 font-display text-2xl font-extrabold tabular-nums text-navy-950">{value}</p>
    </div>
  );
}

function PadDetail({ pad, wells, allPads, cons, isAdmin, onEdit, onClose }:
  { pad: Pad; wells: Well[]; allPads: Pad[]; cons?: PadConsumption; isAdmin: boolean; onEdit: () => void; onClose: () => void }) {
  const [editWell, setEditWell] = useState<Well | 'new' | null>(null);
  return (
    <Modal open wide title={`PAD ${pad.code}`} onClose={onClose}
      footer={<>{isAdmin && <Button onClick={onEdit}><Pencil className="h-4 w-4" /> Modificar PAD</Button>}<Button onClick={onClose}>Cerrar</Button></>}>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Nombre', pad.name],
          ['Área / yacimiento', pad.area || '—'],
          ['Consumo acumulado', liters(cons?.consumption_liters ?? 0)],
          ['Promedio por etapa', cons?.avg_liters_per_stage != null ? liters(cons.avg_liters_per_stage) : '—'],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{k}</dt>
            <dd className="mt-1 font-semibold text-navy-950">{v}</dd>
          </div>
        ))}
      </dl>
      {!pad.active && <Alert tone="warning" className="mt-4">PAD inactivo: no se ofrece para nuevos pedidos ni etapas. Sus registros históricos se conservan.</Alert>}

      <div className="mb-3 mt-6 flex items-center gap-3">
        <h3 className="mr-auto font-display text-lg font-bold text-navy-950">Pozos ({wells.length})</h3>
        {isAdmin && <Button size="sm" variant="primary" onClick={() => setEditWell('new')}><Plus className="h-4 w-4" /> Agregar pozo</Button>}
      </div>
      {wells.length === 0 ? (
        <EmptyState title="Sin pozos asociados" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[560px] text-[13.5px]">
            <thead>
              <tr className="bg-slate-50 text-left text-[11.5px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-3.5 py-2.5">Pozo</th><th className="px-3.5 py-2.5 text-right">Etapas planificadas</th>
                <th className="px-3.5 py-2.5">Estado operativo</th><th className="px-3.5 py-2.5">Estado</th>{isAdmin && <th />}
              </tr>
            </thead>
            <tbody>
              {wells.map((w) => (
                <tr key={w.id} className="border-t border-slate-100">
                  <td className="px-3.5 py-2.5"><span className="font-mono font-semibold text-navy-900">{w.code}</span>{w.name !== w.code && <span className="ml-2 text-slate-500">{w.name}</span>}</td>
                  <td className="px-3.5 py-2.5 text-right tabular-nums">{w.planned_stages ?? '—'}</td>
                  <td className="px-3.5 py-2.5 text-slate-600">{w.operational_status || '—'}</td>
                  <td className="px-3.5 py-2.5">{w.active ? <Badge tone="green">Activo</Badge> : <Badge>Inactivo</Badge>}</td>
                  {isAdmin && <td className="px-3.5 py-2.5 text-right"><Button size="sm" variant="ghost" onClick={() => setEditWell(w)}><Pencil className="h-3.5 w-3.5" /> Modificar</Button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editWell && <WellForm well={editWell === 'new' ? null : editWell} padId={pad.id} pads={allPads} onClose={() => setEditWell(null)} />}
    </Modal>
  );
}

function PadForm({ pad, onClose, onSaved }: { pad: Pad | null; onClose: () => void; onSaved: (id: string) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ code: pad?.code ?? '', name: pad?.name ?? '', area: pad?.area ?? '', active: pad?.active ?? true });
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: async () => {
      const body = { code: f.code.trim(), name: f.name.trim() || f.code.trim(), area: f.area.trim() || null, active: f.active };
      const r = pad ? await supabase.from('pads').update(body).eq('id', pad.id).select().single()
        : await supabase.from('pads').insert(body).select().single();
      if (r.error) throw r.error;
      return r.data as Pad;
    },
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: ['catalog'] }); toast(`PAD ${p.code} guardado.`, 'success'); onSaved(p.id); },
    onError: (e) => setError(errorMessage(e)),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!f.code.trim()) return setError('El código del PAD es obligatorio.');
    if (f.code.trim().length > 60) return setError('El código no puede superar 60 caracteres.');
    m.mutate();
  }
  return (
    <Modal open title={pad ? `Modificar PAD ${pad.code}` : 'Nuevo PAD'} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={m.isPending} onClick={submit}>Guardar</Button></>}>
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <Field label="Código del PAD" htmlFor="p-code" required hint="Identificador estable, por ejemplo LA-WP130. No se repite."><Input id="p-code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
        <Field label="Nombre" htmlFor="p-name" hint="Si se deja vacío, se usa el código."><Input id="p-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Área / yacimiento" htmlFor="p-area"><Input id="p-area" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm font-semibold text-navy-900">
          <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Activo (disponible para nuevas operaciones)
        </label>
        {error && <Alert tone="error">{error}</Alert>}
      </form>
    </Modal>
  );
}

function WellForm({ well, padId, pads, onClose }: { well: Well | null; padId: string; pads: Pad[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({
    pad_id: well?.pad_id ?? padId, code: well?.code ?? '', name: well?.name ?? '',
    planned_stages: well?.planned_stages?.toString() ?? '', operational_status: well?.operational_status ?? '', active: well?.active ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: async () => {
      const body = {
        pad_id: f.pad_id, code: f.code.trim(), name: f.name.trim() || f.code.trim(),
        planned_stages: f.planned_stages === '' ? null : Number(f.planned_stages),
        operational_status: f.operational_status.trim() || null, active: f.active,
      };
      const r = well ? await supabase.from('wells').update(body).eq('id', well.id).select().single()
        : await supabase.from('wells').insert(body).select().single();
      if (r.error) throw r.error;
      return r.data as Well;
    },
    onSuccess: (w) => { qc.invalidateQueries({ queryKey: ['catalog'] }); toast(`Pozo ${w.code} guardado.`, 'success'); onClose(); },
    onError: (e) => setError(errorMessage(e)),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!f.code.trim()) return setError('El código del pozo es obligatorio.');
    if (f.planned_stages !== '' && (!Number.isInteger(Number(f.planned_stages)) || Number(f.planned_stages) < 0 || Number(f.planned_stages) > 200)) {
      return setError('Las etapas planificadas deben ser un número entero entre 0 y 200.');
    }
    m.mutate();
  }
  return (
    <Modal open title={well ? `Modificar pozo ${well.code}` : 'Agregar pozo'} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={m.isPending} onClick={submit}>Guardar</Button></>}>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label="Código del pozo" htmlFor="w-code" required className="sm:col-span-2"><Input id="w-code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
        <Field label="Nombre" htmlFor="w-name" hint="Si se deja vacío, se usa el código." className="sm:col-span-2"><Input id="w-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="PAD" htmlFor="w-pad" required hint={well ? 'Un pozo con etapas registradas no puede cambiar de PAD.' : undefined} className="sm:col-span-2">
          <Select id="w-pad" value={f.pad_id} onChange={(e) => setF({ ...f, pad_id: e.target.value })}>
            {pads.filter((p) => p.active || p.id === f.pad_id).map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
          </Select>
        </Field>
        <Field label="Etapas planificadas" htmlFor="w-stages"><Input id="w-stages" inputMode="numeric" value={f.planned_stages} onChange={(e) => setF({ ...f, planned_stages: e.target.value })} /></Field>
        <Field label="Estado operativo" htmlFor="w-opst"><Input id="w-opst" placeholder="Ej.: En completación" value={f.operational_status} onChange={(e) => setF({ ...f, operational_status: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm font-semibold text-navy-900 sm:col-span-2">
          <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Activo
        </label>
        {error && <Alert tone="error" className="sm:col-span-2">{error}</Alert>}
      </form>
    </Modal>
  );
}
