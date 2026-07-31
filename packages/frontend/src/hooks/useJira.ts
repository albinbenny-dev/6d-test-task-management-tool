import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { JiraConfig } from '../types';

// The Jira site URL only — open to any project member (not admin-gated like
// useJiraConfig), used to build "view in Jira" links (`${host}/browse/${key}`).
export function useJiraHost(projectId: string | undefined) {
  return useQuery({
    queryKey: ['jira-host', projectId],
    queryFn: async () => {
      const res = await api.get<{ jiraHost: string | null }>(`/projects/${projectId}/jira/host`);
      return res.data.jiraHost;
    },
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useJiraConfig(projectId: string | undefined) {
  return useQuery({
    queryKey: ['jira-config', projectId],
    queryFn: async () => {
      const res = await api.get<{ config: JiraConfig; credentialsConfigured: boolean }>(
        `/projects/${projectId}/jira/config`,
      );
      return res.data;
    },
    enabled: !!projectId,
  });
}

export function useUpdateJiraConfig(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<Pick<JiraConfig, 'jiraProjectKey' | 'pollIntervalMinutes' | 'isEnabled' | 'labels' | 'jql'>>) => {
      const res = await api.put<{ config: JiraConfig }>(`/projects/${projectId}/jira/config`, data);
      return res.data.config;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['jira-config', projectId] });
      void qc.invalidateQueries({ queryKey: ['project-defects', projectId] });
    },
  });
}

export function useTestJiraConnection(projectId: string) {
  return useMutation({
    mutationFn: async () => {
      const res = await api.post<{ ok: boolean; error?: string; accountName?: string }>(
        `/projects/${projectId}/jira/config/test`,
      );
      return res.data;
    },
  });
}

export function useSyncJiraNow(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await api.post<{ synced: number; error?: string }>(`/projects/${projectId}/jira/sync`);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['jira-config', projectId] });
      void qc.invalidateQueries({ queryKey: ['test-cycle-bugs', projectId] });
      void qc.invalidateQueries({ queryKey: ['test-cycles-all-bugs', projectId] });
      void qc.invalidateQueries({ queryKey: ['project-defects', projectId] });
    },
  });
}
