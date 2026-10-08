// Calendar-date helpers for the Timeline Builder. Dates travel as
// 'YYYY-MM-DD' strings and are only turned into Date at UTC midnight when
// arithmetic is needed, so timezone never shifts a day. Duration = inclusive
// Mon–Fri working days — identical to packages/api/src/lib/timelineDates.ts.

import type { DateFormat } from './types';

export const DAY_MS = 86_400_000;

export function parseYmd(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return new Date(NaN);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function todayYmd(): string {
  const n = new Date();
  return toYmd(new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())));
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

export function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

const isWeekday = (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6;

export function workingDaysBetween(start: Date, end: Date): number {
  if (end.getTime() < start.getTime()) return 0;
  const total = diffDays(start, end) + 1;
  const weeks = Math.floor(total / 7);
  let count = weeks * 5;
  let d = addDays(start, weeks * 7);
  for (let i = 0; i < total - weeks * 7; i++) {
    if (isWeekday(d)) count++;
    d = addDays(d, 1);
  }
  return count;
}

export function endDateForDuration(start: Date, n: number): Date {
  if (n <= 1) return start;
  let d = start;
  let count = isWeekday(d) ? 1 : 0;
  while (count < n) {
    d = addDays(d, 1);
    if (isWeekday(d)) count++;
  }
  return d;
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthShort = (m: number) => MONTH_SHORT[m];

export function formatDate(ymd: string, fmt: DateFormat): string {
  const d = parseYmd(ymd);
  if (isNaN(d.getTime())) return '';
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  switch (fmt) {
    case 'dd/MM/yyyy': return `${dd}/${mm}/${yyyy}`;
    case 'MMM d': return `${MONTH_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}`;
    case 'd MMM': return `${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}`;
    default: return `${dd} ${MONTH_SHORT[d.getUTCMonth()]} ${String(yyyy).slice(2)}`;
  }
}

/** The grid's display format (matches the Office Timeline screenshots): 18/09/2026. */
export function formatGridDate(ymd: string): string {
  return formatDate(ymd, 'dd/MM/yyyy');
}

/** Accepts 18/09/2026, 18-09-26, 2026-09-18 → 'YYYY-MM-DD' or null. Day-first. */
export function parseTypedDate(input: string): string | null {
  const s = input.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  let y: number, mo: number, d: number;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else {
    m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
    if (!m) return null;
    d = +m[1]; mo = +m[2]; y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
  }
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return toYmd(dt);
}
