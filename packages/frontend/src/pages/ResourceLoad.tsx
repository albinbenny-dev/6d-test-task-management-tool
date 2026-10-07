import { useMemo, useState, type CSSProperties } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ChevronRight, ChevronDown, X, Search } from 'lucide-react';
import Topbar from '../components/layout/Topbar';
import { useProjectStore } from '../stores/projectStore';
import {
  useResourceLoad, useResourceLoadItems,
  type ResourceRow, type ResourceProjectRow, type TaskBlock, type TestBlock, type ResourceLoadItem,
} from '../hooks/useResourceLoad';

// Global resource-wise workload: one collapsed line per person (Tasks | Tests
// | Load), expandable into a per-project breakup. Every count is a button
// that opens the underlying records in a side drawer. Super Admin / Admin only
// — the API enforces the same rule, this guard just avoids a dead page.

type Mode = 'both' | 'tasks' | 'tests';
type Sort = 'load' | 'overdue' | 'name';
type Kind = 'task' | 'test';

interface Drill {
  title: string;
  kind: Kind;
  resource: string;
  projectId?: string;
  bucket: string;
}

const EMPTY_TASKS: TaskBlock = { TO_DO: 0, IN_PROGRESS: 0, IN_REVIEW: 0, DONE: 0, overdue: 0, open: 0, closed: 0 };
const EMPTY_TESTS: TestBlock = { NOT_RUN: 0, IN_PROGRESS: 0, PASS: 0, FAIL: 0, BLOCKED: 0, overdue: 0, open: 0, closed: 0 };

function sumTasks(rows: ResourceProjectRow[]): TaskBlock {
  const t = { ...EMPTY_TASKS };
  for (const r of rows) for (const k of Object.keys(t) as (keyof TaskBlock)[]) t[k] += r.tasks[k];
  return t;
}
function sumTests(rows: ResourceProjectRow[]): TestBlock {
  const t = { ...EMPTY_TESTS };
  for (const r of rows) for (const k of Object.keys(t) as (keyof TestBlock)[]) t[k] += r.tests[k];
  return t;
}

const TASK_STATUS_LABEL: Record<string, string> = {
  TO_DO: 'To Do', IN_PROGRESS: 'In Progress', IN_REVIEW: 'In Review', DONE: 'Done',
  NOT_RUN: 'Not Run', PASS: 'Pass', FAIL: 'Fail', BLOCKED: 'Blocked',
};

// ── Small building blocks ───────────────────────────────────────────────────

function Num({ value, color, onClick, title }: { value: number; color?: string; onClick: () => void; title: string }) {
  const zero = value === 0;
  return (
    <button
      type="button"
      title={zero ? undefined : title}
      disabled={zero}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        background: 'none', border: 'none', padding: '0 2px', font: 'inherit',
        fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 13,
        color: zero ? 'var(--text-dim)' : (color ?? 'var(--text)'),
        cursor: zero ? 'default' : 'pointer',
        textDecoration: zero ? 'none' : 'underline dotted',
        textUnderlineOffset: 3,
      }}
    >
      {value}
    </button>
  );
}

function Stack({ segments }: { segments: { value: number; color: string }[] }) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  return (
    <div style={{ display: 'flex', height: 6, borderRadius: 4, overflow: 'hidden', background: 'var(--surface2)', width: '100%' }}>
      {total > 0 && segments.map((s, i) => s.value > 0 && (
        <div key={i} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
      ))}
    </div>
  );
}

function Avatar({ name, kind }: { name: string; kind: ResourceRow['kind'] }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
  return (
    <span style={{
      width: 30, height: 30, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center',
      fontSize: 11, fontWeight: 700, color: '#fff',
      background: kind === 'user' ? 'linear-gradient(135deg,#1e3a8a,#2563eb)' : 'var(--text-dim)',
    }}>{kind === 'user' ? initials : '–'}</span>
  );
}

// ── Collapsed summary segments ──────────────────────────────────────────────

