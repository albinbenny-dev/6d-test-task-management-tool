export interface User {
  id: string;
  email: string;
  name: string;
  globalRole: 'SUPER_ADMIN' | 'ADMIN' | 'SUPER_USER' | 'STANDARD_USER';
}

/** Project-level role assigned to a ProjectMember */
export type ProjectRole = 'ADMIN' | 'SUPER_USER' | 'STANDARD_USER' | 'TEST_USER';

export interface AuthResponse {
  token: string;
  user: User;
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  description?: string;
  baseUrl?: string;
  color?: string;
  reqLibraryPath?: string;
  videoEnabled?: boolean;
  createdAt: string;
  createdBy: string;
  /** The authenticated user's role in this project (injected by GET /projects) */
  myRole?: ProjectRole | null;
  _count?: {
    testCases: number;
    tcItems: number;
    members: number;
    runs?: number;
  };
  members?: ProjectMember[];
  envConfigs?: EnvConfig[];
}

export interface ProjectMember {
  projectId: string;
  userId: string;
  role: ProjectRole;
  user: {
    id: string;
    name: string;
    email: string;
  };
}

export interface EnvConfig {
  id: string;
  projectId: string;
  name: string;
  baseUrl: string;
  username?: string | null;
  password?: string | null;
  isDefault: boolean;
}

export interface TestCase {
  id: string;
  projectId: string;
  tcId: string;
  title: string;
  sortOrder?: number;
  description?: string;
  steps: string[];
  expectedResult?: string;
  type: 'UI' | 'API' | 'SIT';
  tags: string[];
  useCaseTag?: string;
  status: 'DRAFT' | 'APPROVED' | 'DEPRECATED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  sourceRef?: string;
  generationHints?: string | null;
  /** ID of the TC whose script covers the setup steps (login + navigation) for this TC */
  prerequisiteTcId?: string | null;
  /** Minimal info about the prerequisite TC for display */
  prerequisiteTc?: { id: string; tcId: string; title: string } | null;
  lastRun?: RunResult;
  /** Last ≤5 terminal run results, oldest → newest. Each carries the runId for navigation. */
  recentRunStatuses?: Array<{ status: 'PASSED' | 'FAILED' | 'SKIPPED' | 'CANCELLED'; runId: string }>;
}

export interface Run {
  id: string;
  projectId: string;
  runSeq: number;
  name: string;
  environment: string;
  status: 'PENDING' | 'RUNNING' | 'PASSED' | 'FAILED' | 'CANCELLED';
  startedAt?: string;
  completedAt?: string;
  triggerType: 'MANUAL' | 'SCHEDULED' | 'INDIVIDUAL' | 'GROUP' | 'HEAL_RERUN';
  createdByUserId?: string | null;
  results?: RunResult[];
}

export interface RunResult {
  id: string;
  runId: string;
  testCaseId: string;
  status: 'PENDING' | 'RUNNING' | 'PASSED' | 'FAILED' | 'CANCELLED' | 'SKIPPED';
  duration?: number;
  errorMessage?: string;
  screenshotPath?: string;
  videoPath?: string;
  rfLogPath?: string;
}

export interface Schedule {
  id: string;
  projectId: string;
  name: string;
  cronExpression: string;
  testCaseIds: string;
  environment: string;
  isActive: boolean;
  record: boolean;
  emailRecipients: string;
  createdAt: string;
  updatedAt: string;
}

export interface SuiteStage {
  useCaseTag: string;
  mode: 'sequential' | 'parallel';
  /** Explicit TC IDs to run — if omitted the suite run will use all TCs in the use case */
  testCaseIds?: string[];
}

export interface Suite {
  id: string;
  projectId: string;
  name: string;
  testCaseIds: string; // JSON string — legacy
  stages: string;     // JSON string — parse to SuiteStage[]
  createdAt: string;
  updatedAt: string;
}

export interface Script {
  id: string;
  projectId: string;
  testCaseId?: string | null;
  filename: string;
  scriptType?: 'ROBOT';
  isCustomUpload: boolean;
  createdAt: string;
  updatedAt: string;
  testCase?: Pick<TestCase, 'id' | 'tcId' | 'title'> & { useCaseTag?: string | null };
  lastRunStatus?: 'PASSED' | 'FAILED' | 'RUNNING' | 'PENDING' | 'CANCELLED' | null;
  size?: number | null;
  modifiedAt?: string | null;
}

