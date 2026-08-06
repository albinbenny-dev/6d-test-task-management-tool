import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type {
  TestCycle, TestCycleItem, TestCycleStatus, ManualResultStatus, JiraBugSummary,
  TestCycleSummary, ResourceSummaryRow, JiraResolutionSummary, AssignmentItem,
  AssignmentHistoryEntry, TestCycleItemHistoryEntry, JiraBugSummaryWithCycles,
  DashboardHistoryEntry,
} from '../types';

export function useTestCycles(projectId: string | undefined) {
  return useQuery({
    queryKey: ['test-cycles', projectId],
    queryFn: async () => {
      const res = await api.get<{ cycles: TestCycle[] }>(`/projects/${projectId}/test-cycles`);
      return res.data.cycles ?? [];
    },
    enabled: !!projectId,
  });
}

export function useTestCycleDashboardSummary(projectId: string | undefined) {
  return useQuery({
    queryKey: ['test-cycles-dashboard-summary', projectId],
    queryFn: async () => {
      const res = await api.get<{ summary: TestCycleSummary[]; jira: JiraResolutionSummary }>(
        `/projects/${projectId}/test-cycles/dashboard/summary`,
      );
      return res.data;
    },
    enabled: !!projectId,
  });
}

export function useResourceSummary(projectId: string | undefined) {
  return useQuery({
    queryKey: ['test-cycles-resource-summary', projectId],
    queryFn: async () => {
      const res = await api.get<{ data: ResourceSummaryRow[] }>(
        `/projects/${projectId}/test-cycles/dashboard/resource-summary`,
      );
      return res.data.data ?? [];
    },
    enabled: !!projectId,
  });
}

// Daily execution counts across every cycle in the project — powers the
// Test Cycles Dashboard's "Daily Execution Count by Cycle" chart.
export function useTestCycleDashboardHistory(projectId: string | undefined, days = 30) {
  return useQuery({
    queryKey: ['test-cycles-dashboard-history', projectId, days],
    queryFn: async () => {
      const res = await api.get<{ days: number; history: DashboardHistoryEntry[] }>(
        `/projects/${projectId}/test-cycles/dashboard/history`,
        { params: { days } },
      );
      return res.data;
    },
    enabled: !!projectId,
  });
}

export function useTestCycle(projectId: string | undefined, cycleId: string | undefined) {
  return useQuery({
    queryKey: ['test-cycle', projectId, cycleId],
    queryFn: async () => {
      const res = await api.get<{ cycle: TestCycle; items: TestCycleItem[] }>(
        `/projects/${projectId}/test-cycles/${cycleId}`,
      );
      return res.data;
    },
    enabled: !!projectId && !!cycleId,
  });
}

export function useCreateTestCycle(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { name: string; description?: string; testCaseIds: string[]; jiraLabels?: string[]; jiraJql?: string; driveFolderUrl?: string; dueDate?: string | null }) => {
      const res = await api.post<{ cycle: TestCycle }>(`/projects/${projectId}/test-cycles`, data);
      return res.data.cycle;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['test-cycles', projectId] }),
  });
}

export function useUpdateTestCycle(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { id: string; name?: string; description?: string; jiraLabels?: string[]; jiraJql?: string | null; driveFolderUrl?: string | null; dueDate?: string | null }) => {
      const { id, ...body } = data;
      const res = await api.put<{ cycle: TestCycle }>(`/projects/${projectId}/test-cycles/${id}`, body);
      return res.data.cycle;
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['test-cycles', projectId] });
      void qc.invalidateQueries({ queryKey: ['test-cycle', projectId, vars.id] });
      // jiraLabels/jiraJql changes affect the label-match union re-evaluated
      // at read time in all three of these — without this, editing a wrong
      // label to a correct one leaves the old (now-stale) bug list showing
      // until something else happens to invalidate these caches (e.g. Sync Now).
      void qc.invalidateQueries({ queryKey: ['test-cycle-bugs', projectId] });
      void qc.invalidateQueries({ queryKey: ['test-cycles-all-bugs', projectId] });
      void qc.invalidateQueries({ queryKey: ['test-cycles-dashboard-summary', projectId] });
    },
  });
}

