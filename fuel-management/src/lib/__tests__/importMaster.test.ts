import { describe, expect, it } from 'vitest';
import readXlsxFile from 'read-excel-file/node';
import { autoMap, buildRows, detectHeaderRow, parseCsv, structuralProblems, type Cell } from '../importMaster';

describe('importador del maestro', () => {
  it('lee el Excel real y mapea “Oper.Well Pad” y “Pozo” automáticamente', async () => {
    const rows = (await readXlsxFile('datos/WP_por_Pozos.xlsx')) as Cell[][];
    const h = detectHeaderRow(rows);
    expect(h).toBe(0);
    const map = autoMap(rows[h].map(String));
    expect(map).toEqual({ pad_code: 0, well_code: 1 });
    const data = buildRows(rows, h, map);
    expect(data).toHaveLength(1273);
    expect(data[0]).toMatchObject({ row: 2, pad_code: 'LA-WP130', well_code: 'LA-750(h)' });
    expect(structuralProblems(map, data)).toEqual([]);
  });

  it('acepta encabezados con otros nombres y columnas opcionales', () => {
    const rows = parseCsv('Código PAD;Nombre del PAD;Código de pozo;Nombre del pozo;Etapas;Estado\nLA-WP130;Locación 130;LA-750(h);LA 750;20;En completación\n');
    const map = autoMap(rows[0].map(String));
    expect(map).toEqual({ pad_code: 0, pad_name: 1, well_code: 2, well_name: 3, planned_stages: 4, operational_status: 5 });
    expect(buildRows(rows, 0, map)[0]).toEqual({
      row: 2, pad_code: 'LA-WP130', pad_name: 'Locación 130', well_code: 'LA-750(h)', well_name: 'LA 750', planned_stages: '20', operational_status: 'En completación',
    });
  });

  it('detiene la importación si la estructura no es segura', () => {
    const rows = parseCsv('A,B\n,x\n,y\n1,z\n');
    expect(structuralProblems({}, buildRows(rows, 0, {}))[0]).toMatch(/código del PAD/);
    expect(structuralProblems({ pad_code: 0 }, buildRows(rows, 0, { pad_code: 0 })).join(' ')).toMatch(/vacía en 2 de 3/);
    expect(structuralProblems({ pad_code: 0, well_code: 0 }, buildRows(rows, 0, { pad_code: 0 })).join(' ')).toMatch(/misma columna/);
    expect(structuralProblems({ pad_code: 0 }, [])).toContain('No hay filas de datos debajo del encabezado.');
  });

  it('CSV con comillas y separador coma', () => {
    expect(parseCsv('pad,pozo\n"PAD, 1","P ""A"""\n')).toEqual([['pad', 'pozo'], ['PAD, 1', 'P "A"']]);
  });
});
