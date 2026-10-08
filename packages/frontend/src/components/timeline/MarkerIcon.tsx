import type { ItemType } from '../../lib/timeline/types';

// Tiny glyphs for the Type column / marker picker — the same shapes the
// renderer draws, at icon size.
export function MarkerIcon({ type, marker, color, size = 16 }: { type: ItemType; marker: string; color: string; size?: number }) {
  const s = size;
  const c = s / 2;
  if (type === 'TASK') {
    if (marker === 'chevron') {
      return <svg width={s + 4} height={s} viewBox={`0 0 ${s + 4} ${s}`}><polygon points={`0,2 ${s - 2},2 ${s + 4},${c} ${s - 2},${s - 2} 0,${s - 2}`} fill={color} /></svg>;
    }
    const rx = marker === 'bar' ? 1 : s / 3;
    return <svg width={s + 4} height={s} viewBox={`0 0 ${s + 4} ${s}`}><rect x="0" y={c - 4} width={s + 4} height="8" rx={rx} fill={color} /></svg>;
  }
  switch (marker) {
    case 'flag':
      return <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}><line x1="4" y1="1" x2="4" y2={s - 1} stroke={color} strokeWidth="1.8" /><polygon points={`4,1 ${s - 1},${s * 0.3} 4,${s * 0.6}`} fill={color} /></svg>;
    case 'star': {
      const pts = Array.from({ length: 10 }, (_, i) => {
        const r = i % 2 === 0 ? c - 1 : (c - 1) * 0.42;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        return `${c + r * Math.cos(a)},${c + r * Math.sin(a)}`;
      }).join(' ');
      return <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}><polygon points={pts} fill={color} /></svg>;
    }
    case 'circle':
      return <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}><circle cx={c} cy={c} r={c - 1.5} fill={color} /></svg>;
    case 'triangle':
      return <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}><polygon points={`${c},1.5 ${s - 1.5},${s - 1.5} 1.5,${s - 1.5}`} fill={color} /></svg>;
    default:
      return <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}><polygon points={`${c},1 ${s - 1},${c} ${c},${s - 1} 1,${c}`} fill={color} /></svg>;
  }
}
