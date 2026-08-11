import type { ReactNode } from 'react';
import { AppMark } from '../ui/AppMark';
import { AuthIllustration } from './AuthIllustration';

export function AuthLayout({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div
      style={{
        minHeight: 'calc(100vh / var(--app-zoom))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-ui)',
        background: 'linear-gradient(135deg, #E7F3F1 0%, #F3F8F7 55%, #EEF0FB 100%)',
        padding: '32px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '960px',
          minHeight: '580px',
          background: 'var(--surface)',
          borderRadius: '24px',
          boxShadow: '0 30px 80px rgba(9,30,27,0.16)',
          display: 'flex',
          overflow: 'hidden',
        }}
      >
        {/* ── Left — auth form ─────────────────────────────────────────── */}
        <div style={{ flex: '0 0 46%', padding: '44px 44px', display: 'flex', flexDirection: 'column' }}>
          {/* Compact brand row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '36px' }}>
            <div
              style={{
                width: '34px', height: '34px', borderRadius: '10px',
                background: 'linear-gradient(135deg, #38BDF8, #0284C7)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}
            >
              <AppMark size={18} />
            </div>
            <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text)' }}>6D Technologies</span>
            <span style={{ width: '1px', height: '14px', background: 'var(--border2)' }} />
            <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Test &amp; Task Management</span>
          </div>

          <div className="page-eyebrow">{eyebrow}</div>
          <h1 style={{ fontSize: '26px', fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.4px', marginTop: '4px', marginBottom: '8px' }}>
            {title}
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--text-mid)', marginBottom: '20px' }}>{subtitle}</p>

          <div style={{ height: '1px', background: 'var(--border)', marginBottom: '24px' }} />

          {children}

          <div style={{ marginTop: '22px', textAlign: 'left', fontSize: '12px', color: 'var(--text-dim)' }}>
            {footer}
          </div>
        </div>

        {/* ── Right — minimal brand panel ──────────────────────────────── */}
        <div
          style={{
            flex: 1,
            background: 'var(--6d-banner)',
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              position: 'absolute', inset: 0,
              backgroundImage: 'radial-gradient(rgba(255,255,255,0.08) 1px, transparent 1px)',
              backgroundSize: '20px 20px',
              pointerEvents: 'none',
            }}
          />

          <div style={{ position: 'relative' }}>
            <AuthIllustration />
          </div>
        </div>
      </div>
    </div>
  );
}
