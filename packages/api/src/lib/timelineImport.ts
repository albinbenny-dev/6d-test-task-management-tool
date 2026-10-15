import { endDateForDuration, workingDaysBetween } from './timelineDates.js';
import { MILESTONE_MARKERS, TASK_MARKERS } from './timelineTemplateConfig.js';

// ── Timeline Builder — Excel/CSV row parser ─────────────────────────────────
// Pure (no DB, no xlsx import) so it can be unit-tested. The route feeds it
// the rows from xlsx.utils.sheet_to_json(..., { defval: '', raw: true }).
// Accepts our own template's headers as well as MS Project's "Save As →
// Excel" columns (Name, Start, Finish, Duration, % Complete, Resource Names,
// Summary), so an .mpp round-trips via Excel without a dedicated parser.

export interface ParsedItem {
  title: string;
  type: 'TASK' | 'MILESTONE';
  marker: string;
  color: string | null;
  swimlaneName: string | null;
  startDate: Date;
  endDate: Date;
  percentComplete: number;
  assignee: string | null;
  notes: string | null;
  /** Optional actual dates ("Actual Start" / "Actual End" columns). */
  actualStartDate: Date | null;
  actualEndDate: Date | null;
}

export interface ParsedSheet {
  swimlanes: { name: string; color: string | null }[];
  items: ParsedItem[];
  warnings: string[];
  skippedEmpty: number;
}

const ALIASES: Record<string, string[]> = {
  title:    ['title', 'name', 'taskname', 'task', 'activity', 'activityname', 'milestone', 'tasktitle'],
  type:     ['type', 'itemtype', 'tasktype', 'kind'],
  swimlane: ['swimlane', 'lane', 'group', 'workstream', 'category', 'phase', 'stream'],
  start:    ['start', 'startdate', 'begin', 'begindate', 'planstart', 'plannedstart'],
  end:      ['end', 'enddate', 'finish', 'finishdate', 'due', 'duedate', 'planend', 'plannedend'],
  actualStart: ['actualstart', 'actualstartdate', 'actualbegin'],
  actualEnd:   ['actualend', 'actualenddate', 'actualfinish', 'actualfinishdate'],
  duration: ['duration', 'durationdays', 'days', 'workingdays', 'workdays'],
  percent:  ['percentcomplete', 'complete', 'progress', 'percent', 'pctcomplete', 'done', 'completion'],
  assignee: ['assignedto', 'assignee', 'resource', 'resources', 'resourcenames', 'owner', 'responsible'],
  color:    ['color', 'colour'],
  marker:   ['marker', 'shape', 'icon'],
  notes:    ['notes', 'note', 'description', 'comments', 'remarks'],
  summary:  ['summary', 'issummary'],
  outline:  ['outlinelevel', 'wbslevel'],
  active:   ['active'],
};

function normHeader(h: string): string {
  return h.toLowerCase().replace(/%/g, 'percent').replace(/[^a-z0-9]/g, '');
}

function buildColumnMap(rows: Record<string, unknown>[]): Record<string, string> {
  const map: Record<string, string> = {};
  const byNorm = new Map<string, string>();
  // Union of every row's keys — sheet_to_json normally gives each row all headers, but not guaranteed.
  for (const row of rows) for (const k of Object.keys(row)) if (!byNorm.has(normHeader(k))) byNorm.set(normHeader(k), k);
  for (const [field, aliases] of Object.entries(ALIASES)) {
    for (const a of aliases) {
      const real = byNorm.get(a);
      if (real !== undefined) { map[field] = real; break; }
    }
  }
  return map;
}

