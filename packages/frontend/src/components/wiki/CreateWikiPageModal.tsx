import { useState } from 'react';
import toast from 'react-hot-toast';
import { useCreateWikiPage } from '../../hooks/useWiki';

export function CreateWikiPageModal({ projectId, parentPageId, parentTitle, onClose, onCreated }: {
  projectId: string;
  parentPageId?: string;
  parentTitle?: string;
  onClose: () => void;
  onCreated?: (pageId: string) => void;
}) {
  const createPage = useCreateWikiPage(projectId);
  const [title, setTitle] = useState('');
  const [tagsInput, setTagsInput] = useState('');

  async function handleSubmit() {
    if (!title.trim()) { toast.error('Page title is required'); return; }
    const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean);
    try {
      const page = await createPage.mutateAsync({
        title: title.trim(),
        parentPageId,
        tags: tags.length > 0 ? tags : undefined,
      });
      toast.success(`"${page.title}" created`);
      onCreated?.(page.id);
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to create page';
      toast.error(msg);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
      <div className="card" style={{ width: 420, padding: 0 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 700, padding: '20px 20px 0' }}>
          {parentTitle ? `New Page under "${parentTitle}"` : 'New Wiki Page'}
        </div>
        <div style={{ padding: '16px 20px' }}>
          <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-mid)', display: 'block', marginBottom: 4 }}>
            Title
          </label>
          <input
            autoFocus
            className="input-field"
            placeholder="e.g. Deployment URLs, Architecture Overview"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
            style={{ marginBottom: 14 }}
          />
          <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-mid)', display: 'block', marginBottom: 4 }}>
            Tags (optional)
          </label>
          <input
            className="input-field"
            placeholder="e.g. deployment, staging"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
          />
          <p style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>Comma-separated. Helps filter the sidebar as the wiki grows.</p>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 20px', borderTop: '1px solid var(--border)' }}>
          <button className="tb-btn tb-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="tb-btn tb-btn-primary" onClick={handleSubmit} disabled={createPage.isPending}>
            {createPage.isPending ? 'Creating…' : 'Create Page'}
          </button>
        </div>
      </div>
    </div>
  );
}
