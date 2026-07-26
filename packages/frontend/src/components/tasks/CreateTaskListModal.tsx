import { useState } from 'react';
import toast from 'react-hot-toast';
import { useCreateTaskList } from '../../hooks/useTaskLists';

const COLORS = ['#2563AB', '#F47B20', '#2A9D8F', '#DC2626', '#8b5cf6', '#0A2A57'];

export function CreateTaskListModal({ projectId, onClose, onCreated }: {
  projectId: string;
  onClose: () => void;
  onCreated?: (listId: string) => void;
}) {
  const createList = useCreateTaskList(projectId);
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[0]);

  async function handleSubmit() {
    if (!name.trim()) { toast.error('List name is required'); return; }
    try {
      const list = await createList.mutateAsync({ name: name.trim(), color });
      toast.success(`"${list.name}" created`);
      onCreated?.(list.id);
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to create list';
      toast.error(msg);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
      <div className="card" style={{ width: 400, padding: 0 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 700, padding: '20px 20px 0' }}>New Task List</div>
        <div style={{ padding: '16px 20px' }}>
          <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-mid)', display: 'block', marginBottom: 4 }}>
            Name
          </label>
          <input
            autoFocus
            className="input-field"
            placeholder="e.g. Migration, Reporting, Integrations"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
            style={{ marginBottom: 14 }}
          />
          <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-mid)', display: 'block', marginBottom: 6 }}>
            Color
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                style={{
                  width: 26, height: 26, borderRadius: '50%', background: c, cursor: 'pointer',
                  border: color === c ? '2px solid var(--text)' : '2px solid transparent',
                  boxShadow: color === c ? '0 0 0 2px var(--surface)' : 'none',
                }}
              />
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 20px', borderTop: '1px solid var(--border)' }}>
          <button className="tb-btn tb-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="tb-btn tb-btn-primary" onClick={handleSubmit} disabled={createList.isPending}>
            {createList.isPending ? 'Creating…' : 'Create List'}
          </button>
        </div>
      </div>
    </div>
  );
}
