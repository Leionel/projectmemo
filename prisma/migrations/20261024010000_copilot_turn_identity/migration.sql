-- Preserve legacy shared messages; HTTP callers read only their attributed turns.
ALTER TABLE "AgentMessage" ADD COLUMN "ownerUserId" TEXT;
ALTER TABLE "AgentMessage" ADD COLUMN "requestId" TEXT;
ALTER TABLE "AgentMessage" ADD COLUMN "requestState" TEXT;
CREATE UNIQUE INDEX "AgentMessage_projectId_ownerUserId_requestId_role_key" ON "AgentMessage"("projectId", "ownerUserId", "requestId", "role");
