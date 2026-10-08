import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { TemplateConfigSchema, parseConfig, builtInDefault } from '../lib/timelineTemplateConfig.js';

// ── Timeline Builder — platform-level templates ─────────────────────────────
// Read: every signed-in user (non-SUPER_ADMIN only sees active ones, so a
// template can be retired without breaking timelines that already use it —
// those keep resolving it by id through GET /projects/:id/timelines/:id).
// Write: SUPER_ADMIN only.

const router = Router();
router.use(verifyToken as RequestHandler);

function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user.globalRole !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'SUPER_ADMIN role is required for this action' });
    return;
  }
  next();
}

const CreateTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional().nullable(),
  category: z.string().min(1).max(50).optional(),
  isActive: z.boolean().optional(),
  config: TemplateConfigSchema,
});

const UpdateTemplateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  category: z.string().min(1).max(50).optional(),
  isActive: z.boolean().optional(),
  config: TemplateConfigSchema.optional(),
});

function serialize(t: {
  id: string; name: string; description: string | null; category: string; builtInKey: string | null;
  isActive: boolean; sortOrder: number; config: string; createdAt: Date; updatedAt: Date;
}) {
  return {
    id: t.id, name: t.name, description: t.description, category: t.category,
    isBuiltIn: t.builtInKey !== null, builtInKey: t.builtInKey,
    isActive: t.isActive, sortOrder: t.sortOrder,
    config: parseConfig(t.config),
    createdAt: t.createdAt, updatedAt: t.updatedAt,
  };
}

router.get('/', (async (req, res) => {
  const isSuper = req.user.globalRole === 'SUPER_ADMIN';
  const templates = await prisma.timelineTemplate.findMany({
    where: isSuper ? {} : { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  res.json({ templates: templates.map(serialize) });
}) as RequestHandler);

router.post('/', requireSuperAdmin as RequestHandler, (async (req, res) => {
  const parsed = CreateTemplateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });

  const last = await prisma.timelineTemplate.findFirst({ orderBy: { sortOrder: 'desc' } });
  const t = await prisma.timelineTemplate.create({
    data: {
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      category: parsed.data.category ?? 'Custom',
      isActive: parsed.data.isActive ?? true,
      sortOrder: (last?.sortOrder ?? -1) + 1,
      config: JSON.stringify(parsed.data.config),
      createdByUserId: req.user.id,
    },
  });
  res.status(201).json({ template: serialize(t) });
}) as RequestHandler);

router.put('/:templateId', requireSuperAdmin as RequestHandler, (async (req, res) => {
  const parsed = UpdateTemplateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });

  const existing = await prisma.timelineTemplate.findUnique({ where: { id: req.params.templateId } });
  if (!existing) return res.status(404).json({ error: 'Template not found' });

  const { config, ...rest } = parsed.data;
  const t = await prisma.timelineTemplate.update({
    where: { id: existing.id },
    data: { ...rest, ...(config ? { config: JSON.stringify(config) } : {}) },
  });
  res.json({ template: serialize(t) });
}) as RequestHandler);

// Duplicate — always produces an editable, non-built-in copy (also how an
// admin "forks" a built-in before heavily changing it).
router.post('/:templateId/duplicate', requireSuperAdmin as RequestHandler, (async (req, res) => {
  const existing = await prisma.timelineTemplate.findUnique({ where: { id: req.params.templateId } });
  if (!existing) return res.status(404).json({ error: 'Template not found' });

  const last = await prisma.timelineTemplate.findFirst({ orderBy: { sortOrder: 'desc' } });
  const t = await prisma.timelineTemplate.create({
    data: {
      name: `${existing.name} (copy)`.slice(0, 100),
      description: existing.description,
      category: existing.builtInKey ? 'Custom' : existing.category,
      isActive: true,
      sortOrder: (last?.sortOrder ?? -1) + 1,
      config: existing.config,
      createdByUserId: req.user.id,
    },
  });
  res.status(201).json({ template: serialize(t) });
}) as RequestHandler);

// Restore a built-in to its shipped definition (name/description/config).
router.post('/:templateId/reset', requireSuperAdmin as RequestHandler, (async (req, res) => {
  const existing = await prisma.timelineTemplate.findUnique({ where: { id: req.params.templateId } });
  if (!existing) return res.status(404).json({ error: 'Template not found' });
  const def = existing.builtInKey ? builtInDefault(existing.builtInKey) : undefined;
  if (!def) return res.status(400).json({ error: 'Only built-in templates can be reset' });

  const t = await prisma.timelineTemplate.update({
    where: { id: existing.id },
    data: {
      name: def.name, description: def.description, category: def.category,
      config: JSON.stringify(TemplateConfigSchema.parse(def.config)),
    },
  });
  res.json({ template: serialize(t) });
}) as RequestHandler);

router.delete('/:templateId', requireSuperAdmin as RequestHandler, (async (req, res) => {
  const existing = await prisma.timelineTemplate.findUnique({
    where: { id: req.params.templateId },
    include: { _count: { select: { timelines: true } } },
  });
  if (!existing) return res.status(404).json({ error: 'Template not found' });
  if (existing.builtInKey) {
    return res.status(400).json({ error: 'Built-in templates cannot be deleted — deactivate it instead' });
  }
  // Timeline.templateId is ON DELETE SET NULL, so in-use timelines fall back
  // to the first active template rather than breaking.
  await prisma.timelineTemplate.delete({ where: { id: existing.id } });
  res.json({ message: 'Template deleted', timelinesAffected: existing._count.timelines });
}) as RequestHandler);

export default router;
