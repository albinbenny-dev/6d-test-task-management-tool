-- Planned completion date for a test cycle — surfaced (color-coded) on its
-- items in My Work, since individual TestCycleItems have no due date of their own.
ALTER TABLE "TestCycle" ADD COLUMN "dueDate" TIMESTAMP(3);