export function useLinkBugToItem(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { cycleId: string; issueKey: string; testCycleItemId: string }) => {
      const res = await api.post<{ item: TestCycleItem }>(
        `/projects/${projectId}/test-cycles/${data.cycleId}/bugs/${encodeURIComponent(data.issueKey)}/link`,
        { testCycleItemId: data.testCycleItemId },
      );
      return res.data.item;
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['test-cycle', projectId, vars.cycleId] });
      void qc.invalidateQueries({ queryKey: ['test-cycle-bugs', projectId, vars.cycleId] });
      void qc.invalidateQueries({ queryKey: ['test-cycles-all-bugs', projectId] });
    },
  });
}

// Detaches a bug from a test case — see the DELETE .../bugs/:issueKey/link
// route comment for why this exists (undoing a wrong/accidental link).
export function useUnlinkBugFromItem(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { cycleId: string; issueKey: string; testCycleItemId: string }) => {
      const res = await api.delete<{ item: TestCycleItem }>(
        `/projects/${projectId}/test-cycles/${data.cycleId}/bugs/${encodeURIComponent(data.issueKey)}/link`,
        { data: { testCycleItemId: data.testCycleItemId } },
      );
      return res.data.item;
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['test-cycle', projectId, vars.cycleId] });
      void qc.invalidateQueries({ queryKey: ['test-cycle-bugs', projectId, vars.cycleId] });
      void qc.invalidateQueries({ queryKey: ['test-cycles-all-bugs', projectId] });
    },
  });
}

export function useSetTestCycleStatus(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { id: string; status: TestCycleStatus }) => {
      const res = await api.patch<{ cycle: TestCycle }>(
        `/projects/${projectId}/test-cycles/${data.id}/status`,
        { status: data.status },
      );
      return res.data.cycle;
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['test-cycles', projectId] });
      void qc.invalidateQueries({ queryKey: ['test-cycle', projectId, vars.id] });
    },
  });
}

