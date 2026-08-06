import { useState } from 'react';
import toast from 'react-hot-toast';
import { TbBtn } from '../layout/Topbar';
import { MultiSelectFilter } from './FilterBar';
import { TcIdsCell } from './TcIdsCell';
import { useAllTestCycleBugs } from '../../hooks/useTestCycles';
import { useSyncJiraNow, useJiraHost } from '../../hooks/useJira';
import { isBugClosed, isBugOverdue } from '../../lib/jiraBugStatus';
import type { JiraBugSummaryWithCycles } from '../../types';

// ── Combined bug board — union of every Jira bug linked across all of this
// project's test cycles (not scoped to one cycle, unlike TestCycleDetail's
// BugsTab). Sits below the cycle card grid on the Test Cycles list page so
// a lead can triage bugs project-wide without opening each cycle. ─────────

const JIRA_STATUS_BADGE: Record<string, string> = {
  done:          'badge-pass',
  indeterminate: 'badge-run',
  new:           'badge-draft',
};

const DUE_BUCKETS = ['Overdue', 'Due this week', 'Later', 'No due date'] as const;
type DueBucket = typeof DUE_BUCKETS[number];

function dueBucket(bug: JiraBugSummaryWithCycles): DueBucket {
  const issue = bug.issue;
  if (!issue?.dueDate) return 'No due date';
  if (isBugOverdue(issue)) return 'Overdue';
  const due = new Date(issue.dueDate);
  const in7Days = new Date(Date.now() + 7 * 86_400_000);
  if (due <= in7Days) return 'Due this week';
  return 'Later';
}

