import { useState } from 'react';
import type { ReportRun } from '../../types';
import type { TcReportItem } from '../../hooks/useReports';
import { useRunResultActions } from '../../hooks/useRunResultActions';
import ScriptResultsTable from './ScriptResultsTable';
import TcReportView from './TcReportView';

// Dual-view (By Script / By Test Case) run detail — used by the Suite
// Dashboard's per-run page. Reports' own Run History intentionally stays
// script-only (see ScriptResultsTable via RunHistoryTable), so this toggle
// lives only here rather than in the shared accordion.
//
// viewMode is controlled by the parent page so its stat tiles (Total/Passed/
// Failed/Pass Rate) can switch to match whichever view is active.
export default function RunDetailPanel({
  projectId,
  runId,
  run,
  viewMode,
  onViewModeChange,
  tcReportItems,
  tcReportLoading,
}: {
  projectId: string | undefined;
  runId: string;
  run: ReportRun;
  viewMode: 'script' | 'testcase';
  onViewModeChange: (mode: 'script' | 'testcase') => void;
  tcReportItems: TcReportItem[];
  tcReportLoading: boolean;
}) {
  const [query, setQuery] = useState('');
  const { retryingIds, handleRerunTC, downloadAsset, openRfHtml } = useRunResultActions(projectId, runId, run.environment);

  return (
    <div>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
          {(['script', 'testcase'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => onViewModeChange(mode)}
              style={{
                padding: '4px 10px',
                fontSize: 11,
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                background: viewMode === mode ? 'rgba(37,99,171,0.15)' : 'transparent',
                color: viewMode === mode ? 'var(--cyan)' : 'var(--text-dim)',
              }}
            >
              {mode === 'script' ? 'By Script' : 'By Test Case'}
            </button>
          ))}
        </div>
      </div>

      {viewMode === 'testcase' ? (
        <TcReportView
          projectId={projectId}
          runId={runId}
          items={tcReportItems}
          isLoading={tcReportLoading}
          query={query}
          fullHeight
        />
      ) : (
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
          grouped
          fullHeight
        />
      )}
    </div>
  );
}
