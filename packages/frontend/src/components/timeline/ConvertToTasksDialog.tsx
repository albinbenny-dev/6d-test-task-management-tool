import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import type { TLItem, TLLane } from '../../lib/timeline/types';
import { useConvertToTasks, type ConvertPayload, type ConvertSummary } from '../../hooks/useTimelines';
import { useTaskLists } from '../../hooks/useTaskLists';

function errMsg(err: unknown, fallback: string) {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback;
}

const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', fontSize: 10.5, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em' };
const td: React.CSSProperties = { padding: '6px 8px', fontSize: 12, borderTop: '1px solid var(--border)' };
const label: React.CSSProperties = { fontSize: 12, color: 'var(--text-mid)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' };
const UNGROUPED = '__none__';

/**
 * Turn timeline rows into Task Lists / Tasks.
 *  · selection — the ticked rows become one task list (or one parent task with subtasks), or one group per swimlane
 *  · lanes     — every swimlane becomes its own task list
 * Always previews first; nothing is written until "Create".
 */
export function ConvertToTasksDialog({ projectId, timelineId, mode, items, lanes, onClose, onDone }: {
  projectId: string;
  timelineId: string;
  mode: 'selection' | 'lanes';
  items: TLItem[];
  lanes: TLLane[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const convert = useConvertToTasks(projectId, timelineId);
  const { data: taskLists = [] } = useTaskLists(projectId);

  const laneIndex = useMemo(() => new Map(lanes.map((l, i) => [l.id, i])), [lanes]);
  const laneOf = (i: TLItem) => (i.swimlaneId && laneIndex.has(i.swimlaneId) ? i.swimlaneId : UNGROUPED);
  const laneName = (key: string) => (key === UNGROUPED ? 'Ungrouped' : lanes.find((l) => l.id === key)?.name ?? 'Ungrouped');

  // Table order: swimlane order, then the row order inside each lane.
  const ordered = useMemo(() => [...items].sort((a, b) =>
    (laneIndex.get(a.swimlaneId ?? '') ?? 999) - (laneIndex.get(b.swimlaneId ?? '') ?? 999) || a.sortOrder - b.sortOrder || a.startDate.localeCompare(b.startDate)), [items, laneIndex]);
  const usable = ordered.filter((i) => !i.taskId);
  const linkedCount = ordered.length - usable.length;
  const byLane = useMemo(() => {
    const m = new Map<string, TLItem[]>();
    usable.forEach((i) => m.set(laneOf(i), [...(m.get(laneOf(i)) ?? []), i]));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usable.length, items]);
  const laneKeys = [...byLane.keys()];

  const [shape, setShape] = useState<'FLAT' | 'PARENT'>('FLAT');
  // The name defaults sensibly for whichever shape is chosen until the user types their own.
  const [nameEdit, setNameEdit] = useState<string | null>(null);
  const [perLane, setPerLane] = useState(false);
  const [parentListId, setParentListId] = useState('');
  const [newListName, setNewListName] = useState(laneKeys.length === 1 ? laneName(laneKeys[0]) : 'Imported tasks');
  const [replace, setReplace] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set(laneKeys));
  const [laneNames, setLaneNames] = useState<Record<string, string>>(() => Object.fromEntries(laneKeys.map((k) => [k, laneName(k)])));
  const [preview, setPreview] = useState<ConvertSummary | null>(null);
  const [result, setResult] = useState<ConvertSummary | null>(null);

  const reset = () => setPreview(null);
  const effShape: 'FLAT' | 'PARENT' = mode === 'lanes' ? 'FLAT' : shape;
  const name = nameEdit ?? (laneKeys.length === 1 ? laneName(laneKeys[0]) : shape === 'FLAT' ? 'New task list' : 'New parent task');

  const payload = (dryRun: boolean): ConvertPayload | null => {
    let groups: { name: string; itemIds: string[] }[];
    if (mode === 'lanes') {
      groups = laneKeys.filter((k) => picked.has(k)).map((k) => ({ name: (laneNames[k] ?? laneName(k)).trim(), itemIds: (byLane.get(k) ?? []).map((i) => i.id) }));
    } else if (perLane) {
      groups = laneKeys.map((k) => ({ name: laneName(k), itemIds: (byLane.get(k) ?? []).map((i) => i.id) }));
    } else {
      groups = [{ name: name.trim(), itemIds: usable.map((i) => i.id) }];
    }
    if (groups.length === 0 || groups.some((g) => !g.name || g.itemIds.length === 0)) return null;
    return {
      groups, shape: effShape, dryRun,
      replaceOnTimeline: effShape === 'FLAT' && replace,
      ...(effShape === 'PARENT' ? (parentListId ? { targetTaskListId: parentListId } : { targetTaskListName: newListName.trim() }) : {}),
    };
  };

  async function run(dryRun: boolean) {
    const body = payload(dryRun);
    if (!body) { toast.error('Give every group a name'); return; }
    if (effShape === 'PARENT' && !parentListId && !newListName.trim()) { toast.error('Choose the task list the parent task goes into'); return; }
    try {
      const res = await convert.mutateAsync(body);
      if (dryRun) setPreview(res); else { setResult(res); onDone(); }
    } catch (err) {
      toast.error(errMsg(err, dryRun ? 'Could not preview the conversion' : 'Conversion failed'));
    }
  }

  const busy = convert.isPending;
  const total = usable.length;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 12, width: '100%', maxWidth: 640, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ flex: 1, fontSize: 14, fontWeight: 700 }}>
            {result ? 'Task lists created' : mode === 'lanes' ? 'Convert swimlanes to task lists' : 'Create task list from selected rows'}
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-dim)', cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ padding: 18, overflowY: 'auto' }}>
          {result ? (
            <div style={{ fontSize: 13, lineHeight: 1.7 }}>
              ✅ Created <b>{result.tasksCreated}</b> task{result.tasksCreated === 1 ? '' : 's'}
              {result.parentsCreated ? <> under <b>{result.parentsCreated}</b> parent task{result.parentsCreated === 1 ? '' : 's'}</> : null}
              {result.listsCreated && result.listsCreated.length > 0 ? <> in {result.listsCreated.length} new task list{result.listsCreated.length === 1 ? '' : 's'}</> : <> in existing task lists</>}.
              {result.totalAlreadyThere > 0 && <div style={{ color: 'var(--text-dim)' }}>{result.totalAlreadyThere} row{result.totalAlreadyThere === 1 ? ' was' : 's were'} already in the list and left alone.</div>}
              {result.replaced ? <div>Replaced {result.replaced} timeline row{result.replaced === 1 ? '' : 's'} with {result.lanesLinked ?? 0} swimlane{result.lanesLinked === 1 ? '' : 's'} that follow the task list{result.lanesLinked === 1 ? '' : 's'}.</div> : <div style={{ color: 'var(--text-dim)' }}>Your timeline rows are unchanged.</div>}
              {result.unmatchedAssignees.length > 0 && <div style={{ color: 'var(--text-dim)' }}>Kept as free-text names (not project members): {result.unmatchedAssignees.slice(0, 8).join(', ')}{result.unmatchedAssignees.length > 8 ? '…' : ''}</div>}
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: 'var(--text-mid)', lineHeight: 1.55, marginBottom: 12 }}>
                {mode === 'lanes'
                  ? <>Each ticked swimlane becomes its own task list; its rows become tasks. </>
                  : <><b>{total}</b> row{total === 1 ? '' : 's'} selected. </>}
                {linkedCount > 0 && <span style={{ color: 'var(--amber)' }}>{linkedCount} already linked to a task {linkedCount === 1 ? 'is' : 'are'} skipped. </span>}
                Progress becomes a status (100% Done · 1–99% In Progress · otherwise To Do) and the exact % goes in the description. Assignees get no emails.
              </div>

              {mode === 'selection' && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                    <label style={label}><input type="radio" checked={shape === 'FLAT'} onChange={() => { setShape('FLAT'); reset(); }} /> Tasks in a new task list</label>
                    <label style={label}><input type="radio" checked={shape === 'PARENT'} onChange={() => { setShape('PARENT'); setReplace(false); reset(); }} /> Subtasks under one parent task (like a sub-heading)</label>
                  </div>
                  {laneKeys.length > 1 && (
                    <label style={{ ...label, marginBottom: 12 }}>
                      <input type="checkbox" checked={perLane} onChange={(e) => { setPerLane(e.target.checked); reset(); }} />
                      One {shape === 'FLAT' ? 'task list' : 'parent task'} per swimlane ({laneKeys.length}), named after the swimlane
                    </label>
                  )}
                  {!perLane && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, marginBottom: 12 }}>
                      {shape === 'FLAT' ? 'Task list name' : 'Parent task name'}
                      <input className="input-field" value={name} onChange={(e) => { setNameEdit(e.target.value); reset(); }} maxLength={100} style={{ flex: 1, fontSize: 12.5, padding: '5px 8px' }} />
                    </label>
                  )}
                  {shape === 'PARENT' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, marginBottom: 12, flexWrap: 'wrap' }}>
                      In task list
                      <select className="input-field" value={parentListId} onChange={(e) => { setParentListId(e.target.value); reset(); }} style={{ fontSize: 12.5, padding: '5px 8px' }}>
                        <option value="">New task list…</option>
                        {taskLists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </select>
                      {!parentListId && <input className="input-field" value={newListName} onChange={(e) => { setNewListName(e.target.value); reset(); }} maxLength={100} placeholder="New list name" style={{ flex: 1, minWidth: 160, fontSize: 12.5, padding: '5px 8px' }} />}
                    </div>
                  )}
                </>
              )}

              {mode === 'lanes' && (
                <div style={{ border: '1px solid var(--border)', borderRadius: 8, maxHeight: 260, overflowY: 'auto', marginBottom: 12 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead style={{ position: 'sticky', top: 0, background: 'var(--surface2)' }}><tr><th style={{ ...th, width: 28 }} /><th style={th}>Swimlane → task list name</th><th style={th}>Rows</th></tr></thead>
                    <tbody>
                      {laneKeys.map((k) => (
                        <tr key={k}>
                          <td style={td}><input type="checkbox" checked={picked.has(k)} onChange={(e) => { setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(k); else n.delete(k); return n; }); reset(); }} /></td>
                          <td style={td}><input className="input-field" value={laneNames[k] ?? ''} onChange={(e) => { setLaneNames((n) => ({ ...n, [k]: e.target.value })); reset(); }} maxLength={100} style={{ width: '100%', fontSize: 12, padding: '3px 6px' }} /></td>
                          <td style={td}>{byLane.get(k)?.length ?? 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {effShape === 'FLAT' && (
                <label style={{ ...label, alignItems: 'flex-start', marginBottom: 12 }}>
                  <input type="checkbox" checked={replace} onChange={(e) => { setReplace(e.target.checked); reset(); }} style={{ marginTop: 2 }} />
                  <span>Replace these rows on the timeline with a swimlane that follows the new task list<br />
                    <span style={{ color: 'var(--text-dim)', fontSize: 11.5 }}>Off keeps your rows exactly as they are. On deletes them: the timeline then reads from the Task page, so its bars become read-only and progress shows as status (0 / 50 / 75 / 100%).</span>
                  </span>
                </label>
              )}

              {preview && (
                <div style={{ marginTop: 4 }}>
                  <div style={{ fontSize: 13, marginBottom: 8 }}>
                    Will create <b>{preview.totalToCreate}</b> task{preview.totalToCreate === 1 ? '' : 's'}
                    {preview.totalAlreadyThere > 0 && <span style={{ color: 'var(--text-dim)' }}> · {preview.totalAlreadyThere} already in the list (skipped)</span>}
                    {preview.totalSkippedLinked > 0 && <span style={{ color: 'var(--text-dim)' }}> · {preview.totalSkippedLinked} already linked (skipped)</span>}
                  </div>
                  <div style={{ border: '1px solid var(--border)', borderRadius: 8, maxHeight: 220, overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead style={{ position: 'sticky', top: 0, background: 'var(--surface2)' }}>
                        <tr><th style={th}>{preview.shape === 'FLAT' ? 'Task list' : 'Parent task'}</th><th style={th}>New tasks</th><th style={th}>To do · In progress · Done</th><th style={th}>Note</th></tr>
                      </thead>
                      <tbody>
                        {preview.groups.map((g) => (
                          <tr key={g.name}>
                            <td style={td}>{g.name}</td>
                            <td style={td}>{g.toCreate}</td>
                            <td style={td}>{g.statusCounts.TO_DO ?? 0} · {g.statusCounts.IN_PROGRESS ?? 0} · {g.statusCounts.DONE ?? 0}</td>
                            <td style={{ ...td, color: 'var(--text-dim)' }}>{g.exists ? (preview.shape === 'FLAT' ? 'adds to existing list' : 'adds to existing parent') : 'new'}{g.alreadyThere ? ` · ${g.alreadyThere} already there` : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {preview.shape === 'PARENT' && preview.targetList && (
                    <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 6 }}>Parent tasks go in {preview.targetList.exists ? 'the existing' : 'a new'} task list “{preview.targetList.name}”.</div>
                  )}
                  {preview.unmatchedAssignees.length > 0 && (
                    <div style={{ marginTop: 8, background: 'var(--amber-dim)', border: '1px solid var(--amber)', borderRadius: 8, padding: 8, fontSize: 12 }}>
                      Not project members, so kept as free-text names: {preview.unmatchedAssignees.slice(0, 10).join(', ')}{preview.unmatchedAssignees.length > 10 ? '…' : ''}
                    </div>
                  )}
                  {preview.replaceOnTimeline && (
                    <div style={{ marginTop: 8, background: 'var(--amber-dim)', border: '1px solid var(--amber)', borderRadius: 8, padding: 8, fontSize: 12 }}>
                      The converted rows will be removed from this timeline and replaced by swimlanes that follow the task list.
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
            {result ? (
              <>
                <button className="tb-btn tb-btn-ghost" onClick={onClose}>Close</button>
                <button className="tb-btn tb-btn-primary" onClick={() => navigate(`/projects/${slug}/tasks`)}>Open task lists</button>
              </>
            ) : (
              <>
                <button className="tb-btn tb-btn-ghost" onClick={onClose}>Cancel</button>
                {!preview
                  ? <button className="tb-btn tb-btn-primary" disabled={busy || total === 0} onClick={() => run(true)}>{busy ? 'Checking…' : total === 0 ? 'Nothing to convert' : 'Preview'}</button>
                  : <button className="tb-btn tb-btn-primary" disabled={busy || (preview.totalToCreate === 0 && !preview.replaceOnTimeline)} onClick={() => run(false)}>
                      {busy ? 'Creating…' : preview.totalToCreate === 0 ? 'Nothing new to create' : `Create ${preview.totalToCreate} task${preview.totalToCreate === 1 ? '' : 's'}`}
                    </button>}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
