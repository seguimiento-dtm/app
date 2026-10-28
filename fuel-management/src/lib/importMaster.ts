// Importador del maestro de PADs y pozos: lectura, mapeo de columnas y validaciones de estructura.
// La validación definitiva la hace la base de datos (import_master), que recibe las filas como datos.

export type FieldKey = 'pad_code' | 'pad_name' | 'well_code' | 'well_name' | 'planned_stages' | 'operational_status';

export const FIELDS: { key: FieldKey; label: string; required?: boolean; hint: string; synonyms: RegExp }[] = [
  { key: 'pad_code', label: 'Código del PAD', required: true, hint: 'Identificador estable del PAD (ej.: LA-WP130).',
    synonyms: /(c[oó]d(igo)?[\s._-]*(del?[\s._-]*)?(well[\s._-]*)?pad|pad[\s._-]*(c[oó]d|id)|oper\.?[\s._-]*well[\s._-]*pad|^well[\s._-]*pad$|^pad$|^id[\s._-]*pad$|locaci[oó]n)/i },
  { key: 'pad_name', label: 'Nombre del PAD', hint: 'Si no se informa, se conserva el nombre actual (o el código, si es nuevo).',
    synonyms: /(nombre[\s._-]*(del?[\s._-]*)?pad|pad[\s._-]*name|descripci[oó]n[\s._-]*pad)/i },
  { key: 'well_code', label: 'Código del pozo', hint: 'Identificador estable del pozo (ej.: LA-750(h)).',
    synonyms: /(c[oó]d(igo)?[\s._-]*(del?[\s._-]*)?pozo|pozo[\s._-]*(c[oó]d|id)|^pozo$|^well$|well[\s._-]*(code|id)|^id[\s._-]*pozo$)/i },
  { key: 'well_name', label: 'Nombre del pozo', hint: 'Si no se informa, se conserva el nombre actual (o el código, si es nuevo).',
    synonyms: /(nombre[\s._-]*(del?[\s._-]*)?pozo|well[\s._-]*name)/i },
  { key: 'planned_stages', label: 'Etapas planificadas', hint: 'Número entero entre 0 y 200.', synonyms: /(etapas|stages|fracturas)/i },
  { key: 'operational_status', label: 'Estado operativo', hint: 'Texto libre (ej.: En completación).', synonyms: /(estado|status)/i },
];

export const MAX_ROWS = 5000;
export type Cell = string | number | boolean | Date | null | undefined;
export type Mapping = Partial<Record<FieldKey, number>>;
export interface ImportRow { row: number; pad_code: string; pad_name: string; well_code: string; well_name: string; planned_stages: string; operational_status: string }

export function cellText(v: Cell): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  return String(v).replace(/\s+/g, ' ').trim();
}

/** Primera fila (de las 10 primeras) con al menos dos celdas de texto: se toma como encabezado. */
export function detectHeaderRow(rows: Cell[][]): number {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const texts = rows[i].map(cellText).filter((t) => t && Number.isNaN(Number(t)));
    if (texts.length >= 2) return i;
  }
  return 0;
}

/** Propone el mapeo por nombre de columna. Cada columna se usa una sola vez; el código del PAD tiene prioridad. */
export function autoMap(headers: string[]): Mapping {
  const used = new Set<number>();
  const m: Mapping = {};
  for (const f of FIELDS) {
    const idx = headers.findIndex((h, i) => !used.has(i) && h && f.synonyms.test(h));
    if (idx >= 0) { m[f.key] = idx; used.add(idx); }
  }
  // "Pozo" a secas suele ser el código del pozo; si quedó como nombre y no hay código, se reubica.
  if (m.well_code === undefined && m.well_name !== undefined) { m.well_code = m.well_name; delete m.well_name; }
  return m;
}

export function buildRows(rows: Cell[][], headerIdx: number, map: Mapping): ImportRow[] {
  const get = (r: Cell[], k: FieldKey) => (map[k] === undefined ? '' : cellText(r[map[k]!]));
  const out: ImportRow[] = [];
  rows.slice(headerIdx + 1).forEach((r, i) => {
    if (!r.some((c) => cellText(c) !== '')) return;
    out.push({
      row: headerIdx + i + 2, // número de fila tal como se ve en Excel
      pad_code: get(r, 'pad_code'), pad_name: get(r, 'pad_name'), well_code: get(r, 'well_code'),
      well_name: get(r, 'well_name'), planned_stages: get(r, 'planned_stages'), operational_status: get(r, 'operational_status'),
    });
  });
  return out;
}

/** Problemas que impiden interpretar el archivo de forma segura: si hay alguno, no se importa nada. */
export function structuralProblems(map: Mapping, data: ImportRow[]): string[] {
  const p: string[] = [];
  if (map.pad_code === undefined) p.push('Indique qué columna contiene el código del PAD.');
  const cols = Object.values(map).filter((v) => v !== undefined);
  if (new Set(cols).size !== cols.length) p.push('Una misma columna está asignada a más de un campo.');
  if (data.length === 0) p.push('No hay filas de datos debajo del encabezado.');
  if (data.length > MAX_ROWS) p.push(`El archivo tiene ${data.length} filas; el máximo por importación es ${MAX_ROWS}.`);
  if (map.pad_code !== undefined && data.length > 0) {
    const empty = data.filter((r) => !r.pad_code).length;
    if (empty / data.length > 0.5) p.push(`La columna elegida como código del PAD está vacía en ${empty} de ${data.length} filas. Revise el mapeo o la fila de encabezados.`);
  }
  if (map.well_code !== undefined && map.pad_code !== undefined && data.length > 0) {
    const same = data.filter((r) => r.well_code && r.well_code === r.pad_code).length;
    if (same / data.length > 0.8) p.push('Las columnas de PAD y de pozo parecen tener el mismo contenido. Revise el mapeo.');
  }
  return p;
}

/** Lector de CSV (separador “;” o “,”, comillas dobles). */
export function parseCsv(text: string): Cell[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: Cell[][] = [];
  let row: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"' && src[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

export interface ImportResultRow { row: number; pad_code: string | null; well_code: string | null; status: 'nuevo' | 'actualiza' | 'sin_cambios' | 'duplicado' | 'error'; message: string | null }
export interface ImportSummary { rows_processed: number; pads_created: number; pads_updated: number; wells_created: number; wells_updated: number; unchanged: number; duplicates: number; errors: number }
export interface ImportResult { dry_run: boolean; log_id: string | null; summary: ImportSummary; rows: ImportResultRow[] }

export const RESULT_LABEL: Record<ImportResultRow['status'], string> = {
  nuevo: 'Alta', actualiza: 'Actualización', sin_cambios: 'Sin cambios', duplicado: 'Duplicado', error: 'Error',
};
