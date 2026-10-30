-- CT-8 条件化结果经验：仅新增/改写经验表与步骤失败原因，不改写其他业务表。
-- patternHash 保持稳定方法身份；conditionKey 区分数据集/划分/单位/环境/目标等条件。
-- 旧行 conditionKey 保持 LEGACY，读取时按旧契约降级为“条件未知”，不自动升级 ACTIVE。

-- AlterTable
ALTER TABLE "AgentMissionStep" ADD COLUMN "failureJson" JSONB;

-- CreateTable
CREATE TABLE "AgentExperienceEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "experienceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "requestId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorKind" TEXT NOT NULL DEFAULT 'USER',
    "expectedVersion" INTEGER,
    "resultVersion" INTEGER NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentExperienceEvent_experienceId_fkey" FOREIGN KEY ("experienceId") REFERENCES "AgentExperience" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AgentExperience" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "patternHash" TEXT NOT NULL,
    "conditionKey" TEXT NOT NULL DEFAULT 'LEGACY',
    "title" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "applicabilityJson" JSONB NOT NULL,
    "toolVersionsJson" JSONB NOT NULL DEFAULT '{}',
    "protocolVersionsJson" JSONB NOT NULL DEFAULT '[]',
    "counterExamplesJson" JSONB NOT NULL DEFAULT '[]',
    "evidenceJson" JSONB NOT NULL DEFAULT '{}',
    "eligibilityJson" JSONB NOT NULL DEFAULT '{}',
    "originJson" JSONB NOT NULL DEFAULT '{}',
    "resultLabelsJson" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'CANDIDATE',
    "sampleMissionIdsJson" JSONB NOT NULL DEFAULT '[]',
    "supportCount" INTEGER NOT NULL DEFAULT 0,
    "counterCount" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "evidenceVersion" INTEGER NOT NULL DEFAULT 0,
    "lastSyncedAt" DATETIME,
    "lastSyncFingerprint" TEXT,
    "validUntil" DATETIME,
    "activatedAt" DATETIME,
    "activatedByUserId" TEXT,
    "revokedAt" DATETIME,
    "revokedReason" TEXT,
    "revokedByUserId" TEXT,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentExperience_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentExperience_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AgentExperience" ("activatedAt", "applicabilityJson", "counterCount", "counterExamplesJson", "createdAt", "id", "kind", "ownerUserId", "patternHash", "projectId", "protocolVersionsJson", "revokedAt", "revokedReason", "sampleMissionIdsJson", "schemaVersion", "statement", "status", "supportCount", "title", "toolVersionsJson", "updatedAt")
SELECT "activatedAt", "applicabilityJson", "counterCount", "counterExamplesJson", "createdAt", "id", "kind", "ownerUserId", "patternHash", "projectId", "protocolVersionsJson", "revokedAt", "revokedReason", "sampleMissionIdsJson", "schemaVersion", "statement", "status", "supportCount", "title", "toolVersionsJson", "updatedAt" FROM "AgentExperience";
DROP TABLE "AgentExperience";
ALTER TABLE "new_AgentExperience" RENAME TO "AgentExperience";
CREATE INDEX "AgentExperience_projectId_status_conditionKey_idx" ON "AgentExperience"("projectId", "status", "conditionKey");
CREATE UNIQUE INDEX "AgentExperience_projectId_ownerUserId_kind_patternHash_conditionKey_key" ON "AgentExperience"("projectId", "ownerUserId", "kind", "patternHash", "conditionKey");

CREATE TABLE "new_AgentExperienceUse" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "experienceId" TEXT NOT NULL,
    "missionId" TEXT,
    "conversationId" TEXT,
    "turnId" TEXT,
    "scopeKey" TEXT NOT NULL DEFAULT '',
    "actorKind" TEXT NOT NULL DEFAULT 'MISSION',
    "stage" TEXT NOT NULL,
    "experienceVersion" INTEGER,
    "contentHash" TEXT,
    "conditionKey" TEXT,
    "matchState" TEXT,
    "contextHash" TEXT,
    "outcomeJson" JSONB,
    "injectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentExperienceUse_experienceId_fkey" FOREIGN KEY ("experienceId") REFERENCES "AgentExperience" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentExperienceUse_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "AgentMission" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AgentExperienceUse" ("contextHash", "experienceId", "id", "injectedAt", "missionId", "stage")
SELECT "contextHash", "experienceId", "id", "injectedAt", "missionId", "stage" FROM "AgentExperienceUse";
DROP TABLE "AgentExperienceUse";
ALTER TABLE "new_AgentExperienceUse" RENAME TO "AgentExperienceUse";
UPDATE "AgentExperienceUse" SET "scopeKey" = 'mission:' || "missionId" WHERE "scopeKey" = '' AND "missionId" IS NOT NULL;
CREATE INDEX "AgentExperienceUse_experienceId_injectedAt_idx" ON "AgentExperienceUse"("experienceId", "injectedAt");
CREATE INDEX "AgentExperienceUse_conversationId_turnId_idx" ON "AgentExperienceUse"("conversationId", "turnId");
CREATE INDEX "AgentExperienceUse_missionId_stage_idx" ON "AgentExperienceUse"("missionId", "stage");
CREATE UNIQUE INDEX "AgentExperienceUse_experienceId_scopeKey_stage_key" ON "AgentExperienceUse"("experienceId", "scopeKey", "stage");

CREATE INDEX "AgentExperienceEvent_experienceId_createdAt_idx" ON "AgentExperienceEvent"("experienceId", "createdAt");
CREATE UNIQUE INDEX "AgentExperienceEvent_ownerUserId_requestId_key" ON "AgentExperienceEvent"("ownerUserId", "requestId");
CREATE UNIQUE INDEX "AgentExperienceEvent_experienceId_seq_key" ON "AgentExperienceEvent"("experienceId", "seq");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
