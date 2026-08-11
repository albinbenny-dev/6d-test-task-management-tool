import { Router, RequestHandler } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import { requireAdvancedFeatures } from '../middleware/rbac.js';

// ── Payment Milestones ──────────────────────────────────────────────────────
// A PM-curated list of a project's key contractual milestones, used to flag
// upcoming/overdue delivery dates and schedule slip against baseline. Every
// milestone belongs to exactly one MilestoneList (see milestoneLists.ts) —
// a project can carry several side by side (e.g. "Project Milestones", "CR
// Milestones", "MS Milestones"). Open to every project role for reading
// (it's a dashboard signal the whole team should see); administering rows is
// restricted to ADMIN/SUPER_USER, same tier as Test Cycle administration —
// this is PM/lead-owned data, not everyday task tracking. Deliberately never
// stores amounts or invoice values — see schema.prisma's Milestone comment.

const MILESTONE_INCLUDE = {
  milestoneList: { select: { id: true, name: true, color: true } },
} as const;

const CreateMilestoneSchema = z.object({
  milestoneListId: z.string().min(1),
  name:            z.string().min(1).max(200),
  baselineDate:    z.string().datetime().optional().nullable(),
  targetDate:      z.string().datetime().optional().nullable(),
  actualDate:      z.string().datetime().optional().nullable(),
  isPaymentLinked: z.boolean().optional(),
  invoiceRaised:   z.boolean().optional(),
  notes:           z.string().max(2000).optional().nullable(),
});

const UpdateMilestoneSchema = z.object({
  name:            z.string().min(1).max(200).optional(),
  milestoneListId: z.string().min(1).optional(), // moves the row to a different list in the same project
  baselineDate:    z.string().datetime().optional().nullable(),
  targetDate:      z.string().datetime().optional().nullable(),
  actualDate:      z.string().datetime().optional().nullable(),
  isCompleted:     z.boolean().optional(),
  isPaymentLinked: z.boolean().optional(),
  invoiceRaised:   z.boolean().optional(),
  notes:           z.string().max(2000).optional().nullable(),
});

const ReorderMilestonesSchema = z.object({
  milestoneListId: z.string().min(1),
  orderedIds:      z.array(z.string()).min(1),
});

const ListQuerySchema = z.object({
  milestoneListId: z.string().optional(),
});

const router = Router({ mergeParams: true });
router.use(verifyToken as RequestHandler);
router.use(requireProjectAccess as unknown as RequestHandler);

// ── GET / — list milestones in the project, optionally filtered to one list
// (dashboards/portfolio omit the filter to aggregate across every list). ──

router.get('/', (async (req, res) => {
  const projectId = req.project.id;
  const parsed = ListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }

  const milestones = await prisma.milestone.findMany({
    where: { projectId, ...(parsed.data.milestoneListId ? { milestoneListId: parsed.data.milestoneListId } : {}) },
    include: MILESTONE_INCLUDE,
    orderBy: { sortOrder: 'asc' },
  });
  res.json({ milestones });
}) as RequestHandler);

// ── POST / — create a milestone in a given list ─────────────────────────────

router.post('/', requireAdvancedFeatures as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const parsed = CreateMilestoneSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }
  const { milestoneListId, name, baselineDate, targetDate, actualDate, isPaymentLinked, invoiceRaised, notes } = parsed.data;

  const list = await prisma.milestoneList.findFirst({ where: { id: milestoneListId, projectId } });
  if (!list) return res.status(400).json({ error: 'That milestone list does not belong to this project' });

  const last = await prisma.milestone.findFirst({ where: { projectId, milestoneListId }, orderBy: { sortOrder: 'desc' } });
  const milestone = await prisma.milestone.create({
    data: {
      projectId,
      milestoneListId,
      name,
      baselineDate: baselineDate ?? null,
      targetDate: targetDate ?? null,
      actualDate: actualDate ?? null,
      isCompleted: !!actualDate,
      isPaymentLinked: isPaymentLinked ?? false,
      invoiceRaised: invoiceRaised ?? false,
      notes: notes ?? null,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
    include: MILESTONE_INCLUDE,
  });
  res.status(201).json({ milestone });
}) as RequestHandler);

// ── PATCH /reorder — bulk-persist drag-reordered milestone order within a
// list. Registered ahead of PUT /:milestoneId so "/reorder" isn't swallowed
// as a literal id. ──────────────────────────────────────────────────────────

router.patch('/reorder', requireAdvancedFeatures as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const parsed = ReorderMilestonesSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }

  const milestones = await prisma.milestone.findMany({
    where: { projectId, milestoneListId: parsed.data.milestoneListId, id: { in: parsed.data.orderedIds } },
  });
  const validIds = new Set(milestones.map((m) => m.id));

  await prisma.$transaction(
    parsed.data.orderedIds
      .filter((id) => validIds.has(id))
      .map((id, i) => prisma.milestone.update({ where: { id }, data: { sortOrder: i } })),
  );
  res.json({ message: 'Reordered' });
}) as RequestHandler);

// ── PUT /:milestoneId — edit a milestone ────────────────────────────────────
// isCompleted defaults to following actualDate (set/cleared) unless the
// caller explicitly overrides it — mirrors Task's completedAt-follows-status
// convention, but a milestone may also be marked done without a captured
// actual date, so isCompleted stays independently settable.

router.put('/:milestoneId', requireAdvancedFeatures as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const { milestoneId } = req.params;
  const parsed = UpdateMilestoneSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }

  const existing = await prisma.milestone.findFirst({ where: { id: milestoneId, projectId } });
  if (!existing) return res.status(404).json({ error: 'Milestone not found' });

  const { actualDate, isCompleted, milestoneListId, ...rest } = parsed.data;
  if (milestoneListId) {
    const list = await prisma.milestoneList.findFirst({ where: { id: milestoneListId, projectId } });
    if (!list) return res.status(400).json({ error: 'That milestone list does not belong to this project' });
  }

  const milestone = await prisma.milestone.update({
    where: { id: milestoneId },
    data: {
      ...rest,
      ...(milestoneListId ? { milestoneListId } : {}),
      ...(actualDate !== undefined ? { actualDate } : {}),
      isCompleted: isCompleted !== undefined ? isCompleted : (actualDate !== undefined ? !!actualDate : undefined),
    },
    include: MILESTONE_INCLUDE,
  });
  res.json({ milestone });
}) as RequestHandler);

// ── DELETE /:milestoneId — remove a milestone ──────────────────────────────

router.delete('/:milestoneId', requireAdvancedFeatures as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const { milestoneId } = req.params;
  const existing = await prisma.milestone.findFirst({ where: { id: milestoneId, projectId } });
  if (!existing) return res.status(404).json({ error: 'Milestone not found' });

  await prisma.milestone.delete({ where: { id: milestoneId } });
  res.json({ message: 'Milestone deleted' });
}) as RequestHandler);

export default router;
