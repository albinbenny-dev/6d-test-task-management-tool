import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import Topbar, { TbBtn } from '../components/layout/Topbar';
import { StatCard } from '../components/testCycles/StatCards';
import { FilterSelect } from '../components/testCycles/FilterBar';
import { useProject } from '../hooks/useProjects';
import { useProjectDefects } from '../hooks/useDefects';
import { useJiraConfig, useUpdateJiraConfig, useSyncJiraNow, useJiraHost } from '../hooks/useJira';
import { useRBAC } from '../hooks/useRBAC';
import { isBugClosed, isBugOverdue } from '../lib/jiraBugStatus';
import type { ProjectDefect } from '../types';

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

  return (
    <div className="card" style={{ padding: '14px 16px', marginBottom: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', padding: 0, font: 'inherit', color: 'var(--text)' }}
        >
          <span style={{ fontSize: '13px', fontWeight: 700 }}>🔄 Sync Settings</span>
          <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>{expanded ? '▲' : '▼'}</span>
        </button>
        {!isLoading && config && (config.labels.length > 0 || config.jql) && (
          <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
            {config.labels.length > 0 && `${config.labels.length} label(s)`}{config.labels.length > 0 && config.jql ? ' + ' : ''}{config.jql ? 'custom JQL' : ''}
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
          {config?.lastPollAt && (
            <span style={{ fontSize: '10px', color: 'var(--text-dim)' }} title={config.lastPollStatus ?? undefined}>
              Synced {new Date(config.lastPollAt).toLocaleString()}
            </span>
          )}
          {canWrite && (
            <TbBtn variant="ghost" onClick={() => void handleSync()} disabled={syncNow.isPending}>
              {syncNow.isPending ? '⏳ Syncing…' : '🔄 Sync Now'}
            </TbBtn>
          )}
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid var(--border)' }}>
          {!canManageJiraConfig ? (
            <div style={{ fontSize: '12px', color: 'var(--text-mid)' }}>
              <div><strong>Labels:</strong> {config?.labels.length ? config.labels.join(', ') : <span style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>none configured</span>}</div>
              <div style={{ marginTop: '6px' }}><strong>Custom JQL:</strong> {config?.jql || <span style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>none configured</span>}</div>
            </div>
          ) : (
            <>
              <label style={LABEL_STYLE}>Labels (comma-separated) — project-wide, in addition to any per-cycle labels</label>
              <input
                className="input-field"
                value={labelsInput}
                onChange={(e) => setLabelsInput(e.target.value)}
                placeholder="e.g. opco-airtel, regression"
                style={{ marginBottom: '12px' }}
              />

              <label style={LABEL_STYLE}>Custom JQL (optional, additive alongside labels)</label>
              <textarea
                className="input-field"
                value={jqlInput}
                onChange={(e) => setJqlInput(e.target.value)}
                placeholder='e.g. project = PROJ AND issuetype = Bug AND fixVersion = "4.2"'
                rows={2}
                style={{ marginBottom: '12px', fontFamily: 'var(--font-mono)', fontSize: '11px', resize: 'vertical' }}
              />

              {config?.labels.length && !config.jiraProjectKey ? (
                <p style={{ fontSize: '11px', color: 'var(--amber)', marginBottom: '12px' }}>
                  ⚠ Label-based discovery needs a Jira project key — set one in Project Settings → Jira.
                </p>
              ) : null}

              <TbBtn variant="primary" onClick={() => void handleSave()} disabled={updateConfig.isPending}>
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

  const [statusFilter, setStatusFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [componentFilter, setComponentFilter] = useState('');
  const [cycleFilter, setCycleFilter] = useState('');
  const [dueFilter, setDueFilter] = useState('');
  const [labelFilter, setLabelFilter] = useState('');
  const [showClosed, setShowClosed] = useState(false);

  // Base working set (post "show closed" toggle) — charts show the overview
  // across this set; the table below applies the dropdown filters on top.
  const visibleDefects = useMemo(
    () => allDefects.filter((d) => showClosed || !isBugClosed(d.issue)),
    [allDefects, showClosed],
  );

  const filteredDefects = useMemo(() => visibleDefects.filter((d) => {
    if (statusFilter && d.issue?.status !== statusFilter) return false;
    if (severityFilter && (d.issue?.severityName ?? 'Unspecified') !== severityFilter) return false;
    if (assigneeFilter && (d.issue?.assigneeName ?? 'Unassigned') !== assigneeFilter) return false;
    if (componentFilter && !(d.issue?.components.length ? d.issue.components.includes(componentFilter) : componentFilter === 'No component')) return false;
    if (cycleFilter && !d.testCycles.some((c) => c.name === cycleFilter)) return false;
    if (dueFilter && dueBucket(d) !== dueFilter) return false;
    if (labelFilter && !(d.issue?.labels ?? []).includes(labelFilter)) return false;
    return true;
  }), [visibleDefects, statusFilter, severityFilter, assigneeFilter, componentFilter, cycleFilter, dueFilter, labelFilter]);

  const closedCount = allDefects.filter((d) => isBugClosed(d.issue)).length;
  const overdueCount = visibleDefects.filter((d) => isBugOverdue(d.issue)).length;
  const unassignedCount = visibleDefects.filter((d) => !d.issue?.assigneeName).length;
  const openCount = visibleDefects.filter((d) => d.issue?.statusCategory !== 'done').length;
  const resolvedLast7dCount = visibleDefects.filter((d) => {
    if (d.issue?.statusCategory !== 'done' || !d.issue.jiraUpdatedAt) return false;
    return new Date(d.issue.jiraUpdatedAt) >= new Date(Date.now() - 7 * 86_400_000);
  }).length;

  // ── Chart data ───────────────────────────────────────────────────────────

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

  // ── Filter dropdown options ───────────────────────────────────────────────

  const statusOptions = [...new Set(visibleDefects.map((d) => d.issue?.status).filter((s): s is string => !!s))].sort();
  const severityOptions = [...new Set(visibleDefects.map((d) => d.issue?.severityName ?? 'Unspecified'))].sort();
  const assigneeOptions = [...new Set(visibleDefects.map((d) => d.issue?.assigneeName ?? 'Unassigned'))].sort();
  const componentOptions = [...new Set(visibleDefects.flatMap((d) => d.issue?.components.length ? d.issue.components : ['No component']))].sort();
  const cycleOptions = [...new Set(visibleDefects.flatMap((d) => d.testCycles.map((c) => c.name)))].sort();
  const labelOptions = [...new Set(visibleDefects.flatMap((d) => d.issue?.labels ?? []))].sort();

  function clearAllFilters() {
    setStatusFilter(''); setSeverityFilter(''); setAssigneeFilter(''); setComponentFilter('');
    setCycleFilter(''); setDueFilter(''); setLabelFilter('');
  }
  const activeFilterCount = [statusFilter, severityFilter, assigneeFilter, componentFilter, cycleFilter, dueFilter, labelFilter].filter(Boolean).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Topbar
        breadcrumbs={[
          { label: project?.name ?? slug ?? 'Project', href: `/projects/${slug}/test-cycles` },
          { label: 'Defects' },
        ]}
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
        <div>
          <div className="page-eyebrow">Bug tracking</div>
          <h1 className="page-title">Defects</h1>
          <p className="page-sub">Every Jira bug synced for this project — by configured label/JQL or linked from a test cycle — in one dashboard.</p>
        </div>

        {projectId && <div style={{ marginTop: '16px' }}><SyncPanel projectId={projectId} /></div>}

        {isLoading ? (
          <div style={{ color: 'var(--text-dim)', fontSize: '12px', fontFamily: 'var(--font-mono)', padding: '24px' }}>Loading defects…</div>
        ) : allDefects.length === 0 ? (
          <div style={{ color: 'var(--text-dim)', fontSize: '12px', fontFamily: 'var(--font-mono)', padding: '48px', textAlign: 'center' }}>
            No defects synced yet. Configure labels or a custom JQL above and click Sync Now — or link a Jira key from a test cycle's Bugs tab.
          </div>
        ) : (
          <>
            {/* Stat cards */}
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '16px' }}>
              <StatCard label="Open" value={openCount} theme="fail" />
              <StatCard label="Overdue" value={overdueCount} theme="blocked" />
              <StatCard label="Unassigned" value={unassignedCount} theme="unlinked" />
              <StatCard label="Resolved (7d)" value={resolvedLast7dCount} theme="pass" sub="based on last Jira update" />
            </div>

            {/* Charts */}
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
                      onClick={(entry: { name?: string }) => entry?.name && entry.name !== 'Not synced yet' && setStatusFilter((cur) => (cur === entry.name ? '' : entry.name!))}
                      style={{ cursor: 'pointer' }}
                    >
                      {statusRows.map((r) => (
                        <Cell
                          key={r.key}
                          fill={STATUS_CATEGORY_COLOR[statusCategoryByLabel.get(r.key) ?? ''] ?? OTHER_COLOR}
                          opacity={!statusFilter || statusFilter === r.key ? 1 : 0.35}
                        />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="card" style={{ padding: '14px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)', marginBottom: '8px' }}>By Severity</div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={severityRows.map((r) => ({ name: r.key, value: r.count }))} layout="vertical" margin={{ left: 8 }}>
                    <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-dim)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-dim)' }} axisLine={false} tickLine={false} width={80} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar
                      dataKey="value"
                      radius={[0, 4, 4, 0]}
                      cursor="pointer"
                      onClick={(entry: { name?: string }) => entry?.name && setSeverityFilter((cur) => (cur === entry.name ? '' : entry.name!))}
                    >
                      {severityRows.map((r, i) => (
                        <Cell key={r.key} fill={CHART_PALETTE[i % CHART_PALETTE.length]} opacity={!severityFilter || severityFilter === r.key ? 1 : 0.35} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="card" style={{ padding: '14px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)', marginBottom: '8px' }}>By Component</div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={componentRows.map((r) => ({ name: r.key, value: r.count }))} layout="vertical" margin={{ left: 8 }}>
                    <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-dim)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-dim)' }} axisLine={false} tickLine={false} width={90} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar
                      dataKey="value"
                      radius={[0, 4, 4, 0]}
                      cursor="pointer"
                      onClick={(entry: { name?: string }) => entry?.name && entry.name !== 'Other' && setComponentFilter((cur) => (cur === entry.name ? '' : entry.name!))}
                    >
                      {componentRows.map((r, i) => (
                        <Cell key={r.key} fill={r.key === 'Other' ? OTHER_COLOR : CHART_PALETTE[i % CHART_PALETTE.length]} opacity={!componentFilter || componentFilter === r.key ? 1 : 0.35} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="card" style={{ padding: '14px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)', marginBottom: '8px' }}>By Assignee</div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={assigneeRows.map((r) => ({ name: r.key, value: r.count }))} layout="vertical" margin={{ left: 8 }}>
                    <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-dim)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-dim)' }} axisLine={false} tickLine={false} width={90} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar
                      dataKey="value"
                      radius={[0, 4, 4, 0]}
                      cursor="pointer"
                      onClick={(entry: { name?: string }) => entry?.name && entry.name !== 'Other' && setAssigneeFilter((cur) => (cur === entry.name ? '' : entry.name!))}
                    >
                      {assigneeRows.map((r, i) => (
                        <Cell key={r.key} fill={r.key === 'Other' ? OTHER_COLOR : CHART_PALETTE[i % CHART_PALETTE.length]} opacity={!assigneeFilter || assigneeFilter === r.key ? 1 : 0.35} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="card" style={{ padding: '14px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)', marginBottom: '8px' }}>By Due Date</div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={dueRows.map((r) => ({ name: r.key, value: r.count }))} margin={{ top: 8 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 9, fill: 'var(--text-dim)' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: 'var(--text-dim)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar
                      dataKey="value"
                      radius={[4, 4, 0, 0]}
                      cursor="pointer"
                      onClick={(entry: { name?: string }) => entry?.name && setDueFilter((cur) => (cur === entry.name ? '' : entry.name!))}
                    >
                      {dueRows.map((r) => (
                        <Cell
                          key={r.key}
                          fill={r.key === 'Overdue' ? 'var(--fail)' : r.key === 'Due this week' ? 'var(--amber)' : r.key === 'Later' ? 'var(--run)' : 'var(--text-dim)'}
                          opacity={!dueFilter || dueFilter === r.key ? 1 : 0.35}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Filter bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginTop: '24px', marginBottom: '12px' }}>
              <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter} options={statusOptions} />
              <FilterSelect label="Severity" value={severityFilter} onChange={setSeverityFilter} options={severityOptions} />
              <FilterSelect label="Assignee" value={assigneeFilter} onChange={setAssigneeFilter} options={assigneeOptions} />
              <FilterSelect label="Component" value={componentFilter} onChange={setComponentFilter} options={componentOptions} />
              <FilterSelect label="Test Cycle" value={cycleFilter} onChange={setCycleFilter} options={cycleOptions} />
              <FilterSelect label="Due Date" value={dueFilter} onChange={setDueFilter} options={[...DUE_BUCKETS]} />
              <FilterSelect label="Label" value={labelFilter} onChange={setLabelFilter} options={labelOptions} />
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
    </div>
  );
}
