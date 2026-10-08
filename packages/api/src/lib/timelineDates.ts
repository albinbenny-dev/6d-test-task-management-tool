// ── Timeline Builder — date helpers ─────────────────────────────────────────
// Every timeline date is a calendar date (no time-of-day), stored as UTC
// midnight. Duration is always derived, never stored: inclusive Mon–Fri
// working days between start and end (a task on a single weekday = 1 day;
// 01 Jun–18 Sep 2026 = 80 days; milestones are always 0). The frontend keeps
// an identical copy in src/lib/timeline/dates.ts — keep the two in sync.

const DAY_MS = 86_400_000;

/** 'YYYY-MM-DD' (or any ISO string starting with it) → Date at UTC midnight. Throws on garbage. */
export function parseDateOnly(input: string | Date): Date {
  if (input instanceof Date) {
    if (isNaN(input.getTime())) throw new Error('Invalid date');
    return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(input);
  if (!m) throw new Error(`Invalid date: ${input}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (isNaN(d.getTime())) throw new Error(`Invalid date: ${input}`);
  return d;
}

export function toDateOnlyString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

function isWeekday(d: Date): boolean {
  const dow = d.getUTCDay();
  return dow !== 0 && dow !== 6;
}

/** Inclusive count of Mon–Fri days in [start, end]. 0 when end < start. */
export function workingDaysBetween(start: Date, end: Date): number {
  if (end.getTime() < start.getTime()) return 0;
  const totalDays = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
  const fullWeeks = Math.floor(totalDays / 7);
  let count = fullWeeks * 5;
  let d = addDays(start, fullWeeks * 7);
  for (let i = 0; i < totalDays - fullWeeks * 7; i++) {
    if (isWeekday(d)) count++;
    d = addDays(d, 1);
  }
  return count;
}

/** The end date that makes workingDaysBetween(start, end) === n (n ≥ 1). */
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
