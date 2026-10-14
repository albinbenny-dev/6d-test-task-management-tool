import { Router, RequestHandler } from 'express';
import { z } from 'zod';
import multer from 'multer';
import * as xlsx from 'xlsx';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import { requireAdvancedFeatures } from '../middleware/rbac.js';
import {
  addDays, endDateForDuration, parseDateOnly, toDateOnlyString, workingDaysBetween,
} from '../lib/timelineDates.js';
import { parseTimelineRows, validMarker, defaultMarker } from '../lib/timelineImport.js';
import { StyleOverridesSchema, parseConfig } from '../lib/timelineTemplateConfig.js';
import { syncTimelineFromTasks } from '../lib/timelineTaskSync.js';

// ── Timeline Builder — per-project timelines ────────────────────────────────
// Everyone on the project can read; building (create/edit/import/delete) is
// ADMIN/SUPER_USER and up — a timeline is a PM-owned planning artifact, same
// tier as Milestones. See schema.prisma's Timeline comment for the data model
// and src/lib/timelineDates.ts for how Duration relates to Start/End.

const router = Router({ mergeParams: true });
router.use(verifyToken as RequestHandler);
router.use(requireProjectAccess as unknown as RequestHandler);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const MAX_ITEMS_PER_TIMELINE = 2000;

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Expected YYYY-MM-DD');

const CreateTimelineSchema = z.object({
  name: z.string().min(1).max(150),
  description: z.string().max(1000).optional().nullable(),
  templateId: z.string().optional().nullable(),
});

const UpdateTimelineSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  description: z.string().max(1000).optional().nullable(),
  templateId: z.string().optional().nullable(),
  styleOverrides: StyleOverridesSchema.optional(),
  taskGranularity: z.enum(['TASKS', 'SUBTASKS']).optional(), // for lanes linked to Task Lists
  hideDone: z.boolean().optional(), // leave 100%-complete rows off the timeline view / exports
  dateView: z.enum(['BASELINE', 'ACTUAL', 'BOTH']).optional(), // which dates are drawn
});

const SwimlaneCreateSchema = z.object({ name: z.string().min(1).max(100), color: hex.optional().nullable() });
const SwimlaneUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: hex.optional().nullable(), // null = back to the template's palette
  collapsed: z.boolean().optional(),
  unlink: z.boolean().optional(), // task-linked lane → static lane; its items become plain editable copies
});

const ItemFields = {
  title: z.string().min(1).max(200),
  type: z.enum(['TASK', 'MILESTONE']),
  marker: z.string().max(20).optional(),
  color: hex.optional().nullable(),
  swimlaneId: z.string().optional().nullable(),
  startDate: dateStr,
  endDate: dateStr.optional(),
  // Working days (Mon–Fri). Accepted instead of endDate when the user edits
  // the Duration cell — the server derives endDate from it.
  durationDays: z.number().int().min(0).max(5000).optional(),
  percentComplete: z.number().int().min(0).max(100).optional(),
  assignee: z.string().max(150).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  hidden: z.boolean().optional(), // view-only: left off the timeline view / exports (allowed on task-linked items too)
  actualStartDate: dateStr.optional().nullable(),
  actualEndDate: dateStr.optional().nullable(),
};
const CreateItemSchema = z.object(ItemFields);
const UpdateItemSchema = z.object(ItemFields).partial();

const ReorderItemsSchema = z.object({
  moves: z.array(z.object({
    id: z.string(),
    swimlaneId: z.string().nullable(),
    sortOrder: z.number().int().min(0),
  })).min(1).max(MAX_ITEMS_PER_TIMELINE),
});

const ReorderLanesSchema = z.object({ orderedIds: z.array(z.string()).min(1) });

// ── Serialization ───────────────────────────────────────────────────────────

type ItemRow = Prisma.TimelineItemGetPayload<object>;

function serializeItem(i: ItemRow) {
  return {
    id: i.id,
    swimlaneId: i.swimlaneId,
    title: i.title,
    type: i.type as 'TASK' | 'MILESTONE',
    marker: i.marker,
    color: i.color,
    startDate: toDateOnlyString(i.startDate),
    endDate: toDateOnlyString(i.endDate),
    durationDays: i.type === 'MILESTONE' ? 0 : workingDaysBetween(i.startDate, i.endDate),
    percentComplete: i.percentComplete,
    assignee: i.assignee,
    notes: i.notes,
    taskId: i.taskId, // set = generated from a Task (read-only here)
    hidden: i.hidden,
    actualStartDate: i.actualStartDate ? toDateOnlyString(i.actualStartDate) : null,
    actualEndDate: i.actualEndDate ? toDateOnlyString(i.actualEndDate) : null,
    sortOrder: i.sortOrder,
  };
}

function serializeLane(l: { id: string; name: string; color: string | null; collapsed: boolean; sortOrder: number; taskListId: string | null }) {
  return { id: l.id, name: l.name, color: l.color, collapsed: l.collapsed, sortOrder: l.sortOrder, taskListId: l.taskListId };
}

