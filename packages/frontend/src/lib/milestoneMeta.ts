import type { Milestone } from '../types';

/** A milestone is overdue when its target date is in the past and it isn't complete yet — never stored, always derived. */
export function isMilestoneOverdue(m: Pick<Milestone, 'targetDate' | 'isCompleted'>): boolean {
  if (!m.targetDate || m.isCompleted) return false;
  return new Date(m.targetDate).getTime() < Date.now();
}

// Same 4-bucket shape as taskDueBucket/DefectsDashboard's dueBucket, plus a
// "This month" tier ahead of "Later" — a payment milestone is a monthly
// planning signal (invoicing cadence), not a weekly one like a task.
export const MILESTONE_DUE_BUCKETS = ['Overdue', 'Due this month', 'Later', 'No target date'] as const;
export type MilestoneDueBucket = typeof MILESTONE_DUE_BUCKETS[number];

export function milestoneDueBucket(m: Pick<Milestone, 'targetDate' | 'isCompleted'>): MilestoneDueBucket {
  if (m.isCompleted) return 'Later'; // completed milestones never surface as due/overdue
  if (!m.targetDate) return 'No target date';
  if (isMilestoneOverdue(m)) return 'Overdue';
  const due = new Date(m.targetDate);
  const now = new Date();
  const endOfThisCalendarMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return due <= endOfThisCalendarMonth ? 'Due this month' : 'Later';
}

/** Whole days between two dates (b - a), rounded — used for both baseline and execution slip. */
function daysBetween(a: string | Date, b: string | Date): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

/** How far the current/revised commitment has slipped from the original baseline. Positive = later than baseline. Null when either date is missing. */
export function baselineSlipDays(m: Pick<Milestone, 'baselineDate' | 'targetDate'>): number | null {
  if (!m.baselineDate || !m.targetDate) return null;
  return daysBetween(m.baselineDate, m.targetDate);
}

/** How the actual delivery compares to the latest commitment (or to today, if not yet delivered). Positive = late. Null when there's no target to measure against. */
export function executionSlipDays(m: Pick<Milestone, 'targetDate' | 'actualDate' | 'isCompleted'>): number | null {
  if (!m.targetDate) return null;
  if (m.actualDate) return daysBetween(m.targetDate, m.actualDate);
  if (m.isCompleted) return null;
  return Math.max(0, daysBetween(m.targetDate, new Date()));
}

export type DeviationTone = 'on-time' | 'minor' | 'major';

/** Color-coding threshold for slip badges — tune here, used everywhere a slip day-count is rendered. */
export function deviationTone(slipDays: number | null, majorThresholdDays = 30): DeviationTone {
  if (slipDays === null || slipDays <= 0) return 'on-time';
  return slipDays > majorThresholdDays ? 'major' : 'minor';
}

export const DEVIATION_COLOR: Record<DeviationTone, string> = {
  'on-time': 'var(--pass)',
  minor: 'var(--amber)',
  major: 'var(--fail)',
};

export function formatMilestoneDate(date: string | null | undefined): string {
  if (!date) return '—';
  const d = new Date(date);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' });
}
