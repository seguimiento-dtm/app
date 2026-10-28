import { date, liters } from './format';
import type { Order } from './types';

/** Borrador del correo de solicitud (el envío automático por Outlook llega en la Fase 4). */
export function orderEmail(o: Pick<Order, 'order_number' | 'pad_code' | 'trips' | 'trip_capacity_liters' | 'requested_liters' | 'required_date' | 'notes' | 'requested_by_name'>) {
  const subject = `[PEDIDO DE COMBUSTIBLE] ${o.order_number} – ${o.pad_code} – ${date(o.required_date)}`;
  const body = [
    'Buenos días:',
    '',
    `Solicitamos combustible para el Set de Fractura según el siguiente detalle:`,
    '',
    `Pedido: ${o.order_number}`,
    `PAD / Locación: ${o.pad_code}`,
    `Cantidad de viajes: ${o.trips} (${liters(o.trip_capacity_liters)} por viaje)`,
    `Volumen solicitado: ${liters(o.requested_liters)}`,
    `Fecha requerida de entrega: ${date(o.required_date)}`,
    `Observaciones: ${o.notes?.trim() || 'Sin observaciones'}`,
    '',
    'Por favor, confirmar recepción y programación de la entrega.',
    '',
    'Saludos,',
    o.requested_by_name || '',
  ].join('\n');
  return { subject, body };
}

export function mailtoLink(to: string, subject: string, body: string) {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body).replace(/%0A/g, '%0D%0A')}`;
}
