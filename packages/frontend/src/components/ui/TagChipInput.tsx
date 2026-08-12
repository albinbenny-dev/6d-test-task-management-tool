import { useState } from 'react';

// Reusable chip-input for editing a string[] tag/label field — add via Enter
// or comma, remove via the × on a chip, autocomplete from `suggestions`
// (e.g. every tag already used elsewhere on this project's records, so a
// team converges on a shared vocabulary instead of near-duplicate spellings).
// Mirrors TestCaseLibrary.tsx's EditItemModal label editor, generalized so
// Task tags can use the identical interaction instead of only being
// settable via Excel import.
export function TagChipInput({ tags, onChange, suggestions = [], placeholder = 'Type a tag and press Enter…' }: {
  tags: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
}) {
  const [input, setInput] = useState('');

  function addTag(value: string) {
    const v = value.trim();
    if (!v || tags.includes(v)) { setInput(''); return; }
    onChange([...tags, v]);
    setInput('');
  }
  function removeTag(t: string) {
    onChange(tags.filter((x) => x !== t));
  }

  const matches = suggestions.filter((s) => !tags.includes(s) && (!input || s.toLowerCase().includes(input.toLowerCase())));

  return (
    <div>
      {tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '8px' }}>
          {tags.map((t) => (
            <span key={t} className="tag" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '10px' }}>
              {t}
              <span onClick={() => removeTag(t)} style={{ cursor: 'pointer', color: 'var(--fail)', fontWeight: 700 }}>×</span>
            </span>
          ))}
        </div>
      )}
      <div style={{ position: 'relative' }}>
        <input
          className="input-field"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(input); }
          }}
          placeholder={placeholder}
          style={{ fontSize: '12px' }}
        />
        {input && matches.length > 0 && (
          <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: '6px', boxShadow: '0 8px 24px rgba(0,0,0,0.25)', zIndex: 10, maxHeight: '140px', overflowY: 'auto' }}>
            {matches.slice(0, 8).map((s) => (
              <div
                key={s}
                onClick={() => addTag(s)}
                style={{ padding: '6px 10px', fontSize: '11px', color: 'var(--text)', cursor: 'pointer' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--surface2)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
              >
                {s}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
