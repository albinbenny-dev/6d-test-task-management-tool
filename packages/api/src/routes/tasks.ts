import { Router, RequestHandler } from 'express';
import { z } from 'zod';
import multer from 'multer';
import * as xlsx from 'xlsx';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import { requireWrite } from '../middleware/rbac.js';

// ── Task Management — Tasks ──────────────────────────────────────────────────
// General project task tracking (ClickUp-style), deliberately separate from
// TestCycle/TestCycleItem (manual test execution) and Suite/Run (automation)
// — a Task is project work, not a test result. Single assignee per task (no
// ClickUp-style multi-assignee — kept simple for the MVP), one level of
// subtasks via parentTaskId, and a fixed four-stage status shared by every
// list (no per-list custom statuses). "Overdue" is never stored — the
// frontend computes it from dueDate vs. now for anything not yet DONE.
//
// Open to every project role (including TEST_USER) for both read and write —
// unlike Test Cycle administration, task tracking isn't gated to leads; any
// team member should be able to create/assign/update a task for a peer.

const TASK_INCLUDE = {
  taskList: { select: { id: true, name: true, color: true } },
  assignee: { include: { user: { select: { id: true, name: true, email: true } } } },
  _count: { select: { subtasks: true, comments: true } },
} as const;

const CreateTaskSchema = z.object({
  taskListId:           z.string().min(1),
  parentTaskId:         z.string().min(1).optional(),
  title:                z.string().min(1).max(300),
  description:          z.string().max(10000).optional(),
  priority:             z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
  assigneeUserId:       z.string().min(1).optional(),
  assigneeExternalName: z.string().trim().min(1).max(120).optional(),
  startDate:            z.string().datetime().optional().nullable(),
  dueDate:              z.string().datetime().optional().nullable(),
  tags:                 z.array(z.string().min(1).max(40)).optional(),
}).refine((d) => !(d.assigneeUserId && d.assigneeExternalName), {
  message: 'Cannot set both a registered assignee and an external assignee name',
});

const UpdateTaskSchema = z.object({
  title:          z.string().min(1).max(300).optional(),
  description:    z.string().max(10000).optional().nullable(),
  priority:       z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
  startDate:      z.string().datetime().optional().nullable(),
  dueDate:        z.string().datetime().optional().nullable(),
  tags:           z.array(z.string().min(1).max(40)).optional(),
  taskListId:     z.string().min(1).optional(),
});

const UpdateStatusSchema = z.object({
  status: z.enum(['TO_DO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']),
});

const AssignTaskSchema = z.object({
  assigneeUserId:       z.string().nullable().optional(),
  assigneeExternalName: z.string().trim().min(1).max(120).nullable().optional(),
}).refine((d) => !(d.assigneeUserId && d.assigneeExternalName), {
  message: 'Cannot set both a registered assignee and an external assignee name',
});

const ReorderTasksSchema = z.object({
  taskListId: z.string().min(1),
  orderedIds: z.array(z.string()).min(1),
});

const BulkMoveTasksSchema = z.object({
  taskIds:    z.array(z.string()).min(1),
  taskListId: z.string().min(1),
});

const BulkCopyTasksSchema = z.object({
  taskIds:    z.array(z.string()).min(1),
  taskListId: z.string().min(1),
});

const ExportTasksSchema = z.object({
  ids:        z.array(z.string()).optional(),
  taskListId: z.string().optional(),
});

const CreateCommentSchema = z.object({
  body: z.string().min(1).max(5000),
});

const UpdateCommentSchema = z.object({
  body: z.string().min(1).max(5000),
});

const ListQuerySchema = z.object({
  taskListId: z.string().optional(),
  status:     z.enum(['TO_DO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']).optional(),
  assigneeId: z.string().optional(),
});

const router = Router({ mergeParams: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
router.use(verifyToken as RequestHandler);
router.use(requireProjectAccess as unknown as RequestHandler);

// ── Helpers ──────────────────────────────────────────────────────────────

async function resolveAssigneeId(
  projectId: string,
  assigneeUserId: string | null | undefined,
): Promise<{ ok: true; assigneeId: string | null } | { ok: false }> {
  if (!assigneeUserId) return { ok: true, assigneeId: null };
  const member = await prisma.projectMember.findFirst({ where: { projectId, userId: assigneeUserId } });
  if (!member) return { ok: false };
  return { ok: true, assigneeId: member.id };
}

// Excel import resolves assignees by email (a spreadsheet has emails, not
// internal ProjectMember IDs) — case-insensitive, matching this codebase's
// existing search-filter convention.
async function resolveAssigneeByEmail(projectId: string, email: string): Promise<string | null> {
  const member = await prisma.projectMember.findFirst({
    where: { projectId, user: { email: { equals: email.trim(), mode: 'insensitive' } } },
  });
  return member?.id ?? null;
}

// ── GET / — list tasks (optionally filtered by list/status/assignee) ──────
// Returns a flat array (both top-level tasks and subtasks) — the frontend
// nests subtasks under their parent using parentTaskId.

router.get('/', (async (req, res) => {
  const projectId = req.project.id;
  const parsed = ListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }
  const { taskListId, status, assigneeId } = parsed.data;

  const tasks = await prisma.task.findMany({
    where: {
      projectId,
      ...(taskListId ? { taskListId } : {}),
      ...(status ? { status } : {}),
      ...(assigneeId ? { assigneeId } : {}),
    },
    include: TASK_INCLUDE,
    orderBy: { sortOrder: 'asc' },
  });
  res.json({ tasks });
}) as RequestHandler);

// ── GET /my — tasks assigned to the caller (or ?userId= for privileged view)
// across every list in this project. Mirrors test-cycles' /assignments.

const MyTasksQuerySchema = z.object({ userId: z.string().optional() });

router.get('/my', (async (req, res) => {
  const projectId = req.project.id;
  const parsed = MyTasksQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }

  const targetUserId = parsed.data.userId || req.user.id;
  const isSelf = targetUserId === req.user.id;
  if (!isSelf) {
    const isPrivileged =
      req.user.globalRole === 'SUPER_ADMIN' ||
      req.user.globalRole === 'ADMIN' ||
      req.projectMember?.role === 'ADMIN' ||
      req.projectMember?.role === 'SUPER_USER';
    if (!isPrivileged) {
      return res.status(403).json({ error: "Only privileged roles may view another member's tasks" });
    }
  }

  const member = await prisma.projectMember.findFirst({ where: { projectId, userId: targetUserId } });
  if (!member) return res.json({ userId: targetUserId, tasks: [] });

  const tasks = await prisma.task.findMany({
    where: { projectId, assigneeId: member.id },
    include: TASK_INCLUDE,
    orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
  });
  res.json({ userId: targetUserId, tasks });
}) as RequestHandler);

