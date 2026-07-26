import { useState } from 'react';
import { nestSubtasks, isTaskOverdue, formatDueDate, taskDotColor } from '../../lib/taskMeta';
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
  onQuickAdd: () => void;
  canWrite: boolean;
}) {
  const roots = nestSubtasks(tasks);

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div
        className="tm-row"
        style={{
          gridTemplateColumns: GRID, paddingLeft: 14,
          fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.6px',
          textTransform: 'uppercase', color: 'var(--text-dim)', fontWeight: 600,
          background: 'var(--surface2)',
        }}
      >
        <div>Name</div>
        <div>Assignee</div>
        <div>Due date</div>
        <div>Priority</div>
        <div>Status</div>
      </div>

      {roots.length === 0 && (
        <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
          No tasks yet.
        </div>
      )}

      {roots.map((task) => (
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
        <div className="tm-quick-add" onClick={onQuickAdd}>
          <span>＋</span> Add task
        </div>
      )}
    </div>
  );
}
