import { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { reminderTimeZone } from '../services/taskNotificationService.js';

// Actual start / end dates for tasks.
//  · Start is stamped when work begins (To Do → In Progress / In Review / Done), end when the task is marked Done.
//  · Both can be backdated by the caller. Moving a task back to To Do clears both; reopening a Done task clears the end.
//  · A parent task's actuals are derived from its subtasks (see rollupParentActuals) and can't be edited directly.
// Dates are date-only, stored at UTC midnight (same convention as startDate / dueDate).

type Status = 'TO_DO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE';

/** Today's calendar date in the reminder time zone (Asia/Kolkata by default), as UTC midnight. */
export function todayDateOnly(now: Date = new Date()): Date {
  const key = new Intl.DateTimeFormat('en-CA', { timeZone: reminderTimeZone() }).format(now); // YYYY-MM-DD
  return new Date(`${key}T00:00:00.000Z`);
}

/** Accepts "YYYY-MM-DD" or a full ISO datetime and returns that calendar day at UTC midnight (null if unparseable). */
export function toDateOnly(v: string | Date | null | undefined): Date | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return isNaN(d.getTime()) ? null : d;
}

/** Actual dates describe what already happened, so a day after today (in the reminder time zone) is never valid. */
export const isFutureDay = (d: Date | null | undefined): boolean => !!d && d.getTime() > todayDateOnly().getTime();

/** Earlier of the given day and today — used by import, where a forecast date in an "actual" column is pulled back to today. */
export function capAtToday(d: Date | null | undefined): Date | null {
  if (!d) return null;
  const t = todayDateOnly();
  return d.getTime() > t.getTime() ? t : d;
}

export interface ActualsState {
  status: string;
  actualStartDate: Date | null;
  actualEndDate: Date | null;
}

export interface ActualsPatch {
  actualStartDate?: Date | null;
  actualEndDate?: Date | null;
}

/**
 * Actuals that follow a status change.
 * `endOn` / `startOn` are caller-chosen dates (the "completed on" prompt, or an import's own values); without them today is used.
 */
export function actualsForStatusChange(
  prev: ActualsState,
  next: Status,
  opts: { startOn?: Date | null; endOn?: Date | null; today?: Date } = {},
): ActualsPatch {
  const today = opts.today ?? todayDateOnly();
  if (next === 'TO_DO') return { actualStartDate: null, actualEndDate: null };

  const start = opts.startOn ?? prev.actualStartDate ?? null;
  if (next === 'IN_PROGRESS' || next === 'IN_REVIEW') {
    return { actualStartDate: start ?? today, actualEndDate: null };
  }

  // DONE — keep the existing end when it was already Done (a no-op re-save), otherwise the chosen day / today.
  const end = opts.endOn ?? (prev.status === 'DONE' ? prev.actualEndDate : null) ?? today;
  let begin = start ?? end;
  if (begin > end) begin = end; // never let the start run past the end
  return { actualStartDate: begin, actualEndDate: end };
}

type Db = Prisma.TransactionClient | typeof prisma;

/** Recomputes a parent's actuals from its subtasks (no-op if it has none). Returns true when it changed. */
export async function rollupParentActuals(parentId: string | null | undefined, db: Db = prisma): Promise<boolean> {
  if (!parentId) return false;
  const [parent, kids] = await Promise.all([
    db.task.findUnique({ where: { id: parentId }, select: { id: true, actualStartDate: true, actualEndDate: true } }),
    db.task.findMany({ where: { parentTaskId: parentId }, select: { status: true, actualStartDate: true, actualEndDate: true } }),
  ]);
  if (!parent || kids.length === 0) return false;

  const starts = kids.map((k) => k.actualStartDate).filter((d): d is Date => !!d);
  const actualStartDate = starts.length ? new Date(Math.min(...starts.map((d) => d.getTime()))) : null;
  const allDone = kids.every((k) => k.status === 'DONE' && k.actualEndDate);
  const actualEndDate = allDone ? new Date(Math.max(...kids.map((k) => k.actualEndDate!.getTime()))) : null;

  const same = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);
  if (same(parent.actualStartDate, actualStartDate) && same(parent.actualEndDate, actualEndDate)) return false;
  await db.task.update({ where: { id: parentId }, data: { actualStartDate, actualEndDate } });
  return true;
}

export async function rollupParents(parentIds: Iterable<string | null | undefined>, db: Db = prisma): Promise<void> {
  for (const id of new Set([...parentIds].filter((x): x is string => !!x))) await rollupParentActuals(id, db);
}

// ── One-off backfill for tasks that predate actual dates ────────────────────
// Runs at API start-up (the app uses `prisma db push`, which never runs migration SQL). Every statement is guarded by
// "actual date is still empty", and tasks always get their actual dates stamped from now on, so it only ever touches legacy rows.
export async function backfillTaskActuals(): Promise<number> {
  let changed = 0;
  changed += await prisma.$executeRaw`UPDATE "Task" SET "actualStartDate" = date_trunc('day', "startDate")
    WHERE "status" IN ('IN_PROGRESS', 'IN_REVIEW', 'DONE') AND "startDate" IS NOT NULL AND "actualStartDate" IS NULL`;
  changed += await prisma.$executeRaw`UPDATE "Task" SET "actualEndDate" = date_trunc('day', COALESCE("dueDate", "completedAt"))
    WHERE "status" = 'DONE' AND "actualEndDate" IS NULL AND COALESCE("dueDate", "completedAt") IS NOT NULL`;
  changed += await prisma.$executeRaw`UPDATE "Task" SET "actualStartDate" = "actualEndDate"
    WHERE "status" = 'DONE' AND "actualEndDate" IS NOT NULL AND ("actualStartDate" IS NULL OR "actualStartDate" > "actualEndDate")`;
  if (changed > 0) {
    await prisma.$executeRaw`UPDATE "Task" p SET
      "actualStartDate" = (SELECT MIN(c."actualStartDate") FROM "Task" c WHERE c."parentTaskId" = p."id"),
      "actualEndDate" = CASE
        WHEN NOT EXISTS (SELECT 1 FROM "Task" c WHERE c."parentTaskId" = p."id" AND (c."status" <> 'DONE' OR c."actualEndDate" IS NULL))
        THEN (SELECT MAX(c."actualEndDate") FROM "Task" c WHERE c."parentTaskId" = p."id")
        ELSE NULL END
      WHERE EXISTS (SELECT 1 FROM "Task" c WHERE c."parentTaskId" = p."id")`;
  }
  return changed;
}
