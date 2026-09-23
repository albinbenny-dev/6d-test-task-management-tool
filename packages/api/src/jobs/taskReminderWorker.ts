import cron from 'node-cron';
import { reminderTimeZone, sendDailyTaskReminders } from '../services/taskNotificationService.js';

// ── Task reminder worker ─────────────────────────────────────────────────────
// Fixed static cron (mirrors jobs/jiraPollWorker.ts). Once a day, each
// assignee with overdue / due-today / due-soon open tasks gets one digest
// email. Assumes a single API instance — a second replica would send
// duplicate digests. node-cron doesn't catch up missed ticks, so if the API
// is down at the scheduled time that day's digest is skipped.

export function startTaskReminderSchedule(): void {
  const expr = process.env.TASK_REMINDER_CRON ?? '0 9 * * *'; // 09:00 daily
  if (!cron.validate(expr)) {
    console.warn(`[task-notify] Invalid TASK_REMINDER_CRON "${expr}" — reminders disabled`);
    return;
  }
  const timezone = reminderTimeZone();
  cron.schedule(expr, () => {
    sendDailyTaskReminders().catch((err) => console.error('[task-notify] Daily reminder run failed:', err));
  }, { timezone });
  console.log(`[task-notify] Task reminders scheduled (${expr}, ${timezone})`);
}
