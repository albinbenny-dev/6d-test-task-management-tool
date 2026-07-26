import { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useClickOutside } from '../../hooks/useClickOutside';
import { FloatingPortal } from '../ui/FloatingPortal';
import { useTestCycleBugs, useUnlinkBugFromItem } from '../../hooks/useTestCycles';
import { useJiraHost } from '../../hooks/useJira';

// ── Clickable Jira key — click opens a small popover with the cached bug's
// status/summary/etc, plus a "View in Jira ↗" link to the real ticket. Reads
// from the same useTestCycleBugs cache the Bugs tab and stat cards already
// populate, so this doesn't fire any extra requests. ───────────────────────

function parseJsonArray(s: string | undefined | null): string[] {
  if (!s) return [];
  try { return JSON.parse(s) as string[]; } catch { return []; }
}

function JiraKeyChip({ issueKey, projectId, cycleId, itemId, canUnlink }: {
  issueKey: string; projectId: string; cycleId: string; itemId: string; canUnlink: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside([rootRef, menuRef], () => setIsOpen(false), isOpen);

  const { data: bugs = [] } = useTestCycleBugs(projectId, cycleId);
  const { data: jiraHost } = useJiraHost(projectId);
  const unlinkBug = useUnlinkBugFromItem(projectId);
  const bug = bugs.find((b) => b.issueKey === issueKey);
  const issue = bug?.issue;
  const jiraUrl = jiraHost ? `${jiraHost}/browse/${issueKey}` : null;

  async function handleUnlink() {
    if (!window.confirm(`Unlink ${issueKey} from this test case? The bug itself is untouched — this only removes the link.`)) return;
    try {
      await unlinkBug.mutateAsync({ cycleId, issueKey, testCycleItemId: itemId });
      toast.success(`${issueKey} unlinked`);
      setIsOpen(false);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to unlink';
      toast.error(msg);
    }
  }

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        style={{
          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--cyan)',
          textDecoration: 'underline', textUnderlineOffset: '2px',
        }}
      >
        {issueKey}
      </button>

      <FloatingPortal anchorRef={rootRef} open={isOpen} align="end" portalRef={menuRef} width={240}>
        <div
          style={{
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-card)', padding: '10px 12px',
            fontSize: '11px', color: 'var(--text)', textAlign: 'left',
          }}
        >
          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--cyan)', marginBottom: '4px' }}>{issueKey}</div>
          {issue ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ overflowWrap: 'anywhere' }}>{issue.summary ?? <span style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>no summary</span>}</div>
              {issue.status && <div><span style={{ color: 'var(--text-dim)' }}>Status: </span>{issue.status}</div>}
              {issue.priorityName && <div><span style={{ color: 'var(--text-dim)' }}>Priority: </span>{issue.priorityName}</div>}
              {issue.issueType && <div><span style={{ color: 'var(--text-dim)' }}>Type: </span>{issue.issueType}</div>}
              {issue.assigneeName && <div><span style={{ color: 'var(--text-dim)' }}>Assignee: </span>{issue.assigneeName}</div>}
              {parseJsonArray(issue.components).length > 0 && (
                <div><span style={{ color: 'var(--text-dim)' }}>Component: </span>{parseJsonArray(issue.components).join(', ')}</div>
              )}
              <div style={{ color: 'var(--text-dim)', fontSize: '10px' }}>Synced {new Date(issue.lastSyncedAt).toLocaleString()}</div>
            </div>
          ) : (
            <div style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>Not yet synced from Jira.</div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '8px' }}>
            {jiraUrl ? (
              <a
                href={jiraUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--cyan)', fontSize: '10px', fontWeight: 600 }}
              >
                View in Jira ↗
              </a>
            ) : <span />}
            {canUnlink && (
              <button
                type="button"
                onClick={() => void handleUnlink()}
                disabled={unlinkBug.isPending}
                title="Remove this link — the bug itself is untouched"
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--fail)', fontSize: '10px', fontWeight: 600 }}
              >
                {unlinkBug.isPending ? 'Unlinking…' : '✕ Unlink'}
              </button>
            )}
          </div>
        </div>
      </FloatingPortal>
    </div>
  );
}

export function JiraKeysCell({ jiraIssueKeys, projectId, cycleId, itemId, canUnlink = false }: {
  jiraIssueKeys: string; projectId: string; cycleId: string; itemId: string; canUnlink?: boolean;
}) {
  const keys = parseJsonArray(jiraIssueKeys);
  if (keys.length === 0) {
    return <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>—</span>;
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', overflow: 'hidden' }}>
      {keys.map((key, i) => (
        <span key={key}>
          <JiraKeyChip issueKey={key} projectId={projectId} cycleId={cycleId} itemId={itemId} canUnlink={canUnlink} />
          {i < keys.length - 1 && <span style={{ color: 'var(--text-dim)' }}>,</span>}
        </span>
      ))}
    </div>
  );
}
