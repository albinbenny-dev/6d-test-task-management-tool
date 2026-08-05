import { useMemo, useState } from 'react';
import { TbBtn } from '../layout/Topbar';
import { MultiSelectFilter } from '../testCycles/FilterBar';
import {
  nestSubtasks, isTaskOverdue, formatDueDate, taskDotColor,
  ALL_TASK_STATUSES, STATUS_LABEL, STATUS_DOT_COLOR,
  ALL_PRIORITIES, PRIORITY_LABEL,
  TASK_DUE_BUCKETS, taskDueBucket,
} from '../../lib/taskMeta';
import { PriorityBadge } from './PriorityBadge';
import { TaskStatusPicker } from './TaskStatusPicker';
import { AssigneePicker } from './AssigneePicker';
import type { Task, TaskStatus } from '../../types';

const GRID = '1fr 120px 100px 110px 140px';

function Row({
  task,
  projectId,
  depth,
  onOpen,
  onStatusChange,
  onAssigneeChange,
  canWrite,
}: {
  task: Task;
  projectId: string;
  depth: number;
  onOpen: (task: Task) => void;
  onStatusChange: (id: string, status: TaskStatus) => void;
  onAssigneeChange: (id: string, userId: string | null) => void;
  canWrite: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasSubtasks = (task.subtasks?.length ?? 0) > 0;
  const overdue = isTaskOverdue(task);

  return (
    <>
      <div className="tm-row" style={{ gridTemplateColumns: GRID, paddingLeft: 14 + depth * 22 }}>
        <div className="tm-row-title" onClick={() => onOpen(task)}>
          {hasSubtasks ? (
            <button
              type="button"
              className={`tm-subtask-toggle${expanded ? ' open' : ''}`}
              onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
            >
              ▶
            </button>
          ) : (
            <span style={{ width: 16, flexShrink: 0 }} />
          )}
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: taskDotColor(task), flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</span>
          {hasSubtasks && (
            <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
              🔗 {task.subtasks!.length} subtask{task.subtasks!.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <div onClick={(e) => e.stopPropagation()}>
          <AssigneePicker
            projectId={projectId}
            value={task.assignee}
            disabled={!canWrite}
            onChange={(userId) => onAssigneeChange(task.id, userId)}
            size={22}
          />
        </div>
        <div className={`tm-due-chip${overdue ? ' overdue' : ''}`}>
          {task.dueDate ? <>{overdue ? '⏰' : '📅'} {formatDueDate(task.dueDate)}</> : <span style={{ opacity: 0.4 }}>—</span>}
        </div>
        <div><PriorityBadge priority={task.priority} /></div>
        <div onClick={(e) => e.stopPropagation()}>
          <TaskStatusPicker task={task} disabled={!canWrite} onChange={(s) => onStatusChange(task.id, s)} />
        </div>
      </div>
      {hasSubtasks && expanded && task.subtasks!.map((sub) => (
        <Row
          key={sub.id}
          task={sub}
          projectId={projectId}
          depth={depth + 1}
          onOpen={onOpen}
          onStatusChange={onStatusChange}
          onAssigneeChange={onAssigneeChange}
          canWrite={canWrite}
        />
      ))}
    </>
  );
}

function matchesMulti(selected: string[], value: string): boolean {
  return selected.length === 0 || selected.includes(value);
}

function assigneeName(task: Task): string {
  return task.assignee?.user.name ?? 'Unassigned';
}

export function TaskListView({
  tasks,
  projectId,
  onOpenTask,
  onStatusChange,
  onAssigneeChange,
  onQuickAdd,
  canWrite,
}: {
  tasks: Task[];
  projectId: string;
  onOpenTask: (task: Task) => void;
  onStatusChange: (id: string, status: TaskStatus) => void;
  onAssigneeChange: (id: string, userId: string | null) => void;
  onQuickAdd: (status?: TaskStatus) => void;
  canWrite: boolean;
}) {
  const [search, setSearch] = useState('');
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [priorityFilters, setPriorityFilters] = useState<string[]>([]);
  const [assigneeFilters, setAssigneeFilters] = useState<string[]>([]);
  const [dueFilters, setDueFilters] = useState<string[]>([]);

  const assigneeOptions = useMemo(
    () => [...new Set(tasks.map(assigneeName))].sort(),
    [tasks],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((t) => {
      if (q && !t.title.toLowerCase().includes(q)) return false;
      if (!matchesMulti(statusFilters, STATUS_LABEL[t.status])) return false;
      if (!matchesMulti(priorityFilters, PRIORITY_LABEL[t.priority])) return false;
      if (!matchesMulti(assigneeFilters, assigneeName(t))) return false;
      if (!matchesMulti(dueFilters, taskDueBucket(t))) return false;
      return true;
    });
  }, [tasks, search, statusFilters, priorityFilters, assigneeFilters, dueFilters]);

  const roots = useMemo(() => nestSubtasks(filtered), [filtered]);
  const groups = useMemo(
    () => ALL_TASK_STATUSES.map((status) => ({ status, items: roots.filter((t) => t.status === status) })),
    [roots],
  );

  const totalTopLevel = tasks.filter((t) => !t.parentTaskId).length;
  const activeFilterCount = statusFilters.length + priorityFilters.length + assigneeFilters.length + dueFilters.length + (search.trim() ? 1 : 0);

  function clearFilters() {
    setSearch('');
    setStatusFilters([]);
    setPriorityFilters([]);
    setAssigneeFilters([]);
    setDueFilters([]);
  }

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* ── Toolbar — global search + a multi-select filter per dimension ── */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          padding: '10px 14px', borderBottom: '1px solid var(--border)',
          background: 'var(--surface2)', flexShrink: 0,
        }}
      >
        <div style={{ position: 'relative', flex: '0 1 220px', minWidth: 140 }}>
          <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', fontSize: 11, opacity: 0.5 }}>🔍</span>
          <input
            className="input-field"
            placeholder="Search tasks…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ fontSize: 12, padding: '6px 9px 6px 28px', width: '100%' }}
          />
        </div>
        <MultiSelectFilter label="Status" values={statusFilters} onChange={setStatusFilters} options={ALL_TASK_STATUSES.map((s) => STATUS_LABEL[s])} />
        <MultiSelectFilter label="Priority" values={priorityFilters} onChange={setPriorityFilters} options={ALL_PRIORITIES.map((p) => PRIORITY_LABEL[p])} />
        <MultiSelectFilter label="Assignee" values={assigneeFilters} onChange={setAssigneeFilters} options={assigneeOptions} />
        <MultiSelectFilter label="Due date" values={dueFilters} onChange={setDueFilters} options={[...TASK_DUE_BUCKETS]} />
        {activeFilterCount > 0 && (
          <TbBtn variant="ghost" onClick={clearFilters}>✕ Clear ({activeFilterCount})</TbBtn>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
          {roots.length} of {totalTopLevel} task{totalTopLevel === 1 ? '' : 's'}
        </span>
      </div>

      {/* ── Column header — sticky so it stays visible while the grouped
          rows below scroll within this component's own bounded region,
          independent of whatever the surrounding page layout does. ── */}
      <div
        className="tm-row"
        style={{
          gridTemplateColumns: GRID, paddingLeft: 14,
          fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.6px',
          textTransform: 'uppercase', color: 'var(--text-dim)', fontWeight: 600,
          background: 'var(--surface2)', flexShrink: 0,
        }}
      >
        <div>Name</div>
        <div>Assignee</div>
        <div>Due date</div>
        <div>Priority</div>
        <div>Status</div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {tasks.length === 0 && (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
            No tasks yet.
          </div>
        )}

        {tasks.length > 0 && roots.length === 0 && (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
            No tasks match your filters.
            <div style={{ marginTop: 10 }}>
              <TbBtn variant="ghost" onClick={clearFilters}>✕ Clear filters</TbBtn>
            </div>
          </div>
        )}

        {tasks.length > 0 && groups.map(({ status, items }) => (
          <div key={status}>
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
                fontSize: 11.5, fontWeight: 700, color: 'var(--text)',
                background: 'var(--bg)', borderBottom: '1px solid var(--border)',
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_DOT_COLOR[status], flexShrink: 0 }} />
              {STATUS_LABEL[status]}
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-dim)',
                background: 'var(--surface2)', border: '1px solid var(--border)', padding: '1px 7px', borderRadius: 100,
              }}>
                {items.length}
              </span>
            </div>

            {items.map((task) => (
              <Row
                key={task.id}
                task={task}
                projectId={projectId}
                depth={0}
                onOpen={onOpenTask}
                onStatusChange={onStatusChange}
                onAssigneeChange={onAssigneeChange}
                canWrite={canWrite}
              />
            ))}

            {canWrite && (
              <div className="tm-quick-add" onClick={() => onQuickAdd(status)}>
                <span>＋</span> Add task
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
