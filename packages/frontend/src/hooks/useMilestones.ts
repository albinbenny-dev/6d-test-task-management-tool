import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Milestone } from '../types';

function invalidateAll(qc: ReturnType<typeof useQueryClient>, projectId: string) {
  void qc.invalidateQueries({ queryKey: ['milestones', projectId] });
  void qc.invalidateQueries({ queryKey: ['milestone-lists', projectId] }); // row counts per list
}

// Omitting milestoneListId fetches every milestone in the project (used by
// dashboards/portfolio to aggregate across every list); passing it scopes to
// one list (used by the Milestones page's active tab).
export function useMilestones(projectId: string | undefined, milestoneListId?: string) {
  return useQuery({
    queryKey: ['milestones', projectId, milestoneListId ?? 'all'],
    queryFn: async () => {
      const res = await api.get<{ milestones: Milestone[] }>(`/projects/${projectId}/milestones`, {
        params: milestoneListId ? { milestoneListId } : undefined,
      });
      return res.data.milestones ?? [];
    },
    enabled: !!projectId,
  });
}

export interface MilestoneInput {
  milestoneListId?: string;
  name: string;
  baselineDate?: string | null;
  targetDate?: string | null;
  actualDate?: string | null;
  evidenceDate?: string | null;
  isPaymentLinked?: boolean;
  invoiceRaised?: boolean;
  notes?: string | null;
}

export function useCreateMilestone(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: MilestoneInput & { milestoneListId: string }) => {
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
    mutationFn: async (data: { milestoneListId: string; orderedIds: string[] }) => {
      await api.patch(`/projects/${projectId}/milestones/reorder`, data);
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

// ── CRM import (POST /milestones/import) ────────────────────────────────────
// Same file is sent twice: commit=false previews, commit=true applies.

export interface MilestoneImportPo {
  /** Selection key — the PO number, or the PO name when the number is blank. */
  key: string;
  poNumber: string;
  poName: string;
  rows: number;
  created: number;
  updated: number;
  unchanged: number;
  notInvoiced: number;
  missingEvidence: number;
  newList: boolean;
}

export interface MilestoneImportResult {
  committed: boolean;
  created: number;
  updated: number;
  unchanged: number;
  pos: MilestoneImportPo[];
  evidenceShifts: Array<{ poKey: string; poName: string; milestone: string; from: string | null; to: string | null }>;
  missingEvidence: number;
  projectManagers: Array<{ name: string; count: number }>;
  skippedOtherPm: number;
  skippedEmpty: number;
  warnings: string[];
}

export function useImportMilestones(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, projectManager, commit, poKeys }: { file: File; projectManager: string; commit: boolean; poKeys?: string[] }) => {
      const form = new FormData();
      form.append('file', file);
      form.append('projectManager', projectManager);
      form.append('commit', String(commit));
      if (poKeys) form.append('poKeys', JSON.stringify(poKeys)); // omitted on preview → the server lists every PO
      const res = await api.post<MilestoneImportResult>(`/projects/${projectId}/milestones/import`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
      return res.data;
    },
    onSuccess: (data) => { if (data.committed) invalidateAll(qc, projectId); },
  });
}
