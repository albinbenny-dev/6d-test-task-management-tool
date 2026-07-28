import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { WikiPage } from '../types';

function invalidateAll(qc: ReturnType<typeof useQueryClient>, projectId: string) {
  void qc.invalidateQueries({ queryKey: ['wiki-pages', projectId] });
  void qc.invalidateQueries({ queryKey: ['wiki-page', projectId] });
}

export function useWikiPages(projectId: string | undefined) {
  return useQuery({
    queryKey: ['wiki-pages', projectId],
    queryFn: async () => {
      const res = await api.get<{ pages: WikiPage[] }>(`/projects/${projectId}/wiki`);
      return res.data.pages ?? [];
    },
    enabled: !!projectId,
  });
}

export function useWikiPage(projectId: string | undefined, pageId: string | undefined) {
  return useQuery({
    queryKey: ['wiki-page', projectId, pageId],
    queryFn: async () => {
      const res = await api.get<{ page: WikiPage }>(`/projects/${projectId}/wiki/${pageId}`);
      return res.data.page;
    },
    enabled: !!projectId && !!pageId,
  });
}

export function useCreateWikiPage(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { title: string; parentPageId?: string; content?: string; tags?: string[] }) => {
      const res = await api.post<{ page: WikiPage }>(`/projects/${projectId}/wiki`, data);
      return res.data.page;
    },
    onSuccess: () => invalidateAll(qc, projectId),
  });
}

export function useUpdateWikiPage(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { id: string; title?: string; content?: string; tags?: string[] }) => {
      const { id, ...body } = data;
      const res = await api.put<{ page: WikiPage }>(`/projects/${projectId}/wiki/${id}`, body);
      return res.data.page;
    },
    onSuccess: (page) => {
      invalidateAll(qc, projectId);
      qc.setQueryData(['wiki-page', projectId, page.id], page);
    },
  });
}

export function useReorderWikiPages(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { parentPageId: string | null; orderedIds: string[] }) => {
      await api.patch(`/projects/${projectId}/wiki/reorder`, data);
    },
    onSuccess: () => invalidateAll(qc, projectId),
  });
}

export function useDeleteWikiPage(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (pageId: string) => {
      const res = await api.delete<{ message: string; childPagesDeleted: number }>(`/projects/${projectId}/wiki/${pageId}`);
      return res.data;
    },
    onSuccess: () => invalidateAll(qc, projectId),
  });
}
