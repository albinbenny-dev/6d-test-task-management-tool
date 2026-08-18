import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import Topbar from '../components/layout/Topbar';
import { useProject } from '../hooks/useProjects';
import { useTestCycleDashboardSummary, useResourceSummary, useTestCycleDashboardHistory } from '../hooks/useTestCycles';
import { StatCard, JiraRingCard } from '../components/testCycles/StatCards';
import { emptyStatusCounts } from '../lib/manualStatus';
import { DAY_RANGE_OPTIONS, dayKeyOf, lastNDayKeys, formatShortDate } from '../lib/dailySeries';
import type { ManualResultStatus, TestCycle, TestCycleSummary, ResourceSummaryRow, DashboardHistoryEntry } from '../types';

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
    // the page. 420px ≈ header + 10 data rows (34px + 10×38px) at the
    // .data-table row metrics in globals.css, so at least 10 rows are visible
    // before the scrollbar kicks in.
    <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '420px' }}>
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
    // Same fix as CycleSummaryTable above: without an explicit maxHeight +
    // overflowY, rows beyond the card's natural height were being clipped by
    // .card's overflow:hidden with no scrollbar to reach them. 420px ≈
    // header + 10 data rows at the .data-table row metrics in globals.css.
    <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '420px' }}>
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

// ── Daily execution count by cycle — one stacked bar per calendar day,
// segmented by which cycle the executions belong to, with a line tracing
// the day's total. Sourced from the project-wide TestCycleItemHistory audit
// trail (GET /dashboard/history), bucketed client-side the same way the
// per-resource "Daily Run History" chart on My Assignments is. Capped to the
// busiest cycles in the window + an "Other" bucket so a project with many
// cycles doesn't blow the legend/chart out with a color per cycle. ─────────

const CHART_PALETTE = ['#2563eb', '#ea580c', '#0f766e', '#7c3aed', '#be185d', '#65a30d'];
const OTHER_COLOR = 'var(--text-dim)';
const TOP_N_CYCLES = 6;

type DailyCyclePoint = { dayKey: string; total: number } & Record<string, number>;

function buildDailyCycleSeries(
  history: DashboardHistoryEntry[],
  days: number,
  cycleKeys: string[],
): DailyCyclePoint[] {
  const byDay = new Map<string, Record<string, number>>();
  for (const entry of history) {
    const day = dayKeyOf(entry.changedAt);
    if (!byDay.has(day)) byDay.set(day, {});
    const rec = byDay.get(day)!;
    rec[entry.testCycleId] = (rec[entry.testCycleId] ?? 0) + 1;
  }
  return lastNDayKeys(days).map((dayKey) => {
    const rec = byDay.get(dayKey) ?? {};
    const point = { dayKey } as DailyCyclePoint;
    let total = 0;
    for (const key of cycleKeys) {
      const count = key === 'other'
        ? Object.entries(rec).filter(([k]) => !cycleKeys.includes(k)).reduce((s, [, v]) => s + v, 0)
        : (rec[key] ?? 0);
      point[key] = count;
      total += count;
    }
    point.total = total;
    return point;
  });
}

function DailyExecutionTooltip({ active, payload, label, nameByKey }: {
  active?: boolean;
  payload?: Array<{ color: string; dataKey: string; value: number }>;
  label?: string;
  nameByKey: Map<string, string>;
}) {
  if (!active || !payload?.length || !label) return null;
  const total = payload.reduce((s, p) => s + p.value, 0);
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 12, boxShadow: 'var(--shadow-card)' }}>
      <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>{formatShortDate(label)} · {total} execution{total === 1 ? '' : 's'}</div>
      {payload.filter((p) => p.value > 0).map((p) => (
        <div key={p.dataKey} style={{ color: p.color, marginBottom: 2 }}>{nameByKey.get(p.dataKey) ?? p.dataKey}: {p.value}</div>
      ))}
    </div>
  );
}

