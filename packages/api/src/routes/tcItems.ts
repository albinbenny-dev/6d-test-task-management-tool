import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import multer from 'multer';
import * as xlsx from 'xlsx';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import { requireAdvancedFeatures, blockAutomationAccess } from '../middleware/rbac.js';

// TC Library — manual test cases (TcItem). This is a manual-testing-only
// tool, so there is no script/automation linkage here: no RF Script ID
// import matching, no automation-scope flag, no link-to-script actions.

const router = Router({ mergeParams: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(verifyToken as RequestHandler);
router.use(requireProjectAccess as unknown as RequestHandler);

// ── GET / ──────────────────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId } = req.params;
    const { module: mod, search } = req.query as Record<string, string>;

    const items = await prisma.tcItem.findMany({
      where: {
        projectId,
        ...(mod ? { module: mod } : {}),
        ...(search ? {
          OR: [
            { title: { contains: search, mode: 'insensitive' } },
            { module: { contains: search, mode: 'insensitive' } },
            { feature: { contains: search, mode: 'insensitive' } },
          ],
        } : {}),
      },
      orderBy: [{ module: 'asc' }, { srNo: 'asc' }, { createdAt: 'asc' }],
    });

    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// ── POST / — TEST_USER may not create test cases (read-only on TC Library) ──
router.post('/', blockAutomationAccess as RequestHandler, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId } = req.params;
    const { srNo, module: mod, feature, title, description, steps, expectedResult } = req.body as Record<string, string>;
    if (!title?.trim()) {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    const item = await prisma.tcItem.create({
      data: {
        projectId,
        srNo: srNo ? Number(srNo) : undefined,
        module: mod || undefined,
        feature: feature || undefined,
        title: title.trim(),
        description: description || undefined,
        steps: steps || undefined,
        expectedResult: expectedResult || undefined,
      },
    });
    res.status(201).json({ item });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /:id — edit; TEST_USER may not (read-only) ───────────────────────
router.patch('/:id', blockAutomationAccess as RequestHandler, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId, id } = req.params;
    const { srNo, module: mod, feature, title, description, steps, expectedResult, labels } = req.body as Record<string, unknown>;

    const existing = await prisma.tcItem.findFirst({ where: { id, projectId } });
    if (!existing) { res.status(404).json({ error: 'Not found' }); return; }

    const item = await prisma.tcItem.update({
      where: { id },
      data: {
        ...(srNo !== undefined ? { srNo: (srNo as string) || null } : {}),
        ...(mod !== undefined ? { module: (mod as string) || null } : {}),
        ...(feature !== undefined ? { feature: (feature as string) || null } : {}),
        ...(title !== undefined ? { title: (title as string).trim() } : {}),
        ...(description !== undefined ? { description: (description as string) || null } : {}),
        ...(steps !== undefined ? { steps: (steps as string) || null } : {}),
        ...(expectedResult !== undefined ? { expectedResult: (expectedResult as string) || null } : {}),
        ...(labels !== undefined ? { labels: JSON.stringify(Array.isArray(labels) ? labels : []) } : {}),
      },
    });
    res.json({ item });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /:id — ADMIN/SUPER_USER only; STANDARD_USER and TEST_USER may not
// delete test cases from TC Library. ───────────────────────────────────────
router.delete('/:id', requireAdvancedFeatures as RequestHandler, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId, id } = req.params;
    const existing = await prisma.tcItem.findFirst({ where: { id, projectId } });
    if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
    await prisma.tcItem.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── POST /bulk-delete — same restriction as DELETE /:id ────────────────────
router.post('/bulk-delete', requireAdvancedFeatures as RequestHandler, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId } = req.params;
    const { ids } = req.body as { ids: string[] };
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'ids array required' });
      return;
    }
    const { count } = await prisma.tcItem.deleteMany({ where: { projectId, id: { in: ids } } });
    res.json({ deleted: count });
  } catch (err) {
    next(err);
  }
});

// ── POST /bulk-move-feature — TEST_USER may not mutate TC Library ──────────
router.post('/bulk-move-feature', blockAutomationAccess as RequestHandler, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId } = req.params;
    const { ids, feature } = req.body as { ids: string[]; feature: string };
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'ids array required' });
      return;
    }
    const { count } = await prisma.tcItem.updateMany({
      where: { projectId, id: { in: ids } },
      data: { feature: feature?.trim() || null },
    });
    res.json({ updated: count });
  } catch (err) {
    next(err);
  }
});

