import cron from 'node-cron';
import { prisma } from '../lib/prisma.js';
import { isJiraConfigured, syncIssuesForProject } from '../services/jiraService.js';

// ── Jira poll worker ─────────────────────────────────────────────────────────
// Fixed static cron (mirrors jobs/retentionWorker.ts), not the DB-backed
// dynamic registry in lib/scheduler.ts — a single global cadence is simplest
// for a first cut. Each tick, every project with JiraConfig.isEnabled gets its
// linked issue keys refreshed. Each project's sync is wrapped in its own
// try/catch so one broken project doesn't stop the others' polls this tick.
//
// "Near-real-time" is polling, not a push webhook — a webhook needs a
// publicly reachable API URL, which isn't set up here. UI copy should say
// "refreshes automatically every N minutes," never "real-time."

const POLL_CRON = '*/5 * * * *'; // every 5 minutes

async function pollAllProjects(): Promise<void> {
  if (!isJiraConfigured()) return; // no JIRA_HOST/JIRA_EMAIL/JIRA_API_TOKEN set — nothing to do

  const configs = await prisma.jiraConfig.findMany({ where: { isEnabled: true } });
  if (configs.length === 0) return;

  console.log(`[jira-poll] Syncing ${configs.length} project(s)`);
  for (const config of configs) {
    try {
      const result = await syncIssuesForProject(config.projectId);
      if (result.error) {
        console.error(`[jira-poll] project ${config.projectId}: ${result.error}`);
      }
    } catch (err) {
      // A single project's Jira instance being down/misconfigured must not
      // stop the rest of this tick's projects from syncing.
      console.error(`[jira-poll] project ${config.projectId} threw:`, err);
    }
  }
}

export function startJiraPollSchedule(): void {
  cron.schedule(POLL_CRON, () => { void pollAllProjects(); });
  console.log(`[jira-poll] Jira issue poll scheduled (${POLL_CRON})`);
}
