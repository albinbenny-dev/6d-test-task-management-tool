import { Router, RequestHandler } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import { requireAdvancedFeatures } from '../middleware/rbac.js';

// ── Payment Milestones — Milestone Lists ────────────────────────────────────
// A project can carry several distinct milestone lists side by side (e.g.
// "Project Milestones", "CR Milestones", "MS Milestones") — mirrors
// taskLists.ts exactly. Open to every project role for reading; administering
// the list itself (create/rename/reorder/delete) is restricted to
// ADMIN/SUPER_USER, same tier as the Milestone rows inside it (see
// milestones.ts) — this is PM/lead-owned data, not everyday task tracking.

const CreateMilestoneListSchema = z.object({
  name:  z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

const UpdateMilestoneListSchema = z.object({
  name:  z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

const ReorderMilestoneListsSchema = z.object({
  orderedIds: z.array(z.string()).min(1),
});

const router = Router({ mergeParams: true });
router.use(verifyToken as RequestHandler);
router.use(requireProjectAccess as unknown as RequestHandler);

// ── GET / — list every milestone list in the project, with row counts ─────

router.get('/', (async (req, res) => {
  const projectId = req.project.id;
  const lists = await prisma.milestoneList.findMany({
    where: { projectId },
    include: { _count: { select: { milestones: true } } },
    orderBy: { sortOrder: 'asc' },
  });
  res.json({ lists });
}) as RequestHandler);

// ── POST / — create a milestone list ────────────────────────────────────────

router.post('/', requireAdvancedFeatures as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const parsed = CreateMilestoneListSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }

  const existing = await prisma.milestoneList.findFirst({ where: { projectId }, orderBy: { sortOrder: 'desc' } });
  const list = await prisma.milestoneList.create({
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

router.patch('/reorder', requireAdvancedFeatures as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const parsed = ReorderMilestoneListsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }

  const lists = await prisma.milestoneList.findMany({ where: { projectId, id: { in: parsed.data.orderedIds } } });
  const validIds = new Set(lists.map((l) => l.id));

  await prisma.$transaction(
    parsed.data.orderedIds
      .filter((id) => validIds.has(id))
      .map((id, i) => prisma.milestoneList.update({ where: { id }, data: { sortOrder: i } })),
  );
  res.json({ message: 'Reordered' });
}) as RequestHandler);

// ── PUT /:listId — rename / recolor ─────────────────────────────────────────

router.put('/:listId', requireAdvancedFeatures as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const { listId } = req.params;
  const parsed = UpdateMilestoneListSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }

  const existing = await prisma.milestoneList.findFirst({ where: { id: listId, projectId } });
  if (!existing) return res.status(404).json({ error: 'Milestone list not found' });

  const list = await prisma.milestoneList.update({ where: { id: listId }, data: parsed.data });
  res.json({ list });
}) as RequestHandler);

// ── DELETE /:listId — remove a list and every milestone inside it ─────────

router.delete('/:listId', requireAdvancedFeatures as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const { listId } = req.params;
  const existing = await prisma.milestoneList.findFirst({ where: { id: listId, projectId } });
  if (!existing) return res.status(404).json({ error: 'Milestone list not found' });

  await prisma.milestoneList.delete({ where: { id: listId } });
  res.json({ message: 'Milestone list deleted' });
}) as RequestHandler);

export default router;
