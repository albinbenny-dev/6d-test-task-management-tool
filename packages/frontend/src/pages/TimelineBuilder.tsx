import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Download, Image as ImageIcon, FileSpreadsheet, Presentation, Upload, RotateCcw } from 'lucide-react';
import Topbar, { TbBtn } from '../components/layout/Topbar';
import { useProject } from '../hooks/useProjects';
import { useRBAC } from '../hooks/useRBAC';
import { useTimeline, useTimelineEditor } from '../hooks/useTimelines';
import { useTimelineTemplates } from '../hooks/useTimelines';
import { useClickOutside } from '../hooks/useClickOutside';
import { api } from '../lib/api';
import { layoutTimeline } from '../lib/timeline/layout';
import { resolveConfig } from '../lib/timeline/config';
import { exportPng, exportPptx, exportSvg, safeFileName } from '../lib/timeline/export';
import type { StyleOverrides, TimelineTemplateDTO } from '../lib/timeline/types';
import { TimelineGrid } from '../components/timeline/TimelineGrid';
import { TimelinePreview } from '../components/timeline/TimelinePreview';
import { TemplateGallery } from '../components/timeline/TemplateGallery';
import { ConfigControls, overridePaths, setIn } from '../components/timeline/ConfigControls';
import { ImportTimelineModal } from '../components/timeline/ImportTimelineModal';

type ViewMode = 'data' | 'split' | 'timeline';

