import { useMemo, useRef, useState, type DragEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import readXlsxFile, { readSheetNames } from 'read-excel-file';
import { CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { errorMessage } from '../lib/errors';
import { downloadCsv, integer, todayIso } from '../lib/format';
import {
  FIELDS, RESULT_LABEL, autoMap, buildRows, cellText, detectHeaderRow, parseCsv, structuralProblems,
  type Cell, type FieldKey, type ImportResult, type ImportResultRow, type Mapping,
} from '../lib/importMaster';
import { Alert, Badge, Button, Field, Modal, Select, Spinner } from './ui';

const STEPS = ['Archivo', 'Hoja', 'Columnas', 'Vista previa', 'Validación', 'Resultado'];
const TONE: Record<ImportResultRow['status'], 'green' | 'navy' | 'gray' | 'amber' | 'red'> = {
  nuevo: 'green', actualiza: 'navy', sin_cambios: 'gray', duplicado: 'amber', error: 'red',
};

export function ImportWizard({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<string[]>([]);
  const [sheet, setSheet] = useState('');
  const [raw, setRaw] = useState<Cell[][]>([]);
  const [headerIdx, setHeaderIdx] = useState(0);
  const [map, setMap] = useState<Mapping>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [filter, setFilter] = useState<ImportResultRow['status'] | 'todas'>('todas');
  const [drag, setDrag] = useState(false);

  const headers = useMemo(() => (raw[headerIdx] ?? []).map(cellText), [raw, headerIdx]);
  const data = useMemo(() => buildRows(raw, headerIdx, map), [raw, headerIdx, map]);
  const problems = useMemo(() => (raw.length ? structuralProblems(map, data) : []), [map, data, raw.length]);

  async function loadSheet(f: File, name: string) {
    setLoading(true);
    setError(null);
    try {
      const rows = f.name.toLowerCase().endsWith('.csv') ? parseCsv(await f.text()) : ((await readXlsxFile(f, { sheet: name })) as Cell[][]);
      const h = detectHeaderRow(rows);
      setRaw(rows);
      setHeaderIdx(h);
      setMap(autoMap((rows[h] ?? []).map(cellText)));
      setStep(2);
    } catch (e) {
      setError(`No se pudo leer la hoja: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  async function pickFile(f: File | undefined) {
    if (!f) return;
    setError(null);
    if (!/\.(xlsx|csv)$/i.test(f.name)) return setError('Formato no admitido. Seleccione un archivo .xlsx o .csv.');
    if (f.size > 10 * 1024 * 1024) return setError('El archivo supera 10 MB.');
    setFile(f);
    setPreview(null);
    setResult(null);
    if (f.name.toLowerCase().endsWith('.csv')) {
      setSheets(['CSV']); setSheet('CSV');
      return loadSheet(f, 'CSV');
    }
    setLoading(true);
    try {
      const names = await readSheetNames(f);
      setSheets(names);
      setSheet(names[0]);
      if (names.length === 1) await loadSheet(f, names[0]);
      else setStep(1);
    } catch (e) {
      setError(`No se pudo abrir el archivo: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  const run = useMutation({
    mutationFn: async (dryRun: boolean) => {
      const r = await supabase.rpc('import_master', { p_file_name: file?.name ?? '', p_sheet_name: sheet, p_rows: data, p_dry_run: dryRun });
      if (r.error) throw r.error;
      return r.data as ImportResult;
    },
    onSuccess: (r, dryRun) => {
      if (dryRun) { setPreview(r); setStep(4); setFilter(r.summary.errors ? 'error' : 'todas'); }
      else {
        setResult(r); setStep(5);
        for (const k of [['catalog'], ['catalog-lite'], ['dashboard'], ['imports']]) qc.invalidateQueries({ queryKey: k });
      }
    },
    onError: (e) => setError(errorMessage(e)),
  });

  function downloadReport(r: ImportResult) {
    const s = r.summary;
    downloadCsv(`importacion_maestro_${todayIso()}.csv`, ['Fila', 'PAD', 'Pozo', 'Resultado', 'Detalle'], [
      ['Archivo', file?.name ?? '', `Hoja: ${sheet}`, r.dry_run ? 'Vista previa (sin guardar)' : 'Importado', ''],
      ['Resumen', `PADs nuevos ${s.pads_created} · actualizados ${s.pads_updated}`, `Pozos nuevos ${s.wells_created} · actualizados ${s.wells_updated}`,
        `Sin cambios ${s.unchanged} · duplicados ${s.duplicates} · errores ${s.errors}`, `Filas ${s.rows_processed}`],
      ...r.rows.map((x) => [x.row, x.pad_code ?? '', x.well_code ?? '', RESULT_LABEL[x.status], x.message ?? '']),
    ]);
  }

  const shown = (preview ?? result)?.rows.filter((r) => filter === 'todas' || r.status === filter) ?? [];
  const summary = (result ?? preview)?.summary;
  const valid = summary ? summary.pads_created + summary.pads_updated + summary.wells_created + summary.wells_updated : 0;

  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); pickFile(e.dataTransfer.files[0]); };

  let footer = <Button onClick={onClose}>Cancelar</Button>;
  if (step === 1) footer = <><Button onClick={() => setStep(0)}>Volver</Button><Button variant="primary" loading={loading} onClick={() => file && loadSheet(file, sheet)}>Continuar</Button></>;
  if (step === 2) footer = <><Button onClick={() => setStep(sheets.length > 1 ? 1 : 0)}>Volver</Button><Button variant="primary" disabled={problems.length > 0} onClick={() => setStep(3)}>Ver vista previa</Button></>;
  if (step === 3) footer = <><Button onClick={() => setStep(2)}>Volver</Button><Button variant="primary" loading={run.isPending} disabled={problems.length > 0} onClick={() => { setError(null); run.mutate(true); }}>Validar</Button></>;
  if (step === 4) footer = <>
    <Button onClick={() => setStep(3)}>Volver</Button>
    {preview && <Button onClick={() => downloadReport(preview)}><Download className="h-4 w-4" /> Reporte de validación</Button>}
    <Button variant="primary" loading={run.isPending} disabled={!valid} onClick={() => { setError(null); run.mutate(false); }}>
      {valid ? `Confirmar e importar` : 'No hay cambios para importar'}
    </Button></>;
  if (step === 5) footer = <>{result && <Button onClick={() => downloadReport(result)}><Download className="h-4 w-4" /> Descargar reporte</Button>}<Button variant="primary" onClick={onClose}>Finalizar</Button></>;

  return (
    <Modal open wide title="Importar maestro de PADs y pozos" onClose={onClose} footer={footer}>
      <ol className="mb-6 flex flex-wrap gap-x-1 gap-y-2 text-[12.5px]" aria-label="Pasos">
        {STEPS.map((s, i) => (
          <li key={s} className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold ${i === step ? 'bg-navy-900 text-white' : i < step ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-500'}`}>
            <span className="tabular-nums">{i + 1}</span> {s}
          </li>
        ))}
      </ol>
      {error && <Alert tone="error" className="mb-4">{error}</Alert>}

      {step === 0 && (
        <div>
          <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
            className={`flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${drag ? 'border-brand-600 bg-brand-50' : 'border-slate-300 bg-slate-50'}`}>
            <FileSpreadsheet className="h-10 w-10 text-navy-600" aria-hidden />
            <p className="font-display text-lg font-bold text-navy-950">Arrastre el archivo aquí</p>
            <p className="text-sm text-slate-600">Excel (.xlsx) o CSV, hasta 5.000 filas.</p>
            <Button variant="primary" loading={loading} onClick={() => input.current?.click()}><Upload className="h-4 w-4" /> Seleccionar archivo</Button>
            <input ref={input} type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
          <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-600">
            <li>Los PADs y pozos se identifican por su <b>código</b>. Si ya existen, se actualizan sus datos; nunca se duplican.</li>
            <li>No se eliminan PADs ni pozos, y no se modifican pedidos, entregas, consumos, etapas ni inventario.</li>
            <li>Antes de guardar se muestra una validación con el resultado de cada fila.</li>
          </ul>
        </div>
      )}

      {step === 1 && (
        <Field label="Hoja que contiene los datos" htmlFor="imp-sheet" hint={`${file?.name} tiene ${sheets.length} hojas.`}>
          <Select id="imp-sheet" value={sheet} onChange={(e) => setSheet(e.target.value)}>{sheets.map((s) => <option key={s}>{s}</option>)}</Select>
        </Field>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-[220px_1fr] sm:items-end">
            <Field label="Fila de encabezados" htmlFor="imp-head" hint="Detectada automáticamente.">
              <Select id="imp-head" value={headerIdx} onChange={(e) => { const h = Number(e.target.value); setHeaderIdx(h); setMap(autoMap((raw[h] ?? []).map(cellText))); }}>
                {raw.slice(0, 10).map((r, i) => <option key={i} value={i}>Fila {i + 1}: {r.map(cellText).filter(Boolean).slice(0, 3).join(' · ').slice(0, 40)}</option>)}
              </Select>
            </Field>
            <p className="pb-2 text-sm text-slate-600">{file?.name} · hoja “{sheet}” · <span className="font-semibold text-navy-900">{integer(data.length)} filas de datos</span></p>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[620px] text-[13.5px]">
              <thead><tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-4 py-2.5">Campo del sistema</th><th className="px-4 py-2.5">Columna del archivo</th><th className="px-4 py-2.5">Ejemplo</th>
              </tr></thead>
              <tbody>
                {FIELDS.map((f) => {
                  const idx = map[f.key];
                  const sample = idx === undefined ? '' : data.slice(0, 3).map((r) => r[f.key as FieldKey]).filter(Boolean).join(' · ');
                  return (
                    <tr key={f.key} className="border-t border-slate-100 align-top">
                      <td className="px-4 py-2.5"><p className="font-semibold text-navy-900">{f.label}{f.required && <span className="text-brand-600"> *</span>}</p><p className="text-xs text-slate-500">{f.hint}</p></td>
                      <td className="px-4 py-2.5">
                        <Select aria-label={`Columna para ${f.label}`} className="min-h-[38px] py-1.5 text-sm" value={idx ?? ''}
                          onChange={(e) => setMap((m) => { const n = { ...m }; if (e.target.value === '') delete n[f.key]; else n[f.key] = Number(e.target.value); return n; })}>
                          <option value="">— No importar —</option>
                          {headers.map((h, i) => <option key={i} value={i}>{h || `Columna ${i + 1}`}</option>)}
                        </Select>
                      </td>
                      <td className="max-w-[220px] truncate px-4 py-2.5 font-mono text-[12.5px] text-slate-600">{sample || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {problems.length > 0 && <Alert tone="warning" title="No se puede continuar">{problems.map((p) => <p key={p}>{p}</p>)}</Alert>}
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">Primeras 20 de {integer(data.length)} filas, tal como se enviarán. “Validar” revisa todas las filas contra el maestro sin guardar nada.</p>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead><tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2.5">Fila</th>{FIELDS.filter((f) => map[f.key] !== undefined).map((f) => <th key={f.key} className="px-3 py-2.5">{f.label}</th>)}<th className="px-3 py-2.5">Observación</th>
              </tr></thead>
              <tbody>
                {data.slice(0, 20).map((r) => {
                  const obs = !r.pad_code ? 'Falta el código del PAD' : r.planned_stages && !/^\d{1,3}$/.test(r.planned_stages) ? 'Etapas no numéricas' : '';
                  return (
                    <tr key={r.row} className="border-t border-slate-100">
                      <td className="px-3 py-2 tabular-nums text-slate-500">{r.row}</td>
                      {FIELDS.filter((f) => map[f.key] !== undefined).map((f) => <td key={f.key} className="px-3 py-2 font-mono text-[12.5px]">{r[f.key as FieldKey] || <span className="text-slate-400">—</span>}</td>)}
                      <td className="px-3 py-2 text-red-700">{obs}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(step === 4 || step === 5) && summary && (
        <div className="space-y-4">
          {step === 5 && <Alert tone="success" title="Importación realizada">Se guardaron los registros válidos en una sola operación. El resultado quedó registrado con su usuario y la fecha.</Alert>}
          {step === 4 && summary.errors > 0 && <Alert tone="warning">Las {integer(summary.errors)} filas con error no se importarán. El resto se puede importar de forma segura.</Alert>}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ['PADs nuevos', summary.pads_created], ['PADs actualizados', summary.pads_updated], ['Pozos nuevos', summary.wells_created], ['Pozos actualizados', summary.wells_updated],
              ['Sin cambios', summary.unchanged], ['Duplicados en el archivo', summary.duplicates], ['Errores', summary.errors], ['Filas procesadas', summary.rows_processed],
            ].map(([k, v]) => (
              <div key={k as string} className={`rounded-xl border px-3.5 py-3 ${k === 'Errores' && Number(v) > 0 ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-slate-50'}`}>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{k}</p>
                <p className="mt-1 font-display text-xl font-extrabold tabular-nums text-navy-950">{integer(v as number)}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(['todas', 'error', 'duplicado', 'nuevo', 'actualiza', 'sin_cambios'] as const).map((k) => (
              <button key={k} onClick={() => setFilter(k)}
                className={`rounded-full px-3 py-1 text-[12.5px] font-semibold transition ${filter === k ? 'bg-navy-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {k === 'todas' ? 'Todas' : RESULT_LABEL[k]} ({k === 'todas' ? (preview ?? result)!.rows.length : (preview ?? result)!.rows.filter((r) => r.status === k).length})
              </button>
            ))}
          </div>
          <div className="max-h-[32vh] overflow-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[560px] text-[13px]">
              <thead className="sticky top-0"><tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2.5">Fila</th><th className="px-3 py-2.5">PAD</th><th className="px-3 py-2.5">Pozo</th><th className="px-3 py-2.5">Resultado</th><th className="px-3 py-2.5">Detalle</th>
              </tr></thead>
              <tbody>
                {shown.slice(0, 500).map((r) => (
                  <tr key={r.row} className="border-t border-slate-100">
                    <td className="px-3 py-2 tabular-nums text-slate-500">{r.row}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-[12.5px]">{r.pad_code || '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-[12.5px]">{r.well_code || '—'}</td>
                    <td className="px-3 py-2"><Badge tone={TONE[r.status]}>{RESULT_LABEL[r.status]}</Badge></td>
                    <td className="px-3 py-2 text-slate-600">{r.message || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length > 500 && <p className="px-3 py-2 text-xs text-slate-500">Se muestran 500 de {integer(shown.length)} filas. El reporte descargable incluye todas.</p>}
          </div>
          {step === 5 && <p className="flex items-center gap-2 text-sm text-brand-700"><CheckCircle2 className="h-4 w-4" /> Puede volver a importar el mismo archivo: los registros existentes no se duplican.</p>}
        </div>
      )}
      {loading && step !== 0 && <Spinner label="Leyendo archivo…" />}
    </Modal>
  );
}
