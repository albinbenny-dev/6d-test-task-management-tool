-- Actual start / end dates on tasks, mirrored onto timeline items, plus the per-timeline date view.
-- Additive columns only. (The app applies the schema with `prisma db push`; the backfill below also runs from code at
-- API start-up — see backfillTaskActuals() in src/lib/taskActuals.ts — so existing tasks are filled either way.)

-- AlterTable
ALTER TABLE "Task" ADD COLUMN "actualStartDate" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN "actualEndDate" TIMESTAMP(3);
ALTER TABLE "Timeline" ADD COLUMN "dateView" TEXT NOT NULL DEFAULT 'BASELINE';
ALTER TABLE "TimelineItem" ADD COLUMN "actualStartDate" TIMESTAMP(3);
ALTER TABLE "TimelineItem" ADD COLUMN "actualEndDate" TIMESTAMP(3);

-- Backfill for tasks that predate actual dates (guarded, so it is safe to run on every start-up and only ever touches legacy rows):
-- started work gets its planned start as the actual start; Done tasks get their planned end (else the completion day) as the actual end.
UPDATE "Task" SET "actualStartDate" = date_trunc('day', "startDate")
  WHERE "status" IN ('IN_PROGRESS', 'IN_REVIEW', 'DONE') AND "startDate" IS NOT NULL AND "actualStartDate" IS NULL;
UPDATE "Task" SET "actualEndDate" = date_trunc('day', COALESCE("dueDate", "completedAt"))
  WHERE "status" = 'DONE' AND "actualEndDate" IS NULL AND COALESCE("dueDate", "completedAt") IS NOT NULL;
-- A Done task with no start gets its end as the start (one-day task); never let start run past end.
UPDATE "Task" SET "actualStartDate" = "actualEndDate"
  WHERE "status" = 'DONE' AND "actualEndDate" IS NOT NULL AND ("actualStartDate" IS NULL OR "actualStartDate" > "actualEndDate");

-- Parents derive from their subtasks: earliest actual start; actual end = latest end once every subtask is Done.
UPDATE "Task" p SET
  "actualStartDate" = (SELECT MIN(c."actualStartDate") FROM "Task" c WHERE c."parentTaskId" = p."id"),
  "actualEndDate" = CASE
    WHEN NOT EXISTS (SELECT 1 FROM "Task" c WHERE c."parentTaskId" = p."id" AND (c."status" <> 'DONE' OR c."actualEndDate" IS NULL))
    THEN (SELECT MAX(c."actualEndDate") FROM "Task" c WHERE c."parentTaskId" = p."id")
    ELSE NULL END
  WHERE EXISTS (SELECT 1 FROM "Task" c WHERE c."parentTaskId" = p."id");
