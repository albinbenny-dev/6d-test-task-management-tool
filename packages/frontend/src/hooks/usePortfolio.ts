import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { api } from '../lib/api';
import { milestoneDueBucket, executionSlipDays, type MilestoneDueBucket } from '../lib/milestoneMeta';
import type { Project, TaskDashboardSummary, TestCycleSummary, JiraResolutionSummary, TaskPriority, Milestone } from '../types';

export type ProjectHealth = 'healthy' | 'at-risk' | 'critical';
export type ResourceLoad = 'low' | 'medium' | 'high' | 'over';

export interface PortfolioProjectRow {
  id: string;
  slug: string;
  name: string;
  color?: string;
  open: number;
  overdue: number;
  completionRate: number;
  activeCycles: number;
  passRate: number | null; // null when the project has no active cycles at all
  resources: number;
  health: ProjectHealth;
}

export interface PortfolioResourceRow {
  userId: string | null; // null only for the shared 'Unassigned' bucket
  name: string;
  open: number;
  overdue: number;
  load: ResourceLoad;
  projects: { slug: string; name: string; color?: string }[];
}

export interface PortfolioOverdueTask {
  id: string;
  title: string;
  priority: TaskPriority;
  assigneeName: string;
  projectSlug: string;
  projectName: string;
  taskListId: string;
  daysOverdue: number;
}

// Payment-linked, undelivered milestones only — same filter as the Project
// Overview widget — so "what's coming up/late" reads identically whether a
// PM is looking at one project or the whole portfolio.
export interface PortfolioMilestoneRow {
  id: string;
  name: string;
  projectSlug: string;
  projectName: string;
  projectColor?: string;
  targetDate: string | null;
  bucket: MilestoneDueBucket;
  slipDays: number | null;
}

export interface PortfolioData {
  isLoading: boolean;
  projectCount: number;
  totalOpen: number;
  totalOverdue: number;
  completionRate: number; // weighted (Σdone / Σtotal), not an average of percentages
  passRate: number | null; // weighted, active cycles only, across the whole portfolio
  resourceCount: number;
  unassignedOpenCount: number;
  unassignedByProject: { name: string; slug: string; count: number }[];
  healthCounts: { healthy: number; atRisk: number; critical: number };
  projects: PortfolioProjectRow[];
  resources: PortfolioResourceRow[];
  overdueTasks: PortfolioOverdueTask[];
  milestonesOverdueCount: number;
  milestonesDueSoonCount: number; // "due this month", payment-linked, across every project
  upcomingMilestones: PortfolioMilestoneRow[]; // payment-linked, undelivered, worst-first
}

// Same overdue-ratio / completion-rate thresholds pitched in the reviewed
// prototype — easy to retune once real portfolio data has been seen.
function computeHealth(open: number, overdue: number, completionRate: number): ProjectHealth {
  const overdueRatio = open > 0 ? overdue / open : 0;
  if (overdueRatio > 0.25 || completionRate < 40) return 'critical';
  if (overdueRatio > 0.10 || completionRate < 60) return 'at-risk';
  return 'healthy';
}

function computeLoad(open: number): ResourceLoad {
  if (open >= 40) return 'over';
  if (open >= 25) return 'high';
  if (open >= 10) return 'medium';
  return 'low';
}