export interface ProjectResource {
  id: string;
  projectId: string;
  filename: string;
  originalName: string;
  size: number;
  uploadedAt: string;
  /** Full container path: /scripts/{slug}/resources/{filename} */
  containerPath?: string;
  /** True for .xlsx, .xls, .pdf and other non-text files */
  isBinary?: boolean;
}

export interface DiffLine {
  type: 'add' | 'remove' | 'unchanged';
  line: string;
  lineNum: number;
}

// ── Reports / Dashboard types ──────────────────────────────────────────────

export interface FlakyTest {
  id: string;
  tcId: string;
  title: string;
  passCount: number;
  failCount: number;
  recentResults: Array<'PASSED' | 'FAILED' | 'SKIPPED'>;
}

export interface ProjectStats {
  totalTests: number;
  scriptsGenerated: number;
  totalRuns: number;
  lastRunPassCount: number;
  lastRunFailCount: number;
  avgPassRate: number;
  activeSchedules: number;
  pendingHeals: number;
  flakyTests: FlakyTest[];
}

export interface RunTrendPoint {
  date: string;
  passed: number;
  failed: number;
  skipped: number;
}

export interface AgentStatus {
  name: string;
  label: string;
  status: 'ok' | 'busy' | 'idle';
  detail: string;
}

export interface TopSuiteEntry {
  name: string;
  runCount: number;
  lastRunStatuses: string[];
  successRate: number;
  lastRunAt: string;
}

export interface DashboardData {
  stats: ProjectStats;
  trend: RunTrendPoint[];
  recentRuns: Array<{
    id: string;
    name: string;
    environment: string;
    status: string;
    triggerType: string;
    createdAt: string;
    startedAt?: string;
    completedAt?: string;
    results: Array<{ status: string }>;
    _count: { results: number };
  }>;
  agentStatuses: AgentStatus[];
  topSuites: TopSuiteEntry[];
  projectTokens: number;
}

