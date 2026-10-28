import type { AppRole } from './types';

export const ROLE_LABEL: Record<AppRole, string> = {
  administrador: 'Administrador',
  operaciones: 'Operaciones',
  logistica: 'Logística',
  supervision: 'Supervisión / Gerencia',
};

export const ROLE_DESCRIPTION: Record<AppRole, string> = {
  administrador: 'Configuración general, maestro de PADs y pozos, y usuarios.',
  operaciones: 'Registro de etapas y consumos.',
  logistica: 'Pedidos, entregas y movimientos de stock.',
  supervision: 'Consulta de indicadores e informes.',
};

export const ROLES: AppRole[] = ['administrador', 'operaciones', 'logistica', 'supervision'];

/**
 * Qué puede hacer cada rol en la interfaz. Es solo para no mostrar acciones inútiles:
 * los permisos reales los aplica la base de datos (seguridad por fila).
 */
export const can = {
  manageCatalog: (r: AppRole | null) => r === 'administrador',
  manageUsers: (r: AppRole | null) => r === 'administrador',
  recordStages: (r: AppRole | null) => r === 'administrador' || r === 'operaciones',
  manageOrders: (r: AppRole | null) => r === 'administrador' || r === 'logistica',
  viewAudit: (r: AppRole | null) => r === 'administrador' || r === 'supervision',
};
