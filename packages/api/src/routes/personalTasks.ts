import { Router, RequestHandler } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';

// ── Personal Tasks — a private, per-user to-do tracker ───────────────────────
// Deliberately NOT project-scoped (mounted at /api/personal-tasks, not under
// /projects/:projectId/...) — this is a resource's own checklist, invisible to
// every other project member. A SUPER_ADMIN may look at another user's list
// (oversight) via ?userId=, but can never create/edit/delete on someone
// else's behalf — ownership is always the acting user's own id for writes.

const router = Router();
router.use(verifyToken as RequestHandler);

const CreateSchema = z.object({
  title:    z.string().min(1).max(300),
  notes:    z.string().max(5000).optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
  dueDate:  z.string().datetime().optional().nullable(),
});

const UpdateSchema = z.object({
  title:    z.string().min(1).max(300).optional(),
  notes:    z.string().max(5000).optional().nullable(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
  dueDate:  z.string().datetime().optional().nullable(),
  done:     z.boolean().optional(),
});

const ListQuerySchema = z.object({
  userId: z.string().optional(),
});

// ── GET / — the caller's own personal tasks, or (SUPER_ADMIN only) another
// user's, via ?userId= ────────────────────────────────────────────────────
router.get('/', (async (req, res) => {
  const parsed = ListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }

  const requestedUserId = parsed.data.userId;
  let targetUserId = req.user.id;
  if (requestedUserId && requestedUserId !== req.user.id) {
    if (req.user.globalRole !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Only a SUPER_ADMIN may view another user\'s personal tasks' });
    }
    targetUserId = requestedUserId;
  }

  const tasks = await prisma.personalTask.findMany({
    where: { userId: targetUserId },
    orderBy: [{ done: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }],
  });

  res.json({ userId: targetUserId, tasks });
}) as RequestHandler);

// ── POST / — create a personal task (always owned by the caller) ─────────
router.post('/', (async (req, res) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }
  const { title, notes, priority, dueDate } = parsed.data;

  const task = await prisma.personalTask.create({
    data: {
      userId: req.user.id,
      title,
      notes,
      priority: priority ?? 'NORMAL',
      dueDate: dueDate ? new Date(dueDate) : null,
    },
  });

  res.status(201).json({ task });
}) as RequestHandler);

// ── PATCH /:id — update/complete a personal task (owner only) ────────────
router.patch('/:id', (async (req, res) => {
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }

  const existing = await prisma.personalTask.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.userId !== req.user.id) {
    return res.status(404).json({ error: 'Personal task not found' });
  }

  const { title, notes, priority, dueDate, done } = parsed.data;
  const task = await prisma.personalTask.update({
    where: { id: req.params.id },
    data: {
      ...(title !== undefined && { title }),
      ...(notes !== undefined && { notes }),
      ...(priority !== undefined && { priority }),
      ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
      ...(done !== undefined && { done, completedAt: done ? new Date() : null }),
    },
  });

  res.json({ task });
}) as RequestHandler);

// ── DELETE /:id — remove a personal task (owner only) ─────────────────────
router.delete('/:id', (async (req, res) => {
  const existing = await prisma.personalTask.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.userId !== req.user.id) {
    return res.status(404).json({ error: 'Personal task not found' });
  }

  await prisma.personalTask.delete({ where: { id: req.params.id } });
  res.status(204).send();
}) as RequestHandler);

export default router;
