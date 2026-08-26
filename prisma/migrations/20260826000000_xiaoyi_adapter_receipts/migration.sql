-- Add an idempotent external-call receipt to AgentRun. Existing runs keep NULL
-- external request IDs and are unaffected by the composite unique index.
ALTER TABLE "AgentRun" ADD COLUMN "externalRequestId" TEXT;
ALTER TABLE "AgentRun" ADD COLUMN "resultJson" JSONB;

CREATE UNIQUE INDEX "AgentRun_provider_externalRequestId_key"
ON "AgentRun"("provider", "externalRequestId");
