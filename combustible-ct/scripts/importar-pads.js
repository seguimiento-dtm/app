'use strict';
// Importa el listado de Well PAD y pozos desde Excel/CSV a la base de datos.
// Uso: npm run importar-pads -- datos/WP_por_Pozos.xlsx        (vista previa)
//      npm run importar-pads -- datos/WP_por_Pozos.xlsx --aplicar
const fs = require('node:fs');
const path = require('node:path');
try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch { /* opcional */ }
const dbm = require('../server/db');
const padImport = require('../server/pad-import');

(async () => {
  const file = process.argv[2];
  const apply = process.argv.includes('--aplicar');
  if (!file) { console.error('Indique el archivo: npm run importar-pads -- <archivo.xlsx> [--aplicar]'); process.exit(1); }
  const parsed = await padImport.parse(fs.readFileSync(file), path.basename(file));
  const db = dbm.open(process.env.DB_FILE || path.join(__dirname, '..', 'data', 'combustible-ct.db'));
  const s = padImport.apply(db, parsed, null, { dryRun: !apply, filename: path.basename(file) });
  console.log(`${parsed.pads.size} Well PAD y ${s.wells} pozos en ${parsed.rows} filas.`);
  console.log(`Nuevos: ${s.created.length} · Pozos actualizados: ${s.updated.length} · Sin cambios: ${s.unchanged} · Reactivados: ${s.reactivated.length} · Activos fuera del archivo: ${s.notInFile}`);
  if (parsed.skipped.length) console.log(`Filas omitidas (sin Well PAD): ${parsed.skipped.length} → ${[...new Set(parsed.skipped.map((x) => x.value))].join(', ')}`);
  if (parsed.conflicts.length) console.log(`Pozos en más de un PAD: ${parsed.conflicts.map((c) => `${c.well} (${c.pads.join('/')})`).join(', ')}`);
  console.log(apply ? 'Importación aplicada.' : 'Vista previa: no se modificó la base. Agregue --aplicar para importar.');
})().catch((e) => { console.error(e.message); process.exit(1); });