function DailyExecutionChart({ history, isLoading, summary, days, onDaysChange }: {
  history: DashboardHistoryEntry[];
  isLoading: boolean;
  summary: TestCycleSummary[];
  days: number;
  onDaysChange: (days: number) => void;
}) {
  const nameByCycleId = useMemo(() => new Map(summary.map((s) => [s.cycle.id, s.cycle.name])), [summary]);

  const { cycleKeys, colorByKey } = useMemo(() => {
    const totals = new Map<string, number>();
    for (const entry of history) totals.set(entry.testCycleId, (totals.get(entry.testCycleId) ?? 0) + 1);
    const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    const top = sorted.slice(0, TOP_N_CYCLES);
    const keys = sorted.length > TOP_N_CYCLES ? [...top, 'other'] : top;
    const colors = new Map<string, string>();
    keys.forEach((key, i) => colors.set(key, key === 'other' ? OTHER_COLOR : CHART_PALETTE[i % CHART_PALETTE.length]));
    return { cycleKeys: keys, colorByKey: colors };
  }, [history]);

  const nameByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const key of cycleKeys) map.set(key, key === 'other' ? 'Other cycles' : (nameByCycleId.get(key) ?? 'Unknown cycle'));
    return map;
  }, [cycleKeys, nameByCycleId]);

  const series = buildDailyCycleSeries(history, days, cycleKeys);
  const totalRuns = series.reduce((s, d) => s + d.total, 0);
  const tickInterval = days <= 14 ? 0 : days <= 30 ? 2 : 6;

  return (
    // minHeight is an explicit, synchronous value on purpose — Recharts'
    // ResponsiveContainer needs a ResizeObserver pass to measure its 100%
    // width before it renders anything, so on the very first layout pass
    // this card is briefly near-empty. If the surrounding CSS Grid sizes
    // this row from that transient state and never fully re-validates it
    // once the chart renders in at its real size, the next card ends up
    // positioned using the stale, too-small height — overlapping this one.
    // A fixed minHeight (heading ~40px + 224px chart + legend + padding,
    // plus buffer) gives the grid a known value from the first paint, no
    // async measurement required.
    <div className="card" style={{ padding: '16px', minHeight: '340px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
        <div>
          <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>Daily Execution Count by Cycle</div>
          {totalRuns > 0 && (
            <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
              {totalRuns} execution{totalRuns === 1 ? '' : 's'} over {days} days
            </div>
          )}
        </div>
        <select
          className="input-field"
          value={days}
          onChange={(e) => onDaysChange(Number(e.target.value))}
          style={{ fontSize: '11px', padding: '4px 8px', width: 'auto' }}
        >
          {DAY_RANGE_OPTIONS.map((d) => <option key={d} value={d}>Last {d} days</option>)}
        </select>
      </div>

      {isLoading ? (
        <div style={{ color: 'var(--text-dim)', fontSize: '12px' }}>Loading…</div>
      ) : totalRuns === 0 ? (
        <div style={{ color: 'var(--text-dim)', fontSize: '12px', fontFamily: 'var(--font-mono)', padding: '24px', textAlign: 'center' }}>
          No executions recorded in this period.
        </div>
      ) : (
        <div style={{ margin: '8px 0 4px' }}>
          <ResponsiveContainer width="100%" height={224}>
            <ComposedChart data={series} margin={{ top: 8, right: 4, bottom: 0, left: -20 }}>
              <XAxis
                dataKey="dayKey"
                tickFormatter={formatShortDate}
                tick={{ fontSize: 10, fill: 'var(--text-dim)' }}
                axisLine={false}
                tickLine={false}
                interval={tickInterval}
              />
              <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: 'var(--text-dim)' }} axisLine={false} tickLine={false} width={24} />
              <Tooltip content={<DailyExecutionTooltip nameByKey={nameByKey} />} cursor={{ fill: 'var(--surface2)' }} />
              <Legend
                iconType="circle"
                iconSize={7}
                // position:'relative' takes the legend out of Recharts'
                // default absolute-overlay positioning, which is excluded
                // from how the browser measures this card's natural content
                // height (out-of-flow elements don't count toward it) — so
                // once .card was fixed to respect its true content height
                // (see globals.css .card min-height), the legend kept
                // visually painting past the chart's fixed-height box into
                // whatever card sits below it. Relative positioning makes it
                // a normal flow child that actually reserves its own space.
                wrapperStyle={{ fontSize: 11, paddingTop: 4, position: 'relative' }}
                formatter={(value, entry) => nameByKey.get((entry as { dataKey?: string }).dataKey ?? '') ?? String(value)}
              />
              {cycleKeys.map((key, i) => (
                <Bar
                  key={key}
                  dataKey={key}
                  stackId="a"
                  fill={colorByKey.get(key)}
                  radius={i === cycleKeys.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]}
                  isAnimationActive={false}
                />
              ))}
              <Line
                dataKey="total"
                name="Total"
                stroke="var(--text)"
                strokeWidth={1.5}
                dot={{ r: 3, fill: 'var(--text)', strokeWidth: 0 }}
                activeDot={false}
                isAnimationActive={false}
                legendType="none"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
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

  const [historyDays, setHistoryDays] = useState(30);
  const { data: historyData, isLoading: historyLoading } = useTestCycleDashboardHistory(projectId, historyDays);

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
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '24px', display: 'grid', gridTemplateColumns: '1fr', alignContent: 'start', gap: '20px' }}>
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

        <DailyExecutionChart
          history={historyData?.history ?? []}
          isLoading={historyLoading}
          summary={summary}
          days={historyDays}
          onDaysChange={setHistoryDays}
        />

        {/* Resource-wise summary — SPOC-style totals across active cycles */}
        <div className="card" style={{ padding: '16px' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)', marginBottom: '12px' }}>Resource-wise Summary</div>
          <ResourceSummaryTable slug={slug!} rows={resourceSummary} isLoading={resourceLoading} />
        </div>
      </div>
    </div>
  );
}