export default function TimelineBuilder() {
  const { slug, timelineId } = useParams<{ slug: string; timelineId: string }>();
  const { data: project } = useProject(slug);
  const projectId = project?.id ?? '';
  const { canManageTimelines } = useRBAC();

  const { data: detail, isLoading, error } = useTimeline(project?.id, timelineId);
  const { data: templates = [] } = useTimelineTemplates();
  const actions = useTimelineEditor(projectId, timelineId ?? '');

  const [view, setView] = useState<ViewMode>('split');
  const [rightTab, setRightTab] = useState<'templates' | 'style'>('templates');
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  useClickOutside(exportRef, () => setExportOpen(false), exportOpen);

  // Template + per-timeline overrides live in local state so the preview
  // updates on every keystroke/click; they're persisted (debounced) behind it.
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<StyleOverrides>({});
  const initFor = useRef<string | null>(null);
  const dirtyOverrides = useRef(false);
  useEffect(() => {
    if (detail && initFor.current !== detail.timeline.id) {
      initFor.current = detail.timeline.id;
      setTemplateId(detail.timeline.templateId);
      setOverrides(detail.timeline.styleOverrides ?? {});
      dirtyOverrides.current = false;
    }
  }, [detail]);

  useEffect(() => {
    if (!dirtyOverrides.current) return;
    const t = setTimeout(() => { actions.updateTimeline.mutate({ styleOverrides: overrides }); dirtyOverrides.current = false; }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrides]);

  // A timeline may still point at a template an admin later deactivated — it
  // isn't in the (active-only) list but the detail response carries it.
  const templateList: TimelineTemplateDTO[] = useMemo(() => {
    const list = [...templates];
    const t = detail?.template;
    if (t && !list.some((x) => x.id === t.id)) {
      list.unshift({ id: t.id, name: `${t.name} (retired)`, description: null, category: 'Retired', isBuiltIn: false, builtInKey: null, isActive: false, sortOrder: -1, config: t.config, createdAt: '', updatedAt: '' });
    }
    return list;
  }, [templates, detail?.template]);

  const activeTemplate = templateList.find((t) => t.id === (templateId ?? detail?.timeline.templateId)) ?? templateList[0] ?? null;
  const config = useMemo(() => resolveConfig(activeTemplate?.config, overrides), [activeTemplate, overrides]);
  const items = detail?.items ?? [];
  const lanes = detail?.swimlanes ?? [];
  const name = detail?.timeline.name ?? 'Timeline';

  const layout = useMemo(() => layoutTimeline({ title: name, items, lanes, config }), [name, items, lanes, config]);
  useEffect(() => { if (pageIndex > layout.pages.length - 1) setPageIndex(Math.max(0, layout.pages.length - 1)); }, [layout, pageIndex]);

  function pickTemplate(id: string) {
    setTemplateId(id);
    actions.updateTimeline.mutate({ templateId: id }, { onError: () => toast.error('Could not change the template') });
  }

  function setOverride(path: string, value: unknown) {
    dirtyOverrides.current = true;
    setOverrides((o) => setIn(o, path, value) as StyleOverrides);
  }

  function resetOverrides() {
    dirtyOverrides.current = true;
    setOverrides({});
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label); setExportOpen(false);
    try { await fn(); } catch (e) { toast.error((e as Error).message || `${label} failed`); }
    finally { setBusy(null); }
  }

  const hasItems = items.length > 0;
  const exportItem = (label: string, icon: React.ReactNode, onClick: () => void, hint?: string) => (
    <button
      onClick={onClick} disabled={!hasItems && label !== 'Excel data'}
      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '8px 12px', fontSize: 12.5, color: 'var(--text)', textAlign: 'left', opacity: !hasItems ? 0.5 : 1 }}
    >
      {icon}
      <span><div style={{ fontWeight: 600 }}>{label}</div>{hint && <div style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>{hint}</div>}</span>
    </button>
  );

  const showData = view !== 'timeline';
  const showTimeline = view !== 'data';

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <Topbar breadcrumbs={[{ label: project?.name ?? slug ?? 'Project' }, { label: 'Timelines', href: `/projects/${slug}/timelines` }, { label: 'Not found' }]} />
        <p style={{ marginTop: 24, color: 'var(--text-mid)' }}>This timeline could not be loaded — it may have been deleted.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Topbar
        breadcrumbs={[{ label: project?.name ?? slug ?? 'Project' }, { label: 'Timelines', href: `/projects/${slug}/timelines` }, { label: name }]}
        actions={(
          <>
            {canManageTimelines && (
              <TbBtn variant="ghost" onClick={() => setImportOpen(true)}><Upload size={12} style={{ marginRight: 5, verticalAlign: -2 }} />Import</TbBtn>
            )}
            <div ref={exportRef} style={{ position: 'relative' }}>
              <TbBtn variant="primary" onClick={() => setExportOpen((o) => !o)} disabled={!!busy}>
                <Download size={12} style={{ marginRight: 5, verticalAlign: -2 }} />{busy ? `${busy}…` : 'Export'}
              </TbBtn>
              {exportOpen && (
                <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 6, zIndex: 60, width: 260, background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', padding: '6px 0' }}>
                  {exportItem('PowerPoint (.pptx)', <Presentation size={16} />, () => run('PowerPoint export', () => exportPptx(layout.pages, config, name)), 'Editable shapes — all slides')}
                  {exportItem('Image (.png)', <ImageIcon size={16} />, () => run('Image export', () => exportPng(layout.pages[pageIndex], config, name)), layout.pages.length > 1 ? `Current slide (${pageIndex + 1} of ${layout.pages.length})` : '1920 × 1080')}
                  {exportItem('Vector image (.svg)', <ImageIcon size={16} />, () => run('SVG export', async () => exportSvg(layout.pages[pageIndex], config, name)), 'Scales without blurring')}
                  {exportItem('Excel data', <FileSpreadsheet size={16} />, () => run('Excel export', async () => {
                    const res = await api.get(`/projects/${projectId}/timelines/${timelineId}/export-xlsx`, { responseType: 'blob' });
                    const url = URL.createObjectURL(res.data as Blob);
                    const a = document.createElement('a'); a.href = url; a.download = `${safeFileName(name)}.xlsx`; a.click(); URL.revokeObjectURL(url);
                  }), 'Re-importable plan data')}
                </div>
              )}
            </div>
          </>
        )}
      />

      <div style={{ padding: '12px 20px 0', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        {canManageTimelines && detail ? (
          <input
            key={detail.timeline.name} className="input-field" defaultValue={detail.timeline.name}
            onBlur={(e) => {
              e.currentTarget.style.border = '1px solid transparent'; e.currentTarget.style.background = 'transparent';
              const v = e.currentTarget.value.trim();
              if (v && v !== detail.timeline.name) actions.updateTimeline.mutate({ name: v }); else e.currentTarget.value = detail.timeline.name;
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            style={{ fontSize: 17, fontWeight: 700, maxWidth: 380, border: '1px solid transparent', background: 'transparent', fontFamily: 'inherit' }}
            onFocus={(e) => { e.currentTarget.style.border = '1px solid var(--border2)'; e.currentTarget.style.background = 'var(--surface)'; }}
          />
        ) : <h1 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{name}</h1>}

        <div style={{ display: 'inline-flex', border: '1px solid var(--border2)', borderRadius: 8, overflow: 'hidden', marginLeft: 'auto' }}>
          {([['data', 'Data'], ['split', 'Split'], ['timeline', 'Timeline']] as [ViewMode, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setView(k)} style={{ padding: '6px 14px', fontSize: 12.5, fontWeight: 600, border: 'none', cursor: 'pointer', background: view === k ? 'var(--cyan)' : 'var(--surface)', color: view === k ? '#fff' : 'var(--text-mid)' }}>{label}</button>
          ))}
        </div>
      </div>

      {isLoading || !detail ? (
        <div style={{ padding: 24, color: 'var(--text-dim)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>Loading…</div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 16, padding: '12px 20px 0' }}>
          {showData && (
            <div style={{ flex: view === 'data' ? '1 1 100%' : '1 1 56%', minWidth: 0, overflowY: 'auto', paddingBottom: 16 }}>
              <TimelineGrid
                items={items} lanes={lanes} canEdit={canManageTimelines}
                lanePalette={config.palette.laneColors} taskColor={config.palette.taskDefault} milestoneColor={config.palette.milestoneDefault}
                selectedItemId={selectedItemId} onSelectItem={setSelectedItemId} actions={actions}
              />
            </div>
          )}

          {showTimeline && (
            <div style={{ flex: view === 'timeline' ? '1 1 100%' : '1 1 44%', minWidth: 0, overflowY: 'auto', paddingBottom: 24 }}>
              <TimelinePreview
                layout={layout} fontFamily={config.font.family} pageIndex={pageIndex} onPageIndex={setPageIndex}
                selectedItemId={selectedItemId} onSelectItem={view === 'timeline' ? undefined : setSelectedItemId}
              />
              {!hasItems && (
                <div style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'center', marginTop: 8 }}>
                  Showing an empty plan. Add tasks in the grid{canManageTimelines ? ' or use Import' : ''} and this preview updates live.
                </div>
              )}

              <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', margin: '18px 0 12px' }}>
                {([['templates', 'Templates'], ['style', 'Style']] as ['templates' | 'style', string][]).map(([k, label]) => (
                  <button key={k} onClick={() => setRightTab(k)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '8px 14px', marginBottom: -1, fontSize: 12.5, fontWeight: 600, color: rightTab === k ? 'var(--cyan)' : 'var(--text-dim)', borderBottom: rightTab === k ? '2px solid var(--cyan)' : '2px solid transparent' }}>{label}</button>
                ))}
              </div>

              {rightTab === 'templates' ? (
                <>
                  <TemplateGallery
                    templates={templateList} selectedId={activeTemplate?.id ?? null} items={items} lanes={lanes} title={name}
                    onSelect={canManageTimelines ? pickTemplate : () => toast('You have view-only access to this timeline')}
                  />
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 10 }}>
                    Each preview uses your own plan. Templates are managed by a Super Admin.
                  </div>
                </>
              ) : (
                <div className="card" style={{ padding: 12 }}>
                  {canManageTimelines ? (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ fontSize: 11.5, color: 'var(--text-dim)', flex: 1 }}>
                          Tweaks apply to this timeline only{overridePaths(overrides).size > 0 ? ' (● = customised)' : ''}.
                        </span>
                        {overridePaths(overrides).size > 0 && (
                          <button onClick={resetOverrides} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: 'var(--cyan)', cursor: 'pointer', fontSize: 11.5 }}>
                            <RotateCcw size={11} /> Reset to template
                          </button>
                        )}
                      </div>
                      <ConfigControls config={config} onChange={setOverride} overriddenPaths={overridePaths(overrides)} />
                    </>
                  ) : <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>View-only — styling can be changed by project admins.</div>}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {importOpen && (
        <ImportTimelineModal projectId={projectId} hasData={hasItems || lanes.length > 0} actions={actions} onClose={() => setImportOpen(false)} />
      )}
    </div>
  );
}
