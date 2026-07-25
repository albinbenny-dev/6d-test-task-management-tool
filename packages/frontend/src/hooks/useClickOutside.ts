import { useEffect, type RefObject } from 'react';

// Shared "close this popover/dropdown when clicking elsewhere" behavior —
// used by StatusPillPicker and ReasonPopover so both dismiss consistently.
export function useClickOutside(ref: RefObject<HTMLElement | null>, onOutsideClick: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutsideClick();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [active, ref, onOutsideClick]);
}
