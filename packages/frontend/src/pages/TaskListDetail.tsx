import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import Topbar, { TbBtn } from '../components/layout/Topbar';
import { useProject } from '../hooks/useProjects';
import { useTaskLists } from '../hooks/useTaskLists';
import { useTasks, useUpdateTaskStatus, useAssignTask } from '../hooks/useTasks';
import { useRBAC } from '../hooks/useRBAC';
import { KanbanBoard } from '../components/tasks/KanbanBoard';
import { TaskListView } from '../components/tasks/TaskListView';
import { TaskDetailPanel } from '../components/tasks/TaskDetailPanel';
import { CreateTaskModal } from '../components/tasks/CreateTaskModal';
import { TaskListsSidebar } from '../components/tasks/TaskListsSidebar';
import type { Task, TaskStatus } from '../types';

type ViewMode = 'list' | 'board';

export default function TaskListDetail() {
  const { slug, listId } = useParams<{ slug: string; listId: string }>();
  const { data: project } = useProject(slug);
  const projectId = project?.id;
  const { canWrite } = useRBAC();

  const { data: lists = [] } = useTaskLists(projectId);
  const list = lists.find((l) => l.id === listId);

  const { data: tasks = [], isLoading } = useTasks(projectId, { taskListId: listId });
  const updateStatus = useUpdateTaskStatus(projectId ?? '');
  const assignTask = useAssignTask(projectId ?? '');

  const [view, setView] = useState<ViewMode>('board');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [createFor, setCreateFor] = useState<TaskStatus | 'quick' | null>(null);
  const [searchParams] = useSearchParams();

  // Deep link from My Work / My Tasks — jumping to a task list can also open
  // one specific task's detail panel directly (?open=<taskId>).
  useEffect(() => {
    const open = searchParams.get('open');
    if (open) setSelectedTaskId(open);
  }, [searchParams]);

  function handleOpenTask(task: Task) {
    setSelectedTaskId(task.id);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Topbar
        breadcrumbs={[
          { label: project?.name ?? slug ?? 'Project', href: `/projects/${slug}/test-cycles` },
          { label: 'Task Management', href: `/projects/${slug}/tasks` },
          { label: list?.name ?? 'List' },
        ]}
        actions={(
          <>
            <div className="tm-view-tabs">
              <button className={`tm-view-tab${view === 'list' ? ' active' : ''}`} onClick={() => setView('list')}>☰ List</button>
              <button className={`tm-view-tab${view === 'board' ? ' active' : ''}`} onClick={() => setView('board')}>▦ Board</button>
            </div>
            {canWrite && (
              <TbBtn variant="primary" onClick={() => setCreateFor('quick')}>+ Add Task</TbBtn>
            )}
          </>
        )}
      />

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <TaskListsSidebar projectId={projectId} slug={slug ?? ''} activeListId={listId} />

        <div style={{ flex: 1, minWidth: 0, overflow: view === 'board' ? 'hidden' : 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {list && <span style={{ width: 10, height: 10, borderRadius: '50%', background: list.color }} />}
              <h1 className="page-title" style={{ fontSize: 20 }}>{list?.name ?? 'Loading…'}</h1>
            </div>
            <p className="page-sub">{tasks.filter((t) => !t.parentTaskId).length} task(s)</p>
          </div>

          {isLoading ? (
            <div style={{ color: 'var(--text-dim)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>Loading tasks…</div>
          ) : view === 'board' ? (
            <div style={{ flex: 1, minHeight: 0 }}>
              <KanbanBoard
                tasks={tasks}
                onOpenTask={handleOpenTask}
                onMoveTask={(taskId, status) => updateStatus.mutate({ id: taskId, status })}
                onQuickAdd={(status) => setCreateFor(status)}
              />
            </div>
          ) : (
            <TaskListView
              tasks={tasks}
              projectId={projectId ?? ''}
              onOpenTask={handleOpenTask}
              onStatusChange={(id, status) => updateStatus.mutate({ id, status })}
              onAssigneeChange={(id, userId) => assignTask.mutate({ id, assigneeUserId: userId })}
              onQuickAdd={() => setCreateFor('quick')}
              canWrite={canWrite}
            />
          )}
        </div>
      </div>

      {selectedTaskId && projectId && (
        <TaskDetailPanel
          projectId={projectId}
          taskId={selectedTaskId}
          onClose={() => setSelectedTaskId(null)}
          onNavigateToTask={(id) => setSelectedTaskId(id)}
        />
      )}

      {createFor && projectId && listId && (
        <CreateTaskModal
          projectId={projectId}
          taskListId={listId}
          defaultStatus={createFor === 'quick' ? undefined : createFor}
          onClose={() => setCreateFor(null)}
        />
      )}
    </div>
  );
}
