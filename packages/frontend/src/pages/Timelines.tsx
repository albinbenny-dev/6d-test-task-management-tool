import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Copy, GanttChartSquare, Plus, Trash2 } from 'lucide-react';
import Topbar, { TbBtn } from '../components/layout/Topbar';
import { useProject } from '../hooks/useProjects';
import { useRBAC } from '../hooks/useRBAC';
import { useCreateTimeline, useDeleteTimeline, useDuplicateTimeline, useTimelines, useTimelineTemplates } from '../hooks/useTimelines';

function errMsg(err: unknown, fallback: string) {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback;
}

export default function Timelines() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { data: project } = useProject(slug);
  const projectId = project?.id;
  const { canManageTimelines } = useRBAC();

  const { data: timelines = [], isLoading } = useTimelines(projectId);
  const { data: templates = [] } = useTimelineTemplates();
  const createTimeline = useCreateTimeline(projectId ?? '');
  const deleteTimeline = useDeleteTimeline(projectId ?? '');
  const duplicateTimeline = useDuplicateTimeline(projectId ?? '');

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');

  async function handleCreate() {
    if (!name.trim()) { toast.error('Give the timeline a name'); return; }
    try {
      const t = await createTimeline.mutateAsync({ name: name.trim(), templateId: templateId || null });
      navigate(`/projects/${slug}/timelines/${t.id}`);
    } catch (err) { toast.error(errMsg(err, 'Could not create the timeline')); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Topbar
        breadcrumbs={[{ label: project?.name ?? slug ?? 'Project' }, { label: 'Timelines' }]}
        actions={canManageTimelines ? <TbBtn variant="primary" onClick={() => setCreating(true)}><Plus size={12} style={{ marginRight: 4, verticalAlign: -2 }} />New timeline</TbBtn> : undefined}
      />
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        <div className="page-eyebrow">Delivery Tracking</div>
        <h1 className="page-title">Timelines</h1>
        <p className="page-sub">Turn a project plan into a presentation-ready timeline. Upload an Excel/CSV plan or add tasks directly, watch it render live in a template, then export it as an image or an editable PowerPoint slide.</p>

        {isLoading ? (
          <div style={{ color: 'var(--text-dim)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>Loading…</div>
        ) : timelines.length === 0 ? (
          <div className="card" style={{ padding: 32, textAlign: 'center', marginTop: 20 }}>
            <GanttChartSquare size={28} style={{ color: 'var(--text-dim)', marginBottom: 8 }} />
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>No timelines yet</div>
            <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '0 0 14px' }}>
              {canManageTimelines ? 'Create one to start building your project plan visual.' : 'No one has created a timeline for this project yet.'}
            </p>
            {canManageTimelines && <button className="tb-btn tb-btn-primary" onClick={() => setCreating(true)}>Create timeline</button>}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14, marginTop: 20 }}>
            {timelines.map((t) => (
              <div key={t.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <Link to={`/projects/${slug}/timelines/${t.id}`} style={{ display: 'block', padding: 16, textDecoration: 'none', color: 'inherit' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <span style={{ width: 34, height: 34, borderRadius: 8, background: 'var(--cyan-dim)', color: 'var(--cyan)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><GanttChartSquare size={18} /></span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{t.template?.name ?? 'No template'}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--text-mid)' }}>
                    <span><b>{t.itemCount}</b> item{t.itemCount === 1 ? '' : 's'}</span>
                    <span><b>{t.swimlaneCount}</b> swimlane{t.swimlaneCount === 1 ? '' : 's'}</span>
                    <span style={{ marginLeft: 'auto', color: 'var(--text-dim)' }}>{new Date(t.updatedAt).toLocaleDateString()}</span>
                  </div>
                </Link>
                {canManageTimelines && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 2, padding: '4px 8px', borderTop: '1px solid var(--border)', background: 'var(--surface2)' }}>
                    <button
                      title="Duplicate"
                      onClick={() => duplicateTimeline.mutate(t.id, { onSuccess: () => toast.success('Timeline duplicated'), onError: () => toast.error('Could not duplicate') })}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: 6, display: 'flex' }}
                    ><Copy size={14} /></button>
                    <button
                      title="Delete"
                      onClick={() => { if (window.confirm(`Delete "${t.name}" and everything in it?`)) deleteTimeline.mutate(t.id, { onError: () => toast.error('Could not delete') }); }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: 6, display: 'flex' }}
                    ><Trash2 size={14} /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {creating && (
        <div onClick={() => setCreating(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 12, width: '100%', maxWidth: 420, padding: 20, boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>New timeline</div>
            <label style={{ fontSize: 11.5, color: 'var(--text-mid)' }}>Name</label>
            <input autoFocus className="input-field" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }} placeholder="e.g. Programme plan — Phase 1" style={{ margin: '4px 0 12px', fontSize: 13 }} />
            <label style={{ fontSize: 11.5, color: 'var(--text-mid)' }}>Starting template</label>
            <select className="input-field" value={templateId} onChange={(e) => setTemplateId(e.target.value)} style={{ margin: '4px 0 16px', fontSize: 13 }}>
              <option value="">Default ({templates[0]?.name ?? 'first available'})</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 14 }}>You can switch template any time, and see every one rendered with your own plan.</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="tb-btn tb-btn-ghost" onClick={() => setCreating(false)}>Cancel</button>
              <button className="tb-btn tb-btn-primary" onClick={handleCreate} disabled={createTimeline.isPending}>{createTimeline.isPending ? 'Creating…' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
