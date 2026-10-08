import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, GripVertical, Plus, Trash2 } from 'lucide-react';
import type { TLItem, TLLane } from '../../lib/timeline/types';
import { MILESTONE_MARKERS, TASK_MARKERS } from '../../lib/timeline/types';
import { todayYmd } from '../../lib/timeline/dates';
import type { useTimelineEditor } from '../../hooks/useTimelines';
import { useClickOutside } from '../../hooks/useClickOutside';
import { MarkerIcon } from './MarkerIcon';

type Actions = ReturnType<typeof useTimelineEditor>;

const COLS = '22px 26px minmax(180px,1fr) 62px 92px 128px 128px 62px 120px 30px';
// Narrow container (e.g. Split view): drop the Assigned-to column and tighten the rest so Start/End/% stay visible.
const COLS_COMPACT = '18px 22px minmax(110px,1fr) 52px 66px 118px 118px 50px 26px';
const MARKER_LABEL: Record<string, string> = {
  pill: 'Template bar', bar: 'Square bar', chevron: 'Chevron',
  diamond: 'Diamond', flag: 'Flag', star: 'Star', circle: 'Circle', triangle: 'Triangle',
};
const SWATCHES = ['#2563AB', '#0E9F6E', '#E8501E', '#8B5CF6', '#D97706', '#0891B2', '#DC2626', '#DB2777', '#4B5563', '#111827'];

const cellInput = {
  width: '100%', background: 'transparent', border: '1px solid transparent', borderRadius: 4,
  fontSize: 12.5, padding: '5px 6px', color: 'var(--text)', fontFamily: 'inherit', outline: 'none',
} as const;

function errMsg(err: unknown, fallback: string) {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback;
}