export interface AIAnalysis {
  summary: string;
  rootCauses: string[];
  recommendations: string[];
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface ReportRecord {
  id: string;
  projectId: string;
  runId: string;
  summary: string;
  aiAnalysis: string; // JSON string of AIAnalysis
  emailSentAt?: string | null;
  createdAt: string;
}

export interface ReportRun {
  id: string;
  projectId: string;
  runSeq: number;
  name: string;
  environment: string;
  status: string;
  triggerType: string;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  results: Array<{
    id: string;
    status: 'PENDING' | 'RUNNING' | 'PASSED' | 'FAILED' | 'CANCELLED' | 'SKIPPED';
    duration?: number | null;
    errorMessage?: string | null;
    screenshotPath?: string | null;
    videoPath?: string | null;
    rfLogPath?: string | null;
    testCase: { id: string; tcId: string; title: string; type: string; useCaseTag?: string | null };
  }>;
  _count: { results: number };
  report?: ReportRecord | null;
}

export interface EmailConfig {
  recipients: string[];
  triggerEvents: string[];
}

export type NavItem = {
  label: string;
  path: string;
  icon: string;
  badge?: string | number;
  badgeVariant?: 'red' | 'green' | 'blue';
};

export type NavSection = {
  label: string;
  items: NavItem[];
};

export interface FolderImportResult {
  imported: Array<{ filename: string; testCasesCreated: number }>;
  resources: string[];
  warnings: string[];
}

// ── Test Management — manual test cycles, assignment, Jira linking ──────────

export type TestCycleStatus = 'PLANNING' | 'ACTIVE' | 'CLOSED';
export type ManualResultStatus = 'NOT_RUN' | 'IN_PROGRESS' | 'PASS' | 'FAIL' | 'BLOCKED';

export interface TestCycle {
  id: string;
  projectId: string;
  name: string;
  description?: string | null;
  status: TestCycleStatus;
  linkedJiraKeys: string; // JSON string — parse to string[]
  jiraLabels: string; // JSON string — parse to string[] — opco/team label(s) for bug auto-discovery
  jiraJql?: string | null; // raw JQL, additive alongside jiraLabels
  jqlDiscoveredKeys: string; // JSON string — parse to string[] — cache of jiraJql's last sync match
  driveFolderUrl?: string | null; // lead-provided Drive folder link for tester-uploaded artifacts
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
  _count?: { items: number };
}

export interface ProjectMemberSearchResult {
  id: string; // ProjectMember.id — this is the assigneeId, not the User id
  user: { id: string; name: string; email: string };
}

// Test Management links to TcItem (the real TC Library test case), never the
// Script/TestCase model — see packages/api/prisma/schema.prisma's TestCycleItem
// comment. This is a minimal shape of TcItem for display inside a cycle;
// full detail is fetched via useTcItem(projectId, id) when the eye popup opens.
export interface TestManagementTcItem {
  id: string;
  srNo?: string | null;
  module?: string | null;
  feature?: string | null;
  title: string;
  description?: string | null;
  steps?: string | null;
  expectedResult?: string | null;
}

export interface TestCycleItem {
  id: string;
  projectId: string;
  testCycleId: string;
  testCaseId: string;
  assigneeId?: string | null;
  manualStatus: ManualResultStatus;
  reason?: string | null;
  jiraIssueKeys: string; // JSON string — parse to string[]
  lastUpdatedByUserId?: string | null;
  lastUpdatedAt?: string | null;
  sortOrder: number;
  createdAt: string;
  testCase?: TestManagementTcItem;
  assignee?: ProjectMemberSearchResult | null;
}

export interface AssignmentItem {
  id: string;
  testCycleId: string;
  testCaseId: string;
  manualStatus: ManualResultStatus;
  reason?: string | null;
  jiraIssueKeys: string; // JSON string — parse to string[]
  lastUpdatedAt?: string | null;
  sortOrder: number;
  testCase?: TestManagementTcItem;
  testCycle: Pick<TestCycle, 'id' | 'name' | 'status'>;
}

// One row per manual status change on a TestCycleItem, across the whole
// cycle — powers the per-item execution timeline + "retested" badge on the
// Test Cases tab. See AssignmentHistoryEntry for the resource-scoped variant
// (My Assignments' Daily Run History) — this one is cycle-scoped instead.
export interface TestCycleItemHistoryEntry {
  id: string;
  testCycleItemId: string;
  testCaseId: string;
  assigneeId?: string | null;
  fromStatus: ManualResultStatus;
  toStatus: ManualResultStatus;
  reason?: string | null;
  jiraIssueKeys: string;
  changedByUserId: string;
  changedByName: string;
  changedAt: string;
}

export interface AssignmentHistoryEntry {
  id: string;
  changedAt: string;
  fromStatus: ManualResultStatus;
  toStatus: ManualResultStatus;
  reason?: string | null;
  testCycleItem: {
    testCase?: Pick<TestManagementTcItem, 'id' | 'srNo' | 'module' | 'feature' | 'title'>;
    testCycle: Pick<TestCycle, 'id' | 'name' | 'status'>;
  };
}

export interface JiraIssue {
  id: string;
  projectId: string;
  issueKey: string;
  summary?: string | null;
  status?: string | null;
  statusCategory?: string | null; // "new" | "indeterminate" | "done"
  issueType?: string | null;
  priorityName?: string | null;
  labels: string; // JSON string — parse to string[]
  components: string; // JSON string — parse to string[]
  assigneeName?: string | null;
  reporterName?: string | null;
  jiraCreatedAt?: string | null;
  dueDate?: string | null;
  jiraUpdatedAt?: string | null;
  lastSyncedAt: string;
  syncError?: string | null;
}

export interface JiraResolutionSummary {
  tickets: { resolved: number; total: number };
  testCases: { resolved: number; total: number };
}

export interface JiraBugSummary {
  issueKey: string;
  issue: JiraIssue | null;
  testCases: Array<Pick<TestManagementTcItem, 'id' | 'srNo' | 'title'>>;
}

// Project-wide bug board (Test Cycles list page) — same shape as
// JiraBugSummary, plus every cycle that references this bug (a bug can be
// linked from more than one cycle, e.g. a regression that resurfaces).
export interface JiraBugSummaryWithCycles extends JiraBugSummary {
  testCycles: Array<Pick<TestCycle, 'id' | 'name'>>;
}

export interface JiraConfig {
  jiraProjectKey?: string | null;
  pollIntervalMinutes: number;
  isEnabled: boolean;
  lastPollAt?: string | null;
  lastPollStatus?: string | null;
}

export interface TestCycleSummary {
  cycle: TestCycle;
  counts: Record<ManualResultStatus, number>;
  total: number;
  bugs: { resolved: number; total: number };
}

export interface ResourceSummaryRow {
  assigneeId: string | null;
  userId: string | null;
  assigneeName: string;
  counts: Record<ManualResultStatus, number>;
  total: number;
  passRate: number;
}