// ── POST /bulk-add-label — add one label to every selected TC's label set
// (no duplicates); TEST_USER may not mutate TC Library. ────────────────────
router.post('/bulk-add-label', blockAutomationAccess as RequestHandler, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId } = req.params;
    const { ids, label } = req.body as { ids: string[]; label: string };
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'ids array required' });
      return;
    }
    const trimmed = label?.trim();
    if (!trimmed) {
      res.status(400).json({ error: 'label is required' });
      return;
    }
    const items = await prisma.tcItem.findMany({ where: { projectId, id: { in: ids } }, select: { id: true, labels: true } });
    await Promise.all(items.map((item) => {
      let existing: string[] = [];
      try { existing = JSON.parse(item.labels); } catch { /* corrupted row — start fresh */ }
      if (existing.includes(trimmed)) return Promise.resolve();
      return prisma.tcItem.update({ where: { id: item.id }, data: { labels: JSON.stringify([...existing, trimmed]) } });
    }));
    res.json({ updated: items.length });
  } catch (err) {
    next(err);
  }
});

// ── POST /export — download TcItems as Excel. Body may include `ids` to
// export only a filtered/selected subset; omit it to export everything. ───
router.post('/export', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId } = req.params;
    const { ids } = (req.body ?? {}) as { ids?: string[] };

    const items = await prisma.tcItem.findMany({
      where: { projectId, ...(Array.isArray(ids) && ids.length > 0 ? { id: { in: ids } } : {}) },
      orderBy: [{ module: 'asc' }, { srNo: 'asc' }, { createdAt: 'asc' }],
    });

    const headers = ['Test Case ID', 'Module', 'Feature', 'Test Case Title', 'Test Case Description', 'Steps', 'Expected Result', 'Labels'];

    const rows = items.map((item) => {
      let labels: string[] = [];
      try { labels = JSON.parse(item.labels); } catch { /* corrupted row — skip */ }
      return {
        'Test Case ID':          item.srNo ?? '',
        'Module':                item.module ?? '',
        'Feature':               item.feature ?? '',
        'Test Case Title':       item.title,
        'Test Case Description': item.description ?? '',
        'Steps':                 item.steps ?? '',
        'Expected Result':       item.expectedResult ?? '',
        'Labels':                labels.join(', '),
      };
    });

    const ws = xlsx.utils.json_to_sheet(rows, { header: headers });
    ws['!cols'] = [14, 18, 28, 40, 50, 60, 50, 24].map((w) => ({ wch: w }));
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'TC Library');
    const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="tc-library-export.xlsx"');
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

// ── GET /template — download Excel import template ────────────────────────
router.get('/template', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const headers = ['Test Case ID', 'Module', 'Feature', 'Test Case Title', 'Test Case Description', 'Step', 'Expected Result'];
    const samples = [
      {
        'Test Case ID': 'AIR-TC-001',
        'Module': 'CPM',
        'Feature': 'Geo Hierarchy',
        'Test Case Title': 'Modify Geo hierarchy (Country)',
        'Test Case Description': 'Admin User / User with privilege can Modify the Geo Hierarchy',
        'Step': '1. Admin or user with privileges will login to CPM UI\n2. User navigates to Geo Hierarchy',
        'Expected Result': 'Admin User / User with privilege should be able to modify the Geo Hierarchy.',
      },
    ];

    const ws = xlsx.utils.json_to_sheet(samples, { header: headers });
    ws['!cols'] = [14, 20, 25, 40, 50, 60, 50].map((w) => ({ wch: w }));
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Test Cases');
    const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="tc-import-template.xlsx"');
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

// ── GET /:id — single test case, full detail ───────────────────────────────
// Registered after every other static-segment GET/POST route (export,
// template, bulk-*) so :id can't shadow them.
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId, id } = req.params;
    const item = await prisma.tcItem.findFirst({ where: { id, projectId } });
    if (!item) { res.status(404).json({ error: 'Test case not found' }); return; }
    res.json({ item });
  } catch (err) {
    next(err);
  }
});

