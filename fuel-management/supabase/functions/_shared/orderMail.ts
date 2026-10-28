// Contenido del correo de solicitud de combustible. Fuente única para la vista previa (navegador)
// y para el envío (función de servidor). Sin dependencias: corre en Deno, Node y el navegador.

export interface OrderMailData {
  order_number: string;
  pad_code: string;
  trips: number;
  trip_capacity_liters: number;
  requested_liters: number;
  required_date: string;
  notes: string;
  requested_by_name: string | null;
}

const nf = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
export const mailLiters = (n: number | string) => `${nf.format(Number(n))} L`;
export const mailDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function orderMailSubject(o: OrderMailData): string {
  return `[PEDIDO DE COMBUSTIBLE] ${o.order_number} – ${o.pad_code} – ${mailDate(o.required_date)}`;
}

function rows(o: OrderMailData): [string, string][] {
  return [
    ['Pedido', o.order_number],
    ['PAD / Locación', o.pad_code],
    ['Cantidad de viajes', `${o.trips} (${mailLiters(o.trip_capacity_liters)} por viaje)`],
    ['Volumen solicitado', mailLiters(o.requested_liters)],
    ['Fecha requerida de entrega', mailDate(o.required_date)],
    ['Observaciones', o.notes?.trim() || 'Sin observaciones'],
  ];
}

export function orderMailText(o: OrderMailData): string {
  return [
    'Buenos días:', '', 'Solicitamos combustible para el Set de Fractura según el siguiente detalle:', '',
    ...rows(o).map(([k, v]) => `${k}: ${v}`), '',
    'Por favor, confirmar recepción y programación de la entrega.', '', 'Saludos,', o.requested_by_name || '',
  ].join('\n');
}

export function orderMailHtml(o: OrderMailData, senderName?: string): string {
  const tr = rows(o).map(([k, v], i) => `<tr style="background:${i % 2 ? '#F6F8FA' : '#FFFFFF'}">
      <td style="padding:8px 12px;border-bottom:1px solid #E2E8F0;color:#475569;width:40%">${esc(k)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #E2E8F0;color:#0C1D33;font-weight:600">${esc(v)}</td></tr>`).join('');
  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#0C1D33;max-width:620px">
  <p>Buenos días:</p>
  <p>Solicitamos combustible para el Set de Fractura según el siguiente detalle:</p>
  <table cellpadding="0" cellspacing="0" style="border:1px solid #E2E8F0;border-collapse:collapse;width:100%">${tr}</table>
  <p>Por favor, confirmar recepción y programación de la entrega.</p>
  <p>Saludos,<br>${esc(senderName || o.requested_by_name || '')}</p>
  <p style="color:#64748B;font-size:12px">Enviado desde Fuel Management | Frac Operations.</p></div>`;
}
