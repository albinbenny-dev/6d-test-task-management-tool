import { z } from 'zod';
import { prisma } from './prisma.js';

// ── Timeline Builder — template config ──────────────────────────────────────
// The JSON stored in TimelineTemplate.config (and, as a partial, in
// Timeline.styleOverrides). The frontend renderer (src/lib/timeline/) is the
// only consumer that interprets it; the frontend keeps a mirrored TypeScript
// type in src/types — keep both in sync when adding a field. Every field has
// a Zod default so older stored templates keep parsing after new fields land.

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

export const TASK_MARKERS = ['pill', 'bar', 'chevron'] as const;
export const MILESTONE_MARKERS = ['diamond', 'flag', 'star', 'circle', 'triangle'] as const;

export const TemplateConfigSchema = z.object({
  version: z.literal(1).default(1),
  // gantt          — one row per item, optional data columns on the left
  // swimlane       — one horizontal band per swimlane, items packed into rows
  // milestone-line — a single time line with milestones above/below it
  layout: z.enum(['gantt', 'swimlane', 'milestone-line']).default('gantt'),
  slide: z.object({
    size: z.enum(['16:9', '4:3']).default('16:9'),
    background: hex.default('#FFFFFF'),
    showTitle: z.boolean().default(true),
    titleAlign: z.enum(['left', 'center']).default('left'),
    titleSize: z.number().min(12).max(60).default(26),
    titleColor: hex.default('#1F2937'),
  }).default({}),
  font: z.object({
    family: z.string().min(1).max(60).default('Calibri'),
    baseSize: z.number().min(7).max(20).default(11),
  }).default({}),
  palette: z.object({
    text: hex.default('#1F2937'),
    muted: hex.default('#6B7280'),
    grid: hex.default('#E5E7EB'),
    accent: hex.default('#2563AB'),
    taskDefault: hex.default('#2563AB'),
    milestoneDefault: hex.default('#E8501E'),
    laneColors: z.array(hex).min(1).max(12).default(['#2563AB', '#0E9F6E', '#E8501E', '#8B5CF6', '#D97706', '#0891B2']),
  }).default({}),
  axis: z.object({
    scale: z.enum(['auto', 'week', 'fortnight', 'month', 'quarter', 'year']).default('auto'),
    position: z.enum(['top', 'bottom']).default('top'),
    style: z.enum(['filled', 'plain', 'underline']).default('filled'),
    fill: hex.default('#1F3A5F'),
    minorFill: hex.optional(), // second (lower) tier fill; unset = same as fill
    textColor: hex.default('#FFFFFF'),
    pastTint: z.number().min(0).max(0.8).default(0), // lightens the part of the axis before today
    yearLabels: z.boolean().default(false), // big year at each end of the axis; tier 1 then shows plain months
    yearColor: hex.default('#E8501E'),
    showToday: z.boolean().default(true),
    todayColor: hex.default('#DC2626'),
    gridlines: z.enum(['none', 'major', 'all']).default('major'),
  }).default({}),
  task: z.object({
    height: z.number().min(8).max(60).default(20),
    shape: z.enum(['pill', 'rounded', 'square']).default('pill'),
    labelPosition: z.enum(['inside', 'left', 'right', 'above']).default('inside'),
    showDates: z.boolean().default(false),
    datesPlacement: z.enum(['inline', 'right']).default('inline'), // right = date range beyond the bar's far end
    showPercent: z.boolean().default(true),
    percentInside: z.boolean().default(false), // draw the % inside the bar instead of after the label
    progressStyle: z.enum(['tint', 'shade']).default('tint'), // tint: lighter remainder, shade: darker completed part
    colorSource: z.enum(['lane', 'default']).default('lane'),
    notStartedColor: hex.optional(), // bars at 0% (unless they have their own colour)
    boldLabels: z.boolean().default(false),
  }).default({}),
  milestone: z.object({
    size: z.number().min(8).max(48).default(18),
    labelPosition: z.enum(['below', 'above', 'right']).default('right'),
    showDate: z.boolean().default(true),
    dateFormat: z.enum(['dd MMM yy', 'dd/MM/yyyy', 'MMM d', 'd MMM']).default('dd MMM yy'),
    railAboveAxis: z.boolean().default(false), // swimlane layout: ungrouped milestones sit on a rail above the axis
  }).default({}),
  swimlane: z.object({
    style: z.enum(['band', 'sidebar', 'header']).default('band'),
    labelWidth: z.number().min(60).max(300).default(130),
    bandOpacity: z.number().min(0).max(0.5).default(0.12),
    showLabels: z.boolean().default(true),
    border: z.enum(['none', 'dotted']).default('none'),
    rowMode: z.enum(['pack', 'single']).default('pack'), // pack: share rows when items do not overlap · single: one item per row, in grid order
  }).default({}),
  // Left-hand data table, gantt layout only. Title is always shown.
  table: z.object({
    labelWidth: z.number().min(120).max(420).default(220),
    showStart: z.boolean().default(false),
    showEnd: z.boolean().default(false),
    showDuration: z.boolean().default(true),
    showAssignee: z.boolean().default(false),
  }).default({}),
});

