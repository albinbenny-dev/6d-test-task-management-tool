import type { Project } from '../types';

// TEST_USER lands on My Assignments (their actionable work); everyone else
// lands on Test Cycles, the project's main surface now that there's no
// automation dashboard. Reads myRole off the project itself (from GET
// /projects) rather than any "active project" context, since every caller of
// this (the All Projects grid, the Portfolio dashboard) renders many projects
// at once with none of them "active" yet.
export function landingPath(project: Project, globalRole: string | undefined): string {
  const isGloballyElevated = globalRole === 'SUPER_ADMIN' || globalRole === 'ADMIN';
  const isTestUser = !isGloballyElevated && project.myRole === 'TEST_USER';
  return isTestUser
    ? `/projects/${project.slug}/test-cycles/assignments`
    : `/projects/${project.slug}/test-cycles`;
}
