import { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../lib/api';
import { useImportTasks, type ImportTasksResult } from '../../hooks/useTasks';

// Mirrors TestCaseLibrary.tsx's ImportModal closely (upload view → summary
// view, template-download-as-blob, dashed dropzone) — see that component for
// the original pattern this was adapted from.
export function ImportTasksModal({ projectId, taskListId, onClose, onImported }: {
  projectId: string;
  taskListId: string;
  onClose: () => void;
  /** The importing mutation already invalidates the task/list queries on success — this is only for callers that need an extra side effect. */
  onImported?: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<ImportTasksResult | null>(null);
  const importMutation = useImportTasks(projectId);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const result = await importMutation.mutateAsync({ file, taskListId });
      setSummary(result);
      onImported?.();
    } catch { toast.error('Import failed — check the file format'); }
    finally { setImporting(false); }
  }

  async function handleDownloadTemplate() {
    try {
      const res = await api.get(`/projects/${projectId}/tasks/template`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a'); a.href = url; a.download = 'task-import-template.xlsx'; a.click(); URL.revokeObjectURL(url);
    } catch { toast.error('Template download failed'); }
  }

  const warningGroups = summary ? [
    { key: 'skippedEmpty', count: summary.skippedEmpty, label: `${summary.skippedEmpty} empty row${summary.skippedEmpty === 1 ? '' : 's'} skipped`, note: 'Rows with no Task Title were ignored.', items: null as string[] | null },
    { key: 'duplicateRows', count: summary.duplicateRows.length, label: `${summary.duplicateRows.length} duplicate task${summary.duplicateRows.length === 1 ? '' : 's'} skipped`, note: 'Later rows sharing a title with an earlier row in this file were ignored.', items: summary.duplicateRows },
    { key: 'unmatchedAssignees', count: summary.unmatchedAssignees.length, label: `${summary.unmatchedAssignees.length} assignee email${summary.unmatchedAssignees.length === 1 ? '' : 's'} not found`, note: "These rows were imported unassigned — the email didn't match a project member.", items: summary.unmatchedAssignees },
    { key: 'unresolvedParents', count: summary.unresolvedParents.length, label: `${summary.unresolvedParents.length} parent link${summary.unresolvedParents.length === 1 ? '' : 's'} not applied`, note: "The declared parent title didn't resolve to a row in this file, or would create a second level of nesting.", items: summary.unresolvedParents },
  ].filter((g) => g.count > 0) : [];
  const hasWarnings = warningGroups.length > 0;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: '12px', width: '100%', maxWidth: summary ? '480px' : '420px', maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 18px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <span style={{ fontSize: '14px' }}>{summary ? (hasWarnings ? '⚠️' : '✅') : '📥'}</span>
          <div style={{ flex: 1, fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>
            {summary ? 'Import Summary' : 'Import Tasks from Excel'}
          </div>
          <button onClick={onClose} style={{ width: '28px', height: '28px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-dim)', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        {summary ? (
          <div style={{ overflowY: 'auto', flex: 1, padding: '18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
              {[
                { label: 'Total rows', value: summary.totalRows, color: 'var(--text-dim)' },
                { label: 'New', value: summary.imported, color: 'var(--pass)' },
                { label: 'Updated', value: summary.updated, color: summary.updated > 0 ? 'var(--cyan)' : 'var(--text-dim)' },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
                  <div style={{ fontSize: '22px', fontWeight: 800, color, fontFamily: 'var(--font-mono)' }}>{value}</div>
                  <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginTop: '2px', fontWeight: 600 }}>{label}</div>
                </div>
              ))}
            </div>

            {warningGroups.map((g) => (
              <div key={g.key} style={{ background: 'rgba(217,119,6,0.07)', border: '1px solid rgba(217,119,6,0.25)', borderRadius: '8px', padding: '10px 14px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--amber)', marginBottom: g.items ? '6px' : '2px' }}>⚠ {g.label}</div>
                <div style={{ fontSize: '10px', color: 'var(--text-dim)' }}>{g.note}</div>
                {g.items && g.items.length > 0 && (
                  <div style={{ maxHeight: '100px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '6px' }}>
                    {g.items.map((item, i) => (
                      <div key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>• {item}</div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {!hasWarnings && (
              <div style={{ background: 'rgba(5,150,105,0.07)', border: '1px solid rgba(5,150,105,0.25)', borderRadius: '8px', padding: '10px 14px', fontSize: '11px', color: 'var(--pass)', fontWeight: 600 }}>
                ✓ Import completed with no issues.
              </div>
            )}

            <button onClick={onClose} style={{ marginTop: '4px', padding: '8px', background: 'var(--cyan-dim)', border: '1px solid rgba(2,132,199,0.35)', borderRadius: '7px', color: 'var(--cyan)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
              Done
            </button>
          </div>
        ) : (
          <div style={{ padding: '20px 18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-mid)', lineHeight: 1.6 }}>
              Upload an Excel file with columns: <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--cyan)' }}>Task Title, Description, Assignee Email, Priority, Status, Start Date, Due Date, Tags, Parent Task Title</span>
            </p>
            <button onClick={handleDownloadTemplate} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-dim)', fontSize: '11px', cursor: 'pointer', width: 'fit-content' }}>📄 Download template</button>
            <div
              onClick={() => !importing && fileRef.current?.click()}
              style={{ border: '2px dashed var(--border2)', borderRadius: '8px', padding: '28px', textAlign: 'center', cursor: importing ? 'wait' : 'pointer', opacity: importing ? 0.6 : 1 }}
              onMouseEnter={(e) => { if (!importing) (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--cyan)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border2)'; }}
            >
              <div style={{ fontSize: '28px', marginBottom: '8px' }}>{importing ? '⏳' : '📊'}</div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)', marginBottom: '4px' }}>{importing ? 'Importing…' : 'Click to select Excel file'}</div>
              <div style={{ fontSize: '10px', color: 'var(--text-dim)' }}>.xlsx or .xls</div>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleFile} disabled={importing} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
