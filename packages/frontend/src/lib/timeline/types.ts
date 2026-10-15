// ── Timeline Builder — shared types ─────────────────────────────────────────
// TemplateConfig mirrors packages/api/src/lib/timelineTemplateConfig.ts (the
// Zod schema is the source of truth) — keep both in sync when adding a field.

export type ItemType = 'TASK' | 'MILESTONE';

export const TASK_MARKERS = ['pill', 'bar', 'chevron'] as const;
export const MILESTONE_MARKERS = ['diamond', 'flag', 'star', 'circle', 'triangle'] as const;

export interface TLItem {
  id: string;
  swimlaneId: string | null;
  title: string;
  type: ItemType;
  marker: string;
  color: string | null;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD (== startDate for milestones)
  durationDays: number; // working days, derived server-side
  percentComplete: number;
  assignee: string | null;
  notes: string | null;
  /** Set = generated from a Task: title, dates, assignee and % (from status) are read-only here. */
  taskId: string | null;
  /** View-only: kept in the table but left off the timeline view and exports. */
  hidden?: boolean;
  /** Actual dates (task-linked items copy them from the task; a milestone has one — its end). */
  actualStartDate?: string | null;
  actualEndDate?: string | null;
  /** Set only by applyDateView(): the planned dates drawn as a dashed outline behind the actual bar ("both" view). */
  baseline?: { startDate: string; endDate: string };
  /** Set only by applyDateView(): draw the baseline as a dashed outline ("both" view). */
  showGhost?: boolean;
  /** Schedule variance in working days (+ late, − early, null = no verdict yet). A parent takes its worst subtask. */
  delayDays?: number | null;
  sortOrder: number;
}

/** Whether a row is drawn on the timeline: not hidden by hand, and not 100% complete while "hide completed" is on. */
export function shownOnTimeline(
  i: Pick<TLItem, 'hidden' | 'percentComplete' | 'actualStartDate' | 'actualEndDate'>,
  hideDone: boolean,
  dateView: 'BASELINE' | 'ACTUAL' | 'BOTH' = 'BASELINE',
): boolean {
  if (dateView === 'ACTUAL' && !i.actualStartDate && !i.actualEndDate) return false; // nothing actual to draw
  return !i.hidden && !(hideDone && i.percentComplete >= 100);
}

export interface TLLane {
  id: string;
  name: string;
  color: string | null; // null = auto from template palette
  collapsed: boolean;
  sortOrder: number;
  /** Set = this lane is live-linked to that Task List. */
  taskListId: string | null;
}

export type LayoutKind = 'gantt' | 'swimlane' | 'milestone-line';
export type AxisScale = 'auto' | 'week' | 'fortnight' | 'month' | 'quarter' | 'year';
export type DateFormat = 'dd MMM yy' | 'dd/MM/yyyy' | 'MMM d' | 'd MMM';

export interface TemplateConfig {
  version: 1;
  layout: LayoutKind;
  slide: {
    size: '16:9' | '4:3';
    background: string;
    showTitle: boolean;
    titleAlign: 'left' | 'center';
    titleSize: number;
    titleColor: string;
    /** Never split a long plan across slides: shrink it (uniformly) until it fits on one. */
    fitOnePage: boolean;
  };
  font: { family: string; baseSize: number };
  palette: {
    text: string; muted: string; grid: string; accent: string;
    taskDefault: string; milestoneDefault: string; laneColors: string[];
  };
  axis: {
    scale: AxisScale;
    position: 'top' | 'bottom';
    style: 'filled' | 'plain' | 'underline';
    fill: string; textColor: string;
    /** Fill of the lower tier; unset = same as `fill`. */
    minorFill?: string;
    /** 0–0.8: lightens the part of the axis that is before today. */
    pastTint: number;
    /** Big year at each end of the axis; tier 1 then shows plain month names. */
    yearLabels: boolean; yearColor: string;
    showToday: boolean; todayColor: string;
    /** A slim line along the axis from the plan's first start date to today — elapsed time at a glance. */
    progressLine: boolean; progressColor: string;
    gridlines: 'none' | 'major' | 'all';
  };
  task: {
    height: number;
    shape: 'pill' | 'rounded' | 'square';
    labelPosition: 'inside' | 'left' | 'right' | 'above';
    showDates: boolean;
    /** 'right' = date range beyond the bar's far end instead of inline with the label. */
    datesPlacement: 'inline' | 'right';
    showPercent: boolean;
    /** Draw the % inside the bar rather than after the label. */
    percentInside: boolean;
    /** tint: lighter remainder · shade: darker completed part. */
    progressStyle: 'tint' | 'shade';
    colorSource: 'lane' | 'default';
    /** Colour for bars at 0% (unless the item has its own colour). */
    notStartedColor?: string;
    /** Colour of the not-yet-completed part of a bar that shows progress; unset = a lighter tint of the bar colour. */
    trackColor?: string;
    boldLabels: boolean;
  };
  milestone: {
    size: number;
    labelPosition: 'below' | 'above' | 'right';
    showDate: boolean;
    dateFormat: DateFormat;
    /** Swimlane layout: ungrouped milestones sit on a rail above the axis. */
    railAboveAxis: boolean;
  };
  swimlane: {
    style: 'band' | 'sidebar' | 'header';
    labelWidth: number;
    bandOpacity: number;
    /** Fill of the translucent band behind each lane; unset = the lane's own colour. Drawn at bandOpacity. */
    bandColor?: string;
    /** Empty space (pt) between neighbouring lanes, so each band reads as its own block. 0 = lanes touch. */
    gap: number;
    showLabels: boolean;
    border: 'none' | 'dotted';
    /** pack: items share a row when they do not overlap · single: one item per row, in grid order. */
    rowMode: 'pack' | 'single';
  };
  table: {
    labelWidth: number;
    showStart: boolean; showEnd: boolean; showDuration: boolean; showAssignee: boolean;
  };
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] };
export type StyleOverrides = DeepPartial<TemplateConfig>;

