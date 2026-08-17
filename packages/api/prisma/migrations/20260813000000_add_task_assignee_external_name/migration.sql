-- AlterTable: allow a Task to be assigned to someone outside the tool via
-- free text, mutually exclusive with the existing ProjectMember assigneeId.
ALTER TABLE "Task" ADD COLUMN "assigneeExternalName" TEXT;