export function AllBugsSection({ projectId }: { projectId: string }) {
  const { data: allBugs = [], isLoading } = useAllTestCycleBugs(projectId);
  const { data: jiraHost } = useJiraHost(projectId);
  const syncNow = useSyncJiraNow(projectId);

  const [jiraStatusFilter, setJiraStatusFilter] = useState<string[]>([]);
  const [assigneeFilter, setAssigneeFilter] = useState<string[]>([]);
  const [reporterFilter, setReporterFilter] = useState<string[]>([]);
  const [cycleFilter, setCycleFilter] = useState<string[]>([]);
  const [dueFilter, setDueFilter] = useState<string[]>([]);
  // Closed bugs are noise once a release is done — default to open-only so the
  // list stays short, with an explicit toggle for someone who wants the full
  // history (e.g. auditing what got fixed).
  const [showClosed, setShowClosed] = useState(false);

  const jiraStatusOptions = [...new Set(allBugs.map((b) => b.issue?.status).filter((s): s is string => !!s))].sort();
  const assigneeOptions = [...new Set(allBugs.map((b) => b.issue?.assigneeName).filter((s): s is string => !!s))].sort();
  const reporterOptions = [...new Set(allBugs.map((b) => b.issue?.reporterName).filter((s): s is string => !!s))].sort();
  const cycleOptions = [...new Set(allBugs.flatMap((b) => b.testCycles.map((c) => c.name)))].sort();

  const closedCount = allBugs.filter((b) => isBugClosed(b.issue)).length;

  const bugs = allBugs.filter((b) => {
    if (!showClosed && isBugClosed(b.issue)) return false;
    if (jiraStatusFilter.length > 0 && (!b.issue?.status || !jiraStatusFilter.includes(b.issue.status))) return false;
    if (assigneeFilter.length > 0 && (!b.issue?.assigneeName || !assigneeFilter.includes(b.issue.assigneeName))) return false;
    if (reporterFilter.length > 0 && (!b.issue?.reporterName || !reporterFilter.includes(b.issue.reporterName))) return false;
    if (cycleFilter.length > 0 && !b.testCycles.some((c) => cycleFilter.includes(c.name))) return false;
    if (dueFilter.length > 0 && !dueFilter.includes(dueBucket(b))) return false;
    return true;
  });

  const overdueCount = allBugs.filter((b) => isBugOverdue(b.issue)).length;

  async function handleSync() {
    try {
      const result = await syncNow.mutateAsync();
      if (result.error) toast.error(result.error);
      else toast.success(`Synced ${result.synced} issue(s)`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Sync failed';
      toast.error(msg);
    }
  }

  const lastSyncedAt = allBugs.reduce<string | null>((latest, b) => {
    const t = b.issue?.lastSyncedAt;
    return t && (!latest || t > latest) ? t : latest;
  }, null);

  return (
    <div style={{ marginTop: '28px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '10px', marginBottom: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
          <h2 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text)', margin: 0 }}>All Bugs</h2>
          {overdueCount > 0 && (
            <span className="badge badge-fail" style={{ fontSize: '10px' }}>{overdueCount} overdue</span>
          )}
        </div>
        <TbBtn variant="ghost" onClick={() => setShowClosed((v) => !v)}>
          {showClosed ? '🙈 Hide Closed' : `👁 Show Closed (${closedCount})`}
        </TbBtn>
      </div>
      <p style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: 0, marginBottom: '12px' }}>
        Every Jira bug linked across this project's test cycles, in one place.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <MultiSelectFilter label="Status" values={jiraStatusFilter} onChange={setJiraStatusFilter} options={jiraStatusOptions} />
        <MultiSelectFilter label="Assignee" values={assigneeFilter} onChange={setAssigneeFilter} options={assigneeOptions} />
        <MultiSelectFilter label="Reporter" values={reporterFilter} onChange={setReporterFilter} options={reporterOptions} />
        <MultiSelectFilter label="Test Cycle" values={cycleFilter} onChange={setCycleFilter} options={cycleOptions} />
        <MultiSelectFilter label="Due Date" values={dueFilter} onChange={setDueFilter} options={[...DUE_BUCKETS]} />
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
          {lastSyncedAt && (
            <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>Synced {new Date(lastSyncedAt).toLocaleString()}</span>
          )}
          <TbBtn variant="ghost" onClick={() => void handleSync()} disabled={syncNow.isPending}>
            {syncNow.isPending ? '⏳ Syncing…' : '🔄 Sync Now'}
          </TbBtn>
        </div>
      </div>

      {isLoading ? (
        <div style={{ color: 'var(--text-dim)', fontSize: '12px' }}>Loading bugs…</div>
      ) : bugs.length === 0 ? (
        <div style={{ color: 'var(--text-dim)', fontSize: '12px', fontFamily: 'var(--font-mono)', padding: '24px', textAlign: 'center' }}>
          {allBugs.length > 0 ? 'No bugs match the current filters.' : 'No Jira bugs linked to any cycle yet.'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ minWidth: '1200px' }}>
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Summary</th>
                <th>Type</th>
                <th>Priority</th>
                <th>Jira Status</th>
                <th>Assignee</th>
                <th>Reporter</th>
                <th>Test Cycle(s)</th>
                <th>Due Date</th>
                <th>TCs</th>
              </tr>
            </thead>
            <tbody>
              {bugs.map((bug) => {
                const overdue = isBugOverdue(bug.issue);
                return (
                  <tr key={bug.issueKey} style={overdue ? { background: 'rgba(220,38,38,0.06)' } : undefined}>
                    <td className="primary" style={{ fontFamily: 'var(--font-mono)' }}>
                      {jiraHost ? (
                        <a href={`${jiraHost}/browse/${bug.issueKey}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--cyan)', textDecoration: 'underline', textUnderlineOffset: '2px' }}>
                          {bug.issueKey}
                        </a>
                      ) : (
                        bug.issueKey
                      )}
                    </td>
                    <td>{bug.issue?.summary ?? <span style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>not yet synced</span>}</td>
                    <td style={{ fontSize: '11px' }}>{bug.issue?.issueType ?? '—'}</td>
                    <td style={{ fontSize: '11px' }}>{bug.issue?.priorityName ?? '—'}</td>
                    <td>
                      {bug.issue?.status ? (
                        <span className={`badge ${JIRA_STATUS_BADGE[bug.issue.statusCategory ?? ''] ?? 'badge-draft'}`}>{bug.issue.status}</span>
                      ) : '—'}
                    </td>
                    <td style={{ fontSize: '11px' }}>{bug.issue?.assigneeName ?? 'Unassigned'}</td>
                    <td style={{ fontSize: '11px' }}>{bug.issue?.reporterName ?? '—'}</td>
                    <td style={{ fontSize: '11px' }} title={bug.testCycles.map((c) => c.name).join(', ')}>
                      {bug.testCycles.length > 1 ? `${bug.testCycles[0].name} +${bug.testCycles.length - 1}` : (bug.testCycles[0]?.name ?? '—')}
                    </td>
                    <td style={{ fontSize: '11px' }}>
                      {bug.issue?.dueDate ? (
                        <span style={overdue ? { color: 'var(--fail)', fontWeight: 700 } : { color: 'var(--text-dim)' }}>
                          {overdue && '⚠ '}{new Date(bug.issue.dueDate).toLocaleDateString()}
                        </span>
                      ) : '—'}
                    </td>
                    <td style={{ fontSize: '11px' }}>
                      <TcIdsCell testCases={bug.testCases} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
