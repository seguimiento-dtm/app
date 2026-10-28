// El contenido del correo se arma con el mismo código que usa la función de servidor (fuente única).
import { orderMailSubject, orderMailText, type OrderMailData } from '../../supabase/functions/_shared/orderMail.ts';

export function orderEmail(o: OrderMailData) {
  return { subject: orderMailSubject(o), body: orderMailText(o) };
}

export function mailtoLink(to: string, subject: string, body: string) {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body).replace(/%0A/g, '%0D%0A')}`;
}
