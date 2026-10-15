import { prisma } from '../lib/prisma.js';
import { escHtml } from './emailService.js';
import {
  appUrl, dateKey, daysBetween, formatDate, isEnabled, layout, projectAllows, send,
} from './taskNotificationService.js';

// ── Payment-milestone reminder emails ───────────────────────────────────────
// Fires off the Documentary Evidence Date (DED) — the date the paperwork needed
// to raise the invoice is due — for every payment-linked milestone whose invoice
// hasn't been raised yet. It runs inside the same daily job as the task
// reminders (jobs/taskReminderWorker.ts), and because that job runs once a day a
// milestone is simply reminded on the days that match, so no "already reminded"
// state is stored:
//   · proactively, MILESTONE_REMINDER_DAYS days before the DED (default "7,3,0" —
//     a week out, three days out, and the day itself)
//   · after the DED has passed, every 7th day (7, 14, 21… days overdue) until the
//     invoice is marked raised
// One digest per recipient — project ADMIN / SUPER_USER members for their
// projects, plus every global SUPER_ADMIN (same audience as the team task
// report) — grouped Project → PO. Switchable per project (trigger:
// milestoneReminder). Amounts are never in the data, so never in the email.

export type MilestoneBucket = 'overdue' | 'today' | 'upcoming';

export interface DueMilestone {
  id: string;
  name: string;
  poName: string | null;
  poNumber: string | null;
  evidenceDate: Date;
  targetDate: Date | null;
  actualDate: Date | null;
  isCompleted: boolean;
  lastImportedAt: Date | null;
  project: { id: string; name: string; slug: string };
  diff: number; // whole calendar days from today to the DED; negative = overdue
  bucket: MilestoneBucket;
}

export function reminderLeadDays(): number[] {
  const raw = process.env.MILESTONE_REMINDER_DAYS ?? '7,3,0';
  const days = raw.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n >= 0);
  return days.length > 0 ? [...new Set(days)] : [7, 3, 0];
}

/** Whether a milestone whose DED is `diff` days away should be reminded about today. */
export function shouldRemind(diff: number, leadDays: number[]): boolean {
  if (diff >= 0) return leadDays.includes(diff);
  return -diff % 7 === 0;
}

const BUCKET_ORDER: Record<MilestoneBucket, number> = { overdue: 0, today: 1, upcoming: 2 };

function note(diff: number): { text: string; color: string } {
  if (diff < 0) return { text: `${-diff} day${diff === -1 ? '' : 's'} overdue`, color: '#DC2626' };
  if (diff === 0) return { text: 'Due today', color: '#F47B20' };
  return { text: `In ${diff} day${diff === 1 ? '' : 's'}`, color: '#2563AB' };
}

function deliveryText(m: DueMilestone): string {
  if (m.isCompleted) return m.actualDate ? `Delivered ${formatDate(m.actualDate)}` : 'Delivered';
  return m.targetDate ? `Not delivered · due ${formatDate(m.targetDate)}` : 'Not delivered';
}

function counts(items: DueMilestone[]): string {
  const c = { overdue: 0, today: 0, upcoming: 0 };
  for (const i of items) c[i.bucket]++;
  return [
    c.overdue ? `${c.overdue} overdue` : '',
    c.today ? `${c.today} due today` : '',
    c.upcoming ? `${c.upcoming} coming up` : '',
  ].filter(Boolean).join(', ');
}

function groupBy<T>(items: T[], key: (item: T) => string): T[][] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const list = map.get(key(item)) ?? [];
    list.push(item);
    map.set(key(item), list);
  }
  return [...map.values()];
}

function row(m: DueMilestone): string {
  const n = note(m.diff);
  return `
    <tr>
      <td style="padding:10px 12px;border-top:1px solid #E2E8F0;font-size:13px;font-weight:600;color:#0A2A57;">${escHtml(m.name)}</td>
      <td style="padding:10px 12px;border-top:1px solid #E2E8F0;font-size:12px;color:#334155;white-space:nowrap;">
        ${formatDate(m.evidenceDate)}<div style="font-size:10px;font-weight:700;color:${n.color};margin-top:2px;">${n.text}</div>
      </td>
      <td style="padding:10px 12px;border-top:1px solid #E2E8F0;font-size:12px;color:#475569;">${escHtml(deliveryText(m))}</td>
    </tr>`;
}

const TH = 'padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.05em;';

