-- Project Defects dashboard: project-wide label/JQL discovery config on
-- JiraConfig (additive to, not a replacement for, per-cycle TestCycle.jiraLabels/jiraJql),
-- and a Jira "Severity" custom-field cache on JiraIssue (distinct from priorityName).
ALTER TABLE "JiraConfig" ADD COLUMN "labels" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "JiraConfig" ADD COLUMN "jql" TEXT;
ALTER TABLE "JiraConfig" ADD COLUMN "jqlDiscoveredKeys" TEXT NOT NULL DEFAULT '[]';

ALTER TABLE "JiraIssue" ADD COLUMN "severityName" TEXT;
