// Text measuring for layout. In the browser we measure with a real canvas
// context in the template's font (so truncation and label packing match what
// the SVG draws); anywhere without a DOM (tests) it falls back to an average
// glyph-width estimate. PowerPoint renders with its own font metrics, so
// exported text boxes are given a little slack (see export/pptx.ts).

const cache = new Map<string, number>();
let ctx: CanvasRenderingContext2D | null | undefined;

function getCtx(): CanvasRenderingContext2D | null {
  if (ctx !== undefined) return ctx;
  try {
    ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  } catch {
    ctx = null;
  }
  return ctx;
}

export function fontStack(family: string): string {
  return `${family}, Calibri, Arial, sans-serif`;
}

export function measureText(text: string, size: number, family: string, bold = false): number {
  if (!text) return 0;
  const key = `${family}|${size}|${bold ? 1 : 0}|${text}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let w: number;
  const c = getCtx();
  if (c) {
    c.font = `${bold ? 'bold ' : ''}${size}px ${fontStack(family)}`;
    w = c.measureText(text).width;
  } else {
    w = text.length * size * (bold ? 0.56 : 0.52);
  }
  if (cache.size > 5000) cache.clear();
  cache.set(key, w);
  return w;
}

/** Truncate with an ellipsis so the result fits `maxWidth`. */
export function fitText(text: string, maxWidth: number, size: number, family: string, bold = false): string {
  if (maxWidth <= 0) return '';
  if (measureText(text, size, family, bold) <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measureText(text.slice(0, mid) + '…', size, family, bold) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo <= 0 ? '' : text.slice(0, lo).trimEnd() + '…';
}
