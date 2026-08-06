// ── Shared UTC calendar-day helpers for "daily trend" charts (execution
// velocity, resource load, bug open/close). Every timestamp these charts
// bucket (changedAt, jiraCreatedAt, jiraUpdatedAt) is a UTC ISO string, so
// the bucketing has to use UTC day boundaries too — mirrors the reasoning in
// Assignments.tsx's buildDailySeries: using local midnight and re-deriving
// the key via toISOString() would shift the whole window back a day in any
// timezone ahead of UTC, silently dropping "today"'s entries off the end. ──

/** UTC calendar-day key ("YYYY-MM-DD") for an ISO timestamp string. */
export function dayKeyOf(iso: string): string {
  return iso.slice(0, 10);
}

/** Oldest-to-newest UTC day keys for the trailing `days`-day window ending today (inclusive). */
export function lastNDayKeys(days: number): string[] {
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    keys.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  }
  return keys;
}

export function formatShortDate(dayKey: string): string {
  return new Date(dayKey).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const DAY_RANGE_OPTIONS = [7, 14, 30, 90];
