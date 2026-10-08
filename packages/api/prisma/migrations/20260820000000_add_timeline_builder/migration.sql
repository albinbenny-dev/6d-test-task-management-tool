-- Timeline Builder — per-project Office-Timeline-style plan visuals, with
-- swimlanes, items, and platform-level (SUPER_ADMIN-managed) templates.

-- CreateTable
CREATE TABLE "TimelineTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'General',
    "builtInKey" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "config" TEXT NOT NULL DEFAULT '{}',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimelineTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Timeline" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "templateId" TEXT,
    "styleOverrides" TEXT NOT NULL DEFAULT '{}',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Timeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimelineSwimlane" (
    "id" TEXT NOT NULL,
    "timelineId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "collapsed" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimelineSwimlane_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimelineItem" (
    "id" TEXT NOT NULL,
    "timelineId" TEXT NOT NULL,
    "swimlaneId" TEXT,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'TASK',
    "marker" TEXT NOT NULL DEFAULT 'pill',
    "color" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "percentComplete" INTEGER NOT NULL DEFAULT 0,
    "assignee" TEXT,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimelineItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TimelineTemplate_builtInKey_key" ON "TimelineTemplate"("builtInKey");
CREATE INDEX "Timeline_projectId_idx" ON "Timeline"("projectId");
CREATE INDEX "Timeline_templateId_idx" ON "Timeline"("templateId");
CREATE INDEX "TimelineSwimlane_timelineId_idx" ON "TimelineSwimlane"("timelineId");
CREATE INDEX "TimelineItem_timelineId_idx" ON "TimelineItem"("timelineId");
CREATE INDEX "TimelineItem_swimlaneId_idx" ON "TimelineItem"("swimlaneId");

-- AddForeignKey
ALTER TABLE "Timeline" ADD CONSTRAINT "Timeline_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Timeline" ADD CONSTRAINT "Timeline_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "TimelineTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TimelineSwimlane" ADD CONSTRAINT "TimelineSwimlane_timelineId_fkey" FOREIGN KEY ("timelineId") REFERENCES "Timeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimelineItem" ADD CONSTRAINT "TimelineItem_timelineId_fkey" FOREIGN KEY ("timelineId") REFERENCES "Timeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimelineItem" ADD CONSTRAINT "TimelineItem_swimlaneId_fkey" FOREIGN KEY ("swimlaneId") REFERENCES "TimelineSwimlane"("id") ON DELETE SET NULL ON UPDATE CASCADE;
