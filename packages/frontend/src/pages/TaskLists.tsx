import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Topbar, { TbBtn } from '../components/layout/Topbar';
import { useProject } from '../hooks/useProjects';
import { useTaskLists } from '../hooks/useTaskLists';
import { useRBAC } from '../hooks/useRBAC';
import { CreateTaskListModal } from '../components/tasks/CreateTaskListModal';
import { TaskListsSidebar } from '../components/tasks/TaskListsSidebar';

export default function TaskLists() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { data: project } = useProject(slug);
  const projectId = project?.id;
  const { canWrite } = useRBAC();

  const { data: lists = [], isLoading } = useTaskLists(projectId);
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Topbar
        breadcrumbs={[
          { label: project?.name ?? slug ?? 'Project', href: `/projects/${slug}/test-cycles` },
          { label: 'Task Management' },
        ]}
        actions={(
          <>
            <TbBtn variant="ghost" onClick={() => navigate(`/projects/${slug}/tasks/dashboard`)}>📊 Dashboard</TbBtn>
            <TbBtn variant="ghost" onClick={() => navigate(`/projects/${slug}/my-work?tab=tasks`)}>🗂 My Tasks</TbBtn>
          </>
        )}
      />

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <TaskListsSidebar projectId={projectId} slug={slug ?? ''} />

        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          {isLoading ? (
            <div style={{ color: 'var(--text-dim)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>Loading…</div>
          ) : lists.length === 0 ? (
            <div style={{ textAlign: 'center', maxWidth: 360 }}>
              <div className="page-eyebrow">Task Management</div>
              <h1 className="page-title" style={{ fontSize: 20 }}>No task lists yet</h1>
              <p className="page-sub">Create a list to start organizing project work and assigning tasks to your team.</p>
              {canWrite && (
                <TbBtn variant="primary" onClick={() => setShowCreate(true)} style={{ marginTop: 12 }}>+ New List</TbBtn>
              )}
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: '13px' }}>
              Pick a list from the sidebar to view its board.
            </div>
          )}
        </div>
      </div>

      {showCreate && projectId && (
        <CreateTaskListModal
          projectId={projectId}
          onClose={() => setShowCreate(false)}
          onCreated={(listId) => navigate(`/projects/${slug}/tasks/${listId}`)}
        />
      )}
    </div>
  );
}