export function milestoneDigestBody(items: DueMilestone[]): string {
  const projects = groupBy(items, (i) => i.project.id).sort((a, b) => a[0].project.name.localeCompare(b[0].project.name));
  const sections = projects.map((projectItems) => {
    const project = projectItems[0].project;
    const pos = groupBy(projectItems, (i) => i.poNumber ?? i.poName ?? '').map((poItems) => {
      const sorted = [...poItems].sort((a, b) => BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket] || a.diff - b.diff);
      const poLabel = poItems[0].poName ?? 'Milestones';
      return `
      <div style="font-size:13px;font-weight:700;color:#334155;margin:0 0 6px;">${escHtml(poLabel)}${poItems[0].poNumber ? `<span style="font-size:11px;font-weight:600;color:#6B7280;"> — PO ${escHtml(poItems[0].poNumber)}</span>` : ''}</div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
        <thead><tr style="background:#F1F5F9;">
          <th style="${TH}">Milestone</th><th style="${TH}">Evidence due</th><th style="${TH}">Delivery</th>
        </tr></thead>
        <tbody>${sorted.map(row).join('')}</tbody>
      </table>`;
    }).join('');
    return `
    <div style="margin-bottom:28px;">
      <div style="background:#0F2D4A;border-radius:6px;padding:10px 14px;margin-bottom:14px;">
        <a href="${appUrl()}/projects/${encodeURIComponent(project.slug)}/milestones" style="font-size:14px;font-weight:700;color:#FFFFFF;text-decoration:none;">${escHtml(project.name)}</a>
        <span style="font-size:11px;color:#CBD5E1;"> · ${counts(projectItems)}</span>
      </div>
      ${pos}
    </div>`;
  }).join('');

  const imported = items.map((i) => i.lastImportedAt).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
  const footer = imported
    ? `<p style="font-size:11px;color:#94A3B8;margin:0;">Dates are as of the last CRM upload (${formatDate(imported)}). Upload the latest PO report to refresh them.</p>`
    : '';
  return sections + footer;
}

export async function sendDailyMilestoneReminders(): Promise<void> {
  if (!isEnabled()) return;

  const leadDays = reminderLeadDays();
  const todayKey = dateKey(new Date());

  const rows = await prisma.milestone.findMany({
    where: { isPaymentLinked: true, invoiceRaised: false, evidenceDate: { not: null } },
    select: {
      id: true, name: true, poName: true, poNumber: true, evidenceDate: true, targetDate: true, actualDate: true,
      isCompleted: true, lastImportedAt: true,
      project: { select: { id: true, name: true, slug: true, notificationSettings: true } },
    },
    orderBy: { evidenceDate: 'asc' },
  });

  const due: DueMilestone[] = [];
  for (const m of rows) {
    const diff = daysBetween(todayKey, dateKey(m.evidenceDate!));
    if (!shouldRemind(diff, leadDays)) continue;
    if (!projectAllows(m.project, 'milestoneReminder')) continue;
    due.push({
      ...m,
      evidenceDate: m.evidenceDate!,
      project: { id: m.project.id, name: m.project.name, slug: m.project.slug },
      diff,
      bucket: diff < 0 ? 'overdue' : diff === 0 ? 'today' : 'upcoming',
    });
  }
  if (due.length === 0) { console.log('[milestone-notify] Nothing to remind about today'); return; }

  const projectIds = [...new Set(due.map((d) => d.project.id))];
  const [leads, superAdmins] = await Promise.all([
    prisma.projectMember.findMany({
      where: { projectId: { in: projectIds }, role: { in: ['ADMIN', 'SUPER_USER'] } },
      select: { projectId: true, user: { select: { id: true, name: true, email: true } } },
    }),
    prisma.user.findMany({ where: { globalRole: 'SUPER_ADMIN' }, select: { id: true, name: true, email: true } }),
  ]);

  const recipients = new Map<string, { user: { name: string; email: string }; projects: Set<string> }>();
  const add = (user: { id: string; name: string; email: string }, ids: string[]) => {
    if (!user.email) return;
    const entry = recipients.get(user.id) ?? { user, projects: new Set<string>() };
    ids.forEach((id) => entry.projects.add(id));
    recipients.set(user.id, entry);
  };
  for (const l of leads) add(l.user, [l.projectId]);
  for (const sa of superAdmins) add(sa, projectIds);

  let sent = 0;
  for (const { user, projects } of recipients.values()) {
    const items = due.filter((d) => projects.has(d.project.id));
    if (items.length === 0) continue;
    const subject = `[Milestone Reminder] ${counts(items)}`;
    const intro = `Hi ${escHtml(user.name)}, these payment milestones are at or near their documentary evidence date and the invoice has not been raised yet.`;
    try {
      await send(user.email, subject, layout('Payment milestone reminders', intro, milestoneDigestBody(items)));
      sent++;
    } catch (err) {
      console.error(`[milestone-notify] Failed to send reminder to ${user.email}:`, (err as Error).message);
    }
  }
  console.log(`[milestone-notify] Milestone reminders: ${sent}/${recipients.size} email(s) sent (${due.length} milestone(s))`);
}
