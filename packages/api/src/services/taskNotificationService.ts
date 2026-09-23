import { prisma } from '../lib/prisma.js';
import { createTransporter, escHtml } from './emailService.js';
import { isTriggerOn, parseNotificationSettings, type NotificationTrigger } from '../lib/notificationSettings.js';

// ── Task email notifications ────────────────────────────────────────────────
// All mail goes to registered users only (an external free-text assignee has
// no email address), and never to the person whose action triggered it:
//   1. "Assigned to you" — a task is created with / handed to a member.
//   2. Daily reminder digest — one email per person listing their open tasks
//      that are overdue, due today, or due within TASK_REMINDER_DAYS_BEFORE.
//   3. New comment — to the task's assignee, creator and earlier commenters.
//   4. Due date changed — to the task's assignee.
//   5. Test cycle item(s) assigned — to the new assignee, one email per batch.
// Each trigger can be switched off per project in Project Settings →
// Notifications (Project.notificationSettings). Every send is best-effort: a
// mail failure is logged and never fails the API request that triggered it.

function isEnabled(): boolean {
  return !!process.env.SMTP_HOST && process.env.TASK_NOTIFY_ENABLED !== 'false';
}

export function reminderTimeZone(): string {
  return process.env.TASK_REMINDER_TZ ?? 'Asia/Kolkata';
}

function appUrl(): string {
  return (process.env.APP_URL ?? 'http://localhost:3200').replace(/\/+$/, '');
}

// Calendar date (YYYY-MM-DD) of an instant in the reminder time zone. Due
// dates are saved from a date picker as UTC midnight, so comparing calendar
// dates — not timestamps — keeps "due today" correct in IST.
function dateKey(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: reminderTimeZone() }).format(d);
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-IN', { timeZone: reminderTimeZone(), day: '2-digit', month: 'short', year: 'numeric' });
}

function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(toKey) - Date.parse(fromKey)) / 86_400_000);
}

const PRIORITY_COLOR: Record<string, string> = { URGENT: '#DC2626', HIGH: '#F47B20', NORMAL: '#2563AB', LOW: '#94A3B8' };
const PRIORITY_LABEL: Record<string, string> = { URGENT: 'Urgent', HIGH: 'High', NORMAL: 'Normal', LOW: 'Low' };
const STATUS_LABEL: Record<string, string> = { TO_DO: 'To Do', IN_PROGRESS: 'In Progress', IN_REVIEW: 'In Review', DONE: 'Done' };

const NOTIFY_TASK_SELECT = {
  id: true,
  title: true,
  status: true,
  priority: true,
  dueDate: true,
  taskListId: true,
  taskList: { select: { name: true } },
  project: { select: { name: true, slug: true, notificationSettings: true } },
  assignee: { select: { user: { select: { id: true, name: true, email: true } } } },
} as const;

interface NotifyTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: Date | null;
  taskListId: string;
  taskList: { name: string };
  project: { name: string; slug: string; notificationSettings: string };
  assignee: { user: { id: string; name: string; email: string } } | null;
}

function projectAllows(project: { notificationSettings: string }, trigger: NotificationTrigger): boolean {
  return isTriggerOn(parseNotificationSettings(project.notificationSettings), trigger);
}

function taskLink(t: NotifyTask): string {
  return `${appUrl()}/projects/${encodeURIComponent(t.project.slug)}/tasks/${t.taskListId}?open=${t.id}`;
}

// ── HTML ────────────────────────────────────────────────────────────────────

function taskRow(t: NotifyTask, dueNote?: { text: string; color: string }): string {
  const pColor = PRIORITY_COLOR[t.priority] ?? '#94A3B8';
  const due = t.dueDate ? formatDate(t.dueDate) : '—';
  return `
    <tr>
      <td style="padding:10px 12px;border-top:1px solid #E2E8F0;">
        <a href="${taskLink(t)}" style="font-size:13px;font-weight:600;color:#0A2A57;text-decoration:none;">${escHtml(t.title)}</a>
        <div style="font-size:11px;color:#6B7280;margin-top:2px;">${escHtml(t.project.name)} · ${escHtml(t.taskList.name)}</div>
      </td>
      <td style="padding:10px 12px;border-top:1px solid #E2E8F0;font-size:11px;font-weight:700;color:${pColor};white-space:nowrap;">${PRIORITY_LABEL[t.priority] ?? t.priority}</td>
      <td style="padding:10px 12px;border-top:1px solid #E2E8F0;font-size:12px;color:#475569;white-space:nowrap;">${STATUS_LABEL[t.status] ?? t.status}</td>
      <td style="padding:10px 12px;border-top:1px solid #E2E8F0;font-size:12px;color:#334155;white-space:nowrap;">
        ${due}${dueNote ? `<div style="font-size:10px;font-weight:700;color:${dueNote.color};margin-top:2px;">${dueNote.text}</div>` : ''}
      </td>
    </tr>`;
}

