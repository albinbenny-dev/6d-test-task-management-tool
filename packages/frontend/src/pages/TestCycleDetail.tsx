import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import Topbar, { TbBtn } from '../components/layout/Topbar';
import { useProject, useProjectMembers } from '../hooks/useProjects';
import { useProjectStore } from '../stores/projectStore';
import { useRBAC } from '../hooks/useRBAC';
import { useTcItems, parseTcItemLabels, type TcItem } from '../hooks/useTcItems';
import {
  useTestCycle,
  useSetTestCycleStatus,
  useDeleteTestCycle,
  useAssignTestCycleItem,
  useBulkAssignTestCycleItems,
  useUpdateTestCycleItemStatus,
  useTestCycleBugs,
  useUpdateTestCycle,
  useLinkBugToItem,
  useAddTestCycleItems,
  useRemoveTestCycleItem,
  useBulkRemoveTestCycleItems,
} from '../hooks/useTestCycles';
import { useSyncJiraNow, useJiraHost } from '../hooks/useJira';
import { StatCard, JiraRingCard } from '../components/testCycles/StatCards';
import { MultiSelectFilter } from '../components/testCycles/FilterBar';
import { TcIdsCell } from '../components/testCycles/TcIdsCell';
import { StatusPillPicker } from '../components/testCycles/StatusPillPicker';
import { ReasonPopover } from '../components/testCycles/ReasonPopover';
import { JiraKeysCell } from '../components/testCycles/JiraKeyPopover';
import { ItemHistoryTimeline, RetestedBadge, useHasHistory } from '../components/testCycles/ItemHistoryTimeline';
import TestCaseDetailModal from '../components/testCases/TestCaseDetailModal';
import { STATUS_BADGE, STATUS_COLOR, emptyStatusCounts } from '../lib/manualStatus';
import { isBugClosed, isBugOverdue } from '../lib/jiraBugStatus';
import { groupColor, colorToRgba } from '../lib/featureGroupTheme';
import type { TestCycleItem, TestCycleStatus, ManualResultStatus, TestCycle, JiraBugSummary } from '../types';

// ── Status cards — computed client-side from already-fetched items + bugs ──

function CycleStatusCards({ items, bugs, statusFilter, onFilterChange, onViewBugs }: {
  items: TestCycleItem[];
  bugs: JiraBugSummary[];
  statusFilter: ManualResultStatus[];
  onFilterChange: (status: ManualResultStatus[]) => void;
  onViewBugs: () => void;
}) {
  const counts = emptyStatusCounts();
  for (const item of items) counts[item.manualStatus]++;
  const total = items.length;
  const passRate = total > 0 ? Math.round((counts.PASS / total) * 100) : 0;

  const resolvedKeys = new Set(bugs.filter((b) => b.issue?.statusCategory === 'done').map((b) => b.issueKey));

  // Clicking a card toggles that status in/out of the filter (same
  // any-of-several matching every other multi-select filter in the app
  // uses) rather than jumping straight to a single exclusive status.
  function toggle(status: ManualResultStatus) {
    onFilterChange(statusFilter.includes(status) ? statusFilter.filter((s) => s !== status) : [...statusFilter, status]);
  }

  return (
    // Fixed-column grid, not flex-wrap — flex-wrap redistributes leftover
    // space unevenly across however many cards land on the last line, so
    // proportions visibly shifted between filter states. Grid columns are
    // always the same width regardless of which card is selected.
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '10px' }}>
      <StatCard compact label="Total" value={total} theme="total" highlighted={statusFilter.length === 0} onClick={() => onFilterChange([])} />
      <StatCard compact label="Passed" value={counts.PASS} theme="pass" selected={statusFilter.includes('PASS')} onClick={() => toggle('PASS')} />
      <StatCard compact label="Failed" value={counts.FAIL} theme="fail" selected={statusFilter.includes('FAIL')} onClick={() => toggle('FAIL')} />
      <StatCard compact label="In Progress" value={counts.IN_PROGRESS} theme="progress" selected={statusFilter.includes('IN_PROGRESS')} onClick={() => toggle('IN_PROGRESS')} />
      <StatCard compact label="Blocked" value={counts.BLOCKED} theme="blocked" selected={statusFilter.includes('BLOCKED')} onClick={() => toggle('BLOCKED')} />
      <StatCard compact label="Untested" value={counts.NOT_RUN} theme="untested" selected={statusFilter.includes('NOT_RUN')} onClick={() => toggle('NOT_RUN')} />
      <JiraRingCard compact tickets={{ resolved: resolvedKeys.size, total: bugs.length }} onClick={onViewBugs} />
      <StatCard compact label="Pass Rate" value={`${passRate}%`} theme="passRate" highlighted />
    </div>
  );
}

// ── Assignee picker — dropdown of all project members ─────────────────────

function AssigneePicker({ projectId, item, onAssign }: {
  projectId: string;
  item: TestCycleItem;
  onAssign: (userId: string | null) => void;
}) {
  const { data: members = [] } = useProjectMembers(projectId);
  const { isTestUser } = useRBAC();
  const { currentUser } = useProjectStore();

  // TEST_USER may only ever assign a test case to themselves — never to a
  // peer. Peer options stay visible (so the picker still shows who it's
  // currently assigned to) but disabled, so the only real choices are
  // Unassigned or themselves.
  const canPickAnyone = !isTestUser;

  return (
    <select
      className="input-field"
      value={item.assignee?.user.id ?? ''}
      onChange={(e) => onAssign(e.target.value || null)}
      title={!canPickAnyone ? 'You can only assign test cases to yourself' : undefined}
      // Fills its grid cell exactly (FEATURE_GRID's Assignee column is 150px) —
      // a hardcoded 180px here overflowed into the Status column next to it.
      style={{ fontSize: '12px', padding: '4px 8px', width: '100%', boxSizing: 'border-box' }}
    >
      <option value="">Unassigned</option>
      {members.map((m) => (
        <option key={m.userId} value={m.userId} disabled={!canPickAnyone && m.userId !== currentUser?.id}>{m.user.name}</option>
      ))}
    </select>
  );
}

// ── Bugs tab ─────────────────────────────────────────────────────────────

