import { Router, RequestHandler } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import { requireAdvancedFeatures, requireWrite } from '../middleware/rbac.js';
import { getJiraResolutionSummary } from '../services/jiraService.js';

// ── Manual test cycles ───────────────────────────────────────────────────────
// Deliberately separate from the automation `Suite` model (which drives Robot
// Framework execution ordering in runWorker.ts). A TestCycle is a human-run
// regression pass: it snapshots a set of TcItems — the real test cases in TC
// Library, NOT the Script/TestCase model — at creation time (no live re-sync
// — see POST / below), each item is assigned to a ProjectMember who records a
// manual Pass/Fail/Blocked result, optionally with a reason and linked Jira
// bug keys. Pure manual test management; not linked to automation yet.

// ── Zod schemas ────────────────────────────────────────────────────────────

const CreateTestCycleSchema = z.object({
  name:        z.string().min(1).max(150),
  description: z.string().max(2000).optional(),
  // Cycles can be created empty — testers add cases from the cycle page's
  // "Add TC" picker afterward, rather than being forced to pick up front.
  testCaseIds: z.array(z.string()).optional().default([]),
  // Opco/team label(s) used to auto-discover bugs in this cycle's Jira project,
  // even if a tester never explicitly links a key — see jiraService.fetchIssuesByLabels.
  jiraLabels:  z.array(z.string().min(1)).optional(),
  // Raw JQL, additive alongside jiraLabels — see jiraService.fetchIssuesByJql.
  jiraJql:     z.string().max(2000).optional(),
  // Lead-provided Drive folder link for tester-uploaded artifacts — free-text,
  // not validated as a real Drive URL (mirrors jiraJql's hand-tuned, unvalidated style).
  driveFolderUrl: z.string().max(500).optional(),
  // Planned completion date for the whole cycle — color-coded on each of its
  // items in My Work, since individual TestCycleItems have no due date of their own.
  dueDate:     z.string().datetime().optional().nullable(),
});

const UpdateTestCycleSchema = z.object({
  name:        z.string().min(1).max(150).optional(),
  description: z.string().max(2000).optional(),
  jiraLabels:  z.array(z.string().min(1)).optional(),
  jiraJql:     z.string().max(2000).nullable().optional(),
  driveFolderUrl: z.string().max(500).nullable().optional(),
  dueDate:     z.string().datetime().nullable().optional(),
});

const LinkBugSchema = z.object({
  testCycleItemId: z.string().min(1),
});

const StatusTransitionSchema = z.object({
  status: z.enum(['PLANNING', 'ACTIVE', 'CLOSED']),
});

const AddItemsSchema = z.object({
  testCaseIds: z.array(z.string()).min(1),
});

const BulkRemoveItemsSchema = z.object({
  itemIds: z.array(z.string()).min(1),
});

const AssignItemSchema = z.object({
  assigneeUserId: z.string().nullable(),
});

const BulkAssignItemsSchema = z.object({
  itemIds: z.array(z.string()).min(1),
  assigneeUserId: z.string().nullable(),
});

const UpdateItemStatusSchema = z
  .object({
    status:        z.enum(['NOT_RUN', 'IN_PROGRESS', 'PASS', 'FAIL', 'BLOCKED']),
    reason:        z.string().max(2000).optional(),
    jiraIssueKeys: z.array(z.string().min(1)).optional(),
  })
  .refine(
    (v) => !(v.status === 'FAIL' || v.status === 'BLOCKED') || !!v.reason?.trim(),
    { message: 'A reason is required when marking a result Fail or Blocked', path: ['reason'] },
  );

// ── Router setup ───────────────────────────────────────────────────────────

const router = Router({ mergeParams: true });
router.use(verifyToken as RequestHandler);
router.use(requireProjectAccess as unknown as RequestHandler);

// ── GET / — list cycles ─────────────────────────────────────────────────────

