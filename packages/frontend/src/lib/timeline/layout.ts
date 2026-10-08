// ── Timeline Builder — layout engine ────────────────────────────────────────
// Pure function: (items, lanes, template config) → drawing primitives. No DOM
// except the optional canvas text measurer. Everything the user sees — the
// live SVG preview, the PNG, the PowerPoint — is rendered from this output, so
// they cannot drift apart. Units are points (960×540 for 16:9).

import type {
  AxisScale, LayoutPage, LayoutResult, Primitive, TemplateConfig, TLItem, TLLane,
} from './types';
import { addDays, diffDays, formatDate, monthShort, parseYmd, todayYmd } from './dates';
import { fitText, measureText } from './text';
import { bandColor, mix, readableOn, shade, tint } from './color';

type Scale = Exclude<AxisScale, 'auto'>;

const SLIDE_SIZE = { '16:9': { w: 960, h: 540 }, '4:3': { w: 720, h: 540 } } as const;
const MARGIN = { l: 28, r: 28, t: 20, b: 20 };
const MIN_ROW_H = 18;

export interface LayoutInput {
  title: string;
  items: TLItem[];
  lanes: TLLane[];
  config: TemplateConfig;
  /** Injectable for deterministic tests; defaults to today. */
  today?: string;
}

// ── Time axis ───────────────────────────────────────────────────────────────

interface Tick { start: Date; end: Date; label: string }
interface Range { start: Date; end: Date } // end exclusive

const utc = (y: number, m: number, d = 1) => new Date(Date.UTC(y, m, d));
const startOfMonth = (d: Date) => utc(d.getUTCFullYear(), d.getUTCMonth());
const addMonths = (d: Date, n: number) => utc(d.getUTCFullYear(), d.getUTCMonth() + n);
const startOfQuarter = (d: Date) => utc(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3);
const startOfYear = (d: Date) => utc(d.getUTCFullYear(), 0);
const startOfWeek = (d: Date) => addDays(d, -((d.getUTCDay() + 6) % 7)); // Monday

function resolveScale(scale: AxisScale, min: Date, max: Date): Scale {
  if (scale !== 'auto') return scale;
  const span = diffDays(min, max) + 1;
  if (span <= 100) return 'week';
  if (span <= 500) return 'month';
  if (span <= 1200) return 'quarter';
  return 'year';
}

function snapRange(min: Date, max: Date, scale: Scale): Range {
  switch (scale) {
    case 'week': return { start: startOfWeek(min), end: addDays(startOfWeek(max), 7) };
    case 'fortnight': {
      const start = startOfWeek(min);
      const weeksEnd = addDays(startOfWeek(max), 7);
      return { start, end: addDays(start, Math.ceil(diffDays(start, weeksEnd) / 14) * 14) };
    }
    case 'month': return { start: startOfMonth(min), end: addMonths(startOfMonth(max), 1) };
    case 'quarter': return { start: startOfQuarter(min), end: addMonths(startOfQuarter(max), 3) };
    default: return { start: startOfYear(min), end: utc(max.getUTCFullYear() + 1, 0) };
  }
}

function nextTick(d: Date, scale: Scale): Date {
  switch (scale) {
    case 'week': return addDays(d, 7);
    case 'fortnight': return addDays(d, 14);
    case 'month': return addMonths(d, 1);
    case 'quarter': return addMonths(d, 3);
    default: return utc(d.getUTCFullYear() + 1, 0);
  }
}

