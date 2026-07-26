import { Router, RequestHandler } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import { requireAdvancedFeatures, requireWrite } from '../middleware/rbac.js';

// ── Task Management — Task Lists ────────────────────────────────────────────
// A TaskList is a project's task "bucket" (ClickUp calls these Lists) — e.g.
// "Action Tracker", "Migration", "Reporting". Open to every project role for
// reading; creating/renaming a list requires write access, but deleting one
// (which cascades every task inside it) is restricted to ADMIN/SUPER_USER to
// guard against an accidental bulk wipe.

const CreateTaskListSchema = z.object({
  name:  z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

const UpdateTaskListSchema = z.object({
  name:  z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

const ReorderTaskListsSchema = z.object({
  orderedIds: z.array(z.string()).min(1),
});

const router = Router({ mergeParams: true });
router.use(verifyToken as RequestHandler);
router.use(requireProjectAccess as unknown as RequestHandler);

// ── GET / — list every task list in the project, with task counts ─────────

router.get('/', (async (req, res) => {
  const projectId = req.project.id;
  const lists = await prisma.taskList.findMany({
    where: { projectId },
    include: { _count: { select: { tasks: true } } },
    orderBy: { sortOrder: 'asc' },
  });
  res.json({ lists });
}) as RequestHandler);

// ── POST / — create a task list ─────────────────────────────────────────────

router.post('/', requireWrite as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const parsed = CreateTaskListSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }

  const existing = await prisma.taskList.findFirst({ where: { projectId }, orderBy: { sortOrder: 'desc' } });
  const list = await prisma.taskList.create({
    data: {
      projectId,
      name: parsed.data.name,
      color: parsed.data.color ?? '#2563AB',
      sortOrder: (existing?.sortOrder ?? -1) + 1,
    },
  });
  res.status(201).json({ list });
}) as RequestHandler);

// ── PATCH /reorder — bulk-persist drag-reordered list order ────────────────
// Registered ahead of PUT /:listId so "/reorder" isn't swallowed as a literal id.

router.patch('/reorder', requireWrite as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const parsed = ReorderTaskListsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }

  const lists = await prisma.taskList.findMany({ where: { projectId, id: { in: parsed.data.orderedIds } } });
  const validIds = new Set(lists.map((l) => l.id));

  await prisma.$transaction(
    parsed.data.orderedIds
      .filter((id) => validIds.has(id))
      .map((id, i) => prisma.taskList.update({ where: { id }, data: { sortOrder: i } })),
  );
  res.json({ message: 'Reordered' });
}) as RequestHandler);

// ── PUT /:listId — rename / recolor ─────────────────────────────────────────

router.put('/:listId', requireWrite as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const { listId } = req.params;
  const parsed = UpdateTaskListSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }

  const existing = await prisma.taskList.findFirst({ where: { id: listId, projectId } });
  if (!existing) return res.status(404).json({ error: 'Task list not found' });

  const list = await prisma.taskList.update({ where: { id: listId }, data: parsed.data });
  res.json({ list });
}) as RequestHandler);

// ── DELETE /:listId — remove a list and every task inside it ──────────────

router.delete('/:listId', requireAdvancedFeatures as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const { listId } = req.params;
  const existing = await prisma.taskList.findFirst({ where: { id: listId, projectId } });
  if (!existing) return res.status(404).json({ error: 'Task list not found' });

  await prisma.taskList.delete({ where: { id: listId } });
  res.json({ message: 'Task list deleted' });
}) as RequestHandler);

export default router;
