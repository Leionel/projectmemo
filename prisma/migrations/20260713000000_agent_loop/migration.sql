-- ProjectMemo proactive Agent loop
CREATE TABLE "AgentIntervention" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "severity" INTEGER NOT NULL DEFAULT 3,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "proposedActions" JSONB NOT NULL,
    "isSimulated" BOOLEAN NOT NULL DEFAULT false,
    "snoozedUntil" DATETIME,
    "dismissReason" TEXT,
    "handledAt" DATETIME,
    "evidenceCardId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentIntervention_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentIntervention_evidenceCardId_fkey" FOREIGN KEY ("evidenceCardId") REFERENCES "KnowledgeCard" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "ActionItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "sourceInterventionId" TEXT,
    "sourceCardId" TEXT,
    "resultCardId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 3,
    "status" TEXT NOT NULL DEFAULT 'TODO',
    "dueAt" DATETIME,
    "resultText" TEXT,
    "isSimulated" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ActionItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ActionItem_sourceInterventionId_fkey" FOREIGN KEY ("sourceInterventionId") REFERENCES "AgentIntervention" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ActionItem_sourceCardId_fkey" FOREIGN KEY ("sourceCardId") REFERENCES "KnowledgeCard" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ActionItem_resultCardId_fkey" FOREIGN KEY ("resultCardId") REFERENCES "KnowledgeCard" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "runType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "trace" JSONB NOT NULL,
    "fallbackReason" TEXT,
    "durationMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "AgentMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "citations" JSONB NOT NULL,
    "proposedActions" JSONB NOT NULL,
    "runId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentMessage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentMessage_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AgentIntervention_projectId_dedupeKey_key" ON "AgentIntervention"("projectId", "dedupeKey");
CREATE INDEX "AgentIntervention_projectId_status_idx" ON "AgentIntervention"("projectId", "status");
CREATE INDEX "AgentIntervention_projectId_createdAt_idx" ON "AgentIntervention"("projectId", "createdAt");
CREATE UNIQUE INDEX "ActionItem_resultCardId_key" ON "ActionItem"("resultCardId");
CREATE INDEX "ActionItem_projectId_status_idx" ON "ActionItem"("projectId", "status");
CREATE INDEX "ActionItem_projectId_createdAt_idx" ON "ActionItem"("projectId", "createdAt");
CREATE INDEX "ActionItem_sourceInterventionId_idx" ON "ActionItem"("sourceInterventionId");
CREATE INDEX "AgentRun_projectId_createdAt_idx" ON "AgentRun"("projectId", "createdAt");
CREATE INDEX "AgentRun_projectId_runType_idx" ON "AgentRun"("projectId", "runType");
CREATE INDEX "AgentMessage_projectId_createdAt_idx" ON "AgentMessage"("projectId", "createdAt");
