import { Router, RequestHandler } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import { requireAdmin } from '../middleware/rbac.js';
import { NOTIFICATION_TRIGGERS, parseNotificationSettings } from '../lib/notificationSettings.js';

// ── Per-project email notification settings ─────────────────────────────────
// Project ADMIN only (same gate as the Jira config) — one master switch plus
// one switch per trigger. The server-wide SMTP/TASK_NOTIFY_ENABLED setup is
// ops-managed and only reported here, never changed.

const UpdateNotificationSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  ...Object.fromEntries(NOTIFICATION_TRIGGERS.map((k) => [k, z.boolean().optional()])),
}).strict();

const router = Router({ mergeParams: true });
router.use(verifyToken as RequestHandler);
router.use(requireProjectAccess as unknown as RequestHandler);

function serverEmailConfigured(): boolean {
  return !!process.env.SMTP_HOST && process.env.TASK_NOTIFY_ENABLED !== 'false';
}

// ── GET / — current settings (missing keys filled with defaults) ──────────

router.get('/', requireAdmin as RequestHandler, (async (req, res) => {
  const project = await prisma.project.findUnique({ where: { id: req.project.id }, select: { notificationSettings: true } });
  res.json({
    settings: parseNotificationSettings(project?.notificationSettings),
    serverEmailConfigured: serverEmailConfigured(),
  });
}) as RequestHandler);

// ── PUT / — merge the given switches into the stored settings ─────────────

router.put('/', requireAdmin as RequestHandler, (async (req, res) => {
  const parsed = UpdateNotificationSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }
  const project = await prisma.project.findUnique({ where: { id: req.project.id }, select: { notificationSettings: true } });
  const settings = { ...parseNotificationSettings(project?.notificationSettings), ...parsed.data };
  await prisma.project.update({
    where: { id: req.project.id },
    data: { notificationSettings: JSON.stringify(settings) },
  });
  return res.json({ settings, serverEmailConfigured: serverEmailConfigured() });
}) as RequestHandler);

export default router;
