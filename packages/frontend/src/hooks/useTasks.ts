import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Task, TaskStatus, TaskPriority, TaskDashboardSummary, TaskCommentEntry } from '../types';

// Invalidate every query keyed off tasks for this project — used after any
// mutation that can shift counts/summaries shown elsewhere (dashboard, list
// badges, My Tasks) so those views never go stale after a board/table edit.
function invalidateAll(qc: ReturnType<typeof useQueryClient>, projectId: string) {
  void qc.invalidateQueries({ queryKey: ['tasks', projectId] });
  void qc.invalidateQueries({ queryKey: ['task', projectId] });
  void qc.invalidateQueries({ queryKey: ['my-tasks', projectId] });
  void qc.invalidateQueries({ queryKey: ['tasks-dashboard', projectId] });
  void qc.invalidateQueries({ queryKey: ['task-lists', projectId] });
}

export function useTasks(
  projectId: string | undefined,
  filters?: { taskListId?: string; status?: TaskStatus; assigneeId?: string },
) {
  return useQuery({
    queryKey: ['tasks', projectId, filters ?? {}],
    queryFn: async () => {
      const res = await api.get<{ tasks: Task[] }>(`/projects/${projectId}/tasks`, { params: filters });
      return res.data.tasks ?? [];
    },
    enabled: !!projectId,
  });
}

export function useTask(projectId: string | undefined, taskId: string | undefined) {
  return useQuery({
    queryKey: ['task', projectId, taskId],
    queryFn: async () => {
      const res = await api.get<{ task: Task }>(`/projects/${projectId}/tasks/${taskId}`);
      return res.data.task;
    },
    enabled: !!projectId && !!taskId,
  });
}

export function useMyTasks(projectId: string | undefined, userId?: string) {
  return useQuery({
    queryKey: ['my-tasks', projectId, userId ?? 'self'],
    queryFn: async () => {
      const res = await api.get<{ userId: string; tasks: Task[] }>(`/projects/${projectId}/tasks/my`, {
        params: userId ? { userId } : undefined,
      });
      return res.data;
    },
    enabled: !!projectId,
  });
}

export function useTaskDashboard(projectId: string | undefined) {
  return useQuery({
    queryKey: ['tasks-dashboard', projectId],
    queryFn: async () => {
      const res = await api.get<TaskDashboardSummary>(`/projects/${projectId}/tasks/dashboard/summary`);
      return res.data;
    },
    enabled: !!projectId,
  });
}

export function useCreateTask(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      taskListId: string;
      parentTaskId?: string;
      title: string;
      description?: string;
      priority?: TaskPriority;
      assigneeUserId?: string;
      startDate?: string | null;
      dueDate?: string | null;
      tags?: string[];
    }) => {
      const res = await api.post<{ task: Task }>(`/projects/${projectId}/tasks`, data);
      return res.data.task;
    },
    onSuccess: () => invalidateAll(qc, projectId),
  });
}

export function useUpdateTask(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      id: string;
      title?: string;
      description?: string | null;
      priority?: TaskPriority;
      startDate?: string | null;
      dueDate?: string | null;
      tags?: string[];
      taskListId?: string;
    }) => {
      const { id, ...body } = data;
      const res = await api.put<{ task: Task }>(`/projects/${projectId}/tasks/${id}`, body);
      return res.data.task;
    },
    onSuccess: () => invalidateAll(qc, projectId),
  });
}

export function useUpdateTaskStatus(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { id: string; status: TaskStatus }) => {
      const res = await api.patch<{ task: Task }>(`/projects/${projectId}/tasks/${data.id}/status`, { status: data.status });
      return res.data.task;
    },
    onSuccess: () => invalidateAll(qc, projectId),
  });
}

export function useAssignTask(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { id: string; assigneeUserId: string | null }) => {
      const res = await api.patch<{ task: Task }>(`/projects/${projectId}/tasks/${data.id}/assign`, {
        assigneeUserId: data.assigneeUserId,
      });
      return res.data.task;
    },
    onSuccess: () => invalidateAll(qc, projectId),
  });
}

export function useReorderTasks(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { taskListId: string; orderedIds: string[] }) => {
      await api.patch(`/projects/${projectId}/tasks/reorder`, data);
    },
    onSuccess: () => invalidateAll(qc, projectId),
  });
}

export function useDeleteTask(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (taskId: string) => {
      await api.delete(`/projects/${projectId}/tasks/${taskId}`);
    },
    onSuccess: () => invalidateAll(qc, projectId),
  });
}

export function useAddTaskComment(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { taskId: string; body: string }) => {
      const res = await api.post<{ comment: TaskCommentEntry }>(`/projects/${projectId}/tasks/${data.taskId}/comments`, {
        body: data.body,
      });
      return res.data.comment;
    },
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: ['task', projectId, vars.taskId] }),
  });
}

export function useDeleteTaskComment(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { taskId: string; commentId: string }) => {
      await api.delete(`/projects/${projectId}/tasks/${data.taskId}/comments/${data.commentId}`);
    },
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: ['task', projectId, vars.taskId] }),
  });
}