router.get('/', (async (req, res) => {
  const projectId = req.project.id;
  const cycles = await prisma.testCycle.findMany({
    where: { projectId },
    include: { _count: { select: { items: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ cycles });
}) as RequestHandler);

// ── GET /dashboard/summary — per-cycle manual-status counts ────────────────

router.get('/dashboard/summary', (async (req, res) => {
  const projectId = req.project.id;
  const [cycles, grouped, itemsWithKeys, allCachedIssues] = await Promise.all([
    prisma.testCycle.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } }),
    prisma.testCycleItem.groupBy({
      by: ['testCycleId', 'manualStatus'],
      where: { projectId },
      _count: { _all: true },
    }),
    // Bulk-fetched once so the per-cycle bug union below (same three-source
    // logic as GET /:cycleId/bugs) doesn't fire a query per cycle.
    prisma.testCycleItem.findMany({
      where: { projectId, NOT: { jiraIssueKeys: '[]' } },
      select: { testCycleId: true, jiraIssueKeys: true },
    }),
    prisma.jiraIssue.findMany({ where: { projectId } }),
  ]);

  const emptyCounts = () => ({ NOT_RUN: 0, IN_PROGRESS: 0, PASS: 0, FAIL: 0, BLOCKED: 0 });
  const countsByCycle = new Map<string, Record<string, number>>();
  for (const row of grouped) {
    if (!countsByCycle.has(row.testCycleId)) {
      countsByCycle.set(row.testCycleId, emptyCounts());
    }
    countsByCycle.get(row.testCycleId)![row.manualStatus] = row._count._all;
  }

  const issueByKey = new Map(allCachedIssues.map((i) => [i.issueKey, i]));
  const itemsByCycle = new Map<string, typeof itemsWithKeys>();
  for (const item of itemsWithKeys) {
    if (!itemsByCycle.has(item.testCycleId)) itemsByCycle.set(item.testCycleId, []);
    itemsByCycle.get(item.testCycleId)!.push(item);
  }

  const summary = cycles.map((cycle) => {
    const counts = countsByCycle.get(cycle.id) ?? emptyCounts();
    const total = counts.NOT_RUN + counts.IN_PROGRESS + counts.PASS + counts.FAIL + counts.BLOCKED;

    // Per-cycle bug key union — explicit item/cycle links + label match +
    // cached JQL match — same three sources GET /:cycleId/bugs unions,
    // scoped to this cycle using the bulk-fetched data above.
    const keySet = new Set<string>();
    for (const item of itemsByCycle.get(cycle.id) ?? []) {
      try { (JSON.parse(item.jiraIssueKeys) as string[]).forEach((k) => keySet.add(k)); } catch { /* skip */ }
    }
    try { (JSON.parse(cycle.linkedJiraKeys) as string[]).forEach((k) => keySet.add(k)); } catch { /* skip */ }
    try { (JSON.parse(cycle.jqlDiscoveredKeys) as string[]).forEach((k) => keySet.add(k)); } catch { /* skip */ }
    let cycleLabels: string[] = [];
    try { cycleLabels = JSON.parse(cycle.jiraLabels); } catch { /* skip */ }
    if (cycleLabels.length > 0) {
      for (const issue of allCachedIssues) {
        // Label match only surfaces Bugs (mirrors the issuetype = Bug clause
        // in jiraService's label-discovery JQL) — explicit links below aren't
        // filtered, so a tester can still attach a Story/Task on purpose.
        if (issue.issueType !== 'Bug') continue;
        let issueLabels: string[] = [];
        try { issueLabels = JSON.parse(issue.labels); } catch { continue; }
        if (issueLabels.some((l) => cycleLabels.includes(l))) keySet.add(issue.issueKey);
      }
    }
    const bugsTotal = keySet.size;
    const bugsResolved = [...keySet].filter((k) => issueByKey.get(k)?.statusCategory === 'done').length;

    return { cycle, counts, total, bugs: { resolved: bugsResolved, total: bugsTotal } };
  });

  const jira = await getJiraResolutionSummary(projectId);

  res.json({ summary, jira });
}) as RequestHandler);

// ── GET /dashboard/resource-summary — per-resource (SPOC) totals ───────────
// Scoped to ACTIVE cycles only, matching the overall dashboard's "Total"
// definition — a resource's workload is what's currently in-flight, not
// stale counts from PLANNING cycles or closed-out CLOSED ones.

router.get('/dashboard/resource-summary', (async (req, res) => {
  const projectId = req.project.id;
  const grouped = await prisma.testCycleItem.groupBy({
    by: ['assigneeId', 'manualStatus'],
    where: { projectId, testCycle: { status: 'ACTIVE' } },
    _count: { _all: true },
  });

  const assigneeIds = [...new Set(grouped.map((g) => g.assigneeId).filter((id): id is string => !!id))];
  const members = assigneeIds.length
    ? await prisma.projectMember.findMany({
        where: { id: { in: assigneeIds } },
        include: { user: { select: { id: true, name: true } } },
      })
    : [];
  const nameById = new Map(members.map((m) => [m.id, m.user.name]));
  const userIdById = new Map(members.map((m) => [m.id, m.user.id]));

  const emptyCounts = () => ({ NOT_RUN: 0, IN_PROGRESS: 0, PASS: 0, FAIL: 0, BLOCKED: 0 });
  const byAssignee = new Map<string, Record<string, number>>();
  for (const row of grouped) {
    const key = row.assigneeId ?? 'unassigned';
    if (!byAssignee.has(key)) byAssignee.set(key, emptyCounts());
    byAssignee.get(key)![row.manualStatus] = row._count._all;
  }

  const data = [...byAssignee.entries()]
    .map(([key, counts]) => {
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      const passRate = total > 0 ? Math.round((counts.PASS / total) * 100) : 0;
      return {
        assigneeId: key === 'unassigned' ? null : key,
        userId: key === 'unassigned' ? null : (userIdById.get(key) ?? null),
        assigneeName: key === 'unassigned' ? 'Unassigned' : (nameById.get(key) ?? 'Unknown'),
        counts,
        total,
        passRate,
      };
    })
    .sort((a, b) => b.total - a.total);

  // TEST_USER sees only their own row — this dashboard is a cross-resource
  // workload view meant for leads, not something a tester should be able to
  // use to see everyone else's assignments.
  const isTestUser = req.projectMember?.role === 'TEST_USER'
    && req.user.globalRole !== 'SUPER_ADMIN' && req.user.globalRole !== 'ADMIN';
  const scopedData = isTestUser ? data.filter((d) => d.assigneeId === req.projectMember!.id) : data;

  res.json({ data: scopedData });
}) as RequestHandler);

