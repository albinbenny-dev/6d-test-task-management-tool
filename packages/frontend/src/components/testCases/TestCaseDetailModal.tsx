import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { useTcItem, useUpdateTcItem, type TcItem } from '../../hooks/useTcItems';
import { useRBAC } from '../../hooks/useRBAC';

// ── Full test-case view/edit popup — the "eye" action from cycle/resource
// views. Test Management links to TcItem (the real TC Library test case),
// never the Script/TestCase model. Edits save straight to the real TcItem
// record (same PATCH /tc-items/:id used by TestCaseLibrary.tsx's
// EditItemModal), so a correction made while executing a cycle item is
// reflected everywhere else too. ───────────────────────────────────────────

const LABEL: React.CSSProperties = {
  fontSize: '9px',
  fontWeight: 700,
  letterSpacing: '0.8px',
  textTransform: 'uppercase',
  fontFamily: 'var(--font-mono)',
  color: 'var(--text-dim)',
  marginBottom: '5px',
};

const INPUT: React.CSSProperties = {
  width: '100%',
  background: 'var(--surface)',
  border: '1px solid var(--border2)',
  borderRadius: '6px',
  color: 'var(--text)',
  fontSize: '12px',
  padding: '7px 10px',
  outline: 'none',
  boxSizing: 'border-box',
};

interface EditState {
  srNo: string;
  module: string;
  feature: string;
  title: string;
  description: string;
  steps: string;
  expectedResult: string;
}

function toEditState(item: TcItem): EditState {
  return {
    srNo: item.srNo ?? '',
    module: item.module ?? '',
    feature: item.feature ?? '',
    title: item.title,
    description: item.description ?? '',
    steps: item.steps ?? '',
    expectedResult: item.expectedResult ?? '',
  };
}

export default function TestCaseDetailModal({ projectId, itemId, onClose }: {
  projectId: string;
  itemId: string;
  onClose: () => void;
}) {
  const { data: item, isLoading } = useTcItem(projectId, itemId);
  const updateItem = useUpdateTcItem(projectId);
  const { canWrite } = useRBAC();

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<EditState | null>(null);

  useEffect(() => {
    if (item) setForm(toEditState(item));
  }, [item?.id]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }

  async function handleSave() {
    if (!item || !form) return;
    if (!form.title.trim()) { toast.error('Title is required'); return; }
    try {
      await updateItem.mutateAsync({
        id: item.id,
        patch: {
          srNo: form.srNo.trim() || undefined,
          module: form.module.trim() || undefined,
          feature: form.feature.trim() || undefined,
          title: form.title.trim(),
          description: form.description.trim() || undefined,
          steps: form.steps.trim() || undefined,
          expectedResult: form.expectedResult.trim() || undefined,
        },
      });
      toast.success('Test case updated');
      setEditing(false);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to save';
      toast.error(msg);
    }
  }

  return (
    <div
      onClick={onClose}
      onKeyDown={handleKeyDown}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: '12px',
          width: '100%', maxWidth: '640px', maxHeight: '85vh', display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: '14px' }}>👁</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>
              {item ? item.title : 'Test Case'}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)' }}>{item?.srNo ?? '—'}</div>
          </div>
          {canWrite && item && !editing && (
            <button
              onClick={() => setEditing(true)}
              style={{
                width: '28px', height: '28px', background: 'var(--surface2)', border: '1px solid var(--border)',
                borderRadius: '6px', color: 'var(--text-dim)', fontSize: '12px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
              title="Edit test case"
            >
              ✏
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              width: '28px', height: '28px', background: 'var(--surface2)', border: '1px solid var(--border)',
              borderRadius: '6px', color: 'var(--text-dim)', fontSize: '14px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '18px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {isLoading || !item ? (
            <div style={{ color: 'var(--text-dim)', fontSize: '12px', textAlign: 'center', padding: '24px' }}>Loading…</div>
          ) : editing && form ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr', gap: '12px' }}>
                <div>
                  <div style={LABEL}>SR No</div>
                  <input style={INPUT} value={form.srNo} onChange={(e) => setForm({ ...form, srNo: e.target.value })} placeholder="e.g. AIR-TC-001" />
                </div>
                <div>
                  <div style={LABEL}>Module</div>
                  <input style={INPUT} value={form.module} onChange={(e) => setForm({ ...form, module: e.target.value })} placeholder="e.g. CPM" />
                </div>
                <div>
                  <div style={LABEL}>Feature</div>
                  <input style={INPUT} value={form.feature} onChange={(e) => setForm({ ...form, feature: e.target.value })} placeholder="e.g. Geo Hierarchy" />
                </div>
              </div>
              <div>
                <div style={LABEL}>Test Case Title *</div>
                <input style={INPUT} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div>
                <div style={LABEL}>Description</div>
                <textarea style={{ ...INPUT, resize: 'vertical', minHeight: '60px' }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div>
                <div style={LABEL}>Steps</div>
                <textarea
                  style={{ ...INPUT, resize: 'vertical', minHeight: '120px', fontFamily: 'var(--font-mono)', fontSize: '11px' }}
                  value={form.steps}
                  onChange={(e) => setForm({ ...form, steps: e.target.value })}
                  placeholder={'1. Navigate to...\n2. Click...\n3. Verify...'}
                />
              </div>
              <div>
                <div style={LABEL}>Expected Result</div>
                <textarea style={{ ...INPUT, resize: 'vertical', minHeight: '60px' }} value={form.expectedResult} onChange={(e) => setForm({ ...form, expectedResult: e.target.value })} />
              </div>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {item.module && <span className="badge badge-cyan">{item.module}</span>}
                {item.feature && <span className="badge badge-teal">{item.feature}</span>}
              </div>

              {item.description && (
                <div>
                  <div style={LABEL}>Description</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-mid)', whiteSpace: 'pre-wrap' }}>{item.description}</div>
                </div>
              )}

              <div>
                <div style={LABEL}>Steps</div>
                {item.steps ? (
                  <pre style={{ margin: 0, fontSize: '12px', color: 'var(--text)', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{item.steps}</pre>
                ) : (
                  <div style={{ fontSize: '12px', color: 'var(--text-dim)', fontStyle: 'italic' }}>No steps recorded</div>
                )}
              </div>

              {item.expectedResult && (
                <div>
                  <div style={LABEL}>Expected Result</div>
                  <div style={{ fontSize: '12px', color: 'var(--emerald)', whiteSpace: 'pre-wrap' }}>{item.expectedResult}</div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {editing && form && (
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', padding: '12px 18px', borderTop: '1px solid var(--border)' }}>
            <button
              onClick={() => { setEditing(false); if (item) setForm(toEditState(item)); }}
              style={{ padding: '7px 16px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-dim)', fontSize: '12px', cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={updateItem.isPending || !form.title.trim()}
              style={{
                padding: '7px 20px', background: 'var(--cyan-dim)', border: '1px solid rgba(37,99,171,0.35)',
                borderRadius: '6px', color: 'var(--cyan)', fontSize: '12px', fontWeight: 700,
                cursor: updateItem.isPending || !form.title.trim() ? 'not-allowed' : 'pointer',
                opacity: updateItem.isPending || !form.title.trim() ? 0.5 : 1,
              }}
            >
              {updateItem.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
