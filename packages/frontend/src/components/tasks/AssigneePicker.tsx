import { useRef, useState } from 'react';
import { useClickOutside } from '../../hooks/useClickOutside';
import { FloatingPortal } from '../ui/FloatingPortal';
import { useProjectMembers } from '../../hooks/useProjects';
import { useRBAC } from '../../hooks/useRBAC';
import { useProjectStore } from '../../stores/projectStore';
import { TaskAvatar, UnassignedAvatar } from './TaskAvatar';

interface AssigneeValue {
  id: string; // ProjectMember.id
  user: { id: string; name: string; email: string };
}

export function AssigneePicker({
  projectId,
  value,
  disabled,
  onChange,
  size = 24,
}: {
  projectId: string;
  value: AssigneeValue | null | undefined;
  disabled?: boolean;
  onChange: (userId: string | null) => void;
  size?: number;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside([rootRef, menuRef], () => setIsOpen(false), isOpen);
  const { data: members = [] } = useProjectMembers(projectId);
  const { isTestUser } = useRBAC();
  const { currentUser } = useProjectStore();

  const filtered = members.filter((m) =>
    !query.trim() || m.user.name.toLowerCase().includes(query.toLowerCase()) || m.user.email.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((v) => !v)}
        title={value ? value.user.name : 'Unassigned'}
        style={{ background: 'none', border: 'none', padding: 0, cursor: disabled ? 'default' : 'pointer', display: 'inline-flex' }}
      >
        {value ? <TaskAvatar name={value.user.name} userId={value.user.id} size={size} /> : <UnassignedAvatar size={size} />}
      </button>

      <FloatingPortal anchorRef={rootRef} open={isOpen} align="end" portalRef={menuRef} width={220}>
        <div
          style={{
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-card)', overflow: 'hidden',
          }}
        >
          <div style={{ padding: '8px' }}>
            <input
              autoFocus
              className="input-field"
              placeholder="Search people…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ fontSize: '11.5px', padding: '6px 9px' }}
            />
          </div>
          <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
            <button
              type="button"
              onClick={() => { onChange(null); setIsOpen(false); }}
              style={{
                width: '100%', textAlign: 'left', padding: '7px 11px', border: 'none',
                background: !value ? 'var(--surface2)' : 'transparent',
                color: 'var(--text-dim)', fontSize: '12px', fontWeight: 500,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px',
              }}
            >
              <UnassignedAvatar size={20} />
              Unassigned
            </button>
            {filtered.map((m) => {
              // TEST_USER may only ever assign to themselves — never a peer.
              const locked = isTestUser && m.userId !== currentUser?.id;
              return (
                <button
                  key={m.userId}
                  type="button"
                  disabled={locked}
                  title={locked ? 'You can only assign tasks to yourself' : undefined}
                  onClick={() => { onChange(m.userId); setIsOpen(false); }}
                  style={{
                    width: '100%', textAlign: 'left', padding: '7px 11px', border: 'none',
                    background: value?.user.id === m.userId ? 'var(--surface2)' : 'transparent',
                    color: locked ? 'var(--text-dim)' : 'var(--text)', fontSize: '12px', fontWeight: 500,
                    cursor: locked ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '8px',
                    opacity: locked ? 0.5 : 1,
                  }}
                >
                  <TaskAvatar name={m.user.name} userId={m.user.id} size={20} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.user.name}</span>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div style={{ padding: '10px 11px', fontSize: '11px', color: 'var(--text-dim)' }}>No members found</div>
            )}
          </div>
        </div>
      </FloatingPortal>
    </div>
  );
}