function parseOverrides(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function serializeTemplate(t: Prisma.TimelineTemplateGetPayload<object> | null) {
  return t
    ? { id: t.id, name: t.name, isActive: t.isActive, config: parseConfig(t.config) }
    : null;
}

async function loadTimeline(projectId: string, timelineId: string) {
  return prisma.timeline.findFirst({ where: { id: timelineId, projectId } });
}

// Actual start / end for a manual item: both optional, end not before start; a milestone has one actual date (its end).
function resolveActuals(
  startIn: string | null | undefined,
  endIn: string | null | undefined,
  type: 'TASK' | 'MILESTONE',
): { start: Date | null; end: Date | null } | { error: string } {
  const start = startIn ? parseDateOnly(startIn) : null;
  const end = endIn ? parseDateOnly(endIn) : null;
  if ((startIn && isNaN(start!.getTime())) || (endIn && isNaN(end!.getTime()))) return { error: 'Invalid actual date' };
  if (start && end && end.getTime() < start.getTime()) return { error: 'Actual end cannot be before the actual start' };
  return { start: type === 'MILESTONE' ? (end ?? start) : start, end };
}

// Resolves { startDate, endDate } for a create/update, honouring (in order):
// milestone ⇒ end = start; explicit endDate; durationDays; else a 1-day task.
function resolveDates(
  type: 'TASK' | 'MILESTONE',
  startIn: string,
  endIn: string | undefined,
  durationIn: number | undefined,
): { startDate: Date; endDate: Date } | { error: string } {
  let startDate: Date;
  try { startDate = parseDateOnly(startIn); } catch { return { error: 'Invalid start date' }; }

  if (type === 'MILESTONE') return { startDate, endDate: startDate };

  let endDate: Date;
  if (endIn) {
    try { endDate = parseDateOnly(endIn); } catch { return { error: 'Invalid end date' }; }
  } else if (durationIn !== undefined && durationIn > 0) {
    endDate = endDateForDuration(startDate, durationIn);
  } else {
    endDate = startDate;
  }
  if (endDate.getTime() < startDate.getTime()) return { error: 'End date cannot be before start date' };
  return { startDate, endDate };
}

async function nextItemSort(timelineId: string, swimlaneId: string | null): Promise<number> {
  const last = await prisma.timelineItem.findFirst({
    where: { timelineId, swimlaneId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });
  return (last?.sortOrder ?? -1) + 1;
}

async function assertLaneInTimeline(timelineId: string, swimlaneId: string | null | undefined): Promise<boolean> {
  if (!swimlaneId) return true;
  return !!(await prisma.timelineSwimlane.findFirst({ where: { id: swimlaneId, timelineId }, select: { id: true } }));
}

// ── GET / — list this project's timelines ───────────────────────────────────

router.get('/', (async (req, res) => {
  const timelines = await prisma.timeline.findMany({
    where: { projectId: req.project.id },
    include: {
      template: { select: { id: true, name: true } },
      _count: { select: { items: true, swimlanes: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });
  res.json({
    timelines: timelines.map((t) => ({
      id: t.id, name: t.name, description: t.description,
      template: t.template, itemCount: t._count.items, swimlaneCount: t._count.swimlanes,
      createdAt: t.createdAt, updatedAt: t.updatedAt,
    })),
  });
}) as RequestHandler);

// ── GET /import-template — blank Excel with sample rows (before /:id) ───────

router.get('/import-template', (_req, res) => {
  const headers = ['Title', 'Type', 'Swimlane', 'Start', 'End', 'Duration', '% Complete', 'Assigned To', 'Color', 'Marker'];
  const samples = [
    { Title: 'Project Initiation', Type: 'Swimlane', Swimlane: '', Start: '', End: '', Duration: '', '% Complete': '', 'Assigned To': '', Color: '#2563AB', Marker: '' },
    { Title: 'Project kick off', Type: 'Milestone', Swimlane: '', Start: '2026-05-21', End: '', Duration: 0, '% Complete': 100, 'Assigned To': 'PM', Color: '', Marker: 'star' },
    { Title: 'Requirement Gathering', Type: 'Task', Swimlane: '', Start: '2026-06-01', End: '', Duration: 80, '% Complete': 80, 'Assigned To': 'BA team', Color: '', Marker: 'pill' },
    { Title: 'Environment Readiness', Type: 'Swimlane', Swimlane: '', Start: '', End: '', Duration: '', '% Complete': '', 'Assigned To': '', Color: '#0E9F6E', Marker: '' },
    { Title: 'BOQ Submission', Type: 'Task', Swimlane: '', Start: '2026-06-30', End: '2026-08-20', Duration: '', '% Complete': 100, 'Assigned To': '', Color: '', Marker: '' },
    { Title: 'P1 Go Live', Type: 'Milestone', Swimlane: '', Start: '2027-02-04', End: '', Duration: 0, '% Complete': 0, 'Assigned To': '', Color: '', Marker: 'flag' },
  ];
  const instructions = [
    ['How this sheet is read'],
    ['• A row with Type = Swimlane starts a new swimlane; the rows below it belong to it (or fill the Swimlane column per row instead).'],
    ['• Type: Task or Milestone. A row with Duration 0 is treated as a milestone.'],
    ['• Give Start plus either End or Duration. Duration is in working days (Mon–Fri). If both are given, End wins.'],
    ['• Dates: 2026-06-01, 01/06/2026 (day first) or 1 Jun 2026.'],
    ['• Actual Start / Actual End (optional) — when the work really started / finished. The timeline can draw them instead of, or on top of, the planned dates.'],
    ['• Marker (optional) — tasks: pill, bar, chevron. Milestones: diamond, flag, star, circle, triangle.'],
    ['• Exported from MS Project (File → Save As → Excel)? Upload it as is — Name, Start, Finish, Duration, % Complete, Resource Names and Summary columns are recognised.'],
  ];
  const ws = xlsx.utils.json_to_sheet(samples, { header: headers });
  ws['!cols'] = [30, 12, 20, 13, 13, 10, 11, 18, 10, 10].map((w) => ({ wch: w }));
  const info = xlsx.utils.aoa_to_sheet(instructions);
  info['!cols'] = [{ wch: 120 }];
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'Timeline');
  xlsx.utils.book_append_sheet(wb, info, 'Instructions');
  const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="timeline-import-template.xlsx"');
  res.send(buf);
});

// ── POST / — create ─────────────────────────────────────────────────────────

router.post('/', requireAdvancedFeatures as RequestHandler, (async (req, res) => {
  const parsed = CreateTimelineSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });

  let templateId = parsed.data.templateId ?? null;
  if (templateId) {
    const ok = await prisma.timelineTemplate.findFirst({ where: { id: templateId, isActive: true }, select: { id: true } });
    if (!ok) return res.status(400).json({ error: 'Template not found or inactive' });
  } else {
    const first = await prisma.timelineTemplate.findFirst({
      where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { id: true },
    });
    templateId = first?.id ?? null;
  }

  const timeline = await prisma.timeline.create({
    data: {
      projectId: req.project.id,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      templateId,
      createdByUserId: req.user.id,
    },
  });
  res.status(201).json({ timeline: { id: timeline.id, name: timeline.name } });
}) as RequestHandler);

// ── GET /:timelineId — full timeline (lanes, items, resolved template) ──────

router.get('/:timelineId', (async (req, res) => {
  // Task-linked lanes are re-generated from their Task Lists on every open, so a status/date change
  // made in the task list shows up here without any manual refresh.
  const known = await loadTimeline(req.project.id, req.params.timelineId);
  if (known) {
    try { await syncTimelineFromTasks(known.id); }
    catch (err) { console.warn('[timelines] task sync failed (serving last synced data):', (err as Error).message); }
  }
  const timeline = await prisma.timeline.findFirst({
    where: { id: req.params.timelineId, projectId: req.project.id },
    include: {
      template: true,
      swimlanes: { orderBy: { sortOrder: 'asc' } },
      items: { orderBy: [{ sortOrder: 'asc' }, { startDate: 'asc' }] },
    },
  });
  if (!timeline) return res.status(404).json({ error: 'Timeline not found' });

  res.json({
    timeline: {
      id: timeline.id, name: timeline.name, description: timeline.description,
      templateId: timeline.templateId,
      styleOverrides: parseOverrides(timeline.styleOverrides),
      taskGranularity: timeline.taskGranularity,
      hideDone: timeline.hideDone,
      dateView: timeline.dateView,
      createdAt: timeline.createdAt, updatedAt: timeline.updatedAt,
    },
    template: serializeTemplate(timeline.template),
    swimlanes: timeline.swimlanes.map(serializeLane),
    items: timeline.items.map(serializeItem),
  });
}) as RequestHandler);

// ── PUT /:timelineId — rename / change template / style overrides ───────────

router.put('/:timelineId', requireAdvancedFeatures as RequestHandler, (async (req, res) => {
  const parsed = UpdateTimelineSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });

  const existing = await loadTimeline(req.project.id, req.params.timelineId);
  if (!existing) return res.status(404).json({ error: 'Timeline not found' });

  if (parsed.data.templateId) {
    // An inactive template may be kept by a timeline already using it, but not newly chosen.
    const ok = await prisma.timelineTemplate.findFirst({
      where: { id: parsed.data.templateId, OR: [{ isActive: true }, { id: existing.templateId ?? '' }] },
      select: { id: true },
    });
    if (!ok) return res.status(400).json({ error: 'Template not found or inactive' });
  }

  const { styleOverrides, ...rest } = parsed.data;
  await prisma.timeline.update({
    where: { id: existing.id },
    data: { ...rest, ...(styleOverrides !== undefined ? { styleOverrides: JSON.stringify(styleOverrides) } : {}) },
  });
  res.json({ message: 'Updated' });
}) as RequestHandler);

