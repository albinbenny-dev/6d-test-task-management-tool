-- Payment Milestones — CRM import. Additive columns only; still no amounts or invoice values.
-- (The app applies the schema with `prisma db push`; this file documents the change for `migrate deploy` setups.)

-- AlterTable
ALTER TABLE "Milestone" ADD COLUMN "evidenceDate" TIMESTAMP(3);
ALTER TABLE "Milestone" ADD COLUMN "poNumber" TEXT;
ALTER TABLE "Milestone" ADD COLUMN "poName" TEXT;
ALTER TABLE "Milestone" ADD COLUMN "crmRecordId" TEXT;
ALTER TABLE "Milestone" ADD COLUMN "crmComments" TEXT;
ALTER TABLE "Milestone" ADD COLUMN "lastImportedAt" TIMESTAMP(3);

-- CreateIndex (NULLs are distinct in Postgres, so hand-created milestones with no CRM id never collide)
CREATE UNIQUE INDEX "Milestone_projectId_crmRecordId_key" ON "Milestone"("projectId", "crmRecordId");