// ── POST /import — parse Excel and bulk-create/update TcItems — same
// restriction as delete above. ──────────────────────────────────────────────
router.post('/import', requireAdvancedFeatures as RequestHandler, upload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId } = req.params;
    if (!req.file) { res.status(400).json({ error: 'Excel file required (field: file)' }); return; }

    const wb = xlsx.read(req.file.buffer, { type: 'buffer' });

    const findVal = (row: Record<string, unknown>, keys: string[]): string => {
      const norm: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) norm[k.toLowerCase().trim()] = v;
      for (const k of keys) {
        const v = norm[k.toLowerCase().trim()];
        if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
      }
      return '';
    };

    // Only these canonical columns are used; all other columns in the Excel are ignored.
    const tcIdKeys     = ['test case id', 'testcaseid', 'tc id', 'tc_id', 'sr. no', 'sr.no', 'sr no', 'srno', 's.no', 'sno', 'serial', 'no', '#'];
    const moduleKeys   = ['module'];
    const featureKeys  = ['feature'];
    const titleKeys    = ['test case title', 'title', 'test case name', 'tc title', 'name'];
    const descKeys     = ['test case description', 'description', 'objective', 'desc'];
    const stepsKeys    = ['step', 'steps', 'test steps', 'test step'];
    const expectedKeys = ['expected result', 'expected results', 'expected outcome', 'expected'];

    // Collect rows from ALL sheets so multi-sheet workbooks are fully imported
    const allRows: Record<string, unknown>[] = [];
    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
      allRows.push(...rows);
    }

    // Forward-fill TC ID, Module, Feature, and Title to handle merged-cell Excel layouts
    let lastTcId    = '';
    let lastModule  = '';
    let lastFeature = '';
    let lastTitle   = '';

    type RawRow = {
      projectId: string; srNo: string | null; module: string | null; feature: string | null;
      title: string; description: string | null; steps: string | null; expectedResult: string | null;
    };

    let skippedEmpty = 0;

    const data = allRows
      .map((row): RawRow | null => {
        const tcId    = findVal(row, tcIdKeys)     || lastTcId;
        const module  = findVal(row, moduleKeys)   || lastModule;
        const feature = findVal(row, featureKeys)  || lastFeature;
        const title   = findVal(row, titleKeys)    || lastTitle;

        if (!title) { skippedEmpty++; return null; }

        lastTcId    = tcId;
        lastModule  = module;
        lastFeature = feature;
        lastTitle   = title;

        return {
          projectId,
          srNo:             tcId || null,
          module:           module || null,
          feature:          feature || null,
          title,
          description:      findVal(row, descKeys)     || null,
          steps:            findVal(row, stepsKeys)    || null,
          expectedResult:   findVal(row, expectedKeys) || null,
        };
      })
      .filter(Boolean) as RawRow[];

    // Deduplicate: prefer srNo as the unique key (most reliable); fall back to module|feature|title
    const seen = new Set<string>();
    const duplicateRows: string[] = [];
    const deduped = data.filter((d) => {
      const key = d.srNo ? `srno:${d.srNo}` : `${d.module ?? ''}|${d.feature ?? ''}|${d.title}`;
      if (seen.has(key)) {
        duplicateRows.push(d.srNo ? `${d.srNo} — ${d.title}` : d.title);
        return false;
      }
      seen.add(key);
      return true;
    });

    if (deduped.length === 0) {
      res.status(400).json({ error: 'No valid rows found. Check that "Test Case Title" column is present.' });
      return;
    }

    // Load existing DB records to split deduped into insert vs update
    const existingItems = await prisma.tcItem.findMany({
      where: { projectId },
      select: { id: true, srNo: true, module: true, feature: true, title: true },
    });
    const existingMap = new Map<string, string>(); // dedup-key → TcItem.id
    for (const e of existingItems) {
      const key = e.srNo ? `srno:${e.srNo}` : `${e.module ?? ''}|${e.feature ?? ''}|${e.title}`;
      existingMap.set(key, e.id);
    }

    const toInsert: RawRow[] = [];
    const toUpdate: (RawRow & { _existingId: string })[] = [];

    for (const d of deduped) {
      const key = d.srNo ? `srno:${d.srNo}` : `${d.module ?? ''}|${d.feature ?? ''}|${d.title}`;
      const existingId = existingMap.get(key);
      if (existingId) {
        toUpdate.push({ ...d, _existingId: existingId });
      } else {
        toInsert.push(d);
      }
    }

    if (toInsert.length > 0) {
      await prisma.tcItem.createMany({ data: toInsert });
    }

    await Promise.all(
      toUpdate.map(({ _existingId, ...rest }) =>
        prisma.tcItem.update({ where: { id: _existingId }, data: rest }),
      ),
    );

    res.status(201).json({
      imported:      toInsert.length,
      updated:       toUpdate.length,
      skippedEmpty,
      duplicateRows,
      totalRows:     allRows.length,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
