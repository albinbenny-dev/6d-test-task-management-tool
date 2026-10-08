import { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { FileSpreadsheet, ListChecks } from 'lucide-react';
import { api } from '../../lib/api';
import type { ImportResult, useTimelineEditor } from '../../hooks/useTimelines';
import { useTaskLists } from '../../hooks/useTaskLists';
import { useMilestoneLists } from '../../hooks/useMilestoneLists';

type Actions = ReturnType<typeof useTimelineEditor>;

function errMsg(err: unknown, fallback: string) {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback;
}

export function ImportTimelineModal({ projectId, hasData, actions, onClose }: {
  projectId: string;
  hasData: boolean;
  actions: Actions;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'file' | 'project'>('file');
  const [mode, setMode] = useState<'append' | 'replace'>('append');
  const [result, setResult] = useState<ImportResult | { itemsImported: number; swimlanesCreated: number; skippedEmpty?: number; warnings?: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: taskLists = [] } = useTaskLists(projectId);
  const { data: milestoneLists = [] } = useMilestoneLists(projectId);
  const [pickedTaskLists, setPickedTaskLists] = useState<Set<string>>(new Set());
  const [pickedMilestoneLists, setPickedMilestoneLists] = useState<Set<string>>(new Set());

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (mode === 'replace' && hasData && !window.confirm('Replace will delete every existing swimlane and item in this timeline first. Continue?')) return;
    try {
      setResult(await actions.importFile.mutateAsync({ file, mode }));
    } catch (err) {
      toast.error(errMsg(err, 'Import failed — check the file format'));
    }
  }

  async function handleTemplate() {
    try {
      const res = await api.get(`/projects/${projectId}/timelines/import-template`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a'); a.href = url; a.download = 'timeline-import-template.xlsx'; a.click(); URL.revokeObjectURL(url);
    } catch { toast.error('Template download failed'); }
  }

  async function handleFromProject() {
    try {
      setResult(await actions.importFromProject.mutateAsync({ taskListIds: [...pickedTaskLists], milestoneListIds: [...pickedMilestoneLists] }));
    } catch (err) {
      toast.error(errMsg(err, 'Import failed'));
    }
  }

  const toggle = (set: Set<string>, id: string, setter: (s: Set<string>) => void) => {
    const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); setter(n);
  };

  const tabBtn = (key: 'file' | 'project', label: string, icon: React.ReactNode) => (
    <button
      onClick={() => { setTab(key); setResult(null); }}
      style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, justifyContent: 'center', padding: '9px 10px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: tab === key ? 'var(--cyan)' : 'var(--text-dim)', borderBottom: tab === key ? '2px solid var(--cyan)' : '2px solid transparent' }}
    >{icon}{label}</button>
  );

  const warnings = result && 'warnings' in result ? result.warnings ?? [] : [];

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 12, width: '100%', maxWidth: 520, maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ flex: 1, fontSize: 14, fontWeight: 700 }}>{result ? 'Import complete' : 'Import tasks'}</div>
          <button onClick={onClose} style={{ width: 28, height: 28, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-dim)', cursor: 'pointer' }}>×</button>
        </div>

        {result ? (
          <div style={{ padding: 18, overflowY: 'auto' }}>
            <div style={{ fontSize: 13, marginBottom: 10 }}>
              ✅ Imported <b>{result.itemsImported}</b> item{result.itemsImported === 1 ? '' : 's'}
              {result.swimlanesCreated > 0 && <> and created <b>{result.swimlanesCreated}</b> swimlane{result.swimlanesCreated === 1 ? '' : 's'}</>}.
              {'skippedEmpty' in result && result.skippedEmpty ? <span style={{ color: 'var(--text-dim)' }}> {result.skippedEmpty} empty row(s) skipped.</span> : null}
            </div>
            {warnings.length > 0 && (
              <div style={{ background: 'var(--amber-dim)', border: '1px solid var(--amber)', borderRadius: 8, padding: 10, fontSize: 12, maxHeight: 200, overflowY: 'auto' }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>⚠️ {warnings.length} warning{warnings.length === 1 ? '' : 's'}</div>
                {warnings.slice(0, 50).map((w, i) => <div key={i}>• {w}</div>)}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="tb-btn tb-btn-primary" onClick={onClose}>Done</button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
              {tabBtn('file', 'Excel / CSV file', <FileSpreadsheet size={14} />)}
              {tabBtn('project', 'From project tasks', <ListChecks size={14} />)}
            </div>

            {tab === 'file' ? (
              <div style={{ padding: 18, overflowY: 'auto' }}>
                <p style={{ fontSize: 12, color: 'var(--text-mid)', marginTop: 0, lineHeight: 1.55 }}>
                  Needs a <b>Title</b> and a <b>Start</b> date, plus an <b>End</b> date or a <b>Duration</b> (working days). Optional: Type, Swimlane, % Complete, Assigned To, Color, Marker.
                  Exported from MS Project (<i>File → Save As → Excel</i>)? Upload it as is — its columns are recognised.
                </p>
                <div style={{ display: 'flex', gap: 14, fontSize: 12.5, margin: '12px 0' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                    <input type="radio" checked={mode === 'append'} onChange={() => setMode('append')} /> Add to existing
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                    <input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} /> Replace everything
                  </label>
                </div>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} style={{ display: 'none' }} />
                <div
                  onClick={() => !actions.importFile.isPending && fileRef.current?.click()}
                  style={{ border: '2px dashed var(--border2)', borderRadius: 10, padding: '26px 16px', textAlign: 'center', cursor: 'pointer', color: 'var(--text-mid)', fontSize: 13 }}
                >
                  {actions.importFile.isPending ? 'Importing…' : 'Click to choose an .xlsx, .xls or .csv file'}
                </div>
                <button onClick={handleTemplate} style={{ marginTop: 12, background: 'none', border: 'none', color: 'var(--cyan)', cursor: 'pointer', fontSize: 12.5, padding: 0 }}>
                  ⬇ Download the Excel template
                </button>
              </div>
            ) : (
              <div style={{ padding: 18, overflowY: 'auto' }}>
                <p style={{ fontSize: 12, color: 'var(--text-mid)', marginTop: 0, lineHeight: 1.55 }}>
                  Copies items into this timeline, one swimlane per list. It's a snapshot — later edits to the project's tasks won't move the timeline.
                  Top-level tasks with dates only; a task with just a due date becomes a milestone.
                </p>
                <PickList title="Task lists" lists={taskLists.map((l) => ({ id: l.id, name: l.name }))} picked={pickedTaskLists} onToggle={(id) => toggle(pickedTaskLists, id, setPickedTaskLists)} />
                <PickList title="Milestone lists" lists={milestoneLists.map((l) => ({ id: l.id, name: l.name }))} picked={pickedMilestoneLists} onToggle={(id) => toggle(pickedMilestoneLists, id, setPickedMilestoneLists)} />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
                  <button
                    className="tb-btn tb-btn-primary"
                    disabled={actions.importFromProject.isPending || pickedTaskLists.size + pickedMilestoneLists.size === 0}
                    onClick={handleFromProject}
                  >{actions.importFromProject.isPending ? 'Importing…' : 'Import selected'}</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PickList({ title, lists, picked, onToggle }: { title: string; lists: { id: string; name: string }[]; picked: Set<string>; onToggle: (id: string) => void }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>{title}</div>
      {lists.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>None in this project.</div>
      ) : lists.map((l) => (
        <label key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12.5, cursor: 'pointer' }}>
          <input type="checkbox" checked={picked.has(l.id)} onChange={() => onToggle(l.id)} /> {l.name}
        </label>
      ))}
    </div>
  );
}
