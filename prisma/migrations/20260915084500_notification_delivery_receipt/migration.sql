-- Phase 2 B3: persist system-notification publication receipts separately from exposure/feedback.
CREATE TABLE "InterventionDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "interventionId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "deliveryKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "attemptedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InterventionDelivery_interventionId_fkey" FOREIGN KEY ("interventionId") REFERENCES "AgentIntervention" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "InterventionDelivery_interventionId_channel_deliveryKey_key" ON "InterventionDelivery"("interventionId", "channel", "deliveryKey");
CREATE INDEX "InterventionDelivery_projectId_attemptedAt_idx" ON "InterventionDelivery"("projectId", "attemptedAt");
