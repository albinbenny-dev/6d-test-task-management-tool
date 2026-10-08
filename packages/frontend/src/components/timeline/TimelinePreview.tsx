import { useMemo } from 'react';
import type { LayoutResult } from '../../lib/timeline/types';
import { pageToSvg } from '../../lib/timeline/svg';

// Live preview — renders the layout engine's output as inline SVG. Clicking
// any bar/marker/label reports its item id so the grid can scroll to it.
export function TimelinePreview({ layout, fontFamily, pageIndex, onPageIndex, selectedItemId, onSelectItem }: {
  layout: LayoutResult;
  fontFamily: string;
  pageIndex: number;
  onPageIndex: (i: number) => void;
  selectedItemId?: string | null;
  onSelectItem?: (id: string) => void;
}) {
  const pageCount = layout.pages.length;
  const idx = Math.min(pageIndex, pageCount - 1);
  const svg = useMemo(() => pageToSvg(layout.pages[idx], fontFamily, { responsive: true }), [layout, idx, fontFamily]);
  // cuid ids are alphanumeric; sanitising keeps a hostile id from breaking out of the selector.
  const safeId = selectedItemId ? selectedItemId.replace(/[^A-Za-z0-9_-]/g, '') : '';

  return (
    <div>
      {safeId && (
        <style>{`.tl-preview [data-item-id="${safeId}"]{filter:drop-shadow(0 0 3px #0284C7) drop-shadow(0 0 1px #0284C7)}`}</style>
      )}
      <div
        className="tl-preview"
        onClick={(e) => {
          const el = (e.target as Element).closest('[data-item-id]');
          const id = el?.getAttribute('data-item-id');
          if (id) onSelectItem?.(id);
        }}
        style={{ border: '1px solid var(--border2)', borderRadius: 6, overflow: 'hidden', boxShadow: 'var(--shadow-card)', background: '#fff', lineHeight: 0, cursor: onSelectItem ? 'pointer' : 'default' }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {pageCount > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 8, fontSize: 12 }}>
          <button className="tb-btn tb-btn-ghost" disabled={idx === 0} onClick={() => onPageIndex(idx - 1)}>‹ Prev</button>
          <span style={{ color: 'var(--text-mid)' }}>Slide {idx + 1} of {pageCount}</span>
          <button className="tb-btn tb-btn-ghost" disabled={idx === pageCount - 1} onClick={() => onPageIndex(idx + 1)}>Next ›</button>
        </div>
      )}
      {pageCount > 1 && (
        <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
          This plan is too long for one slide, so it is split across {pageCount} slides (lane headers repeat). The PowerPoint export includes all of them.
        </div>
      )}
    </div>
  );
}
