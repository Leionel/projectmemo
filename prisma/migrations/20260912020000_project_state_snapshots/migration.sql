-- R2/S1: versioned project state snapshots + read cursors.
-- Additive; governed by PROJECT_STATE_ENABLED (default off). History is
-- never deleted when the flag is turned off later.
CREATE TABLE "ProjectStateSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "evaluationKey" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "observedAt" DATETIME NOT NULL,
    "evaluatedAt" DATETIME NOT NULL,
    "previousSnapshotId" TEXT,
    "payload" JSONB NOT NULL,
    CONSTRAINT "ProjectStateSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProjectStateSnapshot_projectId_sourceHash_policyVersion_evaluationKey_key"
ON "ProjectStateSnapshot"("projectId", "sourceHash", "policyVersion", "evaluationKey");
CREATE INDEX "ProjectStateSnapshot_projectId_evaluatedAt_idx" ON "ProjectStateSnapshot"("projectId", "evaluatedAt");

CREATE TABLE "ProjectStateCursor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "consumerKey" TEXT NOT NULL,
    "lastSeenSnapshotId" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectStateCursor_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProjectStateCursor_projectId_consumerKey_key" ON "ProjectStateCursor"("projectId", "consumerKey");
