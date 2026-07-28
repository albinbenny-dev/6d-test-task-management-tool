import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import projectsRouter from './projects.js';
import authRouter from './auth.js';
import testCasesRouter from './testCases.js';
import adminRouter from './admin.js';
import tcItemsRouter from './tcItems.js';
import testCyclesRouter from './testCycles.js';
import jiraRouter from './jira.js';
import taskListsRouter from './taskLists.js';
import tasksRouter from './tasks.js';
import personalTasksRouter from './personalTasks.js';
import wikiRouter from './wiki.js';
import { verifyToken } from '../middleware/auth.js';

// Automation routers (scripts/runs/suites/reports/resources) are unmounted
// below — this deployment is manual testing + task management only, no
// Robot Framework automation. The files and their Prisma models are left in
// place (not deleted) so automation can be re-enabled later by uncommenting
// the imports and router.use() calls below.
// import scriptsRouter from './scripts.js';
// import runsRouter from './runs.js';
// import reportsRouter from './reports.js';
// import suitesRouter from './suites.js';
// import resourcesRouter from './resources.js';

const router = Router();

// ── Global JWT guard — all routes except /api/auth/* ──────────────────────
// Individual routers that already call verifyToken will get a no-op second
// pass (token is still valid), so this is safe to add globally.
router.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith('/auth/')) return next();
  return (verifyToken as RequestHandler)(req, res, next);
});

// ── Mounted routers ────────────────────────────────────────────────────────
router.use('/projects', projectsRouter);
router.use('/auth', authRouter);

// ── Test Cases (Stage 4) ───────────────────────────────────────────────────
router.use('/projects/:projectId/test-cases', testCasesRouter);

// ── Scripts / Runs / Reports / Suites / Resources — automation, disabled ──
// router.use('/projects/:projectId/scripts', scriptsRouter);
// router.use('/projects/:projectId/runs', runsRouter);
// router.use('/projects/:projectId/reports', reportsRouter);
// router.use('/projects/:projectId/suites', suitesRouter);
// router.use('/projects/:projectId/resources', resourcesRouter);

// ── Admin / platform-level ────────────────────────────────────────────────
router.use('/admin', adminRouter);

// ── TC Library items ──────────────────────────────────────────────────────
router.use('/projects/:projectId/tc-items', tcItemsRouter);

// ── Test Management — manual test cycles + Jira integration ───────────────
router.use('/projects/:projectId/test-cycles', testCyclesRouter);
router.use('/projects/:projectId/jira', jiraRouter);

// ── Task Management — ClickUp-style project task tracking ─────────────────
router.use('/projects/:projectId/task-lists', taskListsRouter);
router.use('/projects/:projectId/tasks', tasksRouter);

// ── Wiki — per-project living documentation ────────────────────────────────
router.use('/projects/:projectId/wiki', wikiRouter);

// ── Personal Tasks — private per-user to-do tracker, not project-scoped ───
router.use('/personal-tasks', personalTasksRouter);

export default router;
