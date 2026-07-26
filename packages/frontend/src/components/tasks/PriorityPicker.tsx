import { useRef, useState } from 'react';
import { useClickOutside } from '../../hooks/useClickOutside';
import { FloatingPortal } from '../ui/FloatingPortal';
import { ALL_PRIORITIES } from '../../lib/taskMeta';
import { PriorityBadge } from './PriorityBadge';
import type { TaskPriority } from '../../types';

export function PriorityPicker({ value, disabled, onChange }: {
  value: TaskPriority;
  disabled?: boolean;
  onChange: (priority: TaskPriority) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside([rootRef, menuRef], () => setIsOpen(false), isOpen);

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((v) => !v)}
        style={{ background: 'none', border: 'none', padding: 0, cursor: disabled ? 'default' : 'pointer' }}
      >
        <PriorityBadge priority={value} />
      </button>

      <FloatingPortal anchorRef={rootRef} open={isOpen} portalRef={menuRef} width={120}>
        <div
          style={{
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-card)', overflow: 'hidden',
          }}
        >
          {ALL_PRIORITIES.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => { onChange(p); setIsOpen(false); }}
              style={{
                width: '100%', textAlign: 'left', padding: '7px 11px', border: 'none',
                background: p === value ? 'var(--surface2)' : 'transparent',
                cursor: 'pointer', display: 'block',
              }}
            >
              <PriorityBadge priority={p} />
            </button>
          ))}
        </div>
      </FloatingPortal>
    </div>
  );
}
