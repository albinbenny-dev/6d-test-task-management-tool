import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  useTask, useUpdateTask, useUpdateTaskStatus, useAssignTask, useDeleteTask,
  useCreateTask, useAddTaskComment, useDeleteTaskComment,
} from '../../hooks/useTasks';
import { useProjectStore } from '../../stores/projectStore';
import { formatRelativeTime } from '../../lib/utils';
import { parseTags, formatDueDate, isTaskOverdue } from '../../lib/taskMeta';
import { TaskStatusPicker } from './TaskStatusPicker';
import { PriorityPicker } from './PriorityPicker';
import { AssigneePicker } from './AssigneePicker';
import { TaskAvatar } from './TaskAvatar';
import type { Task } from '../../types';

function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}

function SubtaskRow({ projectId, subtask, onOpen, isLast }: {
  projectId: string; subtask: Task; onOpen: () => void; isLast: boolean;
}) {
  const updateStatus = useUpdateTaskStatus(projectId);
  const assignSubtask = useAssignTask(projectId);
  const done = subtask.status === 'DONE';
  const overdue = isTaskOverdue(subtask);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0',
      borderBottom: isLast ? 'none' : '1px solid var(--border)',
    }}>
      <input
        type="checkbox"
        checked={done}
        onChange={() => updateStatus.mutate({ id: subtask.id, status: done ? 'TO_DO' : 'DONE' })}
        style={{ width: 15, height: 15, cursor: 'pointer', flexShrink: 0 }}
      />
      <span
        onClick={onOpen}
        style={{
          flex: 1, fontSize: 12.5, cursor: 'pointer',
          color: done ? 'var(--text-dim)' : 'var(--text)',
          textDecoration: done ? 'line-through' : 'none',
        }}
      >
        {subtask.title}
      </span>
      {subtask.dueDate && (
        <div className={`tm-due-chip${overdue && !done ? ' overdue' : ''}`}>
          {overdue && !done ? '⏰' : '📅'} {formatDueDate(subtask.dueDate)}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: 110, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
        <AssigneePicker
          projectId={projectId}
          value={subtask.assignee}
          size={18}
          onChange={(userId) => assignSubtask.mutate({ id: subtask.id, assigneeUserId: userId })}
        />
        <span style={{ fontSize: 11, color: subtask.assignee ? 'var(--text-mid)' : 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {subtask.assignee?.user.name ?? 'Unassigned'}
        </span>
      </div>
    </div>
  );
}

export function TaskDetailPanel({ projectId, taskId, onClose, onNavigateToTask }: {
  projectId: string;
  taskId: string;
  onClose: () => void;
  onNavigateToTask: (taskId: string) => void;
}) {
  const { currentUser } = useProjectStore();
  const { data: task, isLoading } = useTask(projectId, taskId);
  const updateTask = useUpdateTask(projectId);
  const updateStatus = useUpdateTaskStatus(projectId);
  const assignTask = useAssignTask(projectId);
  const deleteTask = useDeleteTask(projectId);
  const createSubtask = useCreateTask(projectId);
  const addComment = useAddTaskComment(projectId);
  const deleteComment = useDeleteTaskComment(projectId);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [newSubtask, setNewSubtask] = useState('');
  const [newComment, setNewComment] = useState('');
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description ?? '');
    }
  }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (isLoading || !task) {
    return (
      <>
        <div className="tm-panel-backdrop" onClick={onClose} />
        <div className="tm-panel" style={{ alignItems: 'center', justifyContent: 'center', display: 'flex' }}>
          <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>Loading…</span>
        </div>
      </>
    );
  }

  const tags = parseTags(task.tags);

  function saveTitle() {
    const trimmed = title.trim();
    if (trimmed && trimmed !== task!.title) updateTask.mutate({ id: task!.id, title: trimmed });
  }
  function saveDescription() {
    if (description !== (task!.description ?? '')) updateTask.mutate({ id: task!.id, description: description || null });
  }

  function handleAddSubtask() {
    if (!newSubtask.trim()) return;
    createSubtask.mutate(
      { taskListId: task!.taskListId, parentTaskId: task!.id, title: newSubtask.trim() },
      { onSuccess: () => setNewSubtask('') },
    );
  }

  function handleAddComment() {
    if (!newComment.trim()) return;
    addComment.mutate({ taskId: task!.id, body: newComment.trim() }, { onSuccess: () => setNewComment('') });
  }

  async function handleDelete() {
    try {
      await deleteTask.mutateAsync(task!.id);
      toast.success('Task deleted');
      onClose();
    } catch {
      toast.error('Failed to delete task');
    }
  }

  return (
    <>
      <div className="tm-panel-backdrop" onClick={onClose} />
      <div className="tm-panel">
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          {task.parentTaskId && (
            <button
              onClick={() => onNavigateToTask(task.parentTaskId!)}
              style={{ background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 11, cursor: 'pointer' }}
            >
              ← Parent task
            </button>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button
              onClick={() => setShowConfirmDelete(true)}
              title="Delete task"
              style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, width: 28, height: 28, cursor: 'pointer', color: 'var(--text-dim)' }}
            >
              🗑
            </button>
            <button
              onClick={onClose}
              style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, width: 28, height: 28, cursor: 'pointer', color: 'var(--text-dim)' }}
            >
              ✕
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 24px' }}>
          {/* Title — a plain-looking textarea reads as static text with no
              affordance that it's editable, so it gets a visible border +
              hover/focus highlight (matching other inline-editable fields in
              the app) instead of blending in. Enter commits the edit rather
              than inserting a newline, since a task title is conceptually
              single-line even though the field can wrap long ones. */}
          <textarea
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
            rows={1}
            title="Click to edit title"
            className="tm-title-input"
            style={{
              width: '100%', resize: 'none', background: 'transparent',
              fontSize: 19, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-ui)', marginBottom: 16,
            }}
          />

          {/* Meta grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', rowGap: 14, alignItems: 'center', fontSize: 12.5, marginBottom: 20 }}>
            <span style={{ color: 'var(--text-dim)' }}>Status</span>
            <TaskStatusPicker task={task} onChange={(status) => updateStatus.mutate({ id: task.id, status })} />

            <span style={{ color: 'var(--text-dim)' }}>Assignee</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <AssigneePicker
                projectId={projectId}
                value={task.assignee}
                size={26}
                onChange={(userId) => assignTask.mutate({ id: task.id, assigneeUserId: userId })}
              />
              <span style={{ color: 'var(--text-mid)' }}>{task.assignee?.user.name ?? 'Unassigned'}</span>
            </div>

            <span style={{ color: 'var(--text-dim)' }}>Priority</span>
            <PriorityPicker value={task.priority} onChange={(priority) => updateTask.mutate({ id: task.id, priority })} />

            <span style={{ color: 'var(--text-dim)' }}>Start date</span>
            <input
              type="date"
              className="input-field"
              style={{ width: 'auto', fontSize: 11.5, padding: '5px 8px' }}
              value={toDateInputValue(task.startDate)}
              onChange={(e) => updateTask.mutate({ id: task.id, startDate: e.target.value ? new Date(e.target.value).toISOString() : null })}
            />

            <span style={{ color: 'var(--text-dim)' }}>Due date</span>
            <input
              type="date"
              className="input-field"
              style={{ width: 'auto', fontSize: 11.5, padding: '5px 8px' }}
              value={toDateInputValue(task.dueDate)}
              onChange={(e) => updateTask.mutate({ id: task.id, dueDate: e.target.value ? new Date(e.target.value).toISOString() : null })}
            />
          </div>

          {tags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 16 }}>
              {tags.map((t) => <span key={t} className="tag">{t}</span>)}
            </div>
          )}

          {/* Description */}
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-dim)', marginBottom: 6 }}>
            Description
          </div>
          <textarea
            className="input-field"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={saveDescription}
            placeholder="Add a description…"
            rows={4}
            style={{ marginBottom: 20 }}
          />

          {/* Subtasks */}
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-dim)', marginBottom: 6 }}>
            Subtasks {task.subtasks && task.subtasks.length > 0 ? `(${task.subtasks.filter((s) => s.status === 'DONE').length}/${task.subtasks.length})` : ''}
          </div>
          <div style={{ borderTop: '1px solid var(--border)', marginBottom: 8 }}>
            {(task.subtasks ?? []).map((sub, i) => (
              <SubtaskRow
                key={sub.id}
                projectId={projectId}
                subtask={sub}
                onOpen={() => onNavigateToTask(sub.id)}
                isLast={i === (task.subtasks?.length ?? 0) - 1}
              />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
            <input
              className="input-field"
              placeholder="Add subtask…"
              value={newSubtask}
              onChange={(e) => setNewSubtask(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddSubtask(); }}
              style={{ fontSize: 12 }}
            />
            <button className="tb-btn tb-btn-ghost" onClick={handleAddSubtask} disabled={!newSubtask.trim()}>Add</button>
          </div>

          {/* Comments */}
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-dim)', marginBottom: 6 }}>
            Activity
          </div>
          <div>
            {(task.comments ?? []).map((c) => (
              <div key={c.id} className="tm-comment">
                <TaskAvatar name={c.user.name} userId={c.user.id} size={26} />
                <div className="tm-comment-bubble">
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{c.user.name}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{formatRelativeTime(c.createdAt)}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-mid)', marginTop: 3, whiteSpace: 'pre-wrap' }}>{c.body}</div>
                  {currentUser?.id === c.userId && (
                    <button
                      onClick={() => deleteComment.mutate({ taskId: task.id, commentId: c.id })}
                      style={{ background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 10, cursor: 'pointer', padding: 0, marginTop: 4 }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
            {(task.comments ?? []).length === 0 && (
              <div style={{ fontSize: 11.5, color: 'var(--text-dim)', padding: '8px 0' }}>No comments yet.</div>
            )}
          </div>
        </div>

        {/* Comment composer */}
        <div style={{ padding: '12px 24px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, flexShrink: 0 }}>
          <input
            className="input-field"
            placeholder="Write a comment…"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddComment(); }}
          />
          <button className="tb-btn tb-btn-primary" onClick={handleAddComment} disabled={!newComment.trim()}>Post</button>
        </div>
      </div>

      {showConfirmDelete && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowConfirmDelete(false)}
        >
          <div className="card" style={{ width: 360, padding: 20 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Delete this task?</div>
            <p style={{ fontSize: 12, color: 'var(--text-mid)', marginBottom: 16 }}>
              {task.subtasks && task.subtasks.length > 0
                ? `This will also delete its ${task.subtasks.length} subtask${task.subtasks.length === 1 ? '' : 's'}. This cannot be undone.`
                : 'This cannot be undone.'}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="tb-btn tb-btn-ghost" onClick={() => setShowConfirmDelete(false)}>Cancel</button>
              <button className="tb-btn" style={{ color: 'var(--fail)', borderColor: 'rgba(220,38,38,0.3)' }} onClick={handleDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
