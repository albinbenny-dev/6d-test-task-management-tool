-- Timeline "hide from timeline view". Additive: two boolean columns with defaults, no data change.

-- AlterTable
ALTER TABLE "Timeline" ADD COLUMN "hideDone" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TimelineItem" ADD COLUMN "hidden" BOOLEAN NOT NULL DEFAULT false;
