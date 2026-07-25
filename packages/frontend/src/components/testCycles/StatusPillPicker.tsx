import { useRef, useState } from 'react';
import { useClickOutside } from '../../hooks/useClickOutside';
import { ALL_MANUAL_STATUSES, STATUS_LABEL, STATUS_PILL_STYLE } from '../../lib/manualStatus';
import type { ManualResultStatus } from '../../types';

// ── Compact single-line status picker — a plain button + positioned menu,
// not a native <select>. A native <select> styled this small (~30px, pill
// border-radius) was tried first, but on Windows/Chromium it silently falls
// back to painting its own caret regardless of appearance:none.
//
// Fixed width (not fit-content) so every pill lines up regardless of label
// length ("Pass" vs "In Progress") — sized to the longest label ("In
// Progress") plus the caret. ────────────────────────────────────────────────

const PILL_WIDTH = '104px';

export function StatusPillPicker({ value, disabled, onChange }: {
  value: ManualResultStatus;
  disabled?: boolean;
  onChange: (status: ManualResultStatus) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const style = STATUS_PILL_STYLE[value];

  useClickOutside(rootRef, () => setIsOpen(false), isOpen);

  return (
    <div ref={rootRef} style={{ position: 'relative', width: PILL_WIDTH }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((v) => !v)}
        style={{
          width: PILL_WIDTH, height: '24px', boxSizing: 'border-box',
          padding: '3px 8px', borderRadius: '100px',
          border: `1px solid ${style.borderColor}`, background: style.background, color: style.color,
          fontSize: '10px', fontWeight: 700, fontFamily: 'var(--font-mono)', letterSpacing: '0.3px',
          cursor: disabled ? 'default' : 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: '5px', whiteSpace: 'nowrap',
        }}
      >
        <span>{STATUS_LABEL[value]}</span>
        {!disabled && <span style={{ fontSize: '8px', opacity: 0.7 }}>▾</span>}
      </button>

      {isOpen && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 20,
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-card)', minWidth: '130px', overflow: 'hidden',
          }}
        >
          {ALL_MANUAL_STATUSES.map((s) => {
            const optionStyle = STATUS_PILL_STYLE[s];
            return (
              <button
                key={s}
                type="button"
                onClick={() => { onChange(s); setIsOpen(false); }}
                style={{
                  width: '100%', textAlign: 'left', padding: '6px 10px', border: 'none',
                  background: s === value ? 'var(--surface2)' : 'transparent',
                  color: optionStyle.color, fontSize: '11px', fontWeight: 600, fontFamily: 'var(--font-mono)',
                  cursor: 'pointer', display: 'block',
                }}
              >
                {STATUS_LABEL[s]}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
