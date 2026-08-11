import { useEffect } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import BrandBanner from './BrandBanner';
import Sidebar from './Sidebar';
import ChatWidget from '../chat/ChatWidget';
import ScanNotificationManager from '../scan/ScanNotificationManager';
import HealNotificationManager from '../healing/HealNotificationManager';
import { useProjectStore } from '../../stores/projectStore';
import { useProjects } from '../../hooks/useProjects';

export default function AppShell() {
  const { slug } = useParams<{ slug?: string }>();
  const { setActiveProject, setProjects } = useProjectStore();
  const { data: projects, isSuccess } = useProjects();

  useEffect(() => {
    if (isSuccess && projects) {
      setProjects(projects);
      if (slug) {
        const found = projects.find((p) => p.slug === slug) ?? null;
        setActiveProject(found);
      } else {
        setActiveProject(null);
      }
    }
  }, [isSuccess, projects, slug, setProjects, setActiveProject]);

  return (
    <div style={{ minHeight: 'calc(100vh / var(--app-zoom))', background: 'var(--bg)' }}>
      {/* Global background listeners — fire notifications regardless of active page */}
      <ScanNotificationManager />
      <HealNotificationManager />

      {/* Fixed top banner */}
      <BrandBanner />

      {/* Layout below banner — `calc(100vh / var(--app-zoom) - 64px)` rather
          than plain `100vh`: compact mode's `zoom` (globals.css) scales
          rendering, but `vh` always measures the true, unzoomed viewport,
          so a plain `calc(100vh - 64px)` here would only ever visually
          fill --app-zoom's worth of the screen, leaving blank space below. */}
      <div
        style={{
          marginTop: '64px',
          height: 'calc(100vh / var(--app-zoom) - 64px)',
          display: 'flex',
          overflow: 'hidden',
        }}
      >
        <Sidebar slug={slug} />

        <main
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Outlet />
        </main>
      </div>

      <ChatWidget />
    </div>
  );
}
