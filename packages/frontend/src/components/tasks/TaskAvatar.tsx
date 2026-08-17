import { getInitials, PROJECT_GRADIENTS } from '../../lib/utils';

// Deterministic gradient per user (hash of id), not random — so the same
// person's avatar looks the same everywhere it's rendered on the page.
function gradientFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return PROJECT_GRADIENTS[hash % PROJECT_GRADIENTS.length];
}

export function TaskAvatar({
  name,
  userId,
  size = 24,
  title,
  external,
}: {
  name: string;
  userId: string;
  size?: number;
  title?: string;
  /** Renders a dashed ring instead of a solid one — flags an assignee who isn't a registered project member. */
  external?: boolean;
}) {
  return (
    <div
      className="tm-avatar"
      title={title ?? (external ? `External: ${name}` : name)}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, size * 0.4),
        background: gradientFor(userId),
        ...(external ? { border: '1.5px dashed var(--text-dim)', boxSizing: 'border-box' as const } : {}),
      }}
    >
      {getInitials(name)}
    </div>
  );
}

export function UnassignedAvatar({ size = 24 }: { size?: number }) {
  return (
    <div className="tm-avatar-empty" title="Unassigned" style={{ width: size, height: size, fontSize: size * 0.5 }}>
      ?
    </div>
  );
}
