import { Router, RequestHandler } from 'express';
import multer from 'multer';
import * as xlsx from 'xlsx';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import { requireAdvancedFeatures } from '../middleware/rbac.js';
import { parseMilestoneRows, type ParsedMilestone } from '../lib/milestoneImport.js';

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
// Milestones can also be bulk-loaded from the CRM's "PO Report with Milestones"
// export (POST /import below): one list per PO, upserted on the CRM Record Id,
// amounts ignored.

const MILESTONE_INCLUDE = {
  milestoneList: { select: { id: true, name: true, color: true } },
} as const;

const CreateMilestoneSchema = z.object({
  milestoneListId: z.string().min(1),
  name:            z.string().min(1).max(200),
  baselineDate:    z.string().datetime().optional().nullable(),
  targetDate:      z.string().datetime().optional().nullable(),
  actualDate:      z.string().datetime().optional().nullable(),
  evidenceDate:    z.string().datetime().optional().nullable(),
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
  evidenceDate:    z.string().datetime().optional().nullable(),
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
  const { milestoneListId, name, baselineDate, targetDate, actualDate, evidenceDate, isPaymentLinked, invoiceRaised, notes } = parsed.data;

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
      evidenceDate: evidenceDate ?? null,
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

// ── POST /import — CRM "PO Report with Milestones" (multipart: file, projectManager?, commit?) ──
// The UI calls this twice with the same file: commit=false returns a preview (what would be
// created / updated, per PO), commit=true applies it. Every PO in the file lands in THIS project —
// the uploader decides which POs belong here by choosing the file. Rows are matched on the CRM
// Record Id: CRM-owned fields (name, the four dates, delivered / invoiced flags, PO details, CRM
// comments) are overwritten; the PM's own `notes`, the list a milestone sits in, and its order are
// never touched. Rows missing from the file are left alone — the export isn't always the full
// schedule, so absence doesn't mean "deleted" or "paid".

const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const MAX_IMPORT_ROWS = 5000;
const LIST_COLORS = ['#2563AB', '#2A9D8F', '#F47B20', '#8B5CF6', '#DC2626', '#0891B2', '#CA8A04', '#DB2777'];

type Existing = Awaited<ReturnType<typeof prisma.milestone.findMany>>[number];
const poKeyOf = (r: ParsedMilestone) => r.poNumber || r.poName;
const sameDay =(a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

/** Which CRM-owned fields of an existing milestone differ from the file's row. */
function diffMilestone(old: Existing, row: ParsedMilestone): string[] {
  const changed: string[] = [];
  if (old.name !== row.name) changed.push('name');
  if (!sameDay(old.baselineDate, row.baselineDate)) changed.push('baselineDate');
  if (!sameDay(old.targetDate, row.targetDate)) changed.push('targetDate');
  if (!sameDay(old.actualDate, row.actualDate)) changed.push('actualDate');
  if (!sameDay(old.evidenceDate, row.evidenceDate)) changed.push('evidenceDate');
  if (old.isCompleted !== row.isCompleted) changed.push('isCompleted');
  if (old.invoiceRaised !== row.invoiceRaised) changed.push('invoiceRaised');
  if ((old.poNumber ?? '') !== row.poNumber) changed.push('poNumber');
  if ((old.poName ?? '') !== row.poName) changed.push('poName');
  if ((old.crmComments ?? null) !== row.crmComments) changed.push('crmComments');
  return changed;
}

router.post('/import', requireAdvancedFeatures as RequestHandler, importUpload.single('file'), (async (req, res) => {
  const projectId = req.project.id;
  if (!req.file) return res.status(400).json({ error: 'Excel file required (field: file)' });
  const commit = req.body?.commit === 'true';
  const projectManager = typeof req.body?.projectManager === 'string' ? req.body.projectManager : '';

  let rawRows: Record<string, unknown>[];
  try {
    // cellDates stays off: dates must be read as raw serials (see lib/milestoneImport.ts) — the
    // Date objects SheetJS builds are shifted by the server's timezone.
    const wb = xlsx.read(req.file.buffer, { type: 'buffer', raw: true });
    rawRows = xlsx.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: null });
  } catch {
    return res.status(400).json({ error: 'Could not read that file — upload the .xlsx exported from the CRM' });
  }
  if (rawRows.length > MAX_IMPORT_ROWS) return res.status(400).json({ error: `That file has more than ${MAX_IMPORT_ROWS} rows` });

  const sheet = parseMilestoneRows(rawRows, { projectManager });

  // Which POs of the file to load into this project. The preview call omits this (it lists every PO so
  // the UI can offer a choice); the commit sends the chosen keys — "P.O Number", or the PO name when
  // the number is blank. Enforced here, not just in the UI: a PO that wasn't chosen is never written.
  if (typeof req.body?.poKeys === 'string') {
    let keys: unknown;
    try { keys = JSON.parse(req.body.poKeys); } catch { keys = null; }
    if (!Array.isArray(keys) || !keys.every((k) => typeof k === 'string')) return res.status(400).json({ error: 'poKeys must be a JSON array of PO keys' });
    if (keys.length === 0) return res.status(400).json({ error: 'Select at least one PO to import' });
    const wanted = new Set<string>(keys);
    sheet.rows = sheet.rows.filter((r) => wanted.has(poKeyOf(r)));
    if (sheet.rows.length === 0) return res.status(400).json({ error: 'None of the selected POs were found in this file' });
  }
  if (sheet.missingColumns.length > 0) {
    return res.status(400).json({
      error: `This doesn't look like the PO milestone export — missing column(s): ${sheet.missingColumns.join(', ')}. Re-export it from the CRM with the P.O Number and Record Id (Invoicing Milestones) columns.`,
    });
  }
  if (sheet.projectManagers.length === 0) return res.status(400).json({ error: 'No rows found in the file' });

  const existing = await prisma.milestone.findMany({
    where: { projectId, crmRecordId: { in: sheet.rows.map((r) => r.crmRecordId) } },
  });
  const existingById = new Map(existing.map((m) => [m.crmRecordId!, m]));

  // PO → the list its milestones go to: where that PO's milestones already live (survives a list
  // rename), else a list named after the PO, else a new one.
  const poNumbers = [...new Set(sheet.rows.map((r) => r.poNumber).filter(Boolean))];
  const [byPo, lists] = await Promise.all([
    prisma.milestone.findMany({ where: { projectId, poNumber: { in: poNumbers } }, select: { poNumber: true, milestoneListId: true } }),
    prisma.milestoneList.findMany({ where: { projectId } }),
  ]);
  const listByPo = new Map<string, string>();
  for (const m of byPo) if (m.poNumber && !listByPo.has(m.poNumber)) listByPo.set(m.poNumber, m.milestoneListId);
  const listByName = new Map(lists.map((l) => [l.name.toLowerCase(), l.id]));
  const poKey = poKeyOf;
  const listNameOf = (r: ParsedMilestone) => r.poName.slice(0, 100);

  // Per-row classification + the per-PO summary the preview shows.
  const poSummary = new Map<string, { key: string; poNumber: string; poName: string; rows: number; created: number; updated: number; unchanged: number; notInvoiced: number; missingEvidence: number; newList: boolean }>();
  const toCreate: ParsedMilestone[] = [];
  const toUpdate: Array<{ id: string; row: ParsedMilestone }> = [];
  const unchangedIds: string[] = [];
  const evidenceShifts: Array<{ poKey: string; poName: string; milestone: string; from: string | null; to: string | null }> = [];

  for (const row of sheet.rows) {
    const key = poKey(row);
    const sum = poSummary.get(key) ?? {
      key, poNumber: row.poNumber, poName: row.poName, rows: 0, created: 0, updated: 0, unchanged: 0, notInvoiced: 0, missingEvidence: 0,
      newList: !listByPo.has(row.poNumber) && !listByName.has(listNameOf(row).toLowerCase()),
    };
    sum.rows++;
    if (!row.invoiceRaised) sum.notInvoiced++;
    if (!row.invoiceRaised && !row.evidenceDate) sum.missingEvidence++;
    const old = existingById.get(row.crmRecordId);
    if (!old) { toCreate.push(row); sum.created++; }
    else {
      const changed = diffMilestone(old, row);
      if (changed.length === 0) { unchangedIds.push(old.id); sum.unchanged++; }
      else {
        toUpdate.push({ id: old.id, row }); sum.updated++;
        if (changed.includes('evidenceDate')) {
          evidenceShifts.push({ poKey: key, poName: row.poName, milestone: row.name, from: old.evidenceDate?.toISOString() ?? null, to: row.evidenceDate?.toISOString() ?? null });
        }
      }
    }
    poSummary.set(key, sum);
  }

  const summary = {
    created: toCreate.length,
    updated: toUpdate.length,
    unchanged: unchangedIds.length,
    pos: [...poSummary.values()],
    evidenceShifts: evidenceShifts.slice(0, 50),
    // Not-yet-invoiced milestones with no Documentary Evidence Date — nothing can remind on these until the CRM has one.
    missingEvidence: sheet.rows.filter((r) => !r.invoiceRaised && !r.evidenceDate).length,
    projectManagers: sheet.projectManagers,
    skippedOtherPm: sheet.skippedOtherPm,
    skippedEmpty: sheet.skippedEmpty,
    warnings: sheet.warnings,
  };
  if (!commit) return res.json({ committed: false, ...summary });

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    // Resolve (or create) each PO's list first.
    const listIdByPoKey = new Map<string, string>();
    let colorIdx = lists.length;
    let listSort = lists.reduce((mx, l) => Math.max(mx, l.sortOrder), -1) + 1;
    for (const row of sheet.rows) {
      const key = poKey(row);
      if (listIdByPoKey.has(key)) continue;
      let id = listByPo.get(row.poNumber) ?? listByName.get(listNameOf(row).toLowerCase());
      if (!id) {
        const created = await tx.milestoneList.create({
          data: { projectId, name: listNameOf(row), color: LIST_COLORS[colorIdx++ % LIST_COLORS.length], sortOrder: listSort++ },
        });
        id = created.id;
        listByName.set(created.name.toLowerCase(), id);
      }
      listIdByPoKey.set(key, id);
    }

    const crmFields = (r: ParsedMilestone) => ({
      name: r.name,
      baselineDate: r.baselineDate,
      targetDate: r.targetDate,
      actualDate: r.actualDate,
      evidenceDate: r.evidenceDate,
      isCompleted: r.isCompleted,
      invoiceRaised: r.invoiceRaised,
      poNumber: r.poNumber || null,
      poName: r.poName,
      crmComments: r.crmComments,
      lastImportedAt: now,
    });

    const nextSort = new Map<string, number>();
    for (const row of toCreate) {
      const listId = listIdByPoKey.get(poKey(row))!;
      if (!nextSort.has(listId)) {
        const last = await tx.milestone.findFirst({ where: { projectId, milestoneListId: listId }, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } });
        nextSort.set(listId, (last?.sortOrder ?? -1) + 1);
      }
      const sortOrder = nextSort.get(listId)!;
      nextSort.set(listId, sortOrder + 1);
      await tx.milestone.create({
        data: { projectId, milestoneListId: listId, crmRecordId: row.crmRecordId, isPaymentLinked: true, sortOrder, ...crmFields(row) },
      });
    }
    for (const { id, row } of toUpdate) await tx.milestone.update({ where: { id }, data: crmFields(row) });
    if (unchangedIds.length > 0) await tx.milestone.updateMany({ where: { id: { in: unchangedIds } }, data: { lastImportedAt: now } });
  }, { timeout: 60_000 });

  res.json({ committed: true, ...summary });
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
