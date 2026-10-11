import { prisma } from './prisma.js';
import { parseDateOnly } from './timelineDates.js';

// ── Timeline ⇄ Task Lists live link ─────────────────────────────────────────
// A swimlane with taskListId set is *generated* from that Task List. We
// reconcile (create / update / delete) the lane's items against the tasks
// every time the timeline is opened, so a status or date change made in the
// Task List shows up on the timeline with no manual refresh.
//
// Progress is derived from STATUS ONLY — there is no free-form % on a task:
//   To Do 0 · In Progress 50 · In Review 75 · Done 100
// A task with subtasks shows the average of its subtasks' status %.

export const STATUS_PERCENT: Record<string, number> = { TO_DO: 0, IN_PROGRESS: 50, IN_REVIEW: 75, DONE: 100 };
export const statusPercent = (status: string): number => STATUS_PERCENT[status] ?? 0;

export type Granularity = 'TASKS' | 'SUBTASKS';

export interface TaskRow {
  id: string;
  title: string;
  status: string;
  startDate: Date | null;
  dueDate: Date | null;
  parentTaskId: string | null;
  sortOrder: number;
  assigneeName: string | null; // member name or free-text external name
}

export interface DesiredItem {
  taskId: string;
  swimlaneId: string;
  title: string;
  type: 'TASK' | 'MILESTONE';
  startDate: Date;
  endDate: Date;
  percentComplete: number;
  assignee: string | null;
  sortOrder: number;
}

interface Span { start: Date; end: Date; milestone: boolean }

const day = (d: Date) => parseDateOnly(d);

/** A task's own dates → span. Due-only = milestone; start-only = one-day task; none = not on the timeline. */
function ownSpan(t: TaskRow): Span | null {
  if (t.startDate && t.dueDate) {
    const s = day(t.startDate); const e = day(t.dueDate);
    return { start: s, end: e < s ? s : e, milestone: false };
  }
  if (t.startDate) { const s = day(t.startDate); return { start: s, end: s, milestone: false }; }
  if (t.dueDate) { const d = day(t.dueDate); return { start: d, end: d, milestone: true }; }
  return null;
}

/** Pure: Task rows of ONE list → the items its lane should contain. Exported for testing. */
export function deriveItems(tasks: TaskRow[], laneId: string, granularity: Granularity): DesiredItem[] {
  const kids = new Map<string, TaskRow[]>();
  const tops: TaskRow[] = [];
  const byId = new Set(tasks.map((t) => t.id));
  for (const t of [...tasks].sort((a, b) => a.sortOrder - b.sortOrder)) {
    // A subtask whose parent isn't in this list (moved) is treated as top-level so it never vanishes.
    if (t.parentTaskId && byId.has(t.parentTaskId)) kids.set(t.parentTaskId, [...(kids.get(t.parentTaskId) ?? []), t]);
    else tops.push(t);
  }

  const out: DesiredItem[] = [];
  const push = (t: TaskRow, span: Span, pct: number) => {
    out.push({
      taskId: t.id, swimlaneId: laneId, title: t.title.slice(0, 200), type: span.milestone ? 'MILESTONE' : 'TASK',
      startDate: span.start, endDate: span.end, percentComplete: Math.round(pct), assignee: t.assigneeName, sortOrder: out.length,
    });
  };

  for (const t of tops) {
    const children = kids.get(t.id) ?? [];
    if (granularity === 'SUBTASKS' && children.length > 0) {
      for (const c of children) {
        const sp = ownSpan(c);
        if (sp) push(c, sp, statusPercent(c.status));
      }
      continue;
    }
    // One bar for the task. With subtasks: span = their combined span, % = their average.
    // With subtasks the bar spans the earliest to the latest date of the task's own dates and its subtasks'.
    const childSpans = children.map(ownSpan).filter((x): x is Span => !!x);
    const own = ownSpan(t);
    let span: Span | null;
    if (childSpans.length > 0) {
      const all = own ? [...childSpans, own] : childSpans;
      span = {
        start: new Date(Math.min(...all.map((x) => x.start.getTime()))),
        end: new Date(Math.max(...all.map((x) => x.end.getTime()))),
        milestone: false,
      };
    } else span = own;
    if (!span) continue;
    const pct = children.length > 0
      ? children.reduce((n, c) => n + statusPercent(c.status), 0) / children.length
      : statusPercent(t.status);
    push(t, span, pct);
  }
  return out;
}

const defaultMarker = (type: 'TASK' | 'MILESTONE') => (type === 'MILESTONE' ? 'diamond' : 'pill');

/**
 * Reconcile every task-linked lane of a timeline. Cheap when nothing changed (3 reads, no writes).
 * Returns true if anything was written.
 */
