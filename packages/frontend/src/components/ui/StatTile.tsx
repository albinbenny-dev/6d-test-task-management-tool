export default function StatTile({
  label,
  value,
  suffix = '',
  accent,
}: {
  label: string;
  value: number | string;
  suffix?: string;
  accent: string;
}) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        position: 'relative',
        overflow: 'hidden',
        boxShadow: 'var(--shadow-card)',
        flex: 1,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: accent,
          borderRadius: '10px 10px 0 0',
        }}
      />
      <div
        style={{
          fontSize: 28,
          fontWeight: 800,
          color: 'var(--6d-orange)',
          lineHeight: 1,
          marginTop: 4,
        }}
      >
        {value}
        {suffix}
      </div>
      <div
        style={{
          fontSize: 10,
          color: 'var(--text-dim)',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
          marginTop: 3,
        }}
      >
        {label}
      </div>
    </div>
  );
}
