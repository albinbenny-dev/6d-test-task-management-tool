import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

export interface TcItem {
  id: string;
  projectId: string;
  srNo: string | null;
  module: string | null;
  feature: string | null;
  title: string;
  description: string | null;
  steps: string | null;
  expectedResult: string | null;
  labels: string; // JSON string — parse to string[]
  createdAt: string;
  updatedAt: string;
}

const ITEMS_KEY = (pid: string) => ['tc-items', pid];

export function useTcItems(projectId: string | undefined) {
  return useQuery({
    queryKey: ITEMS_KEY(projectId ?? ''),
    queryFn: async () => {
      const res = await api.get<{ items: TcItem[] }>(`/projects/${projectId}/tc-items`);
      return res.data.items;
    },
    enabled: !!projectId,
  });
}

export function useTcItem(projectId: string | undefined, id: string | undefined) {
  return useQuery({
    queryKey: ['tc-item', projectId, id],
    queryFn: async () => {
      const res = await api.get<{ item: TcItem }>(`/projects/${projectId}/tc-items/${id}`);
      return res.data.item;
    },
    enabled: !!projectId && !!id,
  });
}

export interface ImportResult {
  imported: number;
  updated: number;
  skippedEmpty: number;
  duplicateRows: string[];
  totalRows: number;
}

export function useImportTcItems(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      const res = await api.post<ImportResult>(`/projects/${projectId}/tc-items/import`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ITEMS_KEY(projectId ?? '') });
    },
  });
}

type TcItemPatch = Partial<Omit<TcItem, 'labels'>> & { labels?: string[] };

export function useUpdateTcItem(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: TcItemPatch }) => {
      const res = await api.patch<{ item: TcItem }>(`/projects/${projectId}/tc-items/${id}`, patch);
      return res.data.item;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ITEMS_KEY(projectId ?? '') });
      qc.invalidateQueries({ queryKey: ['tc-item', projectId, vars.id] });
    },
  });
}

export function useDeleteTcItem(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/projects/${projectId}/tc-items/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ITEMS_KEY(projectId ?? '') });
    },
  });
}

export function useBulkDeleteTcItems(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      await api.post(`/projects/${projectId}/tc-items/bulk-delete`, { ids });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ITEMS_KEY(projectId ?? '') });
    },
  });
}

export function useBulkMoveTcItems(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, feature }: { ids: string[]; feature: string }) => {
      await api.post(`/projects/${projectId}/tc-items/bulk-move-feature`, { ids, feature });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ITEMS_KEY(projectId ?? '') });
    },
  });
}

export function useBulkAddLabelToTcItems(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, label }: { ids: string[]; label: string }) => {
      const res = await api.post<{ updated: number }>(`/projects/${projectId}/tc-items/bulk-add-label`, { ids, label });
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ITEMS_KEY(projectId ?? '') });
    },
  });
}

/** Parses a TcItem's JSON-encoded labels column; returns [] on empty/corrupted rows. */
export function parseTcItemLabels(labels: string): string[] {
  try {
    const parsed = JSON.parse(labels);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Downloads TC Library as Excel. Pass `ids` to export only that subset — omit for everything. */
export async function exportTcItems(projectId: string, filenameSuffix: string, ids?: string[]): Promise<void> {
  const res = await api.post(`/projects/${projectId}/tc-items/export`, ids?.length ? { ids } : {}, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tc-library-${filenameSuffix}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
