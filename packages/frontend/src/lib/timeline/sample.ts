import type { TLItem, TLLane } from './types';
import { endDateForDuration, toYmd, workingDaysBetween, addDays } from './dates';

// Representative plan used to preview templates when there is no real
// timeline yet (the Super Admin template editor) and as the gallery fallback
// for an empty timeline. Dates are relative to "this month" so the sample
// never goes stale.

export function sampleTimeline(): { items: TLItem[]; lanes: TLLane[] } {
  const now = new Date();
  const m0 = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  const monday = (offsetWeeks: number) => {
    const d = addDays(m0, offsetWeeks * 7);
    return addDays(d, (8 - d.getUTCDay()) % 7);
  };
  let n = 0;
  const task = (title: string, lane: string | null, startWk: number, days: number, pct: number, marker = 'pill'): TLItem => {
    const start = monday(startWk);
    const end = endDateForDuration(start, days);
    return {
      id: `s${n++}`, swimlaneId: lane, title, type: 'TASK', marker, color: null,
      startDate: toYmd(start), endDate: toYmd(end), durationDays: workingDaysBetween(start, end),
      percentComplete: pct, assignee: null, notes: null, sortOrder: n,
    };
  };
  const ms = (title: string, lane: string | null, wk: number, marker = 'diamond'): TLItem => {
    const d = toYmd(addDays(monday(wk), 4));
    return {
      id: `s${n++}`, swimlaneId: lane, title, type: 'MILESTONE', marker, color: null,
      startDate: d, endDate: d, durationDays: 0, percentComplete: 0, assignee: null, notes: null, sortOrder: n,
    };
  };
  const lanes: TLLane[] = [
    { id: 'sl1', name: 'Initiation', color: null, collapsed: false, sortOrder: 0 },
    { id: 'sl2', name: 'Design & Build', color: null, collapsed: false, sortOrder: 1 },
    { id: 'sl3', name: 'Test & Go Live', color: null, collapsed: false, sortOrder: 2 },
  ];
  const items: TLItem[] = [
    ms('Kick-off', 'sl1', 0, 'star'),
    task('Requirements', 'sl1', 1, 15, 100),
    task('Solution design', 'sl2', 4, 20, 60),
    task('Development', 'sl2', 8, 30, 25, 'chevron'),
    ms('Design sign-off', 'sl2', 8, 'flag'),
    task('System testing', 'sl3', 15, 15, 0),
    task('UAT', 'sl3', 19, 10, 0),
    ms('Go live', 'sl3', 23, 'diamond'),
  ];
  return { items, lanes };
}
