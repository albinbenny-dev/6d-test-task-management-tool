import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Trash2 } from 'lucide-react';
import Topbar from '../components/layout/Topbar';
import { useProject } from '../hooks/useProjects';
import { useRBAC } from '../hooks/useRBAC';
import { useMilestones, useCreateMilestone, useUpdateMilestone, useDeleteMilestone, type MilestoneInput } from '../hooks/useMilestones';
import {
  useMilestoneLists, useCreateMilestoneList, useUpdateMilestoneList, useDeleteMilestoneList,
} from '../hooks/useMilestoneLists';
import { StatCard } from '../components/testCycles/StatCards';
import {
  milestoneDueBucket, isMilestoneOverdue, baselineSlipDays, executionSlipDays,
  deviationTone, DEVIATION_COLOR,
} from '../lib/milestoneMeta';
import type { Milestone, MilestoneList } from '../types';

// ── Date helpers — <input type="date"> works in local 'YYYY-MM-DD' strings;
// the API stores/returns full ISO timestamps. Mirrors CreateTaskModal's
// dueDate handling. ─────────────────────────────────────────────────────────
function toInputDate(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : '';
}
function fromInputDate(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

function SlipBadge({ label, days }: { label: string; days: number | null }) {
  if (days === null) return <span style={{ color: 'var(--text-dim)', fontSize: 11.5 }}>—</span>;
  const tone = deviationTone(days);
  if (days <= 0) return <span style={{ fontSize: 11.5, fontWeight: 700, color: DEVIATION_COLOR['on-time'] }}>On time</span>;
  return (
    <span style={{ fontSize: 11.5, fontWeight: 700, color: DEVIATION_COLOR[tone] }} title={label}>
      {days}d late
    </span>
  );
}

function DateCell({ value, editable, onCommit }: { value: string | null | undefined; editable: boolean; onCommit: (iso: string | null) => void }) {
  const [draft, setDraft] = useState(toInputDate(value));
  if (!editable) {
    return <span style={{ fontSize: 12.5 }}>{value ? toInputDate(value) : '—'}</span>;
  }
  return (
    <input
      type="date"
      className="input-field"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (fromInputDate(draft) !== fromInputDate(toInputDate(value))) onCommit(fromInputDate(draft)); }}
      style={{ fontSize: 12, padding: '4px 6px', width: 132 }}
    />
  );
}

