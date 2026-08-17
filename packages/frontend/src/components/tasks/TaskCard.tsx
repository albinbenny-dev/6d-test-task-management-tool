import { PRIORITY_ACCENT, taskDotColor } from '../../lib/taskMeta';
import { isTaskOverdue, formatDueDate, parseTags } from '../../lib/taskMeta';
import { PriorityBadge } from './PriorityBadge';
import { TaskAvatar, UnassignedAvatar } from './TaskAvatar';
import type { Task } from '../../types';
import type { CSSProperties } from 'react';

export function TaskCard({
  task,
  onOpen,
  draggable,
  onDragStart,
  onDragEnd,
  isDragging,
}: {
  task: Task;
  onOpen: () => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  isDragging?: boolean;
}) {
  const overdue = isTaskOverdue(task);
  const tags = parseTags(task.tags);
  const subtaskCount = task._count?.subtasks ?? 0;

  return (
    <div
      className={`tm-card${isDragging ? ' dragging' : ''}`}
      style={{ '--accent': PRIORITY_ACCENT[task.priority] } as CSSProperties}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
    >
      <div className="tm-card-title">
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: taskDotColor(task), flexShrink: 0, display: 'inline-block' }} />
        {task.title}
      </div>

      {tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
          {tags.map((t) => <span key={t} className="tag">{t}</span>)}
        </div>
      )}

      <div className="tm-card-meta">
        {task.assignee
          ? <TaskAvatar name={task.assignee.user.name} userId={task.assignee.user.id} size={22} />
          : task.assigneeExternalName
            ? <TaskAvatar name={task.assigneeExternalName} userId={task.assigneeExternalName} size={22} external />
            : <UnassignedAvatar size={22} />}
        {task.dueDate && (
          <span className={`tm-due-chip${overdue ? ' overdue' : ''}`}>
            {overdue ? '⏰' : '📅'} {formatDueDate(task.dueDate)}
          </span>
        )}
        <PriorityBadge priority={task.priority} />
        {subtaskCount > 0 && (
          <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
            🔗 {subtaskCount}
          </span>
        )}
      </div>
    </div>
  );
}
