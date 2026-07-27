-- Project.createdBy was a required FK to User with no ON DELETE behavior,
-- so Postgres defaulted to blocking (NO ACTION) — deleting any user who had
-- ever created a project failed with an opaque foreign key violation.
-- Creator is audit metadata, not something a project's existence (or a
-- user's deletability) should depend on.
ALTER TABLE "Project" ALTER COLUMN "createdBy" DROP NOT NULL;

ALTER TABLE "Project" DROP CONSTRAINT "Project_createdBy_fkey";

ALTER TABLE "Project" ADD CONSTRAINT "Project_createdBy_fkey"
  FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
