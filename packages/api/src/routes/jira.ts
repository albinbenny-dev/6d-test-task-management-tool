import { Router, RequestHandler } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import { requireAdmin, requireWrite } from '../middleware/rbac.js';
import { isJiraConfigured, testConnection, syncIssuesForProject, getJiraHost } from '../services/jiraService.js';

// ── Zod schemas ────────────────────────────────────────────────────────────

const UpdateJiraConfigSchema = z.object({
  jiraProjectKey:      z.string().max(50).optional().nullable(),
  pollIntervalMinutes: z.number().int().min(1).max(1440).optional(),
  isEnabled:           z.boolean().optional(),
  // Project-wide Defects dashboard discovery — additive to (not a replacement
  // for) any per-cycle TestCycle.jiraLabels/jiraJql.
  labels:              z.array(z.string().min(1).max(100)).max(20).optional(),
  jql:                 z.string().max(2000).optional().nullable(),
});

// ── Router setup ───────────────────────────────────────────────────────────

const router = Router({ mergeParams: true });
router.use(verifyToken as RequestHandler);
router.use(requireProjectAccess as unknown as RequestHandler);

// ── GET /host — the Jira site URL only, for building "view in Jira" links ──
// Open to any project member (not requireAdmin) — the host isn't a secret,
// and every tester who links/views a bug needs it to open the real ticket.

router.get('/host', (async (_req, res) => {
  res.json({ jiraHost: getJiraHost() });
}) as RequestHandler);

// ── GET /config — masked settings (no secrets are ever stored here) ───────

router.get('/config', requireAdmin as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const config = await prisma.jiraConfig.findUnique({ where: { projectId } });
  let labels: string[] = [];
  try { labels = JSON.parse(config?.labels ?? '[]'); } catch { /* skip */ }
  res.json({
    config: {
      jiraProjectKey:      config?.jiraProjectKey ?? null,
      pollIntervalMinutes: config?.pollIntervalMinutes ?? 5,
      isEnabled:           config?.isEnabled ?? false,
      labels,
      jql:                 config?.jql ?? null,
      lastPollAt:          config?.lastPollAt ?? null,
      lastPollStatus:      config?.lastPollStatus ?? null,
    },
    // Whether JIRA_HOST/JIRA_EMAIL/JIRA_API_TOKEN are set on the server —
    // this is a global, ops-managed setting, not something set per project.
    credentialsConfigured: isJiraConfigured(),
  });
}) as RequestHandler);

// ── PUT /config — upsert per-project settings ──────────────────────────────

router.put('/config', requireAdmin as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  const parsed = UpdateJiraConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }

  const { labels, jql, ...rest } = parsed.data;
  const data = {
    ...rest,
    ...(labels !== undefined ? { labels: JSON.stringify(labels) } : {}),
    ...(jql !== undefined ? { jql: jql?.trim() || null } : {}),
  };

  const config = await prisma.jiraConfig.upsert({
    where: { projectId },
    create: { projectId, ...data },
    update: data,
  });
  res.json({ config });
}) as RequestHandler);

// ── POST /config/test — validate the global Jira credentials ──────────────

router.post('/config/test', requireAdmin as RequestHandler, (async (_req, res) => {
  const result = await testConnection();
  res.status(result.ok ? 200 : 502).json(result);
}) as RequestHandler);

// ── POST /sync — manual "sync now" instead of waiting for the next poll ───

router.post('/sync', requireWrite as RequestHandler, (async (req, res) => {
  const projectId = req.project.id;
  if (!isJiraConfigured()) {
    return res.status(400).json({ error: 'Jira is not configured on this server' });
  }
  const result = await syncIssuesForProject(projectId);
  res.status(result.error ? 502 : 200).json(result);
}) as RequestHandler);

export default router;
