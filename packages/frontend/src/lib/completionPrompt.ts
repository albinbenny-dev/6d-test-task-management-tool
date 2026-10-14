import { useSyncExternalStore } from 'react';

// "When was this completed?" prompt shown when a task is moved to Done (drag on the board, status picker, subtask tick…).
// The status hook awaits `askCompletionDate()`; <CompletionDateDialog /> (mounted once in main.tsx) renders the pending request.

interface Request { resolve: (date: string | null) => void }

let current: Request | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Resolves with the chosen YYYY-MM-DD, or null if the user cancelled. A second ask while one is open cancels the first. */
export function askCompletionDate(): Promise<string | null> {
  current?.resolve(null);
  return new Promise<string | null>((resolve) => {
    current = { resolve };
    emit();
  });
}

export function answerCompletionDate(date: string | null): void {
  const c = current;
  current = null;
  emit();
  c?.resolve(date);
}

export function useCompletionPromptOpen(): boolean {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => current !== null,
  );
}

/** Today's calendar date in the browser's time zone, YYYY-MM-DD. */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
