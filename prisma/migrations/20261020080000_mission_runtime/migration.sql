-- CreateTable
CREATE TABLE "AgentMission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createRequestId" TEXT NOT NULL,
    "createPayloadHash" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "successCriteriaJson" JSONB NOT NULL,
    "constraintsJson" JSONB NOT NULL,
    "constraintsVersion" INTEGER NOT NULL DEFAULT 1,
    "researchScopeJson" JSONB NOT NULL DEFAULT '{}',
    "researchScopeVersion" INTEGER NOT NULL DEFAULT 1,
    "continuationPolicyJson" JSONB NOT NULL DEFAULT '{"mode":"MANUAL"}',
    "contextVersion" INTEGER NOT NULL DEFAULT 1,
    "waitStateJson" JSONB,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "pauseReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "planRevision" INTEGER NOT NULL DEFAULT 1,
    "planJson" JSONB NOT NULL DEFAULT '{}',
    "contextSchemaVersion" INTEGER NOT NULL DEFAULT 1,
    "budgetJson" JSONB NOT NULL,
    "budgetUsedJson" JSONB NOT NULL DEFAULT '{}',
    "nextEventSeq" INTEGER NOT NULL DEFAULT 0,
    "leaseOwner" TEXT,
    "leaseUntil" DATETIME,
    "leaseEpoch" INTEGER NOT NULL DEFAULT 0,
    "executionSlot" INTEGER,
    "pauseRequestedAt" DATETIME,
    "cancelRequestedAt" DATETIME,
    "lastErrorJson" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "finishedAt" DATETIME,
    CONSTRAINT "AgentMission_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentMission_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentMissionStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "missionId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "planRevision" INTEGER NOT NULL,
    "toolName" TEXT NOT NULL,
    "toolVersion" TEXT NOT NULL DEFAULT '1',
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "canonicalInputJson" JSONB NOT NULL,
    "inputHash" TEXT NOT NULL,
    "readSetJson" JSONB NOT NULL,
    "effectKey" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "resultJson" JSONB,
    "providerCallId" TEXT,
    "protocolJson" JSONB,
    "agentRunId" TEXT,
    "usageJson" JSONB,
    "verificationJson" JSONB,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "AgentMissionStep_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AgentMissionStep_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "AgentMission" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentMissionEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "missionId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "commandRequestId" TEXT,
    "commandPayloadHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentMissionEvent_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "AgentMission" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentMissionApproval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "missionId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "proposalHash" TEXT NOT NULL,
    "proposalJson" JSONB NOT NULL,
    "expectedPlanRevision" INTEGER NOT NULL,
    "readSetJson" JSONB NOT NULL,
    "approverUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" DATETIME NOT NULL,
    "decidedAt" DATETIME,
    "consumedAt" DATETIME,
    CONSTRAINT "AgentMissionApproval_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "AgentMission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentMissionApproval_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "AgentMissionStep" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentMissionOutput" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "missionId" TEXT NOT NULL,
    "stepId" TEXT,
    "revision" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "contentJson" JSONB NOT NULL,
    "sourceRefsJson" JSONB NOT NULL,
    "claimChecksJson" JSONB NOT NULL,
    "verificationStatus" TEXT NOT NULL DEFAULT 'NEEDS_REVIEW',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentMissionOutput_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "AgentMission" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentMission_executionSlot_key" ON "AgentMission"("executionSlot");

-- CreateIndex
CREATE INDEX "AgentMission_ownerUserId_status_idx" ON "AgentMission"("ownerUserId", "status");

-- CreateIndex
CREATE INDEX "AgentMission_status_leaseUntil_idx" ON "AgentMission"("status", "leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "AgentMission_ownerUserId_createRequestId_key" ON "AgentMission"("ownerUserId", "createRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentMissionStep_effectKey_key" ON "AgentMissionStep"("effectKey");

-- CreateIndex
CREATE UNIQUE INDEX "AgentMissionStep_missionId_ordinal_key" ON "AgentMissionStep"("missionId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "AgentMissionEvent_missionId_seq_key" ON "AgentMissionEvent"("missionId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "AgentMissionEvent_missionId_commandRequestId_key" ON "AgentMissionEvent"("missionId", "commandRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentMissionApproval_stepId_key" ON "AgentMissionApproval"("stepId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentMissionOutput_stepId_key" ON "AgentMissionOutput"("stepId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentMissionOutput_missionId_revision_key" ON "AgentMissionOutput"("missionId", "revision");
