-- Phase 1 reliability: durable capture idempotency, meeting execution claim,
-- and action dependency edit versions. All new fields are nullable/defaulted
-- so existing clients and rows remain readable during incremental rollout.
ALTER TABLE "Capture" ADD COLUMN "requestId" TEXT;
ALTER TABLE "Capture" ADD COLUMN "requestHash" TEXT;
CREATE UNIQUE INDEX "Capture_projectId_requestId_key"
ON "Capture"("projectId", "requestId");

ALTER TABLE "AgentRun" ADD COLUMN "confirmedAt" DATETIME;

ALTER TABLE "ActionItem" ADD COLUMN "dependencyVersion" INTEGER NOT NULL DEFAULT 1;