// ── Popover wrapper ─────────────────────────────────────────────────────────
function Popover({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, onClose, open);
  if (!open) return null;
  return (
    <div ref={ref} style={{ position: 'absolute', top: '100%', left: 0, zIndex: 40, marginTop: 4, background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', padding: 10, minWidth: 210 }}>
      {children}
    </div>
  );
}

function ColorPicker({ value, onChange, swatches, autoLabel }: { value: string | null; onChange: (c: string | null) => void; swatches: string[]; autoLabel: string }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-dim)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 }}>Colour</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {[...new Set([...swatches, ...SWATCHES])].slice(0, 14).map((c) => (
          <button key={c} onClick={() => onChange(c)} title={c} style={{ width: 20, height: 20, borderRadius: 4, background: c, cursor: 'pointer', border: value?.toUpperCase() === c.toUpperCase() ? '2px solid var(--text)' : '1px solid var(--border2)', padding: 0 }} />
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="color" value={value ?? '#2563AB'} onChange={(e) => onChange(e.target.value.toUpperCase())} style={{ width: 28, height: 22, padding: 0, border: '1px solid var(--border2)', borderRadius: 4, cursor: 'pointer' }} />
        <button onClick={() => onChange(null)} style={{ background: 'none', border: 'none', color: 'var(--cyan)', cursor: 'pointer', fontSize: 11.5, padding: 0 }}>{autoLabel}</button>
      </div>
    </div>
  );
}

// ── Item row ────────────────────────────────────────────────────────────────
function ItemRow({ item, color, laneSwatches, canEdit, compact, selected, checked, focusMe, dragging, dropTarget, a, onSelect, onCheck, onFocused, onDragStart, onDragEnd, onDragOver, onDrop }: {
  item: TLItem; color: string; laneSwatches: string[]; canEdit: boolean; compact: boolean; selected: boolean; checked: boolean; focusMe: boolean;
  dragging: boolean; dropTarget: boolean; a: Actions;
  onSelect: () => void; onCheck: (v: boolean) => void; onFocused: () => void;
  onDragStart: (e: React.DragEvent, row: HTMLElement | null) => void; onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void; onDrop: (e: React.DragEvent) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState(false);
  const isMs = item.type === 'MILESTONE';

  useEffect(() => {
    if (focusMe && titleRef.current) { titleRef.current.focus(); titleRef.current.select(); onFocused(); }
  }, [focusMe, onFocused]);
  useEffect(() => { if (selected) rowRef.current?.scrollIntoView({ block: 'nearest' }); }, [selected]);

  const save = (data: Parameters<Actions['updateItem']['mutate']>[0]) =>
    a.updateItem.mutate(data, { onError: (e) => toast.error(errMsg(e, 'Could not save the change')) });

  const Plain = ({ children }: { children: React.ReactNode }) => <span style={{ fontSize: 12.5, padding: '5px 6px', display: 'block' }}>{children}</span>;

  return (
    <div
      ref={rowRef}
      onClick={onSelect}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className="tl-row"
      style={{
        display: 'grid', gridTemplateColumns: compact ? COLS_COMPACT : COLS, alignItems: 'center', gap: 4, padding: '2px 6px',
        borderBottom: '1px solid var(--border)', opacity: dragging ? 0.4 : 1,
        background: selected ? 'var(--cyan-dim)' : checked ? 'var(--surface2)' : 'transparent',
        boxShadow: dropTarget ? 'inset 0 2px 0 var(--cyan)' : undefined,
      }}
    >
      <span
        draggable={canEdit}
        onDragStart={(e) => onDragStart(e, rowRef.current)}
        onDragEnd={onDragEnd}
        title={canEdit ? 'Drag to reorder or move to another swimlane' : undefined}
        style={{ cursor: canEdit ? 'grab' : 'default', color: 'var(--text-dim)', display: 'flex', opacity: canEdit ? 1 : 0.3 }}
      ><GripVertical size={14} /></span>
      <input type="checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} onClick={(e) => e.stopPropagation()} />

      {canEdit ? (
        <input
          ref={titleRef} key={`t-${item.title}`} defaultValue={item.title} style={cellInput}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--border2)'; e.currentTarget.style.background = 'var(--surface)'; }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent';
            const v = e.currentTarget.value.trim();
            if (!v) { e.currentTarget.value = item.title; return; }
            if (v !== item.title) save({ id: item.id, title: v });
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        />
      ) : <Plain>{item.title}</Plain>}

      <div style={{ position: 'relative' }}>
        <button
          disabled={!canEdit} onClick={(e) => { e.stopPropagation(); setMenu((m) => !m); }}
          style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: canEdit ? 'pointer' : 'default', padding: '4px 2px', fontSize: 12.5, color: 'var(--text)' }}
        >
          <MarkerIcon type={item.type} marker={item.marker} color={color} />
          <span style={{ fontWeight: 600 }}>{isMs ? 'M' : 'T'}</span>
          {canEdit && <ChevronDown size={11} style={{ color: 'var(--text-dim)' }} />}
        </button>
        <Popover open={menu} onClose={() => setMenu(false)}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-dim)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 }}>Task bar</div>
          {TASK_MARKERS.map((m) => (
            <MarkerOption key={m} active={!isMs && item.marker === m} type="TASK" marker={m} color={color}
              onPick={() => { setMenu(false); save(isMs ? { id: item.id, type: 'TASK', marker: m, durationDays: 5 } : { id: item.id, marker: m }); }} />
          ))}
          <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-dim)', margin: '8px 0 6px', textTransform: 'uppercase', letterSpacing: 0.4 }}>Milestone</div>
          {MILESTONE_MARKERS.map((m) => (
            <MarkerOption key={m} active={isMs && item.marker === m} type="MILESTONE" marker={m} color={color}
              onPick={() => { setMenu(false); save({ id: item.id, type: 'MILESTONE', marker: m }); }} />
          ))}
          <div style={{ borderTop: '1px solid var(--border)', margin: '8px 0', paddingTop: 8 }}>
            <ColorPicker value={item.color} swatches={laneSwatches} autoLabel="Auto (from lane / template)" onChange={(c) => save({ id: item.id, color: c })} />
          </div>
        </Popover>
      </div>

      {/* Duration (working days) — editing it moves End; editing End/Start re-derives it. */}
      {canEdit ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <input
            key={`d-${item.durationDays}-${item.type}`} type="number" min={0} defaultValue={item.durationDays}
            style={{ ...cellInput, textAlign: 'right', padding: '5px 2px' }}
            onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--border2)'; e.currentTarget.style.background = 'var(--surface)'; }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent';
              const n = Math.max(0, Math.round(Number(e.currentTarget.value)));
              if (isNaN(n) || n === item.durationDays) { e.currentTarget.value = String(item.durationDays); return; }
              save(isMs && n > 0 ? { id: item.id, type: 'TASK', durationDays: n } : { id: item.id, durationDays: n });
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          />
          {!compact && <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>days</span>}
        </div>
      ) : <Plain>{item.durationDays}{compact ? '' : ' days'}</Plain>}

      <div onClick={(e) => e.stopPropagation()}>
        {canEdit ? (
          <input type="date" key={`s-${item.startDate}`} defaultValue={item.startDate} style={cellInput}
            onChange={(e) => { if (e.target.value && e.target.value !== item.startDate) save({ id: item.id, startDate: e.target.value }); }} />
        ) : <Plain>{fmt(item.startDate)}</Plain>}
      </div>
      <div onClick={(e) => e.stopPropagation()}>
        {canEdit ? (
          <input type="date" key={`e-${item.endDate}`} defaultValue={item.endDate} disabled={isMs} min={item.startDate}
            style={{ ...cellInput, opacity: isMs ? 0.6 : 1 }}
            onChange={(e) => { if (e.target.value && e.target.value !== item.endDate) save({ id: item.id, endDate: e.target.value }); }} />
        ) : <Plain>{fmt(item.endDate)}</Plain>}
      </div>

      {canEdit ? (
        <input
          key={`p-${item.percentComplete}`} type="number" min={0} max={100} defaultValue={item.percentComplete}
          style={{ ...cellInput, textAlign: 'right' }}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--border2)'; e.currentTarget.style.background = 'var(--surface)'; }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent';
            const n = Math.max(0, Math.min(100, Math.round(Number(e.currentTarget.value))));
            if (isNaN(n) || n === item.percentComplete) { e.currentTarget.value = String(item.percentComplete); return; }
            save({ id: item.id, percentComplete: n });
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        />
      ) : <Plain>{item.percentComplete}%</Plain>}

      {compact ? null : canEdit ? (
        <input
          key={`a-${item.assignee ?? ''}`} defaultValue={item.assignee ?? ''} placeholder="Assign…" style={cellInput}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--border2)'; e.currentTarget.style.background = 'var(--surface)'; }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent';
            const v = e.currentTarget.value.trim();
            if (v !== (item.assignee ?? '')) save({ id: item.id, assignee: v || null });
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        />
      ) : <Plain>{item.assignee ?? ''}</Plain>}

      {canEdit ? (
        <button onClick={(e) => { e.stopPropagation(); a.deleteItems.mutate([item.id]); }} title="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', display: 'flex', padding: 4 }}>
          <Trash2 size={14} />
        </button>
      ) : <span />}
    </div>
  );
}

