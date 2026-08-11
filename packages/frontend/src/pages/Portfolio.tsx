import { useMemo, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import Topbar from '../components/layout/Topbar';
import { useProjects } from '../hooks/useProjects';
import { useProjectStore } from '../stores/projectStore';
import { usePortfolioData, type PortfolioProjectRow, type PortfolioResourceRow, type PortfolioOverdueTask, type PortfolioMilestoneRow, type ProjectHealth, type ResourceLoad } from '../hooks/usePortfolio';
import { StatCard } from '../components/testCycles/StatCards';
import { PriorityBadge } from '../components/tasks/PriorityBadge';
import { landingPath } from '../lib/projectLanding';
import { deviationTone, DEVIATION_COLOR, formatMilestoneDate } from '../lib/milestoneMeta';
import type { Project } from '../types';

const HEALTH_META: Record<ProjectHealth, { label: string; color: string }> = {
  healthy:  { label: 'Healthy',  color: 'var(--pass)' },
  'at-risk':{ label: 'At risk',  color: 'var(--amber)' },
  critical: { label: 'Critical', color: 'var(--fail)' },
};

const LOAD_META: Record<ResourceLoad, { label: string; color: string; bg: string }> = {
  low:    { label: 'Low',        color: 'var(--pass)',  bg: 'var(--pass-dim, rgba(5,150,105,0.10))' },
  medium: { label: 'Medium',     color: 'var(--cyan)',  bg: 'var(--cyan-dim)' },
  high:   { label: 'High',       color: 'var(--amber)', bg: 'var(--amber-dim)' },
  over:   { label: 'Overloaded', color: 'var(--fail)',  bg: 'var(--fail-dim)' },
};

function barFill(pct: number) {
  const color = pct >= 75 ? 'var(--pass)' : pct >= 50 ? 'var(--cyan)' : pct >= 30 ? 'var(--amber)' : 'var(--fail)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 110 }}>
      <div style={{ flex: 1, height: 6, borderRadius: 4, background: 'var(--surface2)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 4 }} />
      </div>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, fontWeight: 700, width: 32, textAlign: 'right', flexShrink: 0 }}>{pct}%</span>
    </div>
  );
}

function HealthPill({ health }: { health: ProjectHealth }) {
  const m = HEALTH_META[health];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px 3px 7px', borderRadius: 100, fontSize: 10.5, fontWeight: 700, background: 'var(--surface2)', color: m.color }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: m.color }} />
      {m.label}
    </span>
  );
}

