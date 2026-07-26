import { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Topbar from '../components/layout/Topbar';
import { useProject } from '../hooks/useProjects';
import { useTestCycleDashboardSummary, useResourceSummary } from '../hooks/useTestCycles';
import { StatCard, JiraRingCard } from '../components/testCycles/StatCards';
import { emptyStatusCounts } from '../lib/manualStatus';
import type { ManualResultStatus, TestCycle, TestCycleSummary, ResourceSummaryRow } from '../types';

const CYCLE_STATUS_BADGE: Record<TestCycle['status'], string> = {
  PLANNING: 'badge-draft',
  ACTIVE:   'badge-run',
  CLOSED:   'badge-pass',
};

// ── Status by Cycle — one compact row per cycle, scales to many cycles
// without stacking a full card per cycle (that got congested fast).

function CycleSummaryTable({ slug, summary }: { slug: string; summary: TestCycleSummary[] }) {
  const navigate = useNavigate();
  return (
    // maxHeight + overflowY so a project with many cycles scrolls inside this
    // card instead of either cutting cycles off with no way to reach them
    // (overflow:hidden from .card) or pushing Resource-wise Summary far down
    // the page.
    <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '340px' }}>
      <table className="data-table" style={{ minWidth: '640px' }}>
        <thead>
          <tr>
            <th>Cycle</th>
            <th>Status</th>
            <th>Total</th>
            <th>Passed</th>
            <th>Failed</th>
            <th>In Progress</th>
            <th>Blocked</th>
            <th>Untested</th>
            <th>Pass %</th>
          </tr>
        </thead>
        <tbody>
          {summary.map((s) => {
            const { cycle, counts, total } = s;
            const passRate = total > 0 ? Math.round((counts.PASS / total) * 100) : 0;
            return (
              <tr
                key={cycle.id}
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/projects/${slug}/test-cycles/${cycle.id}`)}
              >
                <td className="primary">{cycle.name}</td>
                <td><span className={`badge ${CYCLE_STATUS_BADGE[cycle.status]}`}>{cycle.status}</span></td>
                <td>{total}</td>
                <td style={{ color: 'var(--pass)', fontWeight: 700 }}>{counts.PASS}</td>
                <td style={{ color: 'var(--fail)', fontWeight: 700 }}>{counts.FAIL}</td>
                <td style={{ color: 'var(--run)', fontWeight: 700 }}>{counts.IN_PROGRESS}</td>
                <td style={{ color: 'var(--violet)', fontWeight: 700 }}>{counts.BLOCKED}</td>
                <td style={{ color: 'var(--text-dim)' }}>{counts.NOT_RUN}</td>
                <td style={{ fontWeight: 700, color: 'var(--text)' }}>{passRate}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Resource summary — SPOC-style table, replaces the old daily trend chart ─

function ResourceSummaryTable({ slug, rows, isLoading }: { slug: string; rows: ResourceSummaryRow[]; isLoading: boolean }) {
  const navigate = useNavigate();
  if (isLoading) {
    return <div style={{ color: 'var(--text-dim)', fontSize: '12px' }}>Loading…</div>;
  }
  if (rows.length === 0) {
    return (
      <div style={{ color: 'var(--text-dim)', fontSize: '12px', fontFamily: 'var(--font-mono)', padding: '24px', textAlign: 'center' }}>
        No test cases assigned in any active cycle yet.
      </div>
    );
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="data-table" style={{ minWidth: '600px' }}>
        <thead>
          <tr>
            <th>Resource</th>
            <th>Total</th>
            <th>Passed</th>
            <th>Failed</th>
            <th>In Progress</th>
            <th>Blocked</th>
            <th>Untested</th>
            <th>Pass %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.assigneeId ?? 'unassigned'}
              style={{ cursor: r.userId ? 'pointer' : 'default' }}
              onClick={() => r.userId && navigate(`/projects/${slug}/test-cycles/assignments?userId=${r.userId}`)}
              title={r.userId ? `View ${r.assigneeName}'s assignments` : undefined}
            >
              <td className="primary">{r.assigneeName}</td>
              <td>{r.total}</td>
              <td style={{ color: 'var(--pass)', fontWeight: 700 }}>{r.counts.PASS}</td>
              <td style={{ color: 'var(--fail)', fontWeight: 700 }}>{r.counts.FAIL}</td>
              <td style={{ color: 'var(--run)', fontWeight: 700 }}>{r.counts.IN_PROGRESS}</td>
              <td style={{ color: 'var(--violet)', fontWeight: 700 }}>{r.counts.BLOCKED}</td>
              <td style={{ color: 'var(--text-dim)' }}>{r.counts.NOT_RUN}</td>
              <td style={{ fontWeight: 700, color: 'var(--text)' }}>{r.passRate}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function TestCyclesDashboard() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { data: project } = useProject(slug);
  const projectId = project?.id;

  const { data: dashboardData, isLoading: summaryLoading } = useTestCycleDashboardSummary(projectId);
  const summary = dashboardData?.summary ?? [];
  const jira = dashboardData?.jira ?? { tickets: { resolved: 0, total: 0 }, testCases: { resolved: 0, total: 0 } };
  const { data: resourceSummary = [], isLoading: resourceLoading } = useResourceSummary(projectId);

  // "Total" only counts ACTIVE cycles — a stale PLANNING cycle or a leftover
  // test/junk cycle shouldn't skew what the dashboard reports as in-flight work.
  const overall = useMemo(() => {
    const totals = emptyStatusCounts();
    let total = 0;
    const activeSummaries = summary.filter((s) => s.cycle.status === 'ACTIVE');
    for (const s of activeSummaries) {
      total += s.total;
      (Object.keys(totals) as ManualResultStatus[]).forEach((k) => { totals[k] += s.counts[k]; });
    }
    const passRate = total > 0 ? Math.round((totals.PASS / total) * 100) : 0;
    return { total, totals, passRate, activeCycles: activeSummaries.length };
  }, [summary]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Topbar
        breadcrumbs={[
          { label: project?.name ?? slug ?? 'Project', href: `/projects/${slug}/test-cycles` },
          { label: 'Test Cycles', href: `/projects/${slug}/test-cycles` },
          { label: 'Dashboard' },
        ]}
      />

      {/*
        display:'grid' (not flex column) deliberately — flex items with
        flex-shrink:1 combined with a child's `overflow:hidden` (every
        .card) resolve their flexbox automatic-minimum-size to 0, so once
        total content exceeds the viewport the browser silently crushes
        a section to a sliver instead of letting this container scroll.
        Grid rows size to content and don't have that failure mode.
        gridTemplateColumns:'1fr' pins the column to the container's actual
        width — otherwise an auto-sized track grows to fit a flex child's
        un-wrapped max-content width (flex-wrap is ignored when computing
        max-content), overflowing the page horizontally.
        alignContent:'start' stops grid's default "stretch auto rows to fill
        leftover space" behavior — without it the gaps between sections grow
        or shrink depending on how much content is below, instead of every
        section just sitting at its natural height from the top.
      */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'grid', gridTemplateColumns: '1fr', alignContent: 'start', gap: '20px' }}>
        <div>
          <div className="page-eyebrow">Manual test management</div>
          <h1 className="page-title">Test Cycles Dashboard</h1>
          <p className="page-sub">Live status of active cycles and current workload per resource.</p>
        </div>

        {/* Overall status — same card design as the cycle detail page. Only ACTIVE
            cycles feed these totals, so a stale PLANNING cycle or leftover test
            cycle doesn't skew what's reported as the current in-flight picture. */}
        <div style={{ fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
          {summary.length} cycle{summary.length === 1 ? '' : 's'} · {overall.activeCycles} active · totals below reflect active cycles only
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '10px' }}>
          <StatCard compact label="Total" value={overall.total} theme="total" highlighted />
          <StatCard compact label="Passed" value={overall.totals.PASS} theme="pass" />
          <StatCard compact label="Failed" value={overall.totals.FAIL} theme="fail" />
          <StatCard compact label="In Progress" value={overall.totals.IN_PROGRESS} theme="progress" />
          <StatCard compact label="Blocked" value={overall.totals.BLOCKED} theme="blocked" />
          <StatCard compact label="Untested" value={overall.totals.NOT_RUN} theme="untested" />
          <JiraRingCard compact tickets={jira.tickets} onClick={() => navigate(`/projects/${slug}/test-cycles`)} />
          <StatCard compact label="Pass Rate" value={`${overall.passRate}%`} theme="passRate" highlighted />
        </div>

        {/* Per-cycle breakdown — one compact row per cycle, not a card stack,
            so this stays legible as the number of cycles grows. */}
        <div className="card" style={{ padding: '16px' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)', marginBottom: '12px' }}>Status by Cycle</div>
          {summaryLoading ? (
            <div style={{ color: 'var(--text-dim)', fontSize: '12px' }}>Loading…</div>
          ) : summary.length === 0 ? (
            <div style={{ color: 'var(--text-dim)', fontSize: '12px', fontFamily: 'var(--font-mono)', padding: '24px', textAlign: 'center' }}>No test cycles yet.</div>
          ) : (
            <CycleSummaryTable slug={slug!} summary={summary} />
          )}
        </div>

        {/* Resource-wise summary — SPOC-style totals across active cycles */}
        <div className="card" style={{ padding: '16px' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)', marginBottom: '12px' }}>Resource-wise Summary</div>
          <ResourceSummaryTable slug={slug!} rows={resourceSummary} isLoading={resourceLoading} />
        </div>
      </div>
    </div>
  );
}