// ── GET /dashboard/summary — a PM-style tracking view: status/assignee/list
// breakdowns, overdue/this-week/next-week workload, and delivery-quality KPIs
// (completion rate, on-time rate, avg cycle time). Everything is computed
// in-memory from one lean findMany + one taskList findMany — cheaper than
// the previous version's 4-query shape despite returning much more. ───────

router.get('/dashboard/summary', (async (req, res) => {
  const projectId = req.project.id;
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);

  // Calendar week (Mon–Sun) boundaries — "this week"/"next week" are always
  // forward-looking, so a task due yesterday counts as overdue, not "this
  // week," and nothing is ever double-counted across the three buckets.
  const dow = now.getDay(); // 0=Sun..6=Sat
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const startOfThisWeek = new Date(now);
  startOfThisWeek.setHours(0, 0, 0, 0);
  startOfThisWeek.setDate(startOfThisWeek.getDate() + mondayOffset);
  const endOfThisWeek = new Date(startOfThisWeek);
  endOfThisWeek.setDate(startOfThisWeek.getDate() + 7); // exclusive, next Monday 00:00
  const endOfNextWeek = new Date(endOfThisWeek);
  endOfNextWeek.setDate(endOfThisWeek.getDate() + 7); // exclusive

  const [allTasks, allLists] = await Promise.all([
    prisma.task.findMany({
      where: { projectId },
      select: {
        id: true, status: true, priority: true, assigneeId: true, assigneeExternalName: true, taskListId: true,
        startDate: true, dueDate: true, createdAt: true, completedAt: true,
      },
    }),
    prisma.taskList.findMany({ where: { projectId }, select: { id: true, name: true, color: true } }),
  ]);

  const counts = { TO_DO: 0, IN_PROGRESS: 0, IN_REVIEW: 0, DONE: 0 } as Record<string, number>;
  const priorityBreakdown = { LOW: 0, NORMAL: 0, HIGH: 0, URGENT: 0 } as Record<string, number>;
  let completedThisWeek = 0;
  let overdueCount = 0;
  let dueThisWeek = 0;
  let dueNextWeek = 0;
  let unassignedOpenCount = 0;

  const byAssigneeMap = new Map<string, { assigneeId: string | null; assigneeUserId: string | null; assigneeName: string; total: number; overdue: number }>();
  const listMap = new Map(allLists.map((l) => [l.id, { taskListId: l.id, name: l.name, color: l.color, total: 0, done: 0, overdue: 0 }]));

  let onTimeDoneWithDue = 0;
  let doneWithDue = 0;
  let cycleTimeDaysSum = 0;
  let doneWithCompletedAt = 0;

  for (const t of allTasks) {
    counts[t.status] = (counts[t.status] ?? 0) + 1;
    const isOpen = t.status !== 'DONE';

    if (isOpen) {
      priorityBreakdown[t.priority] = (priorityBreakdown[t.priority] ?? 0) + 1;
      if (!t.assigneeId && !t.assigneeExternalName) unassignedOpenCount++;

      if (t.dueDate) {
        if (t.dueDate < now) overdueCount++;
        else if (t.dueDate < endOfThisWeek) dueThisWeek++;
        else if (t.dueDate < endOfNextWeek) dueNextWeek++;
      }

      // External assignees get their own bucket (keyed off the name, since
      // there's no ProjectMember id) so they never collapse into "Unassigned".
      const key = t.assigneeId ?? (t.assigneeExternalName ? `ext:${t.assigneeExternalName}` : 'unassigned');
      if (!byAssigneeMap.has(key)) {
        byAssigneeMap.set(key, {
          assigneeId: t.assigneeId ?? (t.assigneeExternalName ? key : null),
          assigneeUserId: null,
          assigneeName: t.assigneeExternalName ?? t.assigneeId ?? 'Unassigned',
          total: 0,
          overdue: 0,
        });
      }
      const row = byAssigneeMap.get(key)!;
      row.total += 1;
      if (t.dueDate && t.dueDate < now) row.overdue += 1;
    } else {
      if (t.completedAt && t.completedAt >= weekAgo) completedThisWeek++;
      if (t.completedAt) {
        doneWithCompletedAt++;
        const from = (t.startDate ?? t.createdAt).getTime();
        cycleTimeDaysSum += (t.completedAt.getTime() - from) / 86_400_000;
        if (t.dueDate) {
          doneWithDue++;
          if (t.completedAt.getTime() <= t.dueDate.getTime()) onTimeDoneWithDue++;
        }
      }
    }

    const listRow = listMap.get(t.taskListId);
    if (listRow) {
      listRow.total++;
      if (t.status === 'DONE') listRow.done++;
      else if (t.dueDate && t.dueDate < now) listRow.overdue++;
    }
  }

  const total = allTasks.length;

  // "ext:"-prefixed keys are external-assignee buckets (see above) — they
  // already carry their display name and have no ProjectMember row to look up.
  const assigneeIds = [...byAssigneeMap.keys()].filter((k) => k !== 'unassigned' && !k.startsWith('ext:'));
  const members = assigneeIds.length
    ? await prisma.projectMember.findMany({ where: { id: { in: assigneeIds } }, include: { user: { select: { id: true, name: true } } } })
    : [];
  // ProjectMember.id is project-scoped (a different row per project for the
  // same human) — user.id is the one stable identity a caller aggregating
  // across projects (e.g. a portfolio dashboard) can actually merge on.
  const memberById = new Map(members.map((m) => [m.id, m.user]));
  for (const [key, row] of byAssigneeMap) {
    if (key !== 'unassigned' && !key.startsWith('ext:')) {
      const user = memberById.get(key);
      row.assigneeName = user?.name ?? 'Unknown';
      row.assigneeUserId = user?.id ?? null;
    }
  }

  const overdueIdsSorted = allTasks
    .filter((t) => t.status !== 'DONE' && t.dueDate && t.dueDate < now)
    .sort((a, b) => a.dueDate!.getTime() - b.dueDate!.getTime())
    .slice(0, 25)
    .map((t) => t.id);
  const overdueTasks = overdueIdsSorted.length
    ? await prisma.task.findMany({ where: { id: { in: overdueIdsSorted } }, include: TASK_INCLUDE, orderBy: { dueDate: 'asc' } })
    : [];

  const byTaskList = [...listMap.values()]
    .map((r) => ({ ...r, completionRate: r.total > 0 ? Math.round((r.done / r.total) * 100) : 0 }))
    .sort((a, b) => b.overdue - a.overdue || a.name.localeCompare(b.name));

  res.json({
    counts,
    total,
    completedThisWeek,
    overdueCount,
    overdueTasks,
    dueThisWeek,
    dueNextWeek,
    completionRate: total > 0 ? Math.round((counts.DONE / total) * 100) : 0,
    onTimeRate: doneWithDue > 0 ? Math.round((onTimeDoneWithDue / doneWithDue) * 100) : null,
    avgCycleTimeDays: doneWithCompletedAt > 0 ? Math.round((cycleTimeDaysSum / doneWithCompletedAt) * 10) / 10 : null,
    unassignedOpenCount,
    priorityBreakdown,
    byAssignee: [...byAssigneeMap.values()].sort((a, b) => b.total - a.total),
    byTaskList,
  });
}) as RequestHandler);

