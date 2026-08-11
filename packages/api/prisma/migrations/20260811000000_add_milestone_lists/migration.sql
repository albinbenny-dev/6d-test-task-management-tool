-- Introduces MilestoneList as the named container for Milestone rows
-- (mirrors TaskList/Task) — a project can now have several distinct
-- milestone lists side by side (e.g. "Project Milestones", "CR Milestones",
-- "MS Milestones"). The prior flat Milestone.groupName label is replaced by
-- a real milestoneListId FK. ADD COLUMN ... NOT NULL with no default only
-- succeeds while the table has zero rows (true today); if that's no longer
-- the case, this migration will fail loudly rather than silently orphaning
-- existing rows — see the note in the PR/commit that introduced this file.

-- CreateTable
CREATE TABLE "MilestoneList" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#2563AB',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MilestoneList_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MilestoneList_projectId_name_key" ON "MilestoneList"("projectId", "name");

-- CreateIndex
CREATE INDEX "MilestoneList_projectId_idx" ON "MilestoneList"("projectId");

-- AddForeignKey
ALTER TABLE "MilestoneList" ADD CONSTRAINT "MilestoneList_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: replace groupName with a required milestoneListId FK
ALTER TABLE "Milestone" DROP COLUMN "groupName";
ALTER TABLE "Milestone" ADD COLUMN "milestoneListId" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_milestoneListId_fkey" FOREIGN KEY ("milestoneListId") REFERENCES "MilestoneList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Milestone_milestoneListId_idx" ON "Milestone"("milestoneListId");
