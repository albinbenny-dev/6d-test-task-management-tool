import { Router, RequestHandler } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import { requireAdvancedFeatures } from '../middleware/rbac.js';

// ── Payment Milestones ──────────────────────────────────────────────────────
// A PM-curated list of a project's key contractual milestones, used to flag
// upcoming/overdue delivery dates and schedule slip against baseline. Open to
// every project role for reading (it's a dashboard signal the whole team
// should see); administering the list (create/edit/reorder/delete) is
// restricted to ADMIN/SUPER_USER, same tier as Test Cycle administration —
// this is PM/lead-owned data, not everyday task tracking. Deliberately never
// stores amounts or invoice values — see schema.prisma's Milestone comment.

const CreateMilestoneSchema = z.object({
  name:            z.string().min(1).max(200),
  groupName:       z.string().max(100).optional().nullable(),
  baselineDate:    z.string().datetime().optional().nullable(),
  targetDate:      z.string().datetime().optional().nullable(),
  actualDate:      z.string().datetime().optional().nullable(),
  isPaymentLinked: z.boolean().optional(),
  invoiceRaised:   z.boolean().optional(),
  notes:           z.string().max(2000).optional().nullable(),
});

const UpdateMilestoneSchema = z.object({
  name:            z.string().min(1).max(200).optional(),
  groupName:       z.string().max(100).optional().nullable(),
  baselineDate:    z.string().datetime().optional().nullable(),
  targetDate:      z.string().datetime().optional().nullable(),
  actualDate:      z.string().datetime().optional().nullable(),
  isCompleted:     z.boolean().optional(),
  isPaymentLinked: z.boolean().optional(),
  invoiceRaised:   z.boolean().optional(),
  notes:           z.string().max(2000).optional().nullable(),
});

const ReorderMilestonesSchema = z.object({
  orderedIds: z.array(z.string()).min(1),
});

const router = Router({ mergeParams: true });
router.use(verifyToken as RequestHandler);
router.use(requireProjectAccess as unknown as RequestHandler);

// ── GET / — list every milestone in the project ────────────────────────────

router.get('/', (async (req, res) => {
  const projectId = req.project.id;
  const milestones = await prisma.milestone.findMany({
    where: { projectId },
    orderBy: { sortOrder: 'asc' },
  });
  res.json({ milestones });
}) as RequestHandler);

// ── POST / — create a milestone ─────────────────────────────────────────────

router.post('/', requireAdvancedFeatures as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const parsed = CreateMilestoneSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }
  const { name, groupName, baselineDate, targetDate, actualDate, isPaymentLinked, invoiceRaised, notes } = parsed.data;

  const last = await prisma.milestone.findFirst({ where: { projectId }, orderBy: { sortOrder: 'desc' } });
  const milestone = await prisma.milestone.create({
    data: {
      projectId,
      name,
      groupName: groupName ?? null,
      baselineDate: baselineDate ?? null,
      targetDate: targetDate ?? null,
      actualDate: actualDate ?? null,
      isCompleted: !!actualDate,
      isPaymentLinked: isPaymentLinked ?? false,
      invoiceRaised: invoiceRaised ?? false,
      notes: notes ?? null,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  });
  res.status(201).json({ milestone });
}) as RequestHandler);

// ── PATCH /reorder — bulk-persist drag-reordered milestone order ──────────
// Registered ahead of PUT /:milestoneId so "/reorder" isn't swallowed as a literal id.

router.patch('/reorder', requireAdvancedFeatures as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const parsed = ReorderMilestonesSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }

  const milestones = await prisma.milestone.findMany({ where: { projectId, id: { in: parsed.data.orderedIds } } });
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

  const { actualDate, isCompleted, ...rest } = parsed.data;
  const milestone = await prisma.milestone.update({
    where: { id: milestoneId },
    data: {
      ...rest,
      ...(actualDate !== undefined ? { actualDate } : {}),
      isCompleted: isCompleted !== undefined ? isCompleted : (actualDate !== undefined ? !!actualDate : undefined),
    },
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