// ── PATCH /reorder — bulk-persist drag-reordered task order within a list ──

router.patch('/reorder', requireWrite as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const parsed = ReorderTasksSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }

  const tasks = await prisma.task.findMany({
    where: { projectId, taskListId: parsed.data.taskListId, id: { in: parsed.data.orderedIds } },
  });
  const validIds = new Set(tasks.map((t) => t.id));

  await prisma.$transaction(
    parsed.data.orderedIds
      .filter((id) => validIds.has(id))
      .map((id, i) => prisma.task.update({ where: { id }, data: { sortOrder: i } })),
  );
  res.json({ message: 'Reordered' });
}) as RequestHandler);

// ── PATCH /bulk-move — move selected tasks to another list, bringing each
// one's subtasks along automatically so a hierarchy never splits across two
// lists (a subtask left behind in the old list would dangle under a parent
// it can no longer see). ───────────────────────────────────────────────────

router.patch('/bulk-move', requireWrite as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const parsed = BulkMoveTasksSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }
  const { taskIds, taskListId } = parsed.data;

  const targetList = await prisma.taskList.findFirst({ where: { id: taskListId, projectId } });
  if (!targetList) return res.status(400).json({ error: 'That task list does not belong to this project' });

  const selected = await prisma.task.findMany({ where: { projectId, id: { in: taskIds } }, select: { id: true } });
  if (selected.length === 0) return res.status(400).json({ error: 'No matching tasks found' });
  const selectedIds = selected.map((t) => t.id);

  const children = await prisma.task.findMany({ where: { projectId, parentTaskId: { in: selectedIds } }, select: { id: true } });
  const allIds = [...new Set([...selectedIds, ...children.map((t) => t.id)])];

  const { count } = await prisma.task.updateMany({ where: { id: { in: allIds } }, data: { taskListId } });
  res.json({ moved: count });
}) as RequestHandler);

