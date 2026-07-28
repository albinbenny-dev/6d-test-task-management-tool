-- CreateTable
CREATE TABLE "WikiPage" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "parentPageId" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "tags" TEXT NOT NULL DEFAULT '[]',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WikiPage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WikiPage_projectId_idx" ON "WikiPage"("projectId");

-- CreateIndex
CREATE INDEX "WikiPage_parentPageId_idx" ON "WikiPage"("parentPageId");

-- CreateIndex
CREATE INDEX "WikiPage_projectId_sortOrder_idx" ON "WikiPage"("projectId", "sortOrder");

-- AddForeignKey
ALTER TABLE "WikiPage" ADD CONSTRAINT "WikiPage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WikiPage" ADD CONSTRAINT "WikiPage_parentPageId_fkey" FOREIGN KEY ("parentPageId") REFERENCES "WikiPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WikiPage" ADD CONSTRAINT "WikiPage_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "ProjectMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WikiPage" ADD CONSTRAINT "WikiPage_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "ProjectMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

