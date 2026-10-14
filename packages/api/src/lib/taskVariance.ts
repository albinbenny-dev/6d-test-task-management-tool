import { prisma } from './prisma.js';
import { addDays, workingDaysBetween } from './timelineDates.js';
import { toDateOnly, todayDateOnly } from './taskActuals.js';

// Schedule variance ("delay") of a task, in WORKING days (Mon–Fri), with no grace period:
//  · Done task   → actual end vs planned end: + = finished late, − = finished early, 0 = on the day.
//  · Open task   → how long it has been past its planned end (planned end before today); null while it is still on schedule.
//  · A task with no planned end has no variance (null).
//  · A parent task takes the WORST (largest) delay among its subtasks; with none to go on, its own.
// "Delayed" therefore means delayDays > 0.

/** Working days in (from, to] — 0 when `to` is not after `from`. */
export function workingDaysAfter(from: Date, to: Date): number {
  return to.getTime() > from.getTime() ? workingDaysBetween(addDays(from, 1), to) : 0;
}

export interface VarianceInput {
  id: string;
  parentTaskId?: string | null;
  status: string;
  dueDate: Date | null;
  actualEndDate: Date | null;
}

export function ownDelay(
  t: Pick<VarianceInput, 'status' | 'dueDate'> & { actualEndDate?: Date | null },
  today: Date = todayDateOnly(),
): number | null {
  const planned = toDateOnly(t.dueDate);
  if (!planned) return null;
  if (t.status === 'DONE') {
    const actual = toDateOnly(t.actualEndDate);
    if (!actual) return null;
    if (actual.getTime() > planned.getTime()) return workingDaysAfter(planned, actual);
    if (actual.getTime() < planned.getTime()) return -workingDaysAfter(actual, planned);
    return 0;
  }
  return today.getTime() > planned.getTime() ? workingDaysAfter(planned, today) : null;
}

/** Delay for every task id (parents roll up from their children, which must be in `tasks`). */
export function delayByTask(tasks: VarianceInput[], today: Date = todayDateOnly()): Map<string, number | null> {
  const kids = new Map<string, VarianceInput[]>();
  for (const t of tasks) if (t.parentTaskId) kids.set(t.parentTaskId, [...(kids.get(t.parentTaskId) ?? []), t]);
  const out = new Map<string, number | null>();
  for (const t of tasks) {
    const own = ownDelay(t, today);
    const sub = (kids.get(t.id) ?? []).map((c) => ownDelay(c, today)).filter((d): d is number => d !== null);
    out.set(t.id, sub.length > 0 ? Math.max(...sub) : own);
  }
  return out;
}

/** Adds `delayDays` to task rows (loads the subtasks of any parent whose children are not already in `rows`). */
export async function attachDelayDays<T extends VarianceInput & { _count?: { subtasks: number } }>(rows: T[]): Promise<(T & { delayDays: number | null })[]> {
  const today = todayDateOnly();
  const have = new Set(rows.map((r) => r.id));
  const parentIds = rows.filter((r) => (r._count?.subtasks ?? 0) > 0).map((r) => r.id);
  const missingKids = parentIds.length
    ? await prisma.task.findMany({
      where: { parentTaskId: { in: parentIds }, id: { notIn: [...have] } },
      select: { id: true, parentTaskId: true, status: true, dueDate: true, actualEndDate: true },
    })
    : [];
  const map = delayByTask([...rows, ...missingKids], today);
  return rows.map((r) => ({ ...r, delayDays: map.get(r.id) ?? null }));
}
