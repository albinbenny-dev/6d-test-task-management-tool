import { useMemo } from 'react';
import { Check } from 'lucide-react';
import type { TimelineTemplateDTO, TLItem, TLLane } from '../../lib/timeline/types';
import { layoutTimeline } from '../../lib/timeline/layout';
import { pageToSvg } from '../../lib/timeline/svg';
import { resolveConfig } from '../../lib/timeline/config';
import { sampleTimeline } from '../../lib/timeline/sample';

const THUMB_ITEM_CAP = 120; // keep gallery rendering cheap on very large plans

/** One template card whose thumbnail is rendered from the user's own data. */
export function TemplateThumb({ template, items, lanes, title, selected, onSelect, footer }: {
  template: TimelineTemplateDTO;
  items: TLItem[];
  lanes: TLLane[];
  title: string;
  selected?: boolean;
  onSelect?: () => void;
  footer?: React.ReactNode;
}) {
  const svg = useMemo(() => {
    const cfg = resolveConfig(template.config);
    const usable = items.length ? items : sampleTimeline().items;
    const usableLanes = items.length ? lanes : sampleTimeline().lanes;
    const res = layoutTimeline({ title, items: usable.slice(0, THUMB_ITEM_CAP), lanes: usableLanes, config: cfg });
    return pageToSvg(res.pages[0], cfg.font.family, { responsive: true });
  }, [template.config, items, lanes, title]);

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

export function TemplateGallery({ templates, selectedId, items, lanes, title, onSelect }: {
  templates: TimelineTemplateDTO[];
  selectedId: string | null;
  items: TLItem[];
  lanes: TLLane[];
  title: string;
  onSelect: (id: string) => void;
}) {
  if (templates.length === 0) {
    return <div style={{ fontSize: 12, color: 'var(--text-dim)', padding: 12 }}>No templates are available yet.</div>;
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10 }}>
      {templates.map((t) => (
        <TemplateThumb key={t.id} template={t} items={items} lanes={lanes} title={title} selected={t.id === selectedId} onSelect={() => onSelect(t.id)} />
      ))}
    </div>
  );
}
