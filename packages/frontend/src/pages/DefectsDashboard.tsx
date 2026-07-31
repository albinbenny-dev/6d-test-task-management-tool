import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, LabelList,
} from 'recharts';
import Topbar, { TbBtn } from '../components/layout/Topbar';
import { StatCard } from '../components/testCycles/StatCards';
import { MultiSelectFilter } from '../components/testCycles/FilterBar';
import { useProject } from '../hooks/useProjects';
import { useProjectDefects } from '../hooks/useDefects';
import { useJiraConfig, useUpdateJiraConfig, useSyncJiraNow, useJiraHost } from '../hooks/useJira';
import { useRBAC } from '../hooks/useRBAC';
import { isBugClosed, isBugOverdue } from '../lib/jiraBugStatus';
import type { ProjectDefect, ProjectDefectIssue } from '../types';

// ── Due-date aging bucket — same 4-bucket shape as AllBugsSection's board,
// so "overdue" reads identically everywhere in the app. ─────────────────────

const DUE_BUCKETS = ['Overdue', 'Due this week', 'Later', 'No due date'] as const;
type DueBucket = typeof DUE_BUCKETS[number];

function dueBucket(defect: ProjectDefect): DueBucket {
  const issue = defect.issue;
  if (!issue?.dueDate) return 'No due date';
  if (isBugOverdue(issue)) return 'Overdue';
  const due = new Date(issue.dueDate);
  const in7Days = new Date(Date.now() + 7 * 86_400_000);
  if (due <= in7Days) return 'Due this week';
  return 'Later';
}

// ── Aging bucket — how long a still-open defect has been outstanding, from
// Jira's own "created" date. Only meaningful for defects not yet closed. ────

const AGING_BUCKETS = ['0-3d', '4-7d', '8-14d', '15-30d', '30d+', 'Unknown'] as const;
type AgingBucket = typeof AGING_BUCKETS[number];

function agingBucket(defect: ProjectDefect): AgingBucket {
  const created = defect.issue?.jiraCreatedAt;
  if (!created) return 'Unknown';
  const days = Math.floor((Date.now() - new Date(created).getTime()) / 86_400_000);
  if (days <= 3) return '0-3d';
  if (days <= 7) return '4-7d';
  if (days <= 14) return '8-14d';
  if (days <= 30) return '15-30d';
  return '30d+';
}

const AGING_COLOR: Record<AgingBucket, string> = {
  '0-3d':   'var(--pass)',
  '4-7d':   'var(--run)',
  '8-14d':  'var(--amber)',
  '15-30d': '#ea580c',
  '30d+':   'var(--fail)',
  Unknown:  'var(--text-dim)',
};

// ── "Retest" — a company-specific status meaning: fixed and back with the
// testing team to re-verify, NOT still open with dev. Kept separate from the
// generic "Open" bucket everywhere it's counted. Matched on the literal Jira
// status name (like isBugClosed does) rather than statusCategory, since a
// custom workflow's category mapping for "Retest" isn't guaranteed. ────────

function isRetestStatus(issue: ProjectDefectIssue | null | undefined): boolean {
  return (issue?.status ?? '').trim().toLowerCase() === 'retest';
}

const STATUS_CATEGORY_COLOR: Record<string, string> = {
  new:           'var(--fail)',
  indeterminate: 'var(--run)',
  done:          'var(--pass)',
};
const JIRA_STATUS_BADGE: Record<string, string> = {
  done:          'badge-pass',
  indeterminate: 'badge-run',
  new:           'badge-draft',
};

const CHART_PALETTE = ['#2563eb', '#ea580c', '#0f766e', '#7c3aed', '#be185d', '#65a30d', '#0891b2', '#c026d3'];
const OTHER_COLOR = 'var(--text-dim)';
const TOP_N = 7; // component/assignee breakdowns cap at this many bars + an "Other" bucket

