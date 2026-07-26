import { useState } from 'react';
import { ALL_TASK_STATUSES, STATUS_LABEL, STATUS_DOT_COLOR } from '../../lib/taskMeta';
import { TaskCard } from './TaskCard';
import type { Task, TaskStatus } from '../../types';

// Native HTML5 drag-and-drop — no extra dependency needed for a single-axis
// "drag card between status columns" interaction. Only top-level tasks are
// shown as cards (subtasks ride along with their parent and are summarized
// via the ☑ count on the card) — dragging a subtask independently between
// columns isn't supported in this MVP.

export function KanbanBoard({
  tasks,
  onOpenTask,
  onMoveTask,
  onQuickAdd,
}: {
  tasks: Task[];
  onOpenTask: (task: Task) => void;
  onMoveTask: (taskId: string, status: TaskStatus) => void;
  onQuickAdd: (status: TaskStatus) => void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);

  const topLevel = tasks.filter((t) => !t.parentTaskId);

  return (
    <div className="tm-board">
      {ALL_TASK_STATUSES.map((status) => {
        const columnTasks = topLevel.filter((t) => t.status === status);
        return (
          <div
            key={status}
            className={`tm-column${dragOverStatus === status ? ' drag-over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOverStatus(status); }}
            onDragLeave={() => setDragOverStatus((s) => (s === status ? null : s))}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverStatus(null);
              const taskId = e.dataTransfer.getData('text/task-id');
              if (taskId) onMoveTask(taskId, status);
            }}
          >
            <div className="tm-column-header">
              <span className="tm-column-dot" style={{ background: STATUS_DOT_COLOR[status] }} />
              {STATUS_LABEL[status]}
              <span className="tm-column-count">{columnTasks.length}</span>
            </div>
            <div className="tm-column-body">
              {columnTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  isDragging={draggingId === task.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/task-id', task.id);
                    e.dataTransfer.effectAllowed = 'move';
                    setDraggingId(task.id);
                  }}
                  onDragEnd={() => setDraggingId(null)}
                  onOpen={() => onOpenTask(task)}
                />
              ))}
              <div className="tm-quick-add" onClick={() => onQuickAdd(status)}>
                <span>＋</span> Add task
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
