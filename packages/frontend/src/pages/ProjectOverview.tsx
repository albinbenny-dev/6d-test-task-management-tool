import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LabelList } from 'recharts';
import Topbar from '../components/layout/Topbar';
import { useProject } from '../hooks/useProjects';
import { useJiraHost } from '../hooks/useJira';
import { useProjectOverview, SEVERITY_LABEL, SEVERITY_ACCENT, type ProjectHealthLevel, type OverviewResourceRow, type FailingTestRow, type DefectRow } from '../hooks/useProjectOverview';
import { useMilestones } from '../hooks/useMilestones';
import { StatCard } from '../components/testCycles/StatCards';
import { PriorityBadge } from '../components/tasks/PriorityBadge';
import { ALL_TASK_STATUSES, STATUS_LABEL as TASK_STATUS_LABEL, STATUS_DOT_COLOR as TASK_STATUS_COLOR, PRIORITY_ACCENT, PRIORITY_LABEL, ALL_PRIORITIES, formatDueDate } from '../lib/taskMeta';
import { STATUS_LABEL as EXEC_STATUS_LABEL, STATUS_COLOR as EXEC_STATUS_COLOR, STATUS_BADGE as EXEC_STATUS_BADGE, ALL_MANUAL_STATUSES } from '../lib/manualStatus';
import { milestoneDueBucket, isMilestoneOverdue, executionSlipDays, deviationTone, DEVIATION_COLOR, formatMilestoneDate } from '../lib/milestoneMeta';
import type { TaskPriority, ManualResultStatus, TestCycle, Task, Milestone } from '../types';

const HEALTH_META: Record<ProjectHealthLevel, { label: string; color: string }> = {
  healthy:   { label: 'Healthy', color: 'var(--pass)' },
  'at-risk': { label: 'At Risk', color: 'var(--amber)' },
  critical:  { label: 'Critical', color: 'var(--fail)' },
};

const LOAD_META: Record<OverviewResourceRow['load'], { label: string; color: string; bg: string }> = {
  low:    { label: 'Low',    color: 'var(--pass)',  bg: 'rgba(5,150,105,0.10)' },
  medium: { label: 'Medium', color: 'var(--cyan)',  bg: 'var(--cyan-dim)' },
  high:   { label: 'High',   color: 'var(--amber)', bg: 'var(--amber-dim)' },
  over:   { label: 'Over',   color: 'var(--fail)',  bg: 'var(--rose-dim)' },
};

const CYCLE_STATUS_BADGE: Record<TestCycle['status'], string> = {
  PLANNING: 'badge-draft',
  ACTIVE:   'badge-run',
  CLOSED:   'badge-pass',
};

const CHART_LABEL_STYLE = { fill: 'var(--text)', fontSize: 10, fontWeight: 700 };

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ color?: string; name?: string; value?: number }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 12, boxShadow: 'var(--shadow-card)' }}>
      {label && <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>{label}</div>}
      {payload.map((p, i) => <div key={i} style={{ color: p.color ?? 'var(--text)' }}>{p.name}: {p.value}</div>)}
    </div>
  );
}

function Legend({ rows }: { rows: Array<{ label: string; value: number; color: string }> }) {
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 140 }}>
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: r.color, flexShrink: 0 }} />
          <span style={{ color: 'var(--text-mid)', flex: 1 }}>{r.label}</span>
          <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{r.value}</span>
          <span style={{ color: 'var(--text-dim)', fontSize: 11, width: 34, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {total > 0 ? Math.round((r.value / total) * 100) : 0}%
          </span>
        </div>
      ))}
    </div>
  );
}

