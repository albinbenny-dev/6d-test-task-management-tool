import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Columns3, LocateFixed } from 'lucide-react';
import type { TLItem, TLLane } from '../../lib/timeline/types';
import { applyDateView, type DateView } from '../../lib/timeline/dateView';
import { DAY_MS, formatGridDate, monthShort, parseYmd, todayYmd } from '../../lib/timeline/dates';
import { useClickOutside } from '../../hooks/useClickOutside';

// ── Gantt view ───────────────────────────────────────────────────────────────
// MS Project style: the data columns are pinned on the left, the bars sit on the right against the same rows, and the
// two scroll up and down together (one scroll area, so they can never drift apart). Read-only — edit rows in Data / Split.

const ROW_H = 26;
const LANE_H = 28;
const HEAD_H = 44;

type Zoom = 'week' | 'month' | 'quarter' | 'fit';
const ZOOM_LABEL: Record<Zoom, string> = { week: 'Week', month: 'Month', quarter: 'Quarter', fit: 'Fit' };
const ZOOM_PPD: Record<Exclude<Zoom, 'fit'>, number> = { week: 14, month: 4.5, quarter: 1.6 };

type ColKey = 'start' | 'end' | 'dur' | 'pct' | 'actStart' | 'actEnd' | 'assignee' | 'delay';
const COLS: { key: ColKey; label: string; w: number }[] = [
  { key: 'start', label: 'Start', w: 80 },
  { key: 'end', label: 'End', w: 80 },
  { key: 'dur', label: 'Days', w: 52 },
  { key: 'pct', label: '%', w: 46 },
  { key: 'actStart', label: 'Actual start', w: 84 },
  { key: 'actEnd', label: 'Actual end', w: 84 },
  { key: 'assignee', label: 'Assignee', w: 110 },
  { key: 'delay', label: 'Delay', w: 56 },
];
const DEFAULT_COLS: ColKey[] = ['start', 'end', 'pct'];
const MIN_TITLE_W = 140;
const DEFAULT_TITLE_W = 220;

interface Prefs { cols: ColKey[]; leftW: number | null; zoom: Zoom }
const loadPrefs = (id: string): Prefs => {
  try {
    const raw = JSON.parse(localStorage.getItem(`tl-gantt-${id}`) ?? 'null') as Partial<Prefs> | null;
    const cols = (raw?.cols ?? DEFAULT_COLS).filter((c): c is ColKey => COLS.some((x) => x.key === c));
    return { cols: cols.length ? cols : DEFAULT_COLS, leftW: typeof raw?.leftW === 'number' ? raw.leftW : null, zoom: raw?.zoom && raw.zoom in ZOOM_LABEL ? raw.zoom : 'month' };
  } catch { return { cols: DEFAULT_COLS, leftW: null, zoom: 'month' }; }
};
const savePrefs = (id: string, p: Prefs) => { try { localStorage.setItem(`tl-gantt-${id}`, JSON.stringify(p)); } catch { /* private mode — preferences just don't stick */ } };

const dayNum = (ymd: string) => Math.floor(parseYmd(ymd).getTime() / DAY_MS);
const dateOf = (n: number) => new Date(n * DAY_MS);

interface Bar { s: number; e: number; bs?: number; be?: number; ghost: boolean }
type Row =
  | { kind: 'lane'; id: string; name: string; count: number; color: string; s?: number; e?: number }
  | { kind: 'item'; item: TLItem; color: string; bar: Bar | null; lane: string };

// ── Time axis ───────────────────────────────────────────────────────────────
interface Seg { x: number; w: number; label: string }
type Unit = 'week' | 'month' | 'quarter' | 'year';