function fmt(ymd: string) {
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

function MarkerOption({ type, marker, color, active, onPick }: { type: 'TASK' | 'MILESTONE'; marker: string; color: string; active: boolean; onPick: () => void }) {
  return (
    <button onClick={onPick} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: active ? 'var(--cyan-dim)' : 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', borderRadius: 4, fontSize: 12, color: 'var(--text)', textAlign: 'left' }}>
      <span style={{ width: 24, display: 'flex', justifyContent: 'center' }}><MarkerIcon type={type} marker={marker} color={color} /></span>
      {MARKER_LABEL[marker]}
    </button>
  );
}

// ── Grid ────────────────────────────────────────────────────────────────────
export function TimelineGrid({ items, lanes, canEdit, lanePalette, taskColor, milestoneColor, selectedItemId, onSelectItem, actions: a }: {
  items: TLItem[];
  lanes: TLLane[];
  canEdit: boolean;
  /** Template lane colours — a lane with no colour of its own takes these in order. */
  lanePalette: string[];
  taskColor: string;
  milestoneColor: string;
  selectedItemId: string | null;
  onSelectItem: (id: string | null) => void;
  actions: Actions;
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [focusItemId, setFocusItemId] = useState<string | null>(null);
  const [focusLaneId, setFocusLaneId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [colorLane, setColorLane] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setCompact(entry.contentRect.width < 860));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sortedLanes = useMemo(() => [...lanes].sort((x, y) => x.sortOrder - y.sortOrder), [lanes]);
  const laneIds = useMemo(() => new Set(lanes.map((l) => l.id)), [lanes]);
  const byLane = useMemo(() => {
    const m = new Map<string | null, TLItem[]>();
    for (const it of items) {
      const k = it.swimlaneId && laneIds.has(it.swimlaneId) ? it.swimlaneId : null;
      m.set(k, [...(m.get(k) ?? []), it]);
    }
    m.forEach((arr) => arr.sort((x, y) => x.sortOrder - y.sortOrder || x.startDate.localeCompare(y.startDate)));
    return m;
  }, [items, laneIds]);

  const laneColor = (l: TLLane, idx: number) => l.color ?? lanePalette[idx % lanePalette.length] ?? '#2563AB';
  const itemColor = (it: TLItem) => it.color ?? (it.type === 'MILESTONE' ? milestoneColor
    : (() => { const idx = sortedLanes.findIndex((l) => l.id === it.swimlaneId); return idx >= 0 ? laneColor(sortedLanes[idx], idx) : taskColor; })());

  // Drop checked ids that no longer exist (deleted elsewhere / by this grid).
  useEffect(() => { setChecked((c) => new Set([...c].filter((id) => items.some((i) => i.id === id)))); }, [items]);

  async function addItem(laneId: string | null, type: 'TASK' | 'MILESTONE') {
    try {
      const item = await a.createItem.mutateAsync({
        title: type === 'TASK' ? 'New task' : 'New milestone', type, swimlaneId: laneId, startDate: todayYmd(),
        ...(type === 'TASK' ? { durationDays: 5 } : {}),
      });
      setFocusItemId(item.id);
    } catch (e) { toast.error(errMsg(e, 'Could not add the item')); }
  }

  async function addLane() {
    try {
      const lane = await a.createLane.mutateAsync({ name: 'New swimlane' });
      setFocusLaneId(lane.id);
    } catch (e) { toast.error(errMsg(e, 'Could not add the swimlane')); }
  }

  function moveItem(itemId: string, laneId: string | null, beforeId: string | null) {
    const moving = items.find((i) => i.id === itemId);
    if (!moving || itemId === beforeId) return;
    const sourceLane = moving.swimlaneId && laneIds.has(moving.swimlaneId) ? moving.swimlaneId : null;
    const target = (byLane.get(laneId) ?? []).filter((i) => i.id !== itemId);
    const at = beforeId ? Math.max(0, target.findIndex((i) => i.id === beforeId)) : target.length;
    target.splice(at, 0, moving);
    const moves = target.map((it, i) => ({ id: it.id, swimlaneId: laneId, sortOrder: i }));
    if (sourceLane !== laneId) {
      (byLane.get(sourceLane) ?? []).filter((i) => i.id !== itemId).forEach((it, i) => moves.push({ id: it.id, swimlaneId: sourceLane, sortOrder: i }));
    }
    a.reorderItems.mutate(moves, { onError: () => toast.error('Could not reorder') });
  }

  function moveLane(id: string, dir: -1 | 1) {
    const ids = sortedLanes.map((l) => l.id);
    const i = ids.indexOf(id); const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    a.reorderLanes.mutate(ids);
  }

  function deleteLane(l: TLLane) {
    const n = byLane.get(l.id)?.length ?? 0;
    if (n === 0) { a.deleteLane.mutate({ id: l.id, deleteItems: false }); return; }
    const del = window.confirm(`"${l.name}" has ${n} item${n === 1 ? '' : 's'}.\n\nOK = delete the swimlane AND its items\nCancel = keep the items (they move to the top, ungrouped)`);
    a.deleteLane.mutate({ id: l.id, deleteItems: del });
  }

  const dragProps = (laneId: string | null, beforeId: string | null) => ({
    onDragOver: (e: React.DragEvent) => { if (!dragId) return; e.preventDefault(); setOverKey(`${laneId}:${beforeId}`); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); if (dragId) moveItem(dragId, laneId, beforeId); setDragId(null); setOverKey(null); },
  });

  const addRow = (laneId: string | null) => (
    <div {...dragProps(laneId, null)} style={{ display: 'flex', gap: 14, padding: '6px 10px 6px 58px', borderBottom: '1px solid var(--border)', boxShadow: overKey === `${laneId}:null` ? 'inset 0 2px 0 var(--cyan)' : undefined }}>
      {canEdit ? (
        <>
          <button onClick={() => addItem(laneId, 'TASK')} style={addBtn}><Plus size={13} /> Add task</button>
          <button onClick={() => addItem(laneId, 'MILESTONE')} style={addBtn}><Plus size={13} /> Add milestone</button>
        </>
      ) : null}
    </div>
  );

  const renderItems = (laneId: string | null) => (byLane.get(laneId) ?? []).map((it) => (
    <ItemRow
      key={it.id} item={it} color={itemColor(it)} canEdit={canEdit} compact={compact}
      laneSwatches={lanePalette}
      selected={selectedItemId === it.id} checked={checked.has(it.id)} focusMe={focusItemId === it.id}
      dragging={dragId === it.id} dropTarget={overKey === `${laneId}:${it.id}`} a={a}
      onSelect={() => onSelectItem(it.id)}
      onCheck={(v) => setChecked((c) => { const n = new Set(c); if (v) n.add(it.id); else n.delete(it.id); return n; })}
      onFocused={() => setFocusItemId(null)}
      onDragStart={(e, row) => { setDragId(it.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', it.id); if (row) e.dataTransfer.setDragImage(row, 20, 14); }}
      onDragEnd={() => { setDragId(null); setOverKey(null); }}
      onDragOver={dragProps(laneId, it.id).onDragOver} onDrop={dragProps(laneId, it.id).onDrop}
    />
  ));

  const allChecked = items.length > 0 && checked.size === items.length;

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        {canEdit && (
          <button className="tb-btn tb-btn-ghost" onClick={addLane} disabled={a.createLane.isPending} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Plus size={13} /> Add swimlane
          </button>
        )}
        {canEdit && checked.size > 0 && (
          <button
            className="tb-btn tb-btn-ghost" style={{ color: 'var(--rose)', borderColor: 'rgba(220,38,38,0.3)' }}
            onClick={() => { if (window.confirm(`Delete ${checked.size} selected item${checked.size === 1 ? '' : 's'}?`)) { a.deleteItems.mutate([...checked]); setChecked(new Set()); } }}
          >
            <Trash2 size={12} style={{ marginRight: 4, verticalAlign: -1 }} />Delete {checked.size}
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-dim)' }}>
          {items.length} item{items.length === 1 ? '' : 's'} · duration counts working days (Mon–Fri)
        </span>
      </div>

      <div ref={wrapRef} style={{ border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', overflowX: 'auto' }}>
        <div style={{ minWidth: compact ? 560 : 820 }}>
          {/* Header */}
          <div style={{ display: 'grid', gridTemplateColumns: compact ? COLS_COMPACT : COLS, gap: 4, padding: '8px 6px', borderBottom: '1px solid var(--border)', background: 'var(--surface2)', fontSize: 11.5, fontWeight: 700, color: 'var(--text-mid)' }}>
            <span />
            <input type="checkbox" checked={allChecked} onChange={(e) => setChecked(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())} />
            <span style={{ paddingLeft: 6 }}>Title</span><span>Type</span><span>{compact ? 'Days' : 'Duration'}</span><span>Start</span><span>End</span><span style={{ textAlign: 'right', paddingRight: 8 }}>%</span>{!compact && <span>Assigned to</span>}<span />
          </div>

          {/* Ungrouped items sit above the first swimlane */}
          {(byLane.get(null)?.length ?? 0) > 0 || sortedLanes.length === 0 ? (
            <>
              {renderItems(null)}
              {addRow(null)}
            </>
          ) : null}

          {sortedLanes.map((lane, idx) => {
            const color = laneColor(lane, idx);
            const count = byLane.get(lane.id)?.length ?? 0;
            return (
              <div key={lane.id}>
                <div
                  {...dragProps(lane.id, null)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 10px 8px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', boxShadow: overKey === `${lane.id}:null` && count === 0 ? 'inset 0 2px 0 var(--cyan)' : undefined }}
                >
                  <div style={{ position: 'relative' }}>
                    <button
                      disabled={!canEdit} onClick={() => setColorLane(colorLane === lane.id ? null : lane.id)}
                      title={canEdit ? 'Swimlane colour' : undefined}
                      style={{ width: 16, height: 20, borderRadius: 3, background: color, border: 'none', cursor: canEdit ? 'pointer' : 'default', padding: 0, display: 'block' }}
                    />
                    <Popover open={colorLane === lane.id} onClose={() => setColorLane(null)}>
                      <ColorPicker value={lane.color} swatches={lanePalette} autoLabel="Auto (from template)" onChange={(c) => a.updateLane.mutate({ id: lane.id, color: c })} />
                    </Popover>
                  </div>
                  {canEdit ? (
                    <LaneName lane={lane} focusMe={focusLaneId === lane.id} onFocused={() => setFocusLaneId(null)} onRename={(name) => a.updateLane.mutate({ id: lane.id, name })} />
                  ) : <span style={{ fontSize: 15, fontWeight: 700 }}>{lane.name}</span>}
                  <button onClick={() => a.updateLane.mutate({ id: lane.id, collapsed: !lane.collapsed })} title={lane.collapsed ? 'Expand (shows its items on the timeline)' : 'Collapse (hides its items on the timeline)'} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', display: 'flex', padding: 2 }}>
                    {lane.collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                  </button>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{count} item{count === 1 ? '' : 's'}</span>
                  {canEdit && (
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
                      <IconBtn title="Move up" disabled={idx === 0} onClick={() => moveLane(lane.id, -1)}><ArrowUp size={14} /></IconBtn>
                      <IconBtn title="Move down" disabled={idx === sortedLanes.length - 1} onClick={() => moveLane(lane.id, 1)}><ArrowDown size={14} /></IconBtn>
                      <IconBtn title="Delete swimlane" onClick={() => deleteLane(lane)}><Trash2 size={14} /></IconBtn>
                    </span>
                  )}
                </div>
                {renderItems(lane.id)}
                {addRow(lane.id)}
              </div>
            );
          })}

          {items.length === 0 && sortedLanes.length === 0 && (
            <div style={{ padding: '18px 14px', fontSize: 12, color: 'var(--text-dim)' }}>
              {canEdit ? 'Add your first task or milestone, add a swimlane, or use Import to bring in an Excel/CSV plan.' : 'This timeline has no items yet.'}
            </div>
          )}
        </div>
      </div>
      <div style={{ height: 180 }} />
    </div>
  );
}

const addBtn = { display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--cyan)', fontSize: 12.5, padding: '2px 0' } as const;

function IconBtn({ children, title, onClick, disabled }: { children: React.ReactNode; title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} title={title} disabled={disabled} style={{ background: 'none', border: 'none', cursor: disabled ? 'default' : 'pointer', color: 'var(--text-dim)', display: 'flex', padding: 4, opacity: disabled ? 0.35 : 1 }}>
      {children}
    </button>
  );
}

function LaneName({ lane, focusMe, onFocused, onRename }: { lane: TLLane; focusMe: boolean; onFocused: () => void; onRename: (n: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (focusMe && ref.current) { ref.current.focus(); ref.current.select(); onFocused(); } }, [focusMe, onFocused]);
  return (
    <input
      ref={ref} key={`ln-${lane.name}`} defaultValue={lane.name}
      style={{ ...cellInput, fontSize: 15, fontWeight: 700, width: 'auto', minWidth: 120, maxWidth: 320 }}
      size={Math.max(10, lane.name.length + 2)}
      onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--border2)'; e.currentTarget.style.background = 'var(--surface)'; }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent';
        const v = e.currentTarget.value.trim();
        if (!v) { e.currentTarget.value = lane.name; return; }
        if (v !== lane.name) onRename(v);
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
    />
  );
}
