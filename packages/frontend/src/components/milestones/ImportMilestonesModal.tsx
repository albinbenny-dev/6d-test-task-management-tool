import { useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { FileSpreadsheet } from 'lucide-react';
import { useImportMilestones, type MilestoneImportResult } from '../../hooks/useMilestones';
import { useProjectStore } from '../../stores/projectStore';
import { formatMilestoneDate } from '../../lib/milestoneMeta';

function errMsg(err: unknown, fallback: string) {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback;
}

const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', fontSize: 10.5, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em' };
const td: React.CSSProperties = { padding: '6px 8px', fontSize: 12, borderTop: '1px solid var(--border)' };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', color: 'var(--cyan)', cursor: 'pointer', fontSize: 12, padding: 0 };

/** POs already in this project (a refresh) start ticked; POs new to the project start unticked so nothing lands here by accident. */
function defaultSelection(r: MilestoneImportResult): Set<string> {
  return new Set(r.pos.filter((p) => p.updated + p.unchanged > 0).map((p) => p.key));
}

/**
 * Upload the CRM "PO Report with Milestones" export and choose which of its POs to load into this
 * project (each chosen PO becomes its own milestone list). Previews before anything is saved.
 */
export function ImportMilestonesModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const currentUser = useProjectStore((s) => s.currentUser);
  const importer = useImportMilestones(projectId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pm, setPm] = useState('');
  const [preview, setPreview] = useState<MilestoneImportResult | null>(null);
  const [done, setDone] = useState<MilestoneImportResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(false);

  function showPreview(r: MilestoneImportResult) {
    setPreview(r);
    setSelected(defaultSelection(r));
  }

  async function runPreview(f: File, projectManager: string) {
    try {
      showPreview(await importer.mutateAsync({ file: f, projectManager, commit: false }));
    } catch (err) {
      setPreview(null);
      toast.error(errMsg(err, 'Could not read that file'));
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setFile(f); setDone(null); setPm(''); setSearch(''); setOnlyOpen(false);
    try {
      const first = await importer.mutateAsync({ file: f, projectManager: '', commit: false });
      // Default to the uploader's own rows when the file mixes several PMs.
      const mine = first.projectManagers.find((p) => p.name.toLowerCase() === (currentUser?.name ?? '').toLowerCase());
      if (mine && first.projectManagers.length > 1) { setPm(mine.name); await runPreview(f, mine.name); }
      else showPreview(first);
    } catch (err) {
      setPreview(null);
      toast.error(errMsg(err, 'Could not read that file'));
    }
  }

  async function handleCommit() {
    if (!file || selected.size === 0) return;
    try {
      setDone(await importer.mutateAsync({ file, projectManager: pm, commit: true, poKeys: [...selected] }));
    } catch (err) {
      toast.error(errMsg(err, 'Import failed'));
    }
  }

  const visiblePos = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (preview?.pos ?? []).filter((p) =>
      (!onlyOpen || p.notInvoiced > 0) && (!q || p.poName.toLowerCase().includes(q) || p.poNumber.toLowerCase().includes(q)));
  }, [preview, search, onlyOpen]);

  // Totals follow the ticked POs.
  const chosen = useMemo(() => (preview?.pos ?? []).filter((p) => selected.has(p.key)), [preview, selected]);
  const totals = useMemo(() => ({
    created: chosen.reduce((n, p) => n + p.created, 0),
    updated: chosen.reduce((n, p) => n + p.updated, 0),
    unchanged: chosen.reduce((n, p) => n + p.unchanged, 0),
    missingEvidence: chosen.reduce((n, p) => n + p.missingEvidence, 0),
  }), [chosen]);
  const shifts = (preview?.evidenceShifts ?? []).filter((s) => selected.has(s.poKey));

  const allVisibleTicked = visiblePos.length > 0 && visiblePos.every((p) => selected.has(p.key));
  function toggle(key: string) {
    setSelected((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  }
  function toggleVisible() {
    setSelected((prev) => {
      const n = new Set(prev);
      for (const p of visiblePos) { if (allVisibleTicked) n.delete(p.key); else n.add(p.key); }
      return n;
    });
  }

  const toLoad = totals.created + totals.updated;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 12, width: '100%', maxWidth: 720, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ flex: 1, fontSize: 14, fontWeight: 700 }}>{done ? 'Import complete' : 'Import milestones from CRM'}</div>
          <button onClick={onClose} style={{ width: 28, height: 28, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-dim)', cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ padding: 18, overflowY: 'auto' }}>
          {done ? (
            <div style={{ fontSize: 13 }}>
              ✅ <b>{done.created}</b> new and <b>{done.updated}</b> updated milestone{done.created + done.updated === 1 ? '' : 's'} across <b>{done.pos.length}</b> PO{done.pos.length === 1 ? '' : 's'}
              {done.unchanged > 0 && <span style={{ color: 'var(--text-dim)' }}> ({done.unchanged} already up to date)</span>}.
              {done.missingEvidence > 0 && (
                <div style={{ marginTop: 12, background: 'var(--amber-dim)', border: '1px solid var(--amber)', borderRadius: 8, padding: 10, fontSize: 12 }}>
                  {done.missingEvidence} not-yet-invoiced milestone{done.missingEvidence === 1 ? ' has' : 's have'} no Documentary Evidence Date, so no reminders will be sent for {done.missingEvidence === 1 ? 'it' : 'them'} until the CRM has one.
                </div>
              )}
            </div>
          ) : (
            <>
              <p style={{ fontSize: 12, color: 'var(--text-mid)', marginTop: 0, lineHeight: 1.55 }}>
                Upload the CRM <b>PO Report with Milestones</b> (.xlsx), then tick the POs that belong to <b>this project</b> — each becomes its own milestone list.
                Re-uploading updates the same milestones (matched on the CRM Record Id): dates and delivered / invoiced status are overwritten from the file,
                while your own notes are kept. Milestones missing from a file are left alone. Amounts are never imported.
              </p>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleFile} style={{ display: 'none' }} />
              <div
                onClick={() => !importer.isPending && fileRef.current?.click()}
                style={{ border: '2px dashed var(--border2)', borderRadius: 10, padding: '20px 16px', textAlign: 'center', cursor: 'pointer', color: 'var(--text-mid)', fontSize: 13, display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center' }}
              >
                <FileSpreadsheet size={16} />
                {importer.isPending ? 'Working…' : file ? file.name : 'Click to choose the CRM export (.xlsx)'}
              </div>

              {preview && (
                <div style={{ marginTop: 16 }}>
                  {preview.projectManagers.length > 1 && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, marginBottom: 12 }}>
                      Project Manager
                      <select
                        className="input-field"
                        value={pm}
                        onChange={(e) => { setPm(e.target.value); if (file) void runPreview(file, e.target.value); }}
                        style={{ fontSize: 12.5, padding: '4px 8px' }}
                      >
                        <option value="">All rows ({preview.projectManagers.reduce((n, p) => n + p.count, 0)})</option>
                        {preview.projectManagers.filter((p) => p.name).map((p) => <option key={p.name} value={p.name}>{p.name} ({p.count})</option>)}
                      </select>
                    </label>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                    <input
                      className="input-field"
                      placeholder="Search PO name or number…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      style={{ fontSize: 12.5, padding: '5px 8px', width: 230 }}
                    />
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
                      <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> Only POs with uninvoiced milestones
                    </label>
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{selected.size} of {preview.pos.length} PO{preview.pos.length === 1 ? '' : 's'} selected</span>
                    <button style={linkBtn} onClick={() => setSelected(new Set(preview.pos.map((p) => p.key)))}>Select all</button>
                    <button style={linkBtn} onClick={() => setSelected(new Set())}>Clear</button>
                  </div>

                  <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead style={{ position: 'sticky', top: 0, background: 'var(--surface2)' }}>
                        <tr>
                          <th style={{ ...th, width: 28 }}>
                            <input type="checkbox" checked={allVisibleTicked} onChange={toggleVisible} title="Tick / untick every PO shown" />
                          </th>
                          <th style={th}>PO</th><th style={th}>Milestones</th><th style={th}>New</th><th style={th}>Updated</th><th style={th}>Not invoiced</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visiblePos.map((p) => (
                          <tr key={p.key} onClick={() => toggle(p.key)} style={{ cursor: 'pointer', background: selected.has(p.key) ? 'var(--surface2)' : undefined }}>
                            <td style={td}><input type="checkbox" checked={selected.has(p.key)} onChange={() => toggle(p.key)} onClick={(e) => e.stopPropagation()} /></td>
                            <td style={td}>
                              {p.poName}
                              {p.updated + p.unchanged > 0 && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: 'var(--pass)' }}>IN PROJECT</span>}
                              <div style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>PO {p.poNumber}</div>
                            </td>
                            <td style={td}>{p.rows}</td><td style={td}>{p.created}</td><td style={td}>{p.updated}</td><td style={td}>{p.notInvoiced}</td>
                          </tr>
                        ))}
                        {visiblePos.length === 0 && (
                          <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: 'var(--text-dim)', padding: 16 }}>No POs match.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {selected.size > 0 && (
                    <div style={{ fontSize: 12.5, marginTop: 10 }}>
                      Selected: <b>{totals.created}</b> new, <b>{totals.updated}</b> updated, <b>{totals.unchanged}</b> unchanged.
                      {preview.skippedOtherPm > 0 && <span style={{ color: 'var(--text-dim)' }}> {preview.skippedOtherPm} row(s) for other project managers skipped.</span>}
                    </div>
                  )}

                  {shifts.length > 0 && (
                    <div style={{ marginTop: 12, fontSize: 12 }}>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>Evidence date changed on {shifts.length} milestone{shifts.length === 1 ? '' : 's'}</div>
                      {shifts.slice(0, 8).map((s, i) => (
                        <div key={i} style={{ color: 'var(--text-mid)' }}>• {s.milestone} <span style={{ color: 'var(--text-dim)' }}>({s.poName})</span>: {formatMilestoneDate(s.from)} → <b>{formatMilestoneDate(s.to)}</b></div>
                      ))}
                      {shifts.length > 8 && <div style={{ color: 'var(--text-dim)' }}>…and {shifts.length - 8} more</div>}
                    </div>
                  )}

                  {totals.missingEvidence > 0 && (
                    <div style={{ marginTop: 12, background: 'var(--amber-dim)', border: '1px solid var(--amber)', borderRadius: 8, padding: 10, fontSize: 12 }}>
                      {totals.missingEvidence} not-yet-invoiced milestone{totals.missingEvidence === 1 ? ' has' : 's have'} no Documentary Evidence Date, so no reminders will be sent for {totals.missingEvidence === 1 ? 'it' : 'them'} until the CRM has one.
                    </div>
                  )}
                  {preview.warnings.length > 0 && (
                    <div style={{ marginTop: 12, background: 'var(--amber-dim)', border: '1px solid var(--amber)', borderRadius: 8, padding: 10, fontSize: 12, maxHeight: 120, overflowY: 'auto' }}>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>⚠️ {preview.warnings.length} warning{preview.warnings.length === 1 ? '' : 's'}</div>
                      {preview.warnings.slice(0, 30).map((w, i) => <div key={i}>• {w}</div>)}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
            {done ? (
              <button className="tb-btn tb-btn-primary" onClick={onClose}>Done</button>
            ) : (
              <>
                <button className="tb-btn tb-btn-ghost" onClick={onClose}>Cancel</button>
                <button className="tb-btn tb-btn-primary" onClick={handleCommit} disabled={!preview || importer.isPending || selected.size === 0 || toLoad === 0}>
                  {importer.isPending ? 'Working…'
                    : selected.size === 0 ? 'Select POs to import'
                    : toLoad === 0 ? 'Already up to date'
                    : `Import ${toLoad} milestone${toLoad === 1 ? '' : 's'} from ${selected.size} PO${selected.size === 1 ? '' : 's'}`}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