// ── GET /assignments?userId= — items assigned to a resource across all cycles
// Defaults to the caller (self, no query param needed). Looking up a
// DIFFERENT user's assignments requires a privileged role, matching the
// "Resources view" tier gated client-side by canManageTestCycles.
//
// Deliberately looks up ProjectMember by userId directly rather than trusting
// req.projectMember — requireProjectAccess leaves req.projectMember undefined
// for SUPER_ADMIN/global-ADMIN even when they also hold a real membership row
// (e.g. a lead who personally executes some cases), which would otherwise
// wrongly 403 an admin viewing their own assignments.

const AssignmentsQuerySchema = z.object({
  userId: z.string().optional(),
});

// Shared by /assignments and /assignments/history — resolves which
// ProjectMember's data the caller is allowed to see. Returns null once it
// has already written an error response (403/404); callers should return
// immediately when they get null back.
async function resolveAssignmentTarget(
  req: Parameters<RequestHandler>[0],
  res: Parameters<RequestHandler>[1],
  projectId: string,
  requestedUserId: string | undefined,
): Promise<{ targetUserId: string; member: { id: string } | null; isSelf: boolean } | null> {
  const targetUserId = requestedUserId || req.user.id;
  const isSelf = targetUserId === req.user.id;

  if (!isSelf) {
    const isPrivileged =
      req.user.globalRole === 'SUPER_ADMIN' ||
      req.user.globalRole === 'ADMIN' ||
      req.projectMember?.role === 'ADMIN' ||
      req.projectMember?.role === 'SUPER_USER';
    if (!isPrivileged) {
      res.status(403).json({ error: "Only privileged roles may view another resource's assignments" });
      return null;
    }
  }

  const member = await prisma.projectMember.findFirst({ where: { projectId, userId: targetUserId } });
  if (!member && !isSelf) {
    res.status(404).json({ error: 'That user is not a member of this project' });
    return null;
  }

  return { targetUserId, member, isSelf };
}

router.get('/assignments', (async (req, res) => {
  const projectId = req.project.id;
  const parsed = AssignmentsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }

  const resolved = await resolveAssignmentTarget(req, res, projectId, parsed.data.userId);
  if (!resolved) return;
  const { targetUserId, member } = resolved;

  // Self-view with no membership row (e.g. a global admin never added as a
  // member) is just "nothing assigned," not an error.
  if (!member) return res.json({ userId: targetUserId, items: [] });

  const items = await prisma.testCycleItem.findMany({
    where: { projectId, assigneeId: member.id },
    include: {
      testCase: { select: { id: true, srNo: true, module: true, feature: true, title: true, description: true, steps: true, expectedResult: true, labels: true } },
      testCycle: { select: { id: true, name: true, status: true, dueDate: true } },
    },
    orderBy: [{ testCycleId: 'asc' }, { sortOrder: 'asc' }],
  });

  res.json({ userId: targetUserId, items });
}) as RequestHandler);

// ── GET /assignments/history?userId=&days= — the resource's daily run log ──
// Every manual status change is already recorded in TestCycleItemHistory
// (append-only); this just filters that audit trail down to one resource
// and a time window, newest first — the frontend groups it by day.

const AssignmentsHistoryQuerySchema = z.object({
  userId: z.string().optional(),
  days: z.string().optional(),
});

router.get('/assignments/history', (async (req, res) => {
  const projectId = req.project.id;
  const parsed = AssignmentsHistoryQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }

  const resolved = await resolveAssignmentTarget(req, res, projectId, parsed.data.userId);
  if (!resolved) return;
  const { targetUserId, member } = resolved;

  const daysParam = parseInt(parsed.data.days ?? '30', 10);
  const days = Math.min(Math.max(Number.isFinite(daysParam) ? daysParam : 30, 1), 180);
  const since = new Date(Date.now() - days * 86_400_000);

  if (!member) return res.json({ userId: targetUserId, days, history: [] });

  const history = await prisma.testCycleItemHistory.findMany({
    // Exclude IN_PROGRESS transitions — "picked up" isn't a completed run,
    // so it shouldn't inflate the resource's daily run count/list.
    where: { projectId, assigneeId: member.id, changedAt: { gte: since }, toStatus: { not: 'IN_PROGRESS' } },
    include: {
      testCycleItem: {
        include: {
          testCase: { select: { id: true, srNo: true, module: true, feature: true, title: true } },
          testCycle: { select: { id: true, name: true, status: true } },
        },
      },
    },
    orderBy: { changedAt: 'desc' },
  });

  res.json({ userId: targetUserId, days, history });
}) as RequestHandler);

