import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import Topbar, { TbBtn } from '../components/layout/Topbar';
import StatTile from '../components/ui/StatTile';
import RunDetailPanel from '../components/reports/RunDetailPanel';
import { useProject } from '../hooks/useProjects';
import { useReportRun, useTcReport } from '../hooks/useReports';
import { api } from '../lib/api';

const STATUS_COLOR: Record<string, string> = {
  PASSED: 'var(--pass)',
  FAILED: 'var(--fail)',
  RUNNING: 'var(--cyan)',
  PENDING: 'var(--amber)',
  CANCELLED: 'var(--text-dim)',
};

export default function RunDashboard() {
  const { slug, runId } = useParams<{ slug: string; runId: string }>();
  const navigate = useNavigate();
  const { data: project } = useProject(slug);
  const projectId = project?.id;
  const { data: run, isLoading } = useReportRun(projectId, runId ?? null);
  const [viewMode, setViewMode] = useState<'script' | 'testcase'>('script');
  const { data: tcReportItems, isLoading: tcReportLoading } = useTcReport(projectId, runId ?? null, viewMode === 'testcase');

  async function handleExport() {
    if (!runId) return;
    try {
      const response = await api.get(`/projects/${projectId}/reports/runs/${runId}/export`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(response.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `run-report-${runId.slice(0, 8)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error('Export failed: ' + (e as Error).message);
    }
  }

  // Stat tiles reflect whichever view is active — script results vs the
  // TC Library breakdown can have very different totals (e.g. a run only
  // exercises a handful of the linked TC Library items).
  let total = 0, passed = 0, failed = 0, excluded = 0, passRate = 0;
  const excludedLabel = viewMode === 'testcase' ? 'Not Run' : 'Skipped';

  if (viewMode === 'testcase') {
    const items = tcReportItems ?? [];
    total = items.length;
    passed = items.filter((i) => i.execStatus === 'PASSED').length;
    failed = items.filter((i) => i.execStatus === 'FAILED').length;
    excluded = items.filter((i) => i.execStatus === 'NOT_RUN' || i.execStatus === 'SKIPPED').length;
  } else {
    const results = run?.results ?? [];
    total = results.length;
    passed = results.filter((r) => r.status === 'PASSED').length;
    failed = results.filter((r) => r.status === 'FAILED').length;
    excluded = results.filter((r) => r.status === 'SKIPPED').length;
  }
  const ran = total - excluded;
  passRate = ran > 0 ? Math.round((passed / ran) * 100) : 0;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Topbar
        breadcrumbs={[
          { label: 'All Projects', href: '/projects' },
          { label: project?.name ?? slug ?? '' },
          { label: '📊 Dashboard', href: `/projects/${slug}/dashboard` },
          { label: run?.name ?? 'Run' },
        ]}
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <TbBtn variant="ghost" onClick={() => navigate(`/projects/${slug}/dashboard`)}>
              ← Back to Dashboard
            </TbBtn>
            <TbBtn
              variant="ghost"
              style={{ background: 'rgba(164,123,250,0.12)', color: 'var(--violet)', border: '1px solid rgba(164,123,250,0.3)' }}
              onClick={handleExport}
            >
              📥 Export Excel
            </TbBtn>
          </div>
        }
      />

      <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {isLoading || !run ? (
          <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 12, paddingTop: 60 }}>
            Loading run…
          </div>
        ) : (
          <>
            {/* Run header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: STATUS_COLOR[run.status] ?? 'var(--text-dim)' }} />
              <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{run.name}</span>
              <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                #{String(run.runSeq).padStart(4, '0')} · {run.environment} · {new Date(run.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>

            {/* Stat tiles — switch with the By Script / By Test Case toggle below */}
            <div style={{ display: 'flex', gap: 12 }}>
              <StatTile label="Total" value={total} accent="var(--cyan)" />
              <StatTile label="Passed" value={passed} accent="var(--pass)" />
              <StatTile label="Failed" value={failed} accent="var(--fail)" />
              <StatTile label={excludedLabel} value={excluded} accent="var(--amber)" />
              <StatTile label="Pass Rate" value={passRate} suffix="%" accent="var(--violet)" />
            </div>

            {/* Script / Test Case results — no overflow:hidden here: this is a flex
                child of the scrolling column above, and clipping its own overflow
                (instead of letting content grow + the page scroll) silently crops
                large expanded groups with no visible scrollbar. */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: 'var(--shadow-card)' }}>
              <RunDetailPanel
                projectId={projectId}
                runId={runId!}
                run={run}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                tcReportItems={tcReportItems ?? []}
                tcReportLoading={tcReportLoading}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
