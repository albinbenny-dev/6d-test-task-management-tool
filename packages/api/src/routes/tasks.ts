import { Router, RequestHandler } from 'express';
import { z } from 'zod';
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
  taskListId:     z.string().min(1),
  parentTaskId:   z.string().min(1).optional(),
  title:          z.string().min(1).max(300),
  description:    z.string().max(10000).optional(),
  priority:       z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
  assigneeUserId: z.string().min(1).optional(),
  startDate:      z.string().datetime().optional().nullable(),
  dueDate:        z.string().datetime().optional().nullable(),
  tags:           z.array(z.string().min(1).max(40)).optional(),
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
  assigneeUserId: z.string().nullable(),
});

const ReorderTasksSchema = z.object({
  taskListId: z.string().min(1),
  orderedIds: z.array(z.string()).min(1),
});

const CreateCommentSchema = z.object({
  body: z.string().min(1).max(5000),
});

const ListQuerySchema = z.object({
  taskListId: z.string().optional(),
  status:     z.enum(['TO_DO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']).optional(),
  assigneeId: z.string().optional(),
});

const router = Router({ mergeParams: true });
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

// ── GET /dashboard/summary — status/assignee counts, overdue, this week ───

router.get('/dashboard/summary', (async (req, res) => {
  const projectId = req.project.id;
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);

  const [statusGroups, allOpenTasks, completedThisWeek, overdueTasks] = await Promise.all([
    prisma.task.groupBy({ by: ['status'], where: { projectId }, _count: { _all: true } }),
    prisma.task.findMany({
      where: { projectId, status: { not: 'DONE' } },
      select: { id: true, assigneeId: true, dueDate: true },
    }),
    prisma.task.count({ where: { projectId, status: 'DONE', completedAt: { gte: weekAgo } } }),
    prisma.task.findMany({
      where: { projectId, status: { not: 'DONE' }, dueDate: { lt: now } },
      include: TASK_INCLUDE,
      orderBy: { dueDate: 'asc' },
      take: 25,
    }),
  ]);

  const counts = { TO_DO: 0, IN_PROGRESS: 0, IN_REVIEW: 0, DONE: 0 } as Record<string, number>;
  for (const g of statusGroups) counts[g.status] = g._count._all;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  const assigneeIds = [...new Set(allOpenTasks.map((t) => t.assigneeId).filter((id): id is string => !!id))];
  const members = assigneeIds.length
    ? await prisma.projectMember.findMany({ where: { id: { in: assigneeIds } }, include: { user: { select: { name: true } } } })
    : [];
  const nameById = new Map(members.map((m) => [m.id, m.user.name]));

  const byAssigneeMap = new Map<string, { assigneeId: string | null; assigneeName: string; total: number; overdue: number }>();
  for (const t of allOpenTasks) {
    const key = t.assigneeId ?? 'unassigned';
    if (!byAssigneeMap.has(key)) {
      byAssigneeMap.set(key, {
        assigneeId: t.assigneeId,
        assigneeName: t.assigneeId ? (nameById.get(t.assigneeId) ?? 'Unknown') : 'Unassigned',
        total: 0,
        overdue: 0,
      });
    }
    const row = byAssigneeMap.get(key)!;
    row.total += 1;
    if (t.dueDate && t.dueDate < now) row.overdue += 1;
  }

  res.json({
    counts,
    total,
    completedThisWeek,
    overdueCount: overdueTasks.length,
    overdueTasks,
    byAssignee: [...byAssigneeMap.values()].sort((a, b) => b.total - a.total),
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
  const { taskListId, parentTaskId, title, description, priority, assigneeUserId, startDate, dueDate, tags } = parsed.data;

  const list = await prisma.taskList.findFirst({ where: { id: taskListId, projectId } });
  if (!list) return res.status(400).json({ error: 'That task list does not belong to this project' });

  if (parentTaskId) {
    const parent = await prisma.task.findFirst({ where: { id: parentTaskId, projectId } });
    if (!parent) return res.status(400).json({ error: 'Parent task does not belong to this project' });
  }

  const resolved = await resolveAssigneeId(projectId, assigneeUserId);
  if (!resolved.ok) return res.status(400).json({ error: 'That user is not a member of this project' });

  const last = await prisma.task.findFirst({ where: { projectId, taskListId }, orderBy: { sortOrder: 'desc' } });

  const task = await prisma.task.create({
    data: {
      projectId,
      taskListId,
      parentTaskId: parentTaskId ?? null,
      title,
      description,
      priority: priority ?? 'NORMAL',
      assigneeId: resolved.assigneeId,
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

// ── PATCH /:taskId/assign — assign/unassign a project member ──────────────

router.patch('/:taskId/assign', requireWrite as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const { taskId } = req.params;
  const parsed = AssignTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }

  const existing = await prisma.task.findFirst({ where: { id: taskId, projectId } });
  if (!existing) return res.status(404).json({ error: 'Task not found' });

  // TEST_USER may only assign tasks to themselves — never to a peer. Global
  // SUPER_ADMIN/ADMIN and project ADMIN/SUPER_USER are unaffected.
  const isTestUser = req.projectMember?.role === 'TEST_USER'
    && req.user.globalRole !== 'SUPER_ADMIN' && req.user.globalRole !== 'ADMIN';
  if (isTestUser && parsed.data.assigneeUserId && parsed.data.assigneeUserId !== req.user.id) {
    return res.status(403).json({ error: 'You can only assign tasks to yourself' });
  }

  const resolved = await resolveAssigneeId(projectId, parsed.data.assigneeUserId);
  if (!resolved.ok) return res.status(400).json({ error: 'That user is not a member of this project' });

  const task = await prisma.task.update({
    where: { id: taskId },
    data: { assigneeId: resolved.assigneeId },
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
