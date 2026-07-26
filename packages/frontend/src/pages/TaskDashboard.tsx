import { useParams, Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import Topbar, { TbBtn } from '../components/layout/Topbar';
import StatTile from '../components/ui/StatTile';
import { useProject } from '../hooks/useProjects';
import { useTaskDashboard } from '../hooks/useTasks';
import { STATUS_LABEL, formatDueDate } from '../lib/taskMeta';
import { PriorityBadge } from '../components/tasks/PriorityBadge';

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name: string; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 11 }}>
      <div style={{ fontWeight: 700, marginBottom: 4, color: 'var(--text)' }}>{label}</div>
      {payload.map((p) => (
        <div key={p.name} style={{ color: p.color }}>{p.name}: {p.value}</div>
      ))}
    </div>
  );
}

export default function TaskDashboard() {
  const { slug } = useParams<{ slug: string }>();
  const { data: project } = useProject(slug);
  const projectId = project?.id;
  const { data, isLoading } = useTaskDashboard(projectId);

  const chartData = (data?.byAssignee ?? []).slice(0, 10).map((row) => ({
    name: row.assigneeName.length > 12 ? row.assigneeName.slice(0, 11) + '…' : row.assigneeName,
    Open: row.total,
    Overdue: row.overdue,
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Topbar
        breadcrumbs={[
          { label: project?.name ?? slug ?? 'Project', href: `/projects/${slug}/test-cycles` },
          { label: 'Task Management', href: `/projects/${slug}/tasks` },
          { label: 'Dashboard' },
        ]}
        actions={<Link to={`/projects/${slug}/tasks`}><TbBtn variant="ghost">📋 All Lists</TbBtn></Link>}
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
        <div className="page-eyebrow">Task Management</div>
        <h1 className="page-title">Task Dashboard</h1>
        <p className="page-sub">Workload and progress across every task list in this project.</p>

        {isLoading || !data ? (
          <div style={{ marginTop: 20, color: 'var(--text-dim)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>Loading…</div>
        ) : (
          <>
            <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
              <StatTile label="Total" value={data.total} accent="var(--cool-accent)" />
              <StatTile label={STATUS_LABEL.TO_DO} value={data.counts.TO_DO} accent="var(--border2)" />
              <StatTile label={STATUS_LABEL.IN_PROGRESS} value={data.counts.IN_PROGRESS} accent="var(--run)" />
              <StatTile label={STATUS_LABEL.IN_REVIEW} value={data.counts.IN_REVIEW} accent="#8b5cf6" />
              <StatTile label={STATUS_LABEL.DONE} value={data.counts.DONE} accent="var(--pass)" />
              <StatTile label="Overdue" value={data.overdueCount} accent="var(--fail)" />
              <StatTile label="Completed (7d)" value={data.completedThisWeek} accent="var(--emerald)" />
            </div>

            <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 16 }}>
              <div className="card" style={{ padding: '16px 16px 8px' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>Open Tasks by Assignee</div>
                {chartData.length === 0 ? (
                  <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
                    No open tasks.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={chartData} margin={{ top: 0, right: 8, bottom: 0, left: -20 }}>
                      <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-dim)' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: 'var(--text-dim)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="Open" fill="var(--cyan)" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="Overdue" fill="var(--fail)" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="card" style={{ padding: 0, display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', padding: '16px 16px 0' }}>Overdue Tasks</div>
                <div style={{ flex: 1, overflowY: 'auto', maxHeight: 220 }}>
                  {data.overdueTasks.length === 0 && (
                    <div style={{ padding: 16, color: 'var(--text-dim)', fontSize: 12 }}>Nothing overdue 🎉</div>
                  )}
                  {data.overdueTasks.map((t) => (
                    <div key={t.id} style={{ padding: '9px 16px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {t.title}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--fail)', fontFamily: 'var(--font-mono)' }}>
                          Due {formatDueDate(t.dueDate)}
                        </div>
                      </div>
                      <PriorityBadge priority={t.priority} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
