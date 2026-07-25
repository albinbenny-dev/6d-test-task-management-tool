import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import type { ReportRun } from '../../types';
import { useReportRun } from '../../hooks/useReports';
import { useTriggerHeal } from '../../hooks/useHeals';
import { useRetryRun } from '../../hooks/useRuns';
import { useRunResultActions } from '../../hooks/useRunResultActions';
import { useRBAC } from '../../hooks/useRBAC';
import ScriptResultsTable, { STATUS_COLOR } from './ScriptResultsTable';

interface RunHistoryTableProps {
  projectId: string | undefined;
  runs: ReportRun[];
  onExport?: (runId: string) => void;
  /** When set, this run card is expanded on mount and scrolled into view (deep-link from TC Library). */
  initialExpandedRunId?: string;
}

const TRIGGER_LABEL: Record<string, string> = {
  MANUAL: 'Manual',
  SCHEDULED: 'Scheduled',
  INDIVIDUAL: 'Individual',
  GROUP: 'Group',
};

function formatDuration(startedAt?: string | null, completedAt?: string | null): string {
  if (!startedAt || !completedAt) return '—';
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

// ── Expanded run detail (lazy-fetched) ─────────────────────────────────────

function ExpandedRunDetail({
  projectId,
  runId,
  onExport,
}: {
  projectId: string | undefined;
  runId: string;
  onExport?: (id: string) => void;
}) {
  const { data: run, isLoading } = useReportRun(projectId, runId);
  const [query, setQuery] = useState('');
  const { retryingIds, handleRerunTC, downloadAsset, openRfHtml } = useRunResultActions(projectId, runId, run?.environment);

  if (isLoading || !run) {
    return (
      <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
        {isLoading ? 'Loading results…' : 'No detail available.'}
      </div>
    );
  }

  return (
    <div style={{ borderTop: '1px solid var(--border)' }}>
      <ScriptResultsTable
        results={run.results ?? []}
        query={query}
        onQueryChange={setQuery}
        projectId={projectId}
        runId={runId}
        retryingIds={retryingIds}
        onRerun={handleRerunTC}
        onDownloadAsset={downloadAsset}
        onOpenRfHtml={openRfHtml}
      />

      {/* Footer actions */}
      <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface2)' }}>
        {onExport && (
          <button
            onClick={() => onExport(runId)}
            style={{
              padding: '5px 14px',
              borderRadius: 6,
              background: 'rgba(164,123,250,0.12)',
              color: 'var(--violet)',
              border: '1px solid rgba(164,123,250,0.25)',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            📥 Download Excel Report
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
          {runId.slice(0, 20)}…
        </span>
      </div>
    </div>
  );
}

// ── Main table ─────────────────────────────────────────────────────────────

export default function RunHistoryTable({ projectId, runs, onExport, initialExpandedRunId }: RunHistoryTableProps) {
  // Seed the expanded set with the deep-linked run so it opens on mount.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => initialExpandedRunId ? new Set([initialExpandedRunId]) : new Set(),
  );

  // Scroll the deep-linked run card into view once the list has rendered.
  useEffect(() => {
    if (!initialExpandedRunId) return;
    const timer = setTimeout(() => {
      const el = document.getElementById(`run-card-${initialExpandedRunId}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120); // wait one paint so the expanded card has rendered
    return () => clearTimeout(timer);
  }, [initialExpandedRunId]);

  const { canAccessHealing } = useRBAC();
  const triggerHeal = useTriggerHeal(projectId ?? '', () => {
    toast('No failed tests found in this run', { icon: '⚠️' });
  });
  const retryRun = useRetryRun(projectId ?? '');

  async function handleRetryRun(runId: string) {
    try {
      await retryRun.mutateAsync(runId);
      toast.success('Run queued for retry');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to retry run';
      toast.error(msg);
    }
  }

  async function handleHeal(runId: string) {
    try {
      const result = await triggerHeal.mutateAsync({ runId });
      if (result.count > 0) {
        toast.success(`${result.count} failed test${result.count !== 1 ? 's' : ''} sent to Healing Agent`);
      }
    } catch {
      toast.error('Failed to trigger heal — check logs');
    }
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (runs.length === 0) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
        No runs found.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {runs.map((run) => {
        const isOpen = expanded.has(run.id);
        const passed = run.results.filter((r) => r.status === 'PASSED').length;
        const failed = run.results.filter((r) => r.status === 'FAILED').length;
        const skipped = run.results.filter((r) => r.status === 'SKIPPED').length;
        const total = run._count.results;
        const ran = total - skipped;
        const passRate = ran > 0 ? Math.round((passed / ran) * 100) : (skipped > 0 ? 100 : 0);

        return (
          <div key={run.id} id={`run-card-${run.id}`} style={{ background: 'var(--surface)', border: `1px solid ${initialExpandedRunId === run.id ? 'rgba(37,99,171,0.5)' : 'var(--border)'}`, borderRadius: 10, overflow: 'hidden', boxShadow: initialExpandedRunId === run.id ? '0 0 0 2px rgba(37,99,171,0.18)' : 'none', transition: 'box-shadow 0.3s, border-color 0.3s' }}>
            {/* Header row */}
            <div
              style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', gap: 12, cursor: 'pointer' }}
              onClick={() => toggle(run.id)}
            >
              <span style={{ fontSize: 10, color: 'var(--text-dim)', transition: 'transform 0.15s', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block', flexShrink: 0 }}>
                ▶
              </span>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[run.status] ?? 'var(--text-dim)', flexShrink: 0, display: 'inline-block' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span style={{
                    flexShrink: 0,
                    fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)',
                    padding: '2px 7px', borderRadius: 5,
                    background: 'rgba(37,99,171,0.12)',
                    color: 'var(--cyan)',
                    border: '1px solid rgba(37,99,171,0.25)',
                    whiteSpace: 'nowrap',
                  }}>
                    #{String(run.runSeq).padStart(4, '0')}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {run.name}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                  {new Date(run.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  {' · '}{run.environment}
                  {' · '}{TRIGGER_LABEL[run.triggerType] ?? run.triggerType}
                  {' · '}{formatDuration(run.startedAt, run.completedAt)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--pass)' }}>✓ {passed}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--fail)' }}>✗ {failed}</span>
                {skipped > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--amber)' }}>⊙ {skipped}</span>}
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 100,
                  background: passRate >= 90 ? 'rgba(42,157,143,0.15)' : passRate >= 70 ? 'rgba(251,191,36,0.15)' : 'rgba(220,38,38,0.15)',
                  color: passRate >= 90 ? 'var(--pass)' : passRate >= 70 ? 'var(--amber)' : 'var(--fail)',
                }}>
                  {passRate}%
                </span>
              </div>
              {/* Quick action buttons — stop propagation so they don't toggle the row */}
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                {(run.status === 'PASSED' || run.status === 'FAILED' || run.status === 'CANCELLED') && (
                  <button
                    onClick={() => handleRetryRun(run.id)}
                    disabled={retryRun.isPending}
                    title="Re-run all test cases from this run"
                    style={{
                      padding: '3px 10px', borderRadius: 6,
                      background: retryRun.isPending ? 'rgba(37,99,171,0.06)' : 'rgba(37,99,171,0.12)',
                      color: retryRun.isPending ? 'rgba(37,99,171,0.4)' : 'var(--cyan)',
                      border: '1px solid rgba(37,99,171,0.25)',
                      cursor: retryRun.isPending ? 'not-allowed' : 'pointer',
                      fontSize: 11, fontWeight: 600,
                    }}
                  >
                    {retryRun.isPending ? '⏳' : '↻'} Retry
                  </button>
                )}
                {onExport && (
                  <button
                    onClick={() => onExport(run.id)}
                    style={{ padding: '3px 10px', borderRadius: 6, background: 'rgba(164,123,250,0.12)', color: 'var(--violet)', border: '1px solid rgba(164,123,250,0.25)', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}
                  >
                    Export
                  </button>
                )}
              </div>
            </div>

            {/* Expanded detail — lazily fetched */}
            {isOpen && (
              <ExpandedRunDetail
                projectId={projectId}
                runId={run.id}
                onExport={onExport}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