// Fans out to the SAME per-project endpoints (and query keys) the Task
// Dashboard / Test Cycles Dashboard pages already use — a portfolio load
// warms their cache and vice versa. No new backend aggregate endpoint:
// everything here is computed from data those two endpoints already return.
export function usePortfolioData(projects: Project[]): PortfolioData {
  const taskQueries = useQueries({
    queries: projects.map((p) => ({
      queryKey: ['tasks-dashboard', p.id],
      queryFn: async () => (await api.get<TaskDashboardSummary>(`/projects/${p.id}/tasks/dashboard/summary`)).data,
      enabled: !!p.id,
    })),
  });

  const cycleQueries = useQueries({
    queries: projects.map((p) => ({
      queryKey: ['test-cycles-dashboard-summary', p.id],
      queryFn: async () => (await api.get<{ summary: TestCycleSummary[]; jira: JiraResolutionSummary }>(`/projects/${p.id}/test-cycles/dashboard/summary`)).data,
      enabled: !!p.id,
    })),
  });

  // Same query key ['milestones', p.id] the per-project Milestones page and
  // Project Overview widget use — a portfolio load warms their cache and
  // vice versa, same convention as taskQueries/cycleQueries above.
  const milestoneQueries = useQueries({
    queries: projects.map((p) => ({
      queryKey: ['milestones', p.id],
      queryFn: async () => (await api.get<{ milestones: Milestone[] }>(`/projects/${p.id}/milestones`)).data.milestones ?? [],
      enabled: !!p.id,
    })),
  });

  const isLoading = taskQueries.some((q) => q.isLoading) || cycleQueries.some((q) => q.isLoading) || milestoneQueries.some((q) => q.isLoading);

  return useMemo(() => {
    const projectRows: PortfolioProjectRow[] = [];
    const resourceMap = new Map<string, PortfolioResourceRow>();
    const overdueTasks: PortfolioOverdueTask[] = [];
    const unassignedByProject: { name: string; slug: string; count: number }[] = [];
    const upcomingMilestones: PortfolioMilestoneRow[] = [];

    let totalOpen = 0, totalOverdue = 0, totalDone = 0, totalTasks = 0;
    let totalPass = 0, totalActiveItems = 0;
    let milestonesOverdueCount = 0, milestonesDueSoonCount = 0;
    const now = Date.now();

    projects.forEach((project, i) => {
      const taskData = taskQueries[i]?.data;
      const cycleData = cycleQueries[i]?.data;
      const milestoneData = milestoneQueries[i]?.data ?? [];
      if (!taskData) return; // excluded from aggregates, not a crash — e.g. a transient fetch failure

      const open = taskData.total - taskData.counts.DONE;
      const overdue = taskData.overdueCount;
      totalOpen += open;
      totalOverdue += overdue;
      totalDone += taskData.counts.DONE;
      totalTasks += taskData.total;

      // Only ACTIVE cycles count toward pass rate / active-cycle count —
      // mirrors TestCyclesDashboard.tsx's own "overall" computation, so a
      // stale PLANNING/CLOSED cycle can't skew either number.
      const activeCycles = (cycleData?.summary ?? []).filter((s) => s.cycle.status === 'ACTIVE');
      let projectPass = 0, projectTotal = 0;
      for (const s of activeCycles) { projectPass += s.counts.PASS; projectTotal += s.total; }
      totalPass += projectPass;
      totalActiveItems += projectTotal;

      const completionRate = taskData.completionRate;
      const passRate = projectTotal > 0 ? Math.round((projectPass / projectTotal) * 100) : null;

      projectRows.push({
        id: project.id,
        slug: project.slug,
        name: project.name,
        color: project.color,
        open,
        overdue,
        completionRate,
        activeCycles: activeCycles.length,
        passRate,
        resources: project._count?.members ?? 0,
        health: computeHealth(open, overdue, completionRate),
      });

      if (taskData.unassignedOpenCount > 0) {
        unassignedByProject.push({ name: project.name, slug: project.slug, count: taskData.unassignedOpenCount });
      }

      for (const row of taskData.byAssignee) {
        const key = row.assigneeUserId ?? 'unassigned';
        if (!resourceMap.has(key)) {
          resourceMap.set(key, { userId: row.assigneeUserId, name: row.assigneeName, open: 0, overdue: 0, load: 'low', projects: [] });
        }
        const merged = resourceMap.get(key)!;
        merged.open += row.total;
        merged.overdue += row.overdue;
        if (!merged.projects.some((p) => p.slug === project.slug)) {
          merged.projects.push({ slug: project.slug, name: project.name, color: project.color });
        }
      }

      for (const task of taskData.overdueTasks) {
        if (!task.dueDate) continue;
        overdueTasks.push({
          id: task.id,
          title: task.title,
          priority: task.priority,
          assigneeName: task.assignee?.user.name ?? 'Unassigned',
          projectSlug: project.slug,
          projectName: project.name,
          taskListId: task.taskListId,
          daysOverdue: Math.max(1, Math.floor((now - new Date(task.dueDate).getTime()) / 86_400_000)),
        });
      }

      // Payment-linked, undelivered milestones only — same filter as the
      // Project Overview widget, so the portfolio reads consistently.
      for (const m of milestoneData) {
        if (!m.isPaymentLinked || m.isCompleted) continue;
        const bucket = milestoneDueBucket(m);
        if (bucket === 'Overdue') milestonesOverdueCount++;
        else if (bucket === 'Due this month') milestonesDueSoonCount++;
        upcomingMilestones.push({
          id: m.id,
          name: m.name,
          projectSlug: project.slug,
          projectName: project.name,
          projectColor: project.color,
          targetDate: m.targetDate ?? null,
          bucket,
          slipDays: executionSlipDays(m),
        });
      }
    });

    for (const row of resourceMap.values()) row.load = computeLoad(row.open);

    const healthCounts = projectRows.reduce(
      (acc, p) => { acc[p.health === 'at-risk' ? 'atRisk' : p.health]++; return acc; },
      { healthy: 0, atRisk: 0, critical: 0 },
    );

    return {
      isLoading,
      projectCount: projectRows.length,
      totalOpen,
      totalOverdue,
      completionRate: totalTasks > 0 ? Math.round((totalDone / totalTasks) * 100) : 0,
      passRate: totalActiveItems > 0 ? Math.round((totalPass / totalActiveItems) * 100) : null,
      resourceCount: resourceMap.size - (resourceMap.has('unassigned') ? 1 : 0),
      unassignedOpenCount: unassignedByProject.reduce((sum, u) => sum + u.count, 0),
      unassignedByProject: unassignedByProject.sort((a, b) => b.count - a.count).slice(0, 3),
      healthCounts,
      projects: projectRows.sort((a, b) => b.overdue - a.overdue || a.name.localeCompare(b.name)),
      resources: [...resourceMap.values()]
        .filter((r) => r.userId !== null)
        .sort((a, b) => b.open - a.open),
      overdueTasks: overdueTasks.sort((a, b) => b.daysOverdue - a.daysOverdue).slice(0, 30),
      milestonesOverdueCount,
      milestonesDueSoonCount,
      // Worst-first: overdue, then due this month, then everything else —
      // ties broken by soonest target date — same ranking as
      // PaymentMilestonesTable in ProjectOverview.tsx.
      upcomingMilestones: upcomingMilestones
        .sort((a, b) => {
          const rank = (m: PortfolioMilestoneRow) => (m.bucket === 'Overdue' ? 0 : m.bucket === 'Due this month' ? 1 : 2);
          if (rank(a) !== rank(b)) return rank(a) - rank(b);
          if (a.targetDate && b.targetDate) return new Date(a.targetDate).getTime() - new Date(b.targetDate).getTime();
          return a.targetDate ? -1 : b.targetDate ? 1 : 0;
        })
        .slice(0, 30),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, isLoading, taskQueries, cycleQueries, milestoneQueries]);
}
