import React, { useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import Topbar, { TbBtn } from '../components/layout/Topbar';
import { useProject, useProjectMembers } from '../hooks/useProjects';
import { useProjectStore } from '../stores/projectStore';
import { useRBAC } from '../hooks/useRBAC';
import { useMyAssignments, useUpdateTestCycleItemStatus, useAssignmentHistory } from '../hooks/useTestCycles';
import { STATUS_BADGE, STATUS_COLOR, emptyStatusCounts } from '../lib/manualStatus';
import TestCaseDetailModal from '../components/testCases/TestCaseDetailModal';
import type { AssignmentItem, AssignmentHistoryEntry, ManualResultStatus, TestCycle } from '../types';

const CYCLE_STATUS_BADGE: Record<TestCycle['status'], string> = {
  PLANNING: 'badge-draft',
  ACTIVE:   'badge-run',
  CLOSED:   'badge-pass',
};

const HISTORY_DAY_OPTIONS = [7, 14, 30, 90];

function formatDayHeading(dateKey: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  if (dateKey === today) return `Today · ${dateKey}`;
  if (dateKey === yesterday) return `Yesterday · ${dateKey}`;
  return new Date(dateKey).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' });
}

// ── Daily run history — a stacked bar chart of one column per calendar day
// (defaulting to 0 for days with no activity, so the trend reads as a real
// velocity line rather than a sparse list of only-active days), sourced
// from the append-only TestCycleItemHistory audit trail for the viewed
// resource. Clicking a bar segment drills into that day's executed test
// cases below (empty days have no bar to click, since there's nothing to
// drill into). ────────────────────────────────────────────────────────────

type DailyPoint = { dayKey: string; PASS: number; FAIL: number; BLOCKED: number; NOT_RUN: number; total: number };

function buildDailySeries(history: AssignmentHistoryEntry[], days: number): DailyPoint[] {
  const byDay = new Map<string, ReturnType<typeof emptyStatusCounts>>();
  for (const entry of history) {
    const day = entry.changedAt.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, emptyStatusCounts());
    byDay.get(day)![entry.toStatus]++;
  }
  // Calendar days are UTC date strings throughout this feature (byDay keys
  // above are sliced straight from the UTC `changedAt` ISO string, and
  // formatDayHeading below compares the same way) — so "today" here must
  // also be a UTC date string. Using local midnight and re-deriving the key
  // via toISOString() would shift the whole window back a day in any
  // timezone ahead of UTC, silently dropping today's entries off the end.
  const series: DailyPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const dayKey = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    const c = byDay.get(dayKey) ?? emptyStatusCounts();
    series.push({ dayKey, PASS: c.PASS, FAIL: c.FAIL, BLOCKED: c.BLOCKED, NOT_RUN: c.NOT_RUN, total: c.PASS + c.FAIL + c.BLOCKED + c.NOT_RUN });
  }
  return series;
}

function formatShortDate(dayKey: string): string {
  return new Date(dayKey).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Total-per-day label drawn above the trend line's point — recharts' own
// LabelList would also print "0" over every empty day, so this is a plain
// custom renderer that skips zero-value days instead.
function TotalPointLabel({ x, y, value }: { x?: number; y?: number; value?: number }) {
  if (!value || x === undefined || y === undefined) return null;
  return (
    <text x={x} y={y - 8} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--text)">
      {value}
    </text>
  );
}

const HISTORY_BAR_SERIES: Array<{ key: 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_RUN'; label: string }> = [
  { key: 'PASS', label: 'Pass' },
  { key: 'FAIL', label: 'Fail' },
  { key: 'BLOCKED', label: 'Blocked' },
  { key: 'NOT_RUN', label: 'Reverted to Not Run' },
];

function VelocityTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ color: string; name: string; value: number }>;
  label?: string;
}) {
  if (!active || !payload?.length || !label) return null;
  const total = payload.reduce((s, p) => s + p.value, 0);
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 12, boxShadow: 'var(--shadow-card)' }}>
      <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>{formatShortDate(label)} · {total} run{total === 1 ? '' : 's'}</div>
      {payload.filter((p) => p.value > 0).map((p) => (
        <div key={p.name} style={{ color: p.color, marginBottom: 2 }}>{p.name}: {p.value}</div>
      ))}
    </div>
  );
}

