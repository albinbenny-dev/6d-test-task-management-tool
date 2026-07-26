import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTaskLists, useDeleteTaskList } from '../../hooks/useTaskLists';
import { useRBAC } from '../../hooks/useRBAC';
import { CreateTaskListModal } from './CreateTaskListModal';
import type { TaskList } from '../../types';

// ── In-page navigation panel for Task Management — every task list, always
// visible while working a board/list, so switching lists doesn't mean going
// back to an overview page first (was a card grid you had to return to). ───
export function TaskListsSidebar({ projectId, slug, activeListId }: {
  projectId: string | undefined;
  slug: string;
  activeListId?: string;
}) {
  const navigate = useNavigate();
  const { canWrite, isAdmin, isSuperUser } = useRBAC();
  const canDeleteList = isAdmin || isSuperUser;
  const { data: lists = [], isLoading } = useTaskLists(projectId);
  const deleteList = useDeleteTaskList(projectId ?? '');
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<TaskList | null>(null);

  async function handleDelete() {
    if (!confirmDelete) return;
    try {
      await deleteList.mutateAsync(confirmDelete.id);
      if (confirmDelete.id === activeListId) navigate(`/projects/${slug}/tasks`);
    } finally {
      setConfirmDelete(null);
    }
  }

  return (
    <>
      <aside style={{ width: 216, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 14px 10px' }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--text-dim)' }}>Task Lists</span>
          {canWrite && (
            <button
              onClick={() => setShowCreate(true)}
              title="New list"
              style={{ width: 20, height: 20, borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}
            >
              +
            </button>
          )}
        </div>

        <nav style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px' }}>
          {isLoading && (
            <div style={{ padding: '8px 6px', color: 'var(--text-dim)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>Loading…</div>
          )}
          {!isLoading && lists.length === 0 && (
            <div style={{ padding: '8px 6px', color: 'var(--text-dim)', fontSize: 11 }}>No lists yet.</div>
          )}
          {lists.map((list) => {
            const active = list.id === activeListId;
            const count = list._count?.tasks ?? 0;
            return (
              <Link
                key={list.id}
                to={`/projects/${slug}/tasks/${list.id}`}
                className={`nav-item${active ? ' active' : ''}`}
                style={{ position: 'relative' }}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: list.color, flexShrink: 0 }} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{list.name}</span>
                <span className="nav-badge blue">{count}</span>
                {canDeleteList && (
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmDelete(list); }}
                    title="Delete list"
                    style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 11, padding: '0 0 0 4px' }}
                  >
                    🗑
                  </button>
                )}
              </Link>
            );
          })}
        </nav>
      </aside>

      {showCreate && projectId && (
        <CreateTaskListModal
          projectId={projectId}
          onClose={() => setShowCreate(false)}
          onCreated={(listId) => { setShowCreate(false); navigate(`/projects/${slug}/tasks/${listId}`); }}
        />
      )}

      {confirmDelete && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setConfirmDelete(null)}
        >
          <div className="card" style={{ width: 380, padding: 20 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Delete "{confirmDelete.name}"?</div>
            <p style={{ fontSize: 12, color: 'var(--text-mid)', marginBottom: 16 }}>
              This will permanently delete all {confirmDelete._count?.tasks ?? 0} task(s) inside it. This cannot be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="tb-btn tb-btn-ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="tb-btn" style={{ color: 'var(--fail)', borderColor: 'rgba(220,38,38,0.3)' }} onClick={() => void handleDelete()}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
