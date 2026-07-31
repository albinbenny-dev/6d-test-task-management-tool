import { prisma } from '../lib/prisma.js';

// ── Jira Cloud integration ───────────────────────────────────────────────────
// Credentials come from global env vars (JIRA_HOST/JIRA_EMAIL/JIRA_API_TOKEN,
// already documented in .env.example for a never-built "Writer Agent" feature)
// rather than a per-project encrypted DB config — this reuses that existing,
// single-Jira-tenant convention instead of inventing a second credentials
// store. Per-project settings (which Jira project's issues are relevant,
// whether polling is enabled, cadence) live in the JiraConfig Prisma model.
//
// Uses plain native fetch (no new HTTP dependency), mirroring the shape of
// spawnRunner() in jobs/runWorker.ts — manual auth header, explicit timeout.

const FETCH_TIMEOUT_MS = 15_000;
const BATCH_SIZE = 50; // practical JQL `IN (...)` clause size limit

const LABEL_DISCOVERY_MAX_ISSUES = 500; // hard cap on paginated label-search results per cycle per sync

export interface JiraIssueData {
  issueKey:       string;
  summary:        string | null;
  status:         string | null;
  statusCategory: string | null; // "new" | "indeterminate" | "done" — workflow-agnostic
  issueType:      string | null;
  priorityName:   string | null;
  labels:         string[];
  components:     string[];
  assigneeName:   string | null;
  reporterName:   string | null;
  severityName:   string | null; // Jira's "Severity" custom field — see getSeverityFieldId()
  jiraCreatedAt:  Date | null;
  dueDate:        Date | null;
  jiraUpdatedAt:  Date | null;
}

function getConfig(): { host: string; email: string; token: string } | null {
  const host  = process.env.JIRA_HOST;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!host || !email || !token) return null;
  return { host: host.replace(/\/+$/, ''), email, token };
}

export function isJiraConfigured(): boolean {
  return getConfig() !== null;
}

// The site URL alone (not the email/token) is safe to hand to the frontend —
// it's needed to build a "view in Jira" link (`${host}/browse/${issueKey}`),
// not a credential.
export function getJiraHost(): string | null {
  return getConfig()?.host ?? null;
}

function authHeader(email: string, token: string): string {
  return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
}

