import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import AppShell from './components/layout/AppShell';
import Login from './pages/Login';
import Register from './pages/Register';
import GlobalProjects from './pages/GlobalProjects';
import Portfolio from './pages/Portfolio';
import ProjectSettings from './pages/ProjectSettings';
import TestCaseLibrary from './pages/TestCaseLibrary';
import TestCycles from './pages/TestCycles';
import TestCyclesDashboard from './pages/TestCyclesDashboard';
import TestCycleDetail from './pages/TestCycleDetail';
import Assignments from './pages/Assignments';
import MyWork from './pages/MyWork';
import TaskLists from './pages/TaskLists';
import TaskListDetail from './pages/TaskListDetail';
import TaskDashboard from './pages/TaskDashboard';
import Wiki from './pages/Wiki';
import UserManagement from './pages/UserManagement';
import PersonalTasks from './pages/PersonalTasks';
import { isAuthenticated } from './lib/auth';
import { ErrorBoundary } from './components/ui/ErrorBoundary';

// ── Protected route ────────────────────────────────────────────────────────
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

// ── App ────────────────────────────────────────────────────────────────────
// Manual testing + task management only — no automation (script editor,
// execution, scheduler, reports) in this deployment.
export default function App() {
  return (
    <Routes>
      {/* Auth pages — no shell */}
      <Route path="/login"    element={<Login />} />
      <Route path="/register" element={<Register />} />

      {/* All protected pages — wrapped in AppShell + ErrorBoundary */}
      <Route
        element={
          <ProtectedRoute>
            <ErrorBoundary>
              <AppShell />
            </ErrorBoundary>
          </ProtectedRoute>
        }
      >
        {/* Global projects list */}
        <Route path="/projects" element={<GlobalProjects />} />

        {/* Per-project screens */}
        <Route path="/projects/:slug/test-cases"   element={<TestCaseLibrary />} />
        <Route path="/projects/:slug/test-cycles"  element={<TestCycles />} />
        <Route path="/projects/:slug/test-cycles/dashboard" element={<TestCyclesDashboard />} />
        <Route path="/projects/:slug/test-cycles/assignments" element={<Assignments />} />
        <Route path="/projects/:slug/test-cycles/:cycleId" element={<TestCycleDetail />} />
        <Route path="/projects/:slug/my-work"      element={<MyWork />} />
        <Route path="/projects/:slug/tasks"        element={<TaskLists />} />
        <Route path="/projects/:slug/tasks/dashboard" element={<TaskDashboard />} />
        <Route path="/projects/:slug/tasks/:listId" element={<TaskListDetail />} />
        <Route path="/projects/:slug/wiki"         element={<Wiki />} />
        <Route path="/projects/:slug/wiki/:pageId" element={<Wiki />} />
        <Route path="/projects/:slug/settings"     element={<ProjectSettings />} />
        <Route path="/admin/users"                 element={<UserManagement />} />
        <Route path="/personal-tasks"              element={<PersonalTasks />} />
        <Route path="/portfolio"                   element={<Portfolio />} />
      </Route>

      {/* Root redirect */}
      <Route path="/" element={<Navigate to="/projects" replace />} />
      <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes>
  );
}
