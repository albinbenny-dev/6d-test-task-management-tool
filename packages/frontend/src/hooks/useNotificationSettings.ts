import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

// Per-project email notification switches — `enabled` is the project's
// master switch; the rest are individual triggers (see the API's
// lib/notificationSettings.ts). Project ADMIN only.
export interface NotificationSettings {
  enabled: boolean;
  taskAssigned: boolean;
  taskComment: boolean;
  taskDueDateChanged: boolean;
  taskReminder: boolean;
  leadReminder: boolean;
  cycleItemAssigned: boolean;
}

interface NotificationSettingsResponse {
  settings: NotificationSettings;
  // Whether SMTP is set up on the server — ops-managed, not per project.
  serverEmailConfigured: boolean;
}

export function useNotificationSettings(projectId: string | undefined) {
  return useQuery({
    queryKey: ['notification-settings', projectId],
    queryFn: async () => {
      const res = await api.get<NotificationSettingsResponse>(`/projects/${projectId}/notification-settings`);
      return res.data;
    },
    enabled: !!projectId,
  });
}

export function useUpdateNotificationSettings(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<NotificationSettings>) => {
      const res = await api.put<NotificationSettingsResponse>(`/projects/${projectId}/notification-settings`, data);
      return res.data;
    },
    onSuccess: (data) => {
      qc.setQueryData(['notification-settings', projectId], data);
    },
  });
}
