-- Timeline ⇄ Task Lists live link. Additive: new nullable columns + one unique index.

-- AlterTable
ALTER TABLE "Timeline" ADD COLUMN "taskGranularity" TEXT NOT NULL DEFAULT 'TASKS';
ALTER TABLE "TimelineSwimlane" ADD COLUMN "taskListId" TEXT;
ALTER TABLE "TimelineItem" ADD COLUMN "taskId" TEXT;

-- CreateIndex
CREATE INDEX "TimelineSwimlane_taskListId_idx" ON "TimelineSwimlane"("taskListId");
CREATE UNIQUE INDEX "TimelineItem_timelineId_taskId_key" ON "TimelineItem"("timelineId", "taskId");
