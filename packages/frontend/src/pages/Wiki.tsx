import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Topbar, { TbBtn } from '../components/layout/Topbar';
import { useProject } from '../hooks/useProjects';
import { useWikiPage } from '../hooks/useWiki';
import { useRBAC } from '../hooks/useRBAC';
import { WikiTreeSidebar } from '../components/wiki/WikiTreeSidebar';
import { WikiPageView } from '../components/wiki/WikiPageView';
import { WikiPageEditor } from '../components/wiki/WikiPageEditor';
import { CreateWikiPageModal } from '../components/wiki/CreateWikiPageModal';

export default function Wiki() {
  const { slug, pageId } = useParams<{ slug: string; pageId?: string }>();
  const navigate = useNavigate();
  const { data: project } = useProject(slug);
  const projectId = project?.id;
  const { canWrite } = useRBAC();

  const { data: page, isLoading } = useWikiPage(projectId, pageId);
  const [isEditing, setIsEditing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  // Switching pages should always land back on the read view.
  useEffect(() => { setIsEditing(false); }, [pageId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Topbar
        breadcrumbs={[
          { label: project?.name ?? slug ?? 'Project', href: `/projects/${slug}/test-cycles` },
          { label: 'Wiki' },
        ]}
        actions={(
          <>
            {canWrite && page && !isEditing && (
              <TbBtn variant="ghost" onClick={() => setIsEditing(true)}>✎ Edit</TbBtn>
            )}
            {canWrite && (
              <TbBtn variant="primary" onClick={() => setShowCreate(true)}>+ New Page</TbBtn>
            )}
          </>
        )}
      />

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <WikiTreeSidebar projectId={projectId} slug={slug ?? ''} activePageId={pageId} />

        <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: isEditing ? 'hidden' : 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column' }}>
          {!pageId ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: 13 }}>
              Pick a page from the sidebar, or create a new one.
            </div>
          ) : isLoading ? (
            <div style={{ color: 'var(--text-dim)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>Loading…</div>
          ) : !page ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: 13 }}>
              Page not found.
            </div>
          ) : isEditing ? (
            <WikiPageEditor
              projectId={projectId ?? ''}
              page={page}
              onDone={() => setIsEditing(false)}
              onCancel={() => setIsEditing(false)}
            />
          ) : (
            <WikiPageView page={page} />
          )}
        </div>
      </div>

      {showCreate && projectId && (
        <CreateWikiPageModal
          projectId={projectId}
          onClose={() => setShowCreate(false)}
          onCreated={(newPageId) => { setShowCreate(false); navigate(`/projects/${slug}/wiki/${newPageId}`); }}
        />
      )}
    </div>
  );
}