// ── POST / — create a cycle, snapshotting the chosen test cases ────────────

router.post('/', requireAdvancedFeatures as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const parsed = CreateTestCycleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }
  const { name, description, testCaseIds, jiraLabels, jiraJql, driveFolderUrl, dueDate } = parsed.data;

  // TcItem (the real TC Library test case) has no sortOrder of its own —
  // preserve the order the caller selected them in instead.
  let orderedIds: string[] = [];
  if (testCaseIds.length > 0) {
    const testCases = await prisma.tcItem.findMany({
      where: { id: { in: testCaseIds }, projectId },
      select: { id: true },
    });
    if (testCases.length === 0) {
      return res.status(400).json({ error: 'None of the selected test cases belong to this project' });
    }
    const validIds = new Set(testCases.map((tc) => tc.id));
    orderedIds = testCaseIds.filter((id) => validIds.has(id));
  }

  const cycle = await prisma.$transaction(async (tx) => {
    const c = await tx.testCycle.create({
      data: {
        projectId, name, description, createdByUserId: req.user.id,
        jiraLabels: JSON.stringify(jiraLabels ?? []),
        jiraJql: jiraJql?.trim() || null,
        driveFolderUrl: driveFolderUrl?.trim() || null,
        dueDate: dueDate ? new Date(dueDate) : null,
      },
    });
    await tx.testCycleItem.createMany({
      data: orderedIds.map((id, i) => ({
        projectId,
        testCycleId: c.id,
        testCaseId:  id,
        sortOrder:   i,
      })),
    });
    return c;
  });

  res.status(201).json({ cycle });
}) as RequestHandler);

// ── GET /bugs — union of every Jira bug across all of this project's cycles ─
// Same three-source union as GET /:cycleId/bugs (explicit links + label match
// + cached JQL match), just unscoped from a single cycle — powers the Test
// Cycles list page's combined bug board. Registered ahead of GET /:cycleId so
// "/bugs" isn't swallowed as a literal cycleId.

router.get('/bugs', (async (req, res) => {
  const projectId = req.project.id;

  const [cycles, itemsWithKeys, allCachedIssues] = await Promise.all([
    prisma.testCycle.findMany({ where: { projectId } }),
    prisma.testCycleItem.findMany({
      where: { projectId, NOT: { jiraIssueKeys: '[]' } },
      include: { testCase: { select: { id: true, srNo: true, title: true } } },
    }),
    prisma.jiraIssue.findMany({ where: { projectId } }),
  ]);

  const cycleIdsByKey = new Map<string, Set<string>>();
  const testCasesByKey = new Map<string, Map<string, { id: string; srNo: string | null; title: string }>>();

  function linkKeyToCycle(key: string, cycleId: string) {
    if (!cycleIdsByKey.has(key)) cycleIdsByKey.set(key, new Set());
    cycleIdsByKey.get(key)!.add(cycleId);
  }

  for (const item of itemsWithKeys) {
    let keys: string[] = [];
    try { keys = JSON.parse(item.jiraIssueKeys) as string[]; } catch { continue; }
    for (const key of keys) {
      linkKeyToCycle(key, item.testCycleId);
      if (!testCasesByKey.has(key)) testCasesByKey.set(key, new Map());
      testCasesByKey.get(key)!.set(item.testCase.id, item.testCase);
    }
  }

  for (const cycle of cycles) {
    try { (JSON.parse(cycle.linkedJiraKeys) as string[]).forEach((k) => linkKeyToCycle(k, cycle.id)); } catch { /* skip */ }
    try { (JSON.parse(cycle.jqlDiscoveredKeys) as string[]).forEach((k) => linkKeyToCycle(k, cycle.id)); } catch { /* skip */ }

    let cycleLabels: string[] = [];
    try { cycleLabels = JSON.parse(cycle.jiraLabels); } catch { /* skip */ }
    if (cycleLabels.length > 0) {
      for (const issue of allCachedIssues) {
        if (issue.issueType !== 'Bug') continue;
        let issueLabels: string[] = [];
        try { issueLabels = JSON.parse(issue.labels); } catch { continue; }
        if (issueLabels.some((l) => cycleLabels.includes(l))) linkKeyToCycle(issue.issueKey, cycle.id);
      }
    }
  }

  const issueByKey = new Map(allCachedIssues.map((i) => [i.issueKey, i]));
  const cycleById = new Map(cycles.map((c) => [c.id, c]));

  const bugs = [...cycleIdsByKey.entries()].map(([key, cycleIdSet]) => ({
    issueKey: key,
    issue: issueByKey.get(key) ?? null,
    testCases: [...(testCasesByKey.get(key)?.values() ?? [])],
    testCycles: [...cycleIdSet]
      .map((id) => cycleById.get(id))
      .filter((c): c is NonNullable<typeof c> => !!c)
      .map((c) => ({ id: c.id, name: c.name })),
  }));

  res.json({ bugs });
}) as RequestHandler);

// ── GET /:cycleId — detail with items ───────────────────────────────────────

