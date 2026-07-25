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
