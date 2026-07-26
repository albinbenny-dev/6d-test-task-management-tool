// The product mark for 6D Test & Task Management Tool — three list bars
// (task lists) with a completed-check badge (test results), replacing the
// old "∞" glyph inherited from qa-automation-suite-runner. Rendered white so
// it sits inside the existing blue gradient badge used across the banner,
// sidebar, and auth pages. The check badge is amber — the one deliberate
// accent pop against the otherwise all-blue "Ocean" palette.
export function AppMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="6" width="24" height="3" rx="1.5" fill="#fff" />
      <rect x="4" y="14.5" width="18" height="3" rx="1.5" fill="#fff" opacity="0.85" />
      <rect x="4" y="23" width="12" height="3" rx="1.5" fill="#fff" opacity="0.7" />
      <circle cx="25" cy="24.5" r="6.5" fill="#F59E0B" stroke="#fff" strokeWidth="1.6" />
      <path d="M22.2 24.6l1.8 1.8 3.6-4" stroke="#06222F" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
