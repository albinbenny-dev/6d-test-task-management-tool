import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { MilestoneList } from '../types';

export function useMilestoneLists(projectId: string | undefined) {
  return useQuery({
    queryKey: ['milestone-lists', projectId],
    queryFn: async () => {
      const res = await api.get<{ lists: MilestoneList[] }>(`/projects/${projectId}/milestone-lists`);
      return res.data.lists ?? [];
    },
    enabled: !!projectId,
  });
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>, projectId: string) {
  void qc.invalidateQueries({ queryKey: ['milestone-lists', projectId] });
  void qc.invalidateQueries({ queryKey: ['milestones', projectId] });
}

export function useCreateMilestoneList(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { name: string; color?: string }) => {
      const res = await api.post<{ list: MilestoneList }>(`/projects/${projectId}/milestone-lists`, data);
      return res.data.list;
    },
    onSuccess: () => invalidateAll(qc, projectId),
  });
}

export function useUpdateMilestoneList(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { id: string; name?: string; color?: string }) => {
      const { id, ...body } = data;
      const res = await api.put<{ list: MilestoneList }>(`/projects/${projectId}/milestone-lists/${id}`, body);
      return res.data.list;
    },
    onSuccess: () => invalidateAll(qc, projectId),
  });
}

export function useReorderMilestoneLists(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderedIds: string[]) => {
      await api.patch(`/projects/${projectId}/milestone-lists/reorder`, { orderedIds });
    },
    onSuccess: () => invalidateAll(qc, projectId),
  });
}

export function useDeleteMilestoneList(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (listId: string) => {
      await api.delete(`/projects/${projectId}/milestone-lists/${listId}`);
    },
    onSuccess: () => invalidateAll(qc, projectId),
  });
}
