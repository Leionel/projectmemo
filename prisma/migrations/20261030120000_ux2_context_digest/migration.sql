CREATE TABLE "AgentContextDigest" (
 "id" TEXT NOT NULL PRIMARY KEY, "ownerUserId" TEXT NOT NULL, "projectId" TEXT NOT NULL,
 "missionId" TEXT, "conversationId" TEXT, "scopeKey" TEXT NOT NULL, "inputHash" TEXT NOT NULL,
 "originJson" JSONB NOT NULL, "sourceManifestJson" JSONB NOT NULL, "claimHeadsJson" JSONB NOT NULL,
 "intentHash" TEXT NOT NULL, "reusePolicyHash" TEXT NOT NULL, "compilerSpecVersion" TEXT NOT NULL,
 "budgetRootJson" JSONB NOT NULL, "provider" TEXT, "summaryJson" JSONB NOT NULL,
 "statusProjection" TEXT NOT NULL DEFAULT 'CURRENT', "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 FOREIGN KEY("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AgentContextDigest_ownerUserId_scopeKey_inputHash_key" ON "AgentContextDigest"("ownerUserId","scopeKey","inputHash");
CREATE INDEX "AgentContextDigest_ownerUserId_projectId_createdAt_idx" ON "AgentContextDigest"("ownerUserId","projectId","createdAt");