function LinkBugCell({ projectId, cycleId, issueKey, items }: {
  projectId: string; cycleId: string; issueKey: string; items: TestCycleItem[];
}) {
  const [selectedItemId, setSelectedItemId] = useState('');
  const linkBug = useLinkBugToItem(projectId);

  async function handleLink() {
    if (!selectedItemId) return;
    try {
      await linkBug.mutateAsync({ cycleId, issueKey, testCycleItemId: selectedItemId });
      toast.success(`Linked ${issueKey}`);
      setSelectedItemId('');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to link';
      toast.error(msg);
    }
  }

  return (
    <div style={{ display: 'flex', gap: '6px' }}>
      <select
        className="input-field"
        value={selectedItemId}
        onChange={(e) => setSelectedItemId(e.target.value)}
        style={{ fontSize: '11px', padding: '3px 6px', width: '160px' }}
      >
        <option value="">Link to test case…</option>
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.testCase?.srNo} — {item.manualStatus}
          </option>
        ))}
      </select>
      <TbBtn variant="ghost" onClick={() => void handleLink()} disabled={!selectedItemId || linkBug.isPending}>
        {linkBug.isPending ? '…' : 'Link'}
      </TbBtn>
    </div>
  );
}

function parseJsonArray(s: string | undefined | null): string[] {
  if (!s) return [];
  try { return JSON.parse(s) as string[]; } catch { return []; }
}

const JIRA_STATUS_BADGE: Record<string, string> = {
  done:          'badge-pass',
  indeterminate: 'badge-run',
  new:           'badge-draft',
};

function BugsTab({ projectId, cycleId, items, statusFilter }: {
  projectId: string;
  cycleId: string;
  items: TestCycleItem[];
  statusFilter: ManualResultStatus[];
}) {
  const { data: allBugs = [], isLoading } = useTestCycleBugs(projectId, cycleId);
  const { data: jiraHost } = useJiraHost(projectId);
  const syncNow = useSyncJiraNow(projectId);
  const [jiraStatusFilter, setJiraStatusFilter] = useState<string[]>([]);
  const [assigneeFilter, setAssigneeFilter] = useState<string[]>([]);
  const [componentFilter, setComponentFilter] = useState<string[]>([]);
  const [reporterFilter, setReporterFilter] = useState<string[]>([]);
  // Closed bugs are noise once a release is done — default to open-only,
  // same as the project-wide bug board, with an explicit toggle to see them.
  const [showClosed, setShowClosed] = useState(false);

  // A bug "matches" the manual-status filter if it's linked to at least one
  // test case currently at ANY of the selected statuses. Bugs with no links
  // yet are kept regardless — there's nothing to compare them against, so
  // hiding them would just lose visibility of not-yet-linked bugs.
  const filteredTestCaseIds = statusFilter.length > 0
    ? new Set(items.filter((i) => statusFilter.includes(i.manualStatus)).map((i) => i.testCaseId))
    : null;
  const statusMatched = filteredTestCaseIds
    ? allBugs.filter((b) => b.testCases.length === 0 || b.testCases.some((tc) => filteredTestCaseIds.has(tc.id)))
    : allBugs;

  const jiraStatusOptions = [...new Set(allBugs.map((b) => b.issue?.status).filter((s): s is string => !!s))].sort();
  const assigneeOptions = [...new Set(allBugs.map((b) => b.issue?.assigneeName).filter((s): s is string => !!s))].sort();
  const componentOptions = [...new Set(allBugs.flatMap((b) => parseJsonArray(b.issue?.components)))].sort();
  const reporterOptions = [...new Set(allBugs.map((b) => b.issue?.reporterName).filter((s): s is string => !!s))].sort();
  const closedCount = allBugs.filter((b) => isBugClosed(b.issue)).length;

  const bugs = statusMatched.filter((b) => {
    if (!showClosed && isBugClosed(b.issue)) return false;
    if (jiraStatusFilter.length > 0 && (!b.issue?.status || !jiraStatusFilter.includes(b.issue.status))) return false;
    if (assigneeFilter.length > 0 && (!b.issue?.assigneeName || !assigneeFilter.includes(b.issue.assigneeName))) return false;
    if (componentFilter.length > 0 && !parseJsonArray(b.issue?.components).some((c) => componentFilter.includes(c))) return false;
    if (reporterFilter.length > 0 && (!b.issue?.reporterName || !reporterFilter.includes(b.issue.reporterName))) return false;
    return true;
  });

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

  const filterBar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
      <MultiSelectFilter label="Jira Status" values={jiraStatusFilter} onChange={setJiraStatusFilter} options={jiraStatusOptions} />
      <MultiSelectFilter label="Assignee" values={assigneeFilter} onChange={setAssigneeFilter} options={assigneeOptions} />
      <MultiSelectFilter label="Reporter" values={reporterFilter} onChange={setReporterFilter} options={reporterOptions} />
      <MultiSelectFilter label="Component" values={componentFilter} onChange={setComponentFilter} options={componentOptions} />
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <TbBtn variant="ghost" onClick={() => setShowClosed((v) => !v)}>
          {showClosed ? '🙈 Hide Closed' : `👁 Show Closed (${closedCount})`}
        </TbBtn>
        {lastSyncedAt && (
          <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>Synced {new Date(lastSyncedAt).toLocaleString()}</span>
        )}
        <TbBtn variant="ghost" onClick={() => void handleSync()} disabled={syncNow.isPending}>
          {syncNow.isPending ? '⏳ Syncing…' : '🔄 Sync Now'}
        </TbBtn>
      </div>
    </div>
  );

  if (isLoading) return <div style={{ color: 'var(--text-dim)', fontSize: '12px' }}>Loading bugs…</div>;
  if (bugs.length === 0) {
    return (
      <>
        {filterBar}
        <div style={{ color: 'var(--text-dim)', fontSize: '12px', fontFamily: 'var(--font-mono)', padding: '24px', textAlign: 'center' }}>
          {allBugs.length > 0 ? 'No bugs match the current filters.' : 'No Jira bugs linked to this cycle yet.'}
        </div>
      </>
    );
  }

  return (
    <>
      {filterBar}
      <div style={{ overflowX: 'auto' }}>
      <table className="data-table" style={{ minWidth: '1200px' }}>
        <thead>
          <tr>
            <th>Ticket</th>
            <th>Summary</th>
            <th>Type</th>
            <th>Priority</th>
            <th>Component</th>
            <th>Labels</th>
            <th>Jira Status</th>
            <th>Assignee</th>
            <th>Reporter</th>
            <th>Created</th>
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
              <td style={{ fontSize: '11px' }}>{parseJsonArray(bug.issue?.components).join(', ') || '—'}</td>
              <td style={{ fontSize: '11px' }}>{parseJsonArray(bug.issue?.labels).join(', ') || '—'}</td>
              <td>
                {bug.issue?.status ? (
                  <span className={`badge ${JIRA_STATUS_BADGE[bug.issue.statusCategory ?? ''] ?? 'badge-draft'}`}>{bug.issue.status}</span>
                ) : '—'}
              </td>
              <td style={{ fontSize: '11px' }}>{bug.issue?.assigneeName ?? 'Unassigned'}</td>
              <td style={{ fontSize: '11px' }}>{bug.issue?.reporterName ?? '—'}</td>
              <td style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                {bug.issue?.jiraCreatedAt ? new Date(bug.issue.jiraCreatedAt).toLocaleDateString() : '—'}
              </td>
              <td style={{ fontSize: '11px' }}>
                {bug.issue?.dueDate ? (
                  <span style={overdue ? { color: 'var(--fail)', fontWeight: 700 } : { color: 'var(--text-dim)' }}>
                    {overdue && '⚠ '}{new Date(bug.issue.dueDate).toLocaleDateString()}
                  </span>
                ) : '—'}
              </td>
              <td style={{ fontSize: '11px' }}>
                {bug.testCases.length > 0 ? (
                  <TcIdsCell testCases={bug.testCases} />
                ) : items.length > 0 ? (
                  <LinkBugCell projectId={projectId} cycleId={cycleId} issueKey={bug.issueKey} items={items} />
                ) : (
                  <span style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>0</span>
                )}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </>
  );
}

