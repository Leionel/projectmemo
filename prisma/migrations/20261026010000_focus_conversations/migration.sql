-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT NOT NULL,
    "createRequestId" TEXT NOT NULL,
    "createInputHash" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "homeProjectId" TEXT,
    "title" TEXT NOT NULL DEFAULT '新讨论',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "nextSeq" INTEGER NOT NULL DEFAULT 0,
    "activeTurnId" TEXT,
    "focusJson" JSONB NOT NULL DEFAULT '{}',
    "pinnedStateJson" JSONB NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Conversation_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConversationTurn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "inputJson" JSONB NOT NULL,
    "baseVersion" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACCEPTED',
    "callCount" INTEGER NOT NULL DEFAULT 0,
    "reservationJson" JSONB NOT NULL DEFAULT '[]',
    "readManifestJson" JSONB NOT NULL DEFAULT '{}',
    "usageJson" JSONB NOT NULL DEFAULT '[]',
    "errorJson" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "ConversationTurn_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConversationBinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "revisionKey" TEXT NOT NULL,
    "valueJson" JSONB NOT NULL,
    CONSTRAINT "ConversationBinding_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConversationProject" (
    "conversationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,

    PRIMARY KEY ("conversationId", "projectId"),
    CONSTRAINT "ConversationProject_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConversationAnchor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "originKind" TEXT NOT NULL,
    "originId" TEXT NOT NULL,
    "topicKey" TEXT NOT NULL DEFAULT 'DISCUSS',
    "originRevision" TEXT NOT NULL,
    CONSTRAINT "ConversationAnchor_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FocusProjectPreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "importance" INTEGER,
    "longTermGoal" TEXT NOT NULL DEFAULT '',
    "estimatedMinutes" INTEGER,
    "notes" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "FocusProjectPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AgentRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT,
    "conversationId" TEXT,
    "turnId" TEXT,
    "runType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalRequestId" TEXT,
    "trace" JSONB NOT NULL,
    "resultJson" JSONB,
    "fallbackReason" TEXT,
    "durationMs" INTEGER,
    "confirmedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentRun_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AgentRun" ("confirmedAt", "createdAt", "durationMs", "externalRequestId", "fallbackReason", "id", "projectId", "provider", "resultJson", "runType", "status", "trace") SELECT "confirmedAt", "createdAt", "durationMs", "externalRequestId", "fallbackReason", "id", "projectId", "provider", "resultJson", "runType", "status", "trace" FROM "AgentRun";
DROP TABLE "AgentRun";
ALTER TABLE "new_AgentRun" RENAME TO "AgentRun";
CREATE INDEX "AgentRun_projectId_createdAt_idx" ON "AgentRun"("projectId", "createdAt");
CREATE INDEX "AgentRun_projectId_runType_idx" ON "AgentRun"("projectId", "runType");
CREATE UNIQUE INDEX "AgentRun_provider_externalRequestId_key" ON "AgentRun"("provider", "externalRequestId");
CREATE TABLE "new_AgentMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT,
    "conversationId" TEXT,
    "turnId" TEXT,
    "seq" INTEGER,
    "blocksJson" JSONB,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "citations" JSONB NOT NULL,
    "proposedActions" JSONB NOT NULL,
    "runId" TEXT,
    "ownerUserId" TEXT,
    "requestId" TEXT,
    "requestState" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentMessage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentMessage_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AgentMessage" ("citations", "content", "createdAt", "id", "ownerUserId", "projectId", "proposedActions", "requestId", "requestState", "role", "runId") SELECT "citations", "content", "createdAt", "id", "ownerUserId", "projectId", "proposedActions", "requestId", "requestState", "role", "runId" FROM "AgentMessage";
DROP TABLE "AgentMessage";
ALTER TABLE "new_AgentMessage" RENAME TO "AgentMessage";
CREATE INDEX "AgentMessage_projectId_createdAt_idx" ON "AgentMessage"("projectId", "createdAt");
CREATE UNIQUE INDEX "AgentMessage_projectId_ownerUserId_requestId_role_key" ON "AgentMessage"("projectId", "ownerUserId", "requestId", "role");
CREATE UNIQUE INDEX "AgentMessage_conversationId_seq_key" ON "AgentMessage"("conversationId", "seq");
CREATE UNIQUE INDEX "AgentMessage_turnId_role_key" ON "AgentMessage"("turnId", "role");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Conversation_ownerUserId_updatedAt_idx" ON "Conversation"("ownerUserId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_ownerUserId_createRequestId_key" ON "Conversation"("ownerUserId", "createRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationTurn_conversationId_requestId_key" ON "ConversationTurn"("conversationId", "requestId");

-- CreateIndex
CREATE INDEX "ConversationBinding_conversationId_projectId_idx" ON "ConversationBinding"("conversationId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationBinding_conversationId_kind_entityId_revisionKey_key" ON "ConversationBinding"("conversationId", "kind", "entityId", "revisionKey");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationAnchor_ownerUserId_originKind_originId_topicKey_key" ON "ConversationAnchor"("ownerUserId", "originKind", "originId", "topicKey");

-- CreateIndex
CREATE UNIQUE INDEX "FocusProjectPreference_userId_projectId_key" ON "FocusProjectPreference"("userId", "projectId");
