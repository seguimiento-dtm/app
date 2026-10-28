const TZ = 'America/Argentina/Buenos_Aires';
const nf0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

/** 13425 → "13.425 L" */
export const liters = (n: number | string | null | undefined, decimals = false) =>
  n === null || n === undefined || n === '' ? '—' : `${(decimals ? nf2 : nf0).format(Number(n))} L`;

export const integer = (n: number | string | null | undefined) => (n === null || n === undefined ? '—' : nf0.format(Number(n)));

/** "2026-10-28" o instante ISO → "28/10/2026" */
export function date(value: string | null | undefined): string {
  if (!value) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('es-AR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

/** Instante ISO → "28/10/2026 14:05" */
export function dateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('es-AR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}
