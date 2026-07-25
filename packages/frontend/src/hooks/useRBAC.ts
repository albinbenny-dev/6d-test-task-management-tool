import { useProjectStore } from '../stores/projectStore';
import type { ProjectRole } from '../types';

interface RBACResult {
  /** The user's project-level role, or null if not a member */
  role: ProjectRole | null;
  /** True when globalRole === 'SUPER_ADMIN' — bypasses all project restrictions */
  isSuperAdmin: boolean;
  /** Project ADMIN — full control over members, deletion, all writes */
  isAdmin: boolean;
  /** SUPER_USER — full feature access for allocated project */
  isSuperUser: boolean;
  /** STANDARD_USER — read/write access; no UI Scanner or Healing Agent */
  isStandardUser: boolean;
  /** TEST_USER — Test Management only; no Automation features at all */
  isTestUser: boolean;
  /** canWrite = any project role: may create/update/run/approve */
  canWrite: boolean;
  /** canManageMembers = ADMIN only */
  canManageMembers: boolean;
  /** canDeleteProject = ADMIN only */
  canDeleteProject: boolean;
  /** canAccessUIScanner = SUPER_ADMIN | ADMIN | SUPER_USER */
  canAccessUIScanner: boolean;
  /** canAccessHealing = SUPER_ADMIN | ADMIN | SUPER_USER */
  canAccessHealing: boolean;
  /** canAccessScriptEditor = SUPER_ADMIN | ADMIN | SUPER_USER — STANDARD_USER cannot view/edit/load scripts */
  canAccessScriptEditor: boolean;
  /** canAccessSettings = SUPER_ADMIN | ADMIN | SUPER_USER — STANDARD_USER has no Settings page */
  canAccessSettings: boolean;
  /** canManageTestCycles = SUPER_ADMIN | ADMIN | SUPER_USER — create/close/delete test cycles, add/remove TCs. TEST_USER executes assigned tests but does not administer cycles. */
  canManageTestCycles: boolean;
  /** canManageJiraConfig = SUPER_ADMIN | ADMIN only — same sensitivity class as member management */
  canManageJiraConfig: boolean;
  /** canAccessAutomationSection = everyone except TEST_USER — Script Editor/Library, Execution, Scheduler, Reports, automation Dashboard */
  canAccessAutomationSection: boolean;
  /** canManageTcLibrary = SUPER_ADMIN | ADMIN | SUPER_USER — Import/Delete in TC Library */
  canManageTcLibrary: boolean;
  /** canEditTcItems = everyone except TEST_USER — edit/link-to-script/scope-toggle/create/move-feature in TC Library. STANDARD_USER keeps this; only TEST_USER (read-only) is excluded. */
  canEditTcItems: boolean;
}

/**
 * useRBAC — returns the current user's effective permissions for the active project.
 *
 * Reads `activeProject.myRole` (set by GET /projects response) and `currentUser.globalRole`.
 * SUPER_ADMIN has full access regardless of project membership.
 *
 * Usage:
 *   const { canWrite, canAccessHealing, isStandardUser } = useRBAC();
 *   {canAccessHealing && <button>Approve Heal</button>}
 *   {canWrite && <button>Save</button>}
 */
export function useRBAC(): RBACResult {
  const { currentUser, activeProject } = useProjectStore();

  const globalRole = currentUser?.globalRole;
  const isSuperAdmin = globalRole === 'SUPER_ADMIN';
  // ADMIN global role has full project access but no user management
  const isGlobalAdmin = globalRole === 'ADMIN';

  if (isSuperAdmin || isGlobalAdmin) {
    return {
      role: null,
      isSuperAdmin,
      isAdmin: true,
      isSuperUser: true,
      isStandardUser: false,
      isTestUser: false,
      canWrite: true,
      canManageMembers: true,
      canDeleteProject: true,
      canAccessUIScanner: true,
      canAccessHealing: true,
      canAccessScriptEditor: true,
      canAccessSettings: true,
      canManageTestCycles: true,
      canManageJiraConfig: true,
      canAccessAutomationSection: true,
      canManageTcLibrary: true,
      canEditTcItems: true,
    };
  }

  const role = (activeProject?.myRole as ProjectRole) ?? null;

  return {
    role,
    isSuperAdmin: false,
    isAdmin: role === 'ADMIN',
    isSuperUser: role === 'SUPER_USER',
    isStandardUser: role === 'STANDARD_USER',
    isTestUser: role === 'TEST_USER',
    canWrite: role === 'ADMIN' || role === 'SUPER_USER' || role === 'STANDARD_USER' || role === 'TEST_USER',
    canManageMembers: role === 'ADMIN',
    canDeleteProject: role === 'ADMIN',
    canAccessUIScanner: role === 'ADMIN' || role === 'SUPER_USER',
    canAccessHealing: role === 'ADMIN' || role === 'SUPER_USER',
    canAccessScriptEditor: role === 'ADMIN' || role === 'SUPER_USER',
    canAccessSettings: role === 'ADMIN' || role === 'SUPER_USER',
    canManageTestCycles: role === 'ADMIN' || role === 'SUPER_USER',
    canManageJiraConfig: role === 'ADMIN',
    canAccessAutomationSection: role !== 'TEST_USER',
    canManageTcLibrary: role === 'ADMIN' || role === 'SUPER_USER',
    canEditTcItems: role === 'ADMIN' || role === 'SUPER_USER' || role === 'STANDARD_USER',
  };
}
