CREATE TABLE "AgentClaim" (
 "id" TEXT NOT NULL PRIMARY KEY, "ownerUserId" TEXT NOT NULL, "projectId" TEXT NOT NULL,
 "scopeKey" TEXT NOT NULL, "conversationId" TEXT, "missionId" TEXT, "originKey" TEXT NOT NULL,
 "originJson" JSONB NOT NULL, "kind" TEXT NOT NULL, "canonicalStatement" TEXT NOT NULL,
 "conditionsJson" JSONB NOT NULL, "currentRevision" INTEGER NOT NULL DEFAULT 1,
 "statusProjection" TEXT NOT NULL DEFAULT 'PROPOSED', "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" DATETIME NOT NULL,
 FOREIGN KEY("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 FOREIGN KEY("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AgentClaim_ownerUserId_scopeKey_originKey_key" ON "AgentClaim"("ownerUserId","scopeKey","originKey");
CREATE INDEX "AgentClaim_ownerUserId_projectId_idx" ON "AgentClaim"("ownerUserId","projectId");
CREATE TABLE "AgentClaimEvent" (
 "id" TEXT NOT NULL PRIMARY KEY, "claimId" TEXT NOT NULL, "ownerUserId" TEXT NOT NULL,
 "revision" INTEGER NOT NULL, "requestId" TEXT NOT NULL, "payloadHash" TEXT NOT NULL,
 "eventKind" TEXT NOT NULL, "actorKind" TEXT NOT NULL, "userQuote" TEXT, "modelInterpretation" TEXT,
 "targetHash" TEXT NOT NULL, "evidenceManifestJson" JSONB NOT NULL, "assessmentJson" JSONB NOT NULL,
 "validFrom" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "validUntil" DATETIME, "controlSeq" INTEGER,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("claimId") REFERENCES "AgentClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AgentClaimEvent_claimId_revision_key" ON "AgentClaimEvent"("claimId","revision");
CREATE UNIQUE INDEX "AgentClaimEvent_ownerUserId_requestId_key" ON "AgentClaimEvent"("ownerUserId","requestId");
CREATE INDEX "AgentClaimEvent_ownerUserId_controlSeq_idx" ON "AgentClaimEvent"("ownerUserId","controlSeq");