// ── DELETE /:timelineId ─────────────────────────────────────────────────────

router.delete('/:timelineId', requireAdvancedFeatures as RequestHandler, (async (req, res) => {
  const existing = await loadTimeline(req.project.id, req.params.timelineId);
  if (!existing) return res.status(404).json({ error: 'Timeline not found' });
  await prisma.timeline.delete({ where: { id: existing.id } });
  res.json({ message: 'Timeline deleted' });
}) as RequestHandler);

// ── POST /:timelineId/duplicate ─────────────────────────────────────────────

router.post('/:timelineId/duplicate', requireAdvancedFeatures as RequestHandler, (async (req, res) => {
  const src = await prisma.timeline.findFirst({
    where: { id: req.params.timelineId, projectId: req.project.id },
    include: { swimlanes: true, items: true },
  });
  if (!src) return res.status(404).json({ error: 'Timeline not found' });

  const copy = await prisma.$transaction(async (tx) => {
    const t = await tx.timeline.create({
      data: {
        projectId: src.projectId, name: `${src.name} (copy)`.slice(0, 150), description: src.description,
        templateId: src.templateId, styleOverrides: src.styleOverrides, taskGranularity: src.taskGranularity, hideDone: src.hideDone, dateView: src.dateView, createdByUserId: req.user.id,
      },
    });
    const laneMap = new Map<string, string>();
    for (const l of src.swimlanes) {
      const nl = await tx.timelineSwimlane.create({
        data: { timelineId: t.id, name: l.name, color: l.color, collapsed: l.collapsed, sortOrder: l.sortOrder, taskListId: l.taskListId },
      });
      laneMap.set(l.id, nl.id);
    }
    await tx.timelineItem.createMany({
      data: src.items.map((i) => ({
        timelineId: t.id, swimlaneId: i.swimlaneId ? laneMap.get(i.swimlaneId) ?? null : null,
        title: i.title, type: i.type, marker: i.marker, color: i.color, startDate: i.startDate, endDate: i.endDate,
        percentComplete: i.percentComplete, assignee: i.assignee, notes: i.notes, taskId: i.taskId, hidden: i.hidden, actualStartDate: i.actualStartDate, actualEndDate: i.actualEndDate, sortOrder: i.sortOrder,
      })),
    });
    return t;
  });
  res.status(201).json({ timeline: { id: copy.id, name: copy.name } });
}) as RequestHandler);

