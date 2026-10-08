import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react';
import type { TemplateConfig } from '../../lib/timeline/types';

// ── Declarative control list ────────────────────────────────────────────────
// One field table drives both the Super Admin template editor (edits the
// template's config) and the builder's Style tab (edits a timeline's overrides),
// so a new config option only needs adding here + in the Zod schema + renderer.

type Opt = [value: string, label: string];
type Field =
  | { path: string; label: string; kind: 'select'; options: Opt[]; hint?: string; when?: (c: TemplateConfig) => boolean }
  | { path: string; label: string; kind: 'toggle'; hint?: string; when?: (c: TemplateConfig) => boolean }
  | { path: string; label: string; kind: 'number'; min: number; max: number; step?: number; hint?: string; when?: (c: TemplateConfig) => boolean }
  | { path: string; label: string; kind: 'color'; optional?: boolean; hint?: string; when?: (c: TemplateConfig) => boolean }
  | { path: string; label: string; kind: 'colors'; hint?: string; when?: (c: TemplateConfig) => boolean };

interface Section { title: string; fields: Field[]; defaultOpen?: boolean }

const FONTS = ['Calibri', 'Arial', 'Segoe UI', 'Tahoma', 'Verdana', 'Georgia', 'Trebuchet MS', 'Times New Roman', 'Courier New'];

