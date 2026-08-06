// ── Shared gradient "hero tile" stat card + a single-ring "JIRA" resolution
// card. Originated on the Test Cycle pages (TestCycleDetail.tsx,
// TestCyclesDashboard.tsx) but the `StatCard` component itself is generic —
// also reused by TestCaseLibrary.tsx's TC Library stat row.

import { ClipboardList, CheckCircle2, XCircle, Clock, Ban, CircleDashed, Bug, TrendingUp, Target, Unlink, Eye } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

// Gradient stops are hardcoded hex (not theme CSS vars) — these tiles are
// meant to stay vividly colored regardless of the app's light/dark mode,
// like a badge of status rather than themed chrome. `accent` IS a theme
// var, and is used for the icon/value/border in the inactive (unselected
// filter) state, so that state still respects light/dark mode correctly.
const THEME = {
  total:    { from: '#1e3a8a', to: '#2563eb', accent: 'var(--text)',     Icon: ClipboardList },
  pass:     { from: '#0f766e', to: '#2dd4bf', accent: 'var(--pass)',     Icon: CheckCircle2 },
  fail:     { from: '#7f1d1d', to: '#ef4444', accent: 'var(--fail)',     Icon: XCircle },
  progress: { from: '#1e40af', to: '#3b82f6', accent: 'var(--run)',      Icon: Clock },
  blocked:  { from: '#92400e', to: '#f59e0b', accent: 'var(--amber)',    Icon: Ban },
  untested: { from: '#334155', to: '#64748b', accent: 'var(--text-dim)', Icon: CircleDashed },
  passRate: { from: '#3730a3', to: '#6366f1', accent: 'var(--cyan)',     Icon: TrendingUp },
  jira:     { from: '#9a3412', to: '#ea580c', accent: 'var(--6d-orange)', Icon: Bug },
  inScope:  { from: '#0e7490', to: '#22d3ee', accent: 'var(--cyan)',     Icon: Target },
  unlinked: { from: '#b45309', to: '#f59e0b', accent: 'var(--amber)',    Icon: Unlink },
  // Matches the #8b5cf6 dot already used for Task.status IN_REVIEW in lib/taskMeta.ts.
  review:   { from: '#4c1d95', to: '#8b5cf6', accent: '#8b5cf6',         Icon: Eye },
} satisfies Record<string, { from: string; to: string; accent: string; Icon: LucideIcon }>;

export type StatTheme = keyof typeof THEME;

// Purely decorative squiggle at the tile's foot, echoing a sparkline without
// claiming to plot real history — there's no per-card trend data to back one.
function TileWave({ height }: { height: number }) {
  return (
    <svg
      viewBox="0 0 120 30"
      preserveAspectRatio="none"
      style={{ position: 'absolute', left: 0, bottom: 0, width: '100%', height, opacity: 0.3, pointerEvents: 'none' }}
    >
      <path d="M0 20 Q 15 6, 30 18 T 60 14 T 90 20 T 120 10" fill="none" stroke="#fff" strokeWidth="2" />
    </svg>
  );
}

