import type { Task, TaskStatus, TaskPriority } from '../types';

export const ALL_TASK_STATUSES: TaskStatus[] = ['TO_DO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  TO_DO: 'To Do',
  IN_PROGRESS: 'In Progress',
  IN_REVIEW: 'In Review',
  DONE: 'Done',
};

export const STATUS_DOT_COLOR: Record<TaskStatus, string> = {
  TO_DO: 'var(--text-dim)',
  IN_PROGRESS: 'var(--run)',
  IN_REVIEW: '#8b5cf6',
  DONE: 'var(--pass)',
};

export const ALL_PRIORITIES: TaskPriority[] = ['URGENT', 'HIGH', 'NORMAL', 'LOW'];

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  LOW: 'Low',
  NORMAL: 'Normal',
  HIGH: 'High',
  URGENT: 'Urgent',
};

export const PRIORITY_ACCENT: Record<TaskPriority, string> = {
  LOW: 'var(--text-dim)',
  NORMAL: 'var(--cyan)',
  HIGH: 'var(--amber)',
  URGENT: 'var(--rose)',
};

/** A task is overdue when it has a due date in the past and isn't DONE yet — never stored, always derived. */
export function isTaskOverdue(task: Pick<Task, 'dueDate' | 'status'>): boolean {
  if (!task.dueDate || task.status === 'DONE') return false;
  return new Date(task.dueDate).getTime() < Date.now();
}

/** Shared row/card status indicator color — overdue always wins (red), otherwise the status dot color. Used to draw the same colored dot in both List and Board views so the two read as one visual language. */
export function taskDotColor(task: Pick<Task, 'dueDate' | 'status'>): string {
  return isTaskOverdue(task) ? 'var(--fail)' : STATUS_DOT_COLOR[task.status];
}

// Same 4-bucket shape as DefectsDashboard's dueBucket — so "overdue"/"due
// this week" read identically across the app.
export const TASK_DUE_BUCKETS = ['Overdue', 'Due this week', 'Later', 'No due date'] as const;
export type TaskDueBucket = typeof TASK_DUE_BUCKETS[number];

export function taskDueBucket(task: Pick<Task, 'dueDate' | 'status'>): TaskDueBucket {
  if (!task.dueDate) return 'No due date';
  if (isTaskOverdue(task)) return 'Overdue';
  const due = new Date(task.dueDate);
  const in7Days = new Date(Date.now() + 7 * 86_400_000);
  return due <= in7Days ? 'Due this week' : 'Later';
}

export function parseTags(tags: string): string[] {
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function formatDueDate(date: string | null | undefined): string {
  if (!date) return '';
  const d = new Date(date);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' });
}

/** Builds the flat task list into a top-level array with `.subtasks` nested under each parent. */
export function nestSubtasks(tasks: Task[]): Task[] {
  const byId = new Map(tasks.map((t) => [t.id, { ...t, subtasks: [] as Task[] }]));
  const roots: Task[] = [];
  for (const task of byId.values()) {
    if (task.parentTaskId && byId.has(task.parentTaskId)) {
      byId.get(task.parentTaskId)!.subtasks.push(task);
    } else {
      roots.push(task);
    }
  }
  return roots;
}
