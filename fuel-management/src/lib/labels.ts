import type { MovementType, OrderStatus, StageStatus } from './types';

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  borrador: 'Borrador', solicitado: 'Solicitado', enviado: 'Enviado', entregado_parcial: 'Entregado parcial', entregado: 'Entregado', cancelado: 'Cancelado',
};
export const ORDER_STATUS_TONE: Record<OrderStatus, 'gray' | 'navy' | 'amber' | 'green' | 'red'> = {
  borrador: 'gray', solicitado: 'navy', enviado: 'navy', entregado_parcial: 'amber', entregado: 'green', cancelado: 'red',
};
export const STAGE_STATUS_LABEL: Record<StageStatus, string> = { planificada: 'Planificada', realizada: 'Realizada', cancelada: 'Cancelada' };
export const STAGE_STATUS_TONE: Record<StageStatus, 'gray' | 'green' | 'red'> = { planificada: 'gray', realizada: 'green', cancelada: 'red' };

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  stock_inicial: 'Stock inicial', ajuste_ingreso: 'Ajuste (ingreso)', ajuste_egreso: 'Ajuste (egreso)', salida: 'Salida',
  transferencia: 'Transferencia entre PADs', verificacion_fisica: 'Verificación física',
};
export const MOVEMENT_HELP: Record<MovementType, string> = {
  stock_inicial: 'Existencia de arranque del PAD. Se registra una sola vez por PAD.',
  ajuste_ingreso: 'Corrección que suma litros (requiere motivo).',
  ajuste_egreso: 'Corrección que resta litros (requiere motivo).',
  salida: 'Combustible que sale del PAD sin consumirse en etapas: devolución, otro equipo (requiere motivo).',
  transferencia: 'Traslado de combustible a otro PAD, por ejemplo cuando se mueve el set (requiere motivo).',
  verificacion_fisica: 'Medición real en tanques. No cambia el stock estimado: se compara con él.',
};
export const LEDGER_SOURCE_LABEL: Record<string, string> = {
  stock_inicial: 'Stock inicial', ajuste_ingreso: 'Ajuste (ingreso)', ajuste_egreso: 'Ajuste (egreso)', salida: 'Salida',
  transferencia_salida: 'Transferencia enviada', transferencia_ingreso: 'Transferencia recibida', entrega: 'Entrega', consumo: 'Consumo de etapa',
};

export const NOTIFICATION_LABEL: Record<'no_enviado' | 'pendiente' | 'aceptado' | 'error', string> = {
  no_enviado: 'Correo sin enviar', pendiente: 'Envío en curso', aceptado: 'Aceptado por Microsoft 365', error: 'Error de envío',
};
export const NOTIFICATION_TONE: Record<'no_enviado' | 'pendiente' | 'aceptado' | 'error', 'gray' | 'amber' | 'green' | 'red'> = {
  no_enviado: 'gray', pendiente: 'amber', aceptado: 'green', error: 'red',
};
