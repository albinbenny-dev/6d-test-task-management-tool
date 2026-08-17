import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { TbBtn } from '../layout/Topbar';
import {
  nestSubtasks, isTaskOverdue, formatDueDate, taskDotColor, parseTags,
  ALL_TASK_STATUSES, STATUS_LABEL, STATUS_DOT_COLOR,
} from '../../lib/taskMeta';
import { PriorityBadge } from './PriorityBadge';
import { TaskStatusPicker } from './TaskStatusPicker';
import { AssigneePicker, type AssigneeSelection } from './AssigneePicker';
import { useResizableColumns, type ResizableColumnDef } from '../../hooks/useResizableColumns';
import { ColResizeHandle } from '../ui/ColResizeHandle';
import { FloatingPortal } from '../ui/FloatingPortal';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useTaskLists } from '../../hooks/useTaskLists';
import { useBulkMoveTasks, useBulkCopyTasks, exportTasks } from '../../hooks/useTasks';
import type { Task, TaskList, TaskStatus } from '../../types';

// User-resizable, persisted (see useResizableColumns) — shared between the
// column header and every row, including nested subtask rows. The checkbox
// column is fixed-width and not resizable.
const TASK_COLUMNS: (ResizableColumnDef & { label: string; resizable: boolean })[] = [
  { key: 'check', label: '', width: 28, min: 28, max: 28, resizable: false },
  { key: 'name', label: 'Name', width: 280, min: 160, resizable: true },
  { key: 'assignee', label: 'Assignee', width: 120, min: 80, resizable: true },
  { key: 'due', label: 'Due date', width: 100, min: 80, resizable: true },
  { key: 'priority', label: 'Priority', width: 110, min: 80, resizable: true },
  { key: 'status', label: 'Status', width: 140, min: 90, resizable: true },
  { key: 'labels', label: 'Labels', width: 150, min: 90, resizable: true },
];

