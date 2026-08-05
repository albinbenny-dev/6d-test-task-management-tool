import { create } from 'zustand';
import type { Project, User } from '../types';
import { getCurrentUser } from '../lib/auth';

const THEME_KEY = 'qai-theme';
const DENSITY_KEY = 'qai-density';

function applyTheme(theme: 'light' | 'dark'): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

// "Compact" scales the whole app down (like a persistent zoom-out) so more
// fits on small/low-res laptop screens without every page having to shrink
// its own paddings/fonts individually. See .brand-banner-top's density
// toggle button and the [data-density="compact"] rule in globals.css.
function applyDensity(density: 'standard' | 'compact'): void {
  document.documentElement.setAttribute('data-density', density);
}

const savedTheme = (localStorage.getItem(THEME_KEY) as 'light' | 'dark') ?? 'light';
applyTheme(savedTheme);

const savedDensity = (localStorage.getItem(DENSITY_KEY) as 'standard' | 'compact') ?? 'standard';
applyDensity(savedDensity);

interface ProjectStore {
  activeProject: Project | null;
  setActiveProject: (p: Project | null) => void;
  projects: Project[];
  setProjects: (ps: Project[]) => void;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  compactMode: boolean;
  toggleCompactMode: () => void;
  currentUser: User | null;
  setCurrentUser: (u: User | null) => void;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  activeProject: null,
  setActiveProject: (p) => set({ activeProject: p }),
  projects: [],
  setProjects: (ps) => set({ projects: ps }),
  theme: savedTheme,
  toggleTheme: () => {
    const next = get().theme === 'light' ? 'dark' : 'light';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
    set({ theme: next });
  },
  compactMode: savedDensity === 'compact',
  toggleCompactMode: () => {
    const next = get().compactMode ? 'standard' : 'compact';
    localStorage.setItem(DENSITY_KEY, next);
    applyDensity(next);
    set({ compactMode: next === 'compact' });
  },
  currentUser: getCurrentUser(),
  setCurrentUser: (u) => set({ currentUser: u }),
}));
