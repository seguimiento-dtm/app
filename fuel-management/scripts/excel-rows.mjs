// Convierte el Excel maestro a las filas JSON que recibe import_master (usado por las pruebas de base de datos).
// Uso: node scripts/excel-rows.mjs datos/WP_por_Pozos.xlsx > filas.json
import readXlsxFile from 'read-excel-file/node';

const rows = await readXlsxFile(process.argv[2]);
const head = rows[0].map((h) => String(h ?? '').toLowerCase());
const ip = head.findIndex((h) => h.includes('pad'));
const iw = head.findIndex((h, i) => i !== ip && (h.includes('pozo') || h.includes('well')));
const text = (v) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim());
const out = rows.slice(1).map((r, i) => ({ row: i + 2, pad_code: text(r[ip]), well_code: text(r[iw]) }))
  .filter((r) => r.pad_code || r.well_code);
process.stdout.write(JSON.stringify(out));
