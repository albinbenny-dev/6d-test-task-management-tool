import { useState, Fragment } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Trash2 } from 'lucide-react';
import Topbar from '../components/layout/Topbar';
import { useProject } from '../hooks/useProjects';
import { useRBAC } from '../hooks/useRBAC';
import { useMilestones, useCreateMilestone, useUpdateMilestone, useDeleteMilestone, type MilestoneInput } from '../hooks/useMilestones';
import { StatCard } from '../components/testCycles/StatCards';
import {
  milestoneDueBucket, isMilestoneOverdue, baselineSlipDays, executionSlipDays,
  deviationTone, DEVIATION_COLOR, groupMilestones,
} from '../lib/milestoneMeta';
import type { Milestone } from '../types';

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
        {!milestone.isCompleted && (
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

export default function Milestones() {
  const { slug } = useParams<{ slug: string }>();
  const { data: project } = useProject(slug);
  const projectId = project?.id;
  const { canManageMilestones } = useRBAC();

  const { data: milestones = [], isLoading } = useMilestones(projectId);
  const createMilestone = useCreateMilestone(projectId ?? '');
  const updateMilestone = useUpdateMilestone(projectId ?? '');
  const deleteMilestone = useDeleteMilestone(projectId ?? '');
  const [newName, setNewName] = useState('');

  const groups = groupMilestones(milestones);
  const paymentLinked = milestones.filter((m) => m.isPaymentLinked);
  const overdueCount = milestones.filter((m) => isMilestoneOverdue(m)).length;
  const dueThisMonthCount = milestones.filter((m) => milestoneDueBucket(m) === 'Due this month').length;
  const completedCount = milestones.filter((m) => m.isCompleted).length;

  async function handleAdd() {
    if (!newName.trim()) { toast.error('Milestone name is required'); return; }
    try {
      await createMilestone.mutateAsync({ name: newName.trim() });
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Topbar breadcrumbs={[{ label: project?.name ?? slug ?? 'Project' }, { label: 'Milestones' }]} />

      <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'grid', gridTemplateColumns: '1fr', alignContent: 'start', gap: 20 }}>
        <div>
          <div className="page-eyebrow">Delivery Tracking</div>
          <h1 className="page-title">Payment Milestones</h1>
          <p className="page-sub">Key delivery milestones for this project, their baseline vs. revised dates, and which ones have payment tied to them. No amounts are tracked here — status only.</p>
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
                    {groups.map((g) => (
                      <Fragment key={g.groupName ?? '__ungrouped__'}>
                        {g.groupName && (
                          <tr key={`group-${g.groupName}`}>
                            <td colSpan={canManageMilestones ? 11 : 10} style={{ background: 'var(--surface2)', fontWeight: 700, fontSize: 11.5, color: 'var(--text-mid)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                              {g.groupName}
                            </td>
                          </tr>
                        )}
                        {g.milestones.map((m) => (
                          <MilestoneRow key={m.id} milestone={m} canEdit={canManageMilestones} onUpdate={handleUpdate} onDelete={handleDelete} />
                        ))}
                      </Fragment>
                    ))}
                    {milestones.length === 0 && (
                      <tr><td colSpan={canManageMilestones ? 11 : 10} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 24 }}>No milestones yet.</td></tr>
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
      </div>
    </div>
  );
}