function taskTable(rows: string): string {
  return `
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <thead>
        <tr style="background:#F1F5F9;">
          <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.05em;">Task</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.05em;">Priority</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.05em;">Status</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.05em;">Due</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function layout(heading: string, intro: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F7F9FC;font-family:'Open Sans',Arial,sans-serif;">
<div style="max-width:700px;margin:0 auto;background:#FFFFFF;">
  <div style="background:#0A2A57;padding:20px 32px;">
    <div style="font-size:18px;font-weight:700;color:#FFFFFF;">${heading}</div>
  </div>
  <div style="padding:24px 32px;">
    <p style="font-size:14px;color:#334155;line-height:1.6;margin:0 0 20px;">${intro}</p>
    ${body}
  </div>
  <div style="background:#F1F5F9;padding:16px 32px;text-align:center;border-top:1px solid #E2E8F0;">
    <div style="font-size:11px;color:#94A3B8;">Sent by 6D Test &amp; Task Management Tool · Powered by 6D Technologies</div>
  </div>
</div>
</body>
</html>`;
}

function sectionTitle(text: string, color: string): string {
  return `<div style="font-size:13px;font-weight:700;color:${color};margin:0 0 8px;">${text}</div>`;
}

async function send(to: string, subject: string, html: string): Promise<void> {
  await createTransporter().sendMail({
    from: process.env.SMTP_FROM ?? 'no-reply@6dtech.co.in',
    to,
    subject,
    html,
  });
}

function groupByAssignee(tasks: NotifyTask[]): Map<string, { user: { id: string; name: string; email: string }; tasks: NotifyTask[] }> {
  const map = new Map<string, { user: { id: string; name: string; email: string }; tasks: NotifyTask[] }>();
  for (const t of tasks) {
    const user = t.assignee?.user;
    if (!user?.email) continue;
    const entry = map.get(user.id) ?? { user, tasks: [] };
    entry.tasks.push(t);
    map.set(user.id, entry);
  }
  return map;
}

// ── 1. Assignment notification ──────────────────────────────────────────────

async function sendAssignedEmails(taskIds: string[], actorUserId: string): Promise<void> {
  if (!isEnabled() || taskIds.length === 0) return;

  const tasks = await prisma.task.findMany({
    where: { id: { in: taskIds }, assigneeId: { not: null }, status: { not: 'DONE' } },
    select: NOTIFY_TASK_SELECT,
  });
  const groups = groupByAssignee(tasks.filter((t) => t.assignee?.user.id !== actorUserId && projectAllows(t.project, 'taskAssigned')));
  if (groups.size === 0) return;
  const actor = await actorName(actorUserId);

  for (const { user, tasks: userTasks } of groups.values()) {
    const single = userTasks.length === 1;
    const subject = single
      ? `[Task] Assigned to you: ${userTasks[0].title}`
      : `[Task] ${userTasks.length} tasks assigned to you`;
    const intro = single
      ? `Hi ${escHtml(user.name)}, <b>${actor}</b> assigned you a task.`
      : `Hi ${escHtml(user.name)}, <b>${actor}</b> assigned you ${userTasks.length} tasks.`;
    const html = layout(single ? 'New task assigned to you' : 'New tasks assigned to you', intro, taskTable(userTasks.map((t) => taskRow(t)).join('')));
    await sendLogged(user.email, subject, html, 'Assignment');
  }
}

// The exported notify* functions are fire-and-forget wrappers for route
// handlers — they never await and never throw.
function background(label: string, p: Promise<void>): void {
  p.catch((err) => console.error(`[task-notify] ${label} notification failed:`, err));
}

async function sendLogged(to: string, subject: string, html: string, what: string): Promise<void> {
  try {
    await send(to, subject, html);
    console.log(`[task-notify] ${what} email sent to ${to}`);
  } catch (err) {
    console.error(`[task-notify] Failed to send ${what} email to ${to}:`, (err as Error).message);
  }
}

async function actorName(actorUserId: string): Promise<string> {
  const actor = await prisma.user.findUnique({ where: { id: actorUserId }, select: { name: true } });
  return escHtml(actor?.name ?? 'Someone');
}

export function notifyTasksAssigned(taskIds: string[], actorUserId: string): void {
  background('Assignment', sendAssignedEmails(taskIds, actorUserId));
}

// ── 3. New comment ──────────────────────────────────────────────────────────

