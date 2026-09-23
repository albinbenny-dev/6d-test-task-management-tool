import { prisma } from './prisma.js';

// ── Per-project email notification switches ─────────────────────────────────
// Stored as JSON in Project.notificationSettings. `enabled` is the project's
// master switch; each trigger key is only honoured while it's on. Keys absent
// from the stored JSON default to true, so existing projects keep getting
// every notification and a trigger added later starts out on everywhere.

export const NOTIFICATION_TRIGGERS = [
  'taskAssigned',
  'taskComment',
  'taskDueDateChanged',
  'taskReminder',
  'leadReminder',
  'cycleItemAssigned',
] as const;

export type NotificationTrigger = (typeof NOTIFICATION_TRIGGERS)[number];
export type NotificationSettings = { enabled: boolean } & Record<NotificationTrigger, boolean>;

export function parseNotificationSettings(raw: string | null | undefined): NotificationSettings {
  let stored: Record<string, unknown> = {};
  try { stored = JSON.parse(raw || '{}') ?? {}; } catch { /* malformed → all defaults */ }
  const settings = { enabled: stored.enabled !== false } as NotificationSettings;
  for (const key of NOTIFICATION_TRIGGERS) settings[key] = stored[key] !== false;
  return settings;
}

export function isTriggerOn(settings: NotificationSettings, trigger: NotificationTrigger): boolean {
  return settings.enabled && settings[trigger];
}

export async function isProjectTriggerOn(projectId: string, trigger: NotificationTrigger): Promise<boolean> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { notificationSettings: true } });
  return !!project && isTriggerOn(parseNotificationSettings(project.notificationSettings), trigger);
}
