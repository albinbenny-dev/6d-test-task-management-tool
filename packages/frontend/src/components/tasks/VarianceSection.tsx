import { useNavigate } from 'react-router-dom';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { StatCard } from '../testCycles/StatCards';
import { DelayChip } from './DelayChip';
import { STATUS_LABEL, formatDueDate } from '../../lib/taskMeta';
import type { TaskVarianceSummary } from '../../types';

// Schedule variance on the Task Dashboard: how far work is running behind (or ahead of) its planned end, in working days with no
// grace. A phase is as late as its latest task; open tasks past their planned end count as delayed (see api/src/lib/taskVariance.ts).

const empty = (text: string) => (
  <div style={{ color: 'var(--text-dim)', fontSize: 12, fontFamily: 'var(--font-mono)', padding: 24, textAlign: 'center' }}>{text}</div>
);

const card = (title: string, sub: string | null, body: React.ReactNode) => (
  <div className="card" style={{ padding: 16 }}>
    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: sub ? 2 : 12 }}>{title}</div>
    {sub && <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 12 }}>{sub}</div>}
    {body}
  </div>
);

function weekLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function VarianceSection({ slug, v }: { slug: string; v: TaskVarianceSummary }) {
  const navigate = useNavigate();
  const hasAny = v.delayedCount + v.earlyCount + v.onTimeCount > 0;

  return (
    <>
      <div>
        <div className="page-eyebrow">Schedule variance</div>
        <p className="page-sub" style={{ marginTop: 2 }}>
          Working days against each task&rsquo;s planned end — finished work by its actual end, open work by how long it has been overdue. No grace period.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
        <StatCard compact label="Delayed" value={v.delayedCount} theme="fail" highlighted={v.delayedCount > 0} />
        <StatCard compact label="Delayed Rate" value={v.delayedRate === null ? '—' : `${v.delayedRate}%`} theme="blocked" />
        <StatCard compact label="Avg Delay" value={v.avgDelayDays === null ? '—' : `${v.avgDelayDays}d`} theme="untested" />
        <StatCard compact label="Worst Delay" value={v.maxDelayDays === null ? '—' : `${v.maxDelayDays}d`} theme="fail" />
        <StatCard compact label="Still Open & Late" value={v.delayedOpenCount} theme="progress" />
        <StatCard compact label="Finished Late" value={v.delayedDoneCount} theme="blocked" />
        <StatCard compact label="On Time" value={v.onTimeCount} theme="pass" />
        <StatCard compact label="Finished Early" value={v.earlyCount} theme="inScope" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 20 }}>
        {card('Phase variance', 'Each task list is as late as its latest task. Forecast end = the later of the planned end and today for open work.', (
          v.byTaskList.length === 0 ? empty('No task lists yet.') : (
            <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 340 }}>
              <table className="data-table" style={{ minWidth: 520 }}>
                <thead><tr><th>List</th><th>Tasks</th><th>Delayed</th><th>Max delay</th><th>Planned end</th><th>Forecast end</th></tr></thead>
                <tbody>
                  {v.byTaskList.map((l) => (
                    <tr key={l.taskListId} style={{ cursor: 'pointer' }} onClick={() => navigate(`/projects/${slug}/tasks/${l.taskListId}`)}>
                      <td className="primary">
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: l.color, flexShrink: 0 }} />{l.name}
                        </span>
                      </td>
                      <td>{l.total}</td>
                      <td style={{ color: l.delayedCount > 0 ? 'var(--fail)' : 'var(--text-dim)', fontWeight: 700 }}>{l.delayedCount}</td>
                      <td>{l.maxDelayDays === null ? <span style={{ color: 'var(--text-dim)' }}>—</span> : <DelayChip days={l.maxDelayDays} showZero />}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{l.plannedEnd ? formatDueDate(l.plannedEnd) : '—'}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', color: l.maxDelayDays !== null && l.maxDelayDays > 0 ? 'var(--fail)' : undefined }}>{l.forecastEnd ? formatDueDate(l.forecastEnd) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ))}

        {card('Delays by person', 'Tasks finished late or still open past their planned end.', (
          v.byAssignee.length === 0 ? empty('Nobody is behind.') : (
            <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 340 }}>
              <table className="data-table" style={{ minWidth: 360 }}>
                <thead><tr><th>Person</th><th>Delayed tasks</th><th>Worst delay</th></tr></thead>
                <tbody>
                  {v.byAssignee.map((a) => (
                    <tr key={a.key}>
                      <td className="primary">{a.name}</td>
                      <td style={{ color: 'var(--fail)', fontWeight: 700 }}>{a.delayed}</td>
                      <td><DelayChip days={a.maxDelayDays} showZero /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ))}
      </div>

      {card('Most delayed tasks', null, (
        v.worst.length === 0 ? empty(hasAny ? 'No delayed tasks.' : 'No planned end dates to compare against yet.') : (
          <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 380 }}>
            <table className="data-table" style={{ minWidth: 640 }}>
              <thead><tr><th>Task</th><th>List</th><th>Assignee</th><th>Status</th><th>Planned end</th><th>Finished / today</th><th>Delay</th></tr></thead>
              <tbody>
                {v.worst.map((t) => (
                  <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/projects/${slug}/tasks/${t.taskListId}?open=${t.id}`)}>
                    <td className="primary" style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</td>
                    <td>{t.taskList?.name ?? '—'}</td>
                    <td>{t.assignee?.user.name ?? t.assigneeExternalName ?? 'Unassigned'}</td>
                    <td>{STATUS_LABEL[t.status]}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{formatDueDate(t.dueDate)}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{t.refEnd ? formatDueDate(t.refEnd) : '—'}</td>
                    <td><DelayChip days={t.delayDays} status={t.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ))}

      {card('Progress against plan', 'Cumulative tasks finished, by week: planned (by planned end) vs actual (by actual end). The actual line falling below the plan is schedule drift.', (
        v.curve.length < 2 ? empty('Not enough dated tasks to draw a curve yet.') : (
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <LineChart data={v.curve} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="week" tickFormatter={weekLabel} tick={{ fontSize: 10 }} minTickGap={28} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} width={36} />
                <Tooltip labelFormatter={(l) => `Week of ${weekLabel(String(l))}`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="planned" name="Planned" stroke="#64748B" strokeWidth={2} strokeDasharray="5 3" dot={false} />
                <Line type="monotone" dataKey="actual" name="Actual" stroke="#0D9488" strokeWidth={2.5} dot={false} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )
      ))}
    </>
  );
}