async function sendCommentEmails(commentId: string): Promise<void> {
  if (!isEnabled()) return;

  const comment = await prisma.taskComment.findUnique({
    where: { id: commentId },
    select: { body: true, userId: true, user: { select: { name: true } }, task: { select: { ...NOTIFY_TASK_SELECT, createdByUserId: true } } },
  });
  if (!comment || !projectAllows(comment.task.project, 'taskComment')) return;
  const { task } = comment;

  const earlier = await prisma.taskComment.findMany({
    where: { taskId: task.id },
    select: { userId: true },
    distinct: ['userId'],
  });
  const recipientIds = new Set<string>([task.createdByUserId, ...earlier.map((c) => c.userId)]);
  if (task.assignee) recipientIds.add(task.assignee.user.id);
  recipientIds.delete(comment.userId);
  if (recipientIds.size === 0) return;

  const users = await prisma.user.findMany({ where: { id: { in: [...recipientIds] } }, select: { name: true, email: true } });
  const author = escHtml(comment.user.name);
  const quote = `
    <div style="background:#F7F9FC;border-left:4px solid #2563AB;border-radius:6px;padding:12px 16px;margin-bottom:20px;font-size:13px;color:#334155;line-height:1.6;white-space:pre-wrap;">${escHtml(comment.body)}</div>`;
  const body = quote + taskTable(taskRow(task));

  for (const u of users) {
    if (!u.email) continue;
    const intro = `Hi ${escHtml(u.name)}, <b>${author}</b> commented on <a href="${taskLink(task)}" style="color:#2563AB;">${escHtml(task.title)}</a>.`;
    await sendLogged(u.email, `[Task] New comment on: ${task.title}`, layout('New comment on a task', intro, body), 'Comment');
  }
}

export function notifyTaskComment(commentId: string): void {
  background('Comment', sendCommentEmails(commentId));
}

// ── 4. Due date changed ─────────────────────────────────────────────────────

async function sendDueDateChangedEmail(taskId: string, previousDue: Date | null, actorUserId: string): Promise<void> {
  if (!isEnabled()) return;

  const task = await prisma.task.findUnique({ where: { id: taskId }, select: NOTIFY_TASK_SELECT });
  const user = task?.assignee?.user;
  if (!task || !user?.email || user.id === actorUserId || task.status === 'DONE') return;
  if (!projectAllows(task.project, 'taskDueDateChanged')) return;

  const from = previousDue ? formatDate(previousDue) : 'no due date';
  const to = task.dueDate ? formatDate(task.dueDate) : 'no due date';
  const intro = `Hi ${escHtml(user.name)}, <b>${await actorName(actorUserId)}</b> changed the due date of a task assigned to you from <b>${from}</b> to <b>${to}</b>.`;
  await sendLogged(user.email, `[Task] Due date changed: ${task.title}`, layout('Task due date changed', intro, taskTable(taskRow(task))), 'Due date');
}

export function notifyTaskDueDateChanged(taskId: string, previousDue: Date | null, actorUserId: string): void {
  background('Due date', sendDueDateChangedEmail(taskId, previousDue, actorUserId));
}

// ── 5. Test cycle item(s) assigned ──────────────────────────────────────────

const CYCLE_ITEM_STATUS_LABEL: Record<string, string> = { NOT_RUN: 'Not Run', IN_PROGRESS: 'In Progress', PASS: 'Pass', FAIL: 'Fail', BLOCKED: 'Blocked' };
const MAX_CYCLE_ROWS = 50;

