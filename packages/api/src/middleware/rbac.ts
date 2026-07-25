import { Request, Response, NextFunction } from 'express';

export type ProjectRole = 'ADMIN' | 'SUPER_USER' | 'STANDARD_USER' | 'TEST_USER';

/**
 * requireRole — project-level RBAC gate.
 *
 * Must run after verifyToken + requireProjectAccess (which sets req.projectMember).
 * SUPER_ADMIN global role bypasses all project-level role checks.
 *
 * Role hierarchy (spec):
 *   ADMIN         — all operations including member management and project deletion
 *   SUPER_USER    — full feature access for allocated project; no member management or project deletion
 *   STANDARD_USER — read/write TCs, scripts, runs, scheduler, reports, chat; no UI Scanner or Healing
 *   TEST_USER     — executes assigned tests within Test Management (status updates, bug links, Jira
 *                   sync); read-only on TC Library and Test Cycle administration (no create/edit/
 *                   delete cycles, no TC Library mutation); no Automation routes at all — see
 *                   blockAutomationAccess below, which denies this role before any route-level
 *                   check here even runs.
 *
 * @param roles — project roles that are allowed to perform this action
 *
 * @example
 *   // Only project ADMIN may delete:
 *   router.delete('/:id', requireProjectAccess, requireRole(['ADMIN']), handler);
 *
 *   // ADMIN or SUPER_USER may access advanced features:
 *   router.post('/scan', requireProjectAccess, requireAdvancedFeatures, handler);
 */
export function requireRole(roles: ProjectRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // SUPER_ADMIN and ADMIN bypass all project-level role restrictions
    if (req.user?.globalRole === 'SUPER_ADMIN' || req.user?.globalRole === 'ADMIN') {
      next();
      return;
    }

    const memberRole = req.projectMember?.role as ProjectRole | undefined;

    if (!memberRole) {
      res.status(403).json({ error: 'Project membership required' });
      return;
    }

    if (!roles.includes(memberRole)) {
      res.status(403).json({
        error: 'Insufficient permissions for this action',
        required: roles,
        current: memberRole,
      });
      return;
    }

    next();
  };
}

/**
 * requireWrite — all project members may mutate.
 * Equivalent to requireRole(['ADMIN', 'SUPER_USER', 'STANDARD_USER', 'TEST_USER']).
 * Safe to include TEST_USER here even though this guards some Automation routes
 * (e.g. Jira sync) too — those routers reject TEST_USER earlier via
 * blockAutomationAccess, before this check is ever reached.
 */
export const requireWrite = requireRole(['ADMIN', 'SUPER_USER', 'STANDARD_USER', 'TEST_USER']);

/**
 * requireAdvancedFeatures — restricts UI Scanner, Healing Agent, and Test
 * Cycle management (create/edit/delete/status, add/remove items) to
 * ADMIN/SUPER_USER only. Neither STANDARD_USER nor TEST_USER may administer
 * the Test Cycle data model or import/delete in TC Library — TEST_USER may
 * still execute assigned tests (see requireWrite) but not manage the cycle
 * itself. Also reused by scripts.ts for Automation writes, where TEST_USER
 * is rejected earlier anyway via blockAutomationAccess.
 */
export const requireAdvancedFeatures = requireRole(['ADMIN', 'SUPER_USER']);

/**
 * requireAdmin — restricts to project ADMIN only.
 * Use for: project deletion, member management, env config changes.
 * Equivalent to requireRole(['ADMIN']).
 */
export const requireAdmin = requireRole(['ADMIN']);

/**
 * blockRole — deny-list gate, the inverse of requireRole. Denies the listed
 * roles and lets everyone else (including roles added in the future) through
 * unchanged, so adding a new restricted role here never requires re-auditing
 * every existing role's access on the routes it's applied to.
 *
 * Mount at the router level (after requireProjectAccess, before any
 * route-specific requireRole/requireWrite/requireAdvancedFeatures check) so
 * the denial happens before route-level logic ever runs.
 */
export function blockRole(roles: ProjectRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.user?.globalRole === 'SUPER_ADMIN' || req.user?.globalRole === 'ADMIN') {
      next();
      return;
    }

    const memberRole = req.projectMember?.role as ProjectRole | undefined;
    if (memberRole && roles.includes(memberRole)) {
      res.status(403).json({ error: 'This feature is not available for your role' });
      return;
    }

    next();
  };
}

/**
 * blockAutomationAccess — TEST_USER sees Test Management only, never
 * Automation (Script Editor/Library, Execution, Scheduler, Reports).
 * Mounted router-wide on every Automation router.
 */
export const blockAutomationAccess = blockRole(['TEST_USER']);
