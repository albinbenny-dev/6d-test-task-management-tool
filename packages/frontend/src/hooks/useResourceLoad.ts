import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export interface TaskBlock {
  TO_DO: number; IN_PROGRESS: number; IN_REVIEW: number; DONE: number;
  overdue: number; open: number; closed: number;
}
export interface TestBlock {
  NOT_RUN: number; IN_PROGRESS: number; PASS: number; FAIL: number; BLOCKED: number;
  overdue: number; open: number; closed: number;
}
export interface ResourceProjectRow {
  projectId: string; slug: string; name: string;
  tasks: TaskBlock; tests: TestBlock;
}
export interface ResourceRow {
  key: string; // user id, or 'unassigned' | 'external'
  userId: string | null;
  name: string;
  email: string | null;
  kind: 'user' | 'external' | 'unassigned';
  tasks: TaskBlock;
  tests: TestBlock;
  projects: ResourceProjectRow[];
}
export interface ResourceLoadResponse {
  data: ResourceRow[];
  projects: { id: string; name: string; slug: string }[];
  generatedAt: string;
}

export interface ResourceLoadItem {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  overdue: boolean;
  project: { id: string; name: string; slug: string };
  // task
  priority?: string; taskListId?: string; listName?: string;
  // test
  srNo?: number | string; cycleId?: string; cycleName?: string;
}

export function useResourceLoad(enabled: boolean) {
  return useQuery({
    queryKey: ['resource-load'],
    enabled,
    staleTime: 30_000,
    queryFn: async () => (await api.get<ResourceLoadResponse>('/resource-load')).data,
  });
}

export function useResourceLoadItems(
  params: { kind: 'task' | 'test'; resource: string; projectId?: string; bucket: string } | null,
) {
  return useQuery({
    queryKey: ['resource-load-items', params],
    enabled: !!params,
    queryFn: async () =>
      (await api.get<{ items: ResourceLoadItem[]; truncated: boolean }>('/resource-load/items', { params })).data,
  });
}
