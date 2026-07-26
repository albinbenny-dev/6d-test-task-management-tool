import { useEffect, type RefObject } from 'react';

// Shared "close this popover/dropdown when clicking elsewhere" behavior —
// used by StatusPillPicker and ReasonPopover so both dismiss consistently.
//
// Accepts one ref or an array of refs — a click only counts as "outside"
// when it lands outside ALL of them. Portal-based menus (see FloatingPortal)
// render their content into document.body, detached from the trigger's own
// DOM subtree, so a single "does the trigger contain this click" check would
// wrongly treat every click inside the (portaled) menu itself as an outside
// click and close it before the item's own onClick ever fires.
export function useClickOutside(
  ref: RefObject<HTMLElement | null> | Array<RefObject<HTMLElement | null>>,
  onOutsideClick: () => void,
  active: boolean,
) {
  useEffect(() => {
    if (!active) return;
    const refs = Array.isArray(ref) ? ref : [ref];
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      const isInside = refs.some((r) => r.current && r.current.contains(target));
      if (!isInside) onOutsideClick();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [active, onOutsideClick, ...(Array.isArray(ref) ? ref : [ref])]);
}