function AssignmentHistorySection({ history, isLoading, days, onDaysChange }: {
  history: AssignmentHistoryEntry[];
  isLoading: boolean;
  days: number;
  onDaysChange: (days: number) => void;
}) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const series = buildDailySeries(history, days);
  const totalRuns = series.reduce((s, d) => s + d.total, 0);
  const avgPerDay = totalRuns > 0 ? totalRuns / days : 0;

  const byDay = new Map<string, AssignmentHistoryEntry[]>();
  for (const entry of history) {
    const day = entry.changedAt.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(entry);
  }
  // A user-clicked day sticks even if it has zero runs — only falls back to
  // yesterday (today's data is often still in flight) when the selection is
  // stale (e.g. outside the newly chosen date-range window) or nothing's
  // been clicked yet.
  const validDayKeys = new Set(series.map((d) => d.dayKey));
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const effectiveDay = selectedDay && validDayKeys.has(selectedDay)
    ? selectedDay
    : (validDayKeys.has(yesterday) ? yesterday : series[series.length - 1]?.dayKey ?? null);
  const dayEntries = effectiveDay ? (byDay.get(effectiveDay) ?? []) : [];

  const tickInterval = days <= 14 ? 0 : days <= 30 ? 2 : 6;

  return (
    <>
      {/* Card 1 — chart only. Kept separate from the drill-down below so
          clicking a day updates the second card in place instead of the
          chart's own card growing/shrinking and appearing to "replace" the
          chart with the table. */}
      <div className="card" style={{ padding: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>Daily Run History</div>
            {totalRuns > 0 && (
              <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                {totalRuns} run{totalRuns === 1 ? '' : 's'} over {days} days · avg {avgPerDay.toFixed(1)}/day
              </div>
            )}
          </div>
          <select
            className="input-field"
            value={days}
            onChange={(e) => onDaysChange(Number(e.target.value))}
            style={{ fontSize: '11px', padding: '4px 8px', width: 'auto' }}
          >
            {HISTORY_DAY_OPTIONS.map((d) => <option key={d} value={d}>Last {d} days</option>)}
          </select>
        </div>

        {isLoading ? (
          <div style={{ color: 'var(--text-dim)', fontSize: '12px' }}>Loading…</div>
        ) : (
          <div style={{ margin: '8px 0 4px' }}>
            <ResponsiveContainer width="100%" height={180}>
              <ComposedChart
                data={series}
                margin={{ top: 20, right: 4, bottom: 0, left: -20 }}
                onClick={(s: { activeLabel?: string }) => { if (s?.activeLabel) setSelectedDay(s.activeLabel); }}
                style={{ cursor: 'pointer' }}
              >
                <XAxis
                  dataKey="dayKey"
                  tickFormatter={formatShortDate}
                  tick={{ fontSize: 10, fill: 'var(--text-dim)' }}
                  axisLine={false}
                  tickLine={false}
                  interval={tickInterval}
                />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: 'var(--text-dim)' }} axisLine={false} tickLine={false} width={24} />
                <Tooltip content={<VelocityTooltip />} cursor={{ fill: 'var(--surface2)' }} />
                <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11, paddingTop: 4, cursor: 'default' }} />
                {HISTORY_BAR_SERIES.map(({ key, label }, i) => (
                  <Bar
                    key={key}
                    dataKey={key}
                    name={label}
                    stackId="a"
                    fill={STATUS_COLOR[key]}
                    radius={i === HISTORY_BAR_SERIES.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]}
                    isAnimationActive={false}
                  >
                    {series.map((d) => (
                      <Cell key={d.dayKey} fillOpacity={effectiveDay && d.dayKey !== effectiveDay ? 0.35 : 1} cursor="pointer" />
                    ))}
                  </Bar>
                ))}
                {/* Traces the top of each stacked bar and labels the day's total —
                    "trend with count" directly on the chart instead of a separate
                    mini sparkline. */}
                <Line
                  dataKey="total"
                  name="Total"
                  stroke="var(--text)"
                  strokeWidth={1.5}
                  dot={{ r: 3, fill: 'var(--text)', strokeWidth: 0 }}
                  activeDot={false}
                  isAnimationActive={false}
                  label={<TotalPointLabel />}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Card 2 — drill-down for whichever day is selected (defaults to
          yesterday). Its own card, so switching days only redraws this
          block, not the chart above. */}
      {!isLoading && (
        <div className="card" style={{ padding: '16px' }}>
          {totalRuns === 0 ? (
            <div style={{ color: 'var(--text-dim)', fontSize: '12px', fontFamily: 'var(--font-mono)', textAlign: 'center' }}>
              No runs recorded in this period.
            </div>
          ) : (
            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-mid)', marginBottom: '6px' }}>
                {effectiveDay ? formatDayHeading(effectiveDay) : ''}{' '}
                <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>({dayEntries.length} run{dayEntries.length === 1 ? '' : 's'})</span>
              </div>
              {dayEntries.length === 0 ? (
                <div style={{ color: 'var(--text-dim)', fontSize: '12px', fontFamily: 'var(--font-mono)', padding: '16px', textAlign: 'center' }}>
                  No runs on this day. Click another bar above to see a different day.
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table" style={{ minWidth: '560px' }}>
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Test Case</th>
                        <th>Cycle</th>
                        <th>Result</th>
                        <th>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dayEntries.map((entry) => (
                        <tr key={entry.id}>
                          <td style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                            {new Date(entry.changedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="primary" style={{ fontSize: '12px' }}>
                            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', marginRight: '6px' }}>{entry.testCycleItem.testCase?.srNo}</span>
                            {entry.testCycleItem.testCase?.title}
                          </td>
                          <td style={{ fontSize: '11px' }}>{entry.testCycleItem.testCycle.name}</td>
                          <td>
                            <span className={`badge ${STATUS_BADGE[entry.toStatus]}`}>{entry.toStatus}</span>
                          </td>
                          <td style={{ fontSize: '11px', maxWidth: '220px' }}>{entry.reason ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ── Inline Fail/Blocked reason + Jira keys editor (mirrors TestCycleDetail's
// ResultEditor, sized for this page's 5-column table) ──────────────────────

function ResultEditorRow({ item, pendingStatus, onSave, onCancel }: {
  item: AssignmentItem;
  pendingStatus: ManualResultStatus;
  onSave: (data: { status: ManualResultStatus; reason: string; jiraIssueKeys: string[] }) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState(item.reason ?? '');
  const [jiraKeysInput, setJiraKeysInput] = useState(() => {
    try { return (JSON.parse(item.jiraIssueKeys) as string[]).join(', '); } catch { return ''; }
  });

  function handleSave() {
    if (!reason.trim()) { toast.error('A reason is required'); return; }
    const jiraIssueKeys = jiraKeysInput.split(',').map((k) => k.trim()).filter(Boolean);
    onSave({ status: pendingStatus, reason: reason.trim(), jiraIssueKeys });
  }

  return (
    <tr>
      <td colSpan={5} style={{ background: 'var(--surface2)', padding: '12px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '480px' }}>
          <label style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-mid)' }}>
            Reason (required for {pendingStatus})
          </label>
          <textarea
            className="input-field"
            autoFocus
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{ resize: 'vertical' }}
          />
          <label style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-mid)' }}>
            Jira issue keys (comma-separated, optional)
          </label>
          <input
            className="input-field"
            value={jiraKeysInput}
            onChange={(e) => setJiraKeysInput(e.target.value)}
            placeholder="e.g. PROJ-123, PROJ-456"
          />
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <TbBtn variant="ghost" onClick={onCancel}>Cancel</TbBtn>
            <TbBtn variant="primary" onClick={handleSave}>Save Result</TbBtn>
          </div>
        </div>
      </td>
    </tr>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function Assignments() {
  const { slug } = useParams<{ slug: string }>();
  const { data: project } = useProject(slug);
  const projectId = project?.id ?? '';
  const { currentUser } = useProjectStore();
  const { canManageTestCycles } = useRBAC();
  const { data: members = [] } = useProjectMembers(projectId);
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedUserId = searchParams.get('userId') ?? undefined;

  const { data, isLoading } = useMyAssignments(projectId, selectedUserId);
  const updateStatus = useUpdateTestCycleItemStatus(projectId);

  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingStatus, setEditingStatus] = useState<ManualResultStatus | null>(null);
  const [viewingItemId, setViewingItemId] = useState<string | null>(null);
  const [historyDays, setHistoryDays] = useState(7);
  const { data: historyData, isLoading: historyLoading } = useAssignmentHistory(projectId, selectedUserId, historyDays);

  const items = data?.items ?? [];
  const viewingSelf = !selectedUserId || selectedUserId === currentUser?.id;
  const viewingMember = members.find((m) => m.user.id === (selectedUserId ?? currentUser?.id));
  // The backend enforces real ownership on every write — this only controls
  // whether the dropdown is enabled, so a non-owner doesn't get a confusing
  // "why didn't that save" experience.
  const canEditItems = viewingSelf || canManageTestCycles;

  function handleStatusChange(item: AssignmentItem, status: ManualResultStatus) {
    if (status === 'FAIL' || status === 'BLOCKED') {
      setEditingItemId(item.id);
      setEditingStatus(status);
      return;
    }
    void submitStatus(item, { status, reason: '', jiraIssueKeys: [] });
  }

  async function submitStatus(item: AssignmentItem, body: { status: ManualResultStatus; reason: string; jiraIssueKeys: string[] }) {
    try {
      await updateStatus.mutateAsync({
        cycleId: item.testCycleId,
        itemId: item.id,
        status: body.status,
        reason: body.reason || undefined,
        jiraIssueKeys: body.jiraIssueKeys,
      });
      toast.success('Result saved');
      setEditingItemId(null);
      setEditingStatus(null);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to save result';
      toast.error(msg);
    }
  }

  function handleSelectResource(userId: string) {
    if (!userId || userId === currentUser?.id) setSearchParams({});
    else setSearchParams({ userId });
  }

  const groups = new Map<string, AssignmentItem[]>();
  for (const item of items) {
    if (!groups.has(item.testCycleId)) groups.set(item.testCycleId, []);
    groups.get(item.testCycleId)!.push(item);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Topbar
        breadcrumbs={[
          { label: project?.name ?? slug ?? 'Project', href: `/projects/${slug}/test-cycles` },
          { label: 'My Assignments' },
        ]}
      />

      {/* gridAutoRows:'min-content' is the important one here: every .card has
          overflow:hidden, which gives it an automatic minimum size of 0 for
          grid sizing purposes, so plain 'auto' rows can size themselves
          below their own content (e.g. a 180px chart) once total content
          exceeds this container's height — rows overlap instead of the
          container just scrolling. Pinning row sizing to each row's actual
          min-content height (which for block content is its natural height)
          stops that; alignContent:'start' additionally keeps rows packed at
          the top instead of stretching to fill leftover space when content
          is smaller than the viewport. */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'grid', gridTemplateColumns: '1fr', gridAutoRows: 'min-content', alignContent: 'start', gap: '16px' }}>
        <div>
          <div className="page-eyebrow">Manual test management</div>
          <h1 className="page-title">My Assignments</h1>
          <p className="page-sub">
            {viewingSelf
              ? 'Test cases assigned to you, across every cycle.'
              : `Viewing ${viewingMember?.user.name ?? 'resource'}'s assigned test cases.`}
          </p>
        </div>

        {canManageTestCycles && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={{ fontSize: '11px', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase' }}>Resource</label>
            <select
              className="input-field"
              style={{ fontSize: '12px', padding: '5px 10px', width: 'auto' }}
              value={selectedUserId ?? currentUser?.id ?? ''}
              onChange={(e) => handleSelectResource(e.target.value)}
            >
              {currentUser && <option value={currentUser.id}>Me ({currentUser.name})</option>}
              {members
                .filter((m) => m.user.id !== currentUser?.id)
                .map((m) => <option key={m.userId} value={m.user.id}>{m.user.name}</option>)}
            </select>
          </div>
        )}

        {isLoading ? (
          <div style={{ color: 'var(--text-dim)', fontSize: '12px' }}>Loading…</div>
        ) : items.length === 0 ? (
          <div style={{ color: 'var(--text-dim)', fontSize: '12px', fontFamily: 'var(--font-mono)', padding: '24px', textAlign: 'center' }}>
            No test cases assigned{viewingSelf ? ' to you' : ''} yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {[...groups.entries()].map(([cycleId, cycleItems]) => {
              const cycle = cycleItems[0].testCycle;
              return (
                <div key={cycleId} className="card" style={{ padding: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                    <Link to={`/projects/${slug}/test-cycles/${cycleId}`} style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)', textDecoration: 'none' }}>
                      {cycle.name}
                    </Link>
                    <span className={`badge ${CYCLE_STATUS_BADGE[cycle.status]}`}>{cycle.status}</span>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="data-table" style={{ minWidth: '600px' }}>
                      <thead>
                        <tr>
                          <th></th>
                          <th>Test Case</th>
                          <th>Status</th>
                          <th>Reason</th>
                          <th>Jira Keys</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cycleItems.map((item) => {
                          let jiraKeys: string[] = [];
                          try { jiraKeys = JSON.parse(item.jiraIssueKeys); } catch { /* ignore */ }
                          return (
                            <React.Fragment key={item.id}>
                              <tr>
                                <td>
                                  {item.testCase && (
                                    <button
                                      onClick={() => setViewingItemId(item.testCaseId)}
                                      title="View test case"
                                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', color: 'var(--text-dim)' }}
                                    >
                                      👁
                                    </button>
                                  )}
                                </td>
                                <td className="primary">
                                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', marginRight: '6px' }}>{item.testCase?.srNo}</span>
                                  {item.testCase?.title}
                                </td>
                                <td>
                                  <select
                                    className="input-field"
                                    value={item.manualStatus}
                                    disabled={!canEditItems}
                                    onChange={(e) => handleStatusChange(item, e.target.value as ManualResultStatus)}
                                    style={{ fontSize: '11px', padding: '3px 6px', width: 'auto' }}
                                  >
                                    <option value="NOT_RUN">Not Run</option>
                                    <option value="IN_PROGRESS">In Progress</option>
                                    <option value="PASS">Pass</option>
                                    <option value="FAIL">Fail</option>
                                    <option value="BLOCKED">Blocked</option>
                                  </select>
                                  <span className={`badge ${STATUS_BADGE[item.manualStatus]}`} style={{ marginLeft: '6px' }}>{item.manualStatus}</span>
                                </td>
                                <td style={{ fontSize: '11px', maxWidth: '200px' }}>{item.reason ?? '—'}</td>
                                <td style={{ fontSize: '11px', fontFamily: 'var(--font-mono)' }}>{jiraKeys.join(', ') || '—'}</td>
                              </tr>
                              {editingItemId === item.id && editingStatus && (
                                <ResultEditorRow
                                  item={item}
                                  pendingStatus={editingStatus}
                                  onSave={(body) => void submitStatus(item, body)}
                                  onCancel={() => { setEditingItemId(null); setEditingStatus(null); }}
                                />
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <AssignmentHistorySection
          history={historyData?.history ?? []}
          isLoading={historyLoading}
          days={historyDays}
          onDaysChange={setHistoryDays}
        />
      </div>

      {viewingItemId && (
        <TestCaseDetailModal projectId={projectId} itemId={viewingItemId} onClose={() => setViewingItemId(null)} />
      )}
    </div>
  );
}
