# 6D Test & Task Management Tool — working notes for Claude

pnpm monorepo: `packages/api` (Express + Prisma + Postgres, BullMQ/Redis) and `packages/frontend` (React + Vite, react-query). Deployed with Docker (`docker-compose.yml`, `nginx/`). Repo: `albinbenny-dev/6d-test-task-management-tool`, work on `main`.

## GitHub and syncing
- Remote `origin` = https://github.com/albinbenny-dev/6d-test-task-management-tool.git (HTTPS), single branch `main`; git user name `albin`. GitHub is the source of truth — the folder is also synced through SharePoint (Windows ⇄ macOS), which is only a convenience copy.
- GitHub account: **`albinbenny-dev`** (owner of the repo; HTTPS, no SSH key). Commit identity: `user.name = albin`, `user.email = albin.benny@6dtech.co.in` — set these on a new machine with `git config --global user.name "albin"` and `git config --global user.email "albin.benny@6dtech.co.in"` so commits stay attributed to the same person.
- Credentials never live in this repo or in this file. On a new machine the user signs in once: `gh auth login` (GitHub.com → HTTPS → "Login with a web browser" as `albinbenny-dev`; the token needs the `repo`, `workflow`, `read:org` and `gist` scopes), then `gh auth setup-git` so plain `git push` uses it. Check with `gh auth status`. If push fails with an authentication error, ask the user to run that sign-in — don't try to work around it.
- Start every session with `git fetch && git status -sb` (and `git pull --ff-only` if behind) so work done on the other machine is picked up before editing.
- Commit and push finished work to `origin/main` once the user says yes; end the session with a push so the other machine can pull it. Use `gh` for GitHub tasks (log in on the Mac with `gh auth login` if it isn't authenticated).
- Don't run git on both machines at the same time: SharePoint syncs `.git` too and can leave a stale `.git/index.lock`; if git reports a lock and no git process is running, delete the lock file. If `git status` shows lots of unchanged files as modified after the move, it's line endings — run `git config core.autocrlf false`.
- Never commit `.env`, `node_modules`, or the user's personal untracked files (`.claude/`, `packages/frontend/vite.config-STS-1365.ts`).
- On macOS, `node_modules` from Windows can't be reused: `rm -rf node_modules packages/*/node_modules && pnpm install`.

## Run it locally
- `pnpm install`, then `pnpm dev` (API + UI). The API needs `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `SMTP_*`, and `SEED_ADMIN_EMAIL/PASSWORD/NAME` (the root `.env` is gitignored — copy it over from the old machine, never commit it).
- Schema is applied with `prisma db push` (no migration history to rely on). `prisma/seed.ts` creates the first SUPER_ADMIN.
- Frontend type-check: `pnpm --filter @qaasr/frontend type-check`. A handful of old, unrelated TS errors exist (ChatWidget, RunHistoryTable, ScriptResultsTable…) — only worry about files you touched.
- `deploy*.ps1`, `make-*-package.ps1` are Windows PowerShell scripts.

## How we test (what worked well)
- Never touch the user's real containers (`ttmt-*`, `qa-*`) or their DB. Spin up throwaway Postgres + Redis (`tmp-ms-pg` on 5499, `tmp-ms-redis` on 6399), run the API against them with `npx tsx src/index.ts` (PORT 4000) and the UI with `pnpm dev`/`vite`, seed an admin, tear everything down afterwards.
- Browser login shortcut: POST `/api/auth/login`, store the token in `localStorage` keys `qai-token` and `qai-user`.
- Useful real test data: the Zain plan (`Zain_SD_CVM-ProjectPlan-V1.5_N.xlsx`, 318 rows, 7 lanes) imported via the timeline Import.
- The in-app browser pane may be hidden: `requestAnimationFrame`/IntersectionObserver/blur events don't fire, so measure with `setTimeout`/MessageChannel gaps and force layout with `getBoundingClientRect`. Use `resize_window` to give it a real size.

## Working style the user likes
- Ask/propose first for UI work; show mockups before redesigns. Wait for an explicit "yes / commit and push" before committing or pushing.
- Commit messages end with the `Co-Authored-By` line given in the session reminder.
- Some source files use CRLF — preserve line endings when patching (the patch scripts did `replace(/\r\n/g,'\n')` then restored).
- Prefer the Edit/Write tools over long shell heredocs (quote-heavy heredocs broke repeatedly).

## Timelines feature map (`packages/frontend/src/{pages/TimelineBuilder.tsx,components/timeline,lib/timeline}`, API `routes/timelines.ts`)
- Views: Data (table), Split, **Gantt** (MS-Project style, read-only: pinned columns, divider, zoom, today line), Timeline (slides, export to PPT). Panes stay mounted and freeze work while hidden (`useFrozen`).
- Layout engine `lib/timeline/layout.ts` (templates in `api/src/lib/timelineTemplateConfig.ts`, built-ins upgraded by `ensureBuiltInTemplates`). Per-timeline `styleOverrides` sit on top of the template.
- Dates switch: Baseline / Actual / Both (`lib/timeline/dateView.ts`). Import reads Excel/CSV and MS Project xlsx exports. 
- Table: swimlanes can be dragged (grip handle), rows dragged singly or as a ticked group, plus a "Move to swimlane…" menu; lanes linked to a Task List ("Live") are read-only for rows.
- Convert to Tasks: `POST /:timelineId/convert-to-tasks` + `ConvertToTasksDialog` (lists per lane or parent task + subtasks, dry-run preview, optional replace with a live lane).
- Milestones module: CRM PO-report import with reminder emails (`routes/milestones.ts`).

## Performance lessons (large plans)
Native `<input type="date">` costs ~0.3 ms each — use the lazy `DateCell`. Table rows are `memo`'d with stable handlers; rows mount in batches; thumbnails use deferred values; `content-visibility: auto` on rows.

## Open items / ideas
- Unresolved report: after "Create task lists", clicking **Open task lists** once seemed to hang ~1 minute. Could not reproduce (navigation took ~150 ms); needs the browser Network/Performance trace from the user's environment.
- Gantt is read-only — next steps could be dragging bars, assignee labels beside bars, saving the Gantt as image/PDF.
- Grouping swimlanes into named groups (parent bands) was discussed but not built.
