// Small hex-colour helpers for tinting progress bars / lane bands and picking
// readable label colours. Everything is plain #RRGGBB so the same value works
// in SVG and in PowerPoint (which has no CSS colour functions).

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
}

function toHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

/** Mix `hex` toward `withHex` by `amount` (0 = hex, 1 = withHex). */
export function mix(hex: string, withHex: string, amount: number): string {
  const [r1, g1, b1] = rgb(hex);
  const [r2, g2, b2] = rgb(withHex);
  return toHex(r1 + (r2 - r1) * amount, g1 + (g2 - g1) * amount, b1 + (b2 - b1) * amount);
}

export const tint = (hex: string, amount: number) => mix(hex, '#FFFFFF', amount);
export const shade = (hex: string, amount: number) => mix(hex, '#000000', amount);

/** Perceived luminance 0..1 */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export function readableOn(bg: string, light = '#FFFFFF', dark = '#1F2937'): string {
  return luminance(bg) > 0.62 ? dark : light;
}

/** A band behind swimlane rows: lane colour at `opacity` over the slide background. */
export function bandColor(laneHex: string, background: string, opacity: number): string {
  return mix(background, laneHex, opacity);
}