// ── Swimlanes ───────────────────────────────────────────────────────────────

router.post('/:timelineId/swimlanes', requireAdvancedFeatures as RequestHandler, (async (req, res) => {
  const parsed = SwimlaneCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  const timeline = await loadTimeline(req.project.id, req.params.timelineId);
  if (!timeline) return res.status(404).json({ error: 'Timeline not found' });

  const last = await prisma.timelineSwimlane.findFirst({ where: { timelineId: timeline.id }, orderBy: { sortOrder: 'desc' } });
  const lane = await prisma.timelineSwimlane.create({
    data: {
      timelineId: timeline.id, name: parsed.data.name,
      color: parsed.data.color ?? null,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  });
  res.status(201).json({ swimlane: serializeLane(lane) });
}) as RequestHandler);

// Registered ahead of /:laneId so "reorder" isn't swallowed as a literal id.
router.patch('/:timelineId/swimlanes/reorder', requireAdvancedFeatures as RequestHandler, (async (req, res) => {
  const parsed = ReorderLanesSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  const timeline = await loadTimeline(req.project.id, req.params.timelineId);
  if (!timeline) return res.status(404).json({ error: 'Timeline not found' });

  const lanes = await prisma.timelineSwimlane.findMany({
    where: { timelineId: timeline.id, id: { in: parsed.data.orderedIds } }, select: { id: true },
  });
  const valid = new Set(lanes.map((l) => l.id));
  await prisma.$transaction(
    parsed.data.orderedIds.filter((id) => valid.has(id))
      .map((id, i) => prisma.timelineSwimlane.update({ where: { id }, data: { sortOrder: i } })),
  );
  res.json({ message: 'Reordered' });
}) as RequestHandler);

router.put('/:timelineId/swimlanes/:laneId', requireAdvancedFeatures as RequestHandler, (async (req, res) => {
  const parsed = SwimlaneUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  const lane = await prisma.timelineSwimlane.findFirst({
    where: { id: req.params.laneId, timelineId: req.params.timelineId, timeline: { projectId: req.project.id } },
  });
  if (!lane) return res.status(404).json({ error: 'Swimlane not found' });
  const { unlink, ...data } = parsed.data;
  if (unlink && lane.taskListId) {
    // Stop following the Task List: keep the items as plain copies the user can now edit/delete.
    await prisma.$transaction([
      prisma.timelineItem.updateMany({ where: { swimlaneId: lane.id }, data: { taskId: null } }),
      prisma.timelineSwimlane.update({ where: { id: lane.id }, data: { ...data, taskListId: null } }),
    ]);
  } else if (Object.keys(data).length > 0) {
    await prisma.timelineSwimlane.update({ where: { id: lane.id }, data });
  }
  const updated = await prisma.timelineSwimlane.findUniqueOrThrow({ where: { id: lane.id } });
  res.json({ swimlane: serializeLane(updated) });
}) as RequestHandler);

// ?deleteItems=true removes the lane's items too; otherwise they drop to the
// ungrouped section at the top so nothing is lost silently.
router.delete('/:timelineId/swimlanes/:laneId', requireAdvancedFeatures as RequestHandler, (async (req, res) => {
  const lane = await prisma.timelineSwimlane.findFirst({
    where: { id: req.params.laneId, timelineId: req.params.timelineId, timeline: { projectId: req.project.id } },
  });
  if (!lane) return res.status(404).json({ error: 'Swimlane not found' });

  const deleteItems = req.query.deleteItems === 'true';
  await prisma.$transaction(async (tx) => {
    if (deleteItems) {
      await tx.timelineItem.deleteMany({ where: { swimlaneId: lane.id } });
    } else {
      const base = await tx.timelineItem.findFirst({
        where: { timelineId: lane.timelineId, swimlaneId: null }, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true },
      });
      const moving = await tx.timelineItem.findMany({ where: { swimlaneId: lane.id }, orderBy: { sortOrder: 'asc' }, select: { id: true } });
      let n = (base?.sortOrder ?? -1) + 1;
      // taskId cleared too: with the lane gone nothing would keep them in sync, and the sync prunes unknown links.
      for (const m of moving) await tx.timelineItem.update({ where: { id: m.id }, data: { swimlaneId: null, sortOrder: n++, taskId: null } });
    }
    await tx.timelineSwimlane.delete({ where: { id: lane.id } });
  });
  res.json({ message: 'Swimlane deleted' });
}) as RequestHandler);

