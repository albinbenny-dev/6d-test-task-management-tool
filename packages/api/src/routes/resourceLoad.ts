import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';

// ── Resource Load — global, cross-project workload view ─────────────────────
// One row per person (merged across every project they're a member of), split
// into Tasks and Tests. Restricted to global SUPER_ADMIN / ADMIN: it exposes
// every project's assignments at once, which project-level roles must not see.
//
// Definitions (fixed by product decision):
//   Task  open = status != DONE, closed = DONE (all-time), overdue = open && dueDate < now
//   Test  counted only for items in ACTIVE cycles. open = NOT_RUN | IN_PROGRESS,
//         closed = PASS | FAIL | BLOCKED, overdue = open && cycle.dueDate < now
//         (items have no due date of their own — the cycle's date applies).

const router = Router();
router.use(verifyToken as RequestHandler);

function requireGlobalAdmin(req: Request, res: Response, next: NextFunction): void {
  const role = req.user.globalRole;
  if (role !== 'SUPER_ADMIN' && role !== 'ADMIN') {
    res.status(403).json({ error: 'SUPER_ADMIN or ADMIN role is required' });
    return;
  }
  next();
}
router.use(requireGlobalAdmin as RequestHandler);

const TASK_STATUSES = ['TO_DO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'] as const;
const TEST_STATUSES = ['NOT_RUN', 'IN_PROGRESS', 'PASS', 'FAIL', 'BLOCKED'] as const;
const TEST_OPEN = ['NOT_RUN', 'IN_PROGRESS'];
const TEST_CLOSED = ['PASS', 'FAIL', 'BLOCKED'];

const zeroed = <T extends readonly string[]>(keys: T) =>
  Object.fromEntries(keys.map((k) => [k, 0])) as Record<T[number], number>;

function emptyTaskBlock() {
  return { ...zeroed(TASK_STATUSES), overdue: 0 };
}
function emptyTestBlock() {
  return { ...zeroed(TEST_STATUSES), overdue: 0 };
}

// Resource keys: a user id, or the two synthetic buckets.
const UNASSIGNED = 'unassigned';
const EXTERNAL = 'external';