const LABEL_STYLE: CSSProperties = {
  display: 'block', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '1px', color: 'var(--text-mid)', marginBottom: '4px',
};
const CHART_LABEL_STYLE = { fill: 'var(--text)', fontSize: 10, fontWeight: 700 };

// ── Chart tooltip ────────────────────────────────────────────────────────

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ color?: string; name?: string; value?: number }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 12, boxShadow: 'var(--shadow-card)' }}>
      {label && <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>{label}</div>}
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color ?? 'var(--text)' }}>{p.name}: {p.value}</div>
      ))}
    </div>
  );
}

function countBy(defects: ProjectDefect[], keyFn: (d: ProjectDefect) => string): Array<{ key: string; count: number }> {
  const map = new Map<string, number>();
  for (const d of defects) {
    const key = keyFn(d);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
}

// Caps a breakdown at TOP_N entries, folding the remainder into "Other" so a
// long tail (e.g. dozens of distinct assignees) doesn't blow out the chart.
function topNWithOther(rows: Array<{ key: string; count: number }>): Array<{ key: string; count: number }> {
  if (rows.length <= TOP_N) return rows;
  const top = rows.slice(0, TOP_N);
  const otherCount = rows.slice(TOP_N).reduce((sum, r) => sum + r.count, 0);
  return [...top, { key: 'Other', count: otherCount }];
}

// ── Multi-select filter matching — empty selection means "no filter" (match
// everything); a non-empty selection matches ANY of the chosen values. ─────

function matchesMulti(selected: string[], value: string): boolean {
  return selected.length === 0 || selected.includes(value);
}
function matchesComponent(selected: string[], components: string[]): boolean {
  if (selected.length === 0) return true;
  if (components.length === 0) return selected.includes('No component');
  return components.some((c) => selected.includes(c));
}
function matchesLabel(selected: string[], labels: string[]): boolean {
  if (selected.length === 0) return true;
  return labels.some((l) => selected.includes(l));
}
function matchesCycle(selected: string[], cycles: Array<{ name: string }>): boolean {
  if (selected.length === 0) return true;
  return cycles.some((c) => selected.includes(c.name));
}

interface DefectFilters {
  status: string[];
  severity: string[];
  assignee: string[];
  component: string[];
  cycle: string[];
  due: string[];
  aging: string[];
  label: string[];
}

function buildPredicate(f: DefectFilters): (d: ProjectDefect) => boolean {
  return (d) => {
    if (!matchesMulti(f.status, d.issue?.status ?? '')) return false;
    if (!matchesMulti(f.severity, d.issue?.severityName ?? 'Unspecified')) return false;
    if (!matchesMulti(f.assignee, d.issue?.assigneeName ?? 'Unassigned')) return false;
    if (!matchesComponent(f.component, d.issue?.components ?? [])) return false;
    if (!matchesCycle(f.cycle, d.testCycles)) return false;
    if (!matchesMulti(f.due, dueBucket(d))) return false;
    if (!matchesMulti(f.aging, agingBucket(d))) return false;
    if (!matchesLabel(f.label, d.issue?.labels ?? [])) return false;
    return true;
  };
}

// ── Sync settings panel — project-wide label/JQL discovery config, additive
// to any per-cycle TestCycle.jiraLabels/jiraJql. Labels/JQL editing is
// admin-gated (mirrors ProjectSettings.tsx's JiraSettingsTab); Sync Now is
// gated to any write-capable role (mirrors the backend's requireWrite). ────

function SyncPanel({ projectId }: { projectId: string }) {
  const { canManageJiraConfig, canWrite } = useRBAC();
  const { data, isLoading } = useJiraConfig(projectId);
  const updateConfig = useUpdateJiraConfig(projectId);
  const syncNow = useSyncJiraNow(projectId);
  const [expanded, setExpanded] = useState(false);
  const [labelsInput, setLabelsInput] = useState('');
  const [jqlInput, setJqlInput] = useState('');

  useEffect(() => {
    if (data?.config) {
      setLabelsInput(data.config.labels.join(', '));
      setJqlInput(data.config.jql ?? '');
    }
  }, [data]);

  async function handleSave() {
    const labels = labelsInput.split(',').map((l) => l.trim()).filter(Boolean);
    try {
      await updateConfig.mutateAsync({ labels, jql: jqlInput.trim() || null });
      toast.success('Defect sync settings saved.');
    } catch {
      toast.error('Failed to save sync settings.');
    }
  }

  async function handleSync() {
    try {
      const result = await syncNow.mutateAsync();
      if (result.error) toast.error(result.error);
      else toast.success(`Synced ${result.synced} issue(s)`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Sync failed';
      toast.error(msg);
    }
  }

  const config = data?.config;

  // ── Narrow vertical card — lives in the side rail, so everything stacks
  // instead of wrapping in a horizontal row (that only worked full-width). ──
  return (
    <div className="card" style={{ padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)' }}>🔄 Sync</span>
        {canWrite && (
          <TbBtn variant="ghost" onClick={() => void handleSync()} disabled={syncNow.isPending} style={{ fontSize: '10px', padding: '3px 8px' }}>
            {syncNow.isPending ? '⏳' : '🔄'} {syncNow.isPending ? 'Syncing…' : 'Sync Now'}
          </TbBtn>
        )}
      </div>

      <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {!isLoading && config && (config.labels.length > 0 || config.jql) ? (
          <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>
            {config.labels.length > 0 && `${config.labels.length} label(s)`}{config.labels.length > 0 && config.jql ? ' + ' : ''}{config.jql ? 'custom JQL' : ''}
          </span>
        ) : (
          <span style={{ fontSize: '10px', color: 'var(--text-dim)', fontStyle: 'italic' }}>No labels/JQL configured</span>
        )}
        {config?.lastPollAt && (
          <span style={{ fontSize: '10px', color: 'var(--text-dim)' }} title={config.lastPollStatus ?? undefined}>
            Synced {new Date(config.lastPollAt).toLocaleString()}
          </span>
        )}
      </div>

      <button
        onClick={() => setExpanded((v) => !v)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', padding: 0, marginTop: '8px', font: 'inherit', fontSize: '10px', fontWeight: 700, color: 'var(--cyan)' }}
      >
        {canManageJiraConfig ? 'Edit sync config' : 'View sync config'} <span style={{ fontSize: '9px' }}>{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border)' }}>
          {!canManageJiraConfig ? (
            <div style={{ fontSize: '11px', color: 'var(--text-mid)' }}>
              <div><strong>Labels:</strong> {config?.labels.length ? config.labels.join(', ') : <span style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>none</span>}</div>
              <div style={{ marginTop: '6px' }}><strong>JQL:</strong> {config?.jql || <span style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>none</span>}</div>
            </div>
          ) : (
            <>
              <label style={LABEL_STYLE}>Labels (comma-separated)</label>
              <input
                className="input-field"
                value={labelsInput}
                onChange={(e) => setLabelsInput(e.target.value)}
                placeholder="e.g. opco-airtel, regression"
                style={{ marginBottom: '10px', fontSize: '11px' }}
              />

              <label style={LABEL_STYLE}>Custom JQL (optional)</label>
              <textarea
                className="input-field"
                value={jqlInput}
                onChange={(e) => setJqlInput(e.target.value)}
                placeholder="project = PROJ AND issuetype = Bug"
                rows={3}
                style={{ marginBottom: '10px', fontFamily: 'var(--font-mono)', fontSize: '10px', resize: 'vertical' }}
              />

              {config?.labels.length && !config.jiraProjectKey ? (
                <p style={{ fontSize: '10px', color: 'var(--amber)', marginBottom: '10px' }}>
                  ⚠ Needs a Jira project key — set one in Settings → Jira.
                </p>
              ) : null}

              <TbBtn variant="primary" onClick={() => void handleSave()} disabled={updateConfig.isPending} style={{ width: '100%', justifyContent: 'center' }}>
                {updateConfig.isPending ? 'Saving…' : 'Save'}
              </TbBtn>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function DefectsDashboard() {
  const { slug } = useParams<{ slug: string }>();
  const { data: project } = useProject(slug);
  const projectId = project?.id;
  const { data: jiraHost } = useJiraHost(projectId);
  const { data: allDefects = [], isLoading } = useProjectDefects(projectId);

  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [severityFilters, setSeverityFilters] = useState<string[]>([]);
  const [assigneeFilters, setAssigneeFilters] = useState<string[]>([]);
  const [componentFilters, setComponentFilters] = useState<string[]>([]);
  const [cycleFilters, setCycleFilters] = useState<string[]>([]);
  const [dueFilters, setDueFilters] = useState<string[]>([]);
  const [agingFilters, setAgingFilters] = useState<string[]>([]);
  const [labelFilters, setLabelFilters] = useState<string[]>([]);
  const [showClosed, setShowClosed] = useState(false);

  function toggleFilter(cur: string[], set: (v: string[]) => void, value: string) {
    set(cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]);
  }

  // Base working set (post "show closed" toggle) — charts show the overview
  // across this set; the table and stat cards below apply the dropdown
  // filters on top of it.
  const visibleDefects = useMemo(
    () => allDefects.filter((d) => showClosed || !isBugClosed(d.issue)),
    [allDefects, showClosed],
  );

  const predicate = useMemo(
    () => buildPredicate({
      status: statusFilters, severity: severityFilters, assignee: assigneeFilters,
      component: componentFilters, cycle: cycleFilters, due: dueFilters, aging: agingFilters, label: labelFilters,
    }),
    [statusFilters, severityFilters, assigneeFilters, componentFilters, cycleFilters, dueFilters, agingFilters, labelFilters],
  );

  const filteredDefects = useMemo(() => visibleDefects.filter(predicate), [visibleDefects, predicate]);

  // Resolved(7d) is computed from allDefects (not visibleDefects) — a "Show
  // Closed" toggle that's off by default would otherwise always show 0 here,
  // since a resolved bug IS a closed one. It still respects every other
  // active filter, same as the rest of the stat row.
  const resolvedBase = useMemo(() => allDefects.filter(predicate), [allDefects, predicate]);

  const closedCount = allDefects.filter((d) => isBugClosed(d.issue)).length;
  const overdueCount = filteredDefects.filter((d) => isBugOverdue(d.issue)).length;
  const unassignedCount = filteredDefects.filter((d) => !d.issue?.assigneeName).length;
  const retestCount = filteredDefects.filter((d) => isRetestStatus(d.issue)).length;
  const openCount = filteredDefects.filter((d) => !isBugClosed(d.issue) && !isRetestStatus(d.issue)).length;
  const resolvedLast7dCount = resolvedBase.filter((d) => {
    if (d.issue?.statusCategory !== 'done' || !d.issue.jiraUpdatedAt) return false;
    return new Date(d.issue.jiraUpdatedAt) >= new Date(Date.now() - 7 * 86_400_000);
  }).length;

  // ── Chart data (stable overview — post "show closed" toggle only, not
  // re-filtered by the dropdowns, so charts stay a consistent drill-down
  // entry point regardless of what's currently selected) ───────────────────

  const statusRows = useMemo(() => {
    const withStatus = visibleDefects.filter((d) => d.issue?.status);
    const rows = countBy(withStatus, (d) => d.issue!.status!);
    const notSynced = visibleDefects.length - withStatus.length;
    return notSynced > 0 ? [...rows, { key: 'Not synced yet', count: notSynced }] : rows;
  }, [visibleDefects]);

  const statusCategoryByLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of visibleDefects) if (d.issue?.status && d.issue.statusCategory) map.set(d.issue.status, d.issue.statusCategory);
    return map;
  }, [visibleDefects]);

  const severityRows = useMemo(
    () => countBy(visibleDefects, (d) => d.issue?.severityName ?? 'Unspecified'),
    [visibleDefects],
  );

  const componentRows = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of visibleDefects) {
      const comps = d.issue?.components ?? [];
      if (comps.length === 0) map.set('No component', (map.get('No component') ?? 0) + 1);
      else for (const c of comps) map.set(c, (map.get(c) ?? 0) + 1);
    }
    return topNWithOther([...map.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count));
  }, [visibleDefects]);

  const assigneeRows = useMemo(
    () => topNWithOther(countBy(visibleDefects, (d) => d.issue?.assigneeName ?? 'Unassigned')),
    [visibleDefects],
  );

  const dueRows = useMemo(
    () => DUE_BUCKETS.map((bucket) => ({ key: bucket, count: visibleDefects.filter((d) => dueBucket(d) === bucket).length })),
    [visibleDefects],
  );

  // Aging only makes sense for defects not yet closed, regardless of whether
  // "Show Closed" happens to be toggled on for the table right now.
  const agingRows = useMemo(() => {
    const open = visibleDefects.filter((d) => !isBugClosed(d.issue));
    return AGING_BUCKETS.map((bucket) => ({ key: bucket, count: open.filter((d) => agingBucket(d) === bucket).length })).filter((r) => r.count > 0 || r.key !== 'Unknown');
  }, [visibleDefects]);

  // ── Filter dropdown options ───────────────────────────────────────────────

  const statusOptions = [...new Set(visibleDefects.map((d) => d.issue?.status).filter((s): s is string => !!s))].sort();
  const severityOptions = [...new Set(visibleDefects.map((d) => d.issue?.severityName ?? 'Unspecified'))].sort();
  const assigneeOptions = [...new Set(visibleDefects.map((d) => d.issue?.assigneeName ?? 'Unassigned'))].sort();
  const componentOptions = [...new Set(visibleDefects.flatMap((d) => d.issue?.components.length ? d.issue.components : ['No component']))].sort();
  const cycleOptions = [...new Set(visibleDefects.flatMap((d) => d.testCycles.map((c) => c.name)))].sort();
  const labelOptions = [...new Set(visibleDefects.flatMap((d) => d.issue?.labels ?? []))].sort();

  function clearAllFilters() {
    setStatusFilters([]); setSeverityFilters([]); setAssigneeFilters([]); setComponentFilters([]);
    setCycleFilters([]); setDueFilters([]); setAgingFilters([]); setLabelFilters([]);
  }
  const activeFilterCount = [statusFilters, severityFilters, assigneeFilters, componentFilters, cycleFilters, dueFilters, agingFilters, labelFilters]
    .reduce((sum, f) => sum + f.length, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Topbar
        breadcrumbs={[
          { label: project?.name ?? slug ?? 'Project', href: `/projects/${slug}/test-cycles` },
          { label: 'Defects' },
        ]}
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 24px 24px' }}>
        {/* Compact header — a title line, not a full page-header block, so
            the stat cards below start almost immediately */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '12px' }}>
          <h1 style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text)', margin: 0 }}>🐞 Defects</h1>
          <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Every Jira bug synced for this project</span>
        </div>

        {/* Main dashboard column + a narrow side rail for sync settings, so
            the charts/table get full width instead of being pushed down by
            a full-width settings card */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 240px', gap: '16px', alignItems: 'start' }}>
          <div style={{ minWidth: 0 }}>
        {isLoading ? (
          <div style={{ color: 'var(--text-dim)', fontSize: '12px', fontFamily: 'var(--font-mono)', padding: '24px' }}>Loading defects…</div>
        ) : allDefects.length === 0 ? (
          <div style={{ color: 'var(--text-dim)', fontSize: '12px', fontFamily: 'var(--font-mono)', padding: '48px', textAlign: 'center' }}>
            No defects synced yet. Configure labels or a custom JQL in the side panel and click Sync Now — or link a Jira key from a test cycle's Bugs tab.
          </div>
        ) : (
          <>
            {/* Stat cards — reflect all currently active filters (except
                Resolved, which always counts regardless of "Show Closed") */}
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <StatCard label="Open" value={openCount} theme="fail" />
              <StatCard label="Retest" value={retestCount} theme="progress" sub="with testing team" />
              <StatCard label="Overdue" value={overdueCount} theme="blocked" />
              <StatCard label="Unassigned" value={unassignedCount} theme="unlinked" />
              <StatCard label="Resolved (7d)" value={resolvedLast7dCount} theme="pass" sub="based on last Jira update" />
            </div>

            {/* Charts — a stable overview (not re-filtered by the dropdowns
                below); click a segment to add/remove it from that filter */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px', marginTop: '20px' }}>
              <div className="card" style={{ padding: '14px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)', marginBottom: '8px' }}>By Status</div>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Tooltip content={<CustomTooltip />} />
                    <Pie
                      data={statusRows.map((r) => ({ name: r.key, value: r.count }))}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={40}
                      outerRadius={70}
                      paddingAngle={2}
                      label={(e: { value?: number }) => e.value}
                      onClick={(entry: { name?: string }) => entry?.name && entry.name !== 'Not synced yet' && toggleFilter(statusFilters, setStatusFilters, entry.name)}
                      style={{ cursor: 'pointer' }}
                    >
                      {statusRows.map((r) => (
                        <Cell
                          key={r.key}
                          fill={STATUS_CATEGORY_COLOR[statusCategoryByLabel.get(r.key) ?? ''] ?? OTHER_COLOR}
                          opacity={statusFilters.length === 0 || statusFilters.includes(r.key) ? 1 : 0.35}
                        />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="card" style={{ padding: '14px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)', marginBottom: '8px' }}>By Severity</div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={severityRows.map((r) => ({ name: r.key, value: r.count }))} layout="vertical" margin={{ left: 8, right: 20 }}>
                    <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-dim)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-dim)' }} axisLine={false} tickLine={false} width={80} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar
                      dataKey="value"
                      radius={[0, 4, 4, 0]}
                      cursor="pointer"
                      onClick={(entry: { name?: string }) => entry?.name && toggleFilter(severityFilters, setSeverityFilters, entry.name)}
                    >
                      <LabelList dataKey="value" position="right" style={CHART_LABEL_STYLE} />
                      {severityRows.map((r, i) => (
                        <Cell key={r.key} fill={CHART_PALETTE[i % CHART_PALETTE.length]} opacity={severityFilters.length === 0 || severityFilters.includes(r.key) ? 1 : 0.35} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="card" style={{ padding: '14px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)', marginBottom: '8px' }}>By Component</div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={componentRows.map((r) => ({ name: r.key, value: r.count }))} layout="vertical" margin={{ left: 8, right: 20 }}>
                    <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-dim)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-dim)' }} axisLine={false} tickLine={false} width={90} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar
                      dataKey="value"
                      radius={[0, 4, 4, 0]}
                      cursor="pointer"
                      onClick={(entry: { name?: string }) => entry?.name && entry.name !== 'Other' && toggleFilter(componentFilters, setComponentFilters, entry.name)}
                    >
                      <LabelList dataKey="value" position="right" style={CHART_LABEL_STYLE} />
                      {componentRows.map((r, i) => (
                        <Cell key={r.key} fill={r.key === 'Other' ? OTHER_COLOR : CHART_PALETTE[i % CHART_PALETTE.length]} opacity={componentFilters.length === 0 || componentFilters.includes(r.key) ? 1 : 0.35} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="card" style={{ padding: '14px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)', marginBottom: '8px' }}>By Assignee</div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={assigneeRows.map((r) => ({ name: r.key, value: r.count }))} layout="vertical" margin={{ left: 8, right: 20 }}>
                    <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-dim)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-dim)' }} axisLine={false} tickLine={false} width={90} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar
                      dataKey="value"
                      radius={[0, 4, 4, 0]}
                      cursor="pointer"
                      onClick={(entry: { name?: string }) => entry?.name && entry.name !== 'Other' && toggleFilter(assigneeFilters, setAssigneeFilters, entry.name)}
                    >
                      <LabelList dataKey="value" position="right" style={CHART_LABEL_STYLE} />
                      {assigneeRows.map((r, i) => (
                        <Cell key={r.key} fill={r.key === 'Other' ? OTHER_COLOR : CHART_PALETTE[i % CHART_PALETTE.length]} opacity={assigneeFilters.length === 0 || assigneeFilters.includes(r.key) ? 1 : 0.35} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="card" style={{ padding: '14px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)', marginBottom: '8px' }}>By Due Date</div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={dueRows.map((r) => ({ name: r.key, value: r.count }))} margin={{ top: 20 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 9, fill: 'var(--text-dim)' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: 'var(--text-dim)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar
                      dataKey="value"
                      radius={[4, 4, 0, 0]}
                      cursor="pointer"
                      onClick={(entry: { name?: string }) => entry?.name && toggleFilter(dueFilters, setDueFilters, entry.name)}
                    >
                      <LabelList dataKey="value" position="top" style={CHART_LABEL_STYLE} />
                      {dueRows.map((r) => (
                        <Cell
                          key={r.key}
                          fill={r.key === 'Overdue' ? 'var(--fail)' : r.key === 'Due this week' ? 'var(--amber)' : r.key === 'Later' ? 'var(--run)' : 'var(--text-dim)'}
                          opacity={dueFilters.length === 0 || dueFilters.includes(r.key) ? 1 : 0.35}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="card" style={{ padding: '14px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)', marginBottom: '8px' }}>Aging (still open)</div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={agingRows.map((r) => ({ name: r.key, value: r.count }))} margin={{ top: 20 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 9, fill: 'var(--text-dim)' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: 'var(--text-dim)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar
                      dataKey="value"
                      radius={[4, 4, 0, 0]}
                      cursor="pointer"
                      onClick={(entry: { name?: string }) => entry?.name && toggleFilter(agingFilters, setAgingFilters, entry.name)}
                    >
                      <LabelList dataKey="value" position="top" style={CHART_LABEL_STYLE} />
                      {agingRows.map((r) => (
                        <Cell
                          key={r.key}
                          fill={AGING_COLOR[r.key as AgingBucket]}
                          opacity={agingFilters.length === 0 || agingFilters.includes(r.key) ? 1 : 0.35}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Filter bar — every filter is multi-select: pick any combination
                of values within a dimension, combined across dimensions with AND */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginTop: '24px', marginBottom: '12px' }}>
              <MultiSelectFilter label="Status" values={statusFilters} onChange={setStatusFilters} options={statusOptions} />
              <MultiSelectFilter label="Severity" values={severityFilters} onChange={setSeverityFilters} options={severityOptions} />
              <MultiSelectFilter label="Assignee" values={assigneeFilters} onChange={setAssigneeFilters} options={assigneeOptions} />
              <MultiSelectFilter label="Component" values={componentFilters} onChange={setComponentFilters} options={componentOptions} />
              <MultiSelectFilter label="Test Cycle" values={cycleFilters} onChange={setCycleFilters} options={cycleOptions} />
              <MultiSelectFilter label="Due Date" values={dueFilters} onChange={setDueFilters} options={[...DUE_BUCKETS]} />
              <MultiSelectFilter label="Aging" values={agingFilters} onChange={setAgingFilters} options={[...AGING_BUCKETS]} />
              <MultiSelectFilter label="Label" values={labelFilters} onChange={setLabelFilters} options={labelOptions} />
              {activeFilterCount > 0 && (
                <TbBtn variant="ghost" onClick={clearAllFilters}>✕ Clear filters ({activeFilterCount})</TbBtn>
              )}
              <TbBtn variant="ghost" onClick={() => setShowClosed((v) => !v)} style={{ marginLeft: 'auto' }}>
                {showClosed ? '🙈 Hide Closed' : `👁 Show Closed (${closedCount})`}
              </TbBtn>
            </div>

            {/* Table */}
            {filteredDefects.length === 0 ? (
              <div style={{ color: 'var(--text-dim)', fontSize: '12px', fontFamily: 'var(--font-mono)', padding: '24px', textAlign: 'center' }}>
                No defects match the current filters.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table" style={{ minWidth: '1300px' }}>
                  <thead>
                    <tr>
                      <th>Ticket</th>
                      <th>Summary</th>
                      <th>Type</th>
                      <th>Severity</th>
                      <th>Priority</th>
                      <th>Status</th>
                      <th>Component</th>
                      <th>Assignee</th>
                      <th>Reporter</th>
                      <th>Test Cycle(s)</th>
                      <th>Due Date</th>
                      <th>TCs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDefects.map((d) => {
                      const overdue = isBugOverdue(d.issue);
                      return (
                        <tr key={d.issueKey} style={overdue ? { background: 'rgba(220,38,38,0.06)' } : undefined}>
                          <td className="primary" style={{ fontFamily: 'var(--font-mono)' }}>
                            {jiraHost ? (
                              <a href={`${jiraHost}/browse/${d.issueKey}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--cyan)', textDecoration: 'underline', textUnderlineOffset: '2px' }}>
                                {d.issueKey}
                              </a>
                            ) : d.issueKey}
                          </td>
                          <td>{d.issue?.summary ?? <span style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>not yet synced</span>}</td>
                          <td style={{ fontSize: '11px' }}>{d.issue?.issueType ?? '—'}</td>
                          <td style={{ fontSize: '11px' }}>{d.issue?.severityName ?? '—'}</td>
                          <td style={{ fontSize: '11px' }}>{d.issue?.priorityName ?? '—'}</td>
                          <td>
                            {d.issue?.status ? (
                              <span className={`badge ${JIRA_STATUS_BADGE[d.issue.statusCategory ?? ''] ?? 'badge-draft'}`}>{d.issue.status}</span>
                            ) : '—'}
                          </td>
                          <td style={{ fontSize: '11px' }}>{d.issue?.components.length ? d.issue.components.join(', ') : '—'}</td>
                          <td style={{ fontSize: '11px' }}>{d.issue?.assigneeName ?? 'Unassigned'}</td>
                          <td style={{ fontSize: '11px' }}>{d.issue?.reporterName ?? '—'}</td>
                          <td style={{ fontSize: '11px' }} title={d.testCycles.map((c) => c.name).join(', ')}>
                            {d.testCycles.length > 1 ? `${d.testCycles[0].name} +${d.testCycles.length - 1}` : (d.testCycles[0]?.name ?? '—')}
                          </td>
                          <td style={{ fontSize: '11px' }}>
                            {d.issue?.dueDate ? (
                              <span style={overdue ? { color: 'var(--fail)', fontWeight: 700 } : { color: 'var(--text-dim)' }}>
                                {overdue && '⚠ '}{new Date(d.issue.dueDate).toLocaleDateString()}
                              </span>
                            ) : '—'}
                          </td>
                          <td style={{ fontSize: '11px' }}>
                            {d.testCases.length > 0 ? <span title={d.testCases.map((tc) => tc.srNo).join(', ')}>{d.testCases.length}</span> : <span style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>0</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
          </div>

          {/* Side rail — sync settings, out of the way of the dashboard */}
          <div>
            {projectId && <SyncPanel projectId={projectId} />}
          </div>
        </div>
      </div>
    </div>
  );
}
