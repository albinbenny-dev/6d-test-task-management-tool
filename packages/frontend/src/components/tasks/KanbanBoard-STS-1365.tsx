import { useState } from 'react';
import { ALL_TASK_STATUSES, STATUS_LABEL, STATUS_DOT_COLOR } from '../../lib/taskMeta';
import { TaskCard } from './TaskCard';
import type { Task, TaskStatus } from '../../types';

// Native HTML5 drag-and-drop — no extra dependency needed for a single-axis
// "drag card between status columns" interaction, plus reordering cards
// within/across columns. Only top-level tasks are shown as cards (subtasks
// ride along with their parent and are summarized via the ☑ count on the
// card) — dragging a subtask independently isn't supported in this MVP.
//
// Reordering always resolves the drop against the full `topLevel` array
// (every card currently rendered, across all columns) rather than just the
// target column, because the reorder endpoint persists sortOrder for the
// exact id list it's given — passing a full, unambiguous order avoids
// clobbering the relative order of cards outside the dragged-over column.
// A caveat: if status/search/etc. filters are hiding some tasks, those
// hidden tasks aren't included in `tasks` and so keep their old sortOrder,
// which can interleave oddly until filters are cleared.

export function KanbanBoard({
  tasks,
  onOpenTask,
  onMoveTask,
  onReorderTasks,
  onQuickAdd,
}: {
  tasks: Task[];
  onOpenTask: (task: Task) => void;
  onMoveTask: (taskId: string, status: TaskStatus) => void;
  onReorderTasks: (orderedIds: string[]) => void;
  onQuickAdd: (status: TaskStatus) => void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);

  const topLevel = tasks.filter((t) => !t.parentTaskId);

  function dropOnCard(targetTask: Task) {
    const sourceId = draggingId;
    setDraggingId(null);
    setDragOverStatus(null);
    setDragOverTaskId(null);
    if (!sourceId || sourceId === targetTask.id) return;
    const sourceTask = topLevel.find((t) => t.id === sourceId);
    if (sourceTask && sourceTask.status !== targetTask.status) onMoveTask(sourceId, targetTask.status);

    const ids = topLevel.map((t) => t.id);
    const fromIdx = ids.indexOf(sourceId);
    const toIdx = ids.indexOf(targetTask.id);
    if (fromIdx === -1 || toIdx === -1) return;
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, sourceId);
    onReorderTasks(ids);
  }

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
                  isDragOver={dragOverTaskId === task.id && draggingId !== task.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/task-id', task.id);
                    e.dataTransfer.effectAllowed = 'move';
                    setDraggingId(task.id);
                  }}
                  onDragEnd={() => { setDraggingId(null); setDragOverTaskId(null); }}
                  onDragOver={(e) => {
                    if (!draggingId) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setDragOverStatus(status);
                    setDragOverTaskId(task.id);
                  }}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); dropOnCard(task); }}
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