router.get('/:cycleId', (async (req, res) => {
  const projectId = req.project.id;
  const { cycleId } = req.params;
  const cycle = await prisma.testCycle.findFirst({ where: { id: cycleId, projectId } });
  if (!cycle) return res.status(404).json({ error: 'Test cycle not found' });

  const items = await prisma.testCycleItem.findMany({
    where: { testCycleId: cycleId },
    include: {
      testCase: { select: { id: true, srNo: true, module: true, feature: true, title: true, description: true, steps: true, expectedResult: true } },
      assignee: { include: { user: { select: { id: true, name: true, email: true } } } },
    },
    orderBy: { sortOrder: 'asc' },
  });

  res.json({ cycle, items });
}) as RequestHandler);

// ── GET /:cycleId/history — every manual status change across the cycle ────
// Powers the per-item execution timeline + "retested" badge on the Test
// Cases tab: fetched once for the whole cycle (not per-item) and grouped
// client-side by testCycleItemId, since a cycle's full history is small
// enough to fetch in one call and this avoids N requests for N rows.

router.get('/:cycleId/history', (async (req, res) => {
  const projectId = req.project.id;
  const { cycleId } = req.params;
  const cycle = await prisma.testCycle.findFirst({ where: { id: cycleId, projectId } });
  if (!cycle) return res.status(404).json({ error: 'Test cycle not found' });

  const history = await prisma.testCycleItemHistory.findMany({
    where: { testCycleId: cycleId },
    orderBy: { changedAt: 'asc' },
  });

  // changedByUserId has no Prisma relation (kept as a plain denormalized
  // field, same as TestCycleItem.lastUpdatedByUserId) — resolve display
  // names with one batched lookup instead of adding a relation for this.
  const userIds = [...new Set(history.map((h) => h.changedByUserId))];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
    : [];
  const nameByUserId = new Map(users.map((u) => [u.id, u.name]));

  res.json({
    history: history.map((h) => ({ ...h, changedByName: nameByUserId.get(h.changedByUserId) ?? 'Unknown' })),
  });
}) as RequestHandler);

// ── PUT /:cycleId — edit name/description ───────────────────────────────────

router.put('/:cycleId', requireAdvancedFeatures as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const { cycleId } = req.params;
  const parsed = UpdateTestCycleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }
  const existing = await prisma.testCycle.findFirst({ where: { id: cycleId, projectId } });
  if (!existing) return res.status(404).json({ error: 'Test cycle not found' });

  const { jiraLabels, jiraJql, driveFolderUrl, dueDate, ...rest } = parsed.data;
  const trimmedJql = jiraJql === undefined ? undefined : (jiraJql?.trim() || null);
  const trimmedDriveUrl = driveFolderUrl === undefined ? undefined : (driveFolderUrl?.trim() || null);
  const cycle = await prisma.testCycle.update({
    where: { id: cycleId },
    data: {
      ...rest,
      ...(jiraLabels !== undefined ? { jiraLabels: JSON.stringify(jiraLabels) } : {}),
      // Clearing the JQL also clears its cached matches so the Bugs tab
      // doesn't keep showing stale JQL-discovered issues after the query is removed.
      ...(trimmedJql !== undefined ? { jiraJql: trimmedJql, ...(trimmedJql === null ? { jqlDiscoveredKeys: '[]' } : {}) } : {}),
      ...(trimmedDriveUrl !== undefined ? { driveFolderUrl: trimmedDriveUrl } : {}),
      ...(dueDate !== undefined ? { dueDate: dueDate ? new Date(dueDate) : null } : {}),
    },
  });
  res.json({ cycle });
}) as RequestHandler);

// ── PATCH /:cycleId/status — PLANNING/ACTIVE/CLOSED transitions ────────────

router.patch('/:cycleId/status', requireAdvancedFeatures as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const { cycleId } = req.params;
  const parsed = StatusTransitionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }
  const existing = await prisma.testCycle.findFirst({ where: { id: cycleId, projectId } });
  if (!existing) return res.status(404).json({ error: 'Test cycle not found' });

  const cycle = await prisma.testCycle.update({
    where: { id: cycleId },
    data: {
      status:   parsed.data.status,
      closedAt: parsed.data.status === 'CLOSED' ? new Date() : null,
    },
  });
  res.json({ cycle });
}) as RequestHandler);

// ── DELETE /:cycleId ─────────────────────────────────────────────────────────

router.delete('/:cycleId', requireAdvancedFeatures as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const { cycleId } = req.params;
  const existing = await prisma.testCycle.findFirst({ where: { id: cycleId, projectId } });
  if (!existing) return res.status(404).json({ error: 'Test cycle not found' });
  await prisma.testCycle.delete({ where: { id: cycleId } });
  res.json({ message: 'Test cycle deleted' });
}) as RequestHandler);

// ── PATCH /:cycleId/items — add more test cases to an existing cycle ───────

