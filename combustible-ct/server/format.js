'use strict';
// Formatos de presentación: fechas DD/MM/AAAA y litros con separador de miles (es-AR).
const TZ = process.env.APP_TZ || 'America/Argentina/Buenos_Aires';

const nf = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const liters = (n) => `${nf.format(Number(n) || 0)} L`;

// 'AAAA-MM-DD' -> 'DD/MM/AAAA'
function date(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

// Instante ISO -> 'DD/MM/AAAA HH:MM' en la zona horaria operativa.
function dateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('es-AR', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

// Fecha calendario actual (AAAA-MM-DD) en la zona horaria operativa.
function today() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

module.exports = { TZ, liters, date, dateTime, today };
