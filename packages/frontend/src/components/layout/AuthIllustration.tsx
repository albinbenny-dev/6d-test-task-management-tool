import { AppMark } from '../ui/AppMark';

// Minimal-brand treatment for the auth pages' right panel — no illustration,
// just the mark, wordmark, and tagline on the Ocean gradient. Deliberately
// restrained rather than a custom graphic.
export function AuthIllustration() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
      <div
        style={{
          width: '76px', height: '76px', borderRadius: '20px',
          background: 'linear-gradient(135deg, #38BDF8, #0284C7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: '22px', boxShadow: '0 12px 30px rgba(2,132,199,0.45)',
        }}
      >
        <AppMark size={40} />
      </div>

      <div style={{ color: '#fff', fontSize: '19px', fontWeight: 800, letterSpacing: '-0.3px', lineHeight: 1.35, maxWidth: '260px' }}>
        6D Test &amp; Task Management Tool
      </div>

      <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: '11.5px', fontFamily: 'var(--font-mono)', marginTop: '10px', letterSpacing: '0.3px' }}>
        Smart Ideas, Delivered
      </div>
    </div>
  );
}
