import type { LayoutPage, Primitive, TemplateConfig } from './types';
import { pageToSvg } from './svg';

// ── Timeline Builder — exports ──────────────────────────────────────────────
// Both exports consume the layout engine's primitives, so what is downloaded
// is exactly what the live preview shows. PNG rasterises the SVG; PPTX maps
// every primitive to a native, editable PowerPoint object (no pictures).

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function safeFileName(name: string): string {
  return (name.replace(/[^a-z0-9-_ ]/gi, '').trim().replace(/\s+/g, '-') || 'timeline').slice(0, 80);
}

export function exportSvg(page: LayoutPage, config: TemplateConfig, name: string) {
  download(new Blob([pageToSvg(page, config.font.family)], { type: 'image/svg+xml' }), `${safeFileName(name)}.svg`);
}

/** Renders one page to a PNG at `scale`× the slide's point size (2 → 1920×1080 for 16:9). */
export async function exportPng(page: LayoutPage, config: TemplateConfig, name: string, scale = 2): Promise<void> {
  const svg = pageToSvg(page, config.font.family);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    img.decoding = 'sync';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not render the timeline image'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(page.width * scale);
    canvas.height = Math.round(page.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available in this browser');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Could not encode the PNG');
    download(blob, `${safeFileName(name)}.png`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const hex6 = (c: string) => c.replace('#', '').toUpperCase();
const inch = (pt: number) => pt / 72;

type PptxLike = {
  ShapeType: Record<string, string>;
  addSlide: () => SlideLike;
  defineLayout: (l: { name: string; width: number; height: number }) => void;
  layout: string;
  writeFile: (o: { fileName: string }) => Promise<string>;
  title: string;
  author: string;
};
type SlideLike = {
  background: { color: string };
  addShape: (type: string, opts: Record<string, unknown>) => void;
  addText: (text: string, opts: Record<string, unknown>) => void;
};

function addPrimitive(slide: SlideLike, pptx: PptxLike, p: Primitive, fontFace: string) {
  const T = pptx.ShapeType;
  switch (p.kind) {
    case 'rect': {
      if (p.fill === undefined && !p.stroke) return;
      const radius = p.rx && p.rx > 0 ? Math.min(p.rx, p.w / 2, p.h / 2) : 0;
      slide.addShape(radius > 0 ? T.roundRect : T.rect, {
        x: inch(p.x), y: inch(p.y), w: inch(p.w), h: inch(p.h),
        ...(radius > 0 ? { rectRadius: inch(radius) } : {}),
        fill: p.fill ? { color: hex6(p.fill) } : { type: 'none' },
        line: p.stroke ? { color: hex6(p.stroke), width: p.strokeWidth ?? 1, ...(p.dash ? { dashType: 'sysDot' } : {}) } : { type: 'none' },
      });
      return;
    }
    case 'shape': {
      const type = p.shape === 'ellipse' ? T.ellipse : p.shape === 'diamond' ? T.diamond : T.triangle;
      slide.addShape(type, {
        x: inch(p.x), y: inch(p.y), w: inch(p.w), h: inch(p.h),
        fill: { color: hex6(p.fill) },
        line: p.stroke ? { color: hex6(p.stroke), width: p.strokeWidth ?? 1 } : { type: 'none' },
      });
      return;
    }
    case 'poly': {
      const xs = p.points.map((q) => q[0]);
      const ys = p.points.map((q) => q[1]);
      const minX = Math.min(...xs); const minY = Math.min(...ys);
      const w = Math.max(...xs) - minX; const h = Math.max(...ys) - minY;
      if (w <= 0 || h <= 0) return;
      slide.addShape(T.custGeom, {
        x: inch(minX), y: inch(minY), w: inch(w), h: inch(h),
        fill: { color: hex6(p.fill) },
        line: p.stroke ? { color: hex6(p.stroke), width: p.strokeWidth ?? 1 } : { type: 'none' },
        points: [
          ...p.points.map(([px, py], i) => ({ x: inch(px - minX), y: inch(py - minY), ...(i === 0 ? { moveTo: true } : {}) })),
          { close: true },
        ],
      });
      return;
    }
    case 'line': {
      const x = Math.min(p.x1, p.x2); const y = Math.min(p.y1, p.y2);
      slide.addShape(T.line, {
        x: inch(x), y: inch(y), w: inch(Math.abs(p.x2 - p.x1)), h: inch(Math.abs(p.y2 - p.y1)),
        line: { color: hex6(p.color), width: p.width, ...(p.dash ? { dashType: 'dash' } : {}) },
      });
      return;
    }
    case 'text': {
      if (!p.text) return;
      slide.addText(p.text, {
        x: inch(p.x), y: inch(p.y), w: inch(p.w), h: inch(p.h),
        fontFace, fontSize: p.size, color: hex6(p.color), bold: !!p.bold, italic: !!p.italic,
        align: p.align, valign: p.valign === 'top' ? 'top' : 'middle',
        margin: 0, wrap: false, fit: 'none',
      });
    }
  }
}

/** One slide per layout page, every element a native shape or text box. */
export async function exportPptx(pages: LayoutPage[], config: TemplateConfig, name: string): Promise<void> {
  // Loaded on demand — pptxgenjs is large and only needed when exporting.
  const mod = await import('pptxgenjs');
  const PptxGenJS = (mod as unknown as { default: new () => PptxLike }).default;
  const pptx = new PptxGenJS();
  const { width, height } = pages[0];
  pptx.defineLayout({ name: 'TIMELINE', width: inch(width), height: inch(height) });
  pptx.layout = 'TIMELINE';
  pptx.title = name;
  pptx.author = '6D Task Management Tool';

  for (const page of pages) {
    const slide = pptx.addSlide();
    slide.background = { color: hex6(config.slide.background) };
    // The layout engine's first primitive is the full-slide background rect — already set above.
    page.primitives.slice(1).forEach((p) => addPrimitive(slide, pptx, p, config.font.family));
  }
  await pptx.writeFile({ fileName: `${safeFileName(name)}.pptx` });
}