export interface TimelineTemplateDTO {
  id: string;
  name: string;
  description: string | null;
  category: string;
  isBuiltIn: boolean;
  builtInKey: string | null;
  isActive: boolean;
  sortOrder: number;
  config: TemplateConfig;
  createdAt: string;
  updatedAt: string;
}

export interface TimelineSummary {
  id: string;
  name: string;
  description: string | null;
  template: { id: string; name: string } | null;
  itemCount: number;
  swimlaneCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TimelineDetail {
  timeline: {
    id: string; name: string; description: string | null; templateId: string | null;
    styleOverrides: StyleOverrides; taskGranularity: 'TASKS' | 'SUBTASKS'; hideDone?: boolean; dateView?: 'BASELINE' | 'ACTUAL' | 'BOTH'; showDelays?: boolean; createdAt: string; updatedAt: string;
  };
  template: { id: string; name: string; isActive: boolean; config: TemplateConfig } | null;
  swimlanes: TLLane[];
  items: TLItem[];
}

// ── Drawing primitives — the single output of the layout engine. The SVG
// preview, PNG export and native-PPTX export all consume this same list, so
// all three always match. Units are points (1/72in): a 16:9 slide is 960×540
// and a 4:3 slide 720×540, which maps 1:1 onto PowerPoint's 13.33×7.5in/10×7.5in.

export type ShapeKind = 'ellipse' | 'diamond' | 'triangle';

interface Base { itemId?: string }
export interface RectPrim extends Base {
  kind: 'rect'; x: number; y: number; w: number; h: number; rx?: number;
  fill?: string; stroke?: string; strokeWidth?: number; dash?: number[];
}
export interface ShapePrim extends Base {
  kind: 'shape'; shape: ShapeKind; x: number; y: number; w: number; h: number; fill: string; stroke?: string; strokeWidth?: number;
}
export interface PolyPrim extends Base {
  kind: 'poly'; points: [number, number][]; fill: string; stroke?: string; strokeWidth?: number;
}
export interface LinePrim extends Base {
  kind: 'line'; x1: number; y1: number; x2: number; y2: number; color: string; width: number; dash?: number[];
}
export interface TextPrim extends Base {
  kind: 'text'; x: number; y: number; w: number; h: number; text: string; size: number; color: string;
  bold?: boolean; italic?: boolean; align: 'left' | 'center' | 'right'; valign?: 'top' | 'middle';
}
export type Primitive = RectPrim | ShapePrim | PolyPrim | LinePrim | TextPrim;

export interface LayoutPage {
  width: number;
  height: number;
  primitives: Primitive[];
}

export interface LayoutResult {
  pages: LayoutPage[];
  /** True when the plan had to be split across several pages to stay legible. */
  paginated: boolean;
  /** Time axis scale actually used (after 'auto' resolution). */
  scale: Exclude<AxisScale, 'auto'>;
  /** Set when "fit on one slide" had to shrink the plan: 0–1, the fraction of normal size it was drawn at. */
  fitScale?: number;
  /** "Fit on one slide" is on but the plan is too long to fit even at the maximum shrink, so it is still split. */
  fitFailed?: boolean;
  /** Style tweaks "fit on one slide" made to keep the text larger (e.g. "task labels beside the bars"). */
  fitAdjusted?: string[];
}