// ── GET /resource-load ──────────────────────────────────────────────────────
router.get('/', (async (_req, res) => {
  const now = new Date();

  const [taskGroups, taskOverdue, testGroups, testOverdue, members, projects] = await Promise.all([
    prisma.task.groupBy({
      by: ['assigneeId', 'assigneeExternalName', 'projectId', 'status'],
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ['assigneeId', 'assigneeExternalName', 'projectId'],
      where: { status: { not: 'DONE' }, dueDate: { lt: now } },
      _count: { _all: true },
    }),
    prisma.testCycleItem.groupBy({
      by: ['assigneeId', 'projectId', 'manualStatus'],
      where: { testCycle: { status: 'ACTIVE' } },
      _count: { _all: true },
    }),
    prisma.testCycleItem.groupBy({
      by: ['assigneeId', 'projectId'],
      where: {
        manualStatus: { in: TEST_OPEN },
        testCycle: { status: 'ACTIVE', dueDate: { lt: now } },
      },
      _count: { _all: true },
    }),
    prisma.projectMember.findMany({
      select: { id: true, user: { select: { id: true, name: true, email: true } } },
    }),
    prisma.project.findMany({ select: { id: true, name: true, slug: true } }),
  ]);

  const memberUser = new Map(members.map((m) => [m.id, m.user]));
  const projectById = new Map(projects.map((p) => [p.id, p]));

  type ProjectRow = {
    projectId: string; slug: string; name: string;
    tasks: ReturnType<typeof emptyTaskBlock>;
    tests: ReturnType<typeof emptyTestBlock>;
  };
  type Resource = {
    key: string; userId: string | null; name: string; email: string | null;
    kind: 'user' | 'external' | 'unassigned';
    projects: Map<string, ProjectRow>;
  };
  const resources = new Map<string, Resource>();

  function resourceFor(assigneeId: string | null, externalName: string | null): Resource {
    let key: string; let userId: string | null = null; let name: string; let email: string | null = null;
    let kind: Resource['kind'];
    if (assigneeId && memberUser.has(assigneeId)) {
      const u = memberUser.get(assigneeId)!;
      key = u.id; userId = u.id; name = u.name; email = u.email; kind = 'user';
    } else if (externalName) {
      key = EXTERNAL; name = 'External (not in tool)'; kind = 'external';
    } else {
      key = UNASSIGNED; name = 'Unassigned'; kind = 'unassigned';
    }
    let r = resources.get(key);
    if (!r) { r = { key, userId, name, email, kind, projects: new Map() }; resources.set(key, r); }
    return r;
  }
  function projectRow(r: Resource, projectId: string): ProjectRow {
    let row = r.projects.get(projectId);
    if (!row) {
      const p = projectById.get(projectId);
      row = {
        projectId, slug: p?.slug ?? '', name: p?.name ?? 'Unknown',
        tasks: emptyTaskBlock(), tests: emptyTestBlock(),
      };
      r.projects.set(projectId, row);
    }
    return row;
  }

  for (const g of taskGroups) {
    const row = projectRow(resourceFor(g.assigneeId, g.assigneeExternalName), g.projectId);
    if (g.status in row.tasks) row.tasks[g.status as (typeof TASK_STATUSES)[number]] += g._count._all;
  }
  for (const g of taskOverdue) {
    projectRow(resourceFor(g.assigneeId, g.assigneeExternalName), g.projectId).tasks.overdue += g._count._all;
  }
  for (const g of testGroups) {
    const row = projectRow(resourceFor(g.assigneeId, null), g.projectId);
    if (g.manualStatus in row.tests) row.tests[g.manualStatus as (typeof TEST_STATUSES)[number]] += g._count._all;
  }
  for (const g of testOverdue) {
    projectRow(resourceFor(g.assigneeId, null), g.projectId).tests.overdue += g._count._all;
  }

  const data = [...resources.values()].map((r) => {
    const projectRows = [...r.projects.values()].sort((a, b) => a.name.localeCompare(b.name));
    const tasks = emptyTaskBlock();
    const tests = emptyTestBlock();
    for (const p of projectRows) {
      for (const s of TASK_STATUSES) tasks[s] += p.tasks[s];
      tasks.overdue += p.tasks.overdue;
      for (const s of TEST_STATUSES) tests[s] += p.tests[s];
      tests.overdue += p.tests.overdue;
    }
    return {
      key: r.key, userId: r.userId, name: r.name, email: r.email, kind: r.kind,
      tasks: {
        ...tasks,
        open: tasks.TO_DO + tasks.IN_PROGRESS + tasks.IN_REVIEW,
        closed: tasks.DONE,
      },
      tests: {
        ...tests,
        open: tests.NOT_RUN + tests.IN_PROGRESS,
        closed: tests.PASS + tests.FAIL + tests.BLOCKED,
      },
      projects: projectRows.map((p) => ({
        projectId: p.projectId, slug: p.slug, name: p.name,
        tasks: { ...p.tasks, open: p.tasks.TO_DO + p.tasks.IN_PROGRESS + p.tasks.IN_REVIEW, closed: p.tasks.DONE },
        tests: { ...p.tests, open: p.tests.NOT_RUN + p.tests.IN_PROGRESS, closed: p.tests.PASS + p.tests.FAIL + p.tests.BLOCKED },
      })),
    };
  });

  res.json({
    data,
    projects: projects.sort((a, b) => a.name.localeCompare(b.name)),
    generatedAt: now.toISOString(),
  });
}) as RequestHandler);

// ── GET /resource-load/items — the records behind a clicked count ───────────
const ItemsQuery = z.object({
  kind: z.enum(['task', 'test']),
  resource: z.string().min(1),          // user id | 'unassigned' | 'external'
  projectId: z.string().optional(),
  // task: open | closed | overdue | <status>; test: open | closed | overdue | <status> | all
  bucket: z.string().default('open'),
});

const ITEM_LIMIT = 500;

