CREATE TABLE "CopilotToolExecution" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sourceRunId" TEXT NOT NULL,
  "proposalKey" TEXT NOT NULL,
  "tool" TEXT NOT NULL,
  "proposalJson" JSONB NOT NULL,
  "proposalHash" TEXT NOT NULL,
  "sourceManifestHash" TEXT NOT NULL,
  "confirmationHash" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "leaseToken" TEXT,
  "leaseUntil" DATETIME,
  "resultId" TEXT,
  "committedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "CopilotToolExecution_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "AgentRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CopilotToolExecution_sourceRunId_proposalKey_key" ON "CopilotToolExecution"("sourceRunId", "proposalKey");
CREATE INDEX "CopilotToolExecution_status_leaseUntil_idx" ON "CopilotToolExecution"("status", "leaseUntil");