function segments(unit: Unit, rs: number, re: number, ppd: number): Seg[] {
  const out: Seg[] = [];
  const push = (from: number, to: number, label: string) => {
    const f = Math.max(from, rs); const t = Math.min(to, re);
    if (t > f) out.push({ x: (f - rs) * ppd, w: (t - f) * ppd, label });
  };
  if (unit === 'week') {
    const first = dateOf(rs); const toMonday = (8 - first.getUTCDay()) % 7; // days to the next Monday (0 if rs is one)
    for (let d = rs + toMonday; d < re; d += 7) push(d, d + 7, String(dateOf(d).getUTCDate()));
    return out;
  }
  const d0 = dateOf(rs);
  let y = d0.getUTCFullYear(); let m = d0.getUTCMonth();
  if (unit === 'quarter') m -= m % 3;
  if (unit === 'year') m = 0;
  for (;;) {
    const from = Math.floor(Date.UTC(y, m, 1) / DAY_MS);
    if (from >= re) break;
    const step = unit === 'month' ? 1 : unit === 'quarter' ? 3 : 12;
    const to = Math.floor(Date.UTC(y, m + step, 1) / DAY_MS);
    push(from, to, unit === 'month' ? monthShort(m % 12) : unit === 'quarter' ? `Q${Math.floor((m % 12) / 3) + 1}` : String(y));
    m += step; if (m >= 12) { y += Math.floor(m / 12); m %= 12; }
  }
  return out;
}

// ── One row ─────────────────────────────────────────────────────────────────
const cellBase: React.CSSProperties = { flex: 'none', padding: '0 6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 };

function cellText(it: TLItem, k: ColKey): string {
  switch (k) {
    case 'start': return formatGridDate(it.startDate);
    case 'end': return formatGridDate(it.endDate);
    case 'dur': return it.type === 'MILESTONE' ? '—' : `${it.durationDays}d`;
    case 'pct': return `${it.percentComplete}%`;
    case 'actStart': return it.actualStartDate ? formatGridDate(it.actualStartDate) : '—';
    case 'actEnd': return it.actualEndDate ? formatGridDate(it.actualEndDate) : '—';
    case 'assignee': return it.assignee ?? '';
    case 'delay': return it.delayDays == null ? '' : `${it.delayDays > 0 ? '+' : ''}${it.delayDays}d`;
  }
}

const GanttItemRow = memo(function GanttItemRow({ item, color, bar, rs, ppd, chartW, cols, fixedW, selected, showDelays, onSelect }: {
  item: TLItem; color: string; bar: Bar | null; rs: number; ppd: number; chartW: number; cols: ColKey[]; fixedW: number;
  selected: boolean; showDelays: boolean; onSelect: (id: string) => void;
}) {
  const isMs = item.type === 'MILESTONE';
  const pct = Math.max(0, Math.min(100, item.percentComplete));
  const tip = `${item.title}\n${formatGridDate(item.startDate)}${isMs ? '' : ` – ${formatGridDate(item.endDate)}`} · ${pct}%${item.assignee ? ` · ${item.assignee}` : ''}${item.actualStartDate || item.actualEndDate ? `\nActual: ${item.actualStartDate ? formatGridDate(item.actualStartDate) : '—'} – ${item.actualEndDate ? formatGridDate(item.actualEndDate) : 'in progress'}` : ''}`;
  const left = bar ? (bar.s - rs) * ppd : 0;
  const width = bar ? Math.max(3, (bar.e - bar.s + 1) * ppd) : 0;
  const overrun = showDelays && bar && bar.be !== undefined && bar.e > bar.be ? (bar.e - Math.max(bar.be, bar.s - 1)) * ppd : 0;
  return (
    <div onClick={() => onSelect(item.id)} style={{ display: 'flex', height: ROW_H, borderBottom: '1px solid var(--border)', opacity: item.hidden ? 0.5 : 1, cursor: 'pointer' }}>
      <div style={{ position: 'sticky', left: 0, zIndex: 3, display: 'flex', alignItems: 'center', width: 'var(--gl)', flex: 'none', background: selected ? 'var(--cyan-dim)' : 'var(--surface)', borderRight: '1px solid var(--border2)' }}>
        <div title={item.title} style={{ ...cellBase, width: `calc(var(--gl) - ${fixedW}px)`, paddingLeft: 22, color: 'var(--text)' }}>{item.title}</div>
        {cols.map((k) => <div key={k} style={{ ...cellBase, width: COLS.find((c) => c.key === k)!.w, color: 'var(--text-mid)', textAlign: k === 'pct' || k === 'dur' || k === 'delay' ? 'right' : 'left' }}>{cellText(item, k)}</div>)}
      </div>
      <div style={{ position: 'relative', width: chartW, flex: 'none', background: selected ? 'var(--cyan-dim)' : undefined }}>
        {bar && bar.ghost && bar.bs !== undefined && bar.be !== undefined && (
          <div style={{ position: 'absolute', zIndex: 1, top: 5, height: ROW_H - 10, left: (bar.bs - rs) * ppd, width: Math.max(3, (bar.be - bar.bs + 1) * ppd), border: '1px dashed var(--text-dim)', borderRadius: 3 }} />
        )}
        {bar && isMs && (
          <div title={tip} style={{ position: 'absolute', zIndex: 1, top: (ROW_H - 11) / 2, left: left + ppd / 2 - 5.5, width: 11, height: 11, background: color, transform: 'rotate(45deg)', outline: selected ? '2px solid var(--cyan)' : undefined }} />
        )}
        {bar && !isMs && (
          <div title={tip} style={{ position: 'absolute', zIndex: 1, top: 7, height: ROW_H - 14, left, width, borderRadius: 3, overflow: 'hidden', background: `color-mix(in srgb, ${color} 32%, var(--surface))`, outline: selected ? '2px solid var(--cyan)' : undefined }}>
            <div style={{ width: `${pct}%`, height: '100%', background: color }} />
            {overrun > 0 && <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: Math.min(width, overrun), background: '#DC2626' }} />}
          </div>
        )}
      </div>
    </div>
  );
});