function ProjectsTable({ rows, projectById, globalRole }: { rows: PortfolioProjectRow[]; projectById: Map<string, Project>; globalRole: string | undefined }) {
  const navigate = useNavigate();
  if (rows.length === 0) {
    return <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-dim)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>No projects to show.</div>;
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="data-table" style={{ minWidth: 780 }}>
        <thead>
          <tr>
            <th>Project</th>
            <th>Health</th>
            <th>Open</th>
            <th>Overdue</th>
            <th>Task completion</th>
            <th>Test pass rate</th>
            <th>Active cycles</th>
            <th>Resources</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr
              key={p.id}
              style={{ cursor: 'pointer' }}
              onClick={() => {
                const project = projectById.get(p.id);
                if (project) navigate(landingPath(project, globalRole));
              }}
            >
              <td className="primary">
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 3, background: p.color ?? 'var(--cyan)', flexShrink: 0 }} />
                  {p.name}
                </div>
              </td>
              <td><HealthPill health={p.health} /></td>
              <td>{p.open}</td>
              <td style={{ color: p.overdue > 8 ? 'var(--fail)' : p.overdue > 3 ? 'var(--amber)' : 'var(--text-mid)', fontWeight: 700 }}>{p.overdue}</td>
              <td>{barFill(p.completionRate)}</td>
              <td>{p.passRate === null ? <span style={{ color: 'var(--text-dim)' }}>—</span> : barFill(p.passRate)}</td>
              <td>{p.activeCycles}</td>
              <td>{p.resources}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResourcesTable({ rows }: { rows: PortfolioResourceRow[] }) {
  if (rows.length === 0) {
    return <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-dim)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>No assigned open tasks yet.</div>;
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="data-table" style={{ minWidth: 640 }}>
        <thead>
          <tr>
            <th>Resource</th>
            <th>Open</th>
            <th>Overdue</th>
            <th>Load</th>
            <th>Projects</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const load = LOAD_META[r.load];
            return (
              <tr key={r.userId}>
                <td className="primary">{r.name}</td>
                <td>{r.open}</td>
                <td style={{ color: r.overdue >= 8 ? 'var(--fail)' : r.overdue >= 4 ? 'var(--amber)' : 'var(--text-mid)', fontWeight: 700 }}>{r.overdue}</td>
                <td>
                  <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '3px 8px', borderRadius: 5, background: load.bg, color: load.color }}>
                    {load.label}
                  </span>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: 260 }}>
                    {r.projects.map((p) => (
                      <Link
                        key={p.slug}
                        to={`/projects/${p.slug}/tasks/dashboard`}
                        title={`Open ${p.name}'s Task Dashboard`}
                        style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 100, background: 'var(--surface2)', color: 'var(--text-mid)', border: '1px solid var(--border)', textDecoration: 'none' }}
                      >
                        {p.name}
                      </Link>
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function OverdueTable({ rows }: { rows: PortfolioOverdueTask[] }) {
  const navigate = useNavigate();
  if (rows.length === 0) {
    return <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>Nothing overdue across the portfolio 🎉</div>;
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="data-table" style={{ minWidth: 640 }}>
        <thead>
          <tr>
            <th>Task</th>
            <th>Assignee</th>
            <th>Priority</th>
            <th>Overdue</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr
              key={t.id}
              style={{ cursor: 'pointer' }}
              onClick={() => navigate(`/projects/${t.projectSlug}/tasks/${t.taskListId}?open=${t.id}`)}
            >
              <td className="primary" style={{ maxWidth: 320 }}>
                {t.title}
                <span style={{ display: 'block', fontSize: 10.5, color: 'var(--text-dim)', fontWeight: 500, marginTop: 1 }}>{t.projectName}</span>
              </td>
              <td style={t.assigneeName === 'Unassigned' ? { color: 'var(--amber)', fontWeight: 700 } : undefined}>{t.assigneeName}</td>
              <td><PriorityBadge priority={t.priority} /></td>
              <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, color: t.daysOverdue >= 10 ? 'var(--fail)' : t.daysOverdue >= 5 ? 'var(--amber)' : 'var(--text-mid)' }}>
                {t.daysOverdue}d
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MilestonesTable({ rows }: { rows: PortfolioMilestoneRow[] }) {
  const navigate = useNavigate();
  if (rows.length === 0) {
    return <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>No payment-linked milestones coming up across the portfolio.</div>;
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="data-table" style={{ minWidth: 640 }}>
        <thead>
          <tr>
            <th>Milestone</th>
            <th>Project</th>
            <th>Target date</th>
            <th>Status</th>
            <th>Slip</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => {
            const tone = deviationTone(m.slipDays);
            return (
              <tr key={m.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/projects/${m.projectSlug}/milestones`)}>
                <td className="primary" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</td>
                <td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 3, background: m.projectColor ?? 'var(--cyan)', flexShrink: 0 }} />
                    {m.projectName}
                  </span>
                </td>
                <td style={{ color: m.bucket === 'Overdue' ? 'var(--fail)' : 'var(--text-mid)', fontFamily: 'var(--font-mono)' }}>{formatMilestoneDate(m.targetDate)}</td>
                <td>
                  <span style={{
                    fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                    background: m.bucket === 'Overdue' ? 'var(--rose-dim)' : m.bucket === 'Due this month' ? 'var(--amber-dim)' : 'var(--surface2)',
                    color: m.bucket === 'Overdue' ? 'var(--fail)' : m.bucket === 'Due this month' ? 'var(--amber)' : 'var(--text-dim)',
                  }}>
                    {m.bucket}
                  </span>
                </td>
                <td style={{ fontWeight: 700, color: DEVIATION_COLOR[tone] }}>{m.slipDays !== null && m.slipDays > 0 ? `${m.slipDays}d` : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function Portfolio() {
  const navigate = useNavigate();
  const { currentUser } = useProjectStore();
  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const data = usePortfolioData(projects);

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const projectsRef = useRef<HTMLDivElement>(null);
  const resourcesRef = useRef<HTMLDivElement>(null);
  const overdueRef = useRef<HTMLDivElement>(null);
  const milestonesRef = useRef<HTMLDivElement>(null);
  const scrollTo = (ref: React.RefObject<HTMLDivElement>) => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // SUPER_ADMIN/ADMIN/SUPER_USER only — shouldn't reach here without it (the
  // sidebar link is hidden for everyone else), but belt-and-suspenders in
  // case someone navigates here directly. Mirrors UserManagement.tsx's guard.
  if (currentUser?.globalRole !== 'SUPER_ADMIN' && currentUser?.globalRole !== 'ADMIN' && currentUser?.globalRole !== 'SUPER_USER') {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, padding: 40 }}>
        <div style={{ fontSize: 48 }}>🔒</div>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Access Denied</h1>
        <p style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>Admin or Super User role required.</p>
      </div>
    );
  }

  const loading = projectsLoading || data.isLoading;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Topbar breadcrumbs={[{ label: 'Portfolio' }]} />

      <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'grid', gridTemplateColumns: '1fr', alignContent: 'start', gap: 20 }}>
        <div>
          <div className="page-eyebrow">All projects</div>
          <h1 className="page-title">360° Portfolio Overview</h1>
          <p className="page-sub">
            {data.projectCount} project{data.projectCount === 1 ? '' : 's'} · {data.resourceCount} active resource{data.resourceCount === 1 ? '' : 's'}
          </p>
        </div>

        {loading ? (
          <div style={{ color: 'var(--text-dim)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>Loading portfolio…</div>
        ) : data.projectCount === 0 ? (
          <div style={{ color: 'var(--text-dim)', fontSize: 13, textAlign: 'center', padding: '40px 0' }}>No projects to show yet.</div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
              <div onClick={() => navigate('/projects')} style={{ cursor: 'pointer' }}>
                <StatCard compact label="Projects" value={data.projectCount} theme="total" highlighted
                  sub={data.healthCounts.critical + data.healthCounts.atRisk > 0 ? `${data.healthCounts.critical + data.healthCounts.atRisk} need attention` : 'all healthy'} />
              </div>
              <div onClick={() => scrollTo(projectsRef)} style={{ cursor: 'pointer' }}>
                <StatCard compact label="Open tasks" value={data.totalOpen} theme="progress" highlighted />
              </div>
              <div onClick={() => scrollTo(overdueRef)} style={{ cursor: 'pointer' }}>
                <StatCard compact label="Overdue tasks" value={data.totalOverdue} theme="fail" highlighted
                  sub={data.totalOpen > 0 ? `${Math.round((data.totalOverdue / data.totalOpen) * 100)}% of open work` : undefined} />
              </div>
              <div onClick={() => scrollTo(projectsRef)} style={{ cursor: 'pointer' }}>
                <StatCard compact label="Task completion" value={`${data.completionRate}%`} theme="passRate" highlighted />
              </div>
              <div onClick={() => scrollTo(projectsRef)} style={{ cursor: 'pointer' }}>
                <StatCard compact label="Test pass rate" value={data.passRate === null ? '—' : `${data.passRate}%`} theme="pass" highlighted />
              </div>
              <div onClick={() => scrollTo(resourcesRef)} style={{ cursor: 'pointer' }}>
                <StatCard compact label="Active resources" value={data.resourceCount} theme="unlinked" highlighted />
              </div>
              <div onClick={() => scrollTo(milestonesRef)} style={{ cursor: 'pointer' }}>
                <StatCard compact label="Milestones overdue" value={data.milestonesOverdueCount} theme="fail" highlighted
                  sub={data.milestonesDueSoonCount > 0 ? `+${data.milestonesDueSoonCount} due this month` : 'payment-linked'} />
              </div>
            </div>

            <div className="card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
              <b style={{ fontSize: 12, fontWeight: 800, flexShrink: 0 }}>Portfolio health</b>
              <div style={{ flex: 1, height: 10, borderRadius: 6, background: 'var(--surface2)', display: 'flex', overflow: 'hidden', gap: 2 }}>
                {data.healthCounts.healthy > 0 && <div title={`${data.healthCounts.healthy} healthy`} style={{ width: `${(data.healthCounts.healthy / data.projectCount) * 100}%`, background: 'var(--pass)' }} />}
                {data.healthCounts.atRisk > 0 && <div title={`${data.healthCounts.atRisk} at risk`} style={{ width: `${(data.healthCounts.atRisk / data.projectCount) * 100}%`, background: 'var(--amber)' }} />}
                {data.healthCounts.critical > 0 && <div title={`${data.healthCounts.critical} critical`} style={{ width: `${(data.healthCounts.critical / data.projectCount) * 100}%`, background: 'var(--fail)' }} />}
              </div>
              <div style={{ display: 'flex', gap: 14, fontSize: 11.5, color: 'var(--text-mid)', flexShrink: 0 }}>
                <span>🟢 {data.healthCounts.healthy} healthy</span>
                <span>🟠 {data.healthCounts.atRisk} at risk</span>
                <span>🔴 {data.healthCounts.critical} critical</span>
              </div>
            </div>

            <div ref={projectsRef} className="section">
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Projects</div>
              <div className="card" style={{ padding: 0 }}>
                <ProjectsTable rows={data.projects} projectById={projectById} globalRole={currentUser?.globalRole} />
              </div>
            </div>

            <div ref={resourcesRef} className="section">
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Resource workload — all projects</div>
              <div className="card" style={{ padding: 0 }}>
                <ResourcesTable rows={data.resources} />
                {data.unassignedOpenCount > 0 && (
                  <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', background: 'var(--amber-dim)', fontSize: 12, color: 'var(--amber)', fontWeight: 600 }}>
                    ⚠ {data.unassignedOpenCount} open task{data.unassignedOpenCount === 1 ? '' : 's'} across the portfolio {data.unassignedOpenCount === 1 ? 'has' : 'have'} no assignee
                    {data.unassignedByProject.length > 0 && (
                      <> — biggest gaps: {data.unassignedByProject.map((u) => `${u.name} (${u.count})`).join(', ')}</>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div ref={overdueRef} className="section">
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Most overdue — portfolio-wide</div>
              <div className="card" style={{ padding: 0 }}>
                <OverdueTable rows={data.overdueTasks} />
              </div>
            </div>

            <div ref={milestonesRef} className="section">
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Payment milestones — coming up &amp; delayed, across every project</div>
              <div className="card" style={{ padding: 0 }}>
                <MilestonesTable rows={data.upcomingMilestones} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