function Row({
  task,
  projectId,
  depth,
  selectedIds,
  onToggleSelect,
  onOpen,
  onStatusChange,
  onAssigneeChange,
  canWrite,
  gridTemplateColumns,
}: {
  task: Task;
  projectId: string;
  depth: number;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onOpen: (task: Task) => void;
  onStatusChange: (id: string, status: TaskStatus) => void;
  onAssigneeChange: (id: string, next: AssigneeSelection) => void;
  canWrite: boolean;
  gridTemplateColumns: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasSubtasks = (task.subtasks?.length ?? 0) > 0;
  const overdue = isTaskOverdue(task);
  const tags = parseTags(task.tags);
  const shownTags = tags.slice(0, 2);
  const extraTags = tags.length - shownTags.length;

  return (
    <>
      <div className="tm-row" style={{ gridTemplateColumns, paddingLeft: 14 + depth * 22 }}>
        <input
          type="checkbox"
          checked={selectedIds.has(task.id)}
          onChange={() => onToggleSelect(task.id)}
          onClick={(e) => e.stopPropagation()}
          style={{ cursor: 'pointer' }}
        />
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
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={task.title}>{task.title}</span>
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
            externalName={task.assigneeExternalName}
            disabled={!canWrite}
            onChange={(next) => onAssigneeChange(task.id, next)}
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
        <div style={{ display: 'flex', gap: 3, flexWrap: 'nowrap', overflow: 'hidden' }} title={tags.length > 0 ? tags.join(', ') : undefined}>
          {shownTags.map((t) => <span key={t} className="tag" style={{ fontSize: 8.5 }}>{t}</span>)}
          {extraTags > 0 && <span className="tag" style={{ fontSize: 8.5 }}>+{extraTags}</span>}
        </div>
      </div>
      {hasSubtasks && expanded && task.subtasks!.map((sub) => (
        <Row
          key={sub.id}
          task={sub}
          projectId={projectId}
          depth={depth + 1}
          selectedIds={selectedIds}
          onToggleSelect={onToggleSelect}
          onOpen={onOpen}
          onStatusChange={onStatusChange}
          onAssigneeChange={onAssigneeChange}
          canWrite={canWrite}
          gridTemplateColumns={gridTemplateColumns}
        />
      ))}
    </>
  );
}

// ── Floating bulk-action bar — same visual language as TestCaseLibrary.tsx's
// SelectionBar (fixed, bottom-center, pill-shaped). "Move to"/"Copy to" list
// pick their target from an inline dropdown rather than a separate modal —
// there's nothing to configure beyond which list, so a dropdown is one click
// fewer than a modal for the same result. ──────────────────────────────────
function TaskSelectionBar({ count, otherLists, onMoveTo, onCopyTo, onExport, onClear }: {
  count: number;
  otherLists: TaskList[];
  onMoveTo: (taskListId: string) => void;
  onCopyTo: (taskListId: string) => void;
  onExport: () => void;
  onClear: () => void;
}) {
  const [openDrop, setOpenDrop] = useState<'move' | 'copy' | null>(null);
  const moveRef = useRef<HTMLDivElement>(null);
  const moveMenuRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const copyMenuRef = useRef<HTMLDivElement>(null);
  useClickOutside([moveRef, moveMenuRef], () => setOpenDrop(null), openDrop === 'move');
  useClickOutside([copyRef, copyMenuRef], () => setOpenDrop(null), openDrop === 'copy');

  const dropStyle: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.4)', overflow: 'hidden', maxHeight: 220, overflowY: 'auto' };
  const dropItemStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', fontSize: 11, color: 'var(--text)', cursor: 'pointer' };

  return (
    <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 500, display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.45)', padding: '8px 14px' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: 'var(--text)', paddingRight: 8, borderRight: '1px solid var(--border)' }}>
        {count} selected
      </span>

      <div ref={moveRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setOpenDrop((v) => (v === 'move' ? null : 'move'))}
          disabled={otherLists.length === 0}
          title={otherLists.length === 0 ? 'No other lists in this project' : undefined}
          style={{ padding: '5px 12px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 11, cursor: otherLists.length === 0 ? 'not-allowed' : 'pointer', opacity: otherLists.length === 0 ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: 4 }}
        >
          → Move to ▾
        </button>
        <FloatingPortal anchorRef={moveRef} open={openDrop === 'move'} portalRef={moveMenuRef} width={200}>
          <div style={dropStyle}>
            {otherLists.map((l) => (
              <div key={l.id} onClick={() => { onMoveTo(l.id); setOpenDrop(null); }} style={dropItemStyle}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--surface2)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: l.color, flexShrink: 0 }} />
                {l.name}
              </div>
            ))}
          </div>
        </FloatingPortal>
      </div>

      <div ref={copyRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setOpenDrop((v) => (v === 'copy' ? null : 'copy'))}
          disabled={otherLists.length === 0}
          title={otherLists.length === 0 ? 'No other lists in this project' : undefined}
          style={{ padding: '5px 12px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 11, cursor: otherLists.length === 0 ? 'not-allowed' : 'pointer', opacity: otherLists.length === 0 ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: 4 }}
        >
          ⧉ Copy to ▾
        </button>
        <FloatingPortal anchorRef={copyRef} open={openDrop === 'copy'} portalRef={copyMenuRef} width={200}>
          <div style={dropStyle}>
            {otherLists.map((l) => (
              <div key={l.id} onClick={() => { onCopyTo(l.id); setOpenDrop(null); }} style={dropItemStyle}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--surface2)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: l.color, flexShrink: 0 }} />
                {l.name}
              </div>
            ))}
          </div>
        </FloatingPortal>
      </div>

      <button onClick={onExport} style={{ padding: '5px 12px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
        📤 Export ({count})
      </button>

      <button onClick={onClear} title="Clear selection" style={{ width: 26, height: 26, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-dim)', fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
    </div>
  );
}

export function TaskListView({
  tasks,
  allTasksCount,
  onClearFilters,
  groupByStatus,
  projectId,
  taskListId,
  onOpenTask,
  onStatusChange,
  onAssigneeChange,
  onQuickAdd,
  canWrite,
}: {
  tasks: Task[]; // already filtered by the parent (TaskListDetail)
  allTasksCount: number; // unfiltered count, to tell "empty list" apart from "filtered to zero"
  onClearFilters: () => void;
  groupByStatus: boolean;
  projectId: string;
  taskListId: string;
  onOpenTask: (task: Task) => void;
  onStatusChange: (id: string, status: TaskStatus) => void;
  onAssigneeChange: (id: string, next: AssigneeSelection) => void;
  onQuickAdd: (status?: TaskStatus) => void;
  canWrite: boolean;
}) {
  const { gridTemplateColumns, startResize } = useResizableColumns('task-list', TASK_COLUMNS);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { data: allLists = [] } = useTaskLists(projectId);
  const otherLists = useMemo(() => allLists.filter((l) => l.id !== taskListId), [allLists, taskListId]);
  const bulkMove = useBulkMoveTasks(projectId);
  const bulkCopy = useBulkCopyTasks(projectId);

  // Drop any selected id that's no longer in view (filters changed, or the
  // task moved/was deleted) so a bulk action never silently acts on a stale,
  // invisible selection.
  useEffect(() => {
    setSelectedIds((prev) => {
      const known = new Set(tasks.map((t) => t.id));
      const next = new Set([...prev].filter((id) => known.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [tasks]);

  const roots = useMemo(() => nestSubtasks(tasks), [tasks]);
  const groups = useMemo(
    () => ALL_TASK_STATUSES.map((status) => ({ status, items: roots.filter((t) => t.status === status) })),
    [roots],
  );

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const allIds = tasks.map((t) => t.id);
      return prev.size === allIds.length ? new Set() : new Set(allIds);
    });
  }

  async function handleMoveTo(targetListId: string) {
    const ids = [...selectedIds];
    try {
      const { moved } = await bulkMove.mutateAsync({ taskIds: ids, taskListId: targetListId });
      toast.success(`${moved} task${moved === 1 ? '' : 's'} moved`);
      setSelectedIds(new Set());
    } catch { toast.error('Move failed'); }
  }
  async function handleCopyTo(targetListId: string) {
    const ids = [...selectedIds];
    try {
      const { copied } = await bulkCopy.mutateAsync({ taskIds: ids, taskListId: targetListId });
      toast.success(`${copied} task${copied === 1 ? '' : 's'} copied`);
      setSelectedIds(new Set());
    } catch { toast.error('Copy failed'); }
  }
  async function handleExportSelected() {
    try {
      await exportTasks(projectId, 'selected', { ids: [...selectedIds] });
    } catch { toast.error('Export failed'); }
  }

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* ── Header + rows share one horizontal-scroll region so widening a
          column never desyncs the two — the header itself doesn't scroll
          vertically (that's the nested body div below), just horizontally
          in lockstep with the rows. Columns are user-resizable
          (see useResizableColumns). ── */}
      <div className="col-resize-scroll" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div
          className="tm-row"
          style={{
            gridTemplateColumns, paddingLeft: 14,
            fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.6px',
            textTransform: 'uppercase', color: 'var(--text-dim)', fontWeight: 600,
            background: 'var(--surface2)', flexShrink: 0,
          }}
        >
          {TASK_COLUMNS.map((col) => (
            col.key === 'check' ? (
              <input
                key={col.key}
                type="checkbox"
                checked={tasks.length > 0 && selectedIds.size === tasks.length}
                ref={(el) => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < tasks.length; }}
                onChange={toggleSelectAll}
                title="Select all"
                style={{ cursor: 'pointer' }}
              />
            ) : (
              <div key={col.key} className={col.resizable ? 'col-resizable-th' : undefined}>
                {col.label}
                {col.resizable && <ColResizeHandle onMouseDown={startResize(col.key)} />}
              </div>
            )
          ))}
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {allTasksCount === 0 && (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
            No tasks yet.
          </div>
        )}

        {allTasksCount > 0 && tasks.length === 0 && (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
            No tasks match your filters.
            <div style={{ marginTop: 10 }}>
              <TbBtn variant="ghost" onClick={onClearFilters}>✕ Clear filters</TbBtn>
            </div>
          </div>
        )}

        {tasks.length > 0 && groupByStatus && groups.map(({ status, items }) => (
          <div key={status}>
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
                fontSize: 11.5, fontWeight: 700, color: 'var(--text)',
                background: 'var(--bg)', borderBottom: '1px solid var(--border)',
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_DOT_COLOR[status], flexShrink: 0 }} />
              {STATUS_LABEL[status]}
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-dim)',
                background: 'var(--surface2)', border: '1px solid var(--border)', padding: '1px 7px', borderRadius: 100,
              }}>
                {items.length}
              </span>
            </div>

            {items.map((task) => (
              <Row
                key={task.id}
                task={task}
                projectId={projectId}
                depth={0}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                onOpen={onOpenTask}
                onStatusChange={onStatusChange}
                onAssigneeChange={onAssigneeChange}
                canWrite={canWrite}
                gridTemplateColumns={gridTemplateColumns}
              />
            ))}

            {canWrite && (
              <div className="tm-quick-add" onClick={() => onQuickAdd(status)}>
                <span>＋</span> Add task
              </div>
            )}
          </div>
        ))}

        {tasks.length > 0 && !groupByStatus && (
          <div>
            {roots.map((task) => (
              <Row
                key={task.id}
                task={task}
                projectId={projectId}
                depth={0}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                onOpen={onOpenTask}
                onStatusChange={onStatusChange}
                onAssigneeChange={onAssigneeChange}
                canWrite={canWrite}
                gridTemplateColumns={gridTemplateColumns}
              />
            ))}

            {canWrite && (
              <div className="tm-quick-add" onClick={() => onQuickAdd()}>
                <span>＋</span> Add task
              </div>
            )}
          </div>
        )}
        </div>
      </div>

      {selectedIds.size > 0 && (
        <TaskSelectionBar
          count={selectedIds.size}
          otherLists={otherLists}
          onMoveTo={(id) => void handleMoveTo(id)}
          onCopyTo={(id) => void handleCopyTo(id)}
          onExport={() => void handleExportSelected()}
          onClear={() => setSelectedIds(new Set())}
        />
      )}
    </div>
  );
}