async function sendCycleItemsAssignedEmail(itemIds: string[], actorUserId: string): Promise<void> {
  if (!isEnabled() || itemIds.length === 0) return;

  const items = await prisma.testCycleItem.findMany({
    where: { id: { in: itemIds }, assigneeId: { not: null } },
    select: {
      manualStatus: true,
      testCase: { select: { srNo: true, module: true, title: true } },
      testCycle: { select: { id: true, name: true, dueDate: true } },
      project: { select: { name: true, slug: true, notificationSettings: true } },
      assignee: { select: { user: { select: { id: true, name: true, email: true } } } },
    },
    orderBy: { sortOrder: 'asc' },
  });
  // A batch is always one cycle and one assignee (single + bulk assign routes).
  const first = items[0];
  const user = first?.assignee?.user;
  if (!first || !user?.email || user.id === actorUserId) return;
  if (!projectAllows(first.project, 'cycleItemAssigned')) return;

  const cycle = first.testCycle;
  const cycleLink = `${appUrl()}/projects/${encodeURIComponent(first.project.slug)}/test-cycles/${cycle.id}`;
  const rows = items.slice(0, MAX_CYCLE_ROWS).map((i) => `
    <tr>
      <td style="padding:8px 12px;border-top:1px solid #E2E8F0;font-size:12px;color:#475569;white-space:nowrap;">${escHtml(i.testCase.srNo ?? '—')}</td>
      <td style="padding:8px 12px;border-top:1px solid #E2E8F0;font-size:13px;color:#334155;">${escHtml(i.testCase.title)}${i.testCase.module ? `<div style="font-size:11px;color:#6B7280;margin-top:2px;">${escHtml(i.testCase.module)}</div>` : ''}</td>
      <td style="padding:8px 12px;border-top:1px solid #E2E8F0;font-size:12px;color:#475569;white-space:nowrap;">${CYCLE_ITEM_STATUS_LABEL[i.manualStatus] ?? i.manualStatus}</td>
    </tr>`).join('');
  const more = items.length > MAX_CYCLE_ROWS ? `<p style="font-size:12px;color:#6B7280;margin:-8px 0 20px;">…and ${items.length - MAX_CYCLE_ROWS} more.</p>` : '';

  const table = `
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <thead>
        <tr style="background:#F1F5F9;">
          <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.05em;">TC ID</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.05em;">Test case</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.05em;">Status</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>${more}`;
  const button = `<a href="${cycleLink}" style="display:inline-block;background:#F47B20;color:#FFFFFF;font-size:13px;font-weight:700;text-decoration:none;padding:10px 20px;border-radius:6px;">Open test cycle</a>`;

  const count = items.length;
  const due = cycle.dueDate ? ` The cycle is due on <b>${formatDate(cycle.dueDate)}</b>.` : '';
  const intro = `Hi ${escHtml(user.name)}, <b>${await actorName(actorUserId)}</b> assigned you ${count === 1 ? 'a test case' : `${count} test cases`} in test cycle <b>${escHtml(cycle.name)}</b> (${escHtml(first.project.name)}).${due}`;
  const subject = `[Test Cycle] ${count === 1 ? '1 test case' : `${count} test cases`} assigned to you — ${cycle.name}`;
  await sendLogged(user.email, subject, layout(count === 1 ? 'Test case assigned to you' : 'Test cases assigned to you', intro, table + button), 'Test cycle assignment');
}

export function notifyCycleItemsAssigned(itemIds: string[], actorUserId: string): void {
  background('Test cycle assignment', sendCycleItemsAssignedEmail(itemIds, actorUserId));
}

// ── 2. Daily reminder digest ────────────────────────────────────────────────

export async function sendDailyTaskReminders(): Promise<void> {
  if (!isEnabled()) return;

  const daysBefore = Math.max(0, parseInt(process.env.TASK_REMINDER_DAYS_BEFORE ?? '1', 10) || 0);
  const now = new Date();
  const todayKey = dateKey(now);
  // Generous upper bound for the query; the precise cut is by calendar date below.
  const horizon = new Date(now.getTime() + (daysBefore + 2) * 86_400_000);

  const tasks = await prisma.task.findMany({
    where: {
      status: { not: 'DONE' },
      assigneeId: { not: null },
      dueDate: { not: null, lte: horizon },
    },
    select: NOTIFY_TASK_SELECT,
    orderBy: { dueDate: 'asc' },
  });

  const due = tasks.filter((t) => projectAllows(t.project, 'taskReminder') && daysBetween(todayKey, dateKey(t.dueDate!)) <= daysBefore);
  const groups = groupByAssignee(due);
  let sent = 0;

  for (const { user, tasks: userTasks } of groups.values()) {
    const overdue: string[] = [];
    const today: string[] = [];
    const upcoming: string[] = [];
    for (const t of userTasks) {
      const diff = daysBetween(todayKey, dateKey(t.dueDate!));
      if (diff < 0) overdue.push(taskRow(t, { text: `${-diff} day${diff === -1 ? '' : 's'} overdue`, color: '#DC2626' }));
      else if (diff === 0) today.push(taskRow(t, { text: 'Due today', color: '#F47B20' }));
      else upcoming.push(taskRow(t, { text: `In ${diff} day${diff === 1 ? '' : 's'}`, color: '#2563AB' }));
    }

    const body = [
      overdue.length ? sectionTitle(`Overdue (${overdue.length})`, '#DC2626') + taskTable(overdue.join('')) : '',
      today.length ? sectionTitle(`Due today (${today.length})`, '#F47B20') + taskTable(today.join('')) : '',
      upcoming.length ? sectionTitle(`Coming up (${upcoming.length})`, '#2563AB') + taskTable(upcoming.join('')) : '',
    ].join('');

    const parts = [
      overdue.length ? `${overdue.length} overdue` : '',
      today.length ? `${today.length} due today` : '',
      upcoming.length ? `${upcoming.length} coming up` : '',
    ].filter(Boolean);
    const subject = `[Task Reminder] ${parts.join(', ')}`;
    const intro = `Hi ${escHtml(user.name)}, here are your open tasks that need attention.`;

    try {
      await send(user.email, subject, layout('Your task reminders', intro, body));
      sent++;
    } catch (err) {
      console.error(`[task-notify] Failed to send reminder to ${user.email}:`, (err as Error).message);
    }
  }

  console.log(`[task-notify] Daily reminders: ${sent}/${groups.size} email(s) sent, ${due.length} task(s)`);
}
