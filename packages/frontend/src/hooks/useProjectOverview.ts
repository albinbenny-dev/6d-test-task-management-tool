import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useTaskDashboard } from './useTasks';
import { useTestCycleDashboardSummary, useResourceSummary } from './useTestCycles';
import { useProjectDefects } from './useDefects';
import { isBugClosed } from '../lib/jiraBugStatus';
import { emptyStatusCounts } from '../lib/manualStatus';
import type {
  ManualResultStatus, TaskPriority, TestCycleSummary, TestCycleItem, ProjectDefect,
} from '../types';

export type ProjectHealthLevel = 'healthy' | 'at-risk' | 'critical';

export interface ProjectHealth {
  level: ProjectHealthLevel;
  reasons: string[];
}

export type SeverityBucket = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNSPECIFIED';

export const SEVERITY_LABEL: Record<SeverityBucket, string> = {
  CRITICAL: 'Critical', HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low', UNSPECIFIED: 'Unspecified',
};
export const SEVERITY_ACCENT: Record<SeverityBucket, string> = {
  CRITICAL: 'var(--rose)', HIGH: 'var(--amber)', MEDIUM: 'var(--cyan)', LOW: 'var(--text-dim)', UNSPECIFIED: 'var(--text-dim)',
};
const SEVERITY_ORDER: SeverityBucket[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNSPECIFIED'];

// Jira severity is a freeform custom field — bucket by keyword rather than
// trusting an exact string match, since workflows vary ("Blocker" vs
// "Critical", "Major" vs "High", etc).
export function severityBucket(name: string | null | undefined): SeverityBucket {
  const n = (name ?? '').toLowerCase();
  if (!n) return 'UNSPECIFIED';
  if (n.includes('critical') || n.includes('blocker')) return 'CRITICAL';
  if (n.includes('high') || n.includes('major')) return 'HIGH';
  if (n.includes('medium') || n.includes('moderate')) return 'MEDIUM';
  if (n.includes('low') || n.includes('minor') || n.includes('trivial')) return 'LOW';
  return 'UNSPECIFIED';
}

export type ResourceLoad = 'low' | 'medium' | 'high' | 'over';

export interface OverviewResourceRow {
  key: string;
  name: string;
  taskOpen: number;
  taskOverdue: number;
  testTotal: number;
  testPassRate: number;
  load: ResourceLoad;
}

function computeLoad(combined: number): ResourceLoad {
  if (combined >= 25) return 'over';
  if (combined >= 16) return 'high';
  if (combined >= 8) return 'medium';
  return 'low';
}

export interface FailingTestRow {
  id: string;
  title: string;
  status: ManualResultStatus;
  cycleId: string;
  cycleName: string;
  assigneeName: string;
  reason: string | null;
  jiraIssueKeys: string[];
}

export interface DefectRow {
  issueKey: string;
  summary: string;
  severity: SeverityBucket;
  assigneeName: string;
  daysOpen: number | null;
}

// Fans out to the same per-project endpoints TaskDashboard.tsx,
// TestCyclesDashboard.tsx and DefectsDashboard.tsx already use (plus one
// GET per active cycle, to surface failing/blocked test items) — no new
// backend aggregate. Mirrors usePortfolio.ts's "fan out, don't duplicate"
// approach, scoped to a single project instead of every project.
export function useProjectOverview(projectId: string | undefined) {
  const taskDashboard = useTaskDashboard(projectId);
  const cycleDashboard = useTestCycleDashboardSummary(projectId);
  const resourceSummary = useResourceSummary(projectId);
  const defects = useProjectDefects(projectId);

  const cycleSummaries = cycleDashboard.data?.summary ?? [];
  const activeCycles = useMemo(() => cycleSummaries.filter((s) => s.cycle.status === 'ACTIVE'), [cycleSummaries]);

  // Failing/blocked items aren't exposed by any existing summary endpoint —
  // only per-cycle detail has them. Active cycles per project are few, so
  // fetching each one's items is cheap and shares its cache (['test-cycle',
  // projectId, cycleId]) with useTestCycle, used by TestCycleDetail.tsx.
  const itemQueries = useQueries({
    queries: activeCycles.map((s) => ({
      queryKey: ['test-cycle', projectId, s.cycle.id],
      queryFn: async () => (await api.get<{ items: TestCycleItem[] }>(`/projects/${projectId}/test-cycles/${s.cycle.id}`)).data,
      enabled: !!projectId,
    })),
  });
  const itemsLoading = itemQueries.some((q) => q.isLoading);

  const isLoading = taskDashboard.isLoading || cycleDashboard.isLoading || resourceSummary.isLoading || defects.isLoading;

  return useMemo(() => {
    const taskData = taskDashboard.data;
    const openDefects = (defects.data ?? []).filter((d) => !isBugClosed(d.issue));

    // ── Testing status — summed across ACTIVE cycles only, same convention
    // as TestCyclesDashboard.tsx's "overall" stat row. ───────────────────
    const execTotals = emptyStatusCounts();
    let execTotal = 0;
    for (const s of activeCycles) {
      execTotal += s.total;
      (Object.keys(execTotals) as ManualResultStatus[]).forEach((k) => { execTotals[k] += s.counts[k]; });
    }
    const executedCount = execTotals.PASS + execTotals.FAIL + execTotals.BLOCKED;
    const passRate = executedCount > 0 ? Math.round((execTotals.PASS / executedCount) * 100) : null;
    const cycleProgress = execTotal > 0 ? Math.round((executedCount / execTotal) * 100) : 0;

    // ── Severity breakdown — open defects only, canonical order first ────
    const severityMap = new Map<SeverityBucket, number>();
    for (const d of openDefects) {
      const b = severityBucket(d.issue?.severityName);
      severityMap.set(b, (severityMap.get(b) ?? 0) + 1);
    }
    const severityRows = SEVERITY_ORDER
      .map((key) => ({ key, count: severityMap.get(key) ?? 0 }))
      .filter((r) => r.count > 0);
    const criticalDefectsOpen = severityMap.get('CRITICAL') ?? 0;

    // ── Resource workload — merge task load + test-item load by
    // ProjectMember id (assigneeId is the same id space in both summaries,
    // unlike Portfolio.tsx which must key by the cross-project User id). ──
    const resourceMap = new Map<string, OverviewResourceRow>();
    for (const r of taskData?.byAssignee ?? []) {
      const key = r.assigneeId ?? 'unassigned';
      resourceMap.set(key, { key, name: r.assigneeName, taskOpen: r.total, taskOverdue: r.overdue, testTotal: 0, testPassRate: 0, load: 'low' });
    }
    for (const r of resourceSummary.data ?? []) {
      const key = r.assigneeId ?? 'unassigned';
      const existing = resourceMap.get(key);
      if (existing) {
        existing.testTotal = r.total;
        existing.testPassRate = r.passRate;
      } else {
        resourceMap.set(key, { key, name: r.assigneeName, taskOpen: 0, taskOverdue: 0, testTotal: r.total, testPassRate: r.passRate, load: 'low' });
      }
    }
    const resources = [...resourceMap.values()]
      .filter((r) => r.taskOpen > 0 || r.testTotal > 0)
      .map((r) => ({ ...r, load: computeLoad(r.taskOpen + r.testTotal) }))
      .sort((a, b) => (b.taskOpen + b.testTotal) - (a.taskOpen + a.testTotal));

    // ── Failing / blocked test items — flattened across active cycles ────
    const failingTests: FailingTestRow[] = [];
    activeCycles.forEach((s, i) => {
      const items = itemQueries[i]?.data?.items ?? [];
      for (const item of items) {
        if (item.manualStatus !== 'FAIL' && item.manualStatus !== 'BLOCKED') continue;
        let jiraIssueKeys: string[] = [];
        try { jiraIssueKeys = JSON.parse(item.jiraIssueKeys) as string[]; } catch { /* leave empty */ }
        failingTests.push({
          id: item.id,
          title: item.testCase?.title ?? 'Untitled test case',
          status: item.manualStatus,
          cycleId: s.cycle.id,
          cycleName: s.cycle.name,
          assigneeName: item.assignee?.user.name ?? 'Unassigned',
          reason: item.reason ?? null,
          jiraIssueKeys,
        });
      }
    });
    failingTests.sort((a, b) => (a.status === b.status ? 0 : a.status === 'FAIL' ? -1 : 1));

    // ── Critical & high defects — open only, most aged first ─────────────
    const criticalHighDefects: DefectRow[] = openDefects
      .map((d: ProjectDefect) => {
        const severity = severityBucket(d.issue?.severityName);
        const created = d.issue?.jiraCreatedAt;
        return {
          issueKey: d.issueKey,
          summary: d.issue?.summary ?? '(not yet synced)',
          severity,
          assigneeName: d.issue?.assigneeName ?? 'Unassigned',
          daysOpen: created ? Math.floor((Date.now() - new Date(created).getTime()) / 86_400_000) : null,
        };
      })
      .filter((d) => d.severity === 'CRITICAL' || d.severity === 'HIGH')
      .sort((a, b) => {
        if (a.severity !== b.severity) return a.severity === 'CRITICAL' ? -1 : 1;
        return (b.daysOpen ?? 0) - (a.daysOpen ?? 0);
      });

    // ── Overall health — RAG verdict with a short, ranked rationale ──────
    const open = taskData ? taskData.total - taskData.counts.DONE : 0;
    const overdueCount = taskData?.overdueCount ?? 0;
    const overdueRatio = open > 0 ? overdueCount / open : 0;
    const completionRate = taskData?.completionRate ?? 100;

    const overdueCycles = activeCycles.filter((s) => s.cycle.dueDate && new Date(s.cycle.dueDate) < new Date());
    const atRiskCycle = activeCycles.find((s) => {
      if (!s.cycle.dueDate || overdueCycles.includes(s)) return false;
      const daysToDue = (new Date(s.cycle.dueDate).getTime() - Date.now()) / 86_400_000;
      const executed = s.counts.PASS + s.counts.FAIL + s.counts.BLOCKED;
      const progress = s.total > 0 ? executed / s.total : 0;
      return daysToDue <= 2 && progress < 0.7;
    });

    const reasons: string[] = [];
    if (overdueCount > 0) {
      reasons.push(overdueRatio > 0.25
        ? `${overdueCount} task${overdueCount === 1 ? '' : 's'} overdue (${Math.round(overdueRatio * 100)}% of open work)`
        : `${overdueCount} task${overdueCount === 1 ? '' : 's'} overdue`);
    }
    if (criticalDefectsOpen > 0) reasons.push(`${criticalDefectsOpen} unresolved critical defect${criticalDefectsOpen === 1 ? '' : 's'}`);
    if (overdueCycles.length > 0) {
      reasons.push(`"${overdueCycles[0].cycle.name}"${overdueCycles.length > 1 ? ` +${overdueCycles.length - 1} more` : ''} past due`);
    } else if (atRiskCycle) {
      reasons.push(`"${atRiskCycle.cycle.name}" due soon at ${Math.round((atRiskCycle.counts.PASS + atRiskCycle.counts.FAIL + atRiskCycle.counts.BLOCKED) / Math.max(atRiskCycle.total, 1) * 100)}% executed`);
    }

    let level: ProjectHealthLevel = 'healthy';
    if (overdueRatio > 0.25 || completionRate < 40 || criticalDefectsOpen >= 3 || overdueCycles.length > 0) level = 'critical';
    else if (overdueRatio > 0.10 || completionRate < 60 || criticalDefectsOpen >= 1 || !!atRiskCycle) level = 'at-risk';

    const health: ProjectHealth = {
      level,
      reasons: reasons.length > 0 ? reasons.slice(0, 3) : ['No overdue work, unresolved critical defects, or at-risk cycles'],
    };

    return {
      isLoading,
      itemsLoading,
      task: taskData,
      priorityBreakdown: taskData?.priorityBreakdown ?? ({} as Record<TaskPriority, number>),
      execTotals,
      executedCount,
      execTotal,
      passRate,
      cycleProgress,
      activeCycleCount: activeCycles.length,
      cycles: cycleSummaries as TestCycleSummary[],
      severityRows,
      criticalDefectsOpen,
      openDefectsCount: openDefects.length,
      resources,
      failingTests,
      criticalHighDefects,
      health,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskDashboard.data, cycleSummaries, activeCycles, resourceSummary.data, defects.data, itemQueries, isLoading, itemsLoading]);
}