router.get('/items', (async (req, res) => {
  const parsed = ItemsQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { kind, resource, projectId, bucket } = parsed.data;
  const now = new Date();

  // Which ProjectMember rows does this resource map to?
  let assigneeFilter: { assigneeId: string | { in: string[] } | null; assigneeExternalName?: { not: null } };
  if (resource === UNASSIGNED) {
    assigneeFilter = { assigneeId: null };
  } else if (resource === EXTERNAL) {
    assigneeFilter = { assigneeId: null, assigneeExternalName: { not: null } };
  } else {
    const memberIds = (
      await prisma.projectMember.findMany({
        where: { userId: resource, ...(projectId ? { projectId } : {}) },
        select: { id: true },
      })
    ).map((m) => m.id);
    assigneeFilter = { assigneeId: { in: memberIds } };
  }

  if (kind === 'task') {
    const where: Record<string, unknown> = { ...assigneeFilter, ...(projectId ? { projectId } : {}) };
    if (resource === UNASSIGNED) where.assigneeExternalName = null;
    if (bucket === 'open') where.status = { not: 'DONE' };
    else if (bucket === 'closed') where.status = 'DONE';
    else if (bucket === 'overdue') { where.status = { not: 'DONE' }; where.dueDate = { lt: now }; }
    else if ((TASK_STATUSES as readonly string[]).includes(bucket)) where.status = bucket;

    const tasks = await prisma.task.findMany({
      where,
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { updatedAt: 'desc' }],
      take: ITEM_LIMIT,
      select: {
        id: true, title: true, status: true, priority: true, dueDate: true, taskListId: true,
        assigneeExternalName: true,
        taskList: { select: { name: true } },
        project: { select: { id: true, name: true, slug: true } },
      },
    });
    res.json({
      items: tasks.map((t) => ({
        id: t.id, title: t.title, status: t.status, priority: t.priority,
        dueDate: t.dueDate, taskListId: t.taskListId, listName: t.taskList.name,
        project: t.project,
        overdue: t.status !== 'DONE' && !!t.dueDate && t.dueDate < now,
      })),
      truncated: tasks.length === ITEM_LIMIT,
    });
    return;
  }

  // Unassigned / external tests: external names don't exist on test items.
  if (resource === EXTERNAL) { res.json({ items: [], truncated: false }); return; }

  const where: Record<string, unknown> = {
    assigneeId: assigneeFilter.assigneeId,
    testCycle: { status: 'ACTIVE' } as Record<string, unknown>,
    ...(projectId ? { projectId } : {}),
  };
  if (bucket === 'open') where.manualStatus = { in: TEST_OPEN };
  else if (bucket === 'closed') where.manualStatus = { in: TEST_CLOSED };
  else if (bucket === 'overdue') {
    where.manualStatus = { in: TEST_OPEN };
    (where.testCycle as Record<string, unknown>).dueDate = { lt: now };
  } else if ((TEST_STATUSES as readonly string[]).includes(bucket)) where.manualStatus = bucket;

  const items = await prisma.testCycleItem.findMany({
    where,
    orderBy: [{ testCycle: { dueDate: { sort: 'asc', nulls: 'last' } } }, { sortOrder: 'asc' }],
    take: ITEM_LIMIT,
    select: {
      id: true, manualStatus: true, testCycleId: true,
      testCase: { select: { srNo: true, title: true } },
      testCycle: { select: { name: true, dueDate: true } },
      project: { select: { id: true, name: true, slug: true } },
    },
  });
  res.json({
    items: items.map((i) => ({
      id: i.id, title: i.testCase.title, srNo: i.testCase.srNo, status: i.manualStatus,
      cycleId: i.testCycleId, cycleName: i.testCycle.name, dueDate: i.testCycle.dueDate,
      project: i.project,
      overdue: TEST_OPEN.includes(i.manualStatus) && !!i.testCycle.dueDate && i.testCycle.dueDate < now,
    })),
    truncated: items.length === ITEM_LIMIT,
  });
}) as RequestHandler);

export default router;