router.patch('/:cycleId/items', requireAdvancedFeatures as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const { cycleId } = req.params;
  const parsed = AddItemsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }
  const cycle = await prisma.testCycle.findFirst({ where: { id: cycleId, projectId } });
  if (!cycle) return res.status(404).json({ error: 'Test cycle not found' });

  const existingItems = await prisma.testCycleItem.findMany({
    where: { testCycleId: cycleId },
    select: { testCaseId: true, sortOrder: true },
  });
  const existingIds = new Set(existingItems.map((i) => i.testCaseId));
  const maxSortOrder = existingItems.reduce((m, i) => Math.max(m, i.sortOrder), -1);

  const newTestCaseIds = parsed.data.testCaseIds.filter((id) => !existingIds.has(id));
  if (newTestCaseIds.length === 0) {
    return res.status(400).json({ error: 'All selected test cases are already in this cycle' });
  }

  const testCases = await prisma.tcItem.findMany({
    where: { id: { in: newTestCaseIds }, projectId },
    select: { id: true },
  });
  const validNewIds = new Set(testCases.map((tc) => tc.id));
  const orderedNewIds = newTestCaseIds.filter((id) => validNewIds.has(id));

  await prisma.testCycleItem.createMany({
    data: orderedNewIds.map((id, i) => ({
      projectId,
      testCycleId: cycleId,
      testCaseId:  id,
      sortOrder:   maxSortOrder + 1 + i,
    })),
  });

  res.status(201).json({ added: orderedNewIds.length });
}) as RequestHandler);

// ── DELETE /:cycleId/items/:itemId — remove a single test case from a cycle ─
// Only detaches it from this cycle (deletes the TestCycleItem row, cascading
// its TestCycleItemHistory) — the underlying TcItem in TC Library is untouched.

router.delete('/:cycleId/items/:itemId', requireAdvancedFeatures as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const { cycleId, itemId } = req.params;

  const item = await prisma.testCycleItem.findFirst({ where: { id: itemId, testCycleId: cycleId, projectId } });
  if (!item) return res.status(404).json({ error: 'Test cycle item not found' });

  await prisma.testCycleItem.delete({ where: { id: itemId } });
  res.json({ message: 'Test case removed from cycle' });
}) as RequestHandler);

// ── DELETE /:cycleId/items — bulk-remove test cases from a cycle ───────────
// Powers the Test Cases tab's multi-select (individual rows or a whole
// feature group at once) — same cascade/scope semantics as the single-item
// delete above, just batched into one call.

router.delete('/:cycleId/items', requireAdvancedFeatures as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const { cycleId } = req.params;
  const parsed = BulkRemoveItemsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }

  const result = await prisma.testCycleItem.deleteMany({
    where: { id: { in: parsed.data.itemIds }, testCycleId: cycleId, projectId },
  });
  res.json({ removed: result.count });
}) as RequestHandler);

// ── PATCH /:cycleId/items/:itemId/assign — assign a project member ─────────
// Open to any project member (requireWrite), not admin-gated — any team
// member should be able to assign work to a peer.

router.patch('/:cycleId/items/:itemId/assign', requireWrite as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const { cycleId, itemId } = req.params;
  const parsed = AssignItemSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }

  const item = await prisma.testCycleItem.findFirst({ where: { id: itemId, testCycleId: cycleId, projectId } });
  if (!item) return res.status(404).json({ error: 'Test cycle item not found' });

  // TEST_USER may only assign test cases to themselves — never to a peer.
  // Global SUPER_ADMIN/ADMIN and project ADMIN/SUPER_USER are unaffected.
  const isTestUser = req.projectMember?.role === 'TEST_USER'
    && req.user.globalRole !== 'SUPER_ADMIN' && req.user.globalRole !== 'ADMIN';
  if (isTestUser && parsed.data.assigneeUserId && parsed.data.assigneeUserId !== req.user.id) {
    return res.status(403).json({ error: 'You can only assign test cases to yourself' });
  }

  let assigneeId: string | null = null;
  if (parsed.data.assigneeUserId) {
    const member = await prisma.projectMember.findFirst({
      where: { projectId, userId: parsed.data.assigneeUserId },
    });
    if (!member) {
      return res.status(400).json({ error: 'That user is not a member of this project' });
    }
    assigneeId = member.id;
  }

  const updated = await prisma.testCycleItem.update({
    where: { id: itemId },
    data: { assigneeId, lastUpdatedByUserId: req.user.id, lastUpdatedAt: new Date() },
    include: { assignee: { include: { user: { select: { id: true, name: true, email: true } } } } },
  });
  res.json({ item: updated });
}) as RequestHandler);

// ── PATCH /:cycleId/items/assign — bulk-assign selected items to one member ─
// Same rules as the single-item version above (open to any project writer;
// TEST_USER may only assign to themselves), applied across the whole batch.

