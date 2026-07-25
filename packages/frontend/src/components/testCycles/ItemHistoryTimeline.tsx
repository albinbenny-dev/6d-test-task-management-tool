import { useTestCycleHistory } from '../../hooks/useTestCycles';
import { STATUS_LABEL, STATUS_COLOR } from '../../lib/manualStatus';
import type { ManualResultStatus } from '../../types';

// ── Per-item execution history — the cycle's full audit trail
// (TestCycleItemHistory) is fetched ONCE per cycle (react-query dedupes by
// queryKey, so every row sharing this hook resolves from the same cached
// list — no N-requests-for-N-rows problem) and filtered down to one item
// here. Answers "was this ever failed before it passed?" without losing
// that story once a case is retested and marked green. ────────────────────

function useItemHistory(projectId: string, cycleId: string, itemId: string) {
  const { data: history = [] } = useTestCycleHistory(projectId, cycleId);
  return history.filter((h) => h.testCycleItemId === itemId);
}

// A case counts as "retested" once it's currently PASS but has an earlier
// FAIL/BLOCKED result recorded this cycle — the exact "failed, bug fixed,
// passed on retest" story that a single current-status field can't show.
export function useIsRetested(projectId: string, cycleId: string, itemId: string, currentStatus: ManualResultStatus): boolean {
  const itemHistory = useItemHistory(projectId, cycleId, itemId);
  if (currentStatus !== 'PASS') return false;
  return itemHistory.some((h) => h.toStatus === 'FAIL' || h.toStatus === 'BLOCKED');
}

export function useHasHistory(projectId: string, cycleId: string, itemId: string): boolean {
  return useItemHistory(projectId, cycleId, itemId).length > 0;
}

export function RetestedBadge({ projectId, cycleId, itemId, currentStatus }: {
  projectId: string; cycleId: string; itemId: string; currentStatus: ManualResultStatus;
}) {
  const isRetested = useIsRetested(projectId, cycleId, itemId, currentStatus);
  if (!isRetested) return null;
  return (
    <span
      title="Failed or blocked earlier this cycle — passing after retest"
      style={{
        fontSize: '9px', fontWeight: 700, color: 'var(--pass)', background: 'rgba(42,157,143,0.12)',
        border: '1px solid rgba(42,157,143,0.35)', borderRadius: '100px', padding: '1px 5px', flexShrink: 0,
      }}
    >
      ↻ Retested
    </span>
  );
}

function parseJsonArray(s: string | undefined | null): string[] {
  if (!s) return [];
  try { return JSON.parse(s) as string[]; } catch { return []; }
}

export function ItemHistoryTimeline({ projectId, cycleId, itemId }: { projectId: string; cycleId: string; itemId: string }) {
  const itemHistory = useItemHistory(projectId, cycleId, itemId);

  if (itemHistory.length === 0) {
    return <div style={{ color: 'var(--text-dim)', fontSize: '11px', fontStyle: 'italic' }}>No status changes recorded yet.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {itemHistory.map((h) => {
        const jiraKeys = parseJsonArray(h.jiraIssueKeys);
        return (
          <div key={h.id} style={{ fontSize: '11px', paddingLeft: '8px', borderLeft: `2px solid ${STATUS_COLOR[h.toStatus]}` }}>
            <div>
              <span style={{ color: 'var(--text-dim)' }}>{STATUS_LABEL[h.fromStatus]} → </span>
              <span style={{ color: STATUS_COLOR[h.toStatus], fontWeight: 700 }}>{STATUS_LABEL[h.toStatus]}</span>
              <span style={{ color: 'var(--text-dim)' }}> · {h.changedByName} · {new Date(h.changedAt).toLocaleString()}</span>
            </div>
            {h.reason && <div style={{ color: 'var(--text)', marginTop: '2px', whiteSpace: 'pre-wrap' }}>{h.reason}</div>}
            {jiraKeys.length > 0 && (
              <div style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>{jiraKeys.join(', ')}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
