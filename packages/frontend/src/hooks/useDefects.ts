import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { ProjectDefect } from '../types';

// Project-wide Defects dashboard — unified list of every Jira bug discovered
// across this project (explicit links + per-cycle label/JQL + project-wide
// label/JQL from JiraConfig). See useSyncJiraNow/useUpdateJiraConfig in
// useJira.ts for the sync-config actions this page also drives.
export function useProjectDefects(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project-defects', projectId],
    queryFn: async () => {
      const res = await api.get<{ defects: ProjectDefect[] }>(`/projects/${projectId}/defects`);
      return res.data.defects;
    },
    enabled: !!projectId,
  });
}