// ── POST /bulk-copy — clone selected tasks into another list (originals
// untouched). Same auto-include-subtasks rule as bulk-move; a subtask copied
// without its parent (parent wasn't selected) lands as top-level in the
// target list instead of losing its content. ──────────────────────────────

router.post('/bulk-copy', requireWrite as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const parsed = BulkCopyTasksSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }
  const { taskIds, taskListId } = parsed.data;

  const targetList = await prisma.taskList.findFirst({ where: { id: taskListId, projectId } });
  if (!targetList) return res.status(400).json({ error: 'That task list does not belong to this project' });

  const selected = await prisma.task.findMany({ where: { projectId, id: { in: taskIds } } });
  if (selected.length === 0) return res.status(400).json({ error: 'No matching tasks found' });
  const selectedIds = new Set(selected.map((t) => t.id));

  const children = await prisma.task.findMany({ where: { projectId, parentTaskId: { in: [...selectedIds] } } });
  const all = [...selected, ...children.filter((t) => !selectedIds.has(t.id))];
  const allIds = new Set(all.map((t) => t.id));
  const topLevel = all.filter((t) => !t.parentTaskId || !allIds.has(t.parentTaskId));
  const nested = all.filter((t) => t.parentTaskId && allIds.has(t.parentTaskId));

  const last = await prisma.task.findFirst({ where: { projectId, taskListId }, orderBy: { sortOrder: 'desc' } });
  let nextSortOrder = (last?.sortOrder ?? -1) + 1;

  const copyData = (t: (typeof all)[number], parentTaskId: string | null) => ({
    projectId,
    taskListId,
    parentTaskId,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    assigneeId: t.assigneeId,
    startDate: t.startDate,
    dueDate: t.dueDate,
    tags: t.tags,
    sortOrder: nextSortOrder++,
    createdByUserId: req.user.id,
    completedAt: t.completedAt,
  });

  const copied = await prisma.$transaction(async (tx) => {
    const idMap = new Map<string, string>();
    for (const t of topLevel) {
      const c = await tx.task.create({ data: copyData(t, null) });
      idMap.set(t.id, c.id);
    }
    for (const t of nested) {
      const c = await tx.task.create({ data: copyData(t, idMap.get(t.parentTaskId!) ?? null) });
      idMap.set(t.id, c.id);
    }
    return idMap.size;
  });

  res.status(201).json({ copied });
}) as RequestHandler);

// ── POST /export — download tasks as Excel. Body may include `ids` to
// export a filtered/selected subset, or `taskListId` to export a whole list
// unfiltered; omit both to export every task in the project. ─────────────

const PRIORITY_DISPLAY: Record<string, string> = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' };
const STATUS_DISPLAY: Record<string, string> = { TO_DO: 'To Do', IN_PROGRESS: 'In Progress', IN_REVIEW: 'In Review', DONE: 'Done' };

router.post('/export', (async (req, res) => {
  const projectId = req.project.id;
  const parsed = ExportTasksSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }
  const { ids, taskListId } = parsed.data;

  const tasks = await prisma.task.findMany({
    where: {
      projectId,
      // `ids` present (even []) means "export exactly this set" — an empty
      // array correctly yields zero rows rather than falling back to
      // "everything," which would silently ignore an active filter that
      // happens to match nothing right now.
      ...(ids !== undefined ? { id: { in: ids } } : taskListId ? { taskListId } : {}),
    },
    include: {
      assignee: { include: { user: { select: { email: true } } } },
      taskList: { select: { name: true } },
    },
    orderBy: [{ taskListId: 'asc' }, { sortOrder: 'asc' }],
  });

  const parentIds = [...new Set(tasks.map((t) => t.parentTaskId).filter((id): id is string => !!id))];
  const parents = parentIds.length
    ? await prisma.task.findMany({ where: { id: { in: parentIds } }, select: { id: true, title: true } })
    : [];
  const parentTitleById = new Map(parents.map((t) => [t.id, t.title]));

  const headers = ['Task List', 'Task Title', 'Description', 'Assignee Email', 'Priority', 'Status', 'Start Date', 'Due Date', 'Tags', 'Parent Task Title'];
  const rows = tasks.map((t) => {
    let tags: string[] = [];
    try { tags = JSON.parse(t.tags); } catch { /* corrupted row — export blank */ }
    return {
      'Task List':          t.taskList.name,
      'Task Title':         t.title,
      'Description':        t.description ?? '',
      'Assignee Email':     t.assignee?.user.email ?? '',
      'Priority':           PRIORITY_DISPLAY[t.priority] ?? t.priority,
      'Status':             STATUS_DISPLAY[t.status] ?? t.status,
      'Start Date':         t.startDate ?? '',
      'Due Date':           t.dueDate ?? '',
      'Tags':               tags.join(', '),
      'Parent Task Title':  t.parentTaskId ? (parentTitleById.get(t.parentTaskId) ?? '') : '',
    };
  });

  const ws = xlsx.utils.json_to_sheet(rows, { header: headers });
  ws['!cols'] = [20, 28, 40, 24, 12, 14, 14, 14, 20, 24].map((w) => ({ wch: w }));
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'Tasks');
  const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="tasks-export.xlsx"');
  res.send(buf);
}) as RequestHandler);

