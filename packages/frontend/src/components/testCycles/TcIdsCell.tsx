import { useRef, useState } from 'react';
import { useClickOutside } from '../../hooks/useClickOutside';
import { FloatingPortal } from '../ui/FloatingPortal';
import type { LinkedTestCaseExecution } from '../../types';

export type LinkedTc = LinkedTestCaseExecution;

function tcLabel(tc: LinkedTc): string {
  return tc.srNo || tc.id;
}

// ── TC_ID(s) linked to a bug — shows the actual ID(s) rather than just a
// count; a native `title` tooltip isn't discoverable/reliable enough for
// more than one, so 2+ opens a click-to-open popover listing every one
// (same pattern as ReasonPopover/JiraKeysCell). When `onViewTestCase` is
// given, every TC_ID becomes a link that opens the full test case modal
// (the caller owns rendering that modal, same as the "👁" action elsewhere). ─

export function TcIdsCell({ testCases, onViewTestCase }: { testCases: LinkedTc[]; onViewTestCase?: (tc: LinkedTc) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside([rootRef, menuRef], () => setIsOpen(false), isOpen);

  if (testCases.length === 0) {
    return <span style={{ fontSize: '11px', color: 'var(--text-dim)', fontStyle: 'italic' }}>0</span>;
  }

  const linkStyle = {
    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
    fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--cyan)',
    textDecoration: 'underline', textUnderlineOffset: '2px',
  } as const;

  if (testCases.length === 1) {
    const tc = testCases[0];
    return onViewTestCase ? (
      <button type="button" onClick={() => onViewTestCase(tc)} title={tc.title ? `View ${tc.title}` : 'View test case'} style={linkStyle}>
        {tcLabel(tc)}
      </button>
    ) : (
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text)' }} title={tc.title}>
        {tcLabel(tc)}
      </span>
    );
  }

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        title="View all linked test cases"
        style={linkStyle}
      >
        {tcLabel(testCases[0])} +{testCases.length - 1}
      </button>

      <FloatingPortal anchorRef={rootRef} open={isOpen} align="end" portalRef={menuRef} width={240}>
        <div
          style={{
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-card)', padding: '8px 10px', maxHeight: '240px', overflowY: 'auto',
            boxSizing: 'border-box', textAlign: 'left',
          }}
        >
          <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px' }}>
            {testCases.length} linked test cases
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            {testCases.map((tc) => (
              <div key={tc.id} style={{ fontSize: '11px', color: 'var(--text)', overflowWrap: 'anywhere' }}>
                {onViewTestCase ? (
                  <button
                    type="button"
                    onClick={() => { setIsOpen(false); onViewTestCase(tc); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'var(--font-mono)', color: 'var(--cyan)', fontWeight: 700, textDecoration: 'underline', textUnderlineOffset: '2px' }}
                  >
                    {tcLabel(tc)}
                  </button>
                ) : (
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--cyan)', fontWeight: 700 }}>{tcLabel(tc)}</span>
                )}
                {tc.title && <span style={{ color: 'var(--text-mid)' }}> — {tc.title}</span>}
              </div>
            ))}
          </div>
        </div>
      </FloatingPortal>
    </div>
  );
}
