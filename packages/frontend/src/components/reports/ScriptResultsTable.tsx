import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { ReportRun } from '../../types';
import { groupColor, colorToRgba } from '../../lib/featureGroupTheme';

export const STATUS_COLOR: Record<string, string> = {
  PASSED: 'var(--pass)',
  FAILED: 'var(--fail)',
  RUNNING: 'var(--cyan)',
  PENDING: 'var(--amber)',
  CANCELLED: 'var(--text-dim)',
  SKIPPED: 'var(--amber)',
};

// ── Error cell with hover-reveal copy button ───────────────────────────────

function ErrorCell({ errorMessage }: { errorMessage: string | null }) {
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    if (!errorMessage) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(errorMessage);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = errorMessage;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (!ok) throw new Error('execCommand failed');
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // best-effort clipboard copy; nothing else to do if it fails
    }
  }

  if (!errorMessage) {
    return (
      <td style={{ padding: '7px 12px', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-dim)' }}>
        —
      </td>
    );
  }

  const lines = errorMessage.split('\n').map(l => l.trim()).filter(Boolean);
  const summaryLine = lines.find(l => !l.startsWith('Test:') && !l.startsWith('Failed at:')) ?? lines[0] ?? errorMessage;
  const isMultiLine = lines.length > 1;

  return (
    <td
      style={{ padding: '7px 12px', overflow: 'hidden' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span
            title={errorMessage}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fail)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
            }}
          >
            {summaryLine.slice(0, 120)}
          </span>
          {isMultiLine && (
            <button
              onClick={(e) => { e.stopPropagation(); setExpanded(x => !x); }}
              title={expanded ? 'Collapse' : 'Show full error'}
              style={{
                flexShrink: 0,
                padding: '2px 6px',
                borderRadius: 4,
                background: 'rgba(220,38,38,0.08)',
                color: 'var(--fail)',
                border: '1px solid rgba(220,38,38,0.25)',
                cursor: 'pointer',
                fontSize: 9,
                fontWeight: 700,
                fontFamily: 'var(--font-sans, sans-serif)',
                lineHeight: 1,
              }}
            >
              {expanded ? '▲' : '▼'}
            </button>
          )}
          <button
            onClick={handleCopy}
            title={copied ? 'Copied!' : 'Copy full error'}
            style={{
              flexShrink: 0,
              opacity: hovered ? 1 : 0,
              transition: 'opacity 0.15s',
              padding: '2px 6px',
              borderRadius: 4,
              background: copied ? 'rgba(42,157,143,0.15)' : 'rgba(220,38,38,0.12)',
              color: copied ? 'var(--pass)' : 'var(--fail)',
              border: `1px solid ${copied ? 'rgba(42,157,143,0.35)' : 'rgba(220,38,38,0.3)'}`,
              cursor: 'pointer',
              fontSize: 9,
              fontWeight: 700,
              fontFamily: 'var(--font-sans, sans-serif)',
              lineHeight: 1,
              pointerEvents: hovered ? 'auto' : 'none',
            }}
          >
            {copied ? '✓ Copied' : '⎘ Copy'}
          </button>
        </div>
        {expanded && isMultiLine && (
          <pre style={{
            margin: 0,
            padding: '6px 8px',
            borderRadius: 4,
            background: 'rgba(220,38,38,0.07)',
            border: '1px solid rgba(220,38,38,0.2)',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--fail)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 200,
            overflowY: 'auto',
          }}>
            {errorMessage}
          </pre>
        )}
      </div>
    </td>
  );
}

// ── VideoButton — direct download ─────────────────────────────────────────

function VideoButton({ tcId, isMultiple, onDownload }: {
  resultId: string;
  runId: string;
  projectId: string | undefined;
  tcId: string;
  isMultiple: boolean;
  onDownload: () => void;
}) {
  return (
    <button
      onClick={onDownload}
      title={isMultiple ? 'Download all session videos (zip)' : `Download recording for ${tcId}`}
      style={{
        padding: '2px 7px', borderRadius: 5,
        background: 'rgba(245,158,11,0.12)', color: '#f59e0b',
        border: '1px solid rgba(245,158,11,0.3)',
        cursor: 'pointer', fontSize: 10, fontWeight: 600,
        display: 'flex', alignItems: 'center', gap: 3,
      }}
    >
      🎬 {isMultiple ? 'Videos' : 'Video'}
    </button>
  );
}

// ── Script results table — filter input + flat per-script results table ───

