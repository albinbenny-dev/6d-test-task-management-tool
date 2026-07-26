import { useProjectStore } from '../../stores/projectStore';
import { AppMark } from '../ui/AppMark';

export default function BrandBanner() {
  const { theme, toggleTheme, activeProject } = useProjectStore();
  const isLight = theme === 'light';

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

      {/* Center: project context */}
      <div className="bb-center">
        {activeProject ? (
          <span className="bb-proj">{activeProject.name}</span>
        ) : (
          <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '13px' }}>
            Select a project to begin
          </span>
        )}
      </div>

      {/* Right: theme toggle + logo */}
      <div className="bb-right">
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
