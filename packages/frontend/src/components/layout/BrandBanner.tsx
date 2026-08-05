import { useNavigate } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Minimize2, Maximize2, ChevronDown, FolderKanban } from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import { AppMark } from '../ui/AppMark';
import { getInitials, PROJECT_GRADIENTS } from '../../lib/utils';

export default function BrandBanner() {
  const navigate = useNavigate();
  const { theme, toggleTheme, compactMode, toggleCompactMode, activeProject, projects } = useProjectStore();
  const isLight = theme === 'light';

  function colorFor(id: string, color?: string | null) {
    return color ?? PROJECT_GRADIENTS[id.charCodeAt(0) % PROJECT_GRADIENTS.length];
  }

  return (
    <header className="brand-banner-top">
      {/* Left: identity */}
      <div className="bb-left">
        <span className="bb-icon"><AppMark size={22} /></span>
        <div className="bb-text">
          <div className="bb-subtitle">Test &amp; Task Management</div>
          <div className="bb-title">6D Test &amp; Task Management Tool</div>
        </div>
      </div>

      {/* Center: project switcher */}
      <div className="bb-center">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className="project-switcher-trigger" type="button" data-testid="project-switcher-trigger">
              {activeProject ? (
                <>
                  <span className="project-switcher-avatar" style={{ background: colorFor(activeProject.id, activeProject.color) }}>
                    {getInitials(activeProject.name)}
                  </span>
                  <span className="project-switcher-name">{activeProject.name}</span>
                </>
              ) : (
                <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: '13px' }}>Select a project</span>
              )}
              <ChevronDown size={14} className="project-switcher-chevron" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="project-switcher-panel" align="start" sideOffset={8}>
              {projects.length === 0 ? (
                <div style={{ padding: '10px 12px', fontSize: '12px', color: 'var(--text-dim)' }}>
                  No projects yet.
                </div>
              ) : (
                projects.map((p) => (
                  <DropdownMenu.Item
                    key={p.id}
                    className="project-switcher-item"
                    onSelect={() => navigate(`/projects/${p.slug}/test-cycles`)}
                  >
                    <span className="project-switcher-avatar" style={{ background: colorFor(p.id, p.color) }}>
                      {getInitials(p.name)}
                    </span>
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {p.name}
                      </div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)' }}>
                        {p._count?.tcItems ?? 0} test cases
                      </div>
                    </div>
                    {activeProject?.id === p.id && <span className="project-switcher-current-tag">CURRENT</span>}
                  </DropdownMenu.Item>
                ))
              )}
              <DropdownMenu.Separator className="project-switcher-footer" />
              <DropdownMenu.Item className="project-switcher-footer-link" onSelect={() => navigate('/projects')}>
                <FolderKanban size={14} />
                View All Projects
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      {/* Right: density toggle + theme toggle + logo */}
      <div className="bb-right">
        <button
          className="density-toggle"
          data-testid="density-toggle"
          aria-pressed={compactMode}
          aria-label={compactMode ? 'Switch to standard view' : 'Switch to compact view'}
          onClick={toggleCompactMode}
          title={compactMode ? 'Switch to standard view' : 'Compact view — shrinks the app to fit smaller screens'}
          type="button"
        >
          {compactMode ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
        </button>
        <button
          className="theme-toggle"
          data-testid="theme-toggle"
          aria-label={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
          onClick={toggleTheme}
          title={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
          type="button"
        >
          <span className={`theme-toggle__icon${isLight ? ' active' : ''}`}>☀</span>
          <span className={`theme-toggle__icon${!isLight ? ' active' : ''}`}>🌙</span>
        </button>
        <img
          className="bb-logo"
          src="/6d-logo-white.png"
          alt="6D Technologies — Smart Ideas, Delivered"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      </div>
    </header>
  );
}
