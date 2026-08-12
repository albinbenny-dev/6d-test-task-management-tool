import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import Topbar, { TbBtn } from '../components/layout/Topbar';
import { useProject } from '../hooks/useProjects';
import { useRBAC } from '../hooks/useRBAC';
import {
  useTcItems,
  useImportTcItems,
  useUpdateTcItem,
  useDeleteTcItem,
  useBulkDeleteTcItems,
  useBulkMoveTcItems,
  useBulkAddLabelToTcItems,
  parseTcItemLabels,
  exportTcItems,
  type TcItem,
  type ImportResult,
} from '../hooks/useTcItems';
import { api } from '../lib/api';
import { groupColor, colorToRgba } from '../lib/featureGroupTheme';
import { useTestCycles, useCreateTestCycle, useAddTestCycleItems } from '../hooks/useTestCycles';
import { useClickOutside } from '../hooks/useClickOutside';
import { FloatingPortal } from '../components/ui/FloatingPortal';
import { useResizableColumns, type ResizableColumnDef } from '../hooks/useResizableColumns';
import { ColResizeHandle } from '../components/ui/ColResizeHandle';
import type { TestCycle } from '../types';

// Columns shared between the header row and every feature group's data rows —
// user-resizable and persisted (see useResizableColumns). The checkbox column
// is fixed-width and not resizable.
const TC_COLUMNS: (ResizableColumnDef & { label: string; resizable: boolean })[] = [
  { key: 'check', label: '', width: 28, min: 28, max: 28, resizable: false },
  { key: 'id', label: 'TC ID', width: 100, min: 70, resizable: true },
  { key: 'title', label: 'Test Case', width: 190, min: 120, resizable: true },
  { key: 'description', label: 'Description', width: 320, min: 150, resizable: true },
  { key: 'labels', label: 'Labels', width: 150, min: 90, resizable: true },
  { key: 'actions', label: 'Actions', width: 70, min: 60, max: 140, resizable: false },
];

