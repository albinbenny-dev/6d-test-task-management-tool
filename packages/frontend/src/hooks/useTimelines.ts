import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type {
  StyleOverrides, TemplateConfig, TimelineDetail, TimelineSummary, TimelineTemplateDTO, TLItem, TLLane,
} from '../lib/timeline/types';

// ── Timelines (per project) ────────────────────────────────────────────────

export function useTimelines(projectId: string | undefined) {
  return useQuery({
    queryKey: ['timelines', projectId],
    queryFn: async () => (await api.get<{ timelines: TimelineSummary[] }>(`/projects/${projectId}/timelines`)).data.timelines ?? [],
    enabled: !!projectId,
  });
}

export function useTimeline(projectId: string | undefined, timelineId: string | undefined) {
  return useQuery({
    queryKey: ['timeline', projectId, timelineId],
    queryFn: async () => (await api.get<TimelineDetail>(`/projects/${projectId}/timelines/${timelineId}`)).data,
    enabled: !!projectId && !!timelineId,
  });
}

export function useCreateTimeline(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { name: string; description?: string | null; templateId?: string | null }) =>
      (await api.post<{ timeline: { id: string; name: string } }>(`/projects/${projectId}/timelines`, data)).data.timeline,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['timelines', projectId] }); },
  });
}

export function useDeleteTimeline(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { await api.delete(`/projects/${projectId}/timelines/${id}`); },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['timelines', projectId] }); },
  });
}

export function useDuplicateTimeline(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.post<{ timeline: { id: string; name: string } }>(`/projects/${projectId}/timelines/${id}/duplicate`)).data.timeline,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['timelines', projectId] }); },
  });
}

// ── Everything below edits ONE timeline. Mutations patch the cached detail
// optimistically where cheap (so typing in the grid and the live preview feel
// instant) and refetch on settle, which also picks up server-derived fields
// like durationDays. ───────────────────────────────────────────────────────

export interface ItemInput {
  title?: string;
  type?: 'TASK' | 'MILESTONE';
  marker?: string;
  color?: string | null;
  swimlaneId?: string | null;
  startDate?: string;
  endDate?: string;
  durationDays?: number;
  percentComplete?: number;
  assignee?: string | null;
  notes?: string | null;
}

