import { actualsForStatusChange, capAtToday } from './taskActuals.js';

// ── Timeline rows → Tasks ───────────────────────────────────────────────────
// Pure mapping used by POST /timelines/:id/convert-to-tasks (no DB, so it can be unit-tested).
//
//  · Progress on a Task is status-only (To Do · In Progress · In Review · Done), so a row's % is folded into a status:
//    100% (or an actual end date) → Done · 1–99% (or an actual start date) → In Progress · otherwise To Do. The exact
//    % is kept in the description so nothing is lost.
//  · Dates: planned start / end become the task's start / due date; actual dates carry over, and a started or finished
//    row without them takes its planned date capped at today — the same rule the Excel task import uses.
//  · A task has one assignee. The first name in a "Albin; Priya" style resource list is matched to a project member by
//    name or email; if it isn't a member it is kept as a free-text external name. Any further names go in the description.
//  · No notification emails are sent — a conversion can create hundreds of tasks at once.

export type ConvertStatus = 'TO_DO' | 'IN_PROGRESS' | 'DONE';

export interface ConvertItem {
  id: string;
  title: string;
  type: string; // 'TASK' | 'MILESTONE'
  startDate: Date;
  endDate: Date;
  percentComplete: number;
  assignee: string | null;
  notes: string | null;
  actualStartDate: Date | null;
  actualEndDate: Date | null;
}

export interface MemberRef { id: string; name: string; email: string }

export function statusOf(it: Pick<ConvertItem, 'percentComplete' | 'actualStartDate' | 'actualEndDate'>): ConvertStatus {
  if (it.percentComplete >= 100 || it.actualEndDate) return 'DONE';
  if (it.percentComplete > 0 || it.actualStartDate) return 'IN_PROGRESS';
  return 'TO_DO';
}

/** "Albin; Priya", "Albin, Priya", "Albin & Priya", "Albin and Priya" → ["Albin", "Priya"]. */
export function splitResources(raw: string | null | undefined): string[] {
  return (raw ?? '').split(/[;,&\n]+|\s+and\s+/i).map((s) => s.trim()).filter(Boolean);
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Exact (case- and spacing-insensitive) match on a member's name or email; deliberately not fuzzy. */
export function matchMember(name: string, members: MemberRef[]): MemberRef | null {
  const n = norm(name);
  if (!n) return null;
  return members.find((m) => norm(m.email) === n || norm(m.name) === n) ?? null;
}

const isoDay = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '');

/** Identity of a task for "is this already in the list?" — a plan can legitimately repeat a title, so dates are part of it. */
export const taskKey = (title: string, start: Date | null | undefined, due: Date | null | undefined) => `${title}|${isoDay(start)}|${isoDay(due)}`;

export interface TaskData {
  title: string;
  description: string | null;
  priority: 'NORMAL';
  status: ConvertStatus;
  assigneeId: string | null;
  assigneeExternalName: string | null;
  startDate: Date;
  dueDate: Date;
  actualStartDate: Date | null;
  actualEndDate: Date | null;
  tags: string;
  completedAt: Date | null;
}

export interface BuiltTask { itemId: string; data: TaskData; unmatched: string[] }

export function buildTask(it: ConvertItem, members: MemberRef[]): BuiltTask {
  const isMilestone = it.type === 'MILESTONE';
  const status = statusOf(it);
  const start = it.startDate;
  const due = isMilestone ? it.startDate : it.endDate;

  const names = splitResources(it.assignee);
  const matched = names.length ? matchMember(names[0], members) : null;
  const unmatched = names.filter((n) => !matchMember(n, members));
  const extra = names.slice(1);

  const pct = Math.max(0, Math.min(100, Math.round(it.percentComplete)));
  const description = [
    it.notes?.trim() || null,
    pct > 0 && pct < 100 ? `Progress on the timeline: ${pct}%.` : null,
    extra.length ? `Also assigned: ${extra.join(', ')}.` : null,
  ].filter(Boolean).join('\n\n') || null;

  const actuals = actualsForStatusChange(
    { status: 'TO_DO', actualStartDate: null, actualEndDate: null },
    status,
    { startOn: capAtToday(it.actualStartDate ?? start), endOn: capAtToday(it.actualEndDate ?? due) },
  );

  return {
    itemId: it.id,
    unmatched,
    data: {
      title: it.title.slice(0, 300),
      description: description ? description.slice(0, 10000) : null,
      priority: 'NORMAL',
      status,
      assigneeId: matched?.id ?? null,
      assigneeExternalName: !matched && it.assignee?.trim() ? it.assignee.trim().slice(0, 120) : null,
      startDate: start,
      dueDate: due,
      actualStartDate: actuals.actualStartDate ?? null,
      actualEndDate: actuals.actualEndDate ?? null,
      tags: JSON.stringify(isMilestone ? ['Milestone'] : []),
      completedAt: status === 'DONE' ? new Date() : null,
    },
  };
}

/** A parent task's own dates / status follow its subtasks (its actuals are rolled up separately). */
export function parentDataFor(name: string, kids: TaskData[]): Pick<TaskData, 'title' | 'startDate' | 'dueDate' | 'status' | 'completedAt'> & { description: null; priority: 'NORMAL'; tags: string } {
  const starts = kids.map((k) => k.startDate.getTime());
  const dues = kids.map((k) => k.dueDate.getTime());
  const allDone = kids.length > 0 && kids.every((k) => k.status === 'DONE');
  const anyStarted = kids.some((k) => k.status !== 'TO_DO');
  const status: ConvertStatus = allDone ? 'DONE' : anyStarted ? 'IN_PROGRESS' : 'TO_DO';
  return {
    title: name.slice(0, 300),
    description: null,
    priority: 'NORMAL',
    tags: '[]',
    startDate: new Date(Math.min(...starts)),
    dueDate: new Date(Math.max(...dues)),
    status,
    completedAt: status === 'DONE' ? new Date() : null,
  };
}

/** Counts of each key, to be consumed one-for-one as matching rows are found (a multiset). */
export function countKeys(tasks: { title: string; startDate: Date | null; dueDate: Date | null }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tasks) { const k = taskKey(t.title, t.startDate, t.dueDate); m.set(k, (m.get(k) ?? 0) + 1); }
  return m;
}
