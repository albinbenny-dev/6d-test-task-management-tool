import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Milestone } from '../types';

function invalidateAll(qc: ReturnType<typeof useQueryClient>, projectId: string) {
  void qc.invalidateQueries({ queryKey: ['milestones', projectId] });
}

export function useMilestones(projectId: string | undefined) {
  return useQuery({
    queryKey: ['milestones', projectId],
    queryFn: async () => {
      const res = await api.get<{ milestones: Milestone[] }>(`/projects/${projectId}/milestones`);
      return res.data.milestones ?? [];
    },
    enabled: !!projectId,
  });
}

export interface MilestoneInput {
  name: string;
  groupName?: string | null;
  baselineDate?: string | null;
  targetDate?: string | null;
  actualDate?: string | null;
  isPaymentLinked?: boolean;
  invoiceRaised?: boolean;
  notes?: string | null;
}

export function useCreateMilestone(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: MilestoneInput) => {
      const res = await api.post<{ milestone: Milestone }>(`/projects/${projectId}/milestones`, data);
      return res.data.milestone;
    },
    onSuccess: () => invalidateAll(qc, projectId),
  });
}

export function useUpdateMilestone(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<MilestoneInput> & { id: string; isCompleted?: boolean }) => {
      const { id, ...body } = data;
      const res = await api.put<{ milestone: Milestone }>(`/projects/${projectId}/milestones/${id}`, body);
      return res.data.milestone;
    },
    onSuccess: () => invalidateAll(qc, projectId),
  });
}

export function useReorderMilestones(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderedIds: string[]) => {
      await api.patch(`/projects/${projectId}/milestones/reorder`, { orderedIds });
    },
    onSuccess: () => invalidateAll(qc, projectId),
  });
}

export function useDeleteMilestone(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (milestoneId: string) => {
      await api.delete(`/projects/${projectId}/milestones/${milestoneId}`);
    },
    onSuccess: () => invalidateAll(qc, projectId),
  });
}
