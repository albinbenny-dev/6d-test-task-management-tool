import { useRef, useState } from 'react';
import { useClickOutside } from '../../hooks/useClickOutside';

// ── Reason icon with a click-to-open popover — the `title` attribute alone
// (native hover tooltip) wasn't discoverable/reliable enough, so clicking
// now actually reveals the full reason text in a small floating panel. ─────

export function ReasonPopover({ reason }: { reason: string | null | undefined }) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useClickOutside(rootRef, () => setIsOpen(false), isOpen);

  if (!reason) {
    return <div style={{ textAlign: 'center', color: 'var(--text-dim)' }}>—</div>;
  }

  return (
    <div ref={rootRef} style={{ position: 'relative', textAlign: 'center' }}>
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        title="View reason"
        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', padding: 0, lineHeight: 1 }}
      >
        📝
      </button>
      {isOpen && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 20,
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-card)', padding: '8px 10px', width: '260px', maxHeight: '240px', overflowY: 'auto',
            boxSizing: 'border-box',
            fontSize: '11px', color: 'var(--text)', lineHeight: 1.5, textAlign: 'left',
            // pre-wrap alone preserves newlines but won't break an unbroken
            // token (e.g. a long hash/URL in a pasted reason) — without
            // overflowWrap that content silently pushes the box past its own
            // width and gets clipped by the table's horizontal scroll area.
            whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word',
          }}
        >
          {reason}
        </div>
      )}
    </div>
  );
}