interface ScriptResultsTableProps {
  results: ReportRun['results'];
  query: string;
  onQueryChange: (v: string) => void;
  projectId: string | undefined;
  runId: string;
  retryingIds: Set<string>;
  onRerun: (testCaseId: string) => void;
  onDownloadAsset: (resultId: string, type: 'screenshot' | 'trace' | 'video', filename: string) => void;
  onOpenRfHtml: (resultId: string, type: 'rf-report' | 'rf-log', filename: string) => void;
  /** Group rows under collapsible use-case headers, matching the TC-library view. Default false (Reports accordion). */
  grouped?: boolean;
  /** Let the table grow to fit its content instead of a small internal scrollbox. Default false (Reports accordion). */
  fullHeight?: boolean;
}

type ResultRow = ReportRun['results'][number];

export default function ScriptResultsTable({
  results, query, onQueryChange, projectId, runId, retryingIds, onRerun, onDownloadAsset, onOpenRfHtml,
  grouped = false, fullHeight = false,
}: ScriptResultsTableProps) {
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const didAutoOpen = useRef(false);
  const q = query.toLowerCase();
  const visibleResults = (results ?? []).filter(
    (r) => !q || r.testCase.title.toLowerCase().includes(q) || r.testCase.tcId.toLowerCase().includes(q),
  );

  const groups = useMemo(() => {
    if (!grouped) return null;
    const byUseCase = new Map<string, ResultRow[]>();
    for (const r of visibleResults) {
      const key = r.testCase.useCaseTag ?? 'Uncategorised';
      if (!byUseCase.has(key)) byUseCase.set(key, []);
      byUseCase.get(key)!.push(r);
    }
    return [...byUseCase.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [grouped, visibleResults]);

  // Default a lone group open (nicer first impression) without permanently
  // forcing it open — runs once, so a later click can still collapse it.
  useEffect(() => {
    if (!didAutoOpen.current && groups && groups.length === 1) {
      didAutoOpen.current = true;
      setOpenGroups(new Set([groups[0]![0]]));
    }
  }, [groups]);

  function toggleGroup(name: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  function renderRow(r: ResultRow) {
    return (
      <tr key={r.id} style={{ borderBottom: '1px solid var(--border)', background: r.status === 'FAILED' ? 'rgba(220,38,38,0.04)' : r.status === 'SKIPPED' ? 'rgba(251,191,36,0.04)' : 'transparent' }}>
                <td style={{ padding: '7px 12px', overflow: 'hidden' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1, overflow: 'hidden' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                      {r.testCase.tcId}
                    </span>
                    <span style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.testCase.title}
                    </span>
                  </div>
                </td>
                <td style={{ padding: '7px 12px', color: 'var(--text-dim)', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.testCase.useCaseTag ?? '—'}
                </td>
                <td style={{ padding: '7px 12px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                  {r.duration ? `${(r.duration / 1000).toFixed(1)}s` : '—'}
                </td>
                <td style={{ padding: '7px 12px', whiteSpace: 'nowrap' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: STATUS_COLOR[r.status] ?? 'var(--text-dim)' }}>
                    {r.status}
                  </span>
                </td>
                <td style={{ padding: '7px 8px', whiteSpace: 'nowrap' }}>
                  <button
                    onClick={() => onRerun(r.testCase.id)}
                    disabled={retryingIds.has(r.testCase.id)}
                    title="Re-run this test case"
                    style={{
                      padding: '2px 7px',
                      borderRadius: 5,
                      background: retryingIds.has(r.testCase.id) ? 'rgba(37,99,171,0.06)' : 'rgba(37,99,171,0.12)',
                      color: retryingIds.has(r.testCase.id) ? 'rgba(37,99,171,0.4)' : 'var(--cyan)',
                      border: '1px solid rgba(37,99,171,0.25)',
                      cursor: retryingIds.has(r.testCase.id) ? 'not-allowed' : 'pointer',
                      fontSize: 10,
                      fontWeight: 600,
                    }}
                  >
                    {retryingIds.has(r.testCase.id) ? '⏳' : '↻'}
                  </button>
                </td>
                <td style={{ padding: '7px 12px', whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    {r.screenshotPath && (
                      <button
                        onClick={() => onDownloadAsset(r.id, 'screenshot', `screenshot-${r.testCase.tcId}.png`)}
                        title="Download screenshot"
                        style={{
                          padding: '2px 7px',
                          borderRadius: 5,
                          background: 'rgba(37,99,171,0.12)',
                          color: 'var(--cyan)',
                          border: '1px solid rgba(37,99,171,0.25)',
                          cursor: 'pointer',
                          fontSize: 10,
                          fontWeight: 600,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 3,
                        }}
                      >
                        📷 PNG
                      </button>
                    )}
                    {r.videoPath && (
                      <VideoButton
                        resultId={r.id}
                        runId={runId}
                        projectId={projectId}
                        tcId={r.testCase.tcId}
                        isMultiple={r.videoPath.startsWith('[')}
                        onDownload={() => {
                          const isMultiple = r.videoPath!.startsWith('[');
                          onDownloadAsset(r.id, 'video', isMultiple ? `videos-${r.testCase.tcId}.zip` : `video-${r.testCase.tcId}.mp4`);
                        }}
                      />
                    )}
                    {r.tracePath && (
                      <button
                        onClick={() => onDownloadAsset(r.id, 'trace', `trace-${r.testCase.tcId}.zip`)}
                        title="Download Playwright trace"
                        style={{
                          padding: '2px 7px',
                          borderRadius: 5,
                          background: 'rgba(164,123,250,0.12)',
                          color: 'var(--violet)',
                          border: '1px solid rgba(164,123,250,0.25)',
                          cursor: 'pointer',
                          fontSize: 10,
                          fontWeight: 600,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 3,
                        }}
                      >
                        🔍 Trace
                      </button>
                    )}
                    {r.rfLogPath && (
                      <button
                        onClick={() => onOpenRfHtml(r.id, 'rf-log', `rf-log-${r.testCase.tcId}.html`)}
                        title="Download RF log"
                        style={{
                          padding: '2px 7px',
                          borderRadius: 5,
                          background: 'rgba(234,179,8,0.08)',
                          color: '#ca8a04',
                          border: '1px solid rgba(234,179,8,0.2)',
                          cursor: 'pointer',
                          fontSize: 10,
                          fontWeight: 600,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 3,
                        }}
                      >
                        Log
                      </button>
                    )}
                    {!r.screenshotPath && !r.videoPath && !r.tracePath && !r.rfLogPath && (
                      <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>—</span>
                    )}
                  </div>
                </td>
                <ErrorCell errorMessage={r.errorMessage ?? null} />
      </tr>
    );
  }

  return (
    <div>
      {/* Filter + summary row */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <input
          type="text"
          placeholder="Filter test cases…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          style={{
            flex: 1,
            padding: '5px 10px',
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text)',
            fontSize: 12,
            outline: 'none',
          }}
        />
        <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
          {visibleResults.length} result{visibleResults.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Results table */}
      <div style={fullHeight ? undefined : { overflow: 'auto', maxHeight: 300 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '35%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: 72 }} />
            <col style={{ width: 80 }} />
            <col style={{ width: 44 }} />
            <col style={{ width: 150 }} />
            <col />
          </colgroup>
          <thead>
            <tr>
              {['Title', 'Suite', 'Duration', 'Status', '', 'Assets', 'Error'].map((h, i) => (
                <th key={i} style={{
                  padding: '6px 12px',
                  textAlign: 'left',
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: 'var(--text-dim)',
                  borderBottom: '1px solid var(--border)',
                  position: fullHeight ? 'static' : 'sticky',
                  top: 0,
                  background: 'var(--surface)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleResults.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: '20px 12px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
                  No results found.
                </td>
              </tr>
            ) : groups ? (
              groups.map(([name, rows], idx) => {
                const color = groupColor(idx);
                const isOpen = openGroups.has(name);
                const passedCount = rows.filter((r) => r.status === 'PASSED').length;
                const failedCount = rows.filter((r) => r.status === 'FAILED').length;
                const otherCount = rows.length - passedCount - failedCount;
                return (
                  <Fragment key={name}>
                    <tr onClick={() => toggleGroup(name)} style={{ cursor: 'pointer', background: `linear-gradient(90deg, ${colorToRgba(color, 0.07)}, transparent)` }}>
                      <td colSpan={7} style={{ padding: '8px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 10, color: 'var(--text-dim)', display: 'inline-block', transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s' }}>▼</span>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: `var(${color})`, flexShrink: 0 }} />
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{name}</span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-dim)' }}>{rows.length} TCs</span>
                          {passedCount > 0 && <span className="badge badge-pass" style={{ fontSize: 8 }}>{passedCount} passed</span>}
                          {failedCount > 0 && <span className="badge badge-fail" style={{ fontSize: 8 }}>{failedCount} failed</span>}
                          {otherCount > 0 && <span className="badge badge-draft" style={{ fontSize: 8 }}>{otherCount} other</span>}
                        </div>
                      </td>
                    </tr>
                    {isOpen && rows.map(renderRow)}
                  </Fragment>
                );
              })
            ) : (
              visibleResults.map(renderRow)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