// ── GET /template — download a standard project-plan Excel template ───────

router.get('/template', (_req, res) => {
  const headers = ['Task Title', 'Description', 'Assignee Email', 'Priority', 'Status', 'Start Date', 'Due Date', 'Tags', 'Parent Task Title'];
  const today = new Date();
  const inAWeek = new Date(today.getTime() + 7 * 86_400_000);
  const samples = [
    {
      'Task Title': 'Requirement Gathering',
      'Description': 'Collect and finalize requirements from stakeholders',
      'Assignee Email': 'lead@example.com',
      'Priority': 'High',
      'Status': 'In Progress',
      'Start Date': today,
      'Due Date': inAWeek,
      'Tags': 'planning, kickoff',
      'Parent Task Title': '',
    },
    {
      'Task Title': 'Stakeholder Interviews',
      'Description': 'Interview key stakeholders to validate scope',
      'Assignee Email': 'tester@example.com',
      'Priority': 'Normal',
      'Status': 'To Do',
      'Start Date': today,
      'Due Date': inAWeek,
      'Tags': '',
      'Parent Task Title': 'Requirement Gathering',
    },
  ];

  const ws = xlsx.utils.json_to_sheet(samples, { header: headers });
  ws['!cols'] = [28, 45, 24, 12, 14, 14, 14, 20, 24].map((w) => ({ wch: w }));
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'Task Plan');
  const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="task-import-template.xlsx"');
  res.send(buf);
});

// ── POST /import — parse Excel and bulk-create/update Tasks in one target
// list. Open to every project role (requireWrite), same tier as every other
// Task mutation — the Excel path creates nothing a lead couldn't already
// create one row at a time through the UI, and (unlike TC Library's import)
// it never deletes, so it doesn't carry the "accidental bulk wipe" risk that
// gates taskLists.ts's DELETE /:listId to ADMIN/SUPER_USER. ────────────────

const PRIORITY_VALUES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const STATUS_VALUES = ['TO_DO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'];

function normalizeEnumValue(raw: string, values: string[]): string | null {
  if (!raw) return null;
  const norm = raw.trim().toUpperCase().replace(/[\s-]+/g, '_');
  return values.includes(norm) ? norm : null;
}

// Excel's date epoch: serial 0 == 1899-12-30 (the 1900 leap-year bug baked
// into every spreadsheet tool). Pure UTC arithmetic, deliberately NOT using
// xlsx's own cellDates:true conversion (see the /import route below) or any
// `new Date(1899, ...)` local-time construction — Node/ICU's timezone
// database records India's pre-1906 local time as a few seconds off modern
// IST, so a LOCAL 1899 anchor date is measurably wrong on an IST host; every
// serial decoded off that anchor then round-trips to the day *before* the
// spreadsheet's actual date once persisted/serialized as UTC. Date.UTC has
// no such historical-offset lookup, so this is exact on every host regardless
// of timezone.
function excelSerialToUTCDate(serial: number): Date {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86_400_000));
}

