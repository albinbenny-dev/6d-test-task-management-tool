import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { TaskPriority } from '../types';

export interface PersonalTask {
  id: string;
  userId: string;
  title: string;
  notes: string | null;
  done: boolean;
  priority: TaskPriority;
  dueDate: string | null;
  sortOrder: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const KEY = (userId?: string) => ['personal-tasks', userId ?? 'self'];

export function usePersonalTasks(userId?: string) {
  return useQuery({
    queryKey: KEY(userId),
    queryFn: async () => {
      const res = await api.get<{ userId: string; tasks: PersonalTask[] }>('/personal-tasks', {
        params: userId ? { userId } : undefined,
      });
      return res.data;
    },
  });
}

export function useCreatePersonalTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { title: string; notes?: string; priority?: TaskPriority; dueDate?: string | null }) => {
      const res = await api.post<{ task: PersonalTask }>('/personal-tasks', data);
      return res.data.task;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY() }),
  });
}

export function useUpdatePersonalTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { id: string; title?: string; notes?: string | null; priority?: TaskPriority; dueDate?: string | null; done?: boolean }) => {
      const { id, ...body } = data;
      const res = await api.patch<{ task: PersonalTask }>(`/personal-tasks/${id}`, body);
      return res.data.task;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY() }),
  });
}

export function useDeletePersonalTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/personal-tasks/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY() }),
  });
}
