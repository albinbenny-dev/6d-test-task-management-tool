import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { answerCompletionDate, localToday, useCompletionPromptOpen } from '../../lib/completionPrompt';

// Mounted once (main.tsx). Appears whenever a task is moved to Done; Enter / "Mark done" confirms the chosen day (default: today).
export function CompletionDateDialog() {
  const open = useCompletionPromptOpen();
  const [date, setDate] = useState(localToday());
  useEffect(() => { if (open) setDate(localToday()); }, [open]);

  const today = localToday();
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today;

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) answerCompletionDate(null); }}>
      <Dialog.Portal>
        <Dialog.Overlay style={{ position: 'fixed', inset: 0, background: 'rgba(6,34,74,0.55)', zIndex: 9998 }} />
        <Dialog.Content
          style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 9999,
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
            padding: '22px 24px', width: 340, maxWidth: '94vw', fontFamily: 'var(--font-ui)',
          }}
        >
          <Dialog.Title style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>Mark as done</Dialog.Title>
          <Dialog.Description style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 14 }}>
            When was it completed? This becomes the task&rsquo;s actual end date.
          </Dialog.Description>
          <input
            type="date" className="input-field" autoFocus value={date} max={today}
            onChange={(e) => setDate(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && valid) answerCompletionDate(date); }}
            style={{ width: '100%', boxSizing: 'border-box' }}
          />
          {!valid && date && <p style={{ fontSize: 11, color: 'var(--fail)', marginTop: 6 }}>Pick a date that is not in the future.</p>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
            <button type="button" className="tb-btn tb-btn-ghost" onClick={() => answerCompletionDate(null)}>Cancel</button>
            <button
              type="button" disabled={!valid} onClick={() => answerCompletionDate(date)}
              style={{
                padding: '7px 16px', background: 'linear-gradient(135deg, #F47B20, #D9601A)', border: 'none', borderRadius: 6,
                color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: valid ? 'pointer' : 'not-allowed', opacity: valid ? 1 : 0.6,
              }}
            >Mark done</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