router.patch('/:cycleId/items/assign', requireWrite as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const { cycleId } = req.params;
  const parsed = BulkAssignItemsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }
  const { itemIds, assigneeUserId } = parsed.data;

  const isTestUser = req.projectMember?.role === 'TEST_USER'
    && req.user.globalRole !== 'SUPER_ADMIN' && req.user.globalRole !== 'ADMIN';
  if (isTestUser && assigneeUserId && assigneeUserId !== req.user.id) {
    return res.status(403).json({ error: 'You can only assign test cases to yourself' });
  }

  let assigneeId: string | null = null;
  if (assigneeUserId) {
    const member = await prisma.projectMember.findFirst({ where: { projectId, userId: assigneeUserId } });
    if (!member) return res.status(400).json({ error: 'That user is not a member of this project' });
    assigneeId = member.id;
  }

  const result = await prisma.testCycleItem.updateMany({
    where: { id: { in: itemIds }, testCycleId: cycleId, projectId },
    data: { assigneeId, lastUpdatedByUserId: req.user.id, lastUpdatedAt: new Date() },
  });
  res.json({ updated: result.count });
}) as RequestHandler);

// ── PATCH /:cycleId/items/:itemId/status — record a manual result ──────────
// Gated by requireWrite at the role level, plus a row-level ownership check
// below (the assignee, or ADMIN/SUPER_USER/global-SUPER_ADMIN) — this can't
// be expressed as generic role middleware since it depends on the fetched row.

router.patch('/:cycleId/items/:itemId/status', requireWrite as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const { cycleId, itemId } = req.params;
  const parsed = UpdateItemStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }

  const item = await prisma.testCycleItem.findFirst({ where: { id: itemId, testCycleId: cycleId, projectId } });
  if (!item) return res.status(404).json({ error: 'Test cycle item not found' });

  const cycle = await prisma.testCycle.findFirst({ where: { id: cycleId, projectId } });
  if (!cycle) return res.status(404).json({ error: 'Test cycle not found' });

  // Hard business-rule gates — apply to every role, no privileged bypass:
  // a result recorded before the cycle is officially started, or against an
  // unassigned item, isn't a meaningful test result.
  if (cycle.status === 'PLANNING') {
    return res.status(409).json({ error: 'This test cycle has not started yet. Start the cycle before recording results.' });
  }
  if (!item.assigneeId) {
    return res.status(409).json({ error: 'Assign this test case to a resource before recording a result.' });
  }

  const isPrivileged =
    req.user.globalRole === 'SUPER_ADMIN' ||
    req.user.globalRole === 'ADMIN' ||
    req.projectMember?.role === 'ADMIN' ||
    req.projectMember?.role === 'SUPER_USER';
  const isAssignee = !!req.projectMember && req.projectMember.id === item.assigneeId;

  if (!isPrivileged && !isAssignee) {
    return res.status(403).json({ error: 'Only the assigned resource may update this test result' });
  }

  const jiraIssueKeysJson = JSON.stringify(parsed.data.jiraIssueKeys ?? []);
  const [updated] = await prisma.$transaction([
    prisma.testCycleItem.update({
      where: { id: itemId },
      data: {
        manualStatus:        parsed.data.status,
        reason:              parsed.data.reason ?? null,
        jiraIssueKeys:       jiraIssueKeysJson,
        lastUpdatedByUserId: req.user.id,
        lastUpdatedAt:       new Date(),
      },
    }),
    // Append-only audit row — powers the resource-wise daily trend dashboard.
    prisma.testCycleItemHistory.create({
      data: {
        projectId,
        testCycleId:     cycleId,
        testCycleItemId: itemId,
        testCaseId:      item.testCaseId,
        assigneeId:      item.assigneeId,
        fromStatus:      item.manualStatus,
        toStatus:        parsed.data.status,
        reason:          parsed.data.reason ?? null,
        jiraIssueKeys:   jiraIssueKeysJson,
        changedByUserId: req.user.id,
      },
    }),
  ]);
  res.json({ item: updated });
}) as RequestHandler);

// ── GET /:cycleId/bugs — all Jira bugs relevant to this cycle ──────────────
// Unions three sources so a tester forgetting to link a bug doesn't lose it:
//  1. Explicitly linked keys (TestCycleItem.jiraIssueKeys + TestCycle.linkedJiraKeys)
//  2. Label-matched keys from the local cache (populated by the sync/poll —
//     never fetched live here) whose labels intersect this cycle's jiraLabels.
//  3. This cycle's custom-JQL matches, snapshotted onto jqlDiscoveredKeys by
//     the same sync/poll (JQL matches can't be re-derived from cached fields
//     the way label matches can, so they're cached as a key list instead).
// Bugs with no testCases yet are discovered-but-unlinked — the frontend
// offers a "link to test case" action on those.

