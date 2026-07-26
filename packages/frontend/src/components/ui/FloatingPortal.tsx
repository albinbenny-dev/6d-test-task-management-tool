import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

// ── Portal-based dropdown/popover positioning ───────────────────────────────
// Every custom dropdown in this app used to position its menu with
// `position: absolute` relative to its own trigger. That breaks the moment
// the trigger sits inside a scrollable card/list (`overflow: hidden` or
// `auto`) near the bottom or right edge — the menu gets visually clipped by
// the ancestor instead of floating on top of the page. This component
// renders the menu into a portal at `document.body` with `position: fixed`,
// computed from the trigger's real screen position, so it's never clipped by
// an ancestor's overflow — the only remaining bound is the viewport itself,
// which this also flips/clamps against.
//
// Two-phase positioning: phase 1 mounts the menu at a rough guess (hidden)
// so it can be measured; phase 2 reads its real rendered size and picks a
// final position (flipping above the trigger if there's not enough room
// below), then reveals it. This avoids needing to know the menu's height
// up front. A visibility toggle (not a delayed mount) keeps this within one
// paint, so there's no visible flicker.
export function FloatingPortal({ anchorRef, open, align = 'start', width, children, portalRef }: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  align?: 'start' | 'end'; // which edge of the trigger the menu's edge lines up with
  width?: number; // fixed menu width; omit to let content size it (min-width still applies via children's own style)
  children: ReactNode;
  portalRef?: RefObject<HTMLDivElement>;
}) {
  const [pos, setPos] = useState<{ top: number; left: number; ready: boolean } | null>(null);
  const localRef = useRef<HTMLDivElement>(null);
  const menuRef = portalRef ?? localRef;

  // Phase 1 — rough guess so the menu mounts and becomes measurable.
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({ top: rect.bottom + 4, left: align === 'end' ? rect.right : rect.left, ready: false });
    // Only re-guess when the menu opens — phase 2 + the scroll/resize effect
    // below take over from here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function computeFinal() {
    if (!anchorRef.current || !menuRef.current) return null;
    const rect = anchorRef.current.getBoundingClientRect();
    const menuRect = menuRef.current.getBoundingClientRect();
    const gap = 4;
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const spaceBelow = vh - rect.bottom - gap;
    const spaceAbove = rect.top - gap;
    const openUp = menuRect.height > spaceBelow && spaceAbove > spaceBelow;
    let top = openUp ? rect.top - menuRect.height - gap : rect.bottom + gap;
    top = Math.max(4, Math.min(top, vh - menuRect.height - 4));
    let left = align === 'end' ? rect.right - menuRect.width : rect.left;
    left = Math.max(4, Math.min(left, vw - menuRect.width - 4));
    return { top, left };
  }

  // Phase 2 — measure the mounted (hidden) menu and reveal it in place.
  useLayoutEffect(() => {
    if (!open || !pos || pos.ready) return;
    const final = computeFinal();
    if (final) setPos({ ...final, ready: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pos]);

  // Keep it correctly placed if the page scrolls or resizes while open.
  useLayoutEffect(() => {
    if (!open) return;
    function reposition() {
      const final = computeFinal();
      if (final) setPos((prev) => (prev ? { ...final, ready: true } : prev));
    }
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || !pos) return null;

  return createPortal(
    <div
      ref={menuRef}
      style={{
        position: 'fixed', top: pos.top, left: pos.left,
        width, zIndex: 2000,
        visibility: pos.ready ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
