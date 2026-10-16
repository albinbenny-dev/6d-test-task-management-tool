import { useDeferredValue, useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import type { TimelineTemplateDTO, TLItem, TLLane } from '../../lib/timeline/types';
import { layoutTimeline } from '../../lib/timeline/layout';
import type { DateView } from '../../lib/timeline/dateView';
import { pageToSvg } from '../../lib/timeline/svg';
import { resolveConfig } from '../../lib/timeline/config';
import { sampleTimeline } from '../../lib/timeline/sample';

const THUMB_ITEM_CAP = 120;
// These four are shown by default; the rest sit behind "Show all" — fewer thumbnails to draw, and less clutter.
const DEFAULT_KEYS = ['classic-gantt', 'roadmap-dark', 'roadmap-progress', 'clean-minimal'];
const FIRST_TEMPLATES = 4; // fallback count when none of the default templates exist // keep gallery rendering cheap on very large plans

/** One template card whose thumbnail is rendered from the user's own data. */
export function TemplateThumb({ template, items, lanes, title, dateView, selected, onSelect, footer }: {
  template: TimelineTemplateDTO;
  items: TLItem[];
  lanes: TLLane[];
  title: string;
  dateView?: DateView;
  selected?: boolean;
  onSelect?: () => void;
  footer?: React.ReactNode;
}) {
  const svg = useMemo(() => {
    const cfg = resolveConfig(template.config);
    const usable = items.length ? items : sampleTimeline().items;
    const usableLanes = items.length ? lanes : sampleTimeline().lanes;
    const res = layoutTimeline({ title, items: usable.slice(0, THUMB_ITEM_CAP), lanes: usableLanes, config: cfg, dateView: items.length ? dateView : 'BASELINE', showDelays: false });
    return pageToSvg(res.pages[0], cfg.font.family, { responsive: true });
  }, [template.config, items, lanes, title, dateView]);

  return (
    <div
      onClick={onSelect}
      style={{
        cursor: onSelect ? 'pointer' : 'default', borderRadius: 8, padding: 6,
        border: selected ? '2px solid var(--cyan)' : '2px solid var(--border)',
        background: selected ? 'var(--cyan-dim)' : 'var(--surface)', position: 'relative',
      }}
    >
      <div style={{ lineHeight: 0, borderRadius: 4, overflow: 'hidden', border: '1px solid var(--border)' }} dangerouslySetInnerHTML={{ __html: svg }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{template.name}</div>
          <div style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>{template.category}{!template.isActive ? ' · inactive' : ''}</div>
        </div>
        {selected && <Check size={14} style={{ color: 'var(--cyan)' }} />}
      </div>
      {footer}
    </div>
  );
}

export function TemplateGallery({ templates, selectedId, items, lanes, title, dateView, onSelect }: {
  templates: TimelineTemplateDTO[];
  selectedId: string | null;
  items: TLItem[];
  lanes: TLLane[];
  title: string;
  dateView?: DateView;
  onSelect: (id: string) => void;
}) {
  // Urgent updates (a click, a switch) paint first; the thumbnails catch up right after.
  const slowItems = useDeferredValue(items);
  const slowDateView = useDeferredValue(dateView);
  const [showAll, setShowAll] = useState(false);
  if (templates.length === 0) {
    return <div style={{ fontSize: 12, color: 'var(--text-dim)', padding: 12 }}>No templates are available yet.</div>;
  }
  // The chosen template always stays on show, even when it is beyond the first few.
  const defaults = templates.filter((t) => t.builtInKey && DEFAULT_KEYS.includes(t.builtInKey));
  const base = defaults.length > 0 ? defaults : templates.slice(0, FIRST_TEMPLATES);
  const shown = showAll ? templates : templates.filter((t) => base.includes(t) || t.id === selectedId);
  const hidden = templates.length - shown.length;
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10 }}>
        {shown.map((t) => (
          <TemplateThumb key={t.id} template={t} items={slowItems} lanes={lanes} title={title} dateView={slowDateView} selected={t.id === selectedId} onSelect={() => onSelect(t.id)} />
        ))}
      </div>
      {(hidden > 0 || (showAll && templates.length > base.length)) && (
        <button
          onClick={() => setShowAll((v) => !v)}
          style={{ display: 'block', margin: '10px auto 0', background: 'none', border: 'none', color: 'var(--cyan)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
        >
          {showAll ? 'Show fewer templates' : `Show all ${templates.length} templates`}
        </button>
      )}
    </div>
  );
}
