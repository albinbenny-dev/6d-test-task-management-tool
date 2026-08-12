import { useCallback, useEffect, useRef, useState } from 'react';

// Shared "resizable table columns" primitive. A table defines its columns once
// (key + default px width), gets back a `gridTemplateColumns` string to share
// between its header row and body rows, and a `startResize(key)` mousedown
// handler to wire up a drag handle on each header cell. Widths persist per
// table (keyed by `storageKey`) in localStorage, so a user's chosen widths
// stick across visits. Every column is a hard px width (not `1fr`) so that
// resizing never fights a flexible neighbor — tables that outgrow the
// viewport scroll horizontally instead, same as a spreadsheet.

export interface ResizableColumnDef {
  key: string;
  width: number; // default px width
  min?: number;  // minimum px width (default 40)
  max?: number;  // maximum px width (default 900)
}

const STORAGE_PREFIX = 'colwidths:';

function loadWidths(storageKey: string, columns: ResizableColumnDef[]): Record<string, number> {
  const widths: Record<string, number> = {};
  columns.forEach((c) => { widths[c.key] = c.width; });
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + storageKey);
    if (!raw) return widths;
    const saved = JSON.parse(raw) as Record<string, number>;
    columns.forEach((c) => {
      const v = saved[c.key];
      if (typeof v === 'number' && v > 0) widths[c.key] = v;
    });
  } catch {
    // corrupt/blocked storage — fall back to defaults
  }
  return widths;
}

export function useResizableColumns(storageKey: string, columns: ResizableColumnDef[]) {
  const columnsRef = useRef(columns);
  columnsRef.current = columns;

  const [widths, setWidths] = useState<Record<string, number>>(() => loadWidths(storageKey, columns));
  const widthsRef = useRef(widths);
  widthsRef.current = widths;

  // Backfill defaults for any column that appears later (e.g. conditional columns)
  const columnKey = columns.map((c) => `${c.key}:${c.width}`).join(',');
  useEffect(() => {
    setWidths((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const c of columns) {
        if (typeof next[c.key] !== 'number') { next[c.key] = c.width; changed = true; }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnKey]);

  const dragRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);

  const persist = useCallback((next: Record<string, number>) => {
    try { localStorage.setItem(STORAGE_PREFIX + storageKey, JSON.stringify(next)); } catch { /* quota/blocked — ignore */ }
  }, [storageKey]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const d = dragRef.current;
      if (!d) return;
      const col = columnsRef.current.find((c) => c.key === d.key);
      const min = col?.min ?? 40;
      const max = col?.max ?? 900;
      const next = Math.min(max, Math.max(min, d.startWidth + (e.clientX - d.startX)));
      setWidths((prev) => (prev[d.key] === next ? prev : { ...prev, [d.key]: next }));
    }
    function onUp() {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
      persist(widthsRef.current);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [persist]);

  const startResize = useCallback((key: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { key, startX: e.clientX, startWidth: widthsRef.current[key] ?? 100 };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const resetWidths = useCallback(() => {
    const defaults: Record<string, number> = {};
    columnsRef.current.forEach((c) => { defaults[c.key] = c.width; });
    setWidths(defaults);
    persist(defaults);
  }, [persist]);

  const gridTemplateColumns = columns.map((c) => `${widths[c.key] ?? c.width}px`).join(' ');

  return { widths, gridTemplateColumns, startResize, resetWidths };
}