async function jiraFetch(path: string): Promise<Response> {
  const config = getConfig();
  if (!config) throw new Error('Jira is not configured (JIRA_HOST/JIRA_EMAIL/JIRA_API_TOKEN missing)');
  return fetch(`${config.host}${path}`, {
    headers: {
      Authorization: authHeader(config.email, config.token),
      Accept:        'application/json',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

// ── Connection test — GET /rest/api/3/myself ────────────────────────────────

export async function testConnection(): Promise<{ ok: boolean; error?: string; accountName?: string }> {
  if (!isJiraConfigured()) {
    return { ok: false, error: 'JIRA_HOST/JIRA_EMAIL/JIRA_API_TOKEN are not set' };
  }
  try {
    const res = await jiraFetch('/rest/api/3/myself');
    if (!res.ok) {
      return { ok: false, error: `Jira responded ${res.status} ${res.statusText}` };
    }
    const body = (await res.json()) as { displayName?: string };
    return { ok: true, accountName: body.displayName };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// ── Batch fetch by key — GET /rest/api/3/search?jql=key in (...) ───────────

interface RawJiraIssue {
  key: string;
  fields: {
    summary?: string;
    status?: { name?: string; statusCategory?: { key?: string } };
    issuetype?: { name?: string };
    priority?: { name?: string };
    labels?: string[];
    components?: { name?: string }[];
    assignee?: { displayName?: string } | null;
    reporter?: { displayName?: string } | null;
    created?: string;
    duedate?: string | null;
    updated?: string;
    // Custom fields (e.g. "Severity") are keyed by a per-site id like
    // "customfield_10050" — looked up by name at runtime, see getSeverityFieldId().
    [customFieldKey: string]: unknown;
  };
}

// Jira custom select fields return `{ value: "High" }`; a handful of setups
// return a plain string instead — accept both, anything else is "not set".
function extractCustomFieldValue(raw: unknown): string | null {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object' && 'value' in raw) {
    const value = (raw as { value?: unknown }).value;
    return typeof value === 'string' ? value : null;
  }
  return null;
}

function toIssueData(issue: RawJiraIssue, severityFieldId: string | null): JiraIssueData {
  return {
    issueKey:       issue.key,
    summary:        issue.fields.summary ?? null,
    status:         issue.fields.status?.name ?? null,
    statusCategory: issue.fields.status?.statusCategory?.key ?? null,
    issueType:      issue.fields.issuetype?.name ?? null,
    priorityName:   issue.fields.priority?.name ?? null,
    labels:         issue.fields.labels ?? [],
    components:     (issue.fields.components ?? []).map((c) => c.name).filter((n): n is string => !!n),
    assigneeName:   issue.fields.assignee?.displayName ?? null,
    reporterName:   issue.fields.reporter?.displayName ?? null,
    severityName:   severityFieldId ? extractCustomFieldValue(issue.fields[severityFieldId]) : null,
    jiraCreatedAt:  issue.fields.created ? new Date(issue.fields.created) : null,
    dueDate:        issue.fields.duedate ? new Date(issue.fields.duedate) : null,
    jiraUpdatedAt:  issue.fields.updated ? new Date(issue.fields.updated) : null,
  };
}

const BASE_SEARCH_FIELDS = 'summary,status,issuetype,priority,labels,components,assignee,reporter,created,duedate,updated';

// ── "Severity" custom-field discovery ───────────────────────────────────────
// Jira Cloud has no built-in Severity field — teams add it as a custom field,
// whose id (e.g. "customfield_10050") varies per site/project. Rather than
// hardcode an id (fragile, differs per Jira instance), look it up once by
// display name via the field-metadata endpoint and cache it for the process
// lifetime. Resolves to null (severity just won't populate) if no field is
// named "Severity" or the lookup fails — never blocks a sync.
let severityFieldIdCache: string | null | undefined; // undefined = not yet looked up

export async function getSeverityFieldId(): Promise<string | null> {
  if (severityFieldIdCache !== undefined) return severityFieldIdCache;
  if (!isJiraConfigured()) return null;
  try {
    const res = await jiraFetch('/rest/api/3/field');
    if (!res.ok) { severityFieldIdCache = null; return null; }
    const fields = (await res.json()) as { id: string; name?: string }[];
    severityFieldIdCache = fields.find((f) => f.name?.trim().toLowerCase() === 'severity')?.id ?? null;
  } catch {
    severityFieldIdCache = null;
  }
  return severityFieldIdCache;
}

async function runJqlSearch(jql: string, maxIssues: number): Promise<JiraIssueData[]> {
  const severityFieldId = await getSeverityFieldId();
  const searchFields = severityFieldId ? `${BASE_SEARCH_FIELDS},${severityFieldId}` : BASE_SEARCH_FIELDS;

  const results: JiraIssueData[] = [];
  let nextPageToken: string | undefined;

  while (results.length < maxIssues) {
    const pageSize = Math.min(BATCH_SIZE, maxIssues - results.length);
    let path = `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=${searchFields}&maxResults=${pageSize}`;
    if (nextPageToken) path += `&nextPageToken=${encodeURIComponent(nextPageToken)}`;

    const res = await jiraFetch(path);

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('Retry-After') ?? '0');
      throw Object.assign(new Error(`Jira rate limit hit (retry after ${retryAfter}s)`), { rateLimited: true, retryAfter });
    }
    if (!res.ok) {
      throw new Error(`Jira search failed: ${res.status} ${res.statusText}`);
    }

    const body = (await res.json()) as { issues: RawJiraIssue[]; isLast?: boolean; nextPageToken?: string };
    for (const issue of body.issues ?? []) results.push(toIssueData(issue, severityFieldId));

    if (body.isLast !== false || !body.nextPageToken) break; // no more pages
    nextPageToken = body.nextPageToken;
  }
  return results;
}

// ── Batch fetch by key — GET /rest/api/3/search/jql?jql=key in (...) ───────

export async function fetchIssuesByKeys(keys: string[]): Promise<JiraIssueData[]> {
  if (!isJiraConfigured() || keys.length === 0) return [];

  const results: JiraIssueData[] = [];
  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batch = keys.slice(i, i + BATCH_SIZE);
    const jql = `key in (${batch.join(',')})`;
    results.push(...await runJqlSearch(jql, batch.length));
  }
  return results;
}

// ── Label-based discovery — finds bugs even if no tester explicitly linked
// them, scoped to one Jira project key + label(s) + a date window (the
// cycle's active window) so the same reused opco label doesn't pull in
// every bug ever filed under it, including ones from unrelated past cycles.

function toJqlDateTime(d: Date): string {
  // Jira JQL accepts "YYYY-MM-DD HH:mm" for datetime comparisons.
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

export async function fetchIssuesByLabels(
  jiraProjectKey: string,
  labels: string[],
  since: Date | null,
  until: Date | null,
): Promise<JiraIssueData[]> {
  if (!isJiraConfigured() || labels.length === 0 || !jiraProjectKey) return [];

  const quotedLabels = labels.map((l) => `"${l.replace(/"/g, '\\"')}"`).join(',');
  const clauses = [
    `project = "${jiraProjectKey.replace(/"/g, '\\"')}"`,
    // Label discovery is meant to surface bugs a tester forgot to link, not
    // every Story/Task carrying the same opco label — without this, a label
    // shared across a whole release pulls in non-bug work items too.
    'issuetype = Bug',
    `labels in (${quotedLabels})`,
  ];
  // Cycle-level discovery bounds by the cycle's active window so a reused opco
  // label doesn't pull in unrelated past bugs; project-level (Defects dashboard)
  // discovery passes `since: null` — there's no cycle window to bound it by.
  if (since) clauses.push(`updated >= "${toJqlDateTime(since)}"`);
  if (until) clauses.push(`updated <= "${toJqlDateTime(until)}"`);
  const jql = clauses.join(' AND ');

  return runJqlSearch(jql, LABEL_DISCOVERY_MAX_ISSUES);
}

// ── Custom per-cycle JQL discovery — an admin-authored raw query, additive
// alongside label-based discovery for cases label matching can't express
// precisely. runJqlSearch already handles arbitrary JQL + pagination, so this
// is a thin pass-through; kept as its own export so call sites read as intent
// ("run this cycle's custom query"), not as generic plumbing reuse.

const JQL_DISCOVERY_MAX_ISSUES = 500;

export async function fetchIssuesByJql(jql: string): Promise<JiraIssueData[]> {
  if (!isJiraConfigured() || !jql.trim()) return [];
  return runJqlSearch(jql, JQL_DISCOVERY_MAX_ISSUES);
}

async function upsertIssues(projectId: string, issues: JiraIssueData[]): Promise<number> {
  // Dedupe by issueKey (an issue can be both explicitly linked and label-matched
  // in the same sync pass) before writing.
  const byKey = new Map<string, JiraIssueData>();
  for (const issue of issues) byKey.set(issue.issueKey, issue);

  await prisma.$transaction(
    [...byKey.values()].map((issue) => {
      const data = {
        summary:        issue.summary,
        status:         issue.status,
        statusCategory: issue.statusCategory,
        issueType:      issue.issueType,
        priorityName:   issue.priorityName,
        labels:         JSON.stringify(issue.labels),
        components:     JSON.stringify(issue.components),
        assigneeName:   issue.assigneeName,
        reporterName:   issue.reporterName,
        severityName:   issue.severityName,
        jiraCreatedAt:  issue.jiraCreatedAt,
        dueDate:        issue.dueDate,
        jiraUpdatedAt:  issue.jiraUpdatedAt,
        lastSyncedAt:   new Date(),
        syncError:      null,
      };
      return prisma.jiraIssue.upsert({
        where: { projectId_issueKey: { projectId, issueKey: issue.issueKey } },
        create: { projectId, issueKey: issue.issueKey, ...data },
        update: data,
      });
    }),
  );
  return byKey.size;
}

// ── Sync one project's Jira issues into the local JiraIssue cache ─────────
// Two independent discovery paths, both feeding the same cache:
//  1. Explicit — keys a tester typed onto a TestCycleItem or TestCycle.
//  2. Label-based — bugs never explicitly linked, found by querying Jira for
//     project + label(s) + the owning cycle's active date window, so a
//     tester who forgets to link a bug doesn't lose it: it still shows up
//     on the cycle's Bugs tab (unlinked, but visible) for later linking.

export async function syncIssuesForProject(projectId: string): Promise<{ synced: number; error?: string }> {
  const [items, cyclesWithKeys, config] = await Promise.all([
    prisma.testCycleItem.findMany({
      where: { projectId, NOT: { jiraIssueKeys: '[]' } },
      select: { jiraIssueKeys: true },
    }),
    prisma.testCycle.findMany({
      where: { projectId, NOT: { linkedJiraKeys: '[]' } },
      select: { linkedJiraKeys: true },
    }),
    prisma.jiraConfig.findUnique({ where: { projectId } }),
  ]);

  const keySet = new Set<string>();
  for (const item of items) {
    try { (JSON.parse(item.jiraIssueKeys) as string[]).forEach((k) => keySet.add(k)); } catch { /* skip */ }
  }
  for (const cycle of cyclesWithKeys) {
    try { (JSON.parse(cycle.linkedJiraKeys) as string[]).forEach((k) => keySet.add(k)); } catch { /* skip */ }
  }

  const labelCycles = await prisma.testCycle.findMany({
    where: { projectId, NOT: { jiraLabels: '[]' } },
    select: { id: true, jiraLabels: true, createdAt: true, closedAt: true },
  });

  const jqlCycles = await prisma.testCycle.findMany({
    where: { projectId, jiraJql: { not: null } },
    select: { id: true, jiraJql: true },
  });

  try {
    const allIssues: JiraIssueData[] = [];

    if (keySet.size > 0) {
      allIssues.push(...await fetchIssuesByKeys([...keySet]));
    }

    let projectLabels: string[] = [];
    try { projectLabels = JSON.parse(config?.labels ?? '[]'); } catch { /* skip */ }

    let labelDiscoveryNote = '';
    if (labelCycles.length > 0 || projectLabels.length > 0) {
      if (!config?.jiraProjectKey) {
        labelDiscoveryNote = ' (label-based discovery skipped — set a Jira project key in Jira settings)';
      } else {
        for (const cycle of labelCycles) {
          let labels: string[] = [];
          try { labels = JSON.parse(cycle.jiraLabels); } catch { continue; }
          if (labels.length === 0) continue;
          const discovered = await fetchIssuesByLabels(config.jiraProjectKey, labels, cycle.createdAt, cycle.closedAt);
          allIssues.push(...discovered);
        }

        // Project-level (Defects dashboard) label discovery — additive to the
        // per-cycle discovery above, but not bounded to any cycle's date
        // window, since there is no cycle window at project scope.
        if (projectLabels.length > 0) {
          const discovered = await fetchIssuesByLabels(config.jiraProjectKey, projectLabels, null, null);
          allIssues.push(...discovered);
        }
      }
    }

    // Per-cycle custom JQL — wrapped per-cycle so one admin's typo'd JQL
    // doesn't fail the whole project's sync. Unlike label matching (re-derived
    // at read time from the JiraIssue cache), JQL results can't be re-derived
    // from cached fields, so the matched key list is snapshotted onto the
    // cycle itself for the bugs endpoint to union in later.
    for (const cycle of jqlCycles) {
      if (!cycle.jiraJql?.trim()) continue;
      try {
        const discovered = await fetchIssuesByJql(cycle.jiraJql);
        allIssues.push(...discovered);
        await prisma.testCycle.update({
          where: { id: cycle.id },
          data: { jqlDiscoveredKeys: JSON.stringify(discovered.map((i) => i.issueKey)) },
        });
      } catch (err) {
        // Leave the cycle's last-known jqlDiscoveredKeys untouched on error —
        // a transient Jira failure shouldn't blank out previously-found bugs.
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error(`[jira-poll] JQL discovery failed for cycle ${cycle.id}: ${message}`);
      }
    }

    // Project-level (Defects dashboard) custom JQL — same "wrap so a typo
    // doesn't fail the whole sync" treatment, snapshotted onto JiraConfig
    // itself since it isn't tied to any one cycle.
    if (config?.jql?.trim()) {
      try {
        const discovered = await fetchIssuesByJql(config.jql);
        allIssues.push(...discovered);
        await prisma.jiraConfig.updateMany({
          where: { projectId },
          data: { jqlDiscoveredKeys: JSON.stringify(discovered.map((i) => i.issueKey)) },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error(`[jira-poll] Project-level JQL discovery failed for project ${projectId}: ${message}`);
      }
    }

    if (allIssues.length === 0) {
      const note = `OK — no linked or label-matched issues${labelDiscoveryNote}`;
      await prisma.jiraConfig.updateMany({ where: { projectId }, data: { lastPollAt: new Date(), lastPollStatus: note } });
      return { synced: 0 };
    }

    const synced = await upsertIssues(projectId, allIssues);
    await prisma.jiraConfig.updateMany({
      where: { projectId },
      data: { lastPollAt: new Date(), lastPollStatus: `OK — synced ${synced} issue(s)${labelDiscoveryNote}` },
    });
    return { synced };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await prisma.jiraConfig.updateMany({
      where: { projectId },
      data: { lastPollAt: new Date(), lastPollStatus: `ERROR — ${message}` },
    });
    return { synced: 0, error: message };
  }
}

// ── Project-wide resolution summary — powers the dashboard's JIRA ring cards ──
// "Tickets": every key linked anywhere in the project, plus every cached issue
// matching any cycle's labels (discovered, whether or not yet linked) — same
// universe as a cycle's Bugs tab, just summed across all cycles.
// "Test cases": items with >=1 linked key; "resolved" = at least one of that
// item's linked keys has statusCategory "done" — signals "ready to retest."

export async function getJiraResolutionSummary(projectId: string): Promise<{
  tickets: { resolved: number; total: number };
  testCases: { resolved: number; total: number };
}> {
  const [itemsWithKeys, cyclesWithLabels, cachedIssues] = await Promise.all([
    prisma.testCycleItem.findMany({
      where: { projectId, NOT: { jiraIssueKeys: '[]' } },
      select: { jiraIssueKeys: true },
    }),
    prisma.testCycle.findMany({
      where: { projectId, NOT: { jiraLabels: '[]' } },
      select: { jiraLabels: true },
    }),
    prisma.jiraIssue.findMany({ where: { projectId } }),
  ]);

  const cachedByKey = new Map(cachedIssues.map((i) => [i.issueKey, i]));

  const ticketKeys = new Set<string>();
  for (const item of itemsWithKeys) {
    try { (JSON.parse(item.jiraIssueKeys) as string[]).forEach((k) => ticketKeys.add(k)); } catch { /* skip */ }
  }

  const allCycleLabels = new Set<string>();
  for (const cycle of cyclesWithLabels) {
    try { (JSON.parse(cycle.jiraLabels) as string[]).forEach((l) => allCycleLabels.add(l)); } catch { /* skip */ }
  }
  if (allCycleLabels.size > 0) {
    for (const issue of cachedIssues) {
      if (issue.issueType !== 'Bug') continue;
      let issueLabels: string[] = [];
      try { issueLabels = JSON.parse(issue.labels); } catch { continue; }
      if (issueLabels.some((l) => allCycleLabels.has(l))) ticketKeys.add(issue.issueKey);
    }
  }

  const ticketsTotal = ticketKeys.size;
  const ticketsResolved = [...ticketKeys].filter((k) => cachedByKey.get(k)?.statusCategory === 'done').length;

  const testCasesTotal = itemsWithKeys.length;
  let testCasesResolved = 0;
  for (const item of itemsWithKeys) {
    let keys: string[] = [];
    try { keys = JSON.parse(item.jiraIssueKeys); } catch { continue; }
    if (keys.some((k) => cachedByKey.get(k)?.statusCategory === 'done')) testCasesResolved++;
  }

  return {
    tickets:   { resolved: ticketsResolved, total: ticketsTotal },
    testCases: { resolved: testCasesResolved, total: testCasesTotal },
  };
}