// Excel serial 0 == 1899-12-30. Pure UTC arithmetic — see the note above
// excelSerialToUTCDate in routes/tasks.ts for why local-time anchors are wrong.
function excelSerialToUTCDate(serial: number): Date {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86_400_000));
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export function parseDateCell(raw: unknown): Date | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') {
    return isNaN(raw) || raw < 20_000 ? null : excelSerialToUTCDate(raw);
  }
  if (raw instanceof Date) {
    return isNaN(raw.getTime()) ? null : new Date(Date.UTC(raw.getFullYear(), raw.getMonth(), raw.getDate()));
  }
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/^[A-Za-z]{3,9},?\s+(?=\d)/, ''); // MS Project: "Mon 01/06/26"
  s = s.replace(/[\sT]+\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp][Mm])?$/, ''); // MS Project: "21 May 2026 08:00" — only the day matters

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return utc(Number(m[1]), Number(m[2]), Number(m[3]));

  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s); // day-first (India / UK)
  if (m) return utc(fullYear(Number(m[3])), Number(m[2]), Number(m[1]));

  m = /^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s,-]+(\d{2,4})$/.exec(s); // 18 Sep 2026 / 18-Sep-26
  if (m) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (mi >= 0) return utc(fullYear(Number(m[3])), mi + 1, Number(m[1]));
  }
  return null;
}

function fullYear(y: number): number {
  return y < 100 ? 2000 + y : y;
}

function utc(y: number, mo: number, d: number): Date | null {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  // Reject rollovers like 31/02/2026
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt : null;
}

/** "5", "5 days", "5d", "2 wks", "1 mon", "16 hrs" → working days. null if unparseable. */
export function parseDurationCell(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return isNaN(raw) || raw < 0 ? null : Math.round(raw);
  const m = /^(\d+(?:\.\d+)?)\s*([a-zA-Z]*)\??$/.exec(String(raw).trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (!unit || unit.startsWith('d') || unit.startsWith('ed')) return Math.round(n);
  if (unit.startsWith('w')) return Math.round(n * 5);
  if (unit.startsWith('mo')) return Math.round(n * 20);
  if (unit.startsWith('h')) return Math.ceil(n / 8);
  return null;
}

function parsePercent(raw: unknown): number {
  if (raw === null || raw === undefined || raw === '') return 0;
  if (typeof raw === 'number') {
    const v = raw > 0 && raw <= 1 ? raw * 100 : raw; // Excel stores 80% as 0.8
    return clamp(Math.round(v));
  }
  const s = String(raw).trim();
  const n = parseFloat(s.replace('%', ''));
  if (isNaN(n)) return 0;
  return clamp(Math.round(!s.includes('%') && n > 0 && n <= 1 ? n * 100 : n));
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}

function truthy(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw;
  return /^(yes|y|true|1|x)$/i.test(String(raw ?? '').trim());
}

function str(raw: unknown): string {
  return raw === null || raw === undefined ? '' : String(raw).trim();
}

export function defaultMarker(type: 'TASK' | 'MILESTONE'): string {
  return type === 'MILESTONE' ? 'diamond' : 'pill';
}

export function validMarker(type: 'TASK' | 'MILESTONE', marker: string | null | undefined): string {
  const list: readonly string[] = type === 'MILESTONE' ? MILESTONE_MARKERS : TASK_MARKERS;
  const m = (marker ?? '').toLowerCase();
  return list.includes(m) ? m : defaultMarker(type);
}

interface OutlinePlan {
  /** Rows that are roll-ups of the rows beneath them — never imported as items (their sub-tasks are). */
  summary: boolean[];
  /** The swimlane each real task belongs to (its nearest summary ancestor at or above `laneLevel`). */
  lane: (string | null)[];
  laneLevel: number;
  rootTitle: string | null;
  foldedBelowLane: number;
}

/**
 * Turns an MS Project outline into swimlanes. A row is a summary when the next row is indented deeper. A single
 * top row (the project name) is dropped. Lanes come from the shallowest level that gives a useful handful of groups
 * (4+ summaries), because making every summary a lane would produce dozens of one-task lanes in a deep plan.
 * Null for a flat list (nothing to group).
 */
function planOutline(rows: Record<string, unknown>[], col: Record<string, string>): OutlinePlan | null {
  const levels = rows.map((r) => { const n = parseInt(str(r[col.outline]), 10); return Number.isFinite(n) && n > 0 ? n : NaN; });
  const titles = rows.map((r) => str(r[col.title]));
  const valid = rows.map((_, i) => !!titles[i] && !isNaN(levels[i]));
  if (valid.filter(Boolean).length < 2) return null;

  const summary: boolean[] = rows.map(() => false);
  let next = NaN;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (!valid[i]) continue;
    summary[i] = !isNaN(next) && next > levels[i];
    next = levels[i];
  }

  const minLevel = Math.min(...levels.filter((_, i) => valid[i]));
  const roots = rows.map((_, i) => i).filter((i) => valid[i] && levels[i] === minLevel);
  const rootIdx = roots.length === 1 && summary[roots[0]] ? roots[0] : -1;
  const base = rootIdx >= 0 ? minLevel + 1 : minLevel;

  const counts = new Map<number, number>();
  rows.forEach((_, i) => {
    if (valid[i] && summary[i] && i !== rootIdx && levels[i] >= base) counts.set(levels[i], (counts.get(levels[i]) ?? 0) + 1);
  });
  if (counts.size === 0) return null;
  const sorted = [...counts.keys()].sort((a, b) => a - b);
  const laneLevel = sorted.find((l) => (counts.get(l) ?? 0) >= 4)
    ?? sorted.reduce((best, l) => ((counts.get(l) ?? 0) > (counts.get(best) ?? 0) ? l : best), sorted[0]);

  const lane: (string | null)[] = rows.map(() => null);
  const anc: (string | undefined)[] = [];
  let foldedBelowLane = 0;
  rows.forEach((_, i) => {
    if (!valid[i]) return;
    const lv = levels[i];
    anc.length = lv; // forget ancestors at this depth and below
    if (i === rootIdx) return;
    if (summary[i]) {
      anc[lv] = titles[i];
      if (lv > laneLevel) foldedBelowLane++;
      return;
    }
    for (let j = Math.min(lv - 1, laneLevel); j >= base; j--) {
      if (anc[j]) { lane[i] = anc[j] as string; break; }
    }
  });

  return { summary, lane, laneLevel, rootTitle: rootIdx >= 0 ? titles[rootIdx] : null, foldedBelowLane };
}

