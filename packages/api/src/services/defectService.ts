import { prisma } from '../lib/prisma.js';

// ── Project Defects dashboard — the union that powers it ───────────────────
// Same three explicit/label/JQL discovery shape as testCycles.ts's `GET /bugs`
// (cycle-scoped), plus two additional sources that aren't tied to any one
// cycle: JiraConfig.labels (project-wide label discovery) and
// JiraConfig.jqlDiscoveredKeys (project-wide custom JQL, cached at sync time
// by jiraService.syncIssuesForProject). Kept as its own service/route rather
// than folding into testCycles.ts's existing `/bugs` endpoint so the working
// AllBugsSection UI (which calls that endpoint) is untouched by this change.

export type DefectSource = 'linked' | 'label' | 'jql';

// One TestCycleItem's execution of a linked test case — enough for the
// frontend to both display it AND change its manual result directly (the
// "TC_ID" link opens the test case modal with this as execution context),
// without a second round-trip to fetch the TestCycleItem itself.
export interface LinkedTestCaseExecution {
  id:              string; // TcItem id
  srNo:            string | null;
  title:           string;
  testCycleItemId: string;
  testCycleId:     string;
  cycleName:       string | null;
  // Prisma types this as a plain string (see schema.prisma's comment on
  // enum-like fields) — the frontend's ManualResultStatus union is the
  // actual contract, enforced by the Zod schema on write, not by this type.
  manualStatus:    string;
  reason:          string | null;
  jiraIssueKeys:   string; // JSON string array
}

export interface ProjectDefect {
  issueKey: string;
  issue: {
    issueKey:       string;
    summary:        string | null;
    status:         string | null;
    statusCategory: string | null;
    issueType:      string | null;
    priorityName:   string | null;
    severityName:   string | null;
    labels:         string[];
    components:     string[];
    assigneeName:   string | null;
    reporterName:   string | null;
    dueDate:        Date | null;
    jiraCreatedAt:  Date | null;
    jiraUpdatedAt:  Date | null;
    lastSyncedAt:   Date;
  } | null;
  testCases:  LinkedTestCaseExecution[];
  testCycles: { id: string; name: string }[];
  sources:    DefectSource[];
}

function safeParseArray(json: string): string[] {
  try { return JSON.parse(json); } catch { return []; }
}