// ── Items ───────────────────────────────────────────────────────────────────

router.post('/:timelineId/items', requireAdvancedFeatures as RequestHandler, (async (req, res) => {
  const parsed = CreateItemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  const timeline = await loadTimeline(req.project.id, req.params.timelineId);
  if (!timeline) return res.status(404).json({ error: 'Timeline not found' });

  const d = parsed.data;
  if (!(await assertLaneInTimeline(timeline.id, d.swimlaneId))) return res.status(400).json({ error: 'Swimlane does not belong to this timeline' });
  if ((await prisma.timelineItem.count({ where: { timelineId: timeline.id } })) >= MAX_ITEMS_PER_TIMELINE) {
    return res.status(400).json({ error: `A timeline can hold at most ${MAX_ITEMS_PER_TIMELINE} items` });
  }
  const dates = resolveDates(d.type, d.startDate, d.endDate, d.durationDays);
  if ('error' in dates) return res.status(400).json({ error: dates.error });
  const actuals = resolveActuals(d.actualStartDate, d.actualEndDate, d.type);
  if ('error' in actuals) return res.status(400).json({ error: actuals.error });

  const swimlaneId = d.swimlaneId ?? null;
  const item = await prisma.timelineItem.create({
    data: {
      timelineId: timeline.id, swimlaneId, title: d.title, type: d.type,
      marker: validMarker(d.type, d.marker), color: d.color ?? null,
      startDate: dates.startDate, endDate: dates.endDate,
      percentComplete: d.percentComplete ?? 0,
      assignee: d.assignee ?? null, notes: d.notes ?? null,
      actualStartDate: actuals.start, actualEndDate: actuals.end,
      sortOrder: await nextItemSort(timeline.id, swimlaneId),
    },
  });
  res.status(201).json({ item: serializeItem(item) });
}) as RequestHandler);

router.patch('/:timelineId/items/reorder', requireAdvancedFeatures as RequestHandler, (async (req, res) => {
  const parsed = ReorderItemsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  const timeline = await loadTimeline(req.project.id, req.params.timelineId);
  if (!timeline) return res.status(404).json({ error: 'Timeline not found' });

  const [items, lanes] = await Promise.all([
    prisma.timelineItem.findMany({ where: { timelineId: timeline.id, id: { in: parsed.data.moves.map((m) => m.id) } }, select: { id: true, taskId: true, swimlaneId: true } }),
    prisma.timelineSwimlane.findMany({ where: { timelineId: timeline.id }, select: { id: true } }),
  ]);
  const validItems = new Set(items.map((i) => i.id));
  const linked = new Map(items.filter((i) => i.taskId).map((i) => [i.id, i.swimlaneId]));
  const validLanes = new Set(lanes.map((l) => l.id));

  await prisma.$transaction(
    parsed.data.moves
      .filter((m) => validItems.has(m.id) && (m.swimlaneId === null || validLanes.has(m.swimlaneId)))
      // Items generated from tasks belong to their task list's lane: they can be re-ordered inside it, never moved out.
      .filter((m) => !linked.has(m.id) || linked.get(m.id) === m.swimlaneId)
      .map((m) => prisma.timelineItem.update({ where: { id: m.id }, data: { swimlaneId: m.swimlaneId, sortOrder: m.sortOrder } })),
  );
  res.json({ message: 'Reordered' });
}) as RequestHandler);