router.get('/:cycleId/bugs', (async (req, res) => {
  const projectId = req.project.id;
  const { cycleId } = req.params;
  const cycle = await prisma.testCycle.findFirst({ where: { id: cycleId, projectId } });
  if (!cycle) return res.status(404).json({ error: 'Test cycle not found' });

  const items = await prisma.testCycleItem.findMany({
    where: { testCycleId: cycleId, NOT: { jiraIssueKeys: '[]' } },
    include: { testCase: { select: { id: true, srNo: true, title: true } } },
  });

  const keySet = new Set<string>();
  for (const item of items) {
    try {
      (JSON.parse(item.jiraIssueKeys) as string[]).forEach((k) => keySet.add(k));
    } catch { /* corrupted row — skip */ }
  }
  try {
    (JSON.parse(cycle.linkedJiraKeys) as string[]).forEach((k) => keySet.add(k));
  } catch { /* corrupted row — skip */ }
  try {
    (JSON.parse(cycle.jqlDiscoveredKeys) as string[]).forEach((k) => keySet.add(k));
  } catch { /* corrupted row — skip */ }

  let cycleLabels: string[] = [];
  try { cycleLabels = JSON.parse(cycle.jiraLabels); } catch { /* corrupted row — skip */ }

  // Pull every cached issue for the project once, then filter in JS — labels
  // are stored as a JSON string, not a queryable column.
  const allCachedIssues = await prisma.jiraIssue.findMany({ where: { projectId } });
  if (cycleLabels.length > 0) {
    for (const issue of allCachedIssues) {
      if (issue.issueType !== 'Bug') continue;
      let issueLabels: string[] = [];
      try { issueLabels = JSON.parse(issue.labels); } catch { continue; }
      if (issueLabels.some((l) => cycleLabels.includes(l))) keySet.add(issue.issueKey);
    }
  }

  const issueByKey = new Map(allCachedIssues.map((i) => [i.issueKey, i]));

  const bugs = [...keySet].map((key) => ({
    issueKey: key,
    issue:    issueByKey.get(key) ?? null,
    testCases: items
      .filter((item) => {
        try { return (JSON.parse(item.jiraIssueKeys) as string[]).includes(key); }
        catch { return false; }
      })
      .map((item) => item.testCase),
  }));

  res.json({ bugs });
}) as RequestHandler);

// ── POST /:cycleId/bugs/:issueKey/link — retroactively attach a bug to a
// test case (e.g. one discovered via label match, or the tester simply
// forgot to type the key when marking the result Fail/Blocked). Same
// row-level ownership check as the status-update endpoint.

router.post('/:cycleId/bugs/:issueKey/link', requireWrite as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const { cycleId, issueKey } = req.params;
  const parsed = LinkBugSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }

  const item = await prisma.testCycleItem.findFirst({
    where: { id: parsed.data.testCycleItemId, testCycleId: cycleId, projectId },
  });
  if (!item) return res.status(404).json({ error: 'Test cycle item not found' });

  const isPrivileged =
    req.user.globalRole === 'SUPER_ADMIN' ||
    req.user.globalRole === 'ADMIN' ||
    req.projectMember?.role === 'ADMIN' ||
    req.projectMember?.role === 'SUPER_USER';
  const isAssignee = !!req.projectMember && req.projectMember.id === item.assigneeId;
  if (!isPrivileged && !isAssignee) {
    return res.status(403).json({ error: 'Only the assigned resource may link a bug to this test result' });
  }

  let keys: string[] = [];
  try { keys = JSON.parse(item.jiraIssueKeys); } catch { /* corrupted row — start fresh */ }
  if (!keys.includes(issueKey)) keys.push(issueKey);

  const updated = await prisma.testCycleItem.update({
    where: { id: item.id },
    data: { jiraIssueKeys: JSON.stringify(keys), lastUpdatedByUserId: req.user.id, lastUpdatedAt: new Date() },
  });
  res.json({ item: updated });
}) as RequestHandler);

// ── DELETE /:cycleId/bugs/:issueKey/link — detach a bug from a test case.
// Symmetric to the POST above and same ownership rule — needed so a bug
// that was wrongly linked (e.g. during a since-corrected bad-label window,
// or just a mis-click) can be removed without touching the rest of the
// test case's data. Only removes this one explicit link; if the bug is
// still label/JQL-matched it can keep showing up as discovered-but-unlinked.

router.delete('/:cycleId/bugs/:issueKey/link', requireWrite as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const { cycleId, issueKey } = req.params;
  const parsed = LinkBugSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }

  const item = await prisma.testCycleItem.findFirst({
    where: { id: parsed.data.testCycleItemId, testCycleId: cycleId, projectId },
  });
  if (!item) return res.status(404).json({ error: 'Test cycle item not found' });

  const isPrivileged =
    req.user.globalRole === 'SUPER_ADMIN' ||
    req.user.globalRole === 'ADMIN' ||
    req.projectMember?.role === 'ADMIN' ||
    req.projectMember?.role === 'SUPER_USER';
  const isAssignee = !!req.projectMember && req.projectMember.id === item.assigneeId;
  if (!isPrivileged && !isAssignee) {
    return res.status(403).json({ error: 'Only the assigned resource may unlink a bug from this test result' });
  }

  let keys: string[] = [];
  try { keys = JSON.parse(item.jiraIssueKeys); } catch { /* corrupted row — start fresh */ }
  keys = keys.filter((k) => k !== issueKey);

  const updated = await prisma.testCycleItem.update({
    where: { id: item.id },
    data: { jiraIssueKeys: JSON.stringify(keys), lastUpdatedByUserId: req.user.id, lastUpdatedAt: new Date() },
  });
  res.json({ item: updated });
}) as RequestHandler);

export default router;