function naturalCompare(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

// ── Feature group ───────────────────────────────────────────────────────────
function FeatureGroup({
  feature, color, items, isOpen, onOpenChange,
  selectedIds, onToggle, onToggleAll,
  onEdit, onDelete, gridTemplateColumns, startResize,
}: {
  feature: string; color: string; items: TcItem[]; isOpen: boolean; onOpenChange: (open: boolean) => void;
  selectedIds: Set<string>; onToggle: (id: string) => void; onToggleAll: (ids: string[]) => void;
  onEdit?: (item: TcItem) => void; onDelete?: (item: TcItem) => void;
  gridTemplateColumns: string; startResize: (key: string) => (e: React.MouseEvent) => void;
}) {
  const ids = items.map((i) => i.id);
  const selectedCount = ids.filter((id) => selectedIds.has(id)).length;
  const allSelected = ids.length > 0 && selectedCount === ids.length;

  return (
    <div style={{ background: 'var(--surface)', border: `1px solid ${colorToRgba(color, 0.25)}`, borderRadius: 'var(--radius-lg)', overflow: 'hidden', boxShadow: 'var(--shadow-card)' }}>
      {/* Group header */}
      <div
        onClick={() => onOpenChange(!isOpen)}
        style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', background: `linear-gradient(90deg, ${colorToRgba(color, 0.07)}, transparent)`, borderBottom: isOpen ? `1px solid ${colorToRgba(color, 0.2)}` : 'none', cursor: 'pointer', userSelect: 'none' }}
      >
        <div
          className={`tc-checkbox${allSelected ? ' checked' : selectedCount > 0 ? ' indeterminate' : ''}`}
          style={{ fontSize: '10px', flexShrink: 0 }}
          onClick={(e) => { e.stopPropagation(); onToggleAll(ids); }}
        >
          {allSelected ? '✓' : selectedCount > 0 ? '–' : ''}
        </div>
        <span style={{ fontSize: '11px', color: 'var(--text-dim)', minWidth: '10px', transition: 'transform 0.15s', display: 'inline-block', transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}>▼</span>
        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: `var(${color})`, flexShrink: 0 }} />
        <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)', flex: 1 }}>{feature}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{items.length} TCs</span>
      </div>

      {/* Table */}
      {isOpen && items.length > 0 && (
        <div className="col-resize-scroll">
          <div style={{ display: 'grid', gridTemplateColumns, gap: '8px', padding: '6px 14px', background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
            {TC_COLUMNS.map((col) => (
              <div key={col.key} className={col.resizable ? 'col-resizable-th' : undefined} style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--text-dim)', letterSpacing: '1px', fontWeight: 700 }}>
                {col.label}
                {col.resizable && <ColResizeHandle onMouseDown={startResize(col.key)} />}
              </div>
            ))}
          </div>
          {items.map((item) => (
            <TcItemRow key={item.id} item={item} selected={selectedIds.has(item.id)} onToggle={onToggle} onEdit={onEdit} onDelete={onDelete} gridTemplateColumns={gridTemplateColumns} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Label filter (multiselect + AND/OR) ─────────────────────────────────────
function LabelFilterDropdown({ allLabels, selected, mode, onChange, onModeChange }: {
  allLabels: string[]; selected: string[]; mode: 'AND' | 'OR';
  onChange: (labels: string[]) => void; onModeChange: (mode: 'AND' | 'OR') => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside([ref, menuRef], () => setOpen(false), open);

  function toggle(l: string) {
    onChange(selected.includes(l) ? selected.filter((x) => x !== l) : [...selected, l]);
  }

  const label = selected.length === 0 ? '🏷 All labels' : `🏷 ${selected.length} label${selected.length === 1 ? '' : 's'}${selected.length > 1 ? ` (${mode})` : ''}`;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="input-field"
        title="Filter by label"
        style={{ fontSize: '11px', padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap', background: selected.length ? 'var(--cyan-dim)' : undefined, borderColor: selected.length ? 'rgba(2,132,199,0.35)' : undefined, color: selected.length ? 'var(--cyan)' : 'var(--text)' }}
      >
        {label} ▾
      </button>
      <FloatingPortal anchorRef={ref} open={open} portalRef={menuRef} width={230}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.4)', overflow: 'hidden' }}>
          {selected.length > 1 && (
            <div style={{ display: 'flex', gap: '4px', padding: '8px', borderBottom: '1px solid var(--border)' }}>
              {(['OR', 'AND'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => onModeChange(m)}
                  title={m === 'OR' ? 'Show test cases with at least one of the selected labels' : 'Show test cases with all of the selected labels'}
                  style={{ flex: 1, padding: '5px 0', fontSize: '10px', fontWeight: 700, borderRadius: '5px', border: `1px solid ${mode === m ? 'rgba(2,132,199,0.4)' : 'var(--border)'}`, background: mode === m ? 'var(--cyan-dim)' : 'var(--surface2)', color: mode === m ? 'var(--cyan)' : 'var(--text-dim)', cursor: 'pointer' }}
                >
                  Match {m === 'OR' ? 'ANY' : 'ALL'}
                </button>
              ))}
            </div>
          )}
          <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
            {allLabels.map((l) => {
              const checked = selected.includes(l);
              return (
                <div
                  key={l}
                  onClick={() => toggle(l)}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', fontSize: '11px', color: 'var(--text)', cursor: 'pointer' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--surface2)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                >
                  <div className={`tc-checkbox${checked ? ' checked' : ''}`} style={{ fontSize: '9px', flexShrink: 0 }}>{checked ? '✓' : ''}</div>
                  <span style={{ flex: 1 }}>{l}</span>
                </div>
              );
            })}
          </div>
          {selected.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', padding: '6px 8px' }}>
              <button onClick={() => onChange([])} style={{ width: '100%', padding: '5px 0', fontSize: '10px', color: 'var(--text-dim)', background: 'none', border: 'none', cursor: 'pointer' }}>Clear all</button>
            </div>
          )}
        </div>
      </FloatingPortal>
    </div>
  );
}

// ── TC Item row ────────────────────────────────────────────────────────────
function TcItemRow({ item, selected, onToggle, onEdit, onDelete, gridTemplateColumns }: {
  item: TcItem; selected: boolean;
  onToggle: (id: string) => void; onEdit?: (item: TcItem) => void;
  onDelete?: (item: TcItem) => void;
  gridTemplateColumns: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = !!(item.steps || item.expectedResult || item.description);

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      {/* Main row */}
      <div style={{ display: 'grid', gridTemplateColumns, gap: '8px', padding: '8px 14px', alignItems: 'center', background: selected ? 'var(--cyan-dim)' : 'transparent', borderLeft: selected ? '2px solid var(--cyan)' : '2px solid transparent', transition: 'background 0.15s' }}>
        <div className={`tc-checkbox${selected ? ' checked' : ''}`} style={{ fontSize: '10px', flexShrink: 0 }} onClick={() => onToggle(item.id)}>
          {selected ? '✓' : ''}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0 }}>
          <button
            title={expanded ? 'Collapse detail' : hasDetail ? 'Expand steps & expected result' : 'No detail available'}
            onClick={() => hasDetail && setExpanded((v) => !v)}
            style={{ width: '16px', height: '16px', borderRadius: '3px', background: expanded ? 'var(--cyan-dim)' : 'var(--surface2)', border: `1px solid ${expanded ? 'rgba(2,132,199,0.35)' : 'var(--border)'}`, color: expanded ? 'var(--cyan)' : hasDetail ? 'var(--text)' : 'var(--border)', fontSize: '8px', cursor: hasDetail ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s', lineHeight: 1 }}
          >{expanded ? '▲' : '▼'}</button>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--cyan)', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.srNo ?? '—'}</span>
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.title}>{item.title}</div>
        </div>

        <div style={{ fontSize: '10px', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.description ?? ''}>
          {item.description ?? '—'}
        </div>

        <div style={{ display: 'flex', gap: '3px', flexWrap: 'nowrap', overflow: 'hidden' }}>
          {(() => {
            const labels = parseTcItemLabels(item.labels);
            const shown = labels.slice(0, 2);
            const extra = labels.length - shown.length;
            return (
              <>
                {shown.map((l) => <span key={l} className="tag" style={{ fontSize: '8.5px' }}>{l}</span>)}
                {extra > 0 && <span className="tag" style={{ fontSize: '8.5px' }}>+{extra}</span>}
              </>
            );
          })()}
        </div>

        <div style={{ display: 'flex', gap: '3px', justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
          {/* Edit — amber */}
          {onEdit && (
            <button
              title="Edit test case"
              onClick={() => onEdit(item)}
              style={{ width: '24px', height: '24px', borderRadius: '4px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(245,158,11,0.2)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(245,158,11,0.5)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(245,158,11,0.1)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(245,158,11,0.3)'; }}
            >✏</button>
          )}

          {/* Delete — red; TEST_USER/STANDARD_USER may not delete test cases */}
          {onDelete && (
            <button
              title="Delete"
              onClick={() => onDelete(item)}
              style={{ width: '24px', height: '24px', borderRadius: '4px', background: 'rgba(225,29,72,0.1)', border: '1px solid rgba(225,29,72,0.3)', color: '#ef4444', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s', lineHeight: 1 }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(225,29,72,0.2)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(225,29,72,0.5)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(225,29,72,0.1)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(225,29,72,0.3)'; }}
            >✕</button>
          )}
        </div>
      </div>

      {/* Expanded detail panel */}
      {expanded && (
        <div style={{ padding: '10px 14px 12px 46px', background: 'var(--surface2)', borderLeft: '2px solid rgba(2,132,199,0.2)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {item.description && (
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '3px' }}>Description</div>
              <div style={{ fontSize: '11px', color: 'var(--text)', lineHeight: 1.5 }}>{item.description}</div>
            </div>
          )}
          {item.steps && (
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '3px' }}>Steps</div>
              <pre style={{ margin: 0, fontSize: '11px', color: 'var(--text)', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{item.steps}</pre>
            </div>
          )}
          {item.expectedResult && (
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '3px' }}>Expected Result</div>
              <div style={{ fontSize: '11px', color: 'var(--emerald)', lineHeight: 1.5 }}>{item.expectedResult}</div>
            </div>
          )}
          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '6px', paddingTop: '4px', borderTop: '1px solid var(--border)' }}>
            {onEdit && (
              <button
                onClick={() => { setExpanded(false); onEdit(item); }}
                style={{ padding: '5px 14px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: '5px', color: '#f59e0b', fontSize: '11px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', transition: 'all 0.15s' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(245,158,11,0.2)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(245,158,11,0.55)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(245,158,11,0.1)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(245,158,11,0.35)'; }}
              >✏ Edit</button>
            )}
            {onDelete && (
              <button
                onClick={() => { setExpanded(false); onDelete(item); }}
                style={{ padding: '5px 14px', background: 'rgba(225,29,72,0.1)', border: '1px solid rgba(225,29,72,0.3)', borderRadius: '5px', color: '#ef4444', fontSize: '11px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', transition: 'all 0.15s' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(225,29,72,0.2)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(225,29,72,0.5)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(225,29,72,0.1)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(225,29,72,0.3)'; }}
              >✕ Delete</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Add-to-cycle modal — pick an existing test cycle, or create a new one,
// carrying the current selection into it. Reuses the same create/add-items
// hooks the Test Cycles pages use, so a cycle built this way behaves
// identically to one built there. ──────────────────────────────────────────

const CYCLE_STATUS_BADGE: Record<TestCycle['status'], string> = {
  PLANNING: 'badge-draft',
  ACTIVE:   'badge-run',
  CLOSED:   'badge-pass',
};

function AddToCycleModal({ projectId, slug, selectedIds, onClose, onSuccess }: {
  projectId: string;
  slug: string;
  selectedIds: string[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const navigate = useNavigate();
  const { data: cycles = [], isLoading } = useTestCycles(projectId);
  const createCycle = useCreateTestCycle(projectId);
  const addItems = useAddTestCycleItems(projectId);

  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [selectedCycleId, setSelectedCycleId] = useState('');
  const [newName, setNewName] = useState('');
  const isSaving = createCycle.isPending || addItems.isPending;

  useEffect(() => {
    if (!isLoading && cycles.length === 0) setMode('new');
  }, [isLoading, cycles.length]);

  async function handleSubmit() {
    if (mode === 'existing') {
      if (!selectedCycleId) { toast.error('Select a cycle'); return; }
      try {
        const result = await addItems.mutateAsync({ cycleId: selectedCycleId, testCaseIds: selectedIds });
        toast.success(`${result.added} test case${result.added === 1 ? '' : 's'} added to cycle`);
        onSuccess();
      } catch (err: unknown) {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to add to cycle';
        toast.error(msg);
      }
    } else {
      if (!newName.trim()) { toast.error('Cycle name is required'); return; }
      try {
        const cycle = await createCycle.mutateAsync({ name: newName.trim(), testCaseIds: selectedIds });
        toast.success(`"${cycle.name}" created with ${selectedIds.length} test case${selectedIds.length === 1 ? '' : 's'}`);
        onSuccess();
        navigate(`/projects/${slug}/test-cycles/${cycle.id}`);
      } catch (err: unknown) {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to create cycle';
        toast.error(msg);
      }
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: '12px', width: '100%', maxWidth: '440px', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: '14px' }}>🧪</span>
          <div style={{ flex: 1, fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>
            Add {selectedIds.length} Test Case{selectedIds.length === 1 ? '' : 's'} to Cycle
          </div>
          <button onClick={onClose} style={{ width: '28px', height: '28px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-dim)', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        <div style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setMode('existing')}
              style={{ flex: 1, padding: '8px', borderRadius: '6px', border: `1px solid ${mode === 'existing' ? 'var(--cyan)' : 'var(--border)'}`, background: mode === 'existing' ? 'var(--cyan-dim)' : 'var(--surface2)', color: mode === 'existing' ? 'var(--cyan)' : 'var(--text)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
            >
              Existing Cycle
            </button>
            <button
              onClick={() => setMode('new')}
              style={{ flex: 1, padding: '8px', borderRadius: '6px', border: `1px solid ${mode === 'new' ? 'var(--cyan)' : 'var(--border)'}`, background: mode === 'new' ? 'var(--cyan-dim)' : 'var(--surface2)', color: mode === 'new' ? 'var(--cyan)' : 'var(--text)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
            >
              New Cycle
            </button>
          </div>

          {mode === 'existing' ? (
            isLoading ? (
              <div style={{ fontSize: '12px', color: 'var(--text-dim)', textAlign: 'center', padding: '12px' }}>Loading cycles…</div>
            ) : cycles.length === 0 ? (
              <div style={{ fontSize: '12px', color: 'var(--text-dim)', textAlign: 'center', padding: '12px' }}>No test cycles yet — create one instead.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '240px', overflowY: 'auto' }}>
                {cycles.map((c) => (
                  <label
                    key={c.id}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', borderRadius: '6px', border: `1px solid ${selectedCycleId === c.id ? 'var(--cyan)' : 'var(--border)'}`, background: selectedCycleId === c.id ? 'var(--cyan-dim)' : 'transparent', cursor: 'pointer' }}
                  >
                    <input type="radio" name="cycle" checked={selectedCycleId === c.id} onChange={() => setSelectedCycleId(c.id)} />
                    <span style={{ flex: 1, fontSize: '12px', color: 'var(--text)' }}>{c.name}</span>
                    <span className={`badge ${CYCLE_STATUS_BADGE[c.status]}`}>{c.status}</span>
                  </label>
                ))}
              </div>
            )
          ) : (
            <div>
              <div style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', marginBottom: '4px' }}>
                Cycle Name
              </div>
              <input
                autoFocus
                className="input-field"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Release 4.2 Regression"
                onKeyDown={(e) => { if (e.key === 'Enter') void handleSubmit(); }}
              />
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', padding: '12px 18px', borderTop: '1px solid var(--border)' }}>
          <button onClick={onClose} style={{ padding: '7px 16px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-dim)', fontSize: '12px', cursor: 'pointer' }}>Cancel</button>
          <button
            onClick={() => void handleSubmit()}
            disabled={isSaving}
            style={{ padding: '7px 20px', background: 'var(--cyan-dim)', border: '1px solid rgba(2,132,199,0.35)', borderRadius: '6px', color: 'var(--cyan)', fontSize: '12px', fontWeight: 700, cursor: isSaving ? 'not-allowed' : 'pointer', opacity: isSaving ? 0.5 : 1 }}
          >
            {isSaving ? 'Saving…' : mode === 'existing' ? 'Add to Cycle' : 'Create & Add'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Selection action bar ───────────────────────────────────────────────────
function SelectionBar({ count, allFeatures, allLabels, onClear, onBulkDelete, onMoveToFeature, onAddLabel, onExportSelected, onAddToCycle }: {
  count: number;
  allFeatures: string[];
  allLabels: string[];
  onClear: () => void;
  onBulkDelete?: () => void;
  onMoveToFeature?: (feature: string) => void;
  onAddLabel?: (label: string) => void;
  onExportSelected?: () => void;
  onAddToCycle?: () => void;
}) {
  const [showMoveDrop, setShowMoveDrop] = useState(false);
  const [customFeature, setCustomFeature] = useState('');
  const [showLabelDrop, setShowLabelDrop] = useState(false);
  const [customLabel, setCustomLabel] = useState('');
  const moveRef = useRef<HTMLDivElement>(null);
  const moveMenuRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const labelMenuRef = useRef<HTMLDivElement>(null);
  useClickOutside([moveRef, moveMenuRef], () => setShowMoveDrop(false), showMoveDrop);
  useClickOutside([labelRef, labelMenuRef], () => setShowLabelDrop(false), showLabelDrop);

  return (
    <div style={{ position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)', zIndex: 500, display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: '10px', boxShadow: '0 8px 32px rgba(0,0,0,0.45)', padding: '8px 14px' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 700, color: 'var(--text)', paddingRight: '8px', borderRight: '1px solid var(--border)' }}>
        {count} selected
      </span>

      {/* 📁 Move to Feature */}
      {onMoveToFeature && (
        <div ref={moveRef} style={{ position: 'relative' }}>
          <button onClick={() => setShowMoveDrop((v) => !v)} style={{ padding: '5px 12px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
            📁 Move to Feature ▾
          </button>
          <FloatingPortal anchorRef={moveRef} open={showMoveDrop} portalRef={moveMenuRef} width={230}>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.4)', overflow: 'hidden' }}>
              <div style={{ padding: '8px' }}>
                <input autoFocus value={customFeature} onChange={(e) => setCustomFeature(e.target.value)} placeholder="Type or choose a feature…" style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text)', fontSize: '11px', padding: '6px 8px', outline: 'none', boxSizing: 'border-box' }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && customFeature.trim()) { onMoveToFeature(customFeature.trim()); setShowMoveDrop(false); setCustomFeature(''); } if (e.key === 'Escape') setShowMoveDrop(false); }} />
              </div>
              <div style={{ borderTop: '1px solid var(--border)', maxHeight: '180px', overflowY: 'auto' }}>
                {allFeatures.filter((f) => !customFeature || f.toLowerCase().includes(customFeature.toLowerCase())).map((f) => (
                  <div key={f} onClick={() => { onMoveToFeature(f); setShowMoveDrop(false); setCustomFeature(''); }} style={{ padding: '8px 12px', fontSize: '11px', color: 'var(--text)', cursor: 'pointer' }} onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--surface2)'; }} onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}>{f}</div>
                ))}
                {customFeature.trim() && !allFeatures.some((f) => f.toLowerCase() === customFeature.trim().toLowerCase()) && (
                  <div onClick={() => { onMoveToFeature(customFeature.trim()); setShowMoveDrop(false); setCustomFeature(''); }} style={{ padding: '8px 12px', fontSize: '11px', color: 'var(--cyan)', cursor: 'pointer', borderTop: '1px solid var(--border)', fontStyle: 'italic' }} onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--cyan-dim)'; }} onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}>
                    + Create "{customFeature.trim()}"
                  </div>
                )}
              </div>
            </div>
          </FloatingPortal>
        </div>
      )}

      {/* 🏷 Add Label */}
      {onAddLabel && (
        <div ref={labelRef} style={{ position: 'relative' }}>
          <button onClick={() => setShowLabelDrop((v) => !v)} style={{ padding: '5px 12px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
            🏷 Add Label ▾
          </button>
          <FloatingPortal anchorRef={labelRef} open={showLabelDrop} portalRef={labelMenuRef} width={230}>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.4)', overflow: 'hidden' }}>
              <div style={{ padding: '8px' }}>
                <input autoFocus value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} placeholder="Type or choose a label…" style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text)', fontSize: '11px', padding: '6px 8px', outline: 'none', boxSizing: 'border-box' }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && customLabel.trim()) { onAddLabel(customLabel.trim()); setShowLabelDrop(false); setCustomLabel(''); } if (e.key === 'Escape') setShowLabelDrop(false); }} />
              </div>
              <div style={{ borderTop: '1px solid var(--border)', maxHeight: '180px', overflowY: 'auto' }}>
                {allLabels.filter((l) => !customLabel || l.toLowerCase().includes(customLabel.toLowerCase())).map((l) => (
                  <div key={l} onClick={() => { onAddLabel(l); setShowLabelDrop(false); setCustomLabel(''); }} style={{ padding: '8px 12px', fontSize: '11px', color: 'var(--text)', cursor: 'pointer' }} onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--surface2)'; }} onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}>{l}</div>
                ))}
                {customLabel.trim() && !allLabels.some((l) => l.toLowerCase() === customLabel.trim().toLowerCase()) && (
                  <div onClick={() => { onAddLabel(customLabel.trim()); setShowLabelDrop(false); setCustomLabel(''); }} style={{ padding: '8px 12px', fontSize: '11px', color: 'var(--cyan)', cursor: 'pointer', borderTop: '1px solid var(--border)', fontStyle: 'italic' }} onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--cyan-dim)'; }} onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}>
                    + Create "{customLabel.trim()}"
                  </div>
                )}
              </div>
            </div>
          </FloatingPortal>
        </div>
      )}

      {/* 📤 Export Selected */}
      {onExportSelected && (
        <button onClick={onExportSelected} style={{ padding: '5px 12px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '11px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
          📤 Export ({count})
        </button>
      )}

      {/* 🧪 Add to Cycle */}
      {onAddToCycle && (
        <button
          onClick={onAddToCycle}
          style={{ padding: '5px 12px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '11px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
        >
          🧪 Add to Cycle
        </button>
      )}

      {onBulkDelete && (
        <button onClick={onBulkDelete} style={{ padding: '5px 12px', background: 'rgba(225,29,72,0.12)', border: '1px solid rgba(225,29,72,0.3)', borderRadius: '6px', color: 'var(--fail)', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>
          🗑 Delete ({count})
        </button>
      )}
      <button onClick={onClear} title="Clear selection" style={{ width: '26px', height: '26px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text-dim)', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
    </div>
  );
}

// ── Edit modal ─────────────────────────────────────────────────────────────
function EditItemModal({ item, allLabels, onSave, onClose }: {
  item: TcItem; allLabels: string[];
  onSave: (patch: { srNo?: string; module?: string; feature?: string; title: string; description?: string; steps?: string; expectedResult?: string; labels: string[] }) => Promise<void>;
  onClose: () => void;
}) {
  const [srNo, setSrNo] = useState(item.srNo?.toString() ?? '');
  const [module, setModule] = useState(item.module ?? '');
  const [feature, setFeature] = useState(item.feature ?? '');
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description ?? '');
  const [steps, setSteps] = useState(item.steps ?? '');
  const [expectedResult, setExpectedResult] = useState(item.expectedResult ?? '');
  const [labels, setLabels] = useState<string[]>(() => parseTcItemLabels(item.labels));
  const [labelInput, setLabelInput] = useState('');
  const [saving, setSaving] = useState(false);

  const LABEL: React.CSSProperties = { fontSize: '9px', fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', marginBottom: '4px' };
  const INPUT: React.CSSProperties = { width: '100%', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: '6px', color: 'var(--text)', fontSize: '12px', padding: '7px 10px', outline: 'none', boxSizing: 'border-box' };

  function addLabel(value: string) {
    const v = value.trim();
    if (!v || labels.includes(v)) { setLabelInput(''); return; }
    setLabels((prev) => [...prev, v]);
    setLabelInput('');
  }
  function removeLabel(l: string) {
    setLabels((prev) => prev.filter((x) => x !== l));
  }

  const labelSuggestions = allLabels.filter((l) => !labels.includes(l) && (!labelInput || l.toLowerCase().includes(labelInput.toLowerCase())));

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await onSave({ srNo: srNo.trim() || undefined, module: module.trim() || undefined, feature: feature.trim() || undefined, title: title.trim(), description: description.trim() || undefined, steps: steps.trim() || undefined, expectedResult: expectedResult.trim() || undefined, labels });
    } finally { setSaving(false); }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: '12px', width: '100%', maxWidth: '580px', maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 18px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <span style={{ fontSize: '14px' }}>✏️</span>
          <div style={{ flex: 1, fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>Edit Test Case</div>
          <button onClick={onClose} style={{ width: '28px', height: '28px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-dim)', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1, padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr', gap: '12px' }}>
            <div><div style={LABEL}>SR No</div><input style={INPUT} value={srNo} onChange={(e) => setSrNo(e.target.value)} placeholder="e.g. AIR-TC-001" /></div>
            <div><div style={LABEL}>Module</div><input style={INPUT} value={module} onChange={(e) => setModule(e.target.value)} placeholder="e.g. CPM" /></div>
            <div><div style={LABEL}>Feature</div><input style={INPUT} value={feature} onChange={(e) => setFeature(e.target.value)} placeholder="e.g. Geo Hierarchy" /></div>
          </div>
          <div><div style={LABEL}>Test Case Title *</div><input autoFocus style={INPUT} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Test case title" /></div>
          <div><div style={LABEL}>Description</div><textarea style={{ ...INPUT, resize: 'vertical', minHeight: '60px' }} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description" /></div>
          <div><div style={LABEL}>Steps</div><textarea style={{ ...INPUT, resize: 'vertical', minHeight: '100px', fontFamily: 'var(--font-mono)', fontSize: '11px' }} value={steps} onChange={(e) => setSteps(e.target.value)} placeholder={'1. Navigate to...\n2. Click...\n3. Verify...'} /></div>
          <div><div style={LABEL}>Expected Result</div><textarea style={{ ...INPUT, resize: 'vertical', minHeight: '60px' }} value={expectedResult} onChange={(e) => setExpectedResult(e.target.value)} placeholder="What should happen" /></div>

          <div>
            <div style={LABEL}>Labels</div>
            {labels.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '8px' }}>
                {labels.map((l) => (
                  <span key={l} className="tag" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '10px' }}>
                    {l}
                    <span onClick={() => removeLabel(l)} style={{ cursor: 'pointer', color: 'var(--fail)', fontWeight: 700 }}>×</span>
                  </span>
                ))}
              </div>
            )}
            <div style={{ position: 'relative' }}>
              <input
                style={INPUT}
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addLabel(labelInput); }
                }}
                placeholder="Type a label (e.g. Release-4.2) and press Enter…"
              />
              {labelInput && labelSuggestions.length > 0 && (
                <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: '6px', boxShadow: '0 8px 24px rgba(0,0,0,0.25)', zIndex: 10, maxHeight: '140px', overflowY: 'auto' }}>
                  {labelSuggestions.slice(0, 8).map((l) => (
                    <div key={l} onClick={() => addLabel(l)} style={{ padding: '6px 10px', fontSize: '11px', color: 'var(--text)', cursor: 'pointer' }} onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--surface2)'; }} onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}>
                      {l}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', padding: '12px 18px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          <button onClick={onClose} style={{ padding: '7px 16px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-dim)', fontSize: '12px', cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving || !title.trim()} style={{ padding: '7px 20px', background: 'var(--cyan-dim)', border: '1px solid rgba(2,132,199,0.35)', borderRadius: '6px', color: 'var(--cyan)', fontSize: '12px', fontWeight: 700, cursor: saving || !title.trim() ? 'not-allowed' : 'pointer', opacity: saving || !title.trim() ? 0.5 : 1 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Import modal ───────────────────────────────────────────────────────────
function ImportModal({ projectId, onClose, onImported }: { projectId: string; onClose: () => void; onImported: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<ImportResult | null>(null);
  const importMutation = useImportTcItems(projectId);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const result = await importMutation.mutateAsync(file);
      setSummary(result);
      onImported();
    } catch { toast.error('Import failed — check the file format'); }
    finally { setImporting(false); }
  }

  async function handleDownloadTemplate() {
    try {
      const res = await api.get(`/projects/${projectId}/tc-items/template`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a'); a.href = url; a.download = 'tc-import-template.xlsx'; a.click(); URL.revokeObjectURL(url);
    } catch { toast.error('Template download failed'); }
  }

  const hasWarnings = summary && (summary.skippedEmpty > 0 || summary.duplicateRows.length > 0);

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: '12px', width: '100%', maxWidth: summary ? '480px' : '420px', maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 18px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <span style={{ fontSize: '14px' }}>{summary ? (hasWarnings ? '⚠️' : '✅') : '📥'}</span>
          <div style={{ flex: 1, fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>
            {summary ? 'Import Summary' : 'Import from Excel'}
          </div>
          <button onClick={onClose} style={{ width: '28px', height: '28px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-dim)', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        {/* Summary view */}
        {summary ? (
          <div style={{ overflowY: 'auto', flex: 1, padding: '18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>

            {/* Stat row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
              {[
                { label: 'Total rows', value: summary.totalRows, color: 'var(--text-dim)' },
                { label: 'New', value: summary.imported, color: 'var(--pass)' },
                { label: 'Updated', value: summary.updated ?? 0, color: (summary.updated ?? 0) > 0 ? 'var(--cyan)' : 'var(--text-dim)' },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
                  <div style={{ fontSize: '22px', fontWeight: 800, color, fontFamily: 'var(--font-mono)' }}>{value}</div>
                  <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginTop: '2px', fontWeight: 600 }}>{label}</div>
                </div>
              ))}
            </div>

            {/* Skipped empty rows */}
            {summary.skippedEmpty > 0 && (
              <div style={{ background: 'rgba(217,119,6,0.07)', border: '1px solid rgba(217,119,6,0.25)', borderRadius: '8px', padding: '10px 14px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--amber)', marginBottom: '2px' }}>⚠ {summary.skippedEmpty} empty rows skipped</div>
                <div style={{ fontSize: '10px', color: 'var(--text-dim)' }}>Rows with no Test Case Title were ignored.</div>
              </div>
            )}

            {/* Duplicate rows */}
            {summary.duplicateRows.length > 0 && (
              <div style={{ background: 'rgba(217,119,6,0.07)', border: '1px solid rgba(217,119,6,0.25)', borderRadius: '8px', padding: '10px 14px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--amber)', marginBottom: '6px' }}>⚠ {summary.duplicateRows.length} duplicate TC{summary.duplicateRows.length === 1 ? '' : 's'} skipped</div>
                <div style={{ maxHeight: '100px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {summary.duplicateRows.map((r, i) => (
                    <div key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>• {r}</div>
                  ))}
                </div>
              </div>
            )}

            {/* All good */}
            {!hasWarnings && (
              <div style={{ background: 'rgba(5,150,105,0.07)', border: '1px solid rgba(5,150,105,0.25)', borderRadius: '8px', padding: '10px 14px', fontSize: '11px', color: 'var(--pass)', fontWeight: 600 }}>
                ✓ Import completed with no issues.
              </div>
            )}

            <button onClick={onClose} style={{ marginTop: '4px', padding: '8px', background: 'var(--cyan-dim)', border: '1px solid rgba(2,132,199,0.35)', borderRadius: '7px', color: 'var(--cyan)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
              Done
            </button>
          </div>
        ) : (
          /* Upload view */
          <div style={{ padding: '20px 18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-mid)', lineHeight: 1.6 }}>
              Upload an Excel file with columns: <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--cyan)' }}>Test Case ID, Module, Feature, Test Case Title, Test Case Description, Step, Expected Result</span>
            </p>
            <button onClick={handleDownloadTemplate} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-dim)', fontSize: '11px', cursor: 'pointer', width: 'fit-content' }}>📄 Download template</button>
            <div onClick={() => !importing && fileRef.current?.click()} style={{ border: '2px dashed var(--border2)', borderRadius: '8px', padding: '28px', textAlign: 'center', cursor: importing ? 'wait' : 'pointer', opacity: importing ? 0.6 : 1 }} onMouseEnter={(e) => { if (!importing) (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--cyan)'; }} onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border2)'; }}>
              <div style={{ fontSize: '28px', marginBottom: '8px' }}>{importing ? '⏳' : '📊'}</div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)', marginBottom: '4px' }}>{importing ? 'Importing…' : 'Click to select Excel file'}</div>
              <div style={{ fontSize: '10px', color: 'var(--text-dim)' }}>.xlsx or .xls</div>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleFile} disabled={importing} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function TestCaseLibrary() {
  const { slug } = useParams<{ slug: string }>();
  const { data: project } = useProject(slug);
  const projectId = project?.id;
  const { canManageTestCycles, canManageTcLibrary, canEditTcItems } = useRBAC();

  const { data: items = [], isLoading } = useTcItems(projectId);
  const { gridTemplateColumns, startResize } = useResizableColumns('tc-library', TC_COLUMNS);

  const updateMutation = useUpdateTcItem(projectId);
  const deleteMutation = useDeleteTcItem(projectId);
  const bulkDeleteMutation = useBulkDeleteTcItems(projectId);
  const bulkMoveMutation = useBulkMoveTcItems(projectId);
  const bulkLabelMutation = useBulkAddLabelToTcItems(projectId);

  const [search, setSearch] = useState('');
  const [labelFilter, setLabelFilter] = useState<string[]>([]);
  const [labelFilterMode, setLabelFilterMode] = useState<'AND' | 'OR'>('OR');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [editingItem, setEditingItem] = useState<TcItem | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showAddToCycleModal, setShowAddToCycleModal] = useState(false);

  // Filtered items (search + label)
  const filteredItems = useMemo(() => {
    let result = items;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((i) => i.title.toLowerCase().includes(q) || (i.module ?? '').toLowerCase().includes(q) || (i.feature ?? '').toLowerCase().includes(q));
    }
    if (labelFilter.length) {
      result = result.filter((i) => {
        const itemLabels = parseTcItemLabels(i.labels);
        return labelFilterMode === 'AND'
          ? labelFilter.every((l) => itemLabels.includes(l))
          : labelFilter.some((l) => itemLabels.includes(l));
      });
    }
    return result;
  }, [items, search, labelFilter, labelFilterMode]);

  // Group by Feature, sorted by feature name; items within each group sorted by TC ID
  const groups = useMemo(() => {
    const map = new Map<string, TcItem[]>();
    for (const item of filteredItems) {
      const key = item.feature ?? 'Uncategorised';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return Array.from(map.entries())
      .map(([feature, featureItems]) => ({
        feature,
        items: [...featureItems].sort((a, b) => naturalCompare(a.srNo, b.srNo)),
      }))
      .sort((a, b) => {
        // Sort groups by the lowest TC ID in the group so order matches the Excel sheet
        if (a.feature === 'Uncategorised') return 1;
        if (b.feature === 'Uncategorised') return -1;
        const aMin = a.items[0]?.srNo ?? null;
        const bMin = b.items[0]?.srNo ?? null;
        return naturalCompare(aMin, bMin);
      })
      .map(({ feature, items }, i) => ({ feature, items, color: groupColor(i) }));
  }, [filteredItems]);

  // On first data load collapse all groups after the first 2
  const [initialCollapseDone, setInitialCollapseDone] = useState(false);
  useEffect(() => {
    if (!initialCollapseDone && groups.length > 0) {
      setCollapsedGroups(new Set(groups.slice(2).map((g) => g.feature)));
      setInitialCollapseDone(true);
    }
  }, [groups, initialCollapseDone]);

  const allFeatures = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) { if (item.feature) set.add(item.feature); }
    return Array.from(set).sort();
  }, [items]);

  const allLabels = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) { for (const l of parseTcItemLabels(item.labels)) set.add(l); }
    return Array.from(set).sort();
  }, [items]);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function toggleSelectAll(ids: string[]) {
    setSelectedIds((prev) => { const next = new Set(prev); const allSel = ids.every((id) => next.has(id)); if (allSel) ids.forEach((id) => next.delete(id)); else ids.forEach((id) => next.add(id)); return next; });
  }

  async function handleSaveEdit(patch: { srNo?: string; module?: string; feature?: string; title: string; description?: string; steps?: string; expectedResult?: string; labels: string[] }) {
    if (!editingItem) return;
    try { await updateMutation.mutateAsync({ id: editingItem.id, patch }); toast.success('Test case updated'); setEditingItem(null); }
    catch { toast.error('Update failed'); }
  }
  async function handleDelete(item: TcItem) {
    try { await deleteMutation.mutateAsync(item.id); setSelectedIds((prev) => { const next = new Set(prev); next.delete(item.id); return next; }); toast.success(`"${item.title}" deleted`); }
    catch { toast.error('Delete failed'); }
  }
  async function handleBulkDelete() {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} selected test case${ids.length === 1 ? '' : 's'}? This cannot be undone.`)) return;
    try { await bulkDeleteMutation.mutateAsync(ids); setSelectedIds(new Set()); toast.success(`${ids.length} test case${ids.length === 1 ? '' : 's'} deleted`); }
    catch { toast.error('Bulk delete failed'); }
  }
  async function handleMoveToFeature(feature: string) {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    try { await bulkMoveMutation.mutateAsync({ ids, feature }); setSelectedIds(new Set()); toast.success(`${ids.length} item${ids.length === 1 ? '' : 's'} moved to "${feature}"`); }
    catch { toast.error('Move failed'); }
  }
  async function handleBulkAddLabel(label: string) {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    try { await bulkLabelMutation.mutateAsync({ ids, label }); setSelectedIds(new Set()); toast.success(`Labeled ${ids.length} test case${ids.length === 1 ? '' : 's'} "${label}"`); }
    catch { toast.error('Bulk label failed'); }
  }

  function expandAll() { setCollapsedGroups(new Set()); }
  function collapseAll() { setCollapsedGroups(new Set(groups.map((g) => g.feature))); }

  // Exports the currently filtered view (search + label filter applied) —
  // this is "everything" when no filter is active, and just the visible
  // subset otherwise.
  async function handleExport() {
    if (!projectId) return;
    try { await exportTcItems(projectId, slug ?? 'export', filteredItems.map((i) => i.id)); }
    catch { toast.error('Export failed'); }
  }
  async function handleExportSelected() {
    if (!projectId) return;
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    try { await exportTcItems(projectId, `${slug ?? 'export'}-selected`, ids); }
    catch { toast.error('Export failed'); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <Topbar
        breadcrumbs={[
          { label: 'All Projects', href: '/projects' },
          { label: `📡 ${project?.name ?? slug ?? ''}`, href: `/projects/${slug}/settings` },
          { label: '📋 TC Library' },
        ]}
        actions={
          <div style={{ display: 'flex', gap: '6px' }}>
            <TbBtn variant="ghost" onClick={handleExport}>📤 Export Excel</TbBtn>
            {canManageTcLibrary && (
              <TbBtn variant="ghost" onClick={() => setShowImport(true)}>📥 Import Excel</TbBtn>
            )}
          </div>
        }
      />

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '14px', padding: '16px 20px 80px' }}>
        {/* Filter bar */}
        <div className="card" style={{ flexShrink: 0 }}>
          <div className="card-body" style={{ padding: '10px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <input className="input-field" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍 Search test cases, modules, features…" style={{ width: '260px', padding: '6px 10px' }} />

              {allLabels.length > 0 && (
                <LabelFilterDropdown
                  allLabels={allLabels}
                  selected={labelFilter}
                  mode={labelFilterMode}
                  onChange={setLabelFilter}
                  onModeChange={setLabelFilterMode}
                />
              )}

              {/* Select All */}
              {(() => {
                const allFilteredIds = filteredItems.map((i) => i.id);
                const allSelected = allFilteredIds.length > 0 && allFilteredIds.every((id) => selectedIds.has(id));
                const someSelected = !allSelected && allFilteredIds.some((id) => selectedIds.has(id));
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <div
                      className={`tc-checkbox${allSelected ? ' checked' : someSelected ? ' indeterminate' : ''}`}
                      style={{ fontSize: '10px', flexShrink: 0, cursor: 'pointer' }}
                      title={allSelected ? 'Deselect all' : `Select all ${allFilteredIds.length} TCs`}
                      onClick={() => {
                        if (allSelected) {
                          setSelectedIds((prev) => { const next = new Set(prev); allFilteredIds.forEach((id) => next.delete(id)); return next; });
                        } else {
                          setSelectedIds((prev) => { const next = new Set(prev); allFilteredIds.forEach((id) => next.add(id)); return next; });
                        }
                      }}
                    >
                      {allSelected ? '✓' : someSelected ? '–' : ''}
                    </div>
                    <span style={{ fontSize: '10px', color: 'var(--text-dim)', userSelect: 'none' }}>Select all</span>
                  </div>
                );
              })()}

              {/* Expand / Collapse All */}
              <div style={{ display: 'flex', gap: '4px' }}>
                <button onClick={expandAll} title="Expand all groups" style={{ padding: '4px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text-dim)', fontSize: '10px', cursor: 'pointer', fontWeight: 600 }}>⊞ All</button>
                <button onClick={collapseAll} title="Collapse all groups" style={{ padding: '4px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text-dim)', fontSize: '10px', cursor: 'pointer', fontWeight: 600 }}>⊟ All</button>
              </div>

              <div style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)' }}>
                {groups.length} features · {filteredItems.length} TCs
              </div>
            </div>
          </div>
        </div>

        {/* Groups */}
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '40px', fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-dim)' }}>Loading test cases…</div>
        ) : groups.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '60px 40px', textAlign: 'center' }}>
            <div style={{ fontSize: '40px', opacity: 0.3 }}>📋</div>
            <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text)', margin: 0 }}>
              {search ? 'No matching test cases' : 'No test cases yet'}
            </h2>
            <p style={{ fontSize: '13px', color: 'var(--text-dim)', maxWidth: '320px', lineHeight: 1.6, margin: 0 }}>
              {search ? 'Try a different search term.' : canManageTcLibrary ? 'Import your test cases from Excel using the button above.' : 'Ask a project admin to import test cases from Excel.'}
            </p>
            {!search && canManageTcLibrary && (
              <button onClick={() => setShowImport(true)} style={{ marginTop: '8px', padding: '9px 20px', background: 'var(--cyan-dim)', border: '1px solid rgba(2,132,199,0.35)', borderRadius: '8px', color: 'var(--cyan)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>📥 Import Excel</button>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {groups.map((g) => (
              <FeatureGroup
                key={g.feature}
                feature={g.feature}
                color={g.color}
                items={g.items}
                isOpen={!collapsedGroups.has(g.feature)}
                onOpenChange={(open) => {
                  setCollapsedGroups((prev) => {
                    const next = new Set(prev);
                    if (open) next.delete(g.feature); else next.add(g.feature);
                    return next;
                  });
                }}
                selectedIds={selectedIds}
                onToggle={toggleSelect}
                onToggleAll={toggleSelectAll}
                onEdit={canEditTcItems ? setEditingItem : undefined}
                onDelete={canManageTcLibrary ? handleDelete : undefined}
                gridTemplateColumns={gridTemplateColumns}
                startResize={startResize}
              />
            ))}
          </div>
        )}
      </div>

      {/* Floating selection bar */}
      {selectedIds.size > 0 && (
        <SelectionBar
          count={selectedIds.size}
          allFeatures={allFeatures}
          allLabels={allLabels}
          onClear={() => setSelectedIds(new Set())}
          onBulkDelete={canManageTcLibrary ? handleBulkDelete : undefined}
          onMoveToFeature={canEditTcItems ? handleMoveToFeature : undefined}
          onAddLabel={canEditTcItems ? handleBulkAddLabel : undefined}
          onExportSelected={handleExportSelected}
          onAddToCycle={canManageTestCycles ? () => setShowAddToCycleModal(true) : undefined}
        />
      )}

      {/* Modals */}
      {showImport && <ImportModal projectId={projectId ?? ''} onClose={() => setShowImport(false)} onImported={() => {}} />}
      {showAddToCycleModal && projectId && slug && (
        <AddToCycleModal
          projectId={projectId}
          slug={slug}
          selectedIds={Array.from(selectedIds)}
          onClose={() => setShowAddToCycleModal(false)}
          onSuccess={() => { setShowAddToCycleModal(false); setSelectedIds(new Set()); }}
        />
      )}
      {editingItem && <EditItemModal item={editingItem} allLabels={allLabels} onSave={handleSaveEdit} onClose={() => setEditingItem(null)} />}
    </div>
  );
}