function TaskSummary({ r, onDrill }: { r: ResourceRow; onDrill: (d: Drill) => void }) {
  const d = (bucket: string, label: string): Drill => ({ title: `${r.name} · ${label} tasks`, kind: 'task', resource: r.key, bucket });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <span><Num value={r.tasks.open} onClick={() => onDrill(d('open', 'Open'))} title="View open tasks" /> open</span>
        <span><Num value={r.tasks.closed} color="var(--pass)" onClick={() => onDrill(d('closed', 'Done'))} title="View done tasks" /> done</span>
        <span><Num value={r.tasks.overdue} color="var(--fail)" onClick={() => onDrill(d('overdue', 'Overdue'))} title="View overdue tasks" /> overdue</span>
      </div>
      <Stack segments={[
        { value: r.tasks.overdue, color: 'var(--fail)' },
        { value: Math.max(r.tasks.open - r.tasks.overdue, 0), color: 'var(--run)' },
        { value: r.tasks.closed, color: 'var(--pass)' },
      ]} />
    </div>
  );
}

function TestSummary({ r, onDrill }: { r: ResourceRow; onDrill: (d: Drill) => void }) {
  const d = (bucket: string, label: string): Drill => ({ title: `${r.name} · ${label} tests`, kind: 'test', resource: r.key, bucket });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <span><Num value={r.tests.open} onClick={() => onDrill(d('open', 'Open'))} title="View open tests" /> open</span>
        <span><Num value={r.tests.closed} color="var(--pass)" onClick={() => onDrill(d('closed', 'Executed'))} title="View executed tests" /> closed</span>
        <span><Num value={r.tests.FAIL} color="var(--fail)" onClick={() => onDrill(d('FAIL', 'Failed'))} title="View failed tests" /> fail</span>
        <span><Num value={r.tests.overdue} color="var(--amber)" onClick={() => onDrill(d('overdue', 'Overdue'))} title="View overdue tests" /> overdue</span>
      </div>
      <Stack segments={[
        { value: r.tests.FAIL, color: 'var(--fail)' },
        { value: r.tests.BLOCKED, color: 'var(--amber)' },
        { value: r.tests.PASS, color: 'var(--pass)' },
        { value: r.tests.IN_PROGRESS, color: 'var(--run)' },
        { value: r.tests.NOT_RUN, color: 'var(--text-dim)' },
      ]} />
    </div>
  );
}

// ── Expanded breakup ────────────────────────────────────────────────────────

function ProjectName({ p }: { p: ResourceProjectRow }) {
  return <span style={{ fontWeight: 600 }}>{p.name}</span>;
}