export type TemplateConfig = z.infer<typeof TemplateConfigSchema>;

/** Partial form used by Timeline.styleOverrides (every nested field optional, no defaults injected). */
export const StyleOverridesSchema = z.object({
  layout: TemplateConfigSchema.shape.layout.optional(),
  slide: z.object({
    size: z.enum(['16:9', '4:3']), background: hex, showTitle: z.boolean(),
    titleAlign: z.enum(['left', 'center']), titleSize: z.number().min(12).max(60), titleColor: hex,
  }).partial().optional(),
  font: z.object({ family: z.string().min(1).max(60), baseSize: z.number().min(7).max(20) }).partial().optional(),
  palette: z.object({
    text: hex, muted: hex, grid: hex, accent: hex, taskDefault: hex, milestoneDefault: hex,
    laneColors: z.array(hex).min(1).max(12),
  }).partial().optional(),
  axis: z.object({
    scale: z.enum(['auto', 'week', 'fortnight', 'month', 'quarter', 'year']), position: z.enum(['top', 'bottom']),
    style: z.enum(['filled', 'plain', 'underline']), fill: hex, minorFill: hex, textColor: hex,
    pastTint: z.number().min(0).max(0.8), yearLabels: z.boolean(), yearColor: hex, showToday: z.boolean(),
    todayColor: hex, gridlines: z.enum(['none', 'major', 'all']),
  }).partial().optional(),
  task: z.object({
    height: z.number().min(8).max(60), shape: z.enum(['pill', 'rounded', 'square']),
    labelPosition: z.enum(['inside', 'left', 'right', 'above']), showDates: z.boolean(), datesPlacement: z.enum(['inline', 'right']),
    showPercent: z.boolean(), percentInside: z.boolean(), progressStyle: z.enum(['tint', 'shade']),
    colorSource: z.enum(['lane', 'default']), notStartedColor: hex, boldLabels: z.boolean(),
  }).partial().optional(),
  milestone: z.object({
    size: z.number().min(8).max(48), labelPosition: z.enum(['below', 'above', 'right']),
    showDate: z.boolean(), dateFormat: z.enum(['dd MMM yy', 'dd/MM/yyyy', 'MMM d', 'd MMM']), railAboveAxis: z.boolean(),
  }).partial().optional(),
  swimlane: z.object({
    style: z.enum(['band', 'sidebar', 'header']), labelWidth: z.number().min(60).max(300),
    bandOpacity: z.number().min(0).max(0.5), showLabels: z.boolean(), border: z.enum(['none', 'dotted']), rowMode: z.enum(['pack', 'single']),
  }).partial().optional(),
  table: z.object({
    labelWidth: z.number().min(120).max(420), showStart: z.boolean(), showEnd: z.boolean(),
    showDuration: z.boolean(), showAssignee: z.boolean(),
  }).partial().optional(),
}).strict();

export function parseConfig(raw: string): TemplateConfig {
  try {
    return TemplateConfigSchema.parse(JSON.parse(raw));
  } catch {
    return TemplateConfigSchema.parse({});
  }
}

// ── Built-in templates ──────────────────────────────────────────────────────

type BuiltIn = {
  key: string;
  name: string;
  description: string;
  category: string;
  sortOrder: number;
  config: z.input<typeof TemplateConfigSchema>;
};

