import type { LayoutPage, Primitive } from './types';
import { fontStack } from './text';

// Primitives → one SVG string. The same string drives the live preview
// (injected into the page) and the PNG export (rasterised through a canvas),
// so what you see is exactly what you download.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: number) => Math.round(v * 100) / 100;

function attrs(p: Primitive): string {
  return p.itemId ? ` data-item-id="${esc(p.itemId)}"` : '';
}

function prim(p: Primitive): string {
  switch (p.kind) {
    case 'rect':
      return `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}"${p.rx ? ` rx="${n(p.rx)}" ry="${n(p.rx)}"` : ''} fill="${p.fill ?? 'none'}"${p.stroke ? ` stroke="${p.stroke}" stroke-width="${p.strokeWidth ?? 1}"${p.dash ? ` stroke-dasharray="${p.dash.join(' ')}"` : ''}` : ''}${attrs(p)}/>`;
    case 'shape': {
      const stroke = p.stroke ? ` stroke="${p.stroke}" stroke-width="${p.strokeWidth ?? 1}"` : '';
      if (p.shape === 'ellipse') {
        return `<ellipse cx="${n(p.x + p.w / 2)}" cy="${n(p.y + p.h / 2)}" rx="${n(p.w / 2)}" ry="${n(p.h / 2)}" fill="${p.fill}"${stroke}${attrs(p)}/>`;
      }
      const pts = p.shape === 'diamond'
        ? [[p.x + p.w / 2, p.y], [p.x + p.w, p.y + p.h / 2], [p.x + p.w / 2, p.y + p.h], [p.x, p.y + p.h / 2]]
        : [[p.x + p.w / 2, p.y], [p.x + p.w, p.y + p.h], [p.x, p.y + p.h]];
      return `<polygon points="${pts.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')}" fill="${p.fill}"${stroke}${attrs(p)}/>`;
    }
    case 'poly':
      return `<polygon points="${p.points.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')}" fill="${p.fill}"${p.stroke ? ` stroke="${p.stroke}" stroke-width="${p.strokeWidth ?? 1}"` : ''}${attrs(p)}/>`;
    case 'line':
      return `<line x1="${n(p.x1)}" y1="${n(p.y1)}" x2="${n(p.x2)}" y2="${n(p.y2)}" stroke="${p.color}" stroke-width="${p.width}"${p.dash ? ` stroke-dasharray="${p.dash.join(' ')}"` : ''}${attrs(p)}/>`;
    case 'text': {
      if (!p.text) return '';
      const anchor = p.align === 'left' ? 'start' : p.align === 'right' ? 'end' : 'middle';
      const x = p.align === 'left' ? p.x : p.align === 'right' ? p.x + p.w : p.x + p.w / 2;
      const y = p.valign === 'top' ? p.y + p.size : p.y + p.h / 2;
      return `<text x="${n(x)}" y="${n(y)}"${p.valign === 'top' ? '' : ' dy="0.35em"'} font-size="${n(p.size)}" fill="${p.color}" text-anchor="${anchor}"${p.bold ? ' font-weight="700"' : ''}${p.italic ? ' font-style="italic"' : ''}${attrs(p)}>${esc(p.text)}</text>`;
    }
  }
}

export function pageToSvg(page: LayoutPage, fontFamily: string, opts: { responsive?: boolean } = {}): string {
  const size = opts.responsive
    ? 'width="100%" style="display:block;height:auto"'
    : `width="${page.width}" height="${page.height}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${page.width} ${page.height}" ${size} font-family="${esc(fontStack(fontFamily))}">${page.primitives.map(prim).join('')}</svg>`;
}