// A lead may instead paste a date as plain text (cellDates is off — see
// below — so a genuine Excel date cell arrives here as a raw number, not a
// Date); this fallback tries to parse that text, and treats anything
// unparseable as "no date given" rather than failing the row.
function parseDateCell(raw: unknown): Date | null {
  if (typeof raw === 'number' && !isNaN(raw)) return excelSerialToUTCDate(raw);
  if (raw instanceof Date && !isNaN(raw.getTime())) return new Date(Date.UTC(raw.getFullYear(), raw.getMonth(), raw.getDate()));
  if (typeof raw === 'string' && raw.trim()) {
    const d = new Date(raw.trim());
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

router.post('/import', requireWrite as RequestHandler, upload.single('file'), (async (req, res) => {
  const projectId = req.project.id;
  const taskListId = (req.body?.taskListId as string | undefined)?.trim();
  if (!taskListId) return res.status(400).json({ error: 'taskListId is required' });
  if (!req.file) return res.status(400).json({ error: 'Excel file required (field: file)' });

  const list = await prisma.taskList.findFirst({ where: { id: taskListId, projectId } });
  if (!list) return res.status(400).json({ error: 'That task list does not belong to this project' });

  // cellDates intentionally omitted (defaults to false) — parseDateCell
  // above now converts the raw Excel serial itself; see its comment.
  const wb = xlsx.read(req.file.buffer, { type: 'buffer' });

  const findRaw = (row: Record<string, unknown>, keys: string[]): unknown => {
    const norm: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) norm[k.toLowerCase().trim()] = v;
    for (const k of keys) {
      const v = norm[k.toLowerCase().trim()];
      if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return undefined;
  };
  const findVal = (row: Record<string, unknown>, keys: string[]): string => {
    const v = findRaw(row, keys);
    return v !== undefined ? String(v).trim() : '';
  };

  const titleKeys    = ['task title', 'title', 'task name', 'name'];
  const descKeys     = ['description', 'notes', 'desc'];
  const assigneeKeys = ['assignee email', 'assignee', 'email', 'assigned to'];
  const priorityKeys = ['priority'];
  const statusKeys   = ['status'];
  const startKeys    = ['start date', 'start'];
  const dueKeys      = ['due date', 'due', 'end date', 'finish date', 'finish'];
  const tagsKeys     = ['tags', 'labels'];
  const parentKeys   = ['parent task title', 'parent task', 'parent'];

  const allRows: Record<string, unknown>[] = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    allRows.push(...xlsx.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' }));
  }

  type MappedRow = {
    title: string;
    description: string | null;
    assigneeEmail: string;
    priorityRaw: string;
    statusRaw: string;
    startDate: Date | null;
    hasStartDateCell: boolean;
    dueDate: Date | null;
    hasDueDateCell: boolean;
    tagsRaw: string;
    hasTagsCell: boolean;
    parentTitleRaw: string;
  };

  let skippedEmpty = 0;
  const mapped: MappedRow[] = [];
  for (const row of allRows) {
    const title = findVal(row, titleKeys);
    if (!title) { skippedEmpty++; continue; }
    const startRaw = findRaw(row, startKeys);
    const dueRaw = findRaw(row, dueKeys);
    const tagsRaw = findVal(row, tagsKeys);
    mapped.push({
      title,
      description: findVal(row, descKeys) || null,
      assigneeEmail: findVal(row, assigneeKeys),
      priorityRaw: findVal(row, priorityKeys),
      statusRaw: findVal(row, statusKeys),
      startDate: startRaw !== undefined ? parseDateCell(startRaw) : null,
      hasStartDateCell: startRaw !== undefined,
      dueDate: dueRaw !== undefined ? parseDateCell(dueRaw) : null,
      hasDueDateCell: dueRaw !== undefined,
      tagsRaw,
      hasTagsCell: tagsRaw !== '',
      parentTitleRaw: findVal(row, parentKeys),
    });
  }

  // Dedup by title — scoped to this one taskListId (the whole import targets
  // a single list), so two different lists reusing a title never collide.
  const seen = new Set<string>();
  const duplicateRows: string[] = [];
  const deduped: MappedRow[] = [];
  for (const r of mapped) {
    if (seen.has(r.title)) { duplicateRows.push(r.title); continue; }
    seen.add(r.title);
    deduped.push(r);
  }

  if (deduped.length === 0) {
    return res.status(400).json({ error: 'No valid rows found. Check that "Task Title" column is present.' });
  }

  const existingTasks = await prisma.task.findMany({
    where: { projectId, taskListId },
    select: { id: true, title: true, parentTaskId: true, status: true },
  });
  const existingByTitle = new Map(existingTasks.map((t) => [t.title, t.id]));
  const existingParentById = new Map(existingTasks.map((t) => [t.id, t.parentTaskId]));
  const existingStatusById = new Map(existingTasks.map((t) => [t.id, t.status]));

  const last = await prisma.task.findFirst({ where: { projectId, taskListId }, orderBy: { sortOrder: 'desc' } });
  let nextSortOrder = (last?.sortOrder ?? -1) + 1;

  // A cell that doesn't match a project member's email falls back to being
  // stored as a free-text external assignee (same escape hatch the assignee
  // picker offers) rather than silently importing the row unassigned.
  const unmatchedAssigneesSet = new Set<string>();
  const resolved = await Promise.all(deduped.map(async (r) => {
    let assigneeId: string | null = null;
    let assigneeExternalName: string | null = null;
    if (r.assigneeEmail) {
      assigneeId = await resolveAssigneeByEmail(projectId, r.assigneeEmail);
      if (!assigneeId) {
        assigneeExternalName = r.assigneeEmail;
        unmatchedAssigneesSet.add(r.assigneeEmail);
      }
    }
    return {
      ...r,
      assigneeId,
      assigneeExternalName,
      priority: normalizeEnumValue(r.priorityRaw, PRIORITY_VALUES),
      status: normalizeEnumValue(r.statusRaw, STATUS_VALUES),
    };
  }));

  const toInsert = resolved.filter((r) => !existingByTitle.has(r.title));
  const toUpdate = resolved
    .filter((r) => existingByTitle.has(r.title))
    .map((r) => ({ ...r, _existingId: existingByTitle.get(r.title)! }));

  const titleToId = new Map<string, string>();

  if (toInsert.length > 0) {
    const created = await prisma.$transaction(
      toInsert.map((r) => prisma.task.create({
        data: {
          projectId,
          taskListId,
          title: r.title,
          description: r.description ?? undefined,
          priority: r.priority ?? 'NORMAL',
          status: r.status ?? 'TO_DO',
          assigneeId: r.assigneeId,
          assigneeExternalName: r.assigneeExternalName,
          startDate: r.startDate,
          dueDate: r.dueDate,
          tags: JSON.stringify(r.tagsRaw ? r.tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : []),
          sortOrder: nextSortOrder++,
          createdByUserId: req.user.id,
          completedAt: r.status === 'DONE' ? new Date() : null,
        },
      })),
    );
    created.forEach((t, i) => titleToId.set(toInsert[i].title, t.id));
  }

  // On UPDATE, a blank cell means "no change," not "clear the field" — a
  // re-import with a blank Due Date column must not wipe an existing due
  // date, and a blank Status cell must not reset a DONE task back to TO_DO.
  if (toUpdate.length > 0) {
    await prisma.$transaction(toUpdate.map((r) => {
      const data: Record<string, unknown> = {};
      if (r.description !== null) data.description = r.description;
      if (r.assigneeEmail) { data.assigneeId = r.assigneeId; data.assigneeExternalName = r.assigneeExternalName; }
      if (r.priority) data.priority = r.priority;
      if (r.status) {
        data.status = r.status;
        const prevStatus = existingStatusById.get(r._existingId);
        data.completedAt = r.status === 'DONE' ? (prevStatus === 'DONE' ? undefined : new Date()) : null;
      }
      if (r.hasStartDateCell) data.startDate = r.startDate;
      if (r.hasDueDateCell) data.dueDate = r.dueDate;
      if (r.hasTagsCell) data.tags = JSON.stringify(r.tagsRaw.split(',').map((t) => t.trim()).filter(Boolean));
      return prisma.task.update({ where: { id: r._existingId }, data });
    }));
    toUpdate.forEach((r) => titleToId.set(r.title, r._existingId));
  }

  // Parent linking — one level only, matching only within this same import
  // batch + target list (a row's declared parent must itself be a row in
  // this sheet, whether it was created or updated) so a lead can't
  // accidentally reparent a batch under an unrelated older task.
  const unresolvedParents: string[] = [];
  const parentUpdates: Array<{ id: string; parentTaskId: string }> = [];
  for (const r of resolved) {
    if (!r.parentTitleRaw) continue;
    const childId = titleToId.get(r.title);
    if (!childId || r.parentTitleRaw === r.title) { unresolvedParents.push(r.title); continue; }
    const parentId = titleToId.get(r.parentTitleRaw);
    if (!parentId) { unresolvedParents.push(r.title); continue; }
    const parentDeclaresParentInBatch = resolved.find((x) => x.title === r.parentTitleRaw)?.parentTitleRaw;
    const parentAlreadyHasParent = existingParentById.get(parentId);
    if (parentDeclaresParentInBatch || parentAlreadyHasParent) { unresolvedParents.push(r.title); continue; }
    parentUpdates.push({ id: childId, parentTaskId: parentId });
  }
  if (parentUpdates.length > 0) {
    await prisma.$transaction(parentUpdates.map((p) => prisma.task.update({ where: { id: p.id }, data: { parentTaskId: p.parentTaskId } })));
  }

  res.status(201).json({
    imported: toInsert.length,
    updated: toUpdate.length,
    skippedEmpty,
    duplicateRows,
    unmatchedAssignees: [...unmatchedAssigneesSet],
    unresolvedParents,
    totalRows: allRows.length,
  });
}) as RequestHandler);

// ── GET /:taskId — task detail with subtasks + comments ────────────────────

router.get('/:taskId', (async (req, res) => {
  const projectId = req.project.id;
  const { taskId } = req.params;
  const task = await prisma.task.findFirst({
    where: { id: taskId, projectId },
    include: {
      ...TASK_INCLUDE,
      subtasks: { include: TASK_INCLUDE, orderBy: { sortOrder: 'asc' } },
      comments: { include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } },
    },
  });
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json({ task });
}) as RequestHandler);

// ── POST / — create a task (or subtask, if parentTaskId is given) ─────────

router.post('/', requireWrite as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const parsed = CreateTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }
  const { taskListId, parentTaskId, title, description, priority, assigneeUserId, assigneeExternalName, startDate, dueDate, tags } = parsed.data;

  const list = await prisma.taskList.findFirst({ where: { id: taskListId, projectId } });
  if (!list) return res.status(400).json({ error: 'That task list does not belong to this project' });

  if (parentTaskId) {
    const parent = await prisma.task.findFirst({ where: { id: parentTaskId, projectId } });
    if (!parent) return res.status(400).json({ error: 'Parent task does not belong to this project' });
  }

  let assigneeId: string | null = null;
  if (assigneeExternalName) {
    // An external name skips ProjectMember resolution entirely — see
    // resolveAssigneeId below for the registered-user path.
  } else {
    const resolved = await resolveAssigneeId(projectId, assigneeUserId);
    if (!resolved.ok) return res.status(400).json({ error: 'That user is not a member of this project' });
    assigneeId = resolved.assigneeId;
  }

  const last = await prisma.task.findFirst({ where: { projectId, taskListId }, orderBy: { sortOrder: 'desc' } });

  const task = await prisma.task.create({
    data: {
      projectId,
      taskListId,
      parentTaskId: parentTaskId ?? null,
      title,
      description,
      priority: priority ?? 'NORMAL',
      assigneeId,
      assigneeExternalName: assigneeExternalName ?? null,
      startDate: startDate ?? null,
      dueDate: dueDate ?? null,
      tags: JSON.stringify(tags ?? []),
      sortOrder: (last?.sortOrder ?? -1) + 1,
      createdByUserId: req.user.id,
    },
    include: TASK_INCLUDE,
  });
  res.status(201).json({ task });
}) as RequestHandler);