router.post('/:timelineId/items/bulk-delete', requireAdvancedFeatures as RequestHandler, (async (req, res) => {
  const parsed = z.object({ ids: z.array(z.string()).min(1).max(MAX_ITEMS_PER_TIMELINE) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  const timeline = await loadTimeline(req.project.id, req.params.timelineId);
  if (!timeline) return res.status(404).json({ error: 'Timeline not found' });
  // Task-generated items can't be deleted here (they'd just be re-created); remove the task or unlink the lane.
  const r = await prisma.timelineItem.deleteMany({ where: { timelineId: timeline.id, id: { in: parsed.data.ids }, taskId: null } });
  res.json({ deleted: r.count, skippedLinked: parsed.data.ids.length - r.count });
}) as RequestHandler);

// Hide / show many rows at once (view-only flag, so task-linked rows are included).
router.post('/:timelineId/items/bulk-hide', requireAdvancedFeatures as RequestHandler, (async (req, res) => {
  const parsed = z.object({ ids: z.array(z.string()).min(1).max(MAX_ITEMS_PER_TIMELINE), hidden: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  const timeline = await loadTimeline(req.project.id, req.params.timelineId);
  if (!timeline) return res.status(404).json({ error: 'Timeline not found' });
  const r = await prisma.timelineItem.updateMany({ where: { timelineId: timeline.id, id: { in: parsed.data.ids } }, data: { hidden: parsed.data.hidden } });
  res.json({ updated: r.count });
}) as RequestHandler);

router.put('/:timelineId/items/:itemId', requireAdvancedFeatures as RequestHandler, (async (req, res) => {
  const parsed = UpdateItemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });

  const existing = await prisma.timelineItem.findFirst({
    where: { id: req.params.itemId, timelineId: req.params.timelineId, timeline: { projectId: req.project.id } },
  });
  if (!existing) return res.status(404).json({ error: 'Item not found' });

  const d = parsed.data;
  if (existing.taskId) {
    // Generated from a Task: the task owns title / dates / assignee / progress. Only the look can be changed here.
    const lockedField = (['title', 'type', 'startDate', 'endDate', 'durationDays', 'percentComplete', 'assignee', 'swimlaneId', 'actualStartDate', 'actualEndDate'] as const)
      .find((k) => d[k] !== undefined && !(k === 'swimlaneId' && d.swimlaneId === existing.swimlaneId));
    if (lockedField) return res.status(400).json({ error: 'This item is linked to a task — change it in the Task List (only marker and colour can be changed here)' });
  }
  if (d.swimlaneId !== undefined && !(await assertLaneInTimeline(existing.timelineId, d.swimlaneId))) {
    return res.status(400).json({ error: 'Swimlane does not belong to this timeline' });
  }

  const type = (d.type ?? existing.type) as 'TASK' | 'MILESTONE';
  const startIn = d.startDate ?? toDateOnlyString(existing.startDate);

  // Which of end/duration the caller is editing decides the other:
  //  · endDate given        → keep it, duration is re-derived on read
  //  · durationDays given   → end = start + N working days
  //  · only start changed   → keep the task's length (shift both ends)
  let endIn: string | undefined = d.endDate;
  let durationIn = d.durationDays;
  if (endIn === undefined && durationIn === undefined) {
    if (d.startDate !== undefined && type === 'TASK') {
      const shift = Math.round((parseDateOnly(d.startDate).getTime() - existing.startDate.getTime()) / 86_400_000);
      endIn = toDateOnlyString(addDays(existing.endDate, shift));
    } else {
      endIn = toDateOnlyString(existing.endDate);
    }
  }
  // Duration 0 on a task means "make it a milestone" — mirrors MS Project / Office Timeline.
  let nextType = type;
  if (durationIn === 0 && type === 'TASK' && d.type === undefined) nextType = 'MILESTONE';

  const dates = resolveDates(nextType, startIn, durationIn !== undefined ? undefined : endIn, durationIn);
  if ('error' in dates) return res.status(400).json({ error: dates.error });

  // Actual dates (manual items only — task-linked ones are locked above).
  let actualPatch: { actualStartDate?: Date | null; actualEndDate?: Date | null } = {};
  if (d.actualStartDate !== undefined || d.actualEndDate !== undefined) {
    const a = resolveActuals(
      d.actualStartDate !== undefined ? d.actualStartDate : (existing.actualStartDate ? toDateOnlyString(existing.actualStartDate) : null),
      d.actualEndDate !== undefined ? d.actualEndDate : (existing.actualEndDate ? toDateOnlyString(existing.actualEndDate) : null),
      nextType,
    );
    if ('error' in a) return res.status(400).json({ error: a.error });
    actualPatch = { ...(d.actualStartDate !== undefined ? { actualStartDate: a.start } : {}), ...(d.actualEndDate !== undefined ? { actualEndDate: a.end } : {}) };
  }

  const typeChanged = nextType !== existing.type;
  const marker = d.marker !== undefined
    ? validMarker(nextType, d.marker)
    : typeChanged ? defaultMarker(nextType) : existing.marker;

  const targetLane = d.swimlaneId !== undefined ? d.swimlaneId : existing.swimlaneId;
  const movedLane = targetLane !== existing.swimlaneId;

  const item = await prisma.timelineItem.update({
    where: { id: existing.id },
    data: {
      ...(d.title !== undefined ? { title: d.title } : {}),
      type: nextType, marker,
      ...(d.color !== undefined ? { color: d.color } : {}),
      swimlaneId: targetLane,
      ...(movedLane ? { sortOrder: await nextItemSort(existing.timelineId, targetLane) } : {}),
      startDate: dates.startDate, endDate: dates.endDate,
      ...(d.percentComplete !== undefined ? { percentComplete: d.percentComplete } : {}),
      ...(d.assignee !== undefined ? { assignee: d.assignee } : {}),
      ...(d.notes !== undefined ? { notes: d.notes } : {}),
      ...(d.hidden !== undefined ? { hidden: d.hidden } : {}),
      ...actualPatch,
    },
  });
  res.json({ item: serializeItem(item) });
}) as RequestHandler);

router.delete('/:timelineId/items/:itemId', requireAdvancedFeatures as RequestHandler, (async (req, res) => {
  const existing = await prisma.timelineItem.findFirst({
    where: { id: req.params.itemId, timelineId: req.params.timelineId, timeline: { projectId: req.project.id } },
    select: { id: true, taskId: true },
  });
  if (!existing) return res.status(404).json({ error: 'Item not found' });
  if (existing.taskId) return res.status(400).json({ error: 'This item is linked to a task — delete the task, or unlink the swimlane, instead' });
  await prisma.timelineItem.delete({ where: { id: existing.id } });
  res.json({ message: 'Item deleted' });
}) as RequestHandler);

// ── POST /:timelineId/import — Excel/CSV (multipart: file, mode=append|replace) ──

router.post('/:timelineId/import', requireAdvancedFeatures as RequestHandler, upload.single('file'), (async (req, res) => {
  const timeline = await loadTimeline(req.project.id, req.params.timelineId);
  if (!timeline) return res.status(404).json({ error: 'Timeline not found' });
  if (!req.file) return res.status(400).json({ error: 'Excel or CSV file required (field: file)' });
  const mode = req.body?.mode === 'replace' ? 'replace' : 'append';

  let rows: Record<string, unknown>[];
  try {
    // cellDates stays off — parseDateCell decodes raw serials in pure UTC (see timelineImport.ts).
    // raw: true keeps CSV cells as the literal text. Without it SheetJS guesses US month-first for
    // "06/02/2024" and silently turns 6 Feb into 2 Jun; our parser is day-first. (.xlsx stores dates
    // as unambiguous serials, so it is unaffected either way.)
    const wb = xlsx.read(req.file.buffer, { type: 'buffer', raw: true });
    // First sheet that actually looks like a plan; falls back to the first sheet.
    const sheetName = wb.SheetNames.find((n) => n.toLowerCase() !== 'instructions') ?? wb.SheetNames[0];
    rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: '' });
  } catch {
    return res.status(400).json({ error: 'Could not read that file — upload an .xlsx, .xls or .csv' });
  }

  const sheet = parseTimelineRows(rows);
  if (sheet.items.length === 0 && sheet.swimlanes.length === 0) {
    return res.status(400).json({ error: sheet.warnings[0] ?? 'No usable rows found in the file', warnings: sheet.warnings });
  }

  const existingCount = mode === 'replace' ? 0 : await prisma.timelineItem.count({ where: { timelineId: timeline.id } });
  if (existingCount + sheet.items.length > MAX_ITEMS_PER_TIMELINE) {
    return res.status(400).json({ error: `A timeline can hold at most ${MAX_ITEMS_PER_TIMELINE} items` });
  }

  const result = await prisma.$transaction(async (tx) => {
    if (mode === 'replace') {
      await tx.timelineItem.deleteMany({ where: { timelineId: timeline.id } });
      await tx.timelineSwimlane.deleteMany({ where: { timelineId: timeline.id } });
    }
    const lanes = await tx.timelineSwimlane.findMany({ where: { timelineId: timeline.id } });
    const laneByName = new Map(lanes.map((l) => [l.name.toLowerCase(), l.id]));
    let laneSort = (lanes.reduce((mx, l) => Math.max(mx, l.sortOrder), -1)) + 1;
    let created = 0;
    for (const l of sheet.swimlanes) {
      if (laneByName.has(l.name.toLowerCase())) continue; // append mode: merge into an existing lane of the same name
      const nl = await tx.timelineSwimlane.create({ data: { timelineId: timeline.id, name: l.name.slice(0, 100), color: l.color, sortOrder: laneSort++ } });
      laneByName.set(l.name.toLowerCase(), nl.id);
      created++;
    }

    const sortByLane = new Map<string | null, number>();
    const nextSort = async (laneId: string | null) => {
      if (!sortByLane.has(laneId)) sortByLane.set(laneId, await nextItemSort(timeline.id, laneId));
      const n = sortByLane.get(laneId)!;
      sortByLane.set(laneId, n + 1);
      return n;
    };
    for (const it of sheet.items) {
      const laneId = it.swimlaneName ? laneByName.get(it.swimlaneName.toLowerCase()) ?? null : null;
      await tx.timelineItem.create({
        data: {
          timelineId: timeline.id, swimlaneId: laneId, title: it.title, type: it.type, marker: it.marker, color: it.color,
          startDate: it.startDate, endDate: it.endDate, percentComplete: it.percentComplete,
          assignee: it.assignee, notes: it.notes, actualStartDate: it.actualStartDate, actualEndDate: it.actualEndDate, sortOrder: await nextSort(laneId),
        },
      });
    }
    return { swimlanesCreated: created };
  }, { timeout: 60_000 });

  res.json({
    itemsImported: sheet.items.length,
    swimlanesCreated: result.swimlanesCreated,
    skippedEmpty: sheet.skippedEmpty,
    warnings: sheet.warnings,
  });
}) as RequestHandler);

