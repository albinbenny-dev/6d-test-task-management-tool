import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

// Icon-prefixed input wrapper for the auth pages — icon sits inline at the
// left edge of the field instead of a separate label-above layout.
export function IconField({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <Icon size={15} style={{ position: 'absolute', left: '12px', color: 'var(--text-dim)', pointerEvents: 'none' }} />
      {children}
    </div>
  );
}