export function useDeleteTestCycle(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cycleId: string) => {
      await api.delete(`/projects/${projectId}/test-cycles/${cycleId}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['test-cycles', projectId] }),
  });
}

export function useAddTestCycleItems(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { cycleId: string; testCaseIds: string[] }) => {
      const res = await api.patch<{ added: number }>(
        `/projects/${projectId}/test-cycles/${data.cycleId}/items`,
        { testCaseIds: data.testCaseIds },
      );
      return res.data;
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['test-cycle', projectId, vars.cycleId] });
    },
  });
}

export function useRemoveTestCycleItem(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { cycleId: string; itemId: string }) => {
      const res = await api.delete<{ message: string }>(
        `/projects/${projectId}/test-cycles/${data.cycleId}/items/${data.itemId}`,
      );
      return res.data;
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['test-cycle', projectId, vars.cycleId] });
    },
  });
}

export function useBulkRemoveTestCycleItems(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { cycleId: string; itemIds: string[] }) => {
      const res = await api.delete<{ removed: number }>(
        `/projects/${projectId}/test-cycles/${data.cycleId}/items`,
        { data: { itemIds: data.itemIds } },
      );
      return res.data;
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['test-cycle', projectId, vars.cycleId] });
    },
  });
}

export function useAssignTestCycleItem(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { cycleId: string; itemId: string; assigneeUserId: string | null }) => {
      const res = await api.patch<{ item: TestCycleItem }>(
        `/projects/${projectId}/test-cycles/${data.cycleId}/items/${data.itemId}/assign`,
        { assigneeUserId: data.assigneeUserId },
      );
      return res.data.item;
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['test-cycle', projectId, vars.cycleId] });
    },
  });
}

export function useBulkAssignTestCycleItems(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { cycleId: string; itemIds: string[]; assigneeUserId: string | null }) => {
      const res = await api.patch<{ updated: number }>(
        `/projects/${projectId}/test-cycles/${data.cycleId}/items/assign`,
        { itemIds: data.itemIds, assigneeUserId: data.assigneeUserId },
      );
      return res.data;
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['test-cycle', projectId, vars.cycleId] });
    },
  });
}

export function useUpdateTestCycleItemStatus(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      cycleId: string;
      itemId: string;
      status: ManualResultStatus;
      reason?: string;
      jiraIssueKeys?: string[];
    }) => {
      const { cycleId, itemId, ...body } = data;
      const res = await api.patch<{ item: TestCycleItem }>(
        `/projects/${projectId}/test-cycles/${cycleId}/items/${itemId}/status`,
        body,
      );
      return res.data.item;
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['test-cycle', projectId, vars.cycleId] });
      void qc.invalidateQueries({ queryKey: ['test-cycle-history', projectId, vars.cycleId] });
      // Prefix match invalidates every variant (self + any ?userId= lookup).
      void qc.invalidateQueries({ queryKey: ['test-cycle-assignments', projectId] });
      void qc.invalidateQueries({ queryKey: ['test-cycles-dashboard-summary', projectId] });
      void qc.invalidateQueries({ queryKey: ['test-cycles-resource-summary', projectId] });
      // Bug-list views now embed each linked test case's own execution
      // status — a status change from the test case modal on any of them
      // needs those lists refetched too, or they'd keep showing the status
      // as of whenever they last loaded.
      void qc.invalidateQueries({ queryKey: ['test-cycle-bugs', projectId, vars.cycleId] });
      void qc.invalidateQueries({ queryKey: ['test-cycles-all-bugs', projectId] });
      void qc.invalidateQueries({ queryKey: ['project-defects', projectId] });
    },
  });
}

export function useTestCycleBugs(projectId: string | undefined, cycleId: string | undefined) {
  return useQuery({
    queryKey: ['test-cycle-bugs', projectId, cycleId],
    queryFn: async () => {
      const res = await api.get<{ bugs: JiraBugSummary[] }>(
        `/projects/${projectId}/test-cycles/${cycleId}/bugs`,
      );
      return res.data.bugs ?? [];
    },
    enabled: !!projectId && !!cycleId,
  });
}

// Project-wide bug board (Test Cycles list page) — union across every cycle,
// each bug annotated with which cycle(s) reference it.
export function useAllTestCycleBugs(projectId: string | undefined) {
  return useQuery({
    queryKey: ['test-cycles-all-bugs', projectId],
    queryFn: async () => {
      const res = await api.get<{ bugs: JiraBugSummaryWithCycles[] }>(
        `/projects/${projectId}/test-cycles/bugs`,
      );
      return res.data.bugs ?? [];
    },
    enabled: !!projectId,
  });
}

// Every manual status change across the whole cycle, fetched once and
// shared (react-query dedupes by queryKey) — powers the per-item execution
// timeline and "retested" badge on the Test Cases tab.
export function useTestCycleHistory(projectId: string | undefined, cycleId: string | undefined) {
  return useQuery({
    queryKey: ['test-cycle-history', projectId, cycleId],
    queryFn: async () => {
      const res = await api.get<{ history: TestCycleItemHistoryEntry[] }>(
        `/projects/${projectId}/test-cycles/${cycleId}/history`,
      );
      return res.data.history ?? [];
    },
    enabled: !!projectId && !!cycleId,
  });
}

// ── Assignments — items assigned to a resource across all cycles ──────────
// Omit userId to view your own (resolved server-side via req.projectMember);
// pass another user's id to view theirs — the backend 403s unless the caller
// holds a privileged role.

export function useMyAssignments(projectId: string | undefined, userId?: string) {
  return useQuery({
    queryKey: ['test-cycle-assignments', projectId, userId ?? 'self'],
    queryFn: async () => {
      const res = await api.get<{ userId: string; items: AssignmentItem[] }>(
        `/projects/${projectId}/test-cycles/assignments`,
        { params: userId ? { userId } : undefined },
      );
      return res.data;
    },
    enabled: !!projectId,
  });
}

// ── Assignment history — the resource's daily run log, sourced from the
// append-only TestCycleItemHistory audit trail ─────────────────────────────

export function useAssignmentHistory(projectId: string | undefined, userId?: string, days = 30) {
  return useQuery({
    queryKey: ['test-cycle-assignment-history', projectId, userId ?? 'self', days],
    queryFn: async () => {
      const res = await api.get<{ userId: string; days: number; history: AssignmentHistoryEntry[] }>(
        `/projects/${projectId}/test-cycles/assignments/history`,
        { params: { ...(userId ? { userId } : {}), days } },
      );
      return res.data;
    },
    enabled: !!projectId,
  });
}
