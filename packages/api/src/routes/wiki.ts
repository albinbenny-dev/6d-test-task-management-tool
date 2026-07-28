import { Router, RequestHandler } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import { requireAdvancedFeatures, requireWrite } from '../middleware/rbac.js';

// ── Wiki — per-project living documentation ─────────────────────────────────
// Confluence-style but deliberately minimal: pages are markdown text with
// plain markdown links out to Drive/SharePoint/etc (same "link, don't host"
// convention as TestCycle.driveFolderUrl) — no file uploads, no WYSIWYG. No
// separate space/container model: a Project already scopes the whole wiki.
// One level of nesting only, via parentPageId — mirrors Task.parentTaskId/
// subtasks; a page that already has a parent cannot itself be given children
// (enforced here, not in the schema, same as every other self-relation cap
// in this codebase). Open to every project role for reading (a TEST_USER
// should find the deployment URL/LLD link as easily as anyone); creating and
// editing is open to every role too (matches Task's write-open shape);
// deleting is restricted to ADMIN/SUPER_USER since it cascades child pages —
// same "guard against an accidental bulk wipe" gate as TaskList's delete.

const WIKI_LIST_SELECT = {
  id: true,
  parentPageId: true,
  title: true,
  tags: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { user: { select: { id: true, name: true } } } },
  updatedBy: { select: { user: { select: { id: true, name: true } } } },
  _count: { select: { childPages: true } },
} as const;

const CreateWikiPageSchema = z.object({
  parentPageId: z.string().min(1).optional(),
  title:        z.string().min(1).max(200),
  content:      z.string().max(200_000).optional(),
  tags:         z.array(z.string().min(1).max(40)).optional(),
});

const UpdateWikiPageSchema = z.object({
  title:   z.string().min(1).max(200).optional(),
  content: z.string().max(200_000).optional(),
  tags:    z.array(z.string().min(1).max(40)).optional(),
});

const ReorderWikiPagesSchema = z.object({
  parentPageId: z.string().nullable(),
  orderedIds:   z.array(z.string()).min(1),
});

const router = Router({ mergeParams: true });
router.use(verifyToken as RequestHandler);
router.use(requireProjectAccess as unknown as RequestHandler);

// ── GET / — flat list of every page in the project (no content — keeps the
// tree sidebar cheap to load). Frontend builds the one-level tree from
// parentPageId. ──────────────────────────────────────────────────────────

router.get('/', (async (req, res) => {
  const projectId = req.project.id;
  const pages = await prisma.wikiPage.findMany({
    where: { projectId },
    select: WIKI_LIST_SELECT,
    orderBy: { sortOrder: 'asc' },
  });
  res.json({ pages });
}) as RequestHandler);

// ── GET /:pageId — full page detail, plus its child pages (summary only) ──

router.get('/:pageId', (async (req, res) => {
  const projectId = req.project.id;
  const { pageId } = req.params;
  const page = await prisma.wikiPage.findFirst({
    where: { id: pageId, projectId },
    include: {
      createdBy: { select: { user: { select: { id: true, name: true } } } },
      updatedBy: { select: { user: { select: { id: true, name: true } } } },
      childPages: { select: WIKI_LIST_SELECT, orderBy: { sortOrder: 'asc' } },
    },
  });
  if (!page) return res.status(404).json({ error: 'Wiki page not found' });
  res.json({ page });
}) as RequestHandler);

// ── POST / — create a page (or child page, if parentPageId is given) ──────

router.post('/', requireWrite as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const parsed = CreateWikiPageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }
  const { parentPageId, title, content, tags } = parsed.data;

  if (parentPageId) {
    const parent = await prisma.wikiPage.findFirst({ where: { id: parentPageId, projectId } });
    if (!parent) return res.status(400).json({ error: 'Parent page does not belong to this project' });
    if (parent.parentPageId) {
      return res.status(400).json({ error: 'That page is itself a child page — only one level of nesting is supported' });
    }
  }

  const last = await prisma.wikiPage.findFirst({
    where: { projectId, parentPageId: parentPageId ?? null },
    orderBy: { sortOrder: 'desc' },
  });

  const page = await prisma.wikiPage.create({
    data: {
      projectId,
      parentPageId: parentPageId ?? null,
      title,
      content: content ?? '',
      tags: JSON.stringify(tags ?? []),
      sortOrder: (last?.sortOrder ?? -1) + 1,
      createdByUserId: req.projectMember?.id ?? null,
    },
    include: {
      createdBy: { select: { user: { select: { id: true, name: true } } } },
      updatedBy: { select: { user: { select: { id: true, name: true } } } },
    },
  });
  res.status(201).json({ page });
}) as RequestHandler);

// ── PATCH /reorder — bulk-persist sibling order within one parent (or
// top-level, parentPageId: null). Registered ahead of PUT /:pageId so
// "/reorder" isn't swallowed as a literal id. ──────────────────────────────

router.patch('/reorder', requireWrite as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const parsed = ReorderWikiPagesSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }

  const pages = await prisma.wikiPage.findMany({
    where: { projectId, parentPageId: parsed.data.parentPageId, id: { in: parsed.data.orderedIds } },
  });
  const validIds = new Set(pages.map((p) => p.id));

  await prisma.$transaction(
    parsed.data.orderedIds
      .filter((id) => validIds.has(id))
      .map((id, i) => prisma.wikiPage.update({ where: { id }, data: { sortOrder: i } })),
  );
  res.json({ message: 'Reordered' });
}) as RequestHandler);

// ── PUT /:pageId — edit title/content/tags. parentPageId is not editable
// here — no "move to a different parent" in v1. ───────────────────────────

router.put('/:pageId', requireWrite as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const { pageId } = req.params;
  const parsed = UpdateWikiPageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }

  const existing = await prisma.wikiPage.findFirst({ where: { id: pageId, projectId } });
  if (!existing) return res.status(404).json({ error: 'Wiki page not found' });

  const { tags, ...rest } = parsed.data;
  const page = await prisma.wikiPage.update({
    where: { id: pageId },
    data: {
      ...rest,
      ...(tags !== undefined ? { tags: JSON.stringify(tags) } : {}),
      updatedByUserId: req.projectMember?.id ?? null,
    },
    include: {
      createdBy: { select: { user: { select: { id: true, name: true } } } },
      updatedBy: { select: { user: { select: { id: true, name: true } } } },
    },
  });
  res.json({ page });
}) as RequestHandler);

// ── DELETE /:pageId — cascades any child pages ─────────────────────────────

router.delete('/:pageId', requireAdvancedFeatures as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const { pageId } = req.params;
  const existing = await prisma.wikiPage.findFirst({
    where: { id: pageId, projectId },
    include: { _count: { select: { childPages: true } } },
  });
  if (!existing) return res.status(404).json({ error: 'Wiki page not found' });

  await prisma.wikiPage.delete({ where: { id: pageId } });
  res.json({ message: 'Wiki page deleted', childPagesDeleted: existing._count.childPages });
}) as RequestHandler);

export default router;