// ── POST /:timelineId/import-from-project ───────────────────────────────────
// · Task Lists  → LIVE-linked swimlanes. Their items are generated from the tasks and re-synced
//   whenever the timeline is opened (lib/timelineTaskSync.ts), so status/date changes in the Task
//   List flow through. % complete comes from task status only.
// · Milestone Lists → a one-time copy (the payment-milestone model has no status to follow).

const ImportFromProjectSchema = z.object({
  taskListIds: z.array(z.string()).optional(),
  milestoneListIds: z.array(z.string()).optional(),
  taskGranularity: z.enum(['TASKS', 'SUBTASKS']).optional(),
});

router.post('/:timelineId/import-from-project', requireAdvancedFeatures as RequestHandler, (async (req, res) => {
  const parsed = ImportFromProjectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  const timeline = await loadTimeline(req.project.id, req.params.timelineId);
  if (!timeline) return res.status(404).json({ error: 'Timeline not found' });
  const projectId = req.project.id;

  const [taskLists, milestoneLists] = await Promise.all([
    parsed.data.taskListIds?.length
      ? prisma.taskList.findMany({ where: { projectId, id: { in: parsed.data.taskListIds } }, select: { id: true, name: true }, orderBy: { sortOrder: 'asc' } })
      : Promise.resolve([]),
    parsed.data.milestoneListIds?.length
      ? prisma.milestoneList.findMany({
          where: { projectId, id: { in: parsed.data.milestoneListIds } },
          include: { milestones: { orderBy: { sortOrder: 'asc' } } },
          orderBy: { sortOrder: 'asc' },
        })
      : Promise.resolve([]),
  ]);
  if (taskLists.length === 0 && milestoneLists.length === 0) return res.status(400).json({ error: 'Select at least one list' });

  const linkedAlready = new Set(
    (await prisma.timelineSwimlane.findMany({ where: { timelineId: timeline.id, taskListId: { in: taskLists.map((l) => l.id) } }, select: { taskListId: true } }))
      .map((l) => l.taskListId),
  );
  const newLists = taskLists.filter((l) => !linkedAlready.has(l.id));

  const milestoneLanes: { name: string; items: Prisma.TimelineItemCreateManyInput[] }[] = [];
  for (const list of milestoneLists) {
    const items: Prisma.TimelineItemCreateManyInput[] = [];
    for (const m of list.milestones) {
      const d = m.targetDate ?? m.baselineDate ?? m.actualDate;
      if (!d) continue;
      const day = parseDateOnly(d);
      items.push({
        timelineId: timeline.id, swimlaneId: null, title: m.name.slice(0, 200), type: 'MILESTONE', marker: 'diamond',
        startDate: day, endDate: day, percentComplete: m.isCompleted ? 100 : 0, sortOrder: items.length,
      });
    }
    if (items.length) milestoneLanes.push({ name: list.name, items });
  }
  if (newLists.length === 0 && milestoneLanes.length === 0) {
    return res.status(400).json({ error: taskLists.length ? 'Those task lists are already linked to this timeline' : 'None of the selected milestone lists have dates to import' });
  }

  const taskCount = newLists.length ? await prisma.task.count({ where: { projectId, taskListId: { in: newLists.map((l) => l.id) } } }) : 0;
  const milestoneCount = milestoneLanes.reduce((n, l) => n + l.items.length, 0);
  if ((await prisma.timelineItem.count({ where: { timelineId: timeline.id } })) + taskCount + milestoneCount > MAX_ITEMS_PER_TIMELINE) {
    return res.status(400).json({ error: `A timeline can hold at most ${MAX_ITEMS_PER_TIMELINE} items` });
  }

  await prisma.$transaction(async (tx) => {
    const last = await tx.timelineSwimlane.findFirst({ where: { timelineId: timeline.id }, orderBy: { sortOrder: 'desc' } });
    let sort = (last?.sortOrder ?? -1) + 1;
    for (const l of newLists) {
      await tx.timelineSwimlane.create({ data: { timelineId: timeline.id, name: l.name.slice(0, 100), taskListId: l.id, sortOrder: sort++ } });
    }
    for (const l of milestoneLanes) {
      const lane = await tx.timelineSwimlane.create({ data: { timelineId: timeline.id, name: l.name.slice(0, 100), sortOrder: sort++ } });
      await tx.timelineItem.createMany({ data: l.items.map((i) => ({ ...i, swimlaneId: lane.id })) });
    }
    if (parsed.data.taskGranularity) await tx.timeline.update({ where: { id: timeline.id }, data: { taskGranularity: parsed.data.taskGranularity } });
  });
  await syncTimelineFromTasks(timeline.id);

  const linkedItems = newLists.length
    ? await prisma.timelineItem.count({ where: { timelineId: timeline.id, swimlane: { taskListId: { in: newLists.map((l) => l.id) } } } })
    : 0;
  res.json({ itemsImported: linkedItems + milestoneCount, swimlanesCreated: newLists.length + milestoneLanes.length, linkedLists: newLists.length });
}) as RequestHandler);

