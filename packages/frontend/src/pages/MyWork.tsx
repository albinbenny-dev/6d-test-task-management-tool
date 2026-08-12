import { useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import Topbar from '../components/layout/Topbar';
import { useProject } from '../hooks/useProjects';
import { useMyAssignments } from '../hooks/useTestCycles';
import { useMyTasks, useUpdateTaskStatus } from '../hooks/useTasks';
import { parseTcItemLabels } from '../hooks/useTcItems';
import { STATUS_COLOR, STATUS_LABEL as TC_STATUS_LABEL, ALL_MANUAL_STATUSES } from '../lib/manualStatus';
import { isTaskOverdue, parseTags, STATUS_LABEL as TASK_STATUS_LABEL, STATUS_DOT_COLOR, ALL_TASK_STATUSES, ALL_PRIORITIES, PRIORITY_LABEL, taskDotColor } from '../lib/taskMeta';
import { PriorityBadge } from '../components/tasks/PriorityBadge';
import { TaskStatusPicker } from '../components/tasks/TaskStatusPicker';
import { useClickOutside } from '../hooks/useClickOutside';
import { FloatingPortal } from '../components/ui/FloatingPortal';
import type { AssignmentItem, Task, TaskPriority, TaskStatus, ManualResultStatus } from '../types';

type Tab = 'tests' | 'tasks';
type DueFilter = 'overdue' | 'today' | 'week' | 'none';

const DUE_FILTER_LABEL: Record<DueFilter, string> = {
  overdue: '⏰ Overdue',
  today: '📍 Due today',
  week: '🗓 Due this week',
  none: '— No due date',
};

// ── Due-date color coding — shared by both tabs. Three tiers: overdue (red),
// due within 3 days (amber), everything else (dim). "done"-equivalent items
// never read as overdue regardless of date, since the deadline no longer applies. ──
function dueDateColor(dueDate: string | null | undefined, isDone: boolean): string {
  if (!dueDate || isDone) return 'var(--text-dim)';
  const due = new Date(dueDate).getTime();
  const now = Date.now();
  if (due < now) return 'var(--fail)';
  if (due - now < 3 * 86_400_000) return 'var(--amber)';
  return 'var(--text-dim)';
}

function formatShortDate(dueDate: string): string {
  const d = new Date(dueDate);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' });
}

// ── Generic multiselect chip dropdown — shared by every filter on this page
// (each just supplies its own option list) ──────────────────────────────────
function MultiSelectDropdown({ icon, allOptions, optionLabel, selected, onChange, emptyLabel }: {
  icon: string;
  allOptions: string[];
  optionLabel?: (v: string) => string;
  selected: string[];
  onChange: (v: string[]) => void;
  emptyLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside([ref, menuRef], () => setOpen(false), open);

  function toggle(v: string) {
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  }

  const label = selected.length === 0 ? `${icon} ${emptyLabel}` : `${icon} ${selected.length} selected`;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="input-field"
        style={{ fontSize: '11px', padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap', background: selected.length ? 'var(--cyan-dim)' : undefined, borderColor: selected.length ? 'rgba(2,132,199,0.35)' : undefined, color: selected.length ? 'var(--cyan)' : 'var(--text)' }}
      >
        {label} ▾
      </button>
      <FloatingPortal anchorRef={ref} open={open} portalRef={menuRef} width={210}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.4)', overflow: 'hidden' }}>
          <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
            {allOptions.map((v) => {
              const checked = selected.includes(v);
              return (
                <div
                  key={v}
                  onClick={() => toggle(v)}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', fontSize: '11px', color: 'var(--text)', cursor: 'pointer' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--surface2)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                >
                  <div className={`tc-checkbox${checked ? ' checked' : ''}`} style={{ fontSize: '9px', flexShrink: 0 }}>{checked ? '✓' : ''}</div>
                  <span style={{ flex: 1 }}>{optionLabel ? optionLabel(v) : v}</span>
                </div>
              );
            })}
            {allOptions.length === 0 && (
              <div style={{ padding: '10px 12px', fontSize: '11px', color: 'var(--text-dim)' }}>None yet</div>
            )}
          </div>
          {selected.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', padding: '6px 8px' }}>
              <button onClick={() => onChange([])} style={{ width: '100%', padding: '5px 0', fontSize: '10px', color: 'var(--text-dim)', background: 'none', border: 'none', cursor: 'pointer' }}>Clear all</button>
            </div>
          )}
        </div>
      </FloatingPortal>
    </div>
  );
}

function isDueInRange(dueDate: string | null | undefined, filter: DueFilter): boolean {
  if (filter === 'none') return !dueDate;
  if (!dueDate) return false;
  const due = new Date(dueDate);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(startOfToday.getTime() + 86_400_000);
  if (filter === 'overdue') return due.getTime() < startOfToday.getTime();
  if (filter === 'today') return due.getTime() >= startOfToday.getTime() && due.getTime() < endOfToday.getTime();
  if (filter === 'week') {
    const endOfWeek = new Date(startOfToday.getTime() + 7 * 86_400_000);
    return due.getTime() >= startOfToday.getTime() && due.getTime() < endOfWeek.getTime();
  }
  return true;
}

// ── Collapsible group header — shared shape for both tabs' status groups ───
function GroupHeader({ title, count, accent, collapsed, onToggle }: {
  title: string;
  count: number;
  accent: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      onClick={onToggle}
      style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer', userSelect: 'none' }}
    >
      <span style={{ fontSize: 10, color: 'var(--text-dim)', transition: 'transform 0.15s', display: 'inline-block', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</span>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: accent }} />
      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{title}</span>
      <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{count}</span>
    </div>
  );
}

// ── Test Cases tab ───────────────────────────────────────────────────────
function TestCasesTab({ projectId, slug }: { projectId: string; slug: string }) {
  const { data, isLoading } = useMyAssignments(projectId);
  const navigate = useNavigate();
  const [labelFilter, setLabelFilter] = useState<string[]>([]);
  const [cycleFilter, setCycleFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<ManualResultStatus[]>([]);
  const [collapsed, setCollapsed] = useState<Set<ManualResultStatus>>(new Set());
  const items = data?.items ?? [];

  const allLabels = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) { for (const l of parseTcItemLabels(item.testCase?.labels ?? '[]')) set.add(l); }
    return Array.from(set).sort();
  }, [items]);

  const cycleNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) map.set(item.testCycleId, item.testCycle.name);
    return map;
  }, [items]);
  const allCycleIds = useMemo(() => [...cycleNameById.keys()].sort((a, b) => (cycleNameById.get(a) ?? '').localeCompare(cycleNameById.get(b) ?? '')), [cycleNameById]);

  const filtered = useMemo(() => {
    return items.filter((i) => {
      if (labelFilter.length) {
        const itemLabels = parseTcItemLabels(i.testCase?.labels ?? '[]');
        if (!labelFilter.some((l) => itemLabels.includes(l))) return false;
      }
      if (cycleFilter.length && !cycleFilter.includes(i.testCycleId)) return false;
      if (statusFilter.length && !statusFilter.includes(i.manualStatus)) return false;
      return true;
    });
  }, [items, labelFilter, cycleFilter, statusFilter]);

  const ORDER: ManualResultStatus[] = ['FAIL', 'BLOCKED', 'IN_PROGRESS', 'NOT_RUN', 'PASS'];
  const groups = ORDER.map((status) => ({ status, items: filtered.filter((i) => i.manualStatus === status) })).filter((g) => g.items.length > 0);

  function toggleGroup(status: ManualResultStatus) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status); else next.add(status);
      return next;
    });
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
        <MultiSelectDropdown
          icon="🔁"
          allOptions={ALL_MANUAL_STATUSES}
          optionLabel={(v) => TC_STATUS_LABEL[v as ManualResultStatus]}
          selected={statusFilter}
          onChange={(v) => setStatusFilter(v as ManualResultStatus[])}
          emptyLabel="All statuses"
        />
        {allCycleIds.length > 1 && (
          <MultiSelectDropdown
            icon="🧪"
            allOptions={allCycleIds}
            optionLabel={(id) => cycleNameById.get(id) ?? id}
            selected={cycleFilter}
            onChange={setCycleFilter}
            emptyLabel="All cycles"
          />
        )}
        {allLabels.length > 0 && (
          <MultiSelectDropdown icon="🏷" allOptions={allLabels} selected={labelFilter} onChange={setLabelFilter} emptyLabel="All labels" />
        )}
        <Link to={`/projects/${slug}/test-cycles/assignments`} style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--cyan)', textDecoration: 'none' }}>
          Open history &amp; run trends →
        </Link>
      </div>

      {isLoading ? (
        <div style={{ color: 'var(--text-dim)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
          {items.length === 0 ? 'No test cases assigned to you yet.' : 'No test cases match the current filter.'}
        </div>
      ) : (
        groups.map(({ status, items: groupItems }) => {
          const isCollapsed = collapsed.has(status);
          return (
            <div key={status} style={{ marginBottom: 18 }}>
              <GroupHeader title={TC_STATUS_LABEL[status]} count={groupItems.length} accent={STATUS_COLOR[status]} collapsed={isCollapsed} onToggle={() => toggleGroup(status)} />
              {!isCollapsed && (
                <div className="card" style={{ overflow: 'hidden' }}>
                  {groupItems.map((item: AssignmentItem) => {
                    const labels = parseTcItemLabels(item.testCase?.labels ?? '[]');
                    const dueDate = item.testCycle.dueDate;
                    return (
                      <div
                        key={item.id}
                        className="tm-row"
                        style={{ gridTemplateColumns: '1fr 130px 85px 110px', paddingLeft: 14, cursor: 'pointer' }}
                        onClick={() => navigate(`/projects/${slug}/test-cycles/${item.testCycleId}`)}
                      >
                        <div className="tm-row-title">
                          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', fontSize: 11, flexShrink: 0 }}>{item.testCase?.srNo ?? '—'}</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.testCase?.title}>{item.testCase?.title}</span>
                        </div>
                        <div style={{ fontSize: 10.5, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.testCycle.name}>
                          {item.testCycle.name}
                        </div>
                        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: dueDateColor(dueDate, status === 'PASS') }}>
                          {dueDate ? formatShortDate(dueDate) : '—'}
                        </div>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          {labels.slice(0, 2).map((l) => (
                            <span key={l} className="badge badge-draft" style={{ fontSize: 9 }}>{l}</span>
                          ))}
                          {labels.length > 2 && <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>+{labels.length - 2}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

// ── Tasks tab ────────────────────────────────────────────────────────────
function TasksTab({ projectId, slug }: { projectId: string; slug: string }) {
  const { data, isLoading } = useMyTasks(projectId);
  const updateStatus = useUpdateTaskStatus(projectId);
  const navigate = useNavigate();
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority[]>([]);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<TaskStatus[]>([]);
  const [dueFilter, setDueFilter] = useState<DueFilter[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const tasks = data?.tasks ?? [];

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) { for (const tag of parseTags(t.tags)) set.add(tag); }
    return Array.from(set).sort();
  }, [tasks]);

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (priorityFilter.length && !priorityFilter.includes(t.priority)) return false;
      if (statusFilter.length && !statusFilter.includes(t.status)) return false;
      if (tagFilter.length) {
        const tags = parseTags(t.tags);
        if (!tagFilter.some((tag) => tags.includes(tag))) return false;
      }
      if (dueFilter.length > 0 && !dueFilter.some((f) => isDueInRange(t.dueDate, f))) return false;
      return true;
    });
  }, [tasks, priorityFilter, statusFilter, tagFilter, dueFilter]);

  const overdue = filtered.filter((t) => isTaskOverdue(t));
  const inProgress = filtered.filter((t) => !isTaskOverdue(t) && t.status === 'IN_PROGRESS');
  const inReview = filtered.filter((t) => !isTaskOverdue(t) && t.status === 'IN_REVIEW');
  const todo = filtered.filter((t) => !isTaskOverdue(t) && t.status === 'TO_DO');
  const done = filtered.filter((t) => t.status === 'DONE');

  function openTask(task: Task) {
    navigate(`/projects/${slug}/tasks/${task.taskListId}?open=${task.id}`);
  }

  function toggleGroup(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const dueOptions: DueFilter[] = ['overdue', 'today', 'week', 'none'];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
        <MultiSelectDropdown
          icon="🔁"
          allOptions={ALL_TASK_STATUSES}
          optionLabel={(v) => TASK_STATUS_LABEL[v as TaskStatus]}
          selected={statusFilter}
          onChange={(v) => setStatusFilter(v as TaskStatus[])}
          emptyLabel="All statuses"
        />
        <MultiSelectDropdown
          icon="🚩"
          allOptions={ALL_PRIORITIES}
          optionLabel={(v) => PRIORITY_LABEL[v as TaskPriority]}
          selected={priorityFilter}
          onChange={(v) => setPriorityFilter(v as TaskPriority[])}
          emptyLabel="All priorities"
        />
        {allTags.length > 0 && (
          <MultiSelectDropdown icon="🏷" allOptions={allTags} selected={tagFilter} onChange={setTagFilter} emptyLabel="All labels" />
        )}
        <MultiSelectDropdown
          icon="📅"
          allOptions={dueOptions}
          optionLabel={(v) => DUE_FILTER_LABEL[v as DueFilter]}
          selected={dueFilter}
          onChange={(v) => setDueFilter(v as DueFilter[])}
          emptyLabel="Any due date"
        />
      </div>

      {isLoading ? (
        <div style={{ color: 'var(--text-dim)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
          {tasks.length === 0 ? 'Nothing assigned to you yet.' : 'No tasks match the current filter.'}
        </div>
      ) : (
        <>
          <TaskGroup groupKey="overdue" title="Overdue" tasks={overdue} onOpen={openTask} onStatusChange={(id, status) => updateStatus.mutate({ id, status })} accent="var(--fail)" collapsed={collapsed.has('overdue')} onToggle={() => toggleGroup('overdue')} />
          <TaskGroup groupKey="IN_PROGRESS" title={TASK_STATUS_LABEL.IN_PROGRESS} tasks={inProgress} onOpen={openTask} onStatusChange={(id, status) => updateStatus.mutate({ id, status })} accent={STATUS_DOT_COLOR.IN_PROGRESS} collapsed={collapsed.has('IN_PROGRESS')} onToggle={() => toggleGroup('IN_PROGRESS')} />
          <TaskGroup groupKey="IN_REVIEW" title={TASK_STATUS_LABEL.IN_REVIEW} tasks={inReview} onOpen={openTask} onStatusChange={(id, status) => updateStatus.mutate({ id, status })} accent={STATUS_DOT_COLOR.IN_REVIEW} collapsed={collapsed.has('IN_REVIEW')} onToggle={() => toggleGroup('IN_REVIEW')} />
          <TaskGroup groupKey="TO_DO" title={TASK_STATUS_LABEL.TO_DO} tasks={todo} onOpen={openTask} onStatusChange={(id, status) => updateStatus.mutate({ id, status })} accent={STATUS_DOT_COLOR.TO_DO} collapsed={collapsed.has('TO_DO')} onToggle={() => toggleGroup('TO_DO')} />
          <TaskGroup groupKey="DONE" title={TASK_STATUS_LABEL.DONE} tasks={done} onOpen={openTask} onStatusChange={(id, status) => updateStatus.mutate({ id, status })} accent={STATUS_DOT_COLOR.DONE} collapsed={collapsed.has('DONE')} onToggle={() => toggleGroup('DONE')} />
        </>
      )}
    </div>
  );
}

function TaskGroup({ title, tasks, onOpen, onStatusChange, accent, collapsed, onToggle }: {
  groupKey: string;
  title: string;
  tasks: Task[];
  onOpen: (task: Task) => void;
  onStatusChange: (id: string, status: Task['status']) => void;
  accent: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  if (tasks.length === 0) return null;

  return (
    <div style={{ marginBottom: 18 }}>
      <GroupHeader title={title} count={tasks.length} accent={accent} collapsed={collapsed} onToggle={onToggle} />
      {!collapsed && (
        <div className="card" style={{ overflow: 'hidden' }}>
          {tasks.map((task) => {
            const tags = parseTags(task.tags);
            return (
              <div
                key={task.id}
                className="tm-row"
                style={{ gridTemplateColumns: '1fr 140px 130px 100px 150px', paddingLeft: 14, cursor: 'pointer' }}
                onClick={() => onOpen(task)}
              >
                <div className="tm-row-title">
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: taskDotColor(task), flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={task.title}>{task.title}</span>
                  {task.taskList && (
                    <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                      {task.taskList.name}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {tags.slice(0, 2).map((t) => <span key={t} className="badge badge-draft" style={{ fontSize: 9 }}>{t}</span>)}
                  {tags.length > 2 && <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>+{tags.length - 2}</span>}
                </div>
                <div><PriorityBadge priority={task.priority} /></div>
                <div style={{ fontSize: 11.5, color: dueDateColor(task.dueDate, task.status === 'DONE'), fontFamily: 'var(--font-mono)' }}>
                  {task.dueDate ? formatShortDate(task.dueDate) : '—'}
                </div>
                <div onClick={(e) => e.stopPropagation()}>
                  <TaskStatusPicker task={task} onChange={(status) => onStatusChange(task.id, status)} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────
export default function MyWork() {
  const { slug } = useParams<{ slug: string }>();
  const { data: project } = useProject(slug);
  const projectId = project?.id ?? '';
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get('tab') === 'tasks' ? 'tasks' : 'tests') as Tab;

  function setTab(t: Tab) {
    setSearchParams(t === 'tests' ? {} : { tab: t });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Topbar
        breadcrumbs={[
          { label: project?.name ?? slug ?? 'Project', href: `/projects/${slug}/test-cycles` },
          { label: 'My Work' },
        ]}
        actions={
          <div className="tm-view-tabs">
            <button className={`tm-view-tab${tab === 'tests' ? ' active' : ''}`} onClick={() => setTab('tests')}>🧪 Test Cases</button>
            <button className={`tm-view-tab${tab === 'tasks' ? ' active' : ''}`} onClick={() => setTab('tasks')}>✅ Tasks</button>
          </div>
        }
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
        <div className="page-eyebrow">Manual test &amp; task management</div>
        <h1 className="page-title">My Work</h1>
        <p className="page-sub">Everything assigned to you — test cases and tasks — in one place.</p>

        <div style={{ marginTop: 20 }}>
          {tab === 'tests'
            ? <TestCasesTab projectId={projectId} slug={slug ?? ''} />
            : <TasksTab projectId={projectId} slug={slug ?? ''} />}
        </div>
      </div>
    </div>
  );
}
