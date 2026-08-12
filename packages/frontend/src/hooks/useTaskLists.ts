import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { TaskList } from '../types';

export function useTaskLists(projectId: string | undefined) {
  return useQuery({
    queryKey: ['task-lists', projectId],
    queryFn: async () => {
      const res = await api.get<{ lists: TaskList[] }>(`/projects/${projectId}/task-lists`);
      return res.data.lists ?? [];
    },
    enabled: !!projectId,
  });
}

export function useCreateTaskList(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { name: string; color?: string }) => {
      const res = await api.post<{ list: TaskList }>(`/projects/${projectId}/task-lists`, data);
      return res.data.list;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task-lists', projectId] }),
  });
}

export function useUpdateTaskList(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { id: string; name?: string; color?: string }) => {
      const { id, ...body } = data;
      const res = await api.put<{ list: TaskList }>(`/projects/${projectId}/task-lists/${id}`, body);
      return res.data.list;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task-lists', projectId] }),
  });
}

export function useReorderTaskLists(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderedIds: string[]) => {
      await api.patch(`/projects/${projectId}/task-lists/reorder`, { orderedIds });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task-lists', projectId] }),
  });
}

export function useDeleteTaskList(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (listId: string) => {
      await api.delete(`/projects/${projectId}/task-lists/${listId}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task-lists', projectId] }),
  });
}

/** Clones a list and every task inside it (literal snapshot — same statuses/assignees/dates/tags, not reset). */
export function useDuplicateTaskList(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (listId: string) => {
      const res = await api.post<{ list: TaskList; tasksCopied: number }>(`/projects/${projectId}/task-lists/${listId}/duplicate`);
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task-lists', projectId] });
      qc.invalidateQueries({ queryKey: ['tasks', projectId] });
    },
  });
}
