import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Copy, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import Topbar from '../components/layout/Topbar';
import { useRBAC } from '../hooks/useRBAC';
import { useTemplateAdmin, useTimelineTemplates } from '../hooks/useTimelines';
import { layoutTimeline } from '../lib/timeline/layout';
import { DEFAULT_CONFIG, resolveConfig } from '../lib/timeline/config';
import { sampleTimeline } from '../lib/timeline/sample';
import type { TemplateConfig } from '../lib/timeline/types';
import { TemplateThumb } from '../components/timeline/TemplateGallery';
import { TimelinePreview } from '../components/timeline/TimelinePreview';
import { ConfigControls, setIn } from '../components/timeline/ConfigControls';

function errMsg(err: unknown, fallback: string) {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback;
}

interface Draft { name: string; description: string; category: string; isActive: boolean; config: TemplateConfig }

// Super Admin only — create/edit/duplicate/retire the platform-level timeline
// templates every project's builder offers. Edits preview live on a sample plan.
export default function TimelineTemplates() {
  const { isSuperAdmin } = useRBAC();
  const { data: templates = [], isLoading } = useTimelineTemplates();
  const admin = useTemplateAdmin();
  const sample = useMemo(() => sampleTimeline(), []);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pageIndex, setPageIndex] = useState(0);

  const selected = templates.find((t) => t.id === selectedId) ?? null;

  // Load the draft whenever the selection (or the saved copy) changes.
  const savedKey = selected ? `${selected.id}:${selected.updatedAt}` : '';
  useEffect(() => {
    if (selected) {
      setDraft({ name: selected.name, description: selected.description ?? '', category: selected.category, isActive: selected.isActive, config: resolveConfig(selected.config) });
    } else setDraft(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  useEffect(() => { if (!selectedId && templates.length > 0) setSelectedId(templates[0].id); }, [templates, selectedId]);

  const dirty = useMemo(() => {
    if (!selected || !draft) return false;
    return draft.name !== selected.name || draft.description !== (selected.description ?? '') || draft.category !== selected.category
      || draft.isActive !== selected.isActive || JSON.stringify(draft.config) !== JSON.stringify(resolveConfig(selected.config));
  }, [selected, draft]);

  const layout = useMemo(
    () => (draft ? layoutTimeline({ title: 'Sample project plan', items: sample.items, lanes: sample.lanes, config: draft.config }) : null),
    [draft, sample],
  );

  if (!isSuperAdmin) {
    return (
      <div style={{ padding: 24 }}>
        <Topbar breadcrumbs={[{ label: 'Admin' }, { label: 'Timeline Templates' }]} />
        <p style={{ marginTop: 24, color: 'var(--text-mid)' }}>Only a Super Admin can manage timeline templates.</p>
      </div>
    );
  }

  function confirmDiscard() {
    return !dirty || window.confirm('You have unsaved changes to this template. Discard them?');
  }

  async function save() {
    if (!selected || !draft) return;
    if (!draft.name.trim()) { toast.error('A template needs a name'); return; }
    try {
      await admin.update.mutateAsync({ id: selected.id, name: draft.name.trim(), description: draft.description.trim() || null, category: draft.category.trim() || 'Custom', isActive: draft.isActive, config: draft.config });
      toast.success('Template saved — projects using it update immediately');
    } catch (e) { toast.error(errMsg(e, 'Could not save the template')); }
  }

  async function createNew() {
    if (!confirmDiscard()) return;
    try {
      const t = await admin.create.mutateAsync({ name: 'New template', category: 'Custom', config: DEFAULT_CONFIG });
      setSelectedId(t.id);
    } catch (e) { toast.error(errMsg(e, 'Could not create the template')); }
  }

  async function duplicate() {
    if (!selected || !confirmDiscard()) return;
    try { setSelectedId((await admin.duplicate.mutateAsync(selected.id)).id); toast.success('Duplicated'); }
    catch (e) { toast.error(errMsg(e, 'Could not duplicate')); }
  }

  async function resetBuiltIn() {
    if (!selected) return;
    if (!window.confirm(`Restore "${selected.name}" to its original built-in design? Your changes to it will be lost.`)) return;
    try { await admin.reset.mutateAsync(selected.id); toast.success('Restored'); }
    catch (e) { toast.error(errMsg(e, 'Could not restore')); }
  }

  async function remove() {
    if (!selected) return;
    if (!window.confirm(`Delete "${selected.name}"? Timelines using it will fall back to the first available template.`)) return;
    try { await admin.remove.mutateAsync(selected.id); setSelectedId(null); toast.success('Deleted'); }
    catch (e) { toast.error(errMsg(e, 'Could not delete')); }
  }

  const btn = { display: 'flex', alignItems: 'center', gap: 5 } as const;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Topbar breadcrumbs={[{ label: 'Admin' }, { label: 'Timeline Templates' }]} />
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 18, padding: '18px 24px 0' }}>

        {/* Template list */}
        <div style={{ width: 250, flexShrink: 0, overflowY: 'auto', paddingBottom: 24 }}>
          <div className="page-eyebrow">Admin</div>
          <h1 className="page-title" style={{ marginBottom: 4 }}>Timeline Templates</h1>
          <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '0 0 12px', lineHeight: 1.5 }}>Everyone picks from these when building a timeline.</p>
          <button className="tb-btn tb-btn-primary" onClick={createNew} style={{ ...btn, marginBottom: 12, width: '100%', justifyContent: 'center' }}><Plus size={13} /> New template</button>
          {isLoading ? <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Loading…</div> : (
            <div style={{ display: 'grid', gap: 10 }}>
              {templates.map((t) => (
                <TemplateThumb
                  key={t.id} template={t} items={sample.items} lanes={sample.lanes} title="Sample project plan"
                  selected={t.id === selectedId}
                  onSelect={() => { if (t.id !== selectedId && confirmDiscard()) setSelectedId(t.id); }}
                  footer={t.isBuiltIn ? <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>Built-in</div> : undefined}
                />
              ))}
            </div>
          )}
        </div>

        {/* Editor */}
        {draft && selected && layout ? (
          <>
            <div style={{ width: 330, flexShrink: 0, overflowY: 'auto', paddingBottom: 24 }}>
              <div className="card" style={{ padding: 12, marginBottom: 12 }}>
                <label style={{ fontSize: 11.5, color: 'var(--text-mid)' }}>Name</label>
                <input className="input-field" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={{ margin: '3px 0 8px', fontSize: 13 }} />
                <label style={{ fontSize: 11.5, color: 'var(--text-mid)' }}>Description</label>
                <input className="input-field" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} style={{ margin: '3px 0 8px', fontSize: 12.5 }} />
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 11.5, color: 'var(--text-mid)' }}>Category</label>
                    <input className="input-field" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} style={{ marginTop: 3, fontSize: 12.5 }} />
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, paddingBottom: 6, cursor: 'pointer' }} title="Inactive templates disappear from the picker but keep working for timelines already using them">
                    <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} /> Active
                  </label>
                </div>
              </div>
              <div className="card" style={{ padding: 12 }}>
                <ConfigControls config={draft.config} onChange={(path, value) => setDraft((d) => (d ? { ...d, config: setIn(d.config, path, value) } : d))} />
              </div>
            </div>

            <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', paddingBottom: 24 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <button className="tb-btn tb-btn-primary" onClick={save} disabled={!dirty || admin.update.isPending} style={btn}><Save size={13} /> {admin.update.isPending ? 'Saving…' : 'Save changes'}</button>
                {dirty && <button className="tb-btn tb-btn-ghost" onClick={() => setDraft({ name: selected.name, description: selected.description ?? '', category: selected.category, isActive: selected.isActive, config: resolveConfig(selected.config) })}>Discard</button>}
                <button className="tb-btn tb-btn-ghost" onClick={duplicate} style={btn}><Copy size={13} /> Duplicate</button>
                {selected.isBuiltIn ? (
                  <button className="tb-btn tb-btn-ghost" onClick={resetBuiltIn} style={btn}><RotateCcw size={13} /> Restore original</button>
                ) : (
                  <button className="tb-btn tb-btn-ghost" onClick={remove} style={{ ...btn, color: 'var(--rose)', borderColor: 'rgba(220,38,38,0.3)' }}><Trash2 size={13} /> Delete</button>
                )}
                {dirty && <span style={{ fontSize: 11.5, color: 'var(--amber)' }}>● Unsaved changes</span>}
              </div>
              <TimelinePreview layout={layout} fontFamily={draft.config.font.family} pageIndex={pageIndex} onPageIndex={setPageIndex} />
              <p style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 10, lineHeight: 1.5 }}>
                Previewed on a sample plan. {selected.isBuiltIn ? 'Built-in templates can be edited and later restored to their original design; they cannot be deleted (deactivate instead).' : 'Saving updates every timeline that uses this template.'}
              </p>
            </div>
          </>
        ) : <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>{isLoading ? '' : 'Select a template to edit.'}</div>}
      </div>
    </div>
  );
}
