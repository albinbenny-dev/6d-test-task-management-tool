import { useState } from 'react';
import toast from 'react-hot-toast';
import Topbar from '../components/layout/Topbar';
import { useProjectStore } from '../stores/projectStore';
import { useAdminUsers } from '../hooks/useAdminUsers';
import {
  usePersonalTasks, useCreatePersonalTask, useUpdatePersonalTask, useDeletePersonalTask,
  type PersonalTask,
} from '../hooks/usePersonalTasks';
import { PRIORITY_LABEL, PRIORITY_ACCENT, ALL_PRIORITIES, formatDueDate } from '../lib/taskMeta';
import type { TaskPriority } from '../types';

function isOverdue(task: PersonalTask): boolean {
  if (!task.dueDate || task.done) return false;
  return new Date(task.dueDate).getTime() < Date.now();
}

// ── Create/edit modal ──────────────────────────────────────────────────────
function PersonalTaskModal({ task, onSave, onClose }: {
  task?: PersonalTask;
  onSave: (data: { title: string; notes?: string; priority: TaskPriority; dueDate: string | null }) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(task?.title ?? '');
  const [notes, setNotes] = useState(task?.notes ?? '');
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 'NORMAL');
  const [dueDate, setDueDate] = useState(task?.dueDate ? task.dueDate.slice(0, 10) : '');

  function handleSave() {
    if (!title.trim()) { toast.error('Title is required'); return; }
    onSave({
      title: title.trim(),
      notes: notes.trim() || undefined,
      priority,
      dueDate: dueDate ? new Date(dueDate).toISOString() : null,
    });
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
      <div className="card" style={{ width: '420px', maxWidth: '90vw', padding: '20px' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', marginBottom: '14px' }}>
          {task ? 'Edit Task' : 'New Personal Task'}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <input
            className="input-field"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What do you need to do?"
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
          />
          <textarea
            className="input-field"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional)"
            style={{ resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: '10px' }}>
            <select className="input-field" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} style={{ flex: 1 }}>
              {ALL_PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </select>
            <input className="input-field" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={{ flex: 1 }} />
          </div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
            <button onClick={onClose} style={{ padding: '7px 14px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '12px', cursor: 'pointer' }}>Cancel</button>
            <button onClick={handleSave} style={{ padding: '7px 14px', background: 'var(--cyan)', border: 'none', borderRadius: '6px', color: '#fff', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TaskRow({ task, readOnly, onToggleDone, onEdit, onDelete }: {
  task: PersonalTask;
  readOnly: boolean;
  onToggleDone: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const overdue = isOverdue(task);
  return (
    <div className="tm-row" style={{ gridTemplateColumns: '24px 1fr 90px 100px 60px', paddingLeft: 14 }}>
      <div
        onClick={readOnly ? undefined : onToggleDone}
        className={`tc-checkbox${task.done ? ' checked' : ''}`}
        style={{ fontSize: '10px', cursor: readOnly ? 'default' : 'pointer' }}
        title={task.done ? 'Mark as not done' : 'Mark as done'}
      >
        {task.done ? '✓' : ''}
      </div>
      <div
        className="tm-row-title"
        style={{ cursor: readOnly ? 'default' : 'pointer', textDecoration: task.done ? 'line-through' : 'none', opacity: task.done ? 0.6 : 1 }}
        onClick={readOnly ? undefined : onEdit}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={task.title}>{task.title}</span>
      </div>
      <div>
        <span style={{ fontSize: '10.5px', fontWeight: 700, color: PRIORITY_ACCENT[task.priority] }}>{PRIORITY_LABEL[task.priority]}</span>
      </div>
      <div style={{ fontSize: '11.5px', color: overdue ? 'var(--fail)' : 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
        {task.dueDate ? formatDueDate(task.dueDate) : '—'}
      </div>
      {!readOnly && (
        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
          <button onClick={onDelete} title="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: '12px' }}>✕</button>
        </div>
      )}
    </div>
  );
}

export default function PersonalTasks() {
  const { currentUser } = useProjectStore();
  const isSuperAdmin = currentUser?.globalRole === 'SUPER_ADMIN';
  const [viewUserId, setViewUserId] = useState<string | undefined>(undefined);
  const { data: adminUsers = [] } = useAdminUsers(isSuperAdmin);

  const { data, isLoading } = usePersonalTasks(viewUserId);
  const createMutation = useCreatePersonalTask();
  const updateMutation = useUpdatePersonalTask();
  const deleteMutation = useDeletePersonalTask();

  const [quickTitle, setQuickTitle] = useState('');
  const [editingTask, setEditingTask] = useState<PersonalTask | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const tasks = data?.tasks ?? [];
  const viewingSelf = !viewUserId || viewUserId === currentUser?.id;
  const readOnly = !viewingSelf;

  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);

  function handleQuickAdd() {
    if (!quickTitle.trim()) return;
    createMutation.mutate({ title: quickTitle.trim() }, {
      onSuccess: () => setQuickTitle(''),
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Topbar breadcrumbs={[{ label: 'Personal Tasks' }]} />

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px', maxWidth: '760px' }}>
        <div className="page-eyebrow">Private to you</div>
        <h1 className="page-title">Personal Tasks</h1>
        <p className="page-sub">
          {viewingSelf
            ? 'Your own to-do tracker — visible only to you.'
            : `Viewing ${adminUsers.find((u) => u.id === viewUserId)?.name ?? 'another user'}'s personal tasks (read-only).`}
        </p>

        {isSuperAdmin && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '16px' }}>
            <label style={{ fontSize: '11px', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase' }}>View as</label>
            <select
              className="input-field"
              style={{ fontSize: '12px', padding: '5px 10px', width: 'auto' }}
              value={viewUserId ?? currentUser?.id ?? ''}
              onChange={(e) => setViewUserId(e.target.value === currentUser?.id ? undefined : e.target.value)}
            >
              {currentUser && <option value={currentUser.id}>Me ({currentUser.name})</option>}
              {adminUsers.filter((u) => u.id !== currentUser?.id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        )}

        <div style={{ marginTop: '20px' }}>
          {!readOnly && (
            <div className="card" style={{ padding: '10px 14px', marginBottom: '14px', display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                className="input-field"
                value={quickTitle}
                onChange={(e) => setQuickTitle(e.target.value)}
                placeholder="+ Add a task and press Enter…"
                style={{ flex: 1, border: 'none', background: 'transparent' }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleQuickAdd(); }}
              />
              <button onClick={() => setShowCreate(true)} title="Add with details" style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '6px', padding: '5px 10px', color: 'var(--text-dim)', fontSize: '11px', cursor: 'pointer' }}>
                ⚙ Details
              </button>
            </div>
          )}

          {isLoading ? (
            <div style={{ color: 'var(--text-dim)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>Loading…</div>
          ) : tasks.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
              {viewingSelf ? 'Nothing tracked yet — add your first task above.' : 'This user has no personal tasks yet.'}
            </div>
          ) : (
            <>
              {open.length > 0 && (
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>To Do <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontWeight: 400 }}>{open.length}</span></div>
                  <div className="card" style={{ overflow: 'hidden' }}>
                    {open.map((t) => (
                      <TaskRow
                        key={t.id}
                        task={t}
                        readOnly={readOnly}
                        onToggleDone={() => updateMutation.mutate({ id: t.id, done: true })}
                        onEdit={() => setEditingTask(t)}
                        onDelete={() => deleteMutation.mutate(t.id)}
                      />
                    ))}
                  </div>
                </div>
              )}
              {done.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>Done <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontWeight: 400 }}>{done.length}</span></div>
                  <div className="card" style={{ overflow: 'hidden' }}>
                    {done.map((t) => (
                      <TaskRow
                        key={t.id}
                        task={t}
                        readOnly={readOnly}
                        onToggleDone={() => updateMutation.mutate({ id: t.id, done: false })}
                        onEdit={() => setEditingTask(t)}
                        onDelete={() => deleteMutation.mutate(t.id)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {showCreate && (
        <PersonalTaskModal
          onSave={(data) => { createMutation.mutate(data); setShowCreate(false); }}
          onClose={() => setShowCreate(false)}
        />
      )}
      {editingTask && (
        <PersonalTaskModal
          task={editingTask}
          onSave={(data) => { updateMutation.mutate({ id: editingTask.id, ...data }); setEditingTask(null); }}
          onClose={() => setEditingTask(null)}
        />
      )}
    </div>
  );
}
