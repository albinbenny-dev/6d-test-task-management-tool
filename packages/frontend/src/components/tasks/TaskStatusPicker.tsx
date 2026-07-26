import { useRef, useState } from 'react';
import { useClickOutside } from '../../hooks/useClickOutside';
import { FloatingPortal } from '../ui/FloatingPortal';
import { ALL_TASK_STATUSES, STATUS_LABEL, STATUS_DOT_COLOR, isTaskOverdue } from '../../lib/taskMeta';
import type { Task, TaskStatus } from '../../types';

export function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className={`tm-status tm-status-${status}`}>
      <span className="tm-column-dot" style={{ background: STATUS_DOT_COLOR[status], width: 6, height: 6 }} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function OverdueBadge() {
  return <span className="tm-overdue-badge">⏰ Overdue</span>;
}

export function TaskStatusPicker({ task, disabled, onChange }: {
  task: Pick<Task, 'status' | 'dueDate'>;
  disabled?: boolean;
  onChange: (status: TaskStatus) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside([rootRef, menuRef], () => setIsOpen(false), isOpen);
  const overdue = isTaskOverdue(task);

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((v) => !v)}
        style={{ background: 'none', border: 'none', padding: 0, cursor: disabled ? 'default' : 'pointer' }}
      >
        <span className={`tm-status tm-status-${task.status}`}>
          <span className="tm-column-dot" style={{ background: STATUS_DOT_COLOR[task.status], width: 6, height: 6 }} />
          {overdue ? 'Overdue' : STATUS_LABEL[task.status]}
          {!disabled && <span style={{ fontSize: '8px', opacity: 0.6, marginLeft: 2 }}>▾</span>}
        </span>
      </button>

      <FloatingPortal anchorRef={rootRef} open={isOpen} portalRef={menuRef} width={140}>
        <div
          style={{
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-card)', overflow: 'hidden',
          }}
        >
          {ALL_TASK_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => { onChange(s); setIsOpen(false); }}
              style={{
                width: '100%', textAlign: 'left', padding: '7px 11px', border: 'none',
                background: s === task.status ? 'var(--surface2)' : 'transparent',
                color: 'var(--text)', fontSize: '11.5px', fontWeight: 600,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '7px',
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_DOT_COLOR[s], flexShrink: 0 }} />
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </FloatingPortal>
    </div>
  );
}