function TaskBreakup({ r, rows, onDrill }: { r: ResourceRow; rows: ResourceProjectRow[]; onDrill: (d: Drill) => void }) {
  const rowsWithTasks = rows.filter((p) => p.tasks.open + p.tasks.closed > 0);
  const cell = (p: ResourceProjectRow, bucket: string, value: number, color?: string) => (
    <Num value={value} color={color} title={`View in ${p.name}`}
      onClick={() => onDrill({ title: `${r.name} · ${p.name} · ${TASK_STATUS_LABEL[bucket] ?? bucket} tasks`, kind: 'task', resource: r.key, projectId: p.projectId, bucket })} />
  );
  return (
    <div style={{ minWidth: 0, overflowX: 'auto' }}>
      <div className="page-eyebrow" style={{ marginBottom: 6 }}>Tasks by project</div>
      {rowsWithTasks.length === 0 ? <Empty text="No tasks" /> : (
        <table className="data-table" style={{ width: '100%' }}>
          <thead><tr><th>Project</th><th>To Do</th><th>In Prog.</th><th>Review</th><th>Done</th><th>Overdue</th></tr></thead>
          <tbody>
            {rowsWithTasks.map((p) => (
              <tr key={p.projectId}>
                <td className="primary"><ProjectName p={p} /></td>
                <td>{cell(p, 'TO_DO', p.tasks.TO_DO)}</td>
                <td>{cell(p, 'IN_PROGRESS', p.tasks.IN_PROGRESS, 'var(--run)')}</td>
                <td>{cell(p, 'IN_REVIEW', p.tasks.IN_REVIEW, '#8b5cf6')}</td>
                <td>{cell(p, 'DONE', p.tasks.DONE, 'var(--pass)')}</td>
                <td>{cell(p, 'overdue', p.tasks.overdue, 'var(--fail)')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function TestBreakup({ r, rows, onDrill }: { r: ResourceRow; rows: ResourceProjectRow[]; onDrill: (d: Drill) => void }) {
  const rowsWithTests = rows.filter((p) => p.tests.open + p.tests.closed > 0);
  const cell = (p: ResourceProjectRow, bucket: string, value: number, color?: string) => (
    <Num value={value} color={color} title={`View in ${p.name}`}
      onClick={() => onDrill({ title: `${r.name} · ${p.name} · ${TASK_STATUS_LABEL[bucket] ?? bucket} tests`, kind: 'test', resource: r.key, projectId: p.projectId, bucket })} />
  );
  return (
    <div style={{ minWidth: 0, overflowX: 'auto' }}>
      <div className="page-eyebrow" style={{ marginBottom: 6 }}>Tests by project <span style={{ textTransform: 'none', letterSpacing: 0 }}>(active cycles)</span></div>
      {rowsWithTests.length === 0 ? <Empty text="No tests in active cycles" /> : (
        <table className="data-table" style={{ width: '100%' }}>
          <thead><tr><th>Project</th><th>Not Run</th><th>In Prog.</th><th>Pass</th><th>Fail</th><th>Blocked</th><th>Overdue</th></tr></thead>
          <tbody>
            {rowsWithTests.map((p) => (
              <tr key={p.projectId}>
                <td className="primary"><ProjectName p={p} /></td>
                <td>{cell(p, 'NOT_RUN', p.tests.NOT_RUN)}</td>
                <td>{cell(p, 'IN_PROGRESS', p.tests.IN_PROGRESS, 'var(--run)')}</td>
                <td>{cell(p, 'PASS', p.tests.PASS, 'var(--pass)')}</td>
                <td>{cell(p, 'FAIL', p.tests.FAIL, 'var(--fail)')}</td>
                <td>{cell(p, 'BLOCKED', p.tests.BLOCKED, 'var(--amber)')}</td>
                <td>{cell(p, 'overdue', p.tests.overdue, 'var(--amber)')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: '10px 0', fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{text}</div>;
}

// ── Drill-down drawer ───────────────────────────────────────────────────────

function itemLink(kind: Kind, it: ResourceLoadItem): string {
  return kind === 'task'
    ? `/projects/${it.project.slug}/tasks/${it.taskListId}?open=${it.id}`
    : `/projects/${it.project.slug}/test-cycles/${it.cycleId}`;
}

function DrillDrawer({ drill, onClose }: { drill: Drill; onClose: () => void }) {
  const { data, isLoading, isError } = useResourceLoadItems(drill);
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 60 }} />
      <aside style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(560px, 100vw)', zIndex: 61,
        background: 'var(--surface)', borderLeft: '1px solid var(--border)', boxShadow: 'var(--shadow-card)',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="page-eyebrow">{drill.kind === 'task' ? 'Tasks' : 'Tests'}</div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{drill.title}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)' }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {isLoading && <Empty text="Loading…" />}
          {isError && <Empty text="Could not load items." />}
          {data && data.items.length === 0 && <div style={{ padding: 16 }}><Empty text="Nothing here." /></div>}
          {data?.items.map((it) => (
            <Link key={it.id} to={itemLink(drill.kind, it)} onClick={onClose}
              style={{ display: 'block', padding: '10px 16px', borderBottom: '1px solid var(--border)', textDecoration: 'none', color: 'inherit' }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                {it.srNo != null && <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', marginRight: 6 }}>#{it.srNo}</span>}
                {it.title}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 3, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <span>{it.project.name}</span>
                <span>{it.listName ?? it.cycleName}</span>
                <span style={{ fontWeight: 700 }}>{TASK_STATUS_LABEL[it.status] ?? it.status}</span>
                {it.priority && <span>{it.priority}</span>}
                {it.dueDate && (
                  <span style={{ color: it.overdue ? 'var(--fail)' : undefined }}>
                    Due {new Date(it.dueDate).toLocaleDateString()}{it.overdue ? ' · overdue' : ''}
                  </span>
                )}
              </div>
            </Link>
          ))}
          {data?.truncated && <div style={{ padding: 12 }}><Empty text="Showing the first 500 items." /></div>}
        </div>
      </aside>
    </>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────


export default function ResourceLoad() {
  const currentUser = useProjectStore((s) => s.currentUser);
  const allowed = currentUser?.globalRole === 'SUPER_ADMIN' || currentUser?.globalRole === 'ADMIN';
  const { data, isLoading, isError } = useResourceLoad(allowed);

  const [mode, setMode] = useState<Mode>('both');
  const [sort, setSort] = useState<Sort>('load');
  const [query, setQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [drill, setDrill] = useState<Drill | null>(null);

  // Re-derive each resource's totals from just the selected project's rows.
  const rows = useMemo(() => {
    if (!data) return [] as (ResourceRow & { load: number; visibleProjects: ResourceProjectRow[] })[];
    const q = query.trim().toLowerCase();
    return data.data
      .map((r) => {
        const visibleProjects = projectFilter ? r.projects.filter((p) => p.projectId === projectFilter) : r.projects;
        const tasks = projectFilter ? sumTasks(visibleProjects) : r.tasks;
        const tests = projectFilter ? sumTests(visibleProjects) : r.tests;
        const load = (mode === 'tests' ? 0 : tasks.open) + (mode === 'tasks' ? 0 : tests.open);
        return { ...r, tasks, tests, load, visibleProjects };
      })
      .filter((r) => (r.tasks.open + r.tasks.closed + r.tests.open + r.tests.closed) > 0)
      .filter((r) => !q || r.name.toLowerCase().includes(q) || (r.email ?? '').toLowerCase().includes(q))
      .sort((a, b) => {
        // Unassigned pinned first — it's work nobody owns yet.
        if (a.kind === 'unassigned') return -1;
        if (b.kind === 'unassigned') return 1;
        if (sort === 'name') return a.name.localeCompare(b.name);
        if (sort === 'overdue') {
          const od = (x: typeof a) => (mode === 'tests' ? 0 : x.tasks.overdue) + (mode === 'tasks' ? 0 : x.tests.overdue);
          return od(b) - od(a) || b.load - a.load;
        }
        return b.load - a.load;
      });
  }, [data, projectFilter, query, mode, sort]);

  const maxLoad = Math.max(1, ...rows.filter((r) => r.kind !== 'unassigned').map((r) => r.load));
  const people = rows.filter((r) => r.kind === 'user');
  const totals = {
    resources: people.length,
    openTasks: rows.reduce((a, r) => a + r.tasks.open, 0),
    openTests: rows.reduce((a, r) => a + r.tests.open, 0),
    overdue: rows.reduce((a, r) => a + r.tasks.overdue + r.tests.overdue, 0),
    unassigned: (rows.find((r) => r.kind === 'unassigned')?.tasks.open ?? 0) + (rows.find((r) => r.kind === 'unassigned')?.tests.open ?? 0),
  };

  if (currentUser && !allowed) return <Navigate to="/projects" replace />;

  const toggle = (key: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const showTasks = mode !== 'tests';
  const showTests = mode !== 'tasks';
  const grid = `minmax(180px,1.1fr) ${showTasks ? 'minmax(0,1.5fr) ' : ''}${showTests ? 'minmax(0,1.7fr) ' : ''}130px`;

  const kpi = (label: string, value: number, color?: string) => (
    <div style={{ flex: 1, minWidth: 130, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', boxShadow: 'var(--shadow-card)' }}>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'var(--font-mono)', color: color ?? 'var(--text)' }}>{value}</div>
    </div>
  );

  const pill = (active: boolean): CSSProperties => ({
    padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none',
    background: active ? 'var(--cyan)' : 'transparent', color: active ? '#fff' : 'var(--text-dim)',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Topbar breadcrumbs={[{ label: 'Resource Overview' }]} />
      <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div>
          <div className="page-eyebrow">All projects</div>
          <h1 className="page-title">Resource Overview</h1>
          <p className="page-sub">Open vs closed work per person, split into Tasks and Tests. Tests count active cycles only. Click any number to see the items.</p>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {kpi('Resources', totals.resources)}
          {kpi('Open tasks', totals.openTasks, 'var(--run)')}
          {kpi('Open tests', totals.openTests, 'var(--cyan)')}
          {kpi('Overdue', totals.overdue, totals.overdue ? 'var(--fail)' : undefined)}
          {kpi('Unassigned open', totals.unassigned, totals.unassigned ? 'var(--amber)' : undefined)}
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            {(['both', 'tasks', 'tests'] as Mode[]).map((m) => (
              <button key={m} type="button" style={pill(mode === m)} onClick={() => setMode(m)}>
                {m === 'both' ? 'Tasks + Tests' : m === 'tasks' ? 'Tasks' : 'Tests'}
              </button>
            ))}
          </div>
          <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12 }}>
            <option value="">All projects</option>
            {data?.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}
            style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12 }}>
            <option value="load">Sort: highest load</option>
            <option value="overdue">Sort: most overdue</option>
            <option value="name">Sort: name</option>
          </select>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)' }}>
            <Search size={13} color="var(--text-dim)" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search resource"
              style={{ border: 'none', outline: 'none', background: 'transparent', color: 'var(--text)', fontSize: 12, width: 150 }} />
          </div>
          <button type="button" onClick={() => setExpanded(expanded.size ? new Set() : new Set(rows.map((r) => r.key)))}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--cyan)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            {expanded.size ? 'Collapse all' : 'Expand all'}
          </button>
        </div>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: 'var(--shadow-card)', overflowX: 'auto' }}>
          <div style={{ minWidth: 760 }}>
            <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 16, padding: '8px 14px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
              <span>Resource</span>
              {showTasks && <span>Tasks</span>}
              {showTests && <span>Tests</span>}
              <span>Load (open)</span>
            </div>

            {isLoading && <Empty text="Loading…" />}
            {isError && <div style={{ padding: 16 }}><Empty text="Could not load resource data." /></div>}
            {data && rows.length === 0 && <div style={{ padding: 16 }}><Empty text="No assignments found." /></div>}

            {rows.map((r) => {
              const open = expanded.has(r.key);
              return (
                <div key={r.key} style={{ borderBottom: '1px solid var(--border)' }}>
                  <div role="button" tabIndex={0} onClick={() => toggle(r.key)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(r.key); } }}
                    style={{ display: 'grid', gridTemplateColumns: grid, gap: 16, padding: '12px 14px', alignItems: 'center', cursor: 'pointer', background: open ? 'var(--surface2)' : undefined }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                      {open ? <ChevronDown size={15} color="var(--text-dim)" /> : <ChevronRight size={15} color="var(--text-dim)" />}
                      <Avatar name={r.name} kind={r.kind} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{r.visibleProjects.length} project{r.visibleProjects.length === 1 ? '' : 's'}</div>
                      </div>
                    </div>
                    {showTasks && <TaskSummary r={r} onDrill={setDrill} />}
                    {showTests && <TestSummary r={r} onDrill={setDrill} />}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--surface2)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${(r.load / maxLoad) * 100}%`, background: r.load / maxLoad > 0.8 ? 'var(--fail)' : r.load / maxLoad > 0.5 ? 'var(--amber)' : 'var(--cyan)' }} />
                      </div>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 13, width: 34, textAlign: 'right' }}>{r.load}</span>
                    </div>
                  </div>

                  {open && (
                    <div style={{ display: 'grid', gridTemplateColumns: showTasks && showTests ? 'repeat(auto-fit, minmax(340px, 1fr))' : '1fr', gap: 24, padding: '4px 14px 16px 54px', background: 'var(--surface2)' }}>
                      {showTasks && <TaskBreakup r={r} rows={r.visibleProjects} onDrill={setDrill} />}
                      {showTests && <TestBreakup r={r} rows={r.visibleProjects} onDrill={setDrill} />}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {drill && <DrillDrawer drill={drill} onClose={() => setDrill(null)} />}
    </div>
  );
}