export function StatCard({ label, value, sub, theme, highlighted, compact, onClick, selected }: {
  label: string;
  value: string | number;
  /** Optional second line under the label, e.g. "47% of in-scope". Hidden in the inactive (outline) toggle state to keep that state compact. */
  sub?: string;
  theme: StatTheme;
  highlighted?: boolean;
  compact?: boolean;
  /** Makes the card a toggleable filter button instead of a static tile. */
  onClick?: () => void;
  selected?: boolean;
}) {
  const t = THEME[theme];
  const isToggle = !!onClick;
  // Static (non-toggle) tiles always show the vivid gradient. Toggle tiles
  // dim to an outline when they're not the active filter, so the current
  // filter reads clearly at a glance.
  const isActive = isToggle ? (selected ?? highlighted ?? false) : true;

  return (
    <div
      className={`stat-tile${isToggle ? ' stat-tile--clickable' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: isActive ? `linear-gradient(135deg, ${t.from} 0%, ${t.to} 100%)` : 'var(--surface)',
        border: isActive ? 'none' : `1.5px solid ${t.accent}`,
        borderRadius: compact ? 12 : 16,
        padding: compact ? '12px 14px' : '18px 20px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        gap: 2,
        minWidth: compact ? 96 : 130,
        height: '100%',
        minHeight: compact ? 92 : 128,
        boxSizing: 'border-box',
        cursor: onClick ? 'pointer' : undefined,
        userSelect: onClick ? 'none' : undefined,
      }}
    >
      <div
        style={{
          width: compact ? 24 : 30,
          height: compact ? 24 : 30,
          borderRadius: '50%',
          background: isActive ? 'rgba(255,255,255,0.22)' : 'var(--surface2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: compact ? 6 : 10,
        }}
      >
        <t.Icon size={compact ? 13 : 16} color={isActive ? '#fff' : t.accent} strokeWidth={2.25} />
      </div>
      <div style={{ fontSize: compact ? 20 : 28, fontWeight: 800, lineHeight: 1, color: isActive ? '#fff' : t.accent }}>{value}</div>
      <div
        style={{
          fontSize: compact ? 9.5 : 11,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: isActive ? 'rgba(255,255,255,0.85)' : 'var(--text-dim)',
        }}
      >
        {label}
      </div>
      {sub && isActive && (
        <div style={{ fontSize: compact ? 9 : 10, color: 'rgba(255,255,255,0.7)', marginTop: 1 }}>{sub}</div>
      )}
      {isActive && <TileWave height={compact ? 18 : 24} />}
    </div>
  );
}

// Ring is now purely decorative (the Bug icon sits in its center, showing %
// resolved via fill proportion) — it used to also render "{value}/{max}" as
// SVG text inside the same small circle, which clipped badly for anything
// past 2 digits each side (e.g. "176/181" rendered as "76/18"). The actual
// counts are now plain HTML text in the card body below, same as every
// other StatCard, so they're never constrained by the ring's diameter.
function Ring({ pct, size, trackColor, ringColor, children }: {
  pct: number;
  size: number;
  trackColor: string;
  ringColor: string;
  children?: ReactNode;
}) {
  const stroke = size <= 40 ? 4 : 5;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - pct);
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={trackColor} strokeWidth={stroke} />
        {pct > 0 && (
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" stroke={ringColor} strokeWidth={stroke}
            strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {children}
      </div>
    </div>
  );
}

export function JiraRingCard({ tickets, compact, onClick }: {
  tickets: { resolved: number; total: number };
  compact?: boolean;
  /** Makes the card clickable, e.g. jump straight to the Bugs tab/board. */
  onClick?: () => void;
}) {
  const t = THEME.jira;
  const pct = tickets.total > 0 ? Math.min(tickets.resolved / tickets.total, 1) : 0;
  const pctLabel = Math.round(pct * 100);
  return (
    <div
      className={`stat-tile${onClick ? ' stat-tile--clickable' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      title={onClick ? `Tickets: ${tickets.resolved}/${tickets.total} resolved — view bugs` : `Tickets: ${tickets.resolved}/${tickets.total} resolved`}
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: `linear-gradient(135deg, ${t.from} 0%, ${t.to} 100%)`,
        borderRadius: compact ? 12 : 16,
        padding: compact ? '12px 14px' : '18px 20px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        gap: 2,
        minWidth: compact ? 96 : 130,
        height: '100%',
        minHeight: compact ? 92 : 128,
        boxSizing: 'border-box',
        cursor: onClick ? 'pointer' : undefined,
        userSelect: onClick ? 'none' : undefined,
      }}
    >
      <Ring
        pct={pct}
        size={compact ? 24 : 30}
        trackColor="rgba(255,255,255,0.28)"
        ringColor="#fff"
      >
        <Bug size={compact ? 12 : 15} color="#fff" strokeWidth={2.25} />
      </Ring>
      <div style={{ fontSize: compact ? 20 : 28, fontWeight: 800, lineHeight: 1, color: '#fff', marginTop: compact ? 6 : 10 }}>
        {tickets.resolved}<span style={{ opacity: 0.65, fontWeight: 600 }}>/{tickets.total}</span>
      </div>
      <div style={{ fontSize: compact ? 9.5 : 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.85)' }}>
        Jira
      </div>
      <div style={{ fontSize: compact ? 9 : 10, color: 'rgba(255,255,255,0.7)', marginTop: 1 }}>{pctLabel}% resolved</div>
      <TileWave height={compact ? 18 : 24} />
    </div>
  );
}
