import { useRef, useState } from 'react';
import { useClickOutside } from '../../hooks/useClickOutside';
import { FloatingPortal } from '../ui/FloatingPortal';

// ── Shared filter-dropdown for Test Cycle pages (detail's Test Cases/Bugs
// tabs, list page) — a labeled <select> with an "All" option, so every
// filter row across these pages looks and behaves identically.

export function FilterSelect({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <label style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)' }}>
        {label}
      </label>
      <select
        className="input-field"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ fontSize: '11px', padding: '4px 8px', width: 'auto' }}
      >
        <option value="">All</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    </div>
  );
}

// ── Multi-select variant — a button + checkbox-list popover (via
// FloatingPortal, same primitive StatusPillPicker uses) instead of a native
// <select>, since native <select multiple> is a poor, non-obvious UX (needs
// ctrl/cmd-click, no visible checkboxes). Lets a filter dimension match ANY
// of several values at once (e.g. Status = New OR Retest), combined with
// every other dimension via AND — the Defects dashboard's filter model.

export function MultiSelectFilter({ label, values, onChange, options }: {
  label: string;
  values: string[]; // selected values — empty means "All"
  onChange: (values: string[]) => void;
  options: string[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside([rootRef, menuRef], () => setIsOpen(false), isOpen);

  function toggle(opt: string) {
    onChange(values.includes(opt) ? values.filter((v) => v !== opt) : [...values, opt]);
  }

  const summary = values.length === 0 ? 'All' : values.length === 1 ? values[0] : `${values.length} selected`;

  return (
    <div ref={rootRef} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <label style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)' }}>
        {label}
      </label>
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="input-field"
        style={{
          fontSize: '11px', padding: '4px 8px', width: 'auto', maxWidth: '140px',
          display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
          background: values.length > 0 ? 'var(--surface2)' : undefined,
          color: values.length > 0 ? 'var(--text)' : undefined,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</span>
        <span style={{ fontSize: '8px', opacity: 0.7, flexShrink: 0 }}>▾</span>
      </button>

      <FloatingPortal anchorRef={rootRef} open={isOpen} portalRef={menuRef} width={200}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-card)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>
            <button type="button" onClick={() => onChange([])} style={{ background: 'none', border: 'none', color: 'var(--cyan)', fontSize: '10px', fontWeight: 600, cursor: 'pointer', padding: 0 }}>Clear</button>
            <button type="button" onClick={() => onChange(options)} style={{ background: 'none', border: 'none', color: 'var(--cyan)', fontSize: '10px', fontWeight: 600, cursor: 'pointer', padding: 0 }}>Select all</button>
          </div>
          <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
            {options.length === 0 ? (
              <div style={{ padding: '10px', fontSize: '11px', color: 'var(--text-dim)' }}>No options</div>
            ) : options.map((opt) => (
              <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', fontSize: '11px', color: 'var(--text)', cursor: 'pointer' }}>
                <input type="checkbox" checked={values.includes(opt)} onChange={() => toggle(opt)} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt}</span>
              </label>
            ))}
          </div>
        </div>
      </FloatingPortal>
    </div>
  );
}
