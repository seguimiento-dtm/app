'use strict';
// Importación del listado de Well PAD y pozos desde Excel (.xlsx) o CSV.
// Formato esperado: una columna con el Well PAD (encabezado que contenga "pad")
// y otra con el pozo (encabezado que contenga "pozo" o "well"). Las filas repetidas se unifican.
const ExcelJS = require('exceljs');
const dbm = require('./db');

const norm = (v) => {
  if (v == null) return '';
  if (typeof v === 'object') v = v.text ?? v.result ?? (v.richText ? v.richText.map((t) => t.text).join('') : '');
  return String(v).replace(/\s+/g, ' ').trim();
};

function findColumns(header) {
  const h = header.map((x) => norm(x).toLowerCase());
  const pad = h.findIndex((x) => x.includes('pad'));
  const well = h.findIndex((x, i) => i !== pad && (x.includes('pozo') || x.includes('well')));
  return { pad, well };
}

async function readRows(buffer, filename = '') {
  if (/\.csv$/i.test(filename)) {
    const text = buffer.toString('utf8').replace(/^﻿/, '');
    const sep = (text.split('\n')[0].match(/;/g) || []).length >= 1 ? ';' : ',';
    return text.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '')));
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  for (const ws of wb.worksheets) {
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row) => { rows.push(row.values.slice(1)); });
    if (rows.length && findColumns(rows[0]).pad >= 0) return rows;
  }
  throw new Error('No se encontró una hoja con columnas de Well PAD y Pozo.');
}

async function parse(buffer, filename) {
  const rows = await readRows(buffer, filename);
  const { pad, well } = findColumns(rows[0] || []);
  if (pad < 0 || well < 0) throw new Error('El archivo debe tener encabezados de Well PAD (ej.: "Oper.Well Pad") y de Pozo.');
  const pads = new Map(); const skipped = []; const wellOwner = new Map(); const conflicts = [];
  rows.slice(1).forEach((r, i) => {
    const p = norm(r[pad]); const w = norm(r[well]);
    if (!p && !w) return;
    if (!p) { skipped.push({ row: i + 2, value: w, reason: 'sin Well PAD' }); return; }
    if (p.length > 80) { skipped.push({ row: i + 2, value: p, reason: 'código de PAD demasiado largo' }); return; }
    if (!pads.has(p)) pads.set(p, []);
    if (!w) return;
    const owner = wellOwner.get(w.toLowerCase());
    if (owner && owner !== p) { conflicts.push({ row: i + 2, well: w, pads: [owner, p] }); return; }
    wellOwner.set(w.toLowerCase(), p);
    if (!pads.get(p).some((x) => x.toLowerCase() === w.toLowerCase())) pads.get(p).push(w);
  });
  return { pads, skipped, conflicts, rows: rows.length - 1 };
}

// Crea los PAD nuevos y reemplaza la lista de pozos de los existentes por la del archivo.
// Los PAD que no figuran en el archivo no se modifican. Los pedidos históricos no cambian.
function apply(db, parsed, user, { dryRun = false, filename = '' } = {}) {
  const summary = { created: [], updated: [], unchanged: 0, reactivated: [], notInFile: 0, wells: 0 };
  const run = () => {
    const activeBefore = db.prepare('SELECT id FROM pads WHERE active = 1').all().map((r) => r.id);
    const seen = new Set();
    for (const [code, wells] of parsed.pads) {
      summary.wells += wells.length;
      const list = wells.join(', ');
      const prev = db.prepare('SELECT * FROM pads WHERE code = ?').get(code);
      if (!prev) {
        summary.created.push(code);
        if (!dryRun) db.prepare('INSERT INTO pads (code, wells, area, active) VALUES (?,?,?,1)').run(code, list, '');
        continue;
      }
      seen.add(prev.id);
      const before = dbm.splitWells(prev.wells).join(', ');
      if (!prev.active) summary.reactivated.push(prev.code);
      if (before === list && prev.active) { summary.unchanged += 1; continue; }
      if (before !== list) summary.updated.push(prev.code);
      if (!dryRun) {
        db.prepare("UPDATE pads SET wells = ?, active = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(list, prev.id);
      }
    }
    summary.notInFile = activeBefore.filter((id) => !seen.has(id)).length;
    if (!dryRun) {
      dbm.audit(db, user, 'importacion_pads', 'pad', null, {
        archivo: filename, creados: summary.created.length, actualizados: summary.updated.length, reactivados: summary.reactivated.length,
        pozos: summary.wells, omitidas: parsed.skipped.length, conflictos: parsed.conflicts.length,
      });
    }
  };
  if (dryRun) run(); else dbm.tx(db, run);
  return summary;
}

module.exports = { parse, apply };