// ── PUT /:taskId — edit title/description/priority/dates/tags/list ────────

router.put('/:taskId', requireWrite as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const { taskId } = req.params;
  const parsed = UpdateTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }

  const existing = await prisma.task.findFirst({ where: { id: taskId, projectId } });
  if (!existing) return res.status(404).json({ error: 'Task not found' });

  const { tags, taskListId, ...rest } = parsed.data;
  if (taskListId) {
    const list = await prisma.taskList.findFirst({ where: { id: taskListId, projectId } });
    if (!list) return res.status(400).json({ error: 'That task list does not belong to this project' });
  }

  const task = await prisma.task.update({
    where: { id: taskId },
    data: {
      ...rest,
      ...(taskListId ? { taskListId } : {}),
      ...(tags !== undefined ? { tags: JSON.stringify(tags) } : {}),
    },
    include: TASK_INCLUDE,
  });
  res.json({ task });
}) as RequestHandler);

// ── PATCH /:taskId/status — move between TO_DO/IN_PROGRESS/IN_REVIEW/DONE ──

router.patch('/:taskId/status', requireWrite as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const { taskId } = req.params;
  const parsed = UpdateStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }

  const existing = await prisma.task.findFirst({ where: { id: taskId, projectId } });
  if (!existing) return res.status(404).json({ error: 'Task not found' });

  const task = await prisma.task.update({
    where: { id: taskId },
    data: {
      status: parsed.data.status,
      completedAt: parsed.data.status === 'DONE' ? new Date() : null,
    },
    include: TASK_INCLUDE,
  });
  res.json({ task });
}) as RequestHandler);