export async function getProjectDefects(projectId: string): Promise<ProjectDefect[]> {
  const [cycles, itemsWithKeys, allCachedIssues, config] = await Promise.all([
    prisma.testCycle.findMany({ where: { projectId } }),
    prisma.testCycleItem.findMany({
      where: { projectId, NOT: { jiraIssueKeys: '[]' } },
      include: { testCase: { select: { id: true, srNo: true, title: true } } },
    }),
    prisma.jiraIssue.findMany({ where: { projectId } }),
    prisma.jiraConfig.findUnique({ where: { projectId } }),
  ]);

  const cycleById = new Map(cycles.map((c) => [c.id, c]));

  const cycleIdsByKey = new Map<string, Set<string>>();
  // Keyed by TestCycleItem id (not TcItem id) — the same test case executed
  // in two different cycles, both linked to the same bug, must surface as
  // two separate entries here, or one of those executions silently vanishes
  // from the dashboard and can never be retested from it.
  const testCasesByKey = new Map<string, Map<string, LinkedTestCaseExecution>>();
  const sourcesByKey = new Map<string, Set<DefectSource>>();

  function touchKey(key: string) {
    if (!cycleIdsByKey.has(key)) cycleIdsByKey.set(key, new Set());
  }
  function linkKeyToCycle(key: string, cycleId: string) {
    touchKey(key);
    cycleIdsByKey.get(key)!.add(cycleId);
  }
  function addSource(key: string, source: DefectSource) {
    touchKey(key);
    if (!sourcesByKey.has(key)) sourcesByKey.set(key, new Set());
    sourcesByKey.get(key)!.add(source);
  }

  // Explicit links — a tester typed a Jira key onto a result or the cycle.
  for (const item of itemsWithKeys) {
    let keys: string[] = [];
    try { keys = JSON.parse(item.jiraIssueKeys) as string[]; } catch { continue; }
    for (const key of keys) {
      linkKeyToCycle(key, item.testCycleId);
      addSource(key, 'linked');
      if (!testCasesByKey.has(key)) testCasesByKey.set(key, new Map());
      testCasesByKey.get(key)!.set(item.id, {
        id: item.testCase.id,
        srNo: item.testCase.srNo,
        title: item.testCase.title,
        testCycleItemId: item.id,
        testCycleId: item.testCycleId,
        cycleName: cycleById.get(item.testCycleId)?.name ?? null,
        manualStatus: item.manualStatus,
        reason: item.reason,
        jiraIssueKeys: item.jiraIssueKeys,
      });
    }
  }

  for (const cycle of cycles) {
    try { (JSON.parse(cycle.linkedJiraKeys) as string[]).forEach((k) => { linkKeyToCycle(k, cycle.id); addSource(k, 'linked'); }); } catch { /* skip */ }
    try { (JSON.parse(cycle.jqlDiscoveredKeys) as string[]).forEach((k) => { linkKeyToCycle(k, cycle.id); addSource(k, 'jql'); }); } catch { /* skip */ }

    let cycleLabels: string[] = [];
    try { cycleLabels = JSON.parse(cycle.jiraLabels); } catch { /* skip */ }
    if (cycleLabels.length > 0) {
      for (const issue of allCachedIssues) {
        if (issue.issueType !== 'Bug') continue;
        const issueLabels = safeParseArray(issue.labels);
        if (issueLabels.some((l) => cycleLabels.includes(l))) {
          linkKeyToCycle(issue.issueKey, cycle.id);
          addSource(issue.issueKey, 'label');
        }
      }
    }
  }

  // Project-wide (Defects dashboard) discovery — not tied to any one cycle,
  // so these keys may end up with an empty testCycles list below.
  const projectLabels = safeParseArray(config?.labels ?? '[]');
  if (projectLabels.length > 0) {
    for (const issue of allCachedIssues) {
      if (issue.issueType !== 'Bug') continue;
      const issueLabels = safeParseArray(issue.labels);
      if (issueLabels.some((l) => projectLabels.includes(l))) addSource(issue.issueKey, 'label');
    }
  }
  safeParseArray(config?.jqlDiscoveredKeys ?? '[]').forEach((k) => addSource(k, 'jql'));

  const issueByKey = new Map(allCachedIssues.map((i) => [i.issueKey, i]));

  return [...cycleIdsByKey.entries()].map(([key, cycleIdSet]) => {
    const raw = issueByKey.get(key) ?? null;
    return {
      issueKey: key,
      issue: raw ? {
        issueKey:       raw.issueKey,
        summary:        raw.summary,
        status:         raw.status,
        statusCategory: raw.statusCategory,
        issueType:      raw.issueType,
        priorityName:   raw.priorityName,
        severityName:   raw.severityName,
        labels:         safeParseArray(raw.labels),
        components:     safeParseArray(raw.components),
        assigneeName:   raw.assigneeName,
        reporterName:   raw.reporterName,
        dueDate:        raw.dueDate,
        jiraCreatedAt:  raw.jiraCreatedAt,
        jiraUpdatedAt:  raw.jiraUpdatedAt,
        lastSyncedAt:   raw.lastSyncedAt,
      } : null,
      testCases:  [...(testCasesByKey.get(key)?.values() ?? [])],
      testCycles: [...cycleIdSet]
        .map((id) => cycleById.get(id))
        .filter((c): c is NonNullable<typeof c> => !!c)
        .map((c) => ({ id: c.id, name: c.name })),
      sources: [...(sourcesByKey.get(key) ?? [])],
    };
  });
}