function MilestoneRow({ milestone, canEdit, onUpdate, onDelete }: {
  milestone: Milestone;
  canEdit: boolean;
  onUpdate: (id: string, data: Partial<MilestoneInput> & { isCompleted?: boolean }) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState(milestone.name);
  const bucket = milestoneDueBucket(milestone);
  const overdue = isMilestoneOverdue(milestone);
  const baseSlip = baselineSlipDays(milestone);
  const execSlip = executionSlipDays(milestone);

  return (
    <tr style={overdue ? { background: 'var(--rose-dim)' } : undefined}>
      <td className="primary" style={{ minWidth: 200 }}>
        {canEdit ? (
          <input
            className="input-field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => { if (name.trim() && name.trim() !== milestone.name) onUpdate(milestone.id, { name: name.trim() }); }}
            style={{ fontSize: 12.5, padding: '4px 6px' }}
          />
        ) : (
          milestone.name
        )}
      </td>
      <td><DateCell value={milestone.baselineDate} editable={canEdit} onCommit={(iso) => onUpdate(milestone.id, { baselineDate: iso })} /></td>
      <td><DateCell value={milestone.targetDate} editable={canEdit} onCommit={(iso) => onUpdate(milestone.id, { targetDate: iso })} /></td>
      <td><SlipBadge label="Slipped vs. baseline" days={baseSlip} /></td>
      <td style={{ textAlign: 'center' }}>
        <input
          type="checkbox"
          checked={milestone.isCompleted}
          disabled={!canEdit}
          onChange={(e) => onUpdate(milestone.id, { isCompleted: e.target.checked })}
        />
      </td>
      <td><DateCell value={milestone.actualDate} editable={canEdit} onCommit={(iso) => onUpdate(milestone.id, { actualDate: iso })} /></td>
      <td><SlipBadge label="Late vs. target" days={execSlip} /></td>
      <td style={{ textAlign: 'center' }}>
        <input
          type="checkbox"
          checked={milestone.isPaymentLinked}
          disabled={!canEdit}
          onChange={(e) => onUpdate(milestone.id, { isPaymentLinked: e.target.checked })}
        />
      </td>
      <td style={{ textAlign: 'center' }}>
        <input
          type="checkbox"
          checked={milestone.invoiceRaised}
          disabled={!canEdit || !milestone.isPaymentLinked}
          onChange={(e) => onUpdate(milestone.id, { invoiceRaised: e.target.checked })}
        />
      </td>
      <td>
        {milestone.isCompleted ? (
          <span
            style={{
              fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
              background: 'var(--surface2)', color: DEVIATION_COLOR[deviationTone(execSlip)],
            }}
          >
            {execSlip && execSlip > 0 ? `Delivered ${execSlip}d late` : 'Delivered'}
          </span>
        ) : (
          <span
            style={{
              fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
              background: bucket === 'Overdue' ? 'var(--rose-dim)' : bucket === 'Due this month' ? 'var(--amber-dim)' : 'var(--surface2)',
              color: bucket === 'Overdue' ? 'var(--fail)' : bucket === 'Due this month' ? 'var(--amber)' : 'var(--text-dim)',
            }}
          >
            {bucket}
          </span>
        )}
      </td>
      {canEdit && (
        <td>
          <button
            onClick={() => onDelete(milestone.id)}
            title="Delete milestone"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', display: 'flex', padding: 4 }}
          >
            <Trash2 size={14} />
          </button>
        </td>
      )}
    </tr>
  );
}

// ── List tab — click to switch, double-click to rename (canEdit only), with
// a delete icon that only appears on the active tab so the strip doesn't get
// cluttered with N trash icons. Mirrors the create-then-rename flow
// TaskListsSidebar uses for TaskList, condensed into a tab since a project
// is expected to carry only a handful of milestone lists (Project/CR/MS…),
// not dozens the way Task Lists can grow. ───────────────────────────────────
function ListTab({ list, active, canEdit, onSelect, onRename, onDelete }: {
  list: MilestoneList;
  active: boolean;
  canEdit: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(list.name);

  function commitRename() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== list.name) onRename(trimmed);
    else setDraft(list.name);
  }

  if (editing) {
    return (
      <input
        autoFocus
        className="input-field"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitRename}
        onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { setDraft(list.name); setEditing(false); } }}
        style={{ fontSize: 12.5, padding: '6px 10px', width: 160 }}
      />
    );
  }

  return (
    <button
      onClick={onSelect}
      onDoubleClick={() => canEdit && setEditing(true)}
      title={canEdit ? 'Double-click to rename' : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 7,
        background: 'none', border: 'none', cursor: 'pointer',
        padding: '8px 12px', marginBottom: -1,
        fontSize: 12.5, fontWeight: 600,
        color: active ? 'var(--cyan)' : 'var(--text-dim)',
        borderBottom: active ? '2px solid var(--cyan)' : '2px solid transparent',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: 3, background: list.color, flexShrink: 0 }} />
      {list.name}
      <span style={{ fontSize: 10.5, color: 'var(--text-dim)', fontWeight: 700 }}>{list._count?.milestones ?? 0}</span>
      {active && canEdit && (
        <span
          role="button"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Delete list"
          style={{ display: 'flex', color: 'var(--text-dim)', marginLeft: 2 }}
        >
          <Trash2 size={12} />
        </span>
      )}
    </button>
  );
}

