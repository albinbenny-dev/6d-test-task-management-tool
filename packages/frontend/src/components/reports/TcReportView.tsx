import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../lib/api';
import { groupColor, colorToRgba } from '../../lib/featureGroupTheme';
import type { TcReportItem } from '../../hooks/useReports';

const STATUS_BADGE: Record<string, string> = {
  PASSED: 'badge-pass',
  FAILED: 'badge-fail',
  SKIPPED: 'badge-skip',
  CANCELLED: 'badge-draft',
  PENDING: 'badge-draft',
  RUNNING: 'badge-run',
  NOT_RUN: 'badge-draft',
};

interface TcReportViewProps {
  projectId: string | undefined;
  runId: string;
  items: TcReportItem[];
  isLoading: boolean;
  query: string;
  /** Let the list grow to fit its content instead of a small internal scrollbox. Default false (Reports accordion). */
  fullHeight?: boolean;
}

export default function TcReportView({ projectId, runId, items, isLoading, query, fullHeight = false }: TcReportViewProps) {
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const didAutoOpen = useRef(false);

  const q = query.toLowerCase();
  const visible = items.filter(
    (i) => !q || i.title.toLowerCase().includes(q) || (i.tcId ?? '').toLowerCase().includes(q),
  );

  const groups = useMemo(() => {
    const byFeature = new Map<string, TcReportItem[]>();
    for (const item of visible) {
      const key = item.feature ?? 'Uncategorised';
      if (!byFeature.has(key)) byFeature.set(key, []);
      byFeature.get(key)!.push(item);
    }
    for (const list of byFeature.values()) {
      list.sort((a, b) => (a.tcId ?? '').localeCompare(b.tcId ?? '', undefined, { numeric: true, sensitivity: 'base' }));
    }
    return [...byFeature.entries()];
  }, [visible]);

  // Default a lone group open (nicer first impression) without permanently
  // forcing it open — runs once, so a later click can still collapse it.
  useEffect(() => {
    if (!didAutoOpen.current && groups.length === 1) {
      didAutoOpen.current = true;
      setOpenGroups(new Set([groups[0]![0]]));
    }
  }, [groups]);

  async function downloadAsset(resultId: string, type: 'screenshot' | 'video', filename: string) {
    try {
      const res = await api.get(
        `/projects/${projectId}/reports/runs/${runId}/results/${resultId}/${type}`,
        { responseType: 'blob' },
      );
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      toast.error(`${type} download failed`);
    }
  }

  async function openRfLog(resultId: string, filename: string) {
    try {
      const res = await api.get(
        `/projects/${projectId}/reports/runs/${runId}/results/${resultId}/rf-log`,
        { responseType: 'blob' },
      );
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      toast.error('RF log download failed');
    }
  }

  if (isLoading) {
    return (
      <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
        Loading test cases…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
        No TC Library test cases are linked to this project's scripts yet.
      </div>
    );
  }

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, ...(fullHeight ? {} : { maxHeight: 340, overflow: 'auto' }) }}>
      {groups.map(([feature, groupItems], idx) => {
        const color = groupColor(idx);
        const isOpen = openGroups.has(feature);
        const passed = groupItems.filter((i) => i.execStatus === 'PASSED').length;
        const failed = groupItems.filter((i) => i.execStatus === 'FAILED').length;
        const notRun = groupItems.filter((i) => i.execStatus === 'NOT_RUN').length;

        return (
          <div key={feature} style={{ background: 'var(--surface)', border: `1px solid ${colorToRgba(color, 0.25)}`, borderRadius: 8, overflow: 'hidden' }}>
            <div
              onClick={() => setOpenGroups((prev) => {
                const next = new Set(prev);
                if (next.has(feature)) next.delete(feature); else next.add(feature);
                return next;
              })}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: `linear-gradient(90deg, ${colorToRgba(color, 0.07)}, transparent)`, cursor: 'pointer', userSelect: 'none' }}
            >
              <span style={{ fontSize: 10, color: 'var(--text-dim)', display: 'inline-block', transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s' }}>▼</span>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: `var(${color})`, flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', flex: 1 }}>{feature}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-dim)' }}>{groupItems.length} TCs</span>
              {passed > 0 && <span className="badge badge-pass" style={{ fontSize: 8 }}>{passed} passed</span>}
              {failed > 0 && <span className="badge badge-fail" style={{ fontSize: 8 }}>{failed} failed</span>}
              {notRun > 0 && <span className="badge badge-draft" style={{ fontSize: 8 }}>{notRun} not run</span>}
            </div>

            {isOpen && groupItems.map((item) => (
              <div
                key={item.tcItemId}
                style={{
                  display: 'grid', gridTemplateColumns: '90px 1fr 90px 90px 140px', gap: 8,
                  padding: '7px 12px', alignItems: 'center', fontSize: 12,
                  borderTop: '1px solid var(--border)',
                  background: item.execStatus === 'FAILED' ? 'rgba(220,38,38,0.04)' : 'transparent',
                }}
              >
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-dim)' }}>{item.tcId ?? '—'}</span>
                <div style={{ minWidth: 0, overflow: 'hidden' }}>
                  <div style={{ color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</div>
                  {item.errorMessage && (
                    <div title={item.errorMessage} style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fail)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {item.errorMessage.split('\n')[0]}
                    </div>
                  )}
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)' }}>
                  {item.duration ? `${(item.duration / 1000).toFixed(1)}s` : '—'}
                </span>
                <span className={`badge ${STATUS_BADGE[item.execStatus] ?? 'badge-draft'}`} style={{ fontSize: 9, justifySelf: 'start' }}>
                  {item.execStatus.replace('_', ' ')}
                </span>
                <div style={{ display: 'flex', gap: 4 }}>
                  {item.resultId && item.hasScreenshot && (
                    <button
                      onClick={() => downloadAsset(item.resultId!, 'screenshot', `screenshot-${item.tcId}.png`)}
                      title="Download screenshot"
                      style={{ padding: '2px 6px', borderRadius: 5, background: 'rgba(37,99,171,0.12)', color: 'var(--cyan)', border: '1px solid rgba(37,99,171,0.25)', cursor: 'pointer', fontSize: 10 }}
                    >
                      📷
                    </button>
                  )}
                  {item.resultId && item.hasVideo && (
                    <button
                      onClick={() => downloadAsset(item.resultId!, 'video', `video-${item.tcId}.mp4`)}
                      title="Download video"
                      style={{ padding: '2px 6px', borderRadius: 5, background: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)', cursor: 'pointer', fontSize: 10 }}
                    >
                      🎬
                    </button>
                  )}
                  {item.resultId && item.hasRfLog && (
                    <button
                      onClick={() => openRfLog(item.resultId!, `rf-log-${item.tcId}.html`)}
                      title="Download RF log"
                      style={{ padding: '2px 6px', borderRadius: 5, background: 'rgba(234,179,8,0.08)', color: '#ca8a04', border: '1px solid rgba(234,179,8,0.2)', cursor: 'pointer', fontSize: 10 }}
                    >
                      Log
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
