import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useWikiPages, useDeleteWikiPage } from '../../hooks/useWiki';
import { useRBAC } from '../../hooks/useRBAC';
import { CreateWikiPageModal } from './CreateWikiPageModal';
import type { WikiPage } from '../../types';

function parseTags(tags: string): string[] {
  try { return JSON.parse(tags) as string[]; } catch { return []; }
}

// ── In-page navigation panel for the Wiki — every page, always visible while
// reading/editing one, so switching pages doesn't mean going back to an
// overview first. One level of nesting only: top-level pages, each with its
// child pages indented directly beneath — no recursive tree needed. ────────
export function WikiTreeSidebar({ projectId, slug, activePageId }: {
  projectId: string | undefined;
  slug: string;
  activePageId?: string;
}) {
  const navigate = useNavigate();
  const { canWrite, isAdmin, isSuperUser } = useRBAC();
  const canDelete = isAdmin || isSuperUser;
  const { data: pages = [], isLoading } = useWikiPages(projectId);
  const deletePage = useDeleteWikiPage(projectId ?? '');
  const [filter, setFilter] = useState('');
  const [createParent, setCreateParent] = useState<WikiPage | null | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState<WikiPage | null>(null);

  const q = filter.trim().toLowerCase();
  const matches = (p: WikiPage) => !q || p.title.toLowerCase().includes(q) || parseTags(p.tags).some((t) => t.toLowerCase().includes(q));

  const topLevel = pages.filter((p) => !p.parentPageId && matches(p));
  const childrenOf = (parentId: string) => pages.filter((p) => p.parentPageId === parentId && matches(p));

  async function handleDelete() {
    if (!confirmDelete) return;
    try {
      await deletePage.mutateAsync(confirmDelete.id);
      // Navigate away if the deleted page was active, or was the parent of
      // the active page (its children cascade away with it).
      const activePage = pages.find((p) => p.id === activePageId);
      if (confirmDelete.id === activePageId || confirmDelete.id === activePage?.parentPageId) {
        navigate(`/projects/${slug}/wiki`);
      }
    } finally {
      setConfirmDelete(null);
    }
  }

  function renderRow(page: WikiPage, indent: boolean) {
    const active = page.id === activePageId;
    const count = page._count?.childPages ?? 0;
    return (
      <div key={page.id} style={{ position: 'relative' }}>
        <Link
          to={`/projects/${slug}/wiki/${page.id}`}
          className={`nav-item${active ? ' active' : ''}`}
          style={{ paddingLeft: indent ? 28 : undefined }}
        >
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{page.title}</span>
          {!indent && count > 0 && <span className="nav-badge blue">{count}</span>}
          {!indent && canWrite && (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setCreateParent(page); }}
              title="Add child page"
              style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 12, padding: '0 0 0 4px' }}
            >
              +
            </button>
          )}
          {canDelete && (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmDelete(page); }}
              title="Delete page"
              style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 11, padding: '0 0 0 4px' }}
            >
              🗑
            </button>
          )}
        </Link>
      </div>
    );
  }

  return (
    <>
      <aside style={{ width: 216, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 14px 10px' }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--text-dim)' }}>Wiki</span>
          {canWrite && (
            <button
              onClick={() => setCreateParent(null)}
              title="New page"
              style={{ width: 20, height: 20, borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}
            >
              +
            </button>
          )}
        </div>

        <div style={{ padding: '0 14px 10px' }}>
          <input
            className="input-field"
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ fontSize: 12, padding: '5px 8px' }}
          />
        </div>

        <nav style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 8px 8px' }}>
          {isLoading && (
            <div style={{ padding: '8px 6px', color: 'var(--text-dim)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>Loading…</div>
          )}
          {!isLoading && topLevel.length === 0 && (
            <div style={{ padding: '8px 6px', color: 'var(--text-dim)', fontSize: 11 }}>
              {q ? 'No pages match.' : 'No pages yet.'}
            </div>
          )}
          {topLevel.map((page) => (
            <div key={page.id}>
              {renderRow(page, false)}
              {childrenOf(page.id).map((child) => renderRow(child, true))}
            </div>
          ))}
        </nav>
      </aside>

      {createParent !== undefined && projectId && (
        <CreateWikiPageModal
          projectId={projectId}
          parentPageId={createParent?.id}
          parentTitle={createParent?.title}
          onClose={() => setCreateParent(undefined)}
          onCreated={(pageId) => { setCreateParent(undefined); navigate(`/projects/${slug}/wiki/${pageId}`); }}
        />
      )}

      {confirmDelete && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setConfirmDelete(null)}
        >
          <div className="card" style={{ width: 380, padding: 20 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Delete "{confirmDelete.title}"?</div>
            <p style={{ fontSize: 12, color: 'var(--text-mid)', marginBottom: 16 }}>
              {(confirmDelete._count?.childPages ?? 0) > 0
                ? `This will permanently delete this page and its ${confirmDelete._count?.childPages} child page(s). This cannot be undone.`
                : 'This cannot be undone.'}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="tb-btn tb-btn-ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="tb-btn" style={{ color: 'var(--fail)', borderColor: 'rgba(220,38,38,0.3)' }} onClick={() => void handleDelete()}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