export function parseTimelineRows(rows: Record<string, unknown>[]): ParsedSheet {
  const result: ParsedSheet = { swimlanes: [], items: [], warnings: [], skippedEmpty: 0 };
  if (rows.length === 0) return result;

  const col = buildColumnMap(rows);
  if (!col.title) {
    result.warnings.push('No title column found — expected a header like "Title", "Name" or "Task Name".');
    return result;
  }
  if (!col.start && !col.end) {
    result.warnings.push('No date columns found — expected "Start" and "End"/"Finish" (or "Start" + "Duration").');
    return result;
  }

  // Lane colour stays null (auto from the template palette) unless the sheet's Color column gives one on the lane row.
  const laneSeen = new Set<string>();
  const ensureLane = (name: string, color: string | null = null) => {
    if (!laneSeen.has(name)) {
      laneSeen.add(name);
      result.swimlanes.push({ name, color });
    }
  };

  let currentLane: string | null = null;
  // MS Project outline (Outline Level column), unless the sheet already marks swimlanes itself with a Type column.
  const plan = col.outline && !col.type ? planOutline(rows, col) : null;
  let inactive = 0;

  rows.forEach((row, idx) => {
    const rowNo = idx + 2; // header is row 1
    const get = (field: string): unknown => (col[field] ? row[col[field]] : undefined);

    const title = str(get('title'));
    if (!title) { result.skippedEmpty++; return; }
    if (col.active && /^(no|false|0)$/i.test(str(get('active')))) { inactive++; return; } // MS Project: inactive task
    if (plan && plan.summary[idx]) return; // roll-up rows: their sub-tasks are what get imported

    const typeRaw = str(get('type')).toLowerCase();
    const isLaneRow = !plan && (/^(swimlane|lane|summary|group)$/.test(typeRaw) || (col.summary ? truthy(get('summary')) : false));
    if (isLaneRow) {
      const laneColorRaw = str(get('color'));
      ensureLane(title, /^#[0-9A-Fa-f]{6}$/.test(laneColorRaw) ? laneColorRaw : null);
      currentLane = title;
      return;
    }

    const explicitLane = str(get('swimlane'));
    const laneName = explicitLane || (plan ? plan.lane[idx] : currentLane);
    if (laneName) ensureLane(laneName);

    let start = parseDateCell(get('start'));
    let end = parseDateCell(get('end'));
    const duration = parseDurationCell(get('duration'));

    if (!start && end && duration !== null && duration <= 1) start = end; // single-day / milestone given only an end
    if (!start) {
      result.warnings.push(`Row ${rowNo} ("${title}"): no valid Start date — skipped.`);
      return;
    }

    let type: 'TASK' | 'MILESTONE';
    if (typeRaw.startsWith('mile')) type = 'MILESTONE';
    else if (typeRaw.startsWith('task') || typeRaw === 'bar') type = 'TASK';
    else if (duration === 0) type = 'MILESTONE'; // MS Project convention: 0-day task == milestone
    else if (!col.duration && !col.type && (!end || end.getTime() === start.getTime())) type = 'MILESTONE';
    else type = 'TASK';

    if (type === 'MILESTONE') {
      end = start;
    } else if (!end) {
      end = duration !== null && duration > 0 ? endDateForDuration(start, duration) : start;
    } else if (end.getTime() < start.getTime()) {
      result.warnings.push(`Row ${rowNo} ("${title}"): End is before Start — End set to Start.`);
      end = start;
    }

    // Actual dates are optional; an end before the start is dropped (the start alone is kept).
    const actualStart = parseDateCell(get('actualStart'));
    let actualEnd = parseDateCell(get('actualEnd'));
    if (actualStart && actualEnd && actualEnd.getTime() < actualStart.getTime()) {
      result.warnings.push(`Row ${rowNo} ("${title}"): Actual End is before Actual Start — Actual End ignored.`);
      actualEnd = null;
    }

    const colorRaw = str(get('color'));
    result.items.push({
      title: title.slice(0, 200),
      type,
      marker: validMarker(type, str(get('marker'))),
      color: /^#[0-9A-Fa-f]{6}$/.test(colorRaw) ? colorRaw : null,
      swimlaneName: laneName || null,
      startDate: start,
      endDate: end,
      percentComplete: parsePercent(get('percent')),
      assignee: str(get('assignee')) || null,
      notes: str(get('notes')) || null,
      actualStartDate: actualStart ?? (type === 'MILESTONE' ? actualEnd : null),
      actualEndDate: actualEnd,
    });
  });

  if (inactive > 0) result.warnings.push(`${inactive} inactive task${inactive === 1 ? '' : 's'} skipped.`);
  if (plan) {
    const parts = [`Grouped by outline level ${plan.laneLevel}: ${result.swimlanes.length} swimlane${result.swimlanes.length === 1 ? '' : 's'}.`];
    const summaries = plan.summary.filter(Boolean).length - (plan.rootTitle !== null ? 1 : 0);
    if (summaries > 0) parts.push(`${summaries} summary row${summaries === 1 ? '' : 's'} (roll-ups of their sub-tasks) were not imported as tasks.`);
    if (plan.rootTitle) parts.push(`"${plan.rootTitle}" is the project root and was not imported.`);
    result.warnings.push(parts.join(' '));
  }

  return result;
}

/** Duration (working days) for display/export — 0 for milestones. */
export function itemDuration(item: { type: string; startDate: Date; endDate: Date }): number {
  return item.type === 'MILESTONE' ? 0 : workingDaysBetween(item.startDate, item.endDate);
}