export async function syncTimelineFromTasks(timelineId: string): Promise<boolean> {
  const tl = await prisma.timeline.findUnique({ where: { id: timelineId }, select: { projectId: true, taskGranularity: true } });
  if (!tl) return false;
  const lanes = await prisma.timelineSwimlane.findMany({ where: { timelineId, taskListId: { not: null } }, select: { id: true, taskListId: true } });
  if (lanes.length === 0) return false;

  const lists = await prisma.taskList.findMany({
    where: { projectId: tl.projectId, id: { in: lanes.map((l) => l.taskListId as string) } }, select: { id: true },
  });
  const liveLists = new Set(lists.map((l) => l.id));
  const deadLanes = lanes.filter((l) => !liveLists.has(l.taskListId as string));
  const liveLanes = lanes.filter((l) => liveLists.has(l.taskListId as string));
  let wrote = false;

  // A deleted Task List unlinks its lane; the items stay as a static copy.
  if (deadLanes.length > 0) {
    const ids = deadLanes.map((l) => l.id);
    await prisma.$transaction([
      prisma.timelineItem.updateMany({ where: { timelineId, swimlaneId: { in: ids } }, data: { taskId: null } }),
      prisma.timelineSwimlane.updateMany({ where: { id: { in: ids } }, data: { taskListId: null } }),
    ]);
    wrote = true;
  }
  if (liveLanes.length === 0) return wrote;

  const tasks = await prisma.task.findMany({
    where: { projectId: tl.projectId, taskListId: { in: liveLanes.map((l) => l.taskListId as string) } },
    select: {
      id: true, title: true, status: true, startDate: true, dueDate: true, parentTaskId: true, sortOrder: true, taskListId: true,
      assigneeExternalName: true, assignee: { select: { user: { select: { name: true } } } },
    },
  });
  const rowsByList = new Map<string, TaskRow[]>();
  for (const t of tasks) {
    const row: TaskRow = {
      id: t.id, title: t.title, status: t.status, startDate: t.startDate, dueDate: t.dueDate, parentTaskId: t.parentTaskId,
      sortOrder: t.sortOrder, assigneeName: t.assignee?.user?.name ?? t.assigneeExternalName ?? null,
    };
    rowsByList.set(t.taskListId, [...(rowsByList.get(t.taskListId) ?? []), row]);
  }

  const granularity: Granularity = tl.taskGranularity === 'SUBTASKS' ? 'SUBTASKS' : 'TASKS';
  const desired = liveLanes.flatMap((lane) => deriveItems(rowsByList.get(lane.taskListId as string) ?? [], lane.id, granularity));
  const existing = await prisma.timelineItem.findMany({ where: { timelineId, taskId: { not: null } } });
  const existingByTask = new Map(existing.map((i) => [i.taskId as string, i]));
  const desiredIds = new Set(desired.map((d) => d.taskId));

  const toCreate = desired.filter((d) => !existingByTask.has(d.taskId));
  const toDelete = existing.filter((i) => !desiredIds.has(i.taskId as string)).map((i) => i.id);
  const updates = desired.flatMap((d) => {
    const cur = existingByTask.get(d.taskId);
    if (!cur) return [];
    const changed = cur.title !== d.title || cur.type !== d.type || cur.swimlaneId !== d.swimlaneId
      || cur.startDate.getTime() !== d.startDate.getTime() || cur.endDate.getTime() !== d.endDate.getTime()
      || cur.percentComplete !== d.percentComplete || (cur.assignee ?? null) !== d.assignee || cur.sortOrder !== d.sortOrder;
    if (!changed) return [];
    return [prisma.timelineItem.update({
      where: { id: cur.id },
      data: {
        title: d.title, type: d.type, swimlaneId: d.swimlaneId, startDate: d.startDate, endDate: d.endDate,
        percentComplete: d.percentComplete, assignee: d.assignee, sortOrder: d.sortOrder,
        // marker/colour are the user's to keep — only reset the marker when the item switches kind (task ⇄ milestone)
        ...(cur.type !== d.type ? { marker: defaultMarker(d.type) } : {}),
      },
    })];
  });

  if (toCreate.length === 0 && toDelete.length === 0 && updates.length === 0) return wrote;

  await prisma.$transaction([
    ...(toDelete.length ? [prisma.timelineItem.deleteMany({ where: { id: { in: toDelete } } })] : []),
    ...updates,
    ...(toCreate.length ? [prisma.timelineItem.createMany({
      skipDuplicates: true, // two requests opening the timeline at once must not double-create
      data: toCreate.map((d) => ({
        timelineId, swimlaneId: d.swimlaneId, taskId: d.taskId, title: d.title, type: d.type, marker: defaultMarker(d.type),
        startDate: d.startDate, endDate: d.endDate, percentComplete: d.percentComplete, assignee: d.assignee, sortOrder: d.sortOrder,
      })),
    })] : []),
  ]);
  return true;
}
