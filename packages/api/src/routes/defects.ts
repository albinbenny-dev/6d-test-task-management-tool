import { Router, RequestHandler } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/projectAccess.js';
import { getProjectDefects } from '../services/defectService.js';

// ── Router setup ───────────────────────────────────────────────────────────

const router = Router({ mergeParams: true });
router.use(verifyToken as RequestHandler);
router.use(requireProjectAccess as unknown as RequestHandler);

// ── GET / — the unified defect list powering the Defects dashboard ────────
// Open to any project member, matching the existing project-wide bug board
// (testCycles.ts's `GET /bugs`) — this is a superset view, not a new
// permission boundary. Sync configuration (labels/JQL/project key) is still
// edited via the existing `/jira/config` endpoint (admin-only) and synced via
// the existing `/jira/sync` endpoint (write-role).

router.get('/', (async (req, res) => {
  const projectId = req.project.id;
  const defects = await getProjectDefects(projectId);
  res.json({ defects });
}) as RequestHandler);

export default router;
