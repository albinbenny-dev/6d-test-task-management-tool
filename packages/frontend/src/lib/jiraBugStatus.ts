// ── Shared "is this bug closed?" / "is this bug overdue?" logic for the
// per-cycle Bugs tab and the project-wide bug board. Deliberately checks the
// literal Jira status name rather than trusting Jira's statusCategory field —
// some workflows leave "Accepted"/"Cancelled" outside the standard "Done"
// category, which would otherwise leak into an "open" bucket. ─────────────

const CLOSED_STATUSES = new Set(['closed', 'accepted', 'cancelled']);

export function isBugClosed(issue: { status?: string | null } | null | undefined): boolean {
  return !!issue?.status && CLOSED_STATUSES.has(issue.status.toLowerCase());
}

export function isBugOverdue(issue: { status?: string | null; dueDate?: string | null } | null | undefined): boolean {
  if (!issue?.dueDate) return false;
  if (isBugClosed(issue)) return false;
  return new Date(issue.dueDate) < new Date();
}