// ── PATCH /:taskId/assign — assign/unassign a project member, or hand the
// task to someone outside the tool via assigneeExternalName ───────────────

router.patch('/:taskId/assign', requireWrite as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const { taskId } = req.params;
  const parsed = AssignTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }
  const { assigneeUserId, assigneeExternalName } = parsed.data;

  const existing = await prisma.task.findFirst({ where: { id: taskId, projectId } });
  if (!existing) return res.status(404).json({ error: 'Task not found' });

  // TEST_USER may only assign tasks to themselves — never to a peer, and
  // never to an external name either. Global SUPER_ADMIN/ADMIN and project
  // ADMIN/SUPER_USER are unaffected.
  const isTestUser = req.projectMember?.role === 'TEST_USER'
    && req.user.globalRole !== 'SUPER_ADMIN' && req.user.globalRole !== 'ADMIN';
  if (isTestUser && ((assigneeUserId && assigneeUserId !== req.user.id) || assigneeExternalName)) {
    return res.status(403).json({ error: 'You can only assign tasks to yourself' });
  }

  let assigneeId: string | null = null;
  if (!assigneeExternalName) {
    const resolved = await resolveAssigneeId(projectId, assigneeUserId);
    if (!resolved.ok) return res.status(400).json({ error: 'That user is not a member of this project' });
    assigneeId = resolved.assigneeId;
  }

  const task = await prisma.task.update({
    where: { id: taskId },
    data: { assigneeId, assigneeExternalName: assigneeExternalName ?? null },
    include: TASK_INCLUDE,
  });
  res.json({ task });
}) as RequestHandler);

// ── DELETE /:taskId — delete a task (cascades its subtasks + comments) ────

router.delete('/:taskId', requireWrite as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const { taskId } = req.params;
  const existing = await prisma.task.findFirst({ where: { id: taskId, projectId } });
  if (!existing) return res.status(404).json({ error: 'Task not found' });

  await prisma.task.delete({ where: { id: taskId } });
  res.json({ message: 'Task deleted' });
}) as RequestHandler);

// ── Comments ────────────────────────────────────────────────────────────

router.post('/:taskId/comments', requireWrite as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const { taskId } = req.params;
  const parsed = CreateCommentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }

  const task = await prisma.task.findFirst({ where: { id: taskId, projectId } });
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const comment = await prisma.taskComment.create({
    data: { taskId, userId: req.user.id, body: parsed.data.body },
    include: { user: { select: { id: true, name: true } } },
  });
  res.status(201).json({ comment });
}) as RequestHandler);

router.patch('/:taskId/comments/:commentId', requireWrite as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const { taskId, commentId } = req.params;
  const parsed = UpdateCommentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }

  const comment = await prisma.taskComment.findFirst({
    where: { id: commentId, taskId, task: { projectId } },
  });
  if (!comment) return res.status(404).json({ error: 'Comment not found' });

  // Only the author may edit — unlike delete, admins don't get to rewrite someone else's words.
  if (comment.userId !== req.user.id) {
    return res.status(403).json({ error: 'Only the comment author may edit this comment' });
  }

  const updated = await prisma.taskComment.update({
    where: { id: commentId },
    data: { body: parsed.data.body, editedAt: new Date() },
    include: { user: { select: { id: true, name: true } } },
  });
  res.json({ comment: updated });
}) as RequestHandler);

router.delete('/:taskId/comments/:commentId', requireWrite as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const { taskId, commentId } = req.params;

  const comment = await prisma.taskComment.findFirst({
    where: { id: commentId, taskId, task: { projectId } },
  });
  if (!comment) return res.status(404).json({ error: 'Comment not found' });

  const isPrivileged =
    req.user.globalRole === 'SUPER_ADMIN' ||
    req.user.globalRole === 'ADMIN' ||
    req.projectMember?.role === 'ADMIN' ||
    req.projectMember?.role === 'SUPER_USER';
  if (!isPrivileged && comment.userId !== req.user.id) {
    return res.status(403).json({ error: 'Only the comment author or a project admin may delete this comment' });
  }

  await prisma.taskComment.delete({ where: { id: commentId } });
  res.json({ message: 'Comment deleted' });
}) as RequestHandler);

export default router;