function minorLabel(d: Date, scale: Scale): string {
  switch (scale) {
    case 'week': return String(d.getUTCDate());
    case 'fortnight': return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    case 'month': return monthShort(d.getUTCMonth());
    case 'quarter': return `Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
    default: return String(d.getUTCFullYear());
  }
}

function buildTicks(range: Range, scale: Scale, plainMonths: boolean): { minor: Tick[]; major: Tick[] } {
  const minor: Tick[] = [];
  for (let c = range.start; c < range.end; c = nextTick(c, scale)) {
    minor.push({ start: c, end: nextTick(c, scale), label: minorLabel(c, scale) });
  }
  const major: Tick[] = [];
  if (scale === 'week' || scale === 'fortnight') {
    for (let c = startOfMonth(range.start); c < range.end; c = addMonths(c, 1)) {
      const n = addMonths(c, 1);
      major.push({
        start: c < range.start ? range.start : c, end: n > range.end ? range.end : n,
        label: plainMonths ? monthShort(c.getUTCMonth()) : `${monthShort(c.getUTCMonth())} ${c.getUTCFullYear()}`,
      });
    }
  } else if (scale !== 'year') {
    for (let c = startOfYear(range.start); c < range.end; c = utc(c.getUTCFullYear() + 1, 0)) {
      const n = utc(c.getUTCFullYear() + 1, 0);
      major.push({
        start: c < range.start ? range.start : c, end: n > range.end ? range.end : n,
        label: String(c.getUTCFullYear()),
      });
    }
  }
  return { minor, major };
}

// ── Frame (geometry shared by every layout) ─────────────────────────────────

interface Frame {
  W: number; H: number;
  leftX: number; leftW: number;
  plotX: number; plotW: number; plotRight: number;
  titleH: number;
  axisY: number; axisH: number; tierH: number;
  bodyTop: number; bodyBottom: number;
  range: Range; totalDays: number; scale: Scale;
  minor: Tick[]; major: Tick[];
}

interface Ctx {
  cfg: TemplateConfig;
  fr: Frame;
  fam: string;
  base: number;
  lineH: number;
  bg: string;
  title: string;
  today: string;
  lanes: TLLane[];
  laneColor: (laneId: string | null) => string | null;
  x: (d: Date) => number;
  tw: (text: string, size?: number, bold?: boolean) => number;
}

function ganttColumns(cfg: TemplateConfig, W: number) {
  const t = cfg.table;
  const extras: { key: 'start' | 'end' | 'dur' | 'who'; label: string; w: number }[] = [];
  if (t.showStart) extras.push({ key: 'start', label: 'Start', w: 62 });
  if (t.showEnd) extras.push({ key: 'end', label: 'End', w: 62 });
  if (t.showDuration) extras.push({ key: 'dur', label: 'Days', w: 40 });
  if (t.showAssignee) extras.push({ key: 'who', label: 'Owner', w: 84 });
  const extraW = extras.reduce((n, c) => n + c.w, 0);
  const maxLeft = (W - MARGIN.l - MARGIN.r) * 0.5;
  const titleW = Math.max(100, Math.min(t.labelWidth, maxLeft - extraW));
  return { titleW, extras, leftW: titleW + extraW };
}

function leftWidthFor(cfg: TemplateConfig, W: number): number {
  if (cfg.layout === 'gantt') return ganttColumns(cfg, W).leftW;
  if (cfg.layout === 'swimlane' && cfg.swimlane.style === 'sidebar' && cfg.swimlane.showLabels) return cfg.swimlane.labelWidth;
  return 0;
}

const YEAR_PAD = 46; // room for the big year labels at each end of the axis

function buildFrame(cfg: TemplateConfig, items: TLItem[], titleShown: boolean, today: string, railH = 0): Frame {
  const { w: W, h: H } = SLIDE_SIZE[cfg.slide.size];
  const base = cfg.font.baseSize;

  let min: Date; let max: Date;
  if (items.length) {
    min = items.reduce((m, i) => { const d = parseYmd(i.startDate); return d < m ? d : m; }, parseYmd(items[0].startDate));
    max = items.reduce((m, i) => { const d = parseYmd(i.endDate); return d > m ? d : m; }, parseYmd(items[0].endDate));
  } else {
    const t = parseYmd(today);
    min = startOfMonth(t); max = addDays(addMonths(startOfMonth(t), 12), -1);
  }
  const scale = resolveScale(cfg.axis.scale, min, max);
  const range = snapRange(min, max, scale);
  const { minor, major } = buildTicks(range, scale, cfg.axis.yearLabels);

  const tierH = base + 9;
  const axisH = major.length ? tierH * 2 : tierH;
  const titleH = titleShown ? cfg.slide.titleSize * 1.3 + 10 : 0;

  const leftW = leftWidthFor(cfg, W);
  const yearPad = cfg.axis.yearLabels ? YEAR_PAD : 0;
  const plotX = MARGIN.l + (leftW > 0 ? leftW : yearPad);
  const plotRight = W - MARGIN.r - yearPad;
  const contentTop = MARGIN.t + titleH + railH;
  const bottom = H - MARGIN.b;
  const axisTop = cfg.axis.position === 'top';
  const axisY = axisTop ? contentTop : bottom - axisH;

  return {
    W, H, leftX: MARGIN.l, leftW, plotX, plotW: plotRight - plotX, plotRight, titleH,
    axisY, axisH, tierH,
    bodyTop: axisTop ? contentTop + axisH : contentTop,
    bodyBottom: axisTop ? bottom : axisY,
    range, totalDays: diffDays(range.start, range.end), scale, minor, major,
  };
}

// ── Shared drawing pieces ───────────────────────────────────────────────────

function sortItems(items: TLItem[]): TLItem[] {
  return [...items].sort((a, b) => a.sortOrder - b.sortOrder || a.startDate.localeCompare(b.startDate));
}

function itemColor(ctx: Ctx, item: TLItem): string {
  if (item.color) return item.color;
  if (item.type === 'MILESTONE') return ctx.cfg.palette.milestoneDefault;
  const t = ctx.cfg.task;
  if (t.notStartedColor && item.percentComplete === 0) return t.notStartedColor;
  if (t.colorSource === 'default') return ctx.cfg.palette.taskDefault;
  return ctx.laneColor(item.swimlaneId) ?? ctx.cfg.palette.taskDefault;
}

function taskRadius(ctx: Ctx, item: TLItem, h: number): number {
  if (item.marker === 'bar') return 0;
  switch (ctx.cfg.task.shape) {
    case 'pill': return h / 2;
    case 'rounded': return Math.min(4, h / 2);
    default: return 0;
  }
}

function chevronPoints(x: number, y: number, w: number, h: number): [number, number][] {
  const p = Math.min(h / 2, w / 2);
  return [[x, y], [x + w - p, y], [x + w, y + h / 2], [x + w - p, y + h], [x, y + h]];
}

function starPoints(cx: number, cy: number, r: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.42;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]);
  }
  return pts;
}

function pctLabel(item: TLItem): string {
  return item.percentComplete > 0 ? `${item.percentComplete}%` : '';
}

/** Draws the task bar (with progress) and returns its horizontal extent. */
function drawTaskBar(out: Primitive[], ctx: Ctx, item: TLItem, cy: number, h: number, color: string) {
  const x0 = ctx.x(parseYmd(item.startDate));
  const x1 = ctx.x(addDays(parseYmd(item.endDate), 1));
  const w = Math.max(x1 - x0, 3);
  const y = cy - h / 2;
  const pct = Math.max(0, Math.min(100, item.percentComplete));
  const tk = ctx.cfg.task;
  const showPct = tk.showPercent;
  const darker = tk.progressStyle === 'shade';
  const track = darker ? color : tint(color, 0.55);
  const done = darker ? shade(color, 0.38) : color;
  // With a darker "completed" style even a 100% bar shows its fill; the tint style leaves 100% solid.
  const split = showPct && (pct < 100 || darker);
  const fillW = pct >= 100 ? w : Math.max((w * pct) / 100, Math.min(w, h));

  if (item.marker === 'chevron') {
    out.push({ kind: 'poly', points: chevronPoints(x0, y, w, h), fill: split ? track : color, itemId: item.id });
    if (split && pct > 0) {
      const fw = Math.max(0, Math.min(w, (w * pct) / 100));
      const p = Math.min(h / 2, w / 2);
      // Progress clipped to the chevron: a polygon whose right edge follows the chevron's point.
      const fx = x0 + fw;
      const pts: [number, number][] = [[x0, y], [Math.min(fx, x0 + w - p), y]];
      if (fx > x0 + w - p) { pts.push([fx, y + ((fx - (x0 + w - p)) / p) * (h / 2)]); pts.push([fx, y + h - ((fx - (x0 + w - p)) / p) * (h / 2)]); }
      else { pts.push([fx, y + h]); }
      pts.push([Math.min(fx, x0 + w - p), y + h], [x0, y + h]);
      out.push({ kind: 'poly', points: pts, fill: done, itemId: item.id });
    }
  } else {
    const rx = taskRadius(ctx, item, h);
    if (split) {
      if (pct < 100) out.push({ kind: 'rect', x: x0, y, w, h, rx, fill: track, itemId: item.id });
      if (pct > 0) out.push({ kind: 'rect', x: x0, y, w: fillW, h, rx, fill: done, itemId: item.id });
    } else {
      out.push({ kind: 'rect', x: x0, y, w, h, rx, fill: color, itemId: item.id });
    }
  }

  // "60%" inside the bar: right-aligned at the end of the completed part (or after it if that part is too short).
  if (showPct && tk.percentInside && w >= 34) {
    const txt = `${pct}%`;
    const size = Math.max(7, Math.min(ctx.base - 1, h - 4));
    const tw = ctx.tw(txt, size);
    const fillEnd = x0 + (pct > 0 ? (item.marker === 'chevron' ? (w * pct) / 100 : fillW) : 0);
    const doneBg = pct > 0 ? (split ? done : color) : track;
    if (pct > 0 && fillEnd - x0 >= tw + 12) {
      out.push({ kind: 'text', x: x0, y: cy - ctx.lineH / 2, w: fillEnd - x0 - 6, h: ctx.lineH, text: txt, size, color: readableOn(doneBg), align: 'right', itemId: item.id });
    } else {
      const tx = pct > 0 ? fillEnd + 4 : x0 + 8;
      if (tx + tw <= x0 + w - 2) out.push({ kind: 'text', x: tx, y: cy - ctx.lineH / 2, w: tw + 4, h: ctx.lineH, text: txt, size, color: readableOn(track), align: 'left', itemId: item.id });
    }
  }
  return { x0, x1: x0 + w, w };
}

/** Draws the milestone marker centred on its date and returns its centre x. */
function drawMilestoneMarker(out: Primitive[], ctx: Ctx, item: TLItem, cy: number, size: number, color: string): number {
  const dayW = ctx.fr.plotW / ctx.fr.totalDays;
  const cx = ctx.x(parseYmd(item.startDate)) + dayW / 2;
  const s = size;
  const id = item.id;
  switch (item.marker) {
    case 'circle':
      out.push({ kind: 'shape', shape: 'ellipse', x: cx - s / 2, y: cy - s / 2, w: s, h: s, fill: color, itemId: id });
      break;
    case 'triangle':
      out.push({ kind: 'shape', shape: 'triangle', x: cx - s / 2, y: cy - s / 2, w: s, h: s, fill: color, itemId: id });
      break;
    case 'star':
      out.push({ kind: 'poly', points: starPoints(cx, cy, s / 2), fill: color, itemId: id });
      break;
    case 'flag': {
      const px = cx - s * 0.25;
      out.push({ kind: 'line', x1: px, y1: cy - s / 2, x2: px, y2: cy + s / 2, color, width: Math.max(1.5, s / 10), itemId: id });
      out.push({ kind: 'poly', points: [[px, cy - s / 2], [cx + s * 0.5, cy - s / 2 + s * 0.24], [px, cy - s / 2 + s * 0.48]], fill: color, itemId: id });
      break;
    }
    default:
      out.push({ kind: 'shape', shape: 'diamond', x: cx - s / 2, y: cy - s / 2, w: s, h: s, fill: color, itemId: id });
  }
  return cx;
}

// ── Item label planning (swimlane + milestone-line) ─────────────────────────

type LabelSide = 'inside' | 'left' | 'right' | 'above' | 'below';

interface Plan {
  item: TLItem;
  color: string;
  x0: number; x1: number; cx: number;
  side: LabelSide;
  lines: string[];       // 1–2 lines
  lw: number;            // widest line
  left: number; right: number; // horizontal extent incl. label, for packing
  dates?: string; dw?: number; // date range drawn beyond the bar's far end (datesPlacement: right)
}

function taskDatesText(ctx: Ctx, item: TLItem): string {
  const f = ctx.cfg.milestone.dateFormat;
  return `${formatDate(item.startDate, f)} – ${formatDate(item.endDate, f)}`;
}

function taskLabelText(ctx: Ctx, item: TLItem): string[] {
  const t = ctx.cfg.task;
  const pct = t.showPercent && !t.percentInside ? pctLabel(item) : '';
  const txt = pct ? `${item.title}  ${pct}` : item.title;
  const datesRight = t.showDates && t.datesPlacement === 'right' && t.labelPosition !== 'above';
  if (!t.showDates || datesRight) return [txt];
  const dates = taskDatesText(ctx, item);
  if (t.labelPosition === 'above') return [txt, dates];
  return [`${txt}  (${dates})`];
}

function planItem(ctx: Ctx, item: TLItem): Plan {
  const { cfg, fr } = ctx;
  const color = itemColor(ctx, item);
  const gap = 4;

  if (item.type === 'MILESTONE') {
    const size = cfg.milestone.size;
    const dayW = fr.plotW / fr.totalDays;
    const cx = ctx.x(parseYmd(item.startDate)) + dayW / 2;
    const date = cfg.milestone.showDate ? formatDate(item.startDate, cfg.milestone.dateFormat) : '';
    let side: LabelSide = cfg.milestone.labelPosition;
    let lines = side === 'right' ? [date ? `${item.title}  ${date}` : item.title] : [item.title, ...(date ? [date] : [])];
    let lw = Math.max(...lines.map((l) => ctx.tw(l)));
    let left: number; let right: number;
    if (side === 'right') {
      if (cx + size / 2 + gap + lw > fr.plotRight) { side = 'left'; }
    }
    if (side === 'right') { left = cx - size / 2; right = cx + size / 2 + gap + lw; }
    else if (side === 'left') { left = cx - size / 2 - gap - lw; right = cx + size / 2; }
    else {
      lw = Math.min(lw, 180);
      lines = lines.map((l) => fitText(l, lw, ctx.base, ctx.fam));
      left = cx - Math.max(size, lw) / 2; right = cx + Math.max(size, lw) / 2;
    }
    return { item, color, x0: cx, x1: cx, cx, side, lines, lw, left, right };
  }

  const x0 = ctx.x(parseYmd(item.startDate));
  const x1 = Math.max(ctx.x(addDays(parseYmd(item.endDate), 1)), x0 + 3);
  const lines = taskLabelText(ctx, item);
  const bold = cfg.task.boldLabels;
  const lw = Math.max(...lines.map((l) => ctx.tw(l, ctx.base, bold)));
  let side: LabelSide = cfg.task.labelPosition;
  if (side === 'inside' && lw + 10 > x1 - x0) side = x1 + gap + lw <= fr.plotRight ? 'right' : 'left';
  if (side === 'right' && x1 + gap + lw > fr.plotRight) side = 'left';
  if (side === 'left' && x0 - gap - lw < fr.plotX) {
    side = lw + 10 <= x1 - x0 ? 'inside' : x1 + gap + lw <= fr.plotRight ? 'right' : 'left';
  }
  let left = x0; let right = x1;
  if (side === 'right') right = x1 + gap + lw;
  if (side === 'left') left = x0 - gap - lw;
  if (side === 'above') right = Math.max(x1, x0 + lw);

  // Date range beyond the bar's far end (after the label when the label is on the right).
  let dates: string | undefined; let dw: number | undefined;
  if (cfg.task.showDates && cfg.task.datesPlacement === 'right' && cfg.task.labelPosition !== 'above') {
    const text = taskDatesText(ctx, item);
    const w = ctx.tw(text);
    const startX = side === 'right' ? x1 + gap + lw + 8 : x1 + gap;
    if (startX + w <= fr.plotRight) { dates = text; dw = w; right = Math.max(right, startX + w); }
  }
  return { item, color, x0, x1, cx: x0, side, lines, lw, left, right, dates, dw };
}

function pack(plans: Plan[]): number[] {
  const order = plans.map((_, i) => i).sort((a, b) => plans[a].left - plans[b].left);
  const rowEnds: number[] = [];
  const rowOf: number[] = new Array(plans.length).fill(0);
  for (const i of order) {
    let r = rowEnds.findIndex((end) => end + 6 <= plans[i].left);
    if (r === -1) { r = rowEnds.length; rowEnds.push(-Infinity); }
    rowEnds[r] = plans[i].right;
    rowOf[i] = r;
  }
  return rowOf;
}

/** Emits the shape + label for a planned item, vertically centred on `cy`. */
function drawPlan(out: Primitive[], ctx: Ctx, p: Plan, cy: number, shapeH: number) {
  const { cfg, base } = ctx;
  const lh = ctx.lineH;
  const id = p.item.id;
  const lineBlock = p.lines.length * lh;

  if (p.item.type === 'MILESTONE') {
    const size = cfg.milestone.size;
    drawMilestoneMarker(out, ctx, p.item, cy, size, p.color);
    const textColor = cfg.palette.text;
    if (p.side === 'right' || p.side === 'left') {
      const w = p.lw + 4;
      const x = p.side === 'right' ? p.cx + size / 2 + 4 : p.cx - size / 2 - 4 - w;
      out.push({ kind: 'text', x, y: cy - lh / 2, w, h: lh, text: p.lines[0], size: base, color: textColor, align: p.side === 'right' ? 'left' : 'right', itemId: id });
    } else {
      const w = Math.max(p.lw, size) + 6;
      let x = p.cx - w / 2;
      x = Math.max(ctx.fr.plotX - 4, Math.min(x, ctx.fr.plotRight - w + 4));
      const y = p.side === 'below' ? cy + shapeH / 2 + 2 : cy - shapeH / 2 - 2 - lineBlock;
      p.lines.forEach((line, i) => {
        out.push({ kind: 'text', x, y: y + i * lh, w, h: lh, text: line, size: i === 0 ? base : Math.max(7, base - 2), color: i === 0 ? textColor : cfg.palette.muted, bold: false, align: 'center', itemId: id });
      });
    }
    return;
  }

  const h = cfg.task.height;
  const bar = drawTaskBar(out, ctx, p.item, cy, h, p.color);
  const bold = cfg.task.boldLabels;
  if (p.dates && p.dw !== undefined) {
    const x = p.side === 'right' ? bar.x1 + 4 + p.lw + 8 : bar.x1 + 4;
    out.push({ kind: 'text', x, y: cy - lh / 2, w: p.dw + 4, h: lh, text: p.dates, size: base, color: cfg.palette.muted, align: 'left', itemId: id });
  }
  if (p.side === 'inside') {
    const pct = p.item.percentComplete;
    const showPct = cfg.task.showPercent;
    const solid = !showPct || pct >= 50;
    // Text sits at the bar's left end, so pick contrast from whichever part is actually under it.
    const doneBg = cfg.task.progressStyle === 'shade' && showPct ? shade(p.color, 0.38) : p.color;
    const trackBg = cfg.task.progressStyle === 'shade' ? p.color : tint(p.color, 0.55);
    const fg = readableOn(solid ? doneBg : trackBg);
    out.push({ kind: 'text', x: bar.x0 + 6, y: cy - lh / 2, w: Math.max(0, bar.w - 8), h: lh, text: fitText(p.lines[0], bar.w - 10, base, ctx.fam, bold), size: Math.min(base, Math.max(7, h - 4)), color: fg, bold, align: 'left', itemId: id });
  } else if (p.side === 'right') {
    out.push({ kind: 'text', x: bar.x1 + 4, y: cy - lh / 2, w: p.lw + 4, h: lh, text: p.lines[0], size: base, color: cfg.palette.text, bold, align: 'left', itemId: id });
  } else if (p.side === 'left') {
    const w = p.lw + 4;
    out.push({ kind: 'text', x: bar.x0 - 4 - w, y: cy - lh / 2, w, h: lh, text: p.lines[0], size: base, color: cfg.palette.text, bold, align: 'right', itemId: id });
  } else {
    const y = cy - h / 2 - 1 - lineBlock;
    p.lines.forEach((line, i) => {
      out.push({ kind: 'text', x: bar.x0, y: y + i * lh, w: Math.max(p.lw, bar.w) + 6, h: lh, text: line, size: i === 0 ? base : Math.max(7, base - 2), color: i === 0 ? cfg.palette.text : cfg.palette.muted, align: 'left', itemId: id });
    });
  }
}

// ── Chrome: background, title, axis, gridlines, today marker ────────────────

function chromeBefore(ctx: Ctx, pageNo: number, pageCount: number): Primitive[] {
  const { cfg, fr } = ctx;
  const out: Primitive[] = [{ kind: 'rect', x: 0, y: 0, w: fr.W, h: fr.H, fill: ctx.bg }];
  if (cfg.slide.showTitle && ctx.title) {
    const suffix = pageCount > 1 ? `  (${pageNo}/${pageCount})` : '';
    out.push({
      kind: 'text', x: MARGIN.l, y: MARGIN.t, w: fr.W - MARGIN.l - MARGIN.r, h: fr.titleH - 6,
      text: fitText(ctx.title + suffix, fr.W - MARGIN.l - MARGIN.r, cfg.slide.titleSize, ctx.fam, true),
      size: cfg.slide.titleSize, color: cfg.slide.titleColor, bold: true, align: cfg.slide.titleAlign,
    });
  }
  return out;
}

function gridlines(ctx: Ctx, bottom: number): Primitive[] {
  const { cfg, fr } = ctx;
  if (cfg.axis.gridlines === 'none') return [];
  const ticks = cfg.axis.gridlines === 'all' || fr.major.length === 0 ? fr.minor : fr.major;
  const out: Primitive[] = [];
  ticks.slice(1).forEach((t) => {
    const x = ctx.x(t.start);
    out.push({ kind: 'line', x1: x, y1: fr.bodyTop, x2: x, y2: bottom, color: cfg.palette.grid, width: 0.75 });
  });
  return out;
}

function chromeAfter(ctx: Ctx, bottom: number): Primitive[] {
  const { cfg, fr, base } = ctx;
  const out: Primitive[] = [];

  // Today marker
  const t = parseYmd(ctx.today);
  if (cfg.axis.showToday && t >= fr.range.start && t < fr.range.end) {
    const x = ctx.x(t) + (fr.plotW / fr.totalDays) / 2;
    out.push({ kind: 'line', x1: x, y1: fr.bodyTop, x2: x, y2: bottom, color: cfg.axis.todayColor, width: 1.25, dash: [4, 3] });
    const tagW = ctx.tw('Today', Math.max(7, base - 2), true) + 10;
    const tagY = cfg.axis.position === 'top' ? fr.bodyTop : bottom - 13;
    out.push({ kind: 'rect', x: x - tagW / 2, y: tagY, w: tagW, h: 13, rx: 3, fill: cfg.axis.todayColor });
    out.push({ kind: 'text', x: x - tagW / 2, y: tagY, w: tagW, h: 13, text: 'Today', size: Math.max(7, base - 2), color: '#FFFFFF', bold: true, align: 'center' });
  }

  // Axis
  const filled = cfg.axis.style === 'filled';
  const textColor = filled ? cfg.axis.textColor : cfg.palette.text;
  const minorFill = cfg.axis.minorFill ?? cfg.axis.fill;
  const tiers: { ticks: Tick[]; y: number; fill: string }[] = fr.major.length
    ? [{ ticks: fr.major, y: fr.axisY, fill: cfg.axis.fill }, { ticks: fr.minor, y: fr.axisY + fr.tierH, fill: minorFill }]
    : [{ ticks: fr.minor, y: fr.axisY, fill: cfg.axis.fill }];
  if (filled) {
    tiers.forEach((tr) => out.push({ kind: 'rect', x: fr.plotX, y: tr.y, w: fr.plotW, h: fr.tierH, fill: tr.fill }));
    // Lighten the elapsed part of the axis (everything before today).
    if (cfg.axis.pastTint > 0 && t >= fr.range.start) {
      const dayW = fr.plotW / fr.totalDays;
      const xT = t >= fr.range.end ? fr.plotRight : ctx.x(t) + dayW / 2;
      tiers.forEach((tr) => tr.ticks.forEach((tk) => {
        const x0 = ctx.x(tk.start); const x1 = Math.min(ctx.x(tk.end), xT);
        if (x1 > x0) out.push({ kind: 'rect', x: x0, y: tr.y, w: x1 - x0, h: fr.tierH, fill: tint(tr.fill, cfg.axis.pastTint) });
      }));
    }
  }
  const sep = filled ? mix(cfg.axis.fill, '#FFFFFF', 0.28) : cfg.palette.grid;
  tiers.forEach(({ ticks, y }, ti) => {
    ticks.forEach((tk, i) => {
      const x0 = ctx.x(tk.start); const x1 = ctx.x(tk.end);
      const w = x1 - x0;
      if (i > 0) out.push({ kind: 'line', x1: x0, y1: y + 2, x2: x0, y2: y + fr.tierH - 2, color: sep, width: 0.75 });
      let label = tk.label;
      if (ctx.tw(label, base - 1) > w - 4) label = fitText(label, w - 4, base - 1, ctx.fam);
      if (label.length > 0 && !(label.endsWith('…') && label.length <= 2)) {
        out.push({ kind: 'text', x: x0, y, w, h: fr.tierH, text: label, size: base - 1, color: textColor, bold: ti === 0 && fr.major.length > 0, align: 'center' });
      }
    });
  });
  if (cfg.axis.yearLabels) {
    const size = base + 8;
    const y1 = addDays(fr.range.end, -1).getUTCFullYear();
    out.push({ kind: 'text', x: fr.leftX, y: fr.axisY, w: fr.plotX - 6 - fr.leftX, h: fr.axisH, text: String(fr.range.start.getUTCFullYear()), size, color: cfg.axis.yearColor, bold: true, align: 'right' });
    out.push({ kind: 'text', x: fr.plotRight + 6, y: fr.axisY, w: YEAR_PAD - 6, h: fr.axisH, text: String(y1), size, color: cfg.axis.yearColor, bold: true, align: 'left' });
  }
  if (cfg.axis.style === 'underline') {
    const ly = cfg.axis.position === 'top' ? fr.axisY + fr.axisH : fr.axisY;
    out.push({ kind: 'rect', x: fr.plotX, y: ly - 1, w: fr.plotW, h: 2, fill: cfg.axis.fill });
  } else if (cfg.axis.style === 'plain') {
    const ly = cfg.axis.position === 'top' ? fr.axisY + fr.axisH : fr.axisY;
    out.push({ kind: 'line', x1: fr.plotX, y1: ly, x2: fr.plotRight, y2: ly, color: cfg.palette.grid, width: 1 });
  }
  return out;
}

function wrapLines(text: string, maxW: number, size: number, ctx: Ctx, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.tw(next, size, true) <= maxW || !cur) cur = next;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  const kept = lines.slice(0, maxLines);
  if (lines.length > maxLines) kept[maxLines - 1] = fitText(kept[maxLines - 1] + '…', maxW, size, ctx.fam, true);
  return kept.map((l) => fitText(l, maxW, size, ctx.fam, true));
}

// ── Gantt layout ────────────────────────────────────────────────────────────

type GRow =
  | { kind: 'lane'; lane: TLLane; color: string }
  | { kind: 'item'; item: TLItem; indent: boolean };

function ganttRows(ctx: Ctx, items: TLItem[]): GRow[] {
  const rows: GRow[] = [];
  const known = new Set(ctx.lanes.map((l) => l.id));
  sortItems(items.filter((i) => !i.swimlaneId || !known.has(i.swimlaneId))).forEach((item) => rows.push({ kind: 'item', item, indent: false }));
  ctx.lanes.forEach((lane) => {
    rows.push({ kind: 'lane', lane, color: ctx.laneColor(lane.id) ?? ctx.cfg.palette.accent });
    if (!lane.collapsed) sortItems(items.filter((i) => i.swimlaneId === lane.id)).forEach((item) => rows.push({ kind: 'item', item, indent: true }));
  });
  return rows;
}

function paginateRows(rows: GRow[], capacity: number, laneOf: (r: GRow) => TLLane | null): GRow[][] {
  if (rows.length <= capacity) return [rows];
  const pages: GRow[][] = [];
  let i = 0;
  let carry: GRow | null = null;
  while (i < rows.length) {
    const page: GRow[] = [];
    if (carry) page.push(carry);
    carry = null;
    while (i < rows.length && page.length < capacity) page.push(rows[i++]);
    // Don't strand a lane header at the very bottom of a page.
    if (i < rows.length && page[page.length - 1].kind === 'lane') { page.pop(); i--; }
    // A page that starts mid-lane repeats the lane header for context.
    const last = page[page.length - 1];
    const lane = last.kind === 'item' && last.indent ? laneOf(last) : null;
    if (i < rows.length && rows[i].kind === 'item' && (rows[i] as { indent: boolean }).indent && lane) {
      const header = rows.slice(0, i).reverse().find((r) => r.kind === 'lane' && r.lane.id === lane.id);
      if (header) carry = header;
    }
    pages.push(page);
  }
  return pages;
}

function layoutGantt(ctx: Ctx, items: TLItem[]): LayoutPage[] {
  const { cfg, fr, base } = ctx;
  const cols = ganttColumns(cfg, fr.W);
  const rows = ganttRows(ctx, items);
  const bodyH = fr.bodyBottom - fr.bodyTop;
  const capacity = Math.max(1, Math.floor(bodyH / MIN_ROW_H));
  const laneById = new Map(ctx.lanes.map((l) => [l.id, l]));
  const pages = paginateRows(rows, capacity, (r) => (r.kind === 'item' && r.item.swimlaneId ? laneById.get(r.item.swimlaneId) ?? null : null));
  const ideal = Math.max(MIN_ROW_H, Math.min(40, Math.max(cfg.task.height, cfg.milestone.size) + 10));

  return pages.map((pageRows, pi) => {
    const rowH = Math.max(MIN_ROW_H, Math.min(ideal, bodyH / Math.max(1, pageRows.length)));
    const textSize = Math.min(base, Math.max(7, rowH * 0.62));
    const bgPrims: Primitive[] = [];
    const itemPrims: Primitive[] = [];

    // Table header aligned with the axis
    if (cfg.axis.position === 'top') {
      bgPrims.push({ kind: 'rect', x: fr.leftX, y: fr.axisY, w: fr.leftW - 4, h: fr.axisH, fill: bandColor(cfg.palette.accent, ctx.bg, 0.1) });
      bgPrims.push({ kind: 'text', x: fr.leftX + 8, y: fr.axisY, w: cols.titleW - 10, h: fr.axisH, text: 'Task', size: base - 1, color: cfg.palette.muted, bold: true, align: 'left' });
      let cx = fr.leftX + cols.titleW;
      cols.extras.forEach((c) => {
        bgPrims.push({ kind: 'text', x: cx, y: fr.axisY, w: c.w, h: fr.axisH, text: c.label, size: base - 1, color: cfg.palette.muted, bold: true, align: 'center' });
        cx += c.w;
      });
    }

    pageRows.forEach((row, ri) => {
      const y = fr.bodyTop + ri * rowH;
      const cy = y + rowH / 2;
      if (row.kind === 'lane') {
        bgPrims.push({ kind: 'rect', x: fr.leftX, y: y + 1, w: fr.plotRight - fr.leftX, h: rowH - 2, rx: 3, fill: bandColor(row.color, ctx.bg, Math.max(0.15, cfg.swimlane.bandOpacity + 0.06)) });
        bgPrims.push({ kind: 'rect', x: fr.leftX, y: y + 1, w: 5, h: rowH - 2, fill: row.color });
        const glyph = row.lane.collapsed ? '▸ ' : '';
        itemPrims.push({ kind: 'text', x: fr.leftX + 12, y, w: fr.plotRight - fr.leftX - 16, h: rowH, text: fitText(glyph + row.lane.name, fr.plotRight - fr.leftX - 20, textSize, ctx.fam, true), size: textSize, color: cfg.palette.text, bold: true, align: 'left' });
        return;
      }

      const item = row.item;
      bgPrims.push({ kind: 'line', x1: fr.leftX, y1: y + rowH, x2: fr.plotRight, y2: y + rowH, color: cfg.palette.grid, width: 0.5 });
      const ind = row.indent ? 12 : 0;
      itemPrims.push({ kind: 'text', x: fr.leftX + 8 + ind, y, w: cols.titleW - 10 - ind, h: rowH, text: fitText(item.title, cols.titleW - 12 - ind, textSize, ctx.fam), size: textSize, color: cfg.palette.text, align: 'left', itemId: item.id });
      let cx = fr.leftX + cols.titleW;
      cols.extras.forEach((c) => {
        const v = c.key === 'start' ? formatDate(item.startDate, 'dd/MM/yyyy')
          : c.key === 'end' ? formatDate(item.endDate, 'dd/MM/yyyy')
          : c.key === 'dur' ? `${item.type === 'MILESTONE' ? 0 : item.durationDays}`
          : item.assignee ?? '';
        itemPrims.push({ kind: 'text', x: cx, y, w: c.w, h: rowH, text: fitText(v, c.w - 4, Math.max(7, textSize - 1), ctx.fam), size: Math.max(7, textSize - 1), color: cfg.palette.muted, align: 'center', itemId: item.id });
        cx += c.w;
      });

      const color = itemColor(ctx, item);
      if (item.type === 'MILESTONE') {
        const size = Math.min(cfg.milestone.size, rowH - 2);
        const mcx = drawMilestoneMarker(itemPrims, ctx, item, cy, size, color);
        const date = cfg.milestone.showDate ? formatDate(item.startDate, cfg.milestone.dateFormat) : '';
        if (date) {
          const w = ctx.tw(date, textSize) + 4;
          const right = mcx + size / 2 + 4 + w <= fr.plotRight;
          itemPrims.push({ kind: 'text', x: right ? mcx + size / 2 + 4 : mcx - size / 2 - 4 - w, y, w, h: rowH, text: date, size: textSize, color: cfg.palette.muted, align: right ? 'left' : 'right', itemId: item.id });
        }
      } else {
        const h = Math.min(cfg.task.height, rowH - 6);
        const bar = drawTaskBar(itemPrims, ctx, item, cy, Math.max(4, h), color);
        const bits: string[] = [];
        if (cfg.task.showDates) bits.push(`${formatDate(item.startDate, cfg.milestone.dateFormat)} – ${formatDate(item.endDate, cfg.milestone.dateFormat)}`);
        if (cfg.task.showPercent && !cfg.task.percentInside && item.percentComplete > 0) bits.push(`${item.percentComplete}%`);
        const note = bits.join('  ');
        if (note) {
          const w = ctx.tw(note, textSize) + 4;
          if (bar.x1 + 4 + w <= fr.plotRight) {
            itemPrims.push({ kind: 'text', x: bar.x1 + 4, y, w, h: rowH, text: note, size: textSize, color: cfg.palette.muted, align: 'left', itemId: item.id });
          } else if (bar.w > w + 12) {
            // No room beside a bar that runs to the plot edge — tuck the note inside its right end.
            const track = cfg.task.showPercent && item.percentComplete < 100;
            itemPrims.push({ kind: 'text', x: bar.x1 - 6 - w, y, w, h: rowH, text: note, size: textSize, color: readableOn(track ? tint(color, 0.55) : color), align: 'right', itemId: item.id });
          } else if (bar.x0 - 4 - w >= fr.plotX) {
            itemPrims.push({ kind: 'text', x: bar.x0 - 4 - w, y, w, h: rowH, text: note, size: textSize, color: cfg.palette.muted, align: 'right', itemId: item.id });
          }
        }
      }
    });

    return {
      width: fr.W, height: fr.H,
      primitives: [...chromeBefore(ctx, pi + 1, pages.length), ...bgPrims, ...gridlines(ctx, fr.bodyTop + pageRows.length * rowH), ...itemPrims, ...chromeAfter(ctx, fr.bodyTop + pageRows.length * rowH)],
    };
  });
}

// ── Swimlane layout ─────────────────────────────────────────────────────────

interface Band {
  lane: TLLane | null;
  color: string | null;
  plans: Plan[];
  rowOf: number[];
  subRows: number;
  // Per-band row anatomy — a lane with no milestone labels doesn't pay for them.
  topExtra: number;
  botExtra: number;
  shapeH: number;
  nat: number; // natural sub-row height
  minInner: number; // sidebar lane labels need this much height to show un-truncated
}

function layoutSwimlane(ctx: Ctx, items: TLItem[], rail?: RailResult): LayoutPage[] {
  const { cfg, fr, base, lineH } = ctx;
  const sw = cfg.swimlane;
  const known = new Set(ctx.lanes.map((l) => l.id));

  const mk = (lane: TLLane | null, its: TLItem[]): Band => {
    const plans = lane?.collapsed ? [] : its.map((i) => planItem(ctx, i));
    const rowOf = sw.rowMode === 'single' ? plans.map((_, i) => i) : pack(plans);
    const label = (side: LabelSide) => plans.filter((p) => p.side === side);
    const block = lineH * Math.max(1, ...plans.map((p) => p.lines.length)) + 2;
    const topExtra = label('above').length ? block : 0;
    const botExtra = label('below').length ? block : 0;
    const shapeH = Math.max(
      plans.some((p) => p.item.type === 'TASK') ? cfg.task.height : 0,
      plans.some((p) => p.item.type === 'MILESTONE') ? cfg.milestone.size : 0,
      lineH,
    );
    return {
      lane, color: lane ? ctx.laneColor(lane.id) : null, plans, rowOf,
      subRows: lane?.collapsed ? 0 : Math.max(1, ...rowOf.map((r) => r + 1)),
      topExtra, botExtra, shapeH, nat: topExtra + shapeH + botExtra + 6,
      minInner: lane && sw.style === 'sidebar' && sw.showLabels && !lane.collapsed
        ? wrapLines(lane.name, fr.leftW - 20, base, ctx, 3).length * lineH + 10 : 0,
    };
  };

  const bands: Band[] = [];
  const ungrouped = sortItems(items.filter((i) => (!i.swimlaneId || !known.has(i.swimlaneId)) && !rail?.ids.has(i.id)));
  if (ungrouped.length) bands.push(mk(null, ungrouped));
  ctx.lanes.forEach((lane) => bands.push(mk(lane, sortItems(items.filter((i) => i.swimlaneId === lane.id)))));

  const headerStrip = sw.style === 'sidebar' ? 0 : lineH + 6;
  const collapsedH = Math.max(lineH + 8, 22);
  const fixedH = (b: Band) => (b.lane?.collapsed ? collapsedH : (b.lane ? headerStrip : 0) + 4);
  // Height of a band at row-squeeze factor `k` — rows shrink, but never below what the lane label needs.
  const heightAt = (b: Band, k: number) => fixedH(b) + (b.lane?.collapsed ? 0 : Math.max(b.subRows * b.nat * k, b.minInner - 4));
  const bodyH = fr.bodyBottom - fr.bodyTop;
  const natural = bands.map((b) => heightAt(b, 1));
  const total = natural.reduce((n, h) => n + h, 0);
  const totalAt = (k: number) => bands.reduce((n, b) => n + heightAt(b, k), 0);

  // Squeeze rows a little (down to 72%) before resorting to a second page.
  const MIN_SQUEEZE = 0.72;
  let pages: Band[][]; let s = 1;
  if (total <= bodyH) pages = [bands];
  else if (totalAt(MIN_SQUEEZE) <= bodyH) {
    let lo = MIN_SQUEEZE; let hi = 1;
    for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (totalAt(mid) <= bodyH) lo = mid; else hi = mid; }
    pages = [bands]; s = lo;
  } else {
    pages = []; let cur: Band[] = []; let used = 0;
    bands.forEach((b, i) => {
      if (cur.length && used + natural[i] > bodyH) { pages.push(cur); cur = []; used = 0; }
      cur.push(b); used += natural[i];
    });
    if (cur.length) pages.push(cur);
  }
  const bandH = (b: Band) => heightAt(b, s);

  return pages.map((pageBands, pi) => {
    const bgPrims: Primitive[] = [];
    const itemPrims: Primitive[] = [];
    let y = fr.bodyTop;

    pageBands.forEach((b) => {
      const h = Math.min(bandH(b), fr.bodyBottom - y);
      const lc = b.color ?? cfg.palette.accent;
      const lane = b.lane;
      if (lane) {
        if (sw.style === 'header') {
          bgPrims.push({ kind: 'rect', x: fr.leftX, y, w: fr.plotRight - fr.leftX, h: headerStrip, fill: lc });
          bgPrims.push({ kind: 'rect', x: fr.leftX, y: y + headerStrip, w: fr.plotRight - fr.leftX, h: h - headerStrip, fill: bandColor(lc, ctx.bg, sw.bandOpacity) });
          itemPrims.push({ kind: 'text', x: fr.leftX + 8, y, w: fr.plotRight - fr.leftX - 16, h: headerStrip, text: fitText((lane.collapsed ? '▸ ' : '') + lane.name, fr.plotRight - fr.leftX - 20, base, ctx.fam, true), size: base, color: readableOn(lc), bold: true, align: 'left' });
        } else {
          bgPrims.push({ kind: 'rect', x: fr.leftX, y, w: fr.plotRight - fr.leftX, h, fill: bandColor(lc, ctx.bg, sw.bandOpacity) });
          if (sw.style === 'sidebar') {
            if (sw.showLabels) {
              bgPrims.push({ kind: 'rect', x: fr.leftX, y, w: fr.leftW - 4, h, fill: lc });
              const maxL = Math.max(1, Math.floor((h - 6) / lineH));
              const lines = wrapLines((lane.collapsed ? '▸ ' : '') + lane.name, fr.leftW - 20, base, ctx, maxL);
              const top = y + (h - lines.length * lineH) / 2;
              lines.forEach((l, i) => itemPrims.push({ kind: 'text', x: fr.leftX + 8, y: top + i * lineH, w: fr.leftW - 20, h: lineH, text: l, size: base, color: readableOn(lc), bold: true, align: 'left' }));
            }
          } else {
            itemPrims.push({ kind: 'text', x: fr.leftX + 8, y, w: fr.plotRight - fr.leftX - 16, h: headerStrip, text: fitText((lane.collapsed ? '▸ ' : '') + lane.name, fr.plotRight - fr.leftX - 20, base, ctx.fam, true), size: base, color: lc, bold: true, align: 'left' });
            bgPrims.push({ kind: 'rect', x: fr.leftX, y, w: 4, h, fill: lc });
          }
        }
      }
      if (lane && sw.border === 'dotted') {
        const bx = fr.leftX + (sw.style === 'sidebar' && sw.showLabels ? fr.leftW - 4 : 0);
        bgPrims.push({ kind: 'rect', x: bx, y: y + 0.5, w: fr.plotRight - bx, h: h - 1, stroke: tint(lc, 0.3), strokeWidth: 0.9, dash: [1.5, 2.5] });
      } else {
        bgPrims.push({ kind: 'line', x1: fr.leftX, y1: y + h, x2: fr.plotRight, y2: y + h, color: cfg.palette.grid, width: 0.5 });
      }

      if (!lane?.collapsed) {
        const subH = b.nat * s;
        const inner = h - fixedH(b);
        const top = y + (lane ? headerStrip : 0) + 2 + Math.max(0, (inner - b.subRows * subH) / 2);
        b.plans.forEach((p, i) => {
          const rowTop = top + b.rowOf[i] * subH;
          const cy = rowTop + b.topExtra + b.shapeH / 2 + (subH - (b.topExtra + b.shapeH + b.botExtra)) / 2;
          drawPlan(itemPrims, ctx, p, cy, b.shapeH);
        });
      }
      y += h;
    });

    return {
      width: fr.W, height: fr.H,
      primitives: [...chromeBefore(ctx, pi + 1, pages.length), ...bgPrims, ...gridlines(ctx, y), ...itemPrims, ...chromeAfter(ctx, y), ...(rail ? rail.draw(ctx.fr.axisY) : [])],
    };
  });
}

// ── Milestone rail (swimlane layout) ────────────────────────────────────────
// Ungrouped milestones sit on a rail above the time axis: marker on the axis'
// top edge, bold title + date stacked above it, extra levels when labels collide.

interface RailResult {
  ids: Set<string>;
  height: number;
  draw: (axisY: number) => Primitive[];
}

function planRail(ctx: Ctx, items: TLItem[]): RailResult {
  const { cfg, fr, base, lineH } = ctx;
  const size = cfg.milestone.size;
  const miles = items.filter((i) => i.type === 'MILESTONE');
  const empty: RailResult = { ids: new Set(), height: 0, draw: () => [] };
  if (miles.length === 0) return empty;

  const showDate = cfg.milestone.showDate;
  const blockH = lineH * (showDate ? 2 : 1) + 2;
  const levelH = blockH + 4;
  const dayW = fr.plotW / fr.totalDays;
  const entries = miles
    .map((item) => {
      const cx = ctx.x(parseYmd(item.startDate)) + dayW / 2;
      const date = showDate ? formatDate(item.startDate, cfg.milestone.dateFormat) : '';
      const lw = Math.min(190, Math.max(ctx.tw(item.title, base, true), date ? ctx.tw(date) : 0));
      return { item, cx, date, lw, half: Math.max(size, lw) / 2 + 4, level: 0 };
    })
    .sort((a, b) => a.cx - b.cx);
  const ends: number[] = [];
  entries.forEach((e) => {
    let l = ends.findIndex((end) => end + 4 <= e.cx - e.half);
    if (l === -1) { l = ends.length; ends.push(-Infinity); }
    ends[l] = e.cx + e.half;
    e.level = l;
  });
  const height = ends.length * levelH + size / 2 + 2;

  return {
    ids: new Set(miles.map((m) => m.id)),
    height,
    draw: (axisY) => {
      const out: Primitive[] = [];
      entries.forEach((e) => {
        const color = e.item.color ?? cfg.palette.milestoneDefault;
        const cy = axisY;
        const id = e.item.id;
        if (e.item.marker === 'triangle') {
          // Points down onto the axis.
          out.push({ kind: 'poly', points: [[e.cx - size / 2, cy - size / 2], [e.cx + size / 2, cy - size / 2], [e.cx, cy + size / 2]], fill: color, itemId: id });
        } else {
          drawMilestoneMarker(out, ctx, e.item, cy, size, color);
        }
        const w = Math.max(e.lw, size) + 8;
        const x = Math.max(fr.leftX, Math.min(e.cx - w / 2, fr.W - MARGIN.r - w));
        const bottom = axisY - size / 2 - 3 - e.level * levelH;
        const top = bottom - blockH;
        out.push({ kind: 'text', x, y: top, w, h: lineH, text: fitText(e.item.title, w, base, ctx.fam, true), size: base, color: cfg.palette.text, bold: true, align: 'center', itemId: id });
        if (e.date) out.push({ kind: 'text', x, y: top + lineH, w, h: lineH, text: e.date, size: Math.max(7, base - 1), color: cfg.palette.muted, align: 'center', itemId: id });
      });
      return out;
    },
  };
}

// ── Milestone-line layout ───────────────────────────────────────────────────

function layoutMilestoneLine(ctx: Ctx, items: TLItem[]): LayoutPage[] {
  const { cfg, fr, base, lineH } = ctx;
  const ordered = sortItems(items).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const miles = ordered.filter((i) => i.type === 'MILESTONE').map((i) => {
    const p = planItem(ctx, i);
    // Titles here are drawn bold, so pack/fit using the bold width (capped like the label box).
    p.lw = Math.min(190, Math.max(ctx.tw(i.title, ctx.base, true), cfg.milestone.showDate ? ctx.tw(formatDate(i.startDate, cfg.milestone.dateFormat), Math.max(7, ctx.base - 2)) : 0));
    return p;
  });
  const tasks = ordered.filter((i) => i.type === 'TASK').map((i) => planItem(ctx, i));
  const bodyH = fr.bodyBottom - fr.bodyTop;

  const taskRowOf = pack(tasks);
  const taskRows = tasks.length ? Math.max(...taskRowOf) + 1 : 0;
  const taskRowH = cfg.task.height + (tasks.some((t) => t.side === 'above') ? lineH + 2 : 0) + 8;
  const taskZone = tasks.length ? Math.min(taskRows * taskRowH, bodyH * 0.5) : 0;
  const tRowH = taskRows ? Math.min(taskRowH, taskZone / taskRows) : taskRowH;

  const mileZoneH = bodyH - taskZone - (tasks.length ? 8 : 0);
  const lineY = fr.bodyTop + mileZoneH / 2;
  const size = cfg.milestone.size;
  const labelH = lineH * (cfg.milestone.showDate ? 2 : 1) + 2;
  const levelH = labelH + 8;
  const maxLevels = Math.max(1, Math.min(4, Math.floor((mileZoneH / 2 - size / 2 - 6) / levelH)));

  // Assign each milestone to an above/below level so labels don't collide.
  const levelEnds: Record<string, number> = {};
  const order: { side: 'above' | 'below'; level: number }[] = [];
  for (let l = 0; l < maxLevels; l++) { order.push({ side: 'above', level: l }, { side: 'below', level: l }); }
  const placed = miles.map((m) => {
    const half = Math.max(size, m.lw) / 2;
    let best = order[0]; let bestOverlap = Infinity;
    for (const o of order) {
      const key = `${o.side}${o.level}`;
      const overlap = (levelEnds[key] ?? -Infinity) + 6 - (m.cx - half);
      if (overlap <= 0) { best = o; bestOverlap = 0; break; }
      if (overlap < bestOverlap) { bestOverlap = overlap; best = o; }
    }
    levelEnds[`${best.side}${best.level}`] = m.cx + half;
    return { m, ...best };
  });

  const bgPrims: Primitive[] = [];
  const itemPrims: Primitive[] = [];
  bgPrims.push({ kind: 'rect', x: fr.plotX, y: lineY - 2, w: fr.plotW, h: 4, rx: 2, fill: cfg.palette.accent });

  placed.forEach(({ m, side, level }) => {
    const color = m.color;
    const reach = size / 2 + 6 + level * levelH;
    const textTop = side === 'above' ? lineY - reach - labelH : lineY + reach;
    itemPrims.push({
      kind: 'line', x1: m.cx, y1: lineY, x2: m.cx, y2: side === 'above' ? textTop + labelH : textTop,
      color: cfg.palette.muted, width: 0.75, itemId: m.item.id,
    });
    drawMilestoneMarker(itemPrims, ctx, m.item, lineY, size, color);
    const w = Math.max(m.lw, size) + 8;
    const x = Math.max(fr.plotX - 4, Math.min(m.cx - w / 2, fr.plotRight - w + 4));
    const title = m.item.title;
    const date = cfg.milestone.showDate ? formatDate(m.item.startDate, cfg.milestone.dateFormat) : '';
    itemPrims.push({ kind: 'text', x, y: textTop, w, h: lineH, text: fitText(title, w, base, ctx.fam, true), size: base, color: cfg.palette.text, bold: true, align: 'center', itemId: m.item.id });
    if (date) itemPrims.push({ kind: 'text', x, y: textTop + lineH, w, h: lineH, text: date, size: Math.max(7, base - 2), color: cfg.palette.muted, align: 'center', itemId: m.item.id });
  });

  if (tasks.length) {
    const zoneTop = fr.bodyBottom - taskZone;
    bgPrims.push({ kind: 'line', x1: fr.leftX, y1: zoneTop - 4, x2: fr.plotRight, y2: zoneTop - 4, color: cfg.palette.grid, width: 0.75 });
    tasks.forEach((p, i) => {
      const rowTop = zoneTop + taskRowOf[i] * tRowH;
      const topExtra = p.side === 'above' ? lineH + 2 : 0;
      drawPlan(itemPrims, ctx, p, rowTop + topExtra + cfg.task.height / 2 + 4, cfg.task.height);
    });
  }

  return [{
    width: fr.W, height: fr.H,
    primitives: [...chromeBefore(ctx, 1, 1), ...bgPrims, ...gridlines(ctx, fr.bodyBottom), ...itemPrims, ...chromeAfter(ctx, fr.bodyBottom)],
  }];
}

// ── Entry point ─────────────────────────────────────────────────────────────

export function layoutTimeline(input: LayoutInput): LayoutResult {
  const cfg = input.config;
  const today = input.today ?? todayYmd();
  const items = input.items.filter((i) => !isNaN(parseYmd(i.startDate).getTime()) && !isNaN(parseYmd(i.endDate).getTime()));
  const lanes = [...input.lanes].sort((a, b) => a.sortOrder - b.sortOrder);
  const titleShown = cfg.slide.showTitle && !!input.title;
  const fam = cfg.font.family;
  const base = cfg.font.baseSize;
  const colors = cfg.palette.laneColors.length ? cfg.palette.laneColors : [cfg.palette.accent];
  const laneIndex = new Map(lanes.map((l, i) => [l.id, i]));

  const makeCtx = (fr: Frame): Ctx => ({
    cfg, fr, fam, base, lineH: base + 3, bg: cfg.slide.background, title: input.title, today, lanes,
    laneColor: (id) => {
      if (!id) return null;
      const idx = laneIndex.get(id);
      if (idx === undefined) return null;
      return lanes[idx].color ?? colors[idx % colors.length];
    },
    x: (d) => fr.plotX + (diffDays(fr.range.start, d) / fr.totalDays) * fr.plotW,
    tw: (text, size = base, bold = false) => measureText(text, size, fam, bold),
  });

  let ctx = makeCtx(buildFrame(cfg, items, titleShown, today));

  // Milestone rail: needs the x-scale (independent of its height) to size itself, then the frame is rebuilt with that height reserved above the axis.
  let rail: RailResult | undefined;
  if (cfg.layout === 'swimlane' && cfg.milestone.railAboveAxis && cfg.axis.position === 'top') {
    const known = new Set(lanes.map((l) => l.id));
    const r = planRail(ctx, items.filter((i) => !i.swimlaneId || !known.has(i.swimlaneId)));
    if (r.height > 0) {
      rail = r;
      ctx = makeCtx(buildFrame(cfg, items, titleShown, today, r.height));
    }
  }

  const pages = cfg.layout === 'swimlane' ? layoutSwimlane(ctx, items, rail)
    : cfg.layout === 'milestone-line' ? layoutMilestoneLine(ctx, items)
    : layoutGantt(ctx, items);

  return { pages, paginated: pages.length > 1, scale: ctx.fr.scale };
}