export const SECTIONS: Section[] = [
  {
    title: 'Layout', defaultOpen: true,
    fields: [
      { path: 'layout', label: 'Layout style', kind: 'select', options: [['gantt', 'Gantt — task table + bars'], ['swimlane', 'Swimlanes — bands per workstream'], ['milestone-line', 'Milestone line — one time line']] },
      { path: 'slide.size', label: 'Slide size', kind: 'select', options: [['16:9', 'Widescreen 16:9'], ['4:3', 'Standard 4:3']] },
      { path: 'slide.showTitle', label: 'Show title', kind: 'toggle' },
      { path: 'slide.titleAlign', label: 'Title alignment', kind: 'select', options: [['left', 'Left'], ['center', 'Centre']], when: (c) => c.slide.showTitle },
      { path: 'slide.titleSize', label: 'Title size (pt)', kind: 'number', min: 12, max: 60, when: (c) => c.slide.showTitle },
    ],
  },
  {
    title: 'Time axis',
    fields: [
      { path: 'axis.scale', label: 'Scale', kind: 'select', options: [['auto', 'Auto (fit the plan)'], ['week', 'Weeks'], ['fortnight', 'Fortnights'], ['month', 'Months'], ['quarter', 'Quarters'], ['year', 'Years']] },
      { path: 'axis.position', label: 'Position', kind: 'select', options: [['top', 'Top'], ['bottom', 'Bottom']] },
      { path: 'axis.style', label: 'Style', kind: 'select', options: [['filled', 'Filled header'], ['plain', 'Plain'], ['underline', 'Underlined']] },
      { path: 'axis.gridlines', label: 'Gridlines', kind: 'select', options: [['none', 'None'], ['major', 'Major only'], ['all', 'Every tick']] },
      { path: 'axis.showToday', label: 'Show today marker', kind: 'toggle' },
      { path: 'axis.pastTint', label: 'Lighten elapsed time', kind: 'number', min: 0, max: 0.8, step: 0.05, hint: '0 = off. Lightens the part of the axis before today.' },
      { path: 'axis.yearLabels', label: 'Year at both ends', kind: 'toggle', hint: 'Shows the year big at each end of the axis; the top tier then lists plain months.' },
    ],
  },
  {
    title: 'Tasks',
    fields: [
      { path: 'task.height', label: 'Bar height', kind: 'number', min: 8, max: 60 },
      { path: 'task.shape', label: 'Bar shape', kind: 'select', options: [['pill', 'Pill'], ['rounded', 'Rounded'], ['square', 'Square']], hint: 'Items set to "Square bar" or "Chevron" keep their own shape.' },
      { path: 'task.labelPosition', label: 'Label position', kind: 'select', options: [['inside', 'Inside bar'], ['right', 'Right of bar'], ['left', 'Left of bar'], ['above', 'Above bar']], when: (c) => c.layout !== 'gantt' },
      { path: 'task.boldLabels', label: 'Bold labels', kind: 'toggle', when: (c) => c.layout !== 'gantt' },
      { path: 'task.colorSource', label: 'Bar colour', kind: 'select', options: [['lane', 'From swimlane'], ['default', 'One template colour']], when: (c) => c.layout !== 'gantt' },
      { path: 'task.showPercent', label: 'Show % complete', kind: 'toggle' },
      { path: 'task.percentInside', label: '% inside the bar', kind: 'toggle', when: (c) => c.task.showPercent },
      { path: 'task.progressStyle', label: 'Completed part', kind: 'select', options: [['tint', 'Lighter remainder'], ['shade', 'Darker completed']], when: (c) => c.task.showPercent },
      { path: 'task.showDates', label: 'Show dates', kind: 'toggle' },
      { path: 'task.datesPlacement', label: 'Date position', kind: 'select', options: [['inline', 'After the label'], ['right', 'Beyond the bar']], when: (c) => c.task.showDates && c.layout !== 'gantt' },
    ],
  },
  {
    title: 'Milestones',
    fields: [
      { path: 'milestone.size', label: 'Marker size', kind: 'number', min: 8, max: 48 },
      { path: 'milestone.labelPosition', label: 'Label position', kind: 'select', options: [['right', 'Right'], ['below', 'Below'], ['above', 'Above']], when: (c) => c.layout !== 'gantt' },
      { path: 'milestone.showDate', label: 'Show date', kind: 'toggle' },
      { path: 'milestone.dateFormat', label: 'Date format', kind: 'select', options: [['dd MMM yy', '18 Sep 26'], ['dd/MM/yyyy', '18/09/2026'], ['MMM d', 'Sep 18'], ['d MMM', '18 Sep']] },
      { path: 'milestone.railAboveAxis', label: 'Rail above the axis', kind: 'toggle', when: (c) => c.layout === 'swimlane', hint: 'Milestones that are not in a swimlane sit on a rail above the time axis.' },
    ],
  },
  {
    title: 'Swimlanes',
    fields: [
      { path: 'swimlane.style', label: 'Lane style', kind: 'select', options: [['sidebar', 'Label sidebar'], ['band', 'Tinted band'], ['header', 'Header strip']], when: (c) => c.layout === 'swimlane' },
      { path: 'swimlane.labelWidth', label: 'Sidebar width', kind: 'number', min: 60, max: 300, when: (c) => c.layout === 'swimlane' && c.swimlane.style === 'sidebar' },
      { path: 'swimlane.bandOpacity', label: 'Band tint', kind: 'number', min: 0, max: 0.5, step: 0.02, hint: 'Also used for the lane headers in the Gantt layout.' },
      { path: 'swimlane.rowMode', label: 'Rows', kind: 'select', options: [['pack', 'Compact (share rows)'], ['single', 'One item per row']], when: (c) => c.layout === 'swimlane', hint: 'One item per row keeps the order of your task list.' },
      { path: 'swimlane.border', label: 'Lane border', kind: 'select', options: [['none', 'None'], ['dotted', 'Dotted']], when: (c) => c.layout === 'swimlane' },
    ],
  },
  {
    title: 'Gantt columns',
    fields: [
      { path: 'table.labelWidth', label: 'Title column width', kind: 'number', min: 120, max: 420, when: (c) => c.layout === 'gantt' },
      { path: 'table.showStart', label: 'Start column', kind: 'toggle', when: (c) => c.layout === 'gantt' },
      { path: 'table.showEnd', label: 'End column', kind: 'toggle', when: (c) => c.layout === 'gantt' },
      { path: 'table.showDuration', label: 'Duration column', kind: 'toggle', when: (c) => c.layout === 'gantt' },
      { path: 'table.showAssignee', label: 'Owner column', kind: 'toggle', when: (c) => c.layout === 'gantt' },
    ],
  },
  {
    title: 'Colours',
    fields: [
      { path: 'slide.background', label: 'Background', kind: 'color' },
      { path: 'slide.titleColor', label: 'Title', kind: 'color' },
      { path: 'palette.text', label: 'Text', kind: 'color' },
      { path: 'palette.muted', label: 'Secondary text', kind: 'color' },
      { path: 'palette.grid', label: 'Gridlines', kind: 'color' },
      { path: 'palette.accent', label: 'Accent', kind: 'color' },
      { path: 'palette.taskDefault', label: 'Task bars (no swimlane)', kind: 'color', hint: 'Used by tasks that are not in a swimlane. Tasks inside a swimlane take the colour of their lane (see Swimlane colours).' },
      { path: 'palette.milestoneDefault', label: 'Milestone markers', kind: 'color', hint: 'Default colour for every milestone marker (an individual item can override it).' },
      { path: 'axis.fill', label: 'Axis header', kind: 'color' },
      { path: 'axis.minorFill', label: 'Axis lower tier', kind: 'color', optional: true, hint: 'Fill of the second axis row. Defaults to the axis header colour until changed.' },
      { path: 'axis.yearColor', label: 'Year labels', kind: 'color' },
      { path: 'task.notStartedColor', label: 'Not-started bars (0%)', kind: 'color', optional: true, hint: 'Colour for bars at 0% unless the item has its own colour.' },
      { path: 'axis.textColor', label: 'Axis text (filled)', kind: 'color' },
      { path: 'axis.todayColor', label: 'Today marker', kind: 'color' },
      { path: 'palette.laneColors', label: 'Swimlane colours', kind: 'colors', hint: 'Lanes take these in order, unless a lane has its own colour.' },
    ],
  },
  {
    title: 'Text',
    fields: [
      { path: 'font.family', label: 'Font', kind: 'select', options: FONTS.map((f) => [f, f] as Opt), hint: 'PowerPoint falls back to a default if the viewer lacks the font.' },
      { path: 'font.baseSize', label: 'Base size (pt)', kind: 'number', min: 7, max: 20 },
    ],
  },
];

