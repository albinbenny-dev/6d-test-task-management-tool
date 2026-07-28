import { useParams, useNavigate, Link } from 'react-router-dom';
import Topbar, { TbBtn } from '../components/layout/Topbar';
import { useProject } from '../hooks/useProjects';
import { useTaskDashboard } from '../hooks/useTasks';
import { StatCard } from '../components/testCycles/StatCards';
import { STATUS_LABEL, formatDueDate } from '../lib/taskMeta';
import { PriorityBadge } from '../components/tasks/PriorityBadge';
import type { TaskListSummary, TaskAssigneeSummary, Task } from '../types';

// ── Task Lists — one row per list (including empty ones), worst-behind
// (most overdue) first, so a lead sees at a glance which list needs
// attention — mirrors TestCyclesDashboard.tsx's CycleSummaryTable. ─────────
function TaskListsTable({ slug, lists }: { slug: string; lists: TaskListSummary[] }) {
  const navigate = useNavigate();
  if (lists.length === 0) {
    return <div style={{ color: 'var(--text-dim)', fontSize: 12, fontFamily: 'var(--font-mono)', padding: 24, textAlign: 'center' }}>No task lists yet.</div>;
  }
  return (
    <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 340 }}>
      <table className="data-table" style={{ minWidth: 520 }}>
        <thead>
          <tr>
            <th>List</th>
            <th>Total</th>
            <th>Done</th>
            <th>Overdue</th>
            <th>Completion</th>
          </tr>
        </thead>
        <tbody>
          {lists.map((l) => (
            <tr key={l.taskListId} style={{ cursor: 'pointer' }} onClick={() => navigate(`/projects/${slug}/tasks/${l.taskListId}`)}>
              <td className="primary">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: l.color, flexShrink: 0 }} />
                  {l.name}
                </span>
              </td>
              <td>{l.total}</td>
              <td style={{ color: 'var(--pass)', fontWeight: 700 }}>{l.done}</td>
              <td style={{ color: l.overdue > 0 ? 'var(--fail)' : 'var(--text-dim)', fontWeight: 700 }}>{l.overdue}</td>
              <td style={{ fontWeight: 700, color: 'var(--text)' }}>{l.completionRate}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Resource-wise Summary — open task load + overdue count per assignee ───
function ResourceSummaryTable({ rows }: { rows: TaskAssigneeSummary[] }) {
  if (rows.length === 0) {
    return <div style={{ color: 'var(--text-dim)', fontSize: 12, fontFamily: 'var(--font-mono)', padding: 24, textAlign: 'center' }}>No open tasks.</div>;
  }
  return (
    <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 340 }}>
      <table className="data-table" style={{ minWidth: 420 }}>
        <thead>
          <tr>
            <th>Resource</th>
            <th>Open</th>
            <th>Overdue</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.assigneeId ?? 'unassigned'}>
              <td className="primary">{r.assigneeName}</td>
              <td>{r.total}</td>
              <td style={{ color: r.overdue > 0 ? 'var(--fail)' : 'var(--text-dim)', fontWeight: 700 }}>{r.overdue}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Overdue Tasks — re-skinned as a data-table for visual consistency with
// the two tables above it, same data/cap (25) as before. ──────────────────
function OverdueTasksTable({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) {
    return <div style={{ color: 'var(--text-dim)', fontSize: 12, fontFamily: 'var(--font-mono)', padding: 24, textAlign: 'center' }}>Nothing overdue 🎉</div>;
  }
  return (
    <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 340 }}>
      <table className="data-table" style={{ minWidth: 560 }}>
        <thead>
          <tr>
            <th>Title</th>
            <th>List</th>
            <th>Assignee</th>
            <th>Due</th>
            <th>Priority</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id}>
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

// ── Page ─────────────────────────────────────────────────────────────────

export default function TaskDashboard() {
  const { slug } = useParams<{ slug: string }>();
  const { data: project } = useProject(slug);
  const projectId = project?.id;
  const { data, isLoading } = useTaskDashboard(projectId);

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

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'grid', gridTemplateColumns: '1fr', alignContent: 'start', gap: 20 }}>
        <div>
          <div className="page-eyebrow">Task Management</div>
          <h1 className="page-title">Task Dashboard</h1>
          <p className="page-sub">Workload, delivery quality, and progress across every task list in this project.</p>
        </div>

        {isLoading || !data ? (
          <div style={{ color: 'var(--text-dim)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>Loading…</div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
              <StatCard compact label="Total" value={data.total} theme="total" highlighted />
              <StatCard compact label={STATUS_LABEL.TO_DO} value={data.counts.TO_DO} theme="untested" />
              <StatCard compact label={STATUS_LABEL.IN_PROGRESS} value={data.counts.IN_PROGRESS} theme="progress" />
              <StatCard compact label={STATUS_LABEL.IN_REVIEW} value={data.counts.IN_REVIEW} theme="review" />
              <StatCard compact label={STATUS_LABEL.DONE} value={data.counts.DONE} theme="pass" />
              <StatCard compact label="Overdue" value={data.overdueCount} theme="fail" />
              <StatCard compact label="Due This Week" value={data.dueThisWeek} theme="blocked" />
              <StatCard compact label="Due Next Week" value={data.dueNextWeek} theme="inScope" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
              <StatCard compact label="Completion Rate" value={`${data.completionRate}%`} theme="passRate" highlighted />
              <StatCard compact label="On-Time Rate" value={data.onTimeRate === null ? '—' : `${data.onTimeRate}%`} theme="pass" />
              <StatCard compact label="Avg Cycle Time" value={data.avgCycleTimeDays === null ? '—' : `${data.avgCycleTimeDays}d`} theme="untested" />
              <StatCard compact label="Unassigned Open" value={data.unassignedOpenCount} theme="unlinked" />
            </div>

            {/* Side-by-side on any normal-width laptop screen (auto-fit wraps to
                one column only once the viewport is genuinely narrow) — cuts a
                full section's height off the page, so Resource-wise Summary
                isn't pushed a whole extra scroll below the fold on shorter
                laptop displays. */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 20 }}>
              <div className="card" style={{ padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>Task Lists</div>
                <TaskListsTable slug={slug!} lists={data.byTaskList} />
              </div>

              <div className="card" style={{ padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>Resource-wise Summary</div>
                <ResourceSummaryTable rows={data.byAssignee} />
              </div>
            </div>

            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>Overdue Tasks</div>
              <OverdueTasksTable tasks={data.overdueTasks} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