// ── Test Cases tab — merges what used to be separate Items/Features tabs.
// Same TC-Library-style grouped-by-feature visual language as
// TestCaseLibrary.tsx, but each row carries this cycle's full manual-result
// detail (assignee, status, reason, Jira keys, last updated) since there's
// no separate flat list anymore. Groups start collapsed; the header shows a
// segmented status bar + pass rate, same as the page's own stat cards. ─────

// Status column widened (130 -> 170) to fit the pill + a conditional
// "Retested" badge without overflowing into the next column (Jira Keys and
// Updated trimmed slightly to compensate — dates/short keys still fit fine).
// The leading checkbox column only exists for managers (it drives bulk
// delete, which is gated the same way as the per-row 🗑 button) — grid and
// headers are computed per-viewer so read-only members don't get a dead
// column of empty space.
const FEATURE_GRID_TAIL = '90px minmax(140px, 1fr) 150px 170px 40px 90px 100px 32px 32px';
const FEATURE_HEADERS_TAIL = ['TC ID', 'Test Case', 'Assignee', 'Status', 'Reason', 'Jira Keys', 'Updated', '', ''];
function featureGrid(canManage: boolean): string {
  return canManage ? `20px 24px ${FEATURE_GRID_TAIL}` : `24px ${FEATURE_GRID_TAIL}`;
}
function featureHeaders(canManage: boolean): string[] {
  return canManage ? ['', '', ...FEATURE_HEADERS_TAIL] : ['', ...FEATURE_HEADERS_TAIL];
}

function InlineResultEditor({ item, pendingStatus, onSave, onCancel }: {
  item: TestCycleItem;
  pendingStatus: ManualResultStatus;
  onSave: (data: { status: ManualResultStatus; reason: string; jiraIssueKeys: string[] }) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState(item.reason ?? '');
  const [jiraKeysInput, setJiraKeysInput] = useState(() => {
    try { return (JSON.parse(item.jiraIssueKeys) as string[]).join(', '); } catch { return ''; }
  });

  function handleSave() {
    if (!reason.trim()) { toast.error('A reason is required'); return; }
    const jiraIssueKeys = jiraKeysInput.split(',').map((k) => k.trim()).filter(Boolean);
    onSave({ status: pendingStatus, reason: reason.trim(), jiraIssueKeys });
  }

  return (
    <div style={{ padding: '10px 14px 12px 46px', background: 'var(--surface2)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '480px' }}>
        <label style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-mid)' }}>
          Reason (required for {pendingStatus})
        </label>
        <textarea className="input-field" autoFocus rows={2} value={reason} onChange={(e) => setReason(e.target.value)} style={{ resize: 'vertical' }} />
        <label style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-mid)' }}>
          Jira issue keys (comma-separated, optional)
        </label>
        <input className="input-field" value={jiraKeysInput} onChange={(e) => setJiraKeysInput(e.target.value)} placeholder="e.g. PROJ-123, PROJ-456" />
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <TbBtn variant="ghost" onClick={onCancel}>Cancel</TbBtn>
          <TbBtn variant="primary" onClick={handleSave}>Save Result</TbBtn>
        </div>
      </div>
    </div>
  );
}

function FeatureItemRow({ item, canEdit, lockedReason, canManage, selected, onToggleSelect, onAssign, onStatusChange, onRemove, isEditingResult, pendingStatus, onSaveResult, onCancelResult, onViewTestCase }: {
  item: TestCycleItem;
  canEdit: boolean;
  lockedReason: string | null;
  canManage: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onAssign: (userId: string | null) => void;
  onStatusChange: (status: ManualResultStatus) => void;
  onRemove: () => void;
  isEditingResult: boolean;
  pendingStatus: ManualResultStatus | null;
  onSaveResult: (body: { status: ManualResultStatus; reason: string; jiraIssueKeys: string[] }) => void;
  onCancelResult: () => void;
  onViewTestCase: (itemId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const tc = item.testCase;
  const itemLabels = parseTcItemLabels(tc?.labels ?? '[]');
  const hasHistory = useHasHistory(item.projectId, item.testCycleId, item.id);
  const hasDetail = !!(tc?.description || tc?.steps || tc?.expectedResult) || itemLabels.length > 0 || hasHistory;

  return (
    <div style={{ borderBottom: '1px solid var(--border)', background: selected ? 'var(--cyan-dim)' : undefined }}>
      <div style={{ display: 'grid', gridTemplateColumns: featureGrid(canManage), gap: '8px', padding: '8px 14px', alignItems: 'center' }}>
        {canManage && (
          <input type="checkbox" checked={selected} onChange={onToggleSelect} style={{ cursor: 'pointer' }} />
        )}
        <button
          title={expanded ? 'Collapse detail' : hasDetail ? 'Expand description, steps & expected result' : 'No detail available'}
          onClick={() => hasDetail && setExpanded((v) => !v)}
          style={{ width: '16px', height: '16px', borderRadius: '3px', background: expanded ? 'var(--cyan-dim)' : 'var(--surface2)', border: `1px solid ${expanded ? 'rgba(37,99,171,0.35)' : 'var(--border)'}`, color: expanded ? 'var(--cyan)' : hasDetail ? 'var(--text)' : 'var(--border)', fontSize: '8px', cursor: hasDetail ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
        >{expanded ? '▲' : '▼'}</button>

        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--cyan)', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tc?.srNo ?? '—'}</span>

        <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={tc?.title}>{tc?.title}</span>

        <AssigneePicker projectId={item.projectId} item={item} onAssign={onAssign} />

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <StatusPillPicker value={item.manualStatus} disabled={!canEdit} disabledReason={lockedReason} onChange={onStatusChange} />
          {lockedReason && (
            <span title={lockedReason} style={{ fontSize: '11px', color: 'var(--amber)', cursor: 'help' }}>⚠</span>
          )}
          <RetestedBadge projectId={item.projectId} cycleId={item.testCycleId} itemId={item.id} currentStatus={item.manualStatus} />
        </div>

        <ReasonPopover reason={item.reason} />

        <JiraKeysCell jiraIssueKeys={item.jiraIssueKeys} projectId={item.projectId} cycleId={item.testCycleId} itemId={item.id} canUnlink={canEdit} />

        <span style={{ fontSize: '10px', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
          {item.lastUpdatedAt ? new Date(item.lastUpdatedAt).toLocaleDateString() : '—'}
        </span>

        <button
          onClick={() => onViewTestCase(item.testCaseId)}
          title="View test case"
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', color: 'var(--text-dim)' }}
        >
          👁
        </button>

        {canManage && (
          <button
            onClick={onRemove}
            title="Remove from cycle"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', color: 'var(--text-dim)' }}
          >
            🗑
          </button>
        )}
      </div>

      {expanded && (
        <div style={{ padding: '6px 14px 12px 46px', background: 'var(--surface2)', borderLeft: '2px solid rgba(37,99,171,0.2)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {tc?.description && (
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '3px' }}>Description</div>
              <div style={{ fontSize: '11px', color: 'var(--text)', lineHeight: 1.5 }}>{tc.description}</div>
            </div>
          )}
          {tc?.steps && (
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '3px' }}>Steps</div>
              <pre style={{ margin: 0, fontSize: '11px', color: 'var(--text)', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{tc.steps}</pre>
            </div>
          )}
          {tc?.expectedResult && (
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '3px' }}>Expected Result</div>
              <div style={{ fontSize: '11px', color: 'var(--emerald)', lineHeight: 1.5 }}>{tc.expectedResult}</div>
            </div>
          )}
          {itemLabels.length > 0 && (
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '3px' }}>Labels</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {itemLabels.map((l) => <span key={l} className="tag">{l}</span>)}
              </div>
            </div>
          )}
          {item.reason && (
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '3px' }}>Reason</div>
              <div style={{ fontSize: '11px', color: 'var(--text)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{item.reason}</div>
            </div>
          )}
          {hasHistory && (
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '3px' }}>History</div>
              <ItemHistoryTimeline projectId={item.projectId} cycleId={item.testCycleId} itemId={item.id} />
            </div>
          )}
        </div>
      )}

      {isEditingResult && pendingStatus && (
        <InlineResultEditor item={item} pendingStatus={pendingStatus} onSave={onSaveResult} onCancel={onCancelResult} />
      )}
    </div>
  );
}

