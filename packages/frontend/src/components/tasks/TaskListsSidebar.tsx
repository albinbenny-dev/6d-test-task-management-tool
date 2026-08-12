import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useTaskLists, useDeleteTaskList, useUpdateTaskList, useDuplicateTaskList } from '../../hooks/useTaskLists';
import { useRBAC } from '../../hooks/useRBAC';
import { useClickOutside } from '../../hooks/useClickOutside';
import { FloatingPortal } from '../ui/FloatingPortal';
import { CreateTaskListModal } from './CreateTaskListModal';
import type { TaskList } from '../../types';

// Persisted across the whole app (not per-project) — a lead who widens this
// once to read long list names shouldn't have to redo it on every project.
const WIDTH_KEY = 'tm-task-list-sidebar-width';
const MIN_WIDTH = 180;
const MAX_WIDTH = 420;
const DEFAULT_WIDTH = 216;

function getStoredWidth(): number {
  const raw = localStorage.getItem(WIDTH_KEY);
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, n)) : DEFAULT_WIDTH;
}

const menuItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '7px 12px',
  background: 'none',
  border: 'none',
  color: 'var(--text)',
  fontSize: 12,
  cursor: 'pointer',
  textAlign: 'left',
};

// ── One task-list row — its own hover/menu state, since only its own kebab
// button and dropdown care about it. Rename/delete are hidden behind that
// kebab (revealed on hover) rather than always-visible icons, so the list
// name gets almost the full row width to itself instead of permanently
// giving up ~40-50px to two rarely-used buttons. ───────────────────────────
function TaskListRow({ list, slug, active, canWrite, canDelete, isRenaming, renameValue, onRenameChange, onStartRename, onCommitRename, onCancelRename, onDuplicate, onRequestDelete }: {
  list: TaskList;
  slug: string;
  active: boolean;
  canWrite: boolean;
  canDelete: boolean;
  isRenaming: boolean;
  renameValue: string;
  onRenameChange: (value: string) => void;
  onStartRename: () => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onDuplicate: () => void;
  onRequestDelete: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const rowRef = useRef<HTMLAnchorElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside([rowRef, menuRef], () => setMenuOpen(false), menuOpen);

  const count = list._count?.tasks ?? 0;
  const showKebab = (canWrite || canDelete) && !isRenaming;

  return (
    <Link
      ref={rowRef}
      to={`/projects/${slug}/tasks/${list.id}`}
      className={`nav-item${active ? ' active' : ''}`}
      style={{ position: 'relative', fontSize: 12.5 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(e) => { if (isRenaming) e.preventDefault(); }}
    >
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: list.color, flexShrink: 0 }} />
      {isRenaming ? (
        <input
          autoFocus
          value={renameValue}
          onChange={(e) => onRenameChange(e.target.value)}
          onClick={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); onCommitRename(); }
            if (e.key === 'Escape') { e.preventDefault(); onCancelRename(); }
          }}
          onBlur={() => onCommitRename()}
          style={{ flex: 1, minWidth: 0, background: 'var(--surface)', border: '1px solid var(--cyan)', borderRadius: 4, padding: '1px 4px', fontSize: 'inherit', color: 'inherit', fontFamily: 'inherit' }}
        />
      ) : (
        <span title={list.name} style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{list.name}</span>
      )}
      <span className="nav-badge blue">{count}</span>

      {showKebab && (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuOpen((v) => !v); }}
          title="List actions"
          style={{
            opacity: hovered || menuOpen ? 1 : 0, transition: 'opacity 0.12s',
            background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer',
            fontSize: 13, lineHeight: 1, padding: '2px 0 2px 4px',
          }}
        >
          ⋮
        </button>
      )}

      <FloatingPortal anchorRef={rowRef} open={menuOpen} align="end" portalRef={menuRef} width={140}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-card)', overflow: 'hidden' }}>
          {canWrite && (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuOpen(false); onStartRename(); }}
              style={menuItemStyle}
            >
              ✎ Rename
            </button>
          )}
          {canWrite && (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuOpen(false); onDuplicate(); }}
              style={menuItemStyle}
            >
              ⧉ Duplicate
            </button>
          )}
          {canDelete && (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuOpen(false); onRequestDelete(); }}
              style={{ ...menuItemStyle, color: 'var(--fail)' }}
            >
              🗑 Delete
            </button>
          )}
        </div>
      </FloatingPortal>
    </Link>
  );
}

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
  const updateList = useUpdateTaskList(projectId ?? '');
  const duplicateList = useDuplicateTaskList(projectId ?? '');
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<TaskList | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // ── Resizable panel — drag the right-edge divider, same mechanics as
  // Scripts.tsx's file-tree/editor split: mutate the DOM directly during the
  // drag for smoothness, commit to React state (and localStorage) on mouseup.
  const [width, setWidth] = useState(getStoredWidth);
  const widthRef = useRef(width);
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(0);
  const asideRef = useRef<HTMLElement>(null);

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    dragStartXRef.current = e.clientX;
    dragStartWidthRef.current = widthRef.current;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useLayoutEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const delta = e.clientX - dragStartXRef.current;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragStartWidthRef.current + delta));
      widthRef.current = next;
      if (asideRef.current) asideRef.current.style.width = `${next}px`;
    };
    const onMouseUp = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setWidth(widthRef.current);
      localStorage.setItem(WIDTH_KEY, String(widthRef.current));
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  async function handleDuplicate(list: TaskList) {
    try {
      const { list: newList, tasksCopied } = await duplicateList.mutateAsync(list.id);
      toast.success(`"${newList.name}" created (${tasksCopied} task${tasksCopied === 1 ? '' : 's'} copied)`);
      navigate(`/projects/${slug}/tasks/${newList.id}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to duplicate list';
      toast.error(msg);
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    try {
      await deleteList.mutateAsync(confirmDelete.id);
      if (confirmDelete.id === activeListId) navigate(`/projects/${slug}/tasks`);
    } finally {
      setConfirmDelete(null);
    }
  }

  function startRename(list: TaskList) {
    setRenamingId(list.id);
    setRenameValue(list.name);
  }

  async function commitRename() {
    const id = renamingId;
    const trimmed = renameValue.trim();
    setRenamingId(null);
    if (!id) return;
    const list = lists.find((l) => l.id === id);
    if (!trimmed || (list && trimmed === list.name)) return;
    try {
      await updateList.mutateAsync({ id, name: trimmed });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to rename list';
      toast.error(msg);
    }
  }

  return (
    <>
      <aside ref={asideRef} style={{ width, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
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

        <nav style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 8px 8px' }}>
          {isLoading && (
            <div style={{ padding: '8px 6px', color: 'var(--text-dim)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>Loading…</div>
          )}
          {!isLoading && lists.length === 0 && (
            <div style={{ padding: '8px 6px', color: 'var(--text-dim)', fontSize: 11 }}>No lists yet.</div>
          )}
          {lists.map((list) => (
            <TaskListRow
              key={list.id}
              list={list}
              slug={slug}
              active={list.id === activeListId}
              canWrite={canWrite}
              canDelete={canDeleteList}
              isRenaming={renamingId === list.id}
              renameValue={renameValue}
              onRenameChange={setRenameValue}
              onStartRename={() => startRename(list)}
              onCommitRename={() => void commitRename()}
              onCancelRename={() => setRenamingId(null)}
              onDuplicate={() => void handleDuplicate(list)}
              onRequestDelete={() => setConfirmDelete(list)}
            />
          ))}
        </nav>
      </aside>

      {/* ── Drag divider — resizes the sidebar; width persists in localStorage ── */}
      <div
        onMouseDown={handleDividerMouseDown}
        style={{ width: 4, flexShrink: 0, cursor: 'col-resize', background: 'var(--border)', transition: 'background 0.15s' }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--6d-orange)'; }}
        onMouseLeave={(e) => { if (!isDraggingRef.current) (e.currentTarget as HTMLDivElement).style.background = 'var(--border)'; }}
      />

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
