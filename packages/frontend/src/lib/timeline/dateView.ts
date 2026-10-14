import type { TLItem } from './types';
import { parseYmd, workingDaysBetween } from './dates';

// Which dates a timeline draws: the plan (BASELINE), what really happened (ACTUAL), or both at once (BOTH).
//  · ACTUAL shows only rows that have an actual date — nothing is invented for rows that haven't started.
//  · BOTH draws the actual bar for rows that have one, with the baseline as a dashed outline behind it; rows without actuals show their plan as usual.
//  · A row that has started but not finished runs from its actual start to its planned end, or to today if that has already passed.
export type DateView = 'BASELINE' | 'ACTUAL' | 'BOTH';

export const hasActual = (i: Pick<TLItem, 'actualStartDate' | 'actualEndDate'>): boolean => !!(i.actualStartDate || i.actualEndDate);

export function applyDateView(items: TLItem[], view: DateView, today: string): TLItem[] {
  if (view === 'BASELINE') return items;
  const out: TLItem[] = [];
  for (const it of items) {
    if (!hasActual(it)) {
      if (view === 'BOTH') out.push(it);
      continue;
    }
    let start: string; let end: string;
    if (it.type === 'MILESTONE') {
      start = end = (it.actualEndDate ?? it.actualStartDate) as string;
    } else {
      start = (it.actualStartDate ?? it.actualEndDate) as string;
      end = it.actualEndDate ?? (it.endDate > today ? it.endDate : today);
      if (end < start) end = start;
    }
    out.push({
      ...it, startDate: start, endDate: end,
      durationDays: it.type === 'MILESTONE' ? 0 : workingDaysBetween(parseYmd(start), parseYmd(end)),
      ...(view === 'BOTH' ? { baseline: { startDate: it.startDate, endDate: it.endDate } } : {}),
    });
  }
  return out;
}