export const BUILT_IN_TEMPLATES: BuiltIn[] = [
  {
    key: 'classic-gantt',
    name: 'Classic Gantt',
    description: 'Task names on the left with duration, bars on a monthly axis.',
    category: 'Gantt',
    sortOrder: 0,
    config: {
      layout: 'gantt',
      axis: { scale: 'auto', style: 'filled', fill: '#1F3A5F' },
      task: { height: 16, shape: 'rounded', labelPosition: 'right', showPercent: true },
      milestone: { labelPosition: 'right', showDate: true },
      table: { showDuration: true, showStart: true, showEnd: true },
    },
  },
  {
    key: 'swimlane-roadmap',
    name: 'Swimlane Roadmap',
    description: 'One coloured band per workstream with bars and milestones packed inside.',
    category: 'Roadmap',
    sortOrder: 1,
    config: {
      layout: 'swimlane',
      axis: { style: 'filled', fill: '#2563AB' },
      task: { height: 22, shape: 'pill', labelPosition: 'inside', showPercent: false },
      milestone: { labelPosition: 'below', showDate: true },
      swimlane: { style: 'sidebar', labelWidth: 130, bandOpacity: 0.12 },
    },
  },
  {
    key: 'milestone-line',
    name: 'Milestone Line',
    description: 'A single time line with milestones alternating above and below.',
    category: 'Executive',
    sortOrder: 2,
    config: {
      layout: 'milestone-line',
      axis: { style: 'underline', textColor: '#1F2937', fill: '#2563AB', gridlines: 'none' },
      task: { height: 14, shape: 'pill', labelPosition: 'above' },
      milestone: { size: 22, labelPosition: 'below', showDate: true },
    },
  },
  {
    key: 'executive-dark',
    name: 'Executive Dark',
    description: 'Dark background swimlane view for steering-committee decks.',
    category: 'Executive',
    sortOrder: 3,
    config: {
      layout: 'swimlane',
      slide: { background: '#0F172A', titleColor: '#F8FAFC' },
      palette: {
        text: '#E2E8F0', muted: '#94A3B8', grid: '#1E293B', accent: '#38BDF8',
        taskDefault: '#38BDF8', milestoneDefault: '#FBBF24',
        laneColors: ['#38BDF8', '#34D399', '#FBBF24', '#F472B6', '#A78BFA', '#FB923C'],
      },
      axis: { style: 'filled', fill: '#1E293B', textColor: '#E2E8F0', todayColor: '#F87171' },
      task: { height: 22, shape: 'pill', labelPosition: 'inside', showPercent: false },
      swimlane: { style: 'sidebar', bandOpacity: 0.18 },
    },
  },
  {
    key: 'roadmap-progress',
    name: 'Roadmap with Progress',
    description: 'Navy swimlanes, fortnightly dates, milestone rail above the axis, darker completed portion with % inside each bar.',
    category: 'Roadmap',
    sortOrder: 6,
    config: {
      layout: 'swimlane',
      slide: { showTitle: false },
      palette: {
        text: '#111827', muted: '#6B7280', grid: '#E5E7EB', accent: '#2E75B6',
        taskDefault: '#00B050', milestoneDefault: '#FF0000',
        laneColors: ['#1F4E79', '#2E75B6', '#5B9BD5', '#2F5597', '#1B7F8C', '#7F6000'],
      },
      axis: {
        scale: 'fortnight', style: 'filled', fill: '#203864', minorFill: '#4A86B8', pastTint: 0.35,
        yearLabels: true, yearColor: '#F26522', todayColor: '#C00000', gridlines: 'none', showToday: true,
      },
      task: {
        height: 18, shape: 'pill', labelPosition: 'left', showDates: true, datesPlacement: 'right',
        showPercent: true, percentInside: true, progressStyle: 'shade', colorSource: 'default',
        notStartedColor: '#7F7F7F', boldLabels: true,
      },
      milestone: { size: 18, labelPosition: 'right', showDate: true, dateFormat: 'd MMM', railAboveAxis: true },
      swimlane: { style: 'sidebar', labelWidth: 135, bandOpacity: 0.05, border: 'dotted', showLabels: true, rowMode: 'single' },
    },
  },
  {
    key: 'clean-minimal',
    name: 'Clean Minimal',
    description: 'Light, low-ink gantt with thin square bars — good for printing.',
    category: 'Gantt',
    sortOrder: 4,
    config: {
      layout: 'gantt',
      palette: { accent: '#374151', taskDefault: '#374151', milestoneDefault: '#B91C1C', grid: '#E5E7EB' },
      axis: { style: 'underline', textColor: '#374151', fill: '#374151', gridlines: 'major' },
      task: { height: 10, shape: 'square', labelPosition: 'right', showPercent: false },
      table: { showDuration: true, showStart: false, showEnd: false },
    },
  },
  {
    key: 'compact-lanes',
    name: 'Compact Lanes',
    description: 'Dense header-style swimlanes that fit large plans on one slide.',
    category: 'Roadmap',
    sortOrder: 5,
    config: {
      layout: 'swimlane',
      axis: { scale: 'quarter', style: 'plain', textColor: '#1F2937', fill: '#E5E7EB' },
      task: { height: 14, shape: 'rounded', labelPosition: 'inside', showPercent: false },
      milestone: { size: 14, labelPosition: 'right', showDate: false },
      swimlane: { style: 'header', bandOpacity: 0.1 },
    },
  },
];

/** Upserts every built-in on startup by builtInKey. Never overwrites an edited built-in's config. */
export async function ensureBuiltInTemplates(): Promise<void> {
  for (const t of BUILT_IN_TEMPLATES) {
    const existing = await prisma.timelineTemplate.findUnique({ where: { builtInKey: t.key } });
    if (existing) continue;
    await prisma.timelineTemplate.create({
      data: {
        builtInKey: t.key,
        name: t.name,
        description: t.description,
        category: t.category,
        sortOrder: t.sortOrder,
        config: JSON.stringify(TemplateConfigSchema.parse(t.config)),
      },
    });
  }
}

export function builtInDefault(key: string): BuiltIn | undefined {
  return BUILT_IN_TEMPLATES.find((t) => t.key === key);
}