function FeatureGroup({ feature, color, items, canEditItem, statusLockedReason, canManage, selectedIds, onToggleSelect, onToggleGroupSelect, onAssign, onStatusChange, onRemove, editingItemId, editingStatus, onSaveResult, onCancelResult, onViewTestCase }: {
  feature: string;
  color: string;
  items: TestCycleItem[];
  canEditItem: (item: TestCycleItem) => boolean;
  statusLockedReason: (item: TestCycleItem) => string | null;
  canManage: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (itemId: string) => void;
  onToggleGroupSelect: (itemIds: string[]) => void;
  onAssign: (itemId: string, userId: string | null) => void;
  onRemove: (item: TestCycleItem) => void;
  onStatusChange: (item: TestCycleItem, status: ManualResultStatus) => void;
  editingItemId: string | null;
  editingStatus: ManualResultStatus | null;
  onSaveResult: (itemId: string, body: { status: ManualResultStatus; reason: string; jiraIssueKeys: string[] }) => void;
  onCancelResult: () => void;
  onViewTestCase: (itemId: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const counts = emptyStatusCounts();
  for (const item of items) counts[item.manualStatus]++;
  const total = items.length;
  const passRate = total > 0 ? Math.round((counts.PASS / total) * 100) : 0;
  const segments: ManualResultStatus[] = ['PASS', 'FAIL', 'IN_PROGRESS', 'BLOCKED', 'NOT_RUN'];
  const groupIds = items.map((i) => i.id);
  const allSelected = total > 0 && groupIds.every((id) => selectedIds.has(id));
  const someSelected = !allSelected && groupIds.some((id) => selectedIds.has(id));

  return (
    <div style={{ background: 'var(--surface)', border: `1px solid ${colorToRgba(color, 0.25)}`, borderRadius: 'var(--radius-lg)', overflow: 'hidden', boxShadow: 'var(--shadow-card)' }}>
      <div
        onClick={() => setIsOpen((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', background: `linear-gradient(90deg, ${colorToRgba(color, 0.07)}, transparent)`, borderBottom: isOpen ? `1px solid ${colorToRgba(color, 0.2)}` : 'none', cursor: 'pointer', userSelect: 'none' }}
      >
        {canManage && (
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => { if (el) el.indeterminate = someSelected; }}
            onClick={(e) => e.stopPropagation()}
            onChange={() => onToggleGroupSelect(groupIds)}
            title="Select all in this feature"
            style={{ cursor: 'pointer', flexShrink: 0 }}
          />
        )}
        <span style={{ fontSize: '11px', color: 'var(--text-dim)', minWidth: '10px', display: 'inline-block', transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}>▼</span>
        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: `var(${color})`, flexShrink: 0 }} />
        <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{feature}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{total} TCs</span>
        <div style={{ display: 'flex', height: '8px', width: '110px', borderRadius: '4px', background: 'var(--surface2)', gap: '2px', overflow: 'hidden', flexShrink: 0 }}>
          {total > 0 && segments.filter((s) => counts[s] > 0).map((s) => (
            <div key={s} title={`${s}: ${counts[s]}`} style={{ width: `${(counts[s] / total) * 100}%`, background: STATUS_COLOR[s], borderRadius: '2px' }} />
          ))}
        </div>
        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text)', width: '70px', textAlign: 'right', flexShrink: 0 }}>
          {passRate}% <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>({total})</span>
        </span>
      </div>

      {isOpen && total > 0 && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: featureGrid(canManage), gap: '8px', padding: '6px 14px', background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
            {featureHeaders(canManage).map((col, i) => (
              <div key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--text-dim)', letterSpacing: '1px', fontWeight: 700 }}>{col}</div>
            ))}
          </div>
          {items.map((item) => (
            <FeatureItemRow
              key={item.id}
              item={item}
              canEdit={canEditItem(item)}
              lockedReason={statusLockedReason(item)}
              canManage={canManage}
              selected={selectedIds.has(item.id)}
              onToggleSelect={() => onToggleSelect(item.id)}
              onAssign={(userId) => onAssign(item.id, userId)}
              onStatusChange={(status) => onStatusChange(item, status)}
              onRemove={() => onRemove(item)}
              isEditingResult={editingItemId === item.id}
              pendingStatus={editingItemId === item.id ? editingStatus : null}
              onSaveResult={(body) => onSaveResult(item.id, body)}
              onCancelResult={onCancelResult}
              onViewTestCase={onViewTestCase}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TestCasesTab({ items, groupBy, canEditItem, statusLockedReason, canManage, selectedIds, onToggleSelect, onToggleGroupSelect, onAssign, onStatusChange, onRemove, editingItemId, editingStatus, onSaveResult, onCancelResult, onViewTestCase }: {
  items: TestCycleItem[];
  groupBy: 'feature' | 'assignee';
  canEditItem: (item: TestCycleItem) => boolean;
  statusLockedReason: (item: TestCycleItem) => string | null;
  canManage: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (itemId: string) => void;
  onToggleGroupSelect: (itemIds: string[]) => void;
  onAssign: (itemId: string, userId: string | null) => void;
  onStatusChange: (item: TestCycleItem, status: ManualResultStatus) => void;
  onRemove: (item: TestCycleItem) => void;
  editingItemId: string | null;
  editingStatus: ManualResultStatus | null;
  onSaveResult: (itemId: string, body: { status: ManualResultStatus; reason: string; jiraIssueKeys: string[] }) => void;
  onCancelResult: () => void;
  onViewTestCase: (itemId: string) => void;
}) {
  const groups = new Map<string, TestCycleItem[]>();
  for (const item of items) {
    const key = groupBy === 'assignee'
      ? (item.assignee?.user.name ?? 'Unassigned')
      : (item.testCase?.feature ?? item.testCase?.module ?? 'Uncategorised');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }
  const features = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  if (features.length === 0) {
    return <div style={{ color: 'var(--text-dim)', fontSize: '12px', fontFamily: 'var(--font-mono)', padding: '24px', textAlign: 'center' }}>No test cases in this cycle yet.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {features.map(([feature, featureItems], i) => (
        <FeatureGroup
          key={feature}
          feature={feature}
          color={groupColor(i)}
          items={featureItems}
          canEditItem={canEditItem}
          statusLockedReason={statusLockedReason}
          canManage={canManage}
          selectedIds={selectedIds}
          onToggleSelect={onToggleSelect}
          onToggleGroupSelect={onToggleGroupSelect}
          onAssign={onAssign}
          onStatusChange={onStatusChange}
          onRemove={onRemove}
          editingItemId={editingItemId}
          editingStatus={editingStatus}
          onSaveResult={onSaveResult}
          onCancelResult={onCancelResult}
          onViewTestCase={onViewTestCase}
        />
      ))}
    </div>
  );
}

// ── Edit-cycle modal — name/description/Jira labels ────────────────────────

function EditCycleModal({ cycle, onClose, onSave, isSaving }: {
  cycle: TestCycle;
  onClose: () => void;
  onSave: (data: { name: string; description?: string; jiraLabels: string[]; jiraJql?: string | null; driveFolderUrl?: string | null; dueDate?: string | null }) => void;
  isSaving: boolean;
}) {
  const [name, setName] = useState(cycle.name);
  const [description, setDescription] = useState(cycle.description ?? '');
  const [jiraLabelsInput, setJiraLabelsInput] = useState(() => {
    try { return (JSON.parse(cycle.jiraLabels) as string[]).join(', '); } catch { return ''; }
  });
  const [jiraJql, setJiraJql] = useState(cycle.jiraJql ?? '');
  const [driveFolderUrl, setDriveFolderUrl] = useState(cycle.driveFolderUrl ?? '');
  const [dueDate, setDueDate] = useState(cycle.dueDate ? cycle.dueDate.slice(0, 10) : '');

  function handleSubmit() {
    if (!name.trim()) { toast.error('Cycle name is required'); return; }
    const jiraLabels = jiraLabelsInput.split(',').map((l) => l.trim()).filter(Boolean);
    onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      jiraLabels,
      jiraJql: jiraJql.trim() || null,
      driveFolderUrl: driveFolderUrl.trim() || null,
      dueDate: dueDate ? new Date(dueDate).toISOString() : null,
    });
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
      onClick={onClose}
    >
      <div className="card" style={{ width: '480px', padding: '24px' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text)', marginBottom: '16px' }}>Edit Test Cycle</div>

        <label style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-mid)', marginBottom: '4px' }}>Name</label>
        <input className="input-field" value={name} onChange={(e) => setName(e.target.value)} style={{ marginBottom: '12px' }} />

        <label style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-mid)', marginBottom: '4px' }}>Description</label>
        <textarea className="input-field" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} style={{ marginBottom: '12px', resize: 'vertical' }} />

        <label style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-mid)', marginBottom: '4px' }}>Due date</label>
        <input
          type="date"
          className="input-field"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          style={{ marginBottom: '16px' }}
        />

        <label style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-mid)', marginBottom: '4px' }}>Jira labels</label>
        <input
          className="input-field"
          value={jiraLabelsInput}
          onChange={(e) => setJiraLabelsInput(e.target.value)}
          placeholder="e.g. opco-nigeria, release-4.2"
          style={{ marginBottom: '4px' }}
        />
        <p style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '16px' }}>
          Comma-separated. Auto-discovers bugs tagged with these labels, bounded to this cycle's active window.
        </p>

        <label style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-mid)', marginBottom: '4px' }}>Custom JQL</label>
        <textarea
          className="input-field"
          value={jiraJql}
          onChange={(e) => setJiraJql(e.target.value)}
          placeholder='e.g. project = "AAVM" AND component = "POS" AND status != Closed'
          rows={2}
          style={{ marginBottom: '4px', resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: '11px' }}
        />
        <p style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '16px' }}>
          Runs alongside the labels above, refreshed on the next sync. Clear it to stop discovering via this query.
        </p>

        <label style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-mid)', marginBottom: '4px' }}>Drive folder</label>
        <input
          className="input-field"
          value={driveFolderUrl}
          onChange={(e) => setDriveFolderUrl(e.target.value)}
          placeholder="https://drive.google.com/drive/folders/…"
          style={{ marginBottom: '4px' }}
        />
        <p style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '16px' }}>
          Shared with testers so they can upload execution evidence into TC-ID-named subfolders. Shown as a link on this page.
        </p>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <TbBtn variant="ghost" onClick={onClose}>Cancel</TbBtn>
          <TbBtn variant="primary" onClick={handleSubmit} disabled={isSaving}>{isSaving ? 'Saving…' : 'Save'}</TbBtn>
        </div>
      </div>
    </div>
  );
}