function Donut({ rows, centerLabel, centerSub }: { rows: Array<{ label: string; value: number; color: string }>; centerLabel: string; centerSub: string }) {
  const data = rows.map((r) => ({ name: r.label, value: r.value, color: r.color }));
  return (
    <div style={{ position: 'relative', width: 132, height: 132, flexShrink: 0 }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip content={<CustomTooltip />} />
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={44} outerRadius={64} paddingAngle={2} stroke="none">
            {data.map((d) => <Cell key={d.name} fill={d.color} />)}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        <span style={{ fontSize: 19, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{centerLabel}</span>
        <span style={{ fontSize: 9.5, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{centerSub}</span>
      </div>
    </div>
  );
}

function HBarChart({ rows }: { rows: Array<{ label: string; value: number; color: string }> }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(rows.length * 32, 60)}>
      <BarChart data={rows.map((r) => ({ name: r.label, value: r.value }))} layout="vertical" margin={{ left: 8, right: 24 }}>
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-mid)' }} axisLine={false} tickLine={false} width={64} />
        <Tooltip content={<CustomTooltip />} />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={14}>
          <LabelList dataKey="value" position="right" style={CHART_LABEL_STYLE} />
          {rows.map((r) => <Cell key={r.label} fill={r.color} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function ResourceWorkloadTable({ rows }: { rows: OverviewResourceRow[] }) {
  if (rows.length === 0) {
    return <div style={{ color: 'var(--text-dim)', fontSize: 12, fontFamily: 'var(--font-mono)', padding: 24, textAlign: 'center' }}>No open tasks or assigned test cases yet.</div>;
  }
  const maxTask = Math.max(...rows.map((r) => r.taskOpen), 1);
  const maxTest = Math.max(...rows.map((r) => r.testTotal), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.map((r) => {
        const load = LOAD_META[r.load];
        return (
          <div key={r.key} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 1fr 66px', alignItems: 'center', gap: 14 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: r.name === 'Unassigned' ? 'var(--amber)' : 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.name}>{r.name}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10, color: 'var(--text-dim)', width: 32, flexShrink: 0 }}>Tasks</span>
              <span style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--surface2)', overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', borderRadius: 4, width: `${(r.taskOpen / maxTask) * 100}%`, background: 'var(--cyan)' }} />
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, width: 20, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.taskOpen}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10, color: 'var(--text-dim)', width: 32, flexShrink: 0 }}>Tests</span>
              <span style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--surface2)', overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', borderRadius: 4, width: `${(r.testTotal / maxTest) * 100}%`, background: '#8b5cf6' }} />
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, width: 20, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.testTotal}</span>
            </div>
            <span style={{ fontSize: 10.5, fontWeight: 700, padding: '3px 8px', borderRadius: 20, textAlign: 'center', background: load.bg, color: load.color }}>{load.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function CycleStrip({ slug, cycles }: { slug: string; cycles: Array<{ cycle: TestCycle; counts: Record<ManualResultStatus, number>; total: number }> }) {
  const navigate = useNavigate();
  if (cycles.length === 0) {
    return <div style={{ color: 'var(--text-dim)', fontSize: 12, fontFamily: 'var(--font-mono)', padding: 24, textAlign: 'center' }}>No test cycles yet.</div>;
  }
  const sorted = [...cycles].sort((a, b) => {
    const rank = (s: TestCycle['status']) => (s === 'ACTIVE' ? 0 : s === 'PLANNING' ? 1 : 2);
    if (rank(a.cycle.status) !== rank(b.cycle.status)) return rank(a.cycle.status) - rank(b.cycle.status);
    if (a.cycle.dueDate && b.cycle.dueDate) return new Date(a.cycle.dueDate).getTime() - new Date(b.cycle.dueDate).getTime();
    return a.cycle.dueDate ? -1 : b.cycle.dueDate ? 1 : 0;
  });
  return (
    <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4 }}>
      {sorted.map((s) => {
        const executed = s.counts.PASS + s.counts.FAIL + s.counts.BLOCKED;
        const progress = s.total > 0 ? Math.round((executed / s.total) * 100) : 0;
        const passRate = executed > 0 ? Math.round((s.counts.PASS / executed) * 100) : null;
        const overdue = !!s.cycle.dueDate && new Date(s.cycle.dueDate) < new Date() && s.cycle.status !== 'CLOSED';
        return (
          <div
            key={s.cycle.id}
            onClick={() => navigate(`/projects/${slug}/test-cycles/${s.cycle.id}`)}
            style={{ flexShrink: 0, width: 220, border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px', background: 'var(--surface2)', display: 'flex', flexDirection: 'column', gap: 8, cursor: 'pointer' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.3 }}>{s.cycle.name}</span>
              <span className={`badge ${CYCLE_STATUS_BADGE[s.cycle.status]}`} style={{ flexShrink: 0 }}>{s.cycle.status}</span>
            </div>
            <span style={{ height: 6, borderRadius: 4, background: 'var(--surface3)', overflow: 'hidden', display: 'block' }}>
              <span style={{ display: 'block', height: '100%', borderRadius: 4, width: `${progress}%`, background: 'var(--cyan)' }} />
            </span>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-mid)' }}>
              <span style={overdue ? { color: 'var(--fail)', fontWeight: 700 } : undefined}>
                {s.cycle.dueDate ? `📅 ${formatDueDate(s.cycle.dueDate)}` : 'No due date'}
              </span>
              {passRate !== null ? <span style={{ fontWeight: 700, color: 'var(--pass)' }}>{passRate}% pass</span> : <span>{progress}% executed</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FailingTestsTable({ rows }: { rows: FailingTestRow[] }) {
  if (rows.length === 0) {
    return <div style={{ color: 'var(--text-dim)', fontSize: 12, fontFamily: 'var(--font-mono)', padding: 24, textAlign: 'center' }}>No failing or blocked test cases in active cycles 🎉</div>;
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="data-table" style={{ minWidth: 640 }}>
        <thead><tr><th>Test case</th><th>Cycle</th><th>Status</th><th>Assignee</th><th>Linked defect</th></tr></thead>
        <tbody>
          {rows.slice(0, 10).map((r) => (
            <tr key={r.id}>
              <td className="primary" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.reason ?? undefined}>{r.title}</td>
              <td>{r.cycleName}</td>
              <td><span className={`badge ${EXEC_STATUS_BADGE[r.status]}`}>{EXEC_STATUS_LABEL[r.status]}</span></td>
              <td>{r.assigneeName}</td>
              <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{r.jiraIssueKeys.length > 0 ? r.jiraIssueKeys.join(', ') : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DefectsTable({ rows, jiraHost }: { rows: DefectRow[]; jiraHost: string | undefined }) {
  if (rows.length === 0) {
    return <div style={{ color: 'var(--text-dim)', fontSize: 12, fontFamily: 'var(--font-mono)', padding: 24, textAlign: 'center' }}>No open critical or high-severity defects 🎉</div>;
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="data-table" style={{ minWidth: 640 }}>
        <thead><tr><th>Key</th><th>Summary</th><th>Severity</th><th>Assignee</th><th>Open for</th></tr></thead>
        <tbody>
          {rows.slice(0, 10).map((d) => (
            <tr key={d.issueKey}>
              <td className="primary" style={{ fontFamily: 'var(--font-mono)' }}>
                {jiraHost ? <a href={`${jiraHost}/browse/${d.issueKey}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--cyan)', textDecoration: 'underline', textUnderlineOffset: 2 }}>{d.issueKey}</a> : d.issueKey}
              </td>
              <td style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.summary}</td>
              <td><span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'var(--surface2)', color: SEVERITY_ACCENT[d.severity] }}>{SEVERITY_LABEL[d.severity]}</span></td>
              <td>{d.assigneeName}</td>
              <td style={{ fontWeight: 700, color: (d.daysOpen ?? 0) >= 7 ? 'var(--fail)' : 'var(--text-mid)' }}>{d.daysOpen !== null ? `${d.daysOpen}d` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OverdueTasksTable({ tasks, slug }: { tasks: Task[]; slug: string }) {
  const navigate = useNavigate();
  if (tasks.length === 0) {
    return <div style={{ color: 'var(--text-dim)', fontSize: 12, fontFamily: 'var(--font-mono)', padding: 24, textAlign: 'center' }}>Nothing overdue 🎉</div>;
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="data-table" style={{ minWidth: 560 }}>
        <thead><tr><th>Title</th><th>List</th><th>Assignee</th><th>Due</th><th>Priority</th></tr></thead>
        <tbody>
          {tasks.slice(0, 10).map((t) => (
            <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/projects/${slug}/tasks/${t.taskListId}?open=${t.id}`)}>
              <td className="primary" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</td>
              <td>{t.taskList?.name ?? '—'}</td>
              <td>{t.assignee?.user.name ?? 'Unassigned'}</td>
              <td style={{ color: 'var(--fail)', fontFamily: 'var(--font-mono)' }}>{formatDueDate(t.dueDate)}</td>
              <td><PriorityBadge priority={t.priority} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Payment Milestones — every undelivered milestone across every list in
// the project, worst-behind (overdue, then soonest target date) first, so a
// PM sees what needs attention at a glance. Payment-linked ones get a small
// $ marker — it's a highlight, not a filter, so a milestone with no payment
// tied to it still surfaces here if it's coming up or late. Amounts are
// never shown — this tool doesn't track them — only dates and schedule slip
// against the current target. ──────────────────────────────────────────────
function PaymentMilestonesTable({ milestones, slug }: { milestones: Milestone[]; slug: string }) {
  const navigate = useNavigate();
  const open = milestones.filter((m) => !m.isCompleted);
  if (open.length === 0) {
    return <div style={{ color: 'var(--text-dim)', fontSize: 12, fontFamily: 'var(--font-mono)', padding: 24, textAlign: 'center' }}>{milestones.length > 0 ? 'Every milestone is delivered 🎉' : 'No milestones defined yet.'}</div>;
  }
  const sorted = [...open].sort((a, b) => {
    const rank = (m: Milestone) => (isMilestoneOverdue(m) ? 0 : milestoneDueBucket(m) === 'Due this month' ? 1 : 2);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (a.targetDate && b.targetDate) return new Date(a.targetDate).getTime() - new Date(b.targetDate).getTime();
    return a.targetDate ? -1 : b.targetDate ? 1 : 0;
  });
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="data-table" style={{ minWidth: 520 }}>
        <thead><tr><th>Milestone</th><th>List</th><th>Target Date</th><th>Status</th><th>Slip</th></tr></thead>
        <tbody>
          {sorted.slice(0, 10).map((m) => {
            const bucket = milestoneDueBucket(m);
            const slip = executionSlipDays(m);
            const tone = deviationTone(slip);
            return (
              <tr key={m.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/projects/${slug}/milestones`)}>
                <td className="primary" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.isPaymentLinked && <span title="Payment-linked" style={{ marginRight: 5 }}>💲</span>}
                  {m.name}
                </td>
                <td>
                  {m.milestoneList && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-mid)' }}>
                      <span style={{ width: 7, height: 7, borderRadius: 2, background: m.milestoneList.color, flexShrink: 0 }} />
                      {m.milestoneList.name}
                    </span>
                  )}
                </td>
                <td style={{ color: bucket === 'Overdue' ? 'var(--fail)' : 'var(--text-mid)', fontFamily: 'var(--font-mono)' }}>{formatMilestoneDate(m.targetDate)}</td>
                <td>
                  <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: bucket === 'Overdue' ? 'var(--rose-dim)' : bucket === 'Due this month' ? 'var(--amber-dim)' : 'var(--surface2)', color: bucket === 'Overdue' ? 'var(--fail)' : bucket === 'Due this month' ? 'var(--amber)' : 'var(--text-dim)' }}>{bucket}</span>
                </td>
                <td style={{ fontWeight: 700, color: DEVIATION_COLOR[tone] }}>{slip !== null && slip > 0 ? `${slip}d` : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const TABS = [
  { key: 'overdue', label: 'Overdue Tasks' },
  { key: 'failing', label: 'Failing / Blocked Tests' },
  { key: 'defects', label: 'Critical & High Defects' },
] as const;
type TabKey = typeof TABS[number]['key'];

export default function ProjectOverview() {
  const { slug } = useParams<{ slug: string }>();
  const { data: project } = useProject(slug);
  const projectId = project?.id;
  const { data: jiraHost } = useJiraHost(projectId);
  const data = useProjectOverview(projectId);
  const { data: milestones = [] } = useMilestones(projectId);
  const [tab, setTab] = useState<TabKey>('overdue');

  const overdueMilestoneCount = milestones.filter((m) => isMilestoneOverdue(m)).length;
  const dueThisMonthMilestoneCount = milestones.filter((m) => milestoneDueBucket(m) === 'Due this month').length;

  const healthMeta = HEALTH_META[data.health.level];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Topbar breadcrumbs={[{ label: project?.name ?? slug ?? 'Project' }]} />

      <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'grid', gridTemplateColumns: '1fr', alignContent: 'start', gap: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div className="page-eyebrow">Project overview</div>
            <h1 className="page-title">{project?.name ?? slug}</h1>
            <p className="page-sub">Everything a program manager needs to gauge this project's health in one glance.</p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)', minWidth: 320 }}>
            <span style={{ width: 11, height: 11, borderRadius: '50%', background: healthMeta.color, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: healthMeta.color }}>{healthMeta.label}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-mid)' }}>{data.health.reasons.join(' · ')}</div>
            </div>
          </div>
        </div>

        {data.isLoading || !data.task ? (
          <div style={{ color: 'var(--text-dim)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>Loading…</div>
        ) : (
          <>
            {/* Stat strip */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
              <StatCard compact label="Overdue Tasks" value={data.task.overdueCount} theme="fail" sub={data.task.total - data.task.counts.DONE > 0 ? `${Math.round((data.task.overdueCount / (data.task.total - data.task.counts.DONE)) * 100)}% of open work` : undefined} />
              <StatCard compact label="Due This Week" value={data.task.dueThisWeek} theme="blocked" />
              <StatCard compact label="Test Pass Rate" value={data.passRate === null ? '—' : `${data.passRate}%`} theme="passRate" highlighted />
              <StatCard compact label="Cycle Progress" value={`${data.cycleProgress}%`} theme="progress" sub={`${data.activeCycleCount} active cycle${data.activeCycleCount === 1 ? '' : 's'}`} />
              <StatCard compact label="Critical Defects" value={data.criticalDefectsOpen} theme="fail" sub="open, unresolved" />
              <StatCard compact label="Unassigned" value={data.task.unassignedOpenCount} theme="unlinked" />
              <StatCard compact label="Milestones Overdue" value={overdueMilestoneCount} theme="fail" />
              <StatCard compact label="Milestones Due Soon" value={dueThisMonthMilestoneCount} theme="blocked" sub="this month" />
            </div>

            {/* Payment Milestones */}
            <div style={{ display: 'grid' }}>
              <div className="card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>Payment Milestones</span>
                  <Link to={`/projects/${slug}/milestones`} style={{ fontSize: 11.5, color: 'var(--cyan)', textDecoration: 'none' }}>View all →</Link>
                </div>
                <PaymentMilestonesTable milestones={milestones} slug={slug!} />
              </div>
            </div>

            {/* Task Health / Testing Health */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 16 }}>
              <div className="card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>Task Health</span>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{data.task.total} total</span>
                </div>
                <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Donut
                    rows={ALL_TASK_STATUSES.map((s) => ({ label: TASK_STATUS_LABEL[s], value: data.task!.counts[s], color: TASK_STATUS_COLOR[s] }))}
                    centerLabel={String(data.task.total)}
                    centerSub="tasks"
                  />
                  <Legend rows={ALL_TASK_STATUSES.map((s) => ({ label: TASK_STATUS_LABEL[s], value: data.task!.counts[s], color: TASK_STATUS_COLOR[s] }))} />
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '16px 0 8px' }}>Open work by priority</div>
                <HBarChart rows={(ALL_PRIORITIES as TaskPriority[]).map((p) => ({ label: PRIORITY_LABEL[p], value: data.priorityBreakdown[p] ?? 0, color: PRIORITY_ACCENT[p] }))} />
              </div>

              <div className="card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>Testing Health</span>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{data.execTotal} cases · active cycles</span>
                </div>
                {data.execTotal === 0 ? (
                  <div style={{ color: 'var(--text-dim)', fontSize: 12, fontFamily: 'var(--font-mono)', padding: 24, textAlign: 'center' }}>No active test cycles yet.</div>
                ) : (
                  <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Donut
                      rows={ALL_MANUAL_STATUSES.map((s) => ({ label: EXEC_STATUS_LABEL[s], value: data.execTotals[s], color: EXEC_STATUS_COLOR[s] }))}
                      centerLabel={data.passRate === null ? '—' : `${data.passRate}%`}
                      centerSub="pass rate"
                    />
                    <Legend rows={ALL_MANUAL_STATUSES.map((s) => ({ label: EXEC_STATUS_LABEL[s], value: data.execTotals[s], color: EXEC_STATUS_COLOR[s] }))} />
                  </div>
                )}
                <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '16px 0 8px' }}>Open defects by severity</div>
                {data.severityRows.length === 0 ? (
                  <div style={{ color: 'var(--text-dim)', fontSize: 12, fontFamily: 'var(--font-mono)', padding: '12px 0' }}>No open defects.</div>
                ) : (
                  <HBarChart rows={data.severityRows.map((r) => ({ label: SEVERITY_LABEL[r.key], value: r.count, color: SEVERITY_ACCENT[r.key] }))} />
                )}
              </div>
            </div>

            {/* Each section below is wrapped in its own single-column grid — a
                .card that's a DIRECT row of the outer 1fr grid and contains a
                flex child mis-sizes that row (it collapses to just the title
                line, clipped by .card's overflow:hidden); wrapping it the same
                way the Task Health/Testing Health split-row above already is
                gives the outer grid a nested-grid row to measure instead, which
                sizes correctly. */}
            <div style={{ display: 'grid' }}>
              <div className="card" style={{ padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Resource Workload</div>
                <ResourceWorkloadTable rows={data.resources} />
              </div>
            </div>

            {/* Test cycles */}
            <div style={{ display: 'grid' }}>
              <div className="card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>Test Cycles</span>
                  <Link to={`/projects/${slug}/test-cycles`} style={{ fontSize: 11.5, color: 'var(--cyan)', textDecoration: 'none' }}>View all →</Link>
                </div>
                <CycleStrip slug={slug!} cycles={data.cycles} />
              </div>
            </div>

            {/* Actionable tables */}
            <div style={{ display: 'grid' }}>
              <div className="card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 12 }}>
                  {TABS.map((t) => (
                    <button
                      key={t.key}
                      onClick={() => setTab(t.key)}
                      style={{
                        background: 'none', border: 'none', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                        padding: '8px 14px', marginBottom: -1,
                        color: tab === t.key ? 'var(--cyan)' : 'var(--text-dim)',
                        borderBottom: tab === t.key ? '2px solid var(--cyan)' : '2px solid transparent',
                      }}
                    >
                      {t.label} ({t.key === 'overdue' ? data.task!.overdueCount : t.key === 'failing' ? data.failingTests.length : data.criticalHighDefects.length})
                    </button>
                  ))}
                </div>
                {tab === 'overdue' && <OverdueTasksTable tasks={data.task.overdueTasks} slug={slug!} />}
                {tab === 'failing' && (data.itemsLoading ? <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>Loading…</div> : <FailingTestsTable rows={data.failingTests} />)}
                {tab === 'defects' && <DefectsTable rows={data.criticalHighDefects} jiraHost={jiraHost ?? undefined} />}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
