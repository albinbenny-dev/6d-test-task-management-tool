import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  LogOut, Globe, ShieldCheck, BookOpen, ClipboardList, FlaskConical,
  BarChart3, UserCheck, ListChecks, Settings, ChevronDown, ListTodo, FileText, Gauge, Bug,
  PanelLeftClose, PanelLeftOpen, LayoutDashboard, Milestone,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import { clearAuth } from '../../lib/auth';
import { getInitials, PROJECT_GRADIENTS } from '../../lib/utils';
import { useRBAC } from '../../hooks/useRBAC';

interface SidebarProps {
  slug?: string;
}

interface NavEntry {
  label: string;
  path: string;
  Icon: LucideIcon;
  badge?: number;
}

interface NavGroup {
  label: string;
  items: NavEntry[];
}

const EXPANDED_WIDTH = '216px';
const COLLAPSED_WIDTH = '64px';

// Manual testing + task management only — no automation section. See
// App.tsx / routes/index.ts for the (disabled, not deleted) automation
// routes this product used to expose.
export default function Sidebar({ slug }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { activeProject, projects, currentUser, setCurrentUser, sidebarCollapsed, toggleSidebar } = useProjectStore();
  const [logoutHover, setLogoutHover] = useState(false);
  const { canAccessSettings } = useRBAC();
  const collapsed = sidebarCollapsed;

  function handleLogout() {
    clearAuth();
    setCurrentUser(null);
    qc.clear();
    navigate('/login', { replace: true });
  }

  const navGroups: NavGroup[] = slug
    ? [
        {
          label: 'Overview',
          items: [
            { label: 'Overview', path: `/projects/${slug}/overview`, Icon: LayoutDashboard },
          ],
        },
        {
          label: 'My Work',
          items: [
            { label: 'My Work', path: `/projects/${slug}/my-work`, Icon: UserCheck },
          ],
        },
        {
          label: 'Test Management',
          items: [
            { label: 'TC Library', path: `/projects/${slug}/test-cases`, Icon: ClipboardList, badge: activeProject?._count?.tcItems ?? undefined },
            { label: 'Test Cycles', path: `/projects/${slug}/test-cycles`, Icon: FlaskConical },
            { label: 'Test Dashboard', path: `/projects/${slug}/test-cycles/dashboard`, Icon: BarChart3 },
            { label: 'Defects', path: `/projects/${slug}/defects`, Icon: Bug },
          ],
        },
        {
          label: 'Task Management',
          items: [
            { label: 'Task Lists', path: `/projects/${slug}/tasks`, Icon: ListChecks },
            { label: 'Task Dashboard', path: `/projects/${slug}/tasks/dashboard`, Icon: BarChart3 },
          ],
        },
        {
          label: 'Wiki',
          items: [
            { label: 'Wiki', path: `/projects/${slug}/wiki`, Icon: FileText },
          ],
        },
        {
          label: 'Delivery Tracking',
          items: [
            { label: 'Milestones', path: `/projects/${slug}/milestones`, Icon: Milestone },
          ],
        },
        ...(canAccessSettings
          ? [{
              label: 'Project',
              items: [{ label: 'Settings', path: `/projects/${slug}/settings`, Icon: Settings }],
            }]
          : []),
      ]
    : [];

  const isActive = (path: string) => location.pathname === path;

  const gradientIndex = activeProject
    ? activeProject.id.charCodeAt(0) % PROJECT_GRADIENTS.length
    : 0;
  const projectColor = activeProject?.color ?? PROJECT_GRADIENTS[gradientIndex];

  // A tiny corner dot standing in for a nav item's numeric badge when the
  // rail is too narrow for the pill itself — just enough to signal "there's
  // something here", full count comes back once expanded.
  function CollapsedDot({ show }: { show: boolean }) {
    if (!show) return null;
    return (
      <span
        style={{
          position: 'absolute', top: '6px', right: '6px',
          width: '7px', height: '7px', borderRadius: '50%',
          background: 'var(--cyan)', border: '1.5px solid var(--surface)',
        }}
      />
    );
  }

  return (
    <aside
      style={{
        width: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH,
        flexShrink: 0,
        background: 'var(--surface)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        height: '100%',
        transition: 'width 0.16s ease',
      }}
    >
      {/* Collapse/expand toggle */}
      <div
        style={{
          padding: '8px',
          display: 'flex',
          justifyContent: collapsed ? 'center' : 'flex-end',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <button
          onClick={toggleSidebar}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          type="button"
          className="sidebar-toggle-btn"
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      {/* Project context widget */}
      <div
        style={{
          padding: collapsed ? '12px 8px' : '14px 12px',
          borderBottom: '1px solid var(--border)',
          cursor: slug ? 'pointer' : 'default',
          display: 'flex',
          justifyContent: collapsed ? 'center' : 'flex-start',
        }}
        onClick={() => slug && navigate(`/projects/${slug}/settings`)}
        title={collapsed ? activeProject?.name ?? 'No project selected' : undefined}
      >
        {activeProject ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '10px',
                background: projectColor,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '13px',
                flexShrink: 0,
                color: '#fff',
                fontWeight: 700,
              }}
            >
              {getInitials(activeProject.name)}
            </div>
            {!collapsed && (
              <>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div
                    style={{
                      fontSize: '13px',
                      fontWeight: 700,
                      color: 'var(--text)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      lineHeight: 1.2,
                    }}
                  >
                    {activeProject.name}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '9px',
                      color: 'var(--text-dim)',
                      marginTop: '2px',
                      letterSpacing: '0.5px',
                    }}
                  >
                    {activeProject._count?.tcItems ?? 0} test cases
                  </div>
                </div>
                <ChevronDown size={13} color="var(--text-dim)" />
              </>
            )}
          </div>
        ) : collapsed ? (
          <Globe size={16} color="var(--text-dim)" />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-dim)', fontSize: '12px' }}>
            <Globe size={16} />
            <span>No project selected</span>
          </div>
        )}
      </div>

      {/* All Projects link */}
      <div style={{ padding: collapsed ? '8px 8px' : '8px 12px', borderBottom: '1px solid var(--border)' }}>
        <Link
          to="/projects"
          className={`nav-item${location.pathname === '/projects' ? ' active' : ''}${collapsed ? ' nav-item--collapsed' : ''}`}
          title={collapsed ? 'All Projects' : undefined}
        >
          <span className="nav-icon" style={{ position: 'relative' }}>
            <Globe size={16} />
            <CollapsedDot show={collapsed && projects.length > 0} />
          </span>
          {!collapsed && (
            <>
              All Projects
              {projects.length > 0 && (
                <span className="nav-badge blue" style={{ marginLeft: 'auto' }}>{projects.length}</span>
              )}
            </>
          )}
        </Link>
        <Link
          to="/personal-tasks"
          className={`nav-item${location.pathname === '/personal-tasks' ? ' active' : ''}${collapsed ? ' nav-item--collapsed' : ''}`}
          title={collapsed ? 'Personal Tasks' : undefined}
        >
          <span className="nav-icon"><ListTodo size={16} /></span>
          {!collapsed && 'Personal Tasks'}
        </Link>
        {(currentUser?.globalRole === 'SUPER_ADMIN' || currentUser?.globalRole === 'ADMIN' || currentUser?.globalRole === 'SUPER_USER') && (
          <Link
            to="/portfolio"
            className={`nav-item${location.pathname === '/portfolio' ? ' active' : ''}${collapsed ? ' nav-item--collapsed' : ''}`}
            title={collapsed ? 'Portfolio' : undefined}
          >
            <span className="nav-icon"><Gauge size={16} /></span>
            {!collapsed && 'Portfolio'}
          </Link>
        )}
        {currentUser?.globalRole === 'SUPER_ADMIN' && (
          <Link
            to="/admin/users"
            className={`nav-item${location.pathname === '/admin/users' ? ' active' : ''}${collapsed ? ' nav-item--collapsed' : ''}`}
            title={collapsed ? 'User Management' : undefined}
          >
            <span className="nav-icon" style={{ position: 'relative' }}>
              <ShieldCheck size={16} />
              <CollapsedDot show={collapsed} />
            </span>
            {!collapsed && (
              <>
                User Management
                <span className="nav-badge" style={{ marginLeft: 'auto', background: 'var(--violet-dim)', color: 'var(--violet)', fontSize: '8px', padding: '1px 5px' }}>
                  ADMIN
                </span>
              </>
            )}
          </Link>
        )}
        {/* Disabled until the guide content is refreshed to match the
            current app — swap this back to the download <a> once it's updated. */}
        <span
          className={`nav-item${collapsed ? ' nav-item--collapsed' : ''}`}
          title={collapsed ? 'User Guide (being updated)' : 'User guide is being updated — check back soon'}
          style={{ cursor: 'default', color: 'var(--text-dim)', opacity: 0.5 }}
        >
          <span className="nav-icon"><BookOpen size={16} /></span>
          {!collapsed && 'User Guide'}
        </span>
      </div>

      {/* Nav groups */}
      <nav style={{ flex: 1, padding: collapsed ? '8px 8px' : '8px 10px', overflowY: 'auto' }}>
        {navGroups.map((group) => (
          <div key={group.label}>
            {!collapsed && <div className="nav-section-label">{group.label}</div>}
            {group.items.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`nav-item${isActive(item.path) ? ' active' : ''}${collapsed ? ' nav-item--collapsed' : ''}`}
                title={collapsed ? item.label : undefined}
              >
                <span className="nav-icon" style={{ position: 'relative' }}>
                  <item.Icon size={16} />
                  <CollapsedDot show={collapsed && !!item.badge} />
                </span>
                {!collapsed && (
                  <>
                    <span style={{ flex: 1 }}>{item.label}</span>
                    {item.badge !== undefined && <span className="nav-badge blue">{item.badge}</span>}
                  </>
                )}
              </Link>
            ))}
          </div>
        ))}

        {!slug && !collapsed && (
          <div style={{ padding: '20px 10px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
            Select a project to see<br />its navigation
          </div>
        )}
      </nav>

      {/* User widget + logout */}
      <div style={{ padding: '10px 10px', borderTop: '1px solid var(--border)' }}>
        <div
          onClick={() => navigate('/account')}
          title="My Account"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: collapsed ? '4px 0' : '7px 8px',
            borderRadius: 'var(--radius)',
            background: 'transparent',
            flexDirection: collapsed ? 'column' : 'row',
            justifyContent: collapsed ? 'center' : 'flex-start',
            cursor: 'pointer',
          }}
        >
          <div
            title={collapsed ? currentUser?.name ?? 'Guest' : undefined}
            style={{
              width: '28px', height: '28px', borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--violet), var(--cyan))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '11px', fontWeight: 700, color: '#fff', flexShrink: 0,
            }}
          >
            {currentUser ? getInitials(currentUser.name) : 'U'}
          </div>

          {!collapsed && (
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {currentUser?.name ?? 'Guest'}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)', letterSpacing: '1px', textTransform: 'uppercase' }}>
                {currentUser?.globalRole?.replace('_', ' ') ?? 'User'}
              </div>
            </div>
          )}

          <button
            onClick={(e) => { e.stopPropagation(); handleLogout(); }}
            onMouseEnter={() => setLogoutHover(true)}
            onMouseLeave={() => setLogoutHover(false)}
            title="Sign out"
            style={{
              flexShrink: 0, width: '28px', height: '28px', borderRadius: '7px',
              border: `1px solid ${logoutHover ? 'rgba(225,29,72,0.4)' : 'var(--border)'}`,
              background: logoutHover ? 'rgba(225,29,72,0.10)' : 'transparent',
              color: logoutHover ? 'var(--fail)' : 'var(--text-dim)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s',
            }}
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
}
