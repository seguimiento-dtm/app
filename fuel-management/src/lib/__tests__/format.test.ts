import { describe, expect, it } from 'vitest';
import { date, dateTime, liters } from '../format';
import { errorMessage } from '../errors';
import { can } from '../roles';

describe('formatos', () => {
  it('litros con separador de miles', () => {
    expect(liters(13425)).toBe('13.425 L');
    expect(liters(86000)).toBe('86.000 L');
    expect(liters(null)).toBe('—');
  });
  it('fechas DD/MM/AAAA', () => {
    expect(date('2026-10-28')).toBe('28/10/2026');
    expect(dateTime('2026-10-28T17:05:00Z')).toBe('28/10/2026 14:05');
  });
});

describe('mensajes de error', () => {
  it('traduce errores de permisos y duplicados', () => {
    expect(errorMessage({ code: '42501', message: 'new row violates row-level security policy' })).toMatch(/permiso/);
    expect(errorMessage({ code: '23505', message: 'duplicate key value violates unique constraint "pads_code_unico"' })).toBe('Ya existe un PAD con ese código.');
    expect(errorMessage({ message: 'Solo se puede registrar consumo en etapas realizadas' })).toMatch(/etapas realizadas/);
  });
});

describe('permisos de interfaz', () => {
  it('coinciden con los roles de la base de datos', () => {
    expect(can.manageCatalog('administrador')).toBe(true);
    expect(can.manageCatalog('operaciones')).toBe(false);
    expect(can.recordStages('operaciones')).toBe(true);
    expect(can.manageOrders('logistica')).toBe(true);
    expect(can.manageOrders('supervision')).toBe(false);
  });
});
