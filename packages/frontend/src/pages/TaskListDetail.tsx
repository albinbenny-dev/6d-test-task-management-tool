import { useEffect, useMemo, useState } from 'react';
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
import { ImportTasksModal } from '../components/tasks/ImportTasksModal';
import { formatDueDate } from '../lib/taskMeta';
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
  const [showImport, setShowImport] = useState(false);
  const [searchParams] = useSearchParams();

  // Timeline roadmap header — min start / max due across top-level tasks
  // (same denominator as the "N task(s)" subtitle below), plus a completion
  // bar from DONE count. Split into two independently-gated pieces: the bar
  // needs no dates at all, the date-range line needs at least one task with
  // a startDate or dueDate. Both hidden only when the list has zero tasks.
  const topLevelTasks = useMemo(() => tasks.filter((t) => !t.parentTaskId), [tasks]);
  const timeline = useMemo(() => {
    if (topLevelTasks.length === 0) return null;
    const starts = topLevelTasks.map((t) => t.startDate).filter((d): d is string => !!d);
    const dues = topLevelTasks.map((t) => t.dueDate).filter((d): d is string => !!d);
    const minStart = starts.length ? starts.reduce((a, b) => (a < b ? a : b)) : null;
    const maxDue = dues.length ? dues.reduce((a, b) => (a > b ? a : b)) : null;
    const doneCount = topLevelTasks.filter((t) => t.status === 'DONE').length;
    const completionPct = Math.round((doneCount / topLevelTasks.length) * 100);
    const isAtRisk = !!maxDue && new Date(maxDue).getTime() < Date.now() && completionPct < 100;
    return { minStart, maxDue, doneCount, total: topLevelTasks.length, completionPct, isAtRisk };
  }, [topLevelTasks]);

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
              <TbBtn variant="ghost" onClick={() => setShowImport(true)}>📥 Import</TbBtn>
            )}
            {canWrite && (
              <TbBtn variant="primary" onClick={() => setCreateFor('quick')}>+ Add Task</TbBtn>
            )}
          </>
        )}
      />

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <TaskListsSidebar projectId={projectId} slug={slug ?? ''} activeListId={listId} />

        <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: view === 'board' ? 'hidden' : 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {list && <span style={{ width: 10, height: 10, borderRadius: '50%', background: list.color }} />}
              <h1 className="page-title" style={{ fontSize: 20 }}>{list?.name ?? 'Loading…'}</h1>
            </div>
            <p className="page-sub">{tasks.filter((t) => !t.parentTaskId).length} task(s)</p>

            {timeline && (
              <div style={{ marginTop: 10, maxWidth: 420 }}>
                {(timeline.minStart || timeline.maxDue) && (
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginBottom: 6, display: 'flex', gap: 6 }}>
                    {timeline.minStart && <span>Start {formatDueDate(timeline.minStart)}</span>}
                    {timeline.minStart && timeline.maxDue && <span>→</span>}
                    {timeline.maxDue && (
                      <span style={{ color: timeline.isAtRisk ? 'var(--fail)' : 'var(--text-dim)' }}>Due {formatDueDate(timeline.maxDue)}</span>
                    )}
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {/* Single-fill simplification of TestCycleDetail.tsx's FeatureGroup
                      segmented track — one dimension (done vs not) instead of five
                      statuses, so a single fill div is enough. */}
                  <div style={{ flex: 1, height: 8, background: 'var(--surface2)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${timeline.completionPct}%`, background: 'var(--pass)', borderRadius: 4, transition: 'width .3s' }} />
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                    {timeline.doneCount}/{timeline.total} · {timeline.completionPct}%
                  </span>
                </div>
              </div>
            )}
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

      {showImport && projectId && listId && (
        <ImportTasksModal
          projectId={projectId}
          taskListId={listId}
          onClose={() => setShowImport(false)}
        />
      )}
    </div>
  );
}
