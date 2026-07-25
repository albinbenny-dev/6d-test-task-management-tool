// ── Feature-group visual theme — shared by TestCaseLibrary.tsx (TC Library)
// and Test Management's Features view, so grouped-by-feature test case lists
// look identical everywhere in the app. ─────────────────────────────────────

export const GROUP_COLORS = ['--cyan', '--violet', '--emerald', '--amber', '--rose', '--sky'];

export function groupColor(index: number): string {
  return GROUP_COLORS[index % GROUP_COLORS.length];
}

const COLOR_MAP: Record<string, string> = {
  '--cyan':    '37,99,171',
  '--violet':  '139,92,246',
  '--emerald': '42,157,143',
  '--amber':   '245,158,11',
  '--rose':    '220,38,38',
  '--sky':     '56,189,248',
};

export function colorToRgba(cssVar: string, alpha: number): string {
  const rgb = COLOR_MAP[cssVar] ?? '100,100,100';
  return `rgba(${rgb},${alpha})`;
}
