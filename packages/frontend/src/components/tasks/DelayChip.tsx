// Schedule variance chip: "+5d" (red) = working days late, "−2d" (green) = finished early. Shows nothing for "on the day" / no verdict
// unless `showZero` is set. Variance = actual end vs planned end (finished) or days past the planned end (still open); a parent shows its worst subtask.
export function formatDelay(days: number): string {
  return `${days > 0 ? '+' : days < 0 ? '−' : ''}${Math.abs(days)}d`;
}

export function delayTitle(days: number | null | undefined, status?: string): string {
  if (days === null || days === undefined) return 'No schedule verdict yet';
  const n = Math.abs(days);
  const wd = `${n} working day${n === 1 ? '' : 's'}`;
  if (days > 0) return status === 'DONE' ? `Finished ${wd} after the planned end` : `${wd} past the planned end and still open`;
  if (days < 0) return `Finished ${wd} before the planned end`;
  return 'Finished on the planned day';
}

export function DelayChip({ days, status, showZero, compact }: { days: number | null | undefined; status?: string; showZero?: boolean; compact?: boolean }) {
  if (days === null || days === undefined) return null;
  if (days === 0 && !showZero) return null;
  const late = days > 0; const early = days < 0;
  const fg = late ? 'var(--fail)' : early ? 'var(--pass)' : 'var(--text-dim)';
  const bg = late ? 'rgba(220,38,38,0.12)' : early ? 'rgba(16,185,129,0.14)' : 'var(--surface2)';
  return (
    <span
      title={delayTitle(days, status)}
      style={{
        display: 'inline-block', fontFamily: 'var(--font-mono)', fontWeight: 700, whiteSpace: 'nowrap', color: fg, background: bg,
        fontSize: compact ? 10 : 10.5, lineHeight: 1, padding: compact ? '2px 5px' : '3px 6px', borderRadius: 10,
      }}
    >{formatDelay(days)}</span>
  );
}
