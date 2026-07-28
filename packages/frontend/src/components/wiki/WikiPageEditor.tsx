import { useState } from 'react';
import toast from 'react-hot-toast';
import { WikiMarkdown } from './WikiMarkdown';
import { useUpdateWikiPage } from '../../hooks/useWiki';
import type { WikiPage } from '../../types';

function parseTags(tags: string): string[] {
  try { return JSON.parse(tags) as string[]; } catch { return []; }
}

// Explicit-save split-pane editor — raw markdown on the left, live preview
// on the right — rather than autosave or a WYSIWYG toolbar, matching this
// codebase's general explicit-submit pattern (e.g. CreateTaskListModal).
export function WikiPageEditor({ projectId, page, onDone, onCancel }: {
  projectId: string;
  page: WikiPage;
  onDone: () => void;
  onCancel: () => void;
}) {
  const updatePage = useUpdateWikiPage(projectId);
  const [title, setTitle] = useState(page.title);
  const [content, setContent] = useState(page.content);
  const [tagsInput, setTagsInput] = useState(parseTags(page.tags).join(', '));

  async function handleSave() {
    if (!title.trim()) { toast.error('Page title is required'); return; }
    const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean);
    try {
      await updatePage.mutateAsync({ id: page.id, title: title.trim(), content, tags });
      toast.success('Page saved');
      onDone();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to save page';
      toast.error(msg);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12 }}>
      <input
        className="input-field"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Page title"
        style={{ fontSize: 18, fontWeight: 700 }}
      />
      <input
        className="input-field"
        value={tagsInput}
        onChange={(e) => setTagsInput(e.target.value)}
        placeholder="Tags (comma-separated)"
        style={{ fontSize: 12 }}
      />

      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 12 }}>
        <textarea
          className="input-field"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Write markdown here — links, tables, lists, code blocks all work…"
          style={{ flex: 1, minHeight: 0, resize: 'none', fontFamily: 'var(--font-mono)', fontSize: 12.5 }}
        />
        <div className="card" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16 }}>
          <WikiMarkdown content={content} />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button className="tb-btn tb-btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="tb-btn tb-btn-primary" onClick={handleSave} disabled={updatePage.isPending}>
          {updatePage.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
