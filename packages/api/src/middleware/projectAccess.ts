import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';

/**
 * requireProjectAccess — project membership gate.
 *
 * Reads :projectId from req.params (accepts either DB cuid OR project slug).
 * Checks that req.user is a member of the project, or is a SUPER_ADMIN.
 *
 * Attaches:
 *   req.project       — the found Project row
 *   req.projectMember — the caller's real ProjectMember row, if one exists
 *                       (undefined for a SUPER_ADMIN/ADMIN with no actual
 *                       membership row — they still pass via bypass, but
 *                       have no project-specific role to read)
 *
 * Returns:
 *   404  Project not found
 *   403  User is not a member and is not a SUPER_ADMIN
 */
export async function requireProjectAccess(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { projectId } = req.params;
    const userId = req.user.id;
    const globalRole = req.user.globalRole;
    // SUPER_ADMIN and ADMIN both bypass project membership checks
    const bypassesMembership = globalRole === 'SUPER_ADMIN' || globalRole === 'ADMIN';

    // Support lookup by cuid OR slug
    const project = await prisma.project.findFirst({
      where: { OR: [{ id: projectId }, { slug: projectId }] },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Look up real membership regardless of bypass status — a global
    // SUPER_ADMIN/ADMIN who *also* happens to be a real project member (e.g.
    // the project creator) should still get their actual ProjectMember row
    // attached, so downstream role checks that read req.projectMember.role
    // (rather than re-deriving admin-ness from globalRole) see accurate data
    // instead of silently treating them as memberless.
    const member = await prisma.projectMember.findUnique({
      where: {
        projectId_userId: { projectId: project.id, userId },
      },
    });

    if (!member && !bypassesMembership) {
      res.status(403).json({ error: 'You do not have access to this project' });
      return;
    }

    req.project = project;
    req.projectMember = member ?? undefined;
    next();
  } catch (err) {
    next(err);
  }
}