function NewListControl({ onCreate, isPending }: { onCreate: (name: string) => void; isPending: boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  function submit() {
    if (!name.trim()) return;
    onCreate(name.trim());
    setName('');
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '8px 12px', fontSize: 12.5, fontWeight: 600, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}
      >
        + New List
      </button>
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 4px' }}>
      <input
        autoFocus
        className="input-field"
        placeholder="e.g. CR Milestones"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setOpen(false); }}
        style={{ fontSize: 12.5, padding: '6px 10px', width: 160 }}
      />
      <button className="tb-btn tb-btn-primary" onClick={submit} disabled={isPending} style={{ padding: '6px 10px' }}>Add</button>
      <button className="tb-btn tb-btn-ghost" onClick={() => setOpen(false)} style={{ padding: '6px 10px' }}>Cancel</button>
    </div>
  );
}

export default function Milestones() {
  const { slug } = useParams<{ slug: string }>();
  const { data: project } = useProject(slug);
  const projectId = project?.id;
  const { canManageMilestones } = useRBAC();

  const { data: lists = [], isLoading: listsLoading } = useMilestoneLists(projectId);
  const createList = useCreateMilestoneList(projectId ?? '');
  const updateList = useUpdateMilestoneList(projectId ?? '');
  const deleteList = useDeleteMilestoneList(projectId ?? '');

  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedListId && lists.length > 0) setSelectedListId(lists[0].id);
    if (selectedListId && !lists.some((l) => l.id === selectedListId)) setSelectedListId(lists[0]?.id ?? null);
  }, [lists, selectedListId]);

  const { data: milestones = [], isLoading: milestonesLoading } = useMilestones(projectId, selectedListId ?? undefined);
  const createMilestone = useCreateMilestone(projectId ?? '');
  const updateMilestone = useUpdateMilestone(projectId ?? '');
  const deleteMilestone = useDeleteMilestone(projectId ?? '');
  const [newName, setNewName] = useState('');

  const paymentLinked = milestones.filter((m) => m.isPaymentLinked);
  const overdueCount = milestones.filter((m) => isMilestoneOverdue(m)).length;
  const dueThisMonthCount = milestones.filter((m) => milestoneDueBucket(m) === 'Due this month').length;
  const completedCount = milestones.filter((m) => m.isCompleted).length;

  async function handleAddList(name: string) {
    try {
      const list = await createList.mutateAsync({ name });
      setSelectedListId(list.id);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      toast.error(axiosErr.response?.data?.error ?? 'Failed to create list');
    }
  }

  function handleRenameList(id: string, name: string) {
    updateList.mutate({ id, name }, { onError: () => toast.error('Failed to rename list') });
  }

  function handleDeleteList(id: string, name: string) {
    if (!window.confirm(`Delete "${name}" and every milestone inside it?`)) return;
    deleteList.mutate(id, { onError: () => toast.error('Failed to delete list') });
  }

  async function handleAdd() {
    if (!selectedListId) return;
    if (!newName.trim()) { toast.error('Milestone name is required'); return; }
    try {
      await createMilestone.mutateAsync({ milestoneListId: selectedListId, name: newName.trim() });
      setNewName('');
      toast.success('Milestone added');
    } catch {
      toast.error('Failed to add milestone');
    }
  }

  function handleUpdate(id: string, data: Partial<MilestoneInput> & { isCompleted?: boolean }) {
    updateMilestone.mutate({ id, ...data }, { onError: () => toast.error('Failed to update milestone') });
  }

  function handleDelete(id: string) {
    if (!window.confirm('Delete this milestone?')) return;
    deleteMilestone.mutate(id, { onError: () => toast.error('Failed to delete milestone') });
  }

  const isLoading = listsLoading || (!!selectedListId && milestonesLoading);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Topbar breadcrumbs={[{ label: project?.name ?? slug ?? 'Project' }, { label: 'Milestones' }]} />

      <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'grid', gridTemplateColumns: '1fr', alignContent: 'start', gap: 20 }}>
        <div>
          <div className="page-eyebrow">Delivery Tracking</div>
          <h1 className="page-title">Payment Milestones</h1>
          <p className="page-sub">Key delivery milestones for this project, grouped into lists (Project / CR / MS milestones, etc.), with baseline vs. revised dates and which ones have payment tied to them. No amounts are tracked here — status only.</p>
        </div>

        {listsLoading ? (
          <div style={{ color: 'var(--text-dim)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>Loading…</div>
        ) : lists.length === 0 ? (
          <div className="card" style={{ padding: 32, textAlign: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>No milestone lists yet</div>
            <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: canManageMilestones ? 16 : 0 }}>
              {canManageMilestones ? 'Create a list to start tracking key delivery milestones — e.g. "Project Milestones", "CR Milestones", "MS Milestones".' : 'No one has set up milestone tracking for this project yet.'}
            </p>
            {canManageMilestones && (
              <div style={{ display: 'inline-block' }}>
                <NewListControlStandalone onCreate={handleAddList} isPending={createList.isPending} />
              </div>
            )}
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', flexWrap: 'wrap', alignItems: 'center' }}>
              {lists.map((list) => (
                <ListTab
                  key={list.id}
                  list={list}
                  active={list.id === selectedListId}
                  canEdit={canManageMilestones}
                  onSelect={() => setSelectedListId(list.id)}
                  onRename={(name) => handleRenameList(list.id, name)}
                  onDelete={() => handleDeleteList(list.id, list.name)}
                />
              ))}
              {canManageMilestones && <NewListControl onCreate={handleAddList} isPending={createList.isPending} />}
            </div>

            {isLoading ? (
              <div style={{ color: 'var(--text-dim)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>Loading…</div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                  <StatCard compact label="Milestones" value={milestones.length} theme="total" highlighted />
                  <StatCard compact label="Payment-Linked" value={paymentLinked.length} theme="progress" />
                  <StatCard compact label="Overdue" value={overdueCount} theme="fail" />
                  <StatCard compact label="Due This Month" value={dueThisMonthCount} theme="blocked" />
                  <StatCard compact label="Completed" value={completedCount} theme="pass" />
                </div>

                <div className="card" style={{ padding: 16 }}>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="data-table" style={{ minWidth: 980 }}>
                      <thead>
                        <tr>
                          <th>Milestone</th>
                          <th>As per PIP (baseline)</th>
                          <th>Revised / Target</th>
                          <th>Baseline Slip</th>
                          <th>Delivered?</th>
                          <th>Delivered On</th>
                          <th>Execution Slip</th>
                          <th>Payment Linked?</th>
                          <th>Invoice Raised?</th>
                          <th>Status</th>
                          {canManageMilestones && <th></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {milestones.map((m) => (
                          <MilestoneRow key={m.id} milestone={m} canEdit={canManageMilestones} onUpdate={handleUpdate} onDelete={handleDelete} />
                        ))}
                        {milestones.length === 0 && (
                          <tr><td colSpan={canManageMilestones ? 11 : 10} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 24 }}>No milestones in this list yet.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {canManageMilestones && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
                      <input
                        className="input-field"
                        placeholder="New milestone name (e.g. Drop 1 HLD Sign-off)"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
                        style={{ maxWidth: 340, fontSize: 12.5 }}
                      />
                      <button className="tb-btn tb-btn-primary" onClick={handleAdd} disabled={createMilestone.isPending}>
                        {createMilestone.isPending ? 'Adding…' : '+ Add Milestone'}
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Same control as the tab-strip's "+ New List", pre-opened — used for the
// empty state where there's no tab strip yet to attach the collapsed button to.
function NewListControlStandalone({ onCreate, isPending }: { onCreate: (name: string) => void; isPending: boolean }) {
  const [name, setName] = useState('');
  function submit() {
    if (!name.trim()) return;
    onCreate(name.trim());
    setName('');
  }
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <input
        className="input-field"
        placeholder="e.g. Project Milestones"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        style={{ fontSize: 12.5 }}
      />
      <button className="tb-btn tb-btn-primary" onClick={submit} disabled={isPending}>
        {isPending ? 'Creating…' : '+ New List'}
      </button>
    </div>
  );
}
