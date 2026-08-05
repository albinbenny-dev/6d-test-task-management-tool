-- Track edits on task comments so the UI can show an "(edited)" marker.
ALTER TABLE "TaskComment" ADD COLUMN "editedAt" TIMESTAMP(3);
