import { useState, type CSSProperties } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import Topbar, { TbBtn } from '../components/layout/Topbar';
import { useProject } from '../hooks/useProjects';
import { useTestCycleDashboardSummary, useCreateTestCycle } from '../hooks/useTestCycles';
import { useRBAC } from '../hooks/useRBAC';
import { STATUS_COLOR } from '../lib/manualStatus';
import { AllBugsSection } from '../components/testCycles/AllBugsSection';
import type { TestCycle, TestCycleSummary, ManualResultStatus } from '../types';

const STATUS_SEGMENTS: ManualResultStatus[] = ['PASS', 'FAIL', 'IN_PROGRESS', 'BLOCKED', 'NOT_RUN'];

const STATUS_BADGE: Record<TestCycle['status'], string> = {
  PLANNING: 'badge-draft',
  ACTIVE:   'badge-run',
  CLOSED:   'badge-pass',
};

// ── Create-cycle modal — just the cycle's own metadata. Test cases are added
// afterward from the cycle page's "Add TC" picker (AddTestCasesModal in
// TestCycleDetail.tsx), so a cycle can be created empty and populated at
// whatever pace testers want, rather than forcing a big picker up front. ───

function CreateCycleModal({ onClose, onCreate, isSaving }: {
  onClose: () => void;
  onCreate: (data: { name: string; description?: string; testCaseIds: string[]; jiraLabels?: string[]; jiraJql?: string; driveFolderUrl?: string }) => void;
  isSaving: boolean;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [jiraLabelsInput, setJiraLabelsInput] = useState('');
  const [jiraJql, setJiraJql] = useState('');
  const [driveFolderUrl, setDriveFolderUrl] = useState('');

  function handleSubmit() {
    if (!name.trim()) { toast.error('Cycle name is required'); return; }
    const jiraLabels = jiraLabelsInput.split(',').map((l) => l.trim()).filter(Boolean);
    onCreate({
      name: name.trim(),
      description: description.trim() || undefined,
      testCaseIds: [],
      jiraLabels: jiraLabels.length > 0 ? jiraLabels : undefined,
      jiraJql: jiraJql.trim() || undefined,
      driveFolderUrl: driveFolderUrl.trim() || undefined,
    });
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: '520px', maxHeight: '92vh', display: 'flex', flexDirection: 'column', padding: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text)', padding: '24px 24px 0', flexShrink: 0 }}>New Test Cycle</div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 24px' }}>
        <label style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-mid)', marginBottom: '4px' }}>
          Name
        </label>
        <input
          className="input-field"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Release 4.2 Regression"
          style={{ marginBottom: '12px' }}
        />

        <label style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-mid)', marginBottom: '4px' }}>
          Description (optional)
        </label>
        <textarea
          className="input-field"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          style={{ marginBottom: '12px', resize: 'vertical' }}
        />

        <label style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-mid)', marginBottom: '4px' }}>
          Jira labels (optional)
        </label>
        <input
          className="input-field"
          value={jiraLabelsInput}
          onChange={(e) => setJiraLabelsInput(e.target.value)}
          placeholder="e.g. opco-nigeria, release-4.2"
          style={{ marginBottom: '4px' }}
        />
        <p style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '12px' }}>
          Comma-separated. Auto-discovers bugs tagged with these labels in this cycle's Jira project, even if a tester never explicitly links a key.
        </p>

        <label style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-mid)', marginBottom: '4px' }}>
          Custom JQL (optional)
        </label>
        <textarea
          className="input-field"
          value={jiraJql}
          onChange={(e) => setJiraJql(e.target.value)}
          placeholder='e.g. project = "AAVM" AND component = "POS" AND status != Closed'
          rows={2}
          style={{ marginBottom: '4px', resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: '11px' }}
        />
        <p style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '12px' }}>
          Runs alongside the labels above for cases label matching can't express precisely. Edit anytime from the cycle's Edit dialog.
        </p>

        <label style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-mid)', marginBottom: '4px' }}>
          Drive folder (optional)
        </label>
        <input
          className="input-field"
          value={driveFolderUrl}
          onChange={(e) => setDriveFolderUrl(e.target.value)}
          placeholder="https://drive.google.com/drive/folders/…"
          style={{ marginBottom: '4px' }}
        />
        <p style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '12px' }}>
          Shared with testers so they can upload execution evidence (screenshots/logs) into TC-ID-named subfolders. Shown as a link on the cycle page.
        </p>

        <p style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
          Add test cases from the cycle page after creating it — look for the "➕ Add TC" button.
        </p>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '16px 24px 24px', flexShrink: 0, borderTop: '1px solid var(--border)' }}>
          <TbBtn variant="ghost" onClick={onClose}>Cancel</TbBtn>
          <TbBtn variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? 'Creating…' : 'Create Cycle'}
          </TbBtn>
        </div>
      </div>
    </div>
  );
}

// ── Cycle card — status counts + bug resolution summary, kept to just the
// numbers (segmented bar + pass rate + resolved-bug count) so the card grid
// stays scannable rather than turning into a mini dashboard per cycle. ─────

