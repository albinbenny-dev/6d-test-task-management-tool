-- Add free-text labels (e.g. release tags) to TC Library items, for filtering.
ALTER TABLE "TcItem" ADD COLUMN "labels" TEXT NOT NULL DEFAULT '[]';