export function useTimelineEditor(projectId: string, timelineId: string) {
  const qc = useQueryClient();
  const key = ['timeline', projectId, timelineId];
  const base = `/projects/${projectId}/timelines/${timelineId}`;
  const refresh = () => { void qc.invalidateQueries({ queryKey: key }); void qc.invalidateQueries({ queryKey: ['timelines', projectId] }); };
  const patchCache = (fn: (d: TimelineDetail) => TimelineDetail) => qc.setQueryData<TimelineDetail>(key, (d) => (d ? fn(d) : d));

  const updateTimeline = useMutation({
    mutationFn: async (data: { name?: string; description?: string | null; templateId?: string | null; styleOverrides?: StyleOverrides }) => {
      await api.put(base, data);
    },
    onMutate: (data) => {
      patchCache((d) => ({
        ...d,
        timeline: { ...d.timeline, ...(data.name !== undefined ? { name: data.name } : {}), ...(data.styleOverrides !== undefined ? { styleOverrides: data.styleOverrides } : {}), ...(data.templateId !== undefined ? { templateId: data.templateId } : {}) },
      }));
    },
    onSettled: refresh,
  });

  const createItem = useMutation({
    mutationFn: async (data: ItemInput & { title: string; type: 'TASK' | 'MILESTONE'; startDate: string }) =>
      (await api.post<{ item: TLItem }>(`${base}/items`, data)).data.item,
    onSettled: refresh,
  });

  const updateItem = useMutation({
    mutationFn: async ({ id, ...data }: ItemInput & { id: string }) => (await api.put<{ item: TLItem }>(`${base}/items/${id}`, data)).data.item,
    onSuccess: (item) => patchCache((d) => ({ ...d, items: d.items.map((i) => (i.id === item.id ? item : i)) })),
    onSettled: refresh,
  });

  const deleteItems = useMutation({
    mutationFn: async (ids: string[]) => { await api.post(`${base}/items/bulk-delete`, { ids }); },
    onMutate: (ids) => patchCache((d) => ({ ...d, items: d.items.filter((i) => !ids.includes(i.id)) })),
    onSettled: refresh,
  });

  const reorderItems = useMutation({
    mutationFn: async (moves: { id: string; swimlaneId: string | null; sortOrder: number }[]) => { await api.patch(`${base}/items/reorder`, { moves }); },
    onMutate: (moves) => patchCache((d) => ({
      ...d,
      items: d.items.map((i) => { const m = moves.find((x) => x.id === i.id); return m ? { ...i, swimlaneId: m.swimlaneId, sortOrder: m.sortOrder } : i; }),
    })),
    onSettled: refresh,
  });

  const createLane = useMutation({
    mutationFn: async (data: { name: string; color?: string | null }) => (await api.post<{ swimlane: TLLane }>(`${base}/swimlanes`, data)).data.swimlane,
    onSettled: refresh,
  });

  const updateLane = useMutation({
    mutationFn: async ({ id, ...data }: { id: string; name?: string; color?: string | null; collapsed?: boolean }) => {
      await api.put(`${base}/swimlanes/${id}`, data);
    },
    onMutate: ({ id, ...data }) => patchCache((d) => ({ ...d, swimlanes: d.swimlanes.map((l) => (l.id === id ? { ...l, ...data } : l)) })),
    onSettled: refresh,
  });

  const deleteLane = useMutation({
    mutationFn: async ({ id, deleteItems: del }: { id: string; deleteItems: boolean }) => {
      await api.delete(`${base}/swimlanes/${id}`, { params: { deleteItems: del } });
    },
    onSettled: refresh,
  });

  const reorderLanes = useMutation({
    mutationFn: async (orderedIds: string[]) => { await api.patch(`${base}/swimlanes/reorder`, { orderedIds }); },
    onMutate: (ids) => patchCache((d) => ({ ...d, swimlanes: d.swimlanes.map((l) => ({ ...l, sortOrder: ids.indexOf(l.id) })) })),
    onSettled: refresh,
  });

  const importFile = useMutation({
    mutationFn: async ({ file, mode }: { file: File; mode: 'append' | 'replace' }) => {
      const form = new FormData();
      form.append('file', file);
      form.append('mode', mode);
      return (await api.post<ImportResult>(`${base}/import`, form, { headers: { 'Content-Type': 'multipart/form-data' } })).data;
    },
    onSettled: refresh,
  });

  const importFromProject = useMutation({
    mutationFn: async (data: { taskListIds: string[]; milestoneListIds: string[] }) =>
      (await api.post<{ itemsImported: number; swimlanesCreated: number }>(`${base}/import-from-project`, data)).data,
    onSettled: refresh,
  });

  return { updateTimeline, createItem, updateItem, deleteItems, reorderItems, createLane, updateLane, deleteLane, reorderLanes, importFile, importFromProject };
}

export interface ImportResult {
  itemsImported: number;
  swimlanesCreated: number;
  skippedEmpty: number;
  warnings: string[];
}

// ── Templates (platform-level) ─────────────────────────────────────────────

export function useTimelineTemplates() {
  return useQuery({
    queryKey: ['timeline-templates'],
    queryFn: async () => (await api.get<{ templates: TimelineTemplateDTO[] }>('/timeline-templates')).data.templates ?? [],
    staleTime: 60_000,
  });
}

export function useTemplateAdmin() {
  const qc = useQueryClient();
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['timeline-templates'] }); void qc.invalidateQueries({ queryKey: ['timeline'] }); };
  type Body = { name?: string; description?: string | null; category?: string; isActive?: boolean; config?: TemplateConfig };

  const create = useMutation({
    mutationFn: async (data: Body & { name: string; config: TemplateConfig }) =>
      (await api.post<{ template: TimelineTemplateDTO }>('/timeline-templates', data)).data.template,
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: async ({ id, ...data }: Body & { id: string }) =>
      (await api.put<{ template: TimelineTemplateDTO }>(`/timeline-templates/${id}`, data)).data.template,
    onSuccess: refresh,
  });
  const duplicate = useMutation({
    mutationFn: async (id: string) => (await api.post<{ template: TimelineTemplateDTO }>(`/timeline-templates/${id}/duplicate`)).data.template,
    onSuccess: refresh,
  });
  const reset = useMutation({
    mutationFn: async (id: string) => (await api.post<{ template: TimelineTemplateDTO }>(`/timeline-templates/${id}/reset`)).data.template,
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => (await api.delete<{ timelinesAffected: number }>(`/timeline-templates/${id}`)).data,
    onSuccess: refresh,
  });
  return { create, update, duplicate, reset, remove };
}
