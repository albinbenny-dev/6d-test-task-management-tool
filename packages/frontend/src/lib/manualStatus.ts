import type { ManualResultStatus } from '../types';

// ── Shared manual-result-status presentation — one source of truth so
// TestCycleDetail.tsx, TestCyclesDashboard.tsx, and Assignments.tsx all
// color/badge NOT_RUN/IN_PROGRESS/PASS/FAIL/BLOCKED identically. ──────────

export const STATUS_COLOR: Record<ManualResultStatus, string> = {
  NOT_RUN:     'var(--text-dim)',
  IN_PROGRESS: 'var(--run)',
  PASS:        'var(--pass)',
  FAIL:        'var(--fail)',
  BLOCKED:     'var(--amber)',
};

export const STATUS_BADGE: Record<ManualResultStatus, string> = {
  NOT_RUN:     'badge-draft',
  IN_PROGRESS: 'badge-run',
  PASS:        'badge-pass',
  FAIL:        'badge-fail',
  BLOCKED:     'badge-blocked',
};

// Same rgba values as the .badge-* classes in globals.css, exposed as inline
// styles for status <select> elements that need to look like a colored pill
// themselves (no separate badge alongside them) — see FeatureItemRow's status
// cell in TestCycleDetail.tsx.
export const STATUS_PILL_STYLE: Record<ManualResultStatus, { background: string; color: string; borderColor: string }> = {
  NOT_RUN:     { background: 'rgba(148,163,184,0.08)', color: 'var(--text-mid)', borderColor: 'rgba(148,163,184,0.3)' },
  IN_PROGRESS: { background: 'rgba(37,99,171,0.08)',    color: 'var(--run)',     borderColor: 'rgba(37,99,171,0.35)' },
  PASS:        { background: 'rgba(42,157,143,0.08)',   color: 'var(--pass)',   borderColor: 'rgba(42,157,143,0.35)' },
  FAIL:        { background: 'rgba(220,38,38,0.08)',    color: 'var(--fail)',   borderColor: 'rgba(220,38,38,0.35)' },
  BLOCKED:     { background: 'rgba(244,123,32,0.08)',   color: 'var(--amber)',  borderColor: 'rgba(244,123,32,0.35)' },
};

export const STATUS_LABEL: Record<ManualResultStatus, string> = {
  NOT_RUN:     'Not Run',
  IN_PROGRESS: 'In Progress',
  PASS:        'Pass',
  FAIL:        'Fail',
  BLOCKED:     'Blocked',
};

export const ALL_MANUAL_STATUSES: ManualResultStatus[] = ['NOT_RUN', 'IN_PROGRESS', 'PASS', 'FAIL', 'BLOCKED'];

export function emptyStatusCounts(): Record<ManualResultStatus, number> {
  return { NOT_RUN: 0, IN_PROGRESS: 0, PASS: 0, FAIL: 0, BLOCKED: 0 };
}