// ── Add Test Cases modal — same grouped-by-feature checkbox picker as
// CreateCycleModal (TestCycles.tsx), scoped to test cases not already in
// this cycle. Structured as fixed header / scrollable body / fixed footer
// so the picker gets a large, dedicated height regardless of how the rest
// of the modal is sized (see the New Test Cycle modal fix this covers). ──

function AddTestCasesModal({ projectId, cycleId, existingTestCaseIds, onClose, onSuccess }: {
  projectId: string;
  cycleId: string;
  existingTestCaseIds: Set<string>;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { data: allTcItems = [], isLoading } = useTcItems(projectId);
  const addItems = useAddTestCycleItems(projectId);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const availableItems = useMemo(
    () => allTcItems.filter((tc) => !existingTestCaseIds.has(tc.id)),
    [allTcItems, existingTestCaseIds],
  );

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? availableItems.filter((tc) =>
          tc.title.toLowerCase().includes(q) ||
          (tc.srNo ?? '').toLowerCase().includes(q) ||
          (tc.feature ?? '').toLowerCase().includes(q))
      : availableItems;
    const map = new Map<string, TcItem[]>();
    for (const tc of filtered) {
      const key = tc.feature ?? tc.module ?? 'Uncategorised';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(tc);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [availableItems, search]);

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleGroup(ids: string[]) {
    setSelectedIds((prev) => {
      const allSelected = ids.every((id) => prev.has(id));
      const next = new Set(prev);
      ids.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  }

  async function handleSubmit() {
    if (selectedIds.size === 0) { toast.error('Select at least one test case'); return; }
    try {
      const result = await addItems.mutateAsync({ cycleId, testCaseIds: [...selectedIds] });
      toast.success(`${result.added} test case${result.added === 1 ? '' : 's'} added to cycle`);
      onSuccess();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to add test cases';
      toast.error(msg);
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: '640px', maxHeight: '92vh', display: 'flex', flexDirection: 'column', padding: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text)', padding: '24px 24px 0', flexShrink: 0 }}>Add Test Cases to Cycle</div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <label style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-mid)' }}>
              Test cases ({selectedIds.size} selected)
            </label>
            <input
              className="input-field"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="🔍 Search by ID, title, or feature…"
              style={{ fontSize: '11px', padding: '4px 8px', width: '220px' }}
            />
          </div>
          <div style={{ height: '340px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px' }}>
            {isLoading ? (
              <div style={{ fontSize: '12px', color: 'var(--text-dim)', textAlign: 'center', padding: '16px' }}>Loading…</div>
            ) : groups.length === 0 ? (
              <div style={{ fontSize: '12px', color: 'var(--text-dim)', textAlign: 'center', padding: '16px' }}>
                {search ? 'No test cases match your search.' : 'Every test case in this project is already in this cycle.'}
              </div>
            ) : (
              groups.map(([feature, tcs], i) => {
                const ids = tcs.map((t) => t.id);
                const allSelected = ids.every((id) => selectedIds.has(id));
                const color = groupColor(i);
                return (
                  <div key={feature} style={{ marginBottom: '10px', borderRadius: '8px', overflow: 'hidden', border: `1px solid ${colorToRgba(color, 0.2)}` }}>
                    <label
                      style={{
                        display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: 700, color: 'var(--text)', cursor: 'pointer',
                        padding: '6px 10px', background: `linear-gradient(90deg, ${colorToRgba(color, 0.07)}, transparent)`,
                      }}
                    >
                      <input type="checkbox" checked={allSelected} onChange={() => toggleGroup(ids)} />
                      <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: `var(${color})`, flexShrink: 0 }} />
                      {feature} <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>({tcs.length})</span>
                    </label>
                    <div style={{ padding: '6px 10px 8px 30px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      {tcs.map((tc) => (
                        <label key={tc.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-mid)', cursor: 'pointer' }}>
                          <input type="checkbox" checked={selectedIds.has(tc.id)} onChange={() => toggleOne(tc.id)} />
                          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--cyan)' }}>{tc.srNo ?? '—'}</span> {tc.title}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '16px 24px 24px', flexShrink: 0, borderTop: '1px solid var(--border)' }}>
          <TbBtn variant="ghost" onClick={onClose}>Cancel</TbBtn>
          <TbBtn variant="primary" onClick={handleSubmit} disabled={addItems.isPending}>
            {addItems.isPending ? 'Adding…' : 'Add to Cycle'}
          </TbBtn>
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function TestCycleDetail() {
  const { slug, cycleId } = useParams<{ slug: string; cycleId: string }>();
  const navigate = useNavigate();
  const { data: project } = useProject(slug);
  const projectId = project?.id ?? '';
  const { currentUser } = useProjectStore();
  const { canManageTestCycles } = useRBAC();

  const { data, isLoading } = useTestCycle(projectId, cycleId);
  const { data: bugs = [] } = useTestCycleBugs(projectId, cycleId);
  const setStatus  = useSetTestCycleStatus(projectId);
  const deleteCycle = useDeleteTestCycle(projectId);
  const assignItem = useAssignTestCycleItem(projectId);
  const updateItemStatus = useUpdateTestCycleItemStatus(projectId);
  const updateCycle = useUpdateTestCycle(projectId);
  const removeItem = useRemoveTestCycleItem(projectId);
  const bulkRemoveItems = useBulkRemoveTestCycleItems(projectId);
  const bulkAssignItems = useBulkAssignTestCycleItems(projectId);
  const { data: members = [] } = useProjectMembers(projectId);

  const [activeTab, setActiveTab] = useState<'testcases' | 'bugs'>('testcases');
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingStatus, setEditingStatus] = useState<ManualResultStatus | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAddTcModal, setShowAddTcModal] = useState(false);
  const [viewingItemId, setViewingItemId] = useState<string | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  // Clicking a stat card filters Items/Features/Bugs down to any of the
  // selected statuses — shared across both tabs so switching tabs keeps the
  // same filter.
  const [statusFilter, setStatusFilter] = useState<ManualResultStatus[]>([]);
  // Assignee/Feature filters only apply to the Test Cases tab — Bugs has its
  // own separate Jira-Status/Assignee/Component filter row.
  const [assigneeFilter, setAssigneeFilter] = useState<string[]>([]);
  const [featureFilter, setFeatureFilter] = useState<string[]>([]);
  // How the Test Cases tab groups its rows — Feature stays the default since
  // that's the shape people expect from TC Library; Assignee is the
  // alternative for a lead scanning per-tester workload within one cycle.
  const [groupBy, setGroupBy] = useState<'feature' | 'assignee'>('feature');

  if (isLoading || !data) {
    return <div style={{ padding: '24px', color: 'var(--text-dim)', fontSize: '12px' }}>Loading cycle…</div>;
  }
  const { cycle, items } = data;
  // The cycle's own configured jiraLabels (used for Jira bug auto-discovery),
  // not an aggregate of TC Library tags — see TestCycle.jiraLabels.
  const cycleLabels = (() => {
    try { return JSON.parse(cycle.jiraLabels) as string[]; } catch { return []; }
  })();
  const assigneeOptions = [...new Set(items.map((i) => i.assignee?.user.name ?? 'Unassigned'))].sort();
  const featureOptions = [...new Set(items.map((i) => i.testCase?.feature ?? i.testCase?.module ?? 'Uncategorised'))].sort();
  const filteredItems = items.filter((i) => {
    if (statusFilter.length > 0 && !statusFilter.includes(i.manualStatus)) return false;
    if (assigneeFilter.length > 0 && !assigneeFilter.includes(i.assignee?.user.name ?? 'Unassigned')) return false;
    if (featureFilter.length > 0 && !featureFilter.includes(i.testCase?.feature ?? i.testCase?.module ?? 'Uncategorised')) return false;
    return true;
  });

  const isPrivileged = canManageTestCycles;

  // Hard business-rule gates (mirrored on the backend, which is the real
  // enforcement point) — apply to every role, including privileged ones:
  // a result recorded before the cycle starts, or against an unassigned
  // item, isn't a meaningful test result.
  function statusLockedReason(item: TestCycleItem): string | null {
    if (cycle.status === 'PLANNING') return 'Start the cycle before recording results';
    if (!item.assignee) return 'Assign this test case before recording a result';
    return null;
  }

  function canEditItem(item: TestCycleItem): boolean {
    if (statusLockedReason(item)) return false;
    if (isPrivileged) return true;
    return !!item.assignee && item.assignee.user.id === currentUser?.id;
  }

  async function handleAssign(itemId: string, userId: string | null) {
    try {
      await assignItem.mutateAsync({ cycleId: cycleId!, itemId, assigneeUserId: userId });
      toast.success('Assignment updated');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to assign';
      toast.error(msg);
    }
  }

  async function handleRemoveItem(item: TestCycleItem) {
    const label = item.testCase?.srNo ? `${item.testCase.srNo} — ${item.testCase.title}` : 'this test case';
    if (!window.confirm(`Remove ${label} from this cycle? Its execution history will be deleted too. The test case itself stays in TC Library.`)) return;
    try {
      await removeItem.mutateAsync({ cycleId: cycleId!, itemId: item.id });
      toast.success('Removed from cycle');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to remove test case';
      toast.error(msg);
    }
  }

  function toggleSelectItem(itemId: string) {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });
  }

  function toggleSelectGroup(itemIds: string[]) {
    setSelectedItemIds((prev) => {
      const allSelected = itemIds.every((id) => prev.has(id));
      const next = new Set(prev);
      itemIds.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  }

  async function handleBulkRemove() {
    const count = selectedItemIds.size;
    if (count === 0) return;
    if (!window.confirm(`Remove ${count} test case${count === 1 ? '' : 's'} from this cycle? Their execution history will be deleted too. The test cases themselves stay in TC Library.`)) return;
    try {
      const result = await bulkRemoveItems.mutateAsync({ cycleId: cycleId!, itemIds: [...selectedItemIds] });
      toast.success(`${result.removed} test case${result.removed === 1 ? '' : 's'} removed from cycle`);
      setSelectedItemIds(new Set());
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to remove test cases';
      toast.error(msg);
    }
  }

  async function handleBulkAssign(userId: string | null) {
    const count = selectedItemIds.size;
    if (count === 0) return;
    try {
      const result = await bulkAssignItems.mutateAsync({ cycleId: cycleId!, itemIds: [...selectedItemIds], assigneeUserId: userId });
      toast.success(`${result.updated} test case${result.updated === 1 ? '' : 's'} assigned`);
      setSelectedItemIds(new Set());
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to assign test cases';
      toast.error(msg);
    }
  }

  function handleStatusChange(item: TestCycleItem, status: ManualResultStatus) {
    if (status === 'FAIL' || status === 'BLOCKED') {
      setEditingItemId(item.id);
      setEditingStatus(status);
      return;
    }
    void submitStatus(item.id, { status, reason: '', jiraIssueKeys: [] });
  }

  async function submitStatus(itemId: string, body: { status: ManualResultStatus; reason: string; jiraIssueKeys: string[] }) {
    try {
      await updateItemStatus.mutateAsync({
        cycleId: cycleId!,
        itemId,
        status: body.status,
        reason: body.reason || undefined,
        jiraIssueKeys: body.jiraIssueKeys,
      });
      toast.success('Result saved');
      setEditingItemId(null);
      setEditingStatus(null);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to save result';
      toast.error(msg);
    }
  }

  async function handleCycleStatus(status: TestCycleStatus) {
    try {
      await setStatus.mutateAsync({ id: cycleId!, status });
      toast.success(`Cycle marked ${status}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to update cycle';
      toast.error(msg);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete cycle "${cycle.name}"? This cannot be undone.`)) return;
    try {
      await deleteCycle.mutateAsync(cycleId!);
      toast.success('Cycle deleted');
      navigate(`/projects/${slug}/test-cycles`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to delete cycle';
      toast.error(msg);
    }
  }

  async function handleSaveEdit(edit: { name: string; description?: string; jiraLabels: string[]; jiraJql?: string | null; driveFolderUrl?: string | null; dueDate?: string | null }) {
    try {
      await updateCycle.mutateAsync({ id: cycleId!, ...edit });
      toast.success('Cycle updated');
      setShowEditModal(false);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to update cycle';
      toast.error(msg);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Topbar
        breadcrumbs={[
          { label: project?.name ?? slug ?? 'Project', href: `/projects/${slug}/test-cycles` },
          { label: 'Test Cycles', href: `/projects/${slug}/test-cycles` },
          { label: cycle.name },
        ]}
        actions={isPrivileged ? (
          <>
            <TbBtn variant="ghost" onClick={() => setShowAddTcModal(true)}>➕ Add TC</TbBtn>
            <TbBtn variant="ghost" onClick={() => setShowEditModal(true)}>✏ Edit</TbBtn>
            {cycle.status !== 'CLOSED' && (
              <TbBtn variant="ghost" onClick={() => void handleCycleStatus(cycle.status === 'PLANNING' ? 'ACTIVE' : 'CLOSED')}>
                {cycle.status === 'PLANNING' ? '▶ Start Cycle' : '■ Close Cycle'}
              </TbBtn>
            )}
            <TbBtn variant="ghost" onClick={() => void handleDelete()}>🗑 Delete</TbBtn>
          </>
        ) : undefined}
      />

      {/* display:'grid', not flex column — a flex item with flex-shrink:1 whose
          child has overflow:hidden (every .card) gets an automatic minimum
          size of 0, so once content exceeds the viewport the browser crushes
          a section to a sliver instead of this container scrolling.
          gridTemplateColumns:'1fr' pins the single column to the container's
          actual width — otherwise an auto-sized track grows to fit a flex
          child's un-wrapped max-content width (flex-wrap is ignored when
          computing max-content), overflowing the page horizontally.
          alignContent:'start' is the important one here — grid's default
          align-content ("normal") stretches auto-sized rows to fill any
          leftover space in the container, so the gaps between sections grew
          or shrank depending on how much content sat below (a short cycle
          with few groups got huge gaps; a long one didn't). Pinning to
          'start' keeps every section packed at its natural height, with any
          leftover space left at the bottom instead of split between rows. */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'grid', gridTemplateColumns: '1fr', alignContent: 'start', gap: '16px' }}>
        <div>
          <div className="page-eyebrow">Test cycle</div>
          <h1 className="page-title">{cycle.name}</h1>
          {cycle.description && <p className="page-sub">{cycle.description}</p>}
          {cycle.dueDate && (
            <p style={{ fontSize: '11.5px', color: new Date(cycle.dueDate).getTime() < Date.now() && cycle.status !== 'CLOSED' ? 'var(--fail)' : 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginTop: '4px' }}>
              📅 Due {new Date(cycle.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          )}
          {cycle.driveFolderUrl && (
            <a
              href={cycle.driveFolderUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginTop: '6px', fontSize: '12px', fontWeight: 600, color: 'var(--cyan)', textDecoration: 'underline', textUnderlineOffset: '2px' }}
            >
              📁 Upload artifacts to Drive folder ↗
            </a>
          )}
          {cycleLabels.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '5px', marginTop: '8px' }}>
              <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--text-dim)' }}>Labels</span>
              {cycleLabels.map((l) => <span key={l} className="tag">{l}</span>)}
            </div>
          )}
        </div>

        <CycleStatusCards items={items} bugs={bugs} statusFilter={statusFilter} onFilterChange={setStatusFilter} onViewBugs={() => setActiveTab('bugs')} />

        <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)', gap: '4px' }}>
          {(['testcases', 'bugs'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '8px 16px', fontSize: '13px', fontWeight: 600, background: 'none', cursor: 'pointer',
                border: 'none', borderBottom: activeTab === tab ? '2px solid var(--6d-orange)' : '2px solid transparent',
                color: activeTab === tab ? 'var(--6d-orange)' : 'var(--text-mid)',
              }}
            >
              {tab === 'testcases'
                ? `Test Cases (${filteredItems.length !== items.length ? `${filteredItems.length}/${items.length}` : items.length})`
                : 'Bugs'}
            </button>
          ))}
          {statusFilter.length > 0 && (
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px' }}>
              <span style={{ color: 'var(--text-dim)' }}>Filtered by</span>
              {statusFilter.map((s) => (
                <span key={s} className={`badge ${STATUS_BADGE[s]}`}>{s}</span>
              ))}
              <button
                onClick={() => setStatusFilter([])}
                title="Clear filter"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: '14px', padding: '0 4px' }}
              >
                ×
              </button>
            </div>
          )}
        </div>

        {activeTab === 'testcases' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <MultiSelectFilter
              label="Status"
              values={statusFilter}
              onChange={(v) => setStatusFilter(v as ManualResultStatus[])}
              options={['NOT_RUN', 'IN_PROGRESS', 'PASS', 'FAIL', 'BLOCKED']}
            />
            <MultiSelectFilter label="Assignee" values={assigneeFilter} onChange={setAssigneeFilter} options={assigneeOptions} />
            <MultiSelectFilter label="Feature" values={featureFilter} onChange={setFeatureFilter} options={featureOptions} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <label style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)' }}>
                Group By
              </label>
              <select
                className="input-field"
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value as 'feature' | 'assignee')}
                style={{ fontSize: '11px', padding: '4px 8px', width: 'auto' }}
              >
                <option value="feature">Feature</option>
                <option value="assignee">Assignee</option>
              </select>
            </div>
            {isPrivileged && selectedItemIds.size > 0 && (
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px', padding: '4px 10px', background: 'var(--cyan-dim)', border: '1px solid rgba(37,99,171,0.3)', borderRadius: 'var(--radius)' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)' }}>{selectedItemIds.size} selected</span>
                <TbBtn variant="ghost" onClick={() => setSelectedItemIds(new Set())}>Clear</TbBtn>
                <select
                  className="input-field"
                  value="__placeholder"
                  disabled={bulkAssignItems.isPending}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '__placeholder') return;
                    void handleBulkAssign(v === '__unassign' ? null : v);
                  }}
                  style={{ fontSize: '11px', padding: '4px 8px', width: 'auto' }}
                  title="Assign selected test cases to…"
                >
                  <option value="__placeholder" disabled>👤 Assign to…</option>
                  <option value="__unassign">Unassigned</option>
                  {members.map((m) => <option key={m.userId} value={m.userId}>{m.user.name}</option>)}
                </select>
                <TbBtn variant="danger" onClick={() => void handleBulkRemove()} disabled={bulkRemoveItems.isPending}>
                  {bulkRemoveItems.isPending ? 'Removing…' : `🗑 Remove ${selectedItemIds.size} from Cycle`}
                </TbBtn>
              </div>
            )}
          </div>
        )}

        {activeTab === 'testcases' ? (
          <TestCasesTab
            items={filteredItems}
            groupBy={groupBy}
            canEditItem={canEditItem}
            statusLockedReason={statusLockedReason}
            canManage={isPrivileged}
            selectedIds={selectedItemIds}
            onToggleSelect={toggleSelectItem}
            onToggleGroupSelect={toggleSelectGroup}
            onAssign={handleAssign}
            onStatusChange={handleStatusChange}
            onRemove={(item) => void handleRemoveItem(item)}
            editingItemId={editingItemId}
            editingStatus={editingStatus}
            onSaveResult={(itemId, body) => void submitStatus(itemId, body)}
            onCancelResult={() => { setEditingItemId(null); setEditingStatus(null); }}
            onViewTestCase={setViewingItemId}
          />
        ) : (
          <BugsTab projectId={projectId} cycleId={cycleId!} items={items} statusFilter={statusFilter} />
        )}
      </div>

      {showEditModal && (
        <EditCycleModal
          cycle={cycle}
          onClose={() => setShowEditModal(false)}
          onSave={handleSaveEdit}
          isSaving={updateCycle.isPending}
        />
      )}

      {showAddTcModal && (
        <AddTestCasesModal
          projectId={projectId}
          cycleId={cycleId!}
          existingTestCaseIds={new Set(items.map((i) => i.testCaseId))}
          onClose={() => setShowAddTcModal(false)}
          onSuccess={() => setShowAddTcModal(false)}
        />
      )}

      {viewingItemId && (
        <TestCaseDetailModal projectId={projectId} itemId={viewingItemId} onClose={() => setViewingItemId(null)} />
      )}
    </div>
  );
}
