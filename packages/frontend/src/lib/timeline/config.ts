import type { StyleOverrides, TemplateConfig } from './types';

// Fallback used only if a template's stored config is missing keys (the API
// already fills every default via Zod; this keeps the renderer and the
// template editor safe against older/partial JSON).
export const DEFAULT_CONFIG: TemplateConfig = {
  version: 1,
  layout: 'gantt',
  slide: { size: '16:9', background: '#FFFFFF', showTitle: true, titleAlign: 'left', titleSize: 26, titleColor: '#1F2937' },
  font: { family: 'Calibri', baseSize: 11 },
  palette: {
    text: '#1F2937', muted: '#6B7280', grid: '#E5E7EB', accent: '#2563AB',
    taskDefault: '#2563AB', milestoneDefault: '#E8501E',
    laneColors: ['#2563AB', '#0E9F6E', '#E8501E', '#8B5CF6', '#D97706', '#0891B2'],
  },
  axis: { scale: 'auto', position: 'top', style: 'filled', fill: '#1F3A5F', textColor: '#FFFFFF', pastTint: 0, yearLabels: false, yearColor: '#E8501E', showToday: true, todayColor: '#DC2626', gridlines: 'major' },
  task: { height: 20, shape: 'pill', labelPosition: 'inside', showDates: false, datesPlacement: 'inline', showPercent: true, percentInside: false, progressStyle: 'tint', colorSource: 'lane', boldLabels: false },
  milestone: { size: 18, labelPosition: 'right', showDate: true, dateFormat: 'dd MMM yy', railAboveAxis: false },
  swimlane: { style: 'band', labelWidth: 130, bandOpacity: 0.12, showLabels: true, border: 'none', rowMode: 'pack' },
  table: { labelWidth: 220, showStart: false, showEnd: false, showDuration: true, showAssignee: false },
};

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function deepMerge<T>(base: T, over: unknown): T {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : (over as T);
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue;
    out[k] = isObj(out[k]) && isObj(v) ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

/** defaults ← template config ← per-timeline overrides. */
export function resolveConfig(templateConfig: Partial<TemplateConfig> | null | undefined, overrides?: StyleOverrides | null): TemplateConfig {
  return deepMerge(deepMerge(DEFAULT_CONFIG, templateConfig ?? {}), overrides ?? {});
}