export function getIn(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

/** Immutable nested set: setIn({a:{b:1}}, 'a.c', 2) → {a:{b:1,c:2}} */
export function setIn<T>(obj: T, path: string, value: unknown): T {
  const keys = path.split('.');
  const rec = (o: unknown, i: number): unknown => {
    const cur = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>;
    return { ...cur, [keys[i]]: i === keys.length - 1 ? value : rec(cur[keys[i]], i + 1) };
  };
  return rec(obj, 0) as T;
}

const labelStyle = { fontSize: 11.5, color: 'var(--text-mid)', flex: 1, minWidth: 0 } as const;
const rowStyle = { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' } as const;

function Control({ field, value, onChange, overridden }: {
  field: Field; value: unknown; onChange: (v: unknown) => void; overridden?: boolean;
}) {
  const label = (
    <label style={labelStyle} title={field.hint}>
      {field.label}
      {overridden && <span title="Customised for this timeline" style={{ color: 'var(--cyan)', marginLeft: 4 }}>●</span>}
    </label>
  );
  switch (field.kind) {
    case 'select':
      return (
        <div style={rowStyle}>
          {label}
          <select className="input-field" value={String(value)} onChange={(e) => onChange(e.target.value)} style={{ width: 150, fontSize: 12, padding: '3px 6px' }}>
            {field.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      );
    case 'toggle':
      return (
        <div style={rowStyle}>
          {label}
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
        </div>
      );
    case 'number':
      return (
        <div style={rowStyle}>
          {label}
          <input
            type="number" className="input-field" min={field.min} max={field.max} step={field.step ?? 1}
            value={Number(value)}
            onChange={(e) => { const n = Number(e.target.value); if (!isNaN(n)) onChange(Math.max(field.min, Math.min(field.max, n))); }}
            style={{ width: 70, fontSize: 12, padding: '3px 6px' }}
          />
        </div>
      );
    case 'color':
      return (
        <div style={rowStyle}>
          {label}
          <span style={{ fontSize: 10.5, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{value ? String(value).toUpperCase() : 'auto'}</span>
          {field.optional && !!value && (
            <button onClick={() => onChange(undefined)} title="Back to automatic" style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 0, display: 'flex' }}><X size={11} /></button>
          )}
          <input type="color" value={value ? String(value) : '#888888'} onChange={(e) => onChange(e.target.value.toUpperCase())} style={{ width: 28, height: 22, padding: 0, border: '1px solid var(--border2)', borderRadius: 4, background: 'none', cursor: 'pointer', opacity: value ? 1 : 0.45 }} />
        </div>
      );
    case 'colors': {
      const colors = (value as string[]) ?? [];
      return (
        <div style={{ padding: '4px 0' }}>
          {label}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {colors.map((c, i) => (
              <span key={i} style={{ position: 'relative' }}>
                <input type="color" value={c} onChange={(e) => onChange(colors.map((x, j) => (j === i ? e.target.value.toUpperCase() : x)))} style={{ width: 28, height: 24, padding: 0, border: '1px solid var(--border2)', borderRadius: 4, cursor: 'pointer' }} />
                {colors.length > 1 && (
                  <button onClick={() => onChange(colors.filter((_, j) => j !== i))} title="Remove colour" style={{ position: 'absolute', top: -6, right: -6, width: 14, height: 14, borderRadius: 7, border: 'none', background: 'var(--surface3)', color: 'var(--text-mid)', cursor: 'pointer', fontSize: 9, lineHeight: '14px', padding: 0 }}><X size={9} /></button>
                )}
              </span>
            ))}
            {colors.length < 12 && (
              <button onClick={() => onChange([...colors, '#6B7280'])} title="Add colour" style={{ width: 28, height: 24, borderRadius: 4, border: '1px dashed var(--border2)', background: 'none', color: 'var(--text-dim)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Plus size={12} /></button>
            )}
          </div>
        </div>
      );
    }
  }
}

/** The accordion of controls. `onChange(path, value)` fires per edit. */
export function ConfigControls({ config, onChange, overriddenPaths }: {
  config: TemplateConfig;
  onChange: (path: string, value: unknown) => void;
  /** Paths the user has customised on top of the template (shown with a dot). */
  overriddenPaths?: Set<string>;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(SECTIONS.map((s) => [s.title, !!s.defaultOpen])));
  return (
    <div>
      {SECTIONS.map((section) => {
        const fields = section.fields.filter((f) => !f.when || f.when(config));
        if (fields.length === 0) return null;
        const isOpen = open[section.title];
        return (
          <div key={section.title} style={{ borderBottom: '1px solid var(--border)' }}>
            <button
              onClick={() => setOpen((o) => ({ ...o, [section.title]: !o[section.title] }))}
              style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '9px 2px', fontSize: 12, fontWeight: 700, color: 'var(--text)' }}
            >
              {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              {section.title}
            </button>
            {isOpen && (
              <div style={{ padding: '0 4px 10px 18px' }}>
                {fields.map((f) => (
                  <Control key={f.path} field={f} value={getIn(config, f.path)} onChange={(v) => onChange(f.path, v)} overridden={overriddenPaths?.has(f.path)} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Flatten an overrides object into the set of leaf paths it sets. */
export function overridePaths(overrides: unknown, prefix = ''): Set<string> {
  const out = new Set<string>();
  if (!overrides || typeof overrides !== 'object') return out;
  for (const [k, v] of Object.entries(overrides as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) overridePaths(v, p).forEach((x) => out.add(x));
    else out.add(p);
  }
  return out;
}
