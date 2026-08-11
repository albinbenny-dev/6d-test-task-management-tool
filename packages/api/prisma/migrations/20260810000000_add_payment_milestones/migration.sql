-- Payment Milestones — per-project delivery/invoicing milestone tracker.
-- Stores only the milestone, its dates, and whether payment is contractually
-- tied to it — no amounts/invoices are ever stored here.

-- CreateTable
CREATE TABLE "Milestone" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "groupName" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "baselineDate" TIMESTAMP(3),
    "targetDate" TIMESTAMP(3),
    "actualDate" TIMESTAMP(3),
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "isPaymentLinked" BOOLEAN NOT NULL DEFAULT false,
    "invoiceRaised" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Milestone_projectId_idx" ON "Milestone"("projectId");

-- CreateIndex
CREATE INDEX "Milestone_projectId_isPaymentLinked_idx" ON "Milestone"("projectId", "isPaymentLinked");

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