// ── GET /:timelineId/export-xlsx — round-trips through /import ──────────────

router.get('/:timelineId/export-xlsx', (async (req, res) => {
  const timeline = await prisma.timeline.findFirst({
    where: { id: req.params.timelineId, projectId: req.project.id },
    include: { swimlanes: { orderBy: { sortOrder: 'asc' } }, items: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!timeline) return res.status(404).json({ error: 'Timeline not found' });

  const toRow = (i: ItemRow, laneName: string) => ({
    Title: i.title, Type: i.type === 'MILESTONE' ? 'Milestone' : 'Task', Swimlane: laneName,
    Start: toDateOnlyString(i.startDate), End: toDateOnlyString(i.endDate),
    Duration: i.type === 'MILESTONE' ? 0 : workingDaysBetween(i.startDate, i.endDate),
    'Actual Start': i.actualStartDate ? toDateOnlyString(i.actualStartDate) : '', 'Actual End': i.actualEndDate ? toDateOnlyString(i.actualEndDate) : '',
    '% Complete': i.percentComplete, 'Assigned To': i.assignee ?? '', Color: i.color ?? '', Marker: i.marker,
  });
  const rows = [
    ...timeline.items.filter((i) => !i.swimlaneId).map((i) => toRow(i, '')),
    ...timeline.swimlanes.flatMap((l) => timeline.items.filter((i) => i.swimlaneId === l.id).map((i) => toRow(i, l.name))),
  ];
  const ws = xlsx.utils.json_to_sheet(rows, { header: ['Title', 'Type', 'Swimlane', 'Start', 'End', 'Duration', 'Actual Start', 'Actual End', '% Complete', 'Assigned To', 'Color', 'Marker'] });
  ws['!cols'] = [30, 12, 20, 13, 13, 10, 13, 13, 11, 18, 10, 10].map((w) => ({ wch: w }));
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'Timeline');
  const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  const safe = timeline.name.replace(/[^a-z0-9-_ ]/gi, '').trim() || 'timeline';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${safe}.xlsx"`);
  res.send(buf);
}) as RequestHandler);

export default router;
