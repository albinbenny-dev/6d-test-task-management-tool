import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useCreateTask, useUpdateTaskStatus, useTasks } from '../../hooks/useTasks';
import { useProjectMembers } from '../../hooks/useProjects';
import { ALL_PRIORITIES, PRIORITY_LABEL, parseTags } from '../../lib/taskMeta';
import { AssigneePicker } from './AssigneePicker';
import { TagChipInput } from '../ui/TagChipInput';
import type { TaskPriority, TaskStatus } from '../../types';

export function CreateTaskModal({
  projectId,
  taskListId,
  defaultStatus,
  onClose,
}: {
  projectId: string;
  taskListId: string;
  defaultStatus?: TaskStatus;
  onClose: () => void;
}) {
  const createTask = useCreateTask(projectId);
  const updateStatus = useUpdateTaskStatus(projectId);
  const { data: members = [] } = useProjectMembers(projectId);
  const { data: allTasksForTags = [] } = useTasks(projectId);
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of allTasksForTags) for (const tag of parseTags(t.tags)) set.add(tag);
    return [...set].sort();
  }, [allTasksForTags]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('NORMAL');
  const [assigneeUserId, setAssigneeUserId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState('');
  const [tags, setTags] = useState<string[]>([]);

  const selectedMember = members.find((m) => m.userId === assigneeUserId);
  const assigneeDisplay = selectedMember
    ? { id: selectedMember.userId, user: selectedMember.user }
    : null;

  async function handleSubmit() {
    if (!title.trim()) { toast.error('Task title is required'); return; }
    try {
      const task = await createTask.mutateAsync({
        taskListId,
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        assigneeUserId: assigneeUserId ?? undefined,
        dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
        tags: tags.length ? tags : undefined,
      });
      // Board quick-add carries a target column — new tasks default to TO_DO
      // server-side, so nudge it into the column the user clicked "+" on.
      if (defaultStatus && defaultStatus !== 'TO_DO') {
        await updateStatus.mutateAsync({ id: task.id, status: defaultStatus });
      }
      toast.success('Task created');
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to create task';
      toast.error(msg);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
      <div className="card" style={{ width: 480, padding: 0 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 700, padding: '20px 20px 0' }}>New Task</div>
        <div style={{ padding: '16px 20px' }}>
          <input
            autoFocus
            className="input-field"
            placeholder="Task title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{ marginBottom: 12, fontSize: 13 }}
          />
          <textarea
            className="input-field"
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            style={{ marginBottom: 12 }}
          />
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>Priority</label>
              <select
                className="input-field"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                style={{ width: 'auto', fontSize: 12 }}
              >
                {ALL_PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>Due date</label>
              <input
                type="date"
                className="input-field"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                style={{ width: 'auto', fontSize: 12 }}
              />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>Assignee</label>
              <AssigneePicker
                projectId={projectId}
                value={assigneeDisplay}
                size={28}
                onChange={setAssigneeUserId}
              />
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>Tags</label>
            <TagChipInput tags={tags} suggestions={allTags} onChange={setTags} />
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 20px', borderTop: '1px solid var(--border)' }}>
          <button className="tb-btn tb-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="tb-btn tb-btn-primary" onClick={handleSubmit} disabled={createTask.isPending}>
            {createTask.isPending ? 'Creating…' : 'Create Task'}
          </button>
        </div>
      </div>
    </div>
  );
}