// Priority order for the card's accent stripe — failures are the thing a
// reviewer scanning the grid needs to spot first, so they win over a
// technically-higher blocked/in-progress count.
function cycleAccentColor(counts: Record<ManualResultStatus, number>, total: number): string {
  if (counts.FAIL > 0) return STATUS_COLOR.FAIL;
  if (counts.BLOCKED > 0) return STATUS_COLOR.BLOCKED;
  if (counts.IN_PROGRESS > 0) return STATUS_COLOR.IN_PROGRESS;
  if (total > 0 && counts.PASS === total) return STATUS_COLOR.PASS;
  return STATUS_COLOR.NOT_RUN;
}

function CycleSummaryCard({ summary, index }: { summary: TestCycleSummary; index: number }) {
  const { cycle, counts, total, bugs } = summary;
  const passRate = total > 0 ? Math.round((counts.PASS / total) * 100) : 0;
  const accent = cycleAccentColor(counts, total);

  return (
    <div
      className="card cycle-card"
      style={{
        padding: '16px', height: '100%', display: 'flex', flexDirection: 'column', gap: '10px',
        '--accent': accent, animationDelay: `${Math.min(index, 10) * 40}ms`,
      } as CSSProperties}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)' }}>{cycle.name}</div>
        <span className={`badge ${STATUS_BADGE[cycle.status]}`}>{cycle.status}</span>
      </div>

      {cycle.description && (
        <div style={{ fontSize: '12px', color: 'var(--text-mid)' }}>{cycle.description}</div>
      )}

      <div>
        <div style={{ display: 'flex', height: '8px', width: '100%', borderRadius: '4px', background: 'var(--surface2)', gap: '2px', overflow: 'hidden' }}>
          {total > 0 && STATUS_SEGMENTS.filter((s) => counts[s] > 0).map((s) => (
            <div key={s} title={`${s}: ${counts[s]}`} style={{ width: `${(counts[s] / total) * 100}%`, background: STATUS_COLOR[s], borderRadius: '2px' }} />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
          <span style={{ color: 'var(--text-dim)' }}>{total} test case{total === 1 ? '' : 's'}</span>
          <span style={{ fontWeight: 700, color: 'var(--text)' }}>{passRate}% pass</span>
        </div>
      </div>

      {bugs.total > 0 && (
        <div style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span>🐛</span>
          <span style={{ color: bugs.resolved === bugs.total ? 'var(--pass)' : 'var(--text)', fontWeight: 700 }}>{bugs.resolved}/{bugs.total}</span>
          <span>bugs resolved</span>
        </div>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function TestCycles() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { data: project } = useProject(slug);
  const projectId = project?.id;
  const { canManageTestCycles } = useRBAC();

  const { data: dashboardData, isLoading } = useTestCycleDashboardSummary(projectId);
  const summaries = dashboardData?.summary ?? [];
  const createCycle = useCreateTestCycle(projectId ?? '');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState<TestCycle['status'] | 'ALL'>('ALL');
  const filteredSummaries = statusFilter === 'ALL' ? summaries : summaries.filter((s) => s.cycle.status === statusFilter);

  async function handleCreate(data: { name: string; description?: string; testCaseIds: string[]; jiraLabels?: string[]; jiraJql?: string; driveFolderUrl?: string }) {
    try {
      const cycle = await createCycle.mutateAsync(data);
      toast.success(`"${cycle.name}" created`);
      setShowCreateModal(false);
      navigate(`/projects/${slug}/test-cycles/${cycle.id}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to create cycle';
      toast.error(msg);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Topbar
        breadcrumbs={[
          { label: project?.name ?? slug ?? 'Project', href: `/projects/${slug}/dashboard` },
          { label: 'Test Cycles' },
        ]}
        actions={(
          <>
            <TbBtn variant="ghost" onClick={() => navigate(`/projects/${slug}/test-cycles/dashboard`)}>📊 Dashboard</TbBtn>
            {canManageTestCycles && (
              <TbBtn variant="primary" onClick={() => setShowCreateModal(true)}>+ New Cycle</TbBtn>
            )}
          </>
        )}
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
        <div>
          <div className="page-eyebrow">Manual test management</div>
          <h1 className="page-title">Test Cycles</h1>
          <p className="page-sub">Group test cases into a human-run regression pass, assign testers, and track results.</p>
        </div>

        <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-mid)' }}>
            Status
          </label>
          <select
            className="input-field"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as TestCycle['status'] | 'ALL')}
            style={{ width: 'auto', fontSize: '11px', padding: '4px 8px' }}
          >
            <option value="ALL">All</option>
            <option value="PLANNING">Planning</option>
            <option value="ACTIVE">Active</option>
            <option value="CLOSED">Closed</option>
          </select>
        </div>

        <div style={{ marginTop: '12px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '14px' }}>
          {isLoading && (
            <div style={{ color: 'var(--text-dim)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>Loading cycles…</div>
          )}
          {!isLoading && filteredSummaries.length === 0 && (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '48px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
              {summaries.length === 0
                ? `No test cycles yet.${canManageTestCycles ? ' Create one to start a manual regression pass.' : ''}`
                : 'No cycles match this filter.'}
            </div>
          )}
          {filteredSummaries.map((summary, i) => (
            <Link key={summary.cycle.id} to={`/projects/${slug}/test-cycles/${summary.cycle.id}`} style={{ textDecoration: 'none' }}>
              <CycleSummaryCard summary={summary} index={i} />
            </Link>
          ))}
        </div>

        {projectId && <AllBugsSection projectId={projectId} />}
      </div>

      {showCreateModal && (
        <CreateCycleModal
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreate}
          isSaving={createCycle.isPending}
        />
      )}
    </div>
  );
}