// ── The view ────────────────────────────────────────────────────────────────
export function TimelineGantt({ timelineId, visible, items, lanes, dateView, showDelays, lanePalette, ignoreLaneColors, taskColor, milestoneColor, selectedItemId, onSelectItem }: {
  timelineId: string;
  /** False while another view is showing — nothing is measured or scrolled until it is shown. */
  visible: boolean;
  items: TLItem[];
  lanes: TLLane[];
  dateView: DateView;
  showDelays: boolean;
  lanePalette: string[];
  ignoreLaneColors?: boolean;
  taskColor: string;
  milestoneColor: string;
  selectedItemId: string | null;
  onSelectItem: (id: string | null) => void;
}) {
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs(timelineId));
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [colsOpen, setColsOpen] = useState(false);
  const [viewW, setViewW] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const colsBtnRef = useRef<HTMLDivElement>(null);
  useClickOutside(colsBtnRef, () => setColsOpen(false), colsOpen);

  const { cols, zoom } = prefs;
  const fixedW = cols.reduce((n, k) => n + COLS.find((c) => c.key === k)!.w, 0);
  const minLeft = fixedW + MIN_TITLE_W;
  const leftW = Math.max(minLeft, prefs.leftW ?? fixedW + DEFAULT_TITLE_W);
  const update = (p: Partial<Prefs>) => setPrefs((cur) => { const n = { ...cur, ...p }; savePrefs(timelineId, n); return n; });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => { if (e.contentRect.width > 0) setViewW(e.contentRect.width); }); // 0 = hidden: keep the last width
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const today = todayYmd();
  const todayN = dayNum(today);

  // Rows: ungrouped first, then each swimlane in order — the same order as the table.
  const rows = useMemo<Row[]>(() => {
    const shown = new Map(applyDateView(items, dateView, today).map((i) => [i.id, i]));
    const sorted = [...lanes].sort((a, b) => a.sortOrder - b.sortOrder);
    const laneIds = new Set(lanes.map((l) => l.id));
    const groups = new Map<string | null, TLItem[]>();
    for (const it of items) {
      const k = it.swimlaneId && laneIds.has(it.swimlaneId) ? it.swimlaneId : null;
      const arr = groups.get(k); if (arr) arr.push(it); else groups.set(k, [it]);
    }
    groups.forEach((arr) => arr.sort((x, y) => x.sortOrder - y.sortOrder || x.startDate.localeCompare(y.startDate)));
    const laneColour = (l: TLLane, idx: number) => (ignoreLaneColors ? null : l.color) ?? lanePalette[idx % lanePalette.length] ?? taskColor;
    const out: Row[] = [];
    const addItems = (arr: TLItem[], laneId: string, base: string) => {
      for (const it of arr) {
        const t = shown.get(it.id);
        const bar: Bar | null = t ? {
          s: dayNum(t.startDate), e: dayNum(t.endDate), ghost: !!t.showGhost,
          ...(t.baseline ? { bs: dayNum(t.baseline.startDate), be: dayNum(t.baseline.endDate) } : {}),
        } : null;
        out.push({ kind: 'item', item: it, bar, lane: laneId, color: it.color ?? (it.type === 'MILESTONE' ? milestoneColor : base) });
      }
    };
    addItems(groups.get(null) ?? [], '', taskColor);
    sorted.forEach((l, idx) => {
      const arr = groups.get(l.id) ?? [];
      const color = laneColour(l, idx);
      const at = out.length;
      out.push({ kind: 'lane', id: l.id, name: l.name, count: arr.length, color });
      addItems(arr, l.id, color);
      let s = Infinity; let e = -Infinity;
      for (let i = at + 1; i < out.length; i++) { const r = out[i]; if (r.kind === 'item' && r.bar) { s = Math.min(s, r.bar.s); e = Math.max(e, r.bar.e); } }
      if (s <= e) { const lr = out[at] as Extract<Row, { kind: 'lane' }>; lr.s = s; lr.e = e; }
    });
    return out;
  }, [items, lanes, dateView, today, lanePalette, ignoreLaneColors, taskColor, milestoneColor]);

  // Time range: a little before the first date to a little after the last, rounded out to whole months.
  const { rs, re } = useMemo(() => {
    let lo = Infinity; let hi = -Infinity;
    for (const r of rows) {
      if (r.kind !== 'item' || !r.bar) continue;
      lo = Math.min(lo, r.bar.s, r.bar.bs ?? Infinity); hi = Math.max(hi, r.bar.e, r.bar.be ?? -Infinity);
    }
    if (lo > hi) { lo = todayN - 14; hi = todayN + 60; }
    const a = dateOf(lo - 7); const b = dateOf(hi + 14);
    return { rs: Math.floor(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1) / DAY_MS), re: Math.floor(Date.UTC(b.getUTCFullYear(), b.getUTCMonth() + 1, 1) / DAY_MS) };
  }, [rows, todayN]);

  const span = re - rs;
  const ppd = zoom === 'fit' ? Math.max(0.4, Math.min(24, (viewW - leftW - 24) / span)) : ZOOM_PPD[zoom];
  const chartW = Math.ceil(span * ppd);
  const topUnit: Unit = ppd >= 9 ? 'month' : 'year';
  const botUnit: Unit = ppd >= 9 ? 'week' : ppd >= 2.4 ? 'month' : 'quarter';
  const top = useMemo(() => segments(topUnit, rs, re, ppd).map((s) => (topUnit === 'month' ? { ...s, label: `${s.label} ${new Date(rs * DAY_MS + s.x / ppd * DAY_MS).getUTCFullYear()}` } : s)), [topUnit, rs, re, ppd]);
  const bottom = useMemo(() => segments(botUnit, rs, re, ppd), [botUnit, rs, re, ppd]);

  const visibleRows = rows.filter((r) => r.kind === 'lane' || !collapsed.has(r.lane));
  const bodyH = visibleRows.reduce((n, r) => n + (r.kind === 'lane' ? LANE_H : ROW_H), 0);
  const todayX = (todayN - rs) * ppd;
  const laneIds = rows.filter((r) => r.kind === 'lane').map((r) => (r as Extract<Row, { kind: 'lane' }>).id);

  const scrollToToday = () => {
    const el = scrollRef.current; if (!el || todayN < rs || todayN > re) return;
    el.scrollTo({ left: Math.max(0, todayX - (el.clientWidth - leftW) / 2), behavior: 'smooth' });
  };
  // First time the view is shown, bring today into view.
  const centred = useRef(false);
  useEffect(() => {
    if (!visible || centred.current) return;
    const el = scrollRef.current; if (!el || el.clientWidth === 0) return;
    centred.current = true;
    if (todayN >= rs && todayN <= re) el.scrollLeft = Math.max(0, todayX - (el.clientWidth - leftW) / 2);
  }, [visible, rs, re, todayN, todayX, leftW]);

  // Drag the divider: only a CSS variable moves while dragging (so no row re-renders); the width is saved on release.
  const dragRef = useRef<{ x: number; w: number } | null>(null);
  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const box = scrollRef.current; if (!box) return;
    dragRef.current = { x: e.clientX, w: leftW };
    let now = leftW;
    const move = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      now = Math.round(Math.min(Math.max(minLeft, dragRef.current.w + ev.clientX - dragRef.current.x), Math.max(minLeft, box.clientWidth - 160)));
      box.style.setProperty('--gl', `${now}px`);
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); dragRef.current = null; update({ leftW: now }); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const toggleCol = (k: ColKey) => update({ cols: cols.includes(k) ? cols.filter((c) => c !== k) : COLS.map((c) => c.key).filter((c) => c === k || cols.includes(c)) });
  const toggleLane = (id: string) => setCollapsed((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const onSelect = useMemo(() => (id: string) => onSelectItem(id), [onSelectItem]);

  if (items.length === 0) {
    return <div style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'center', padding: 32 }}>Nothing to show yet — add rows in the Data view or use Import.</div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', border: '1px solid var(--border2)', borderRadius: 8, overflow: 'hidden' }}>
          {(Object.keys(ZOOM_LABEL) as Zoom[]).map((z) => (
            <button key={z} onClick={() => update({ zoom: z })} style={{ padding: '5px 12px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', background: zoom === z ? 'var(--cyan)' : 'var(--surface)', color: zoom === z ? '#fff' : 'var(--text-mid)' }}>{ZOOM_LABEL[z]}</button>
          ))}
        </div>
        <div ref={colsBtnRef} style={{ position: 'relative' }}>
          <button className="tb-btn tb-btn-ghost" onClick={() => setColsOpen((v) => !v)} style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Columns3 size={13} /> Columns</button>
          {colsOpen && (
            <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 40, marginTop: 4, background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', padding: 8, minWidth: 170 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.4, margin: '2px 4px 6px' }}>Pinned on the left</div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', padding: '2px 4px 4px' }}>Title (always)</div>
              {COLS.map((c) => (
                <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px', fontSize: 12.5, cursor: 'pointer' }}>
                  <input type="checkbox" checked={cols.includes(c.key)} onChange={() => toggleCol(c.key)} /> {c.label}
                </label>
              ))}
              <button onClick={() => update({ cols: DEFAULT_COLS, leftW: null })} style={{ marginTop: 4, background: 'none', border: 'none', color: 'var(--cyan)', cursor: 'pointer', fontSize: 11.5, padding: '2px 4px' }}>Reset columns</button>
            </div>
          )}
        </div>
        <button className="tb-btn tb-btn-ghost" onClick={scrollToToday} disabled={todayN < rs || todayN > re} style={{ display: 'flex', alignItems: 'center', gap: 5 }}><LocateFixed size={13} /> Today</button>
        <button className="tb-btn tb-btn-ghost" onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(laneIds))}>{collapsed.size ? 'Expand all' : 'Collapse all'}</button>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Read-only — edit rows in the Data view. Drag the divider to resize the table.</span>
      </div>

      <div
        ref={scrollRef}
        style={{ '--gl': `${leftW}px`, overflow: 'auto', height: 'max(360px, calc(100vh - 330px))', border: '1px solid var(--border2)', borderRadius: 8, background: 'var(--surface)', position: 'relative' } as React.CSSProperties}
      >
        <div style={{ width: leftW + chartW, minWidth: '100%', position: 'relative' }}>
          {/* Header */}
          <div style={{ position: 'sticky', top: 0, zIndex: 6, display: 'flex', height: HEAD_H, background: 'var(--surface2)', borderBottom: '1px solid var(--border2)' }}>
            <div style={{ position: 'sticky', left: 0, zIndex: 7, display: 'flex', alignItems: 'flex-end', width: 'var(--gl)', flex: 'none', background: 'var(--surface2)', borderRight: '1px solid var(--border2)', fontSize: 11, fontWeight: 700, color: 'var(--text-dim)' }}>
              <div style={{ ...cellBase, width: `calc(var(--gl) - ${fixedW}px)`, paddingBottom: 5 }}>Task</div>
              {cols.map((k) => <div key={k} style={{ ...cellBase, width: COLS.find((c) => c.key === k)!.w, paddingBottom: 5, fontSize: 11, textAlign: k === 'pct' || k === 'dur' || k === 'delay' ? 'right' : 'left' }}>{COLS.find((c) => c.key === k)!.label}</div>)}
              <div onMouseDown={startDrag} title="Drag to resize" style={{ position: 'absolute', top: 0, bottom: 0, right: -4, width: 8, cursor: 'col-resize', zIndex: 8 }} />
            </div>
            <div style={{ position: 'relative', width: chartW, flex: 'none' }}>
              {top.map((s, i) => <div key={`t${i}`} style={{ position: 'absolute', top: 0, height: HEAD_H / 2, left: s.x, width: s.w, borderLeft: '1px solid var(--border2)', fontSize: 11, fontWeight: 700, color: 'var(--text-mid)', padding: '4px 6px', overflow: 'hidden', whiteSpace: 'nowrap' }}>{s.label}</div>)}
              {bottom.map((s, i) => <div key={`b${i}`} style={{ position: 'absolute', top: HEAD_H / 2, height: HEAD_H / 2, left: s.x, width: s.w, borderLeft: '1px solid var(--border)', borderTop: '1px solid var(--border)', fontSize: 10.5, color: 'var(--text-dim)', padding: '4px 5px', overflow: 'hidden', whiteSpace: 'nowrap' }}>{s.label}</div>)}
              {todayN >= rs && todayN <= re && <div style={{ position: 'absolute', top: HEAD_H - 14, left: todayX - 18, width: 36, textAlign: 'center', background: '#DC2626', color: '#fff', fontSize: 9.5, fontWeight: 700, borderRadius: 3, lineHeight: '13px' }}>Today</div>}
            </div>
          </div>

          {/* Gridlines + today line, drawn once for the whole body */}
          <div style={{ position: 'absolute', zIndex: 0, top: HEAD_H, left: 'var(--gl)', width: chartW, height: bodyH, pointerEvents: 'none' }}>
            {bottom.map((s, i) => i > 0 && <div key={i} style={{ position: 'absolute', top: 0, bottom: 0, left: s.x, borderLeft: '1px solid var(--border)', opacity: 0.7 }} />)}
            {todayN >= rs && todayN <= re && <div style={{ position: 'absolute', zIndex: 2, top: 0, bottom: 0, left: todayX + ppd / 2, borderLeft: '1.5px dashed #DC2626' }} />}
          </div>

          {/* Rows */}
          {visibleRows.map((r) => r.kind === 'lane' ? (
            <div key={`l-${r.id}`} style={{ display: 'flex', height: LANE_H, borderBottom: '1px solid var(--border)' }}>
              <div onClick={() => toggleLane(r.id)} style={{ position: 'sticky', left: 0, zIndex: 3, display: 'flex', alignItems: 'center', gap: 4, width: 'var(--gl)', flex: 'none', padding: '0 6px', background: 'var(--surface2)', borderRight: '1px solid var(--border2)', fontSize: 12, fontWeight: 700, cursor: 'pointer', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                {collapsed.has(r.id) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                <span style={{ width: 8, height: 8, borderRadius: 2, background: r.color, flex: 'none' }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                <span style={{ fontWeight: 400, color: 'var(--text-dim)' }}>({r.count})</span>
              </div>
              <div style={{ position: 'relative', width: chartW, flex: 'none', background: 'var(--surface2)' }}>
                {r.s !== undefined && r.e !== undefined && (
                  <div style={{ position: 'absolute', zIndex: 1, top: 10, height: 7, left: (r.s - rs) * ppd, width: Math.max(4, (r.e - r.s + 1) * ppd), background: r.color, borderRadius: 2, opacity: 0.85 }} />
                )}
              </div>
            </div>
          ) : (
            <GanttItemRow
              key={r.item.id} item={r.item} color={r.color} bar={r.bar} rs={rs} ppd={ppd} chartW={chartW} cols={cols} fixedW={fixedW}
              selected={selectedItemId === r.item.id} showDelays={showDelays} onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
