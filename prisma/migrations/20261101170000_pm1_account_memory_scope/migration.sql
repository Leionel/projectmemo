-- PM-1 账户个人记忆范围：统一 AgentClaim 增加 ACCOUNT 作用域。
-- SQLite 无法直接把 NOT NULL 列改为可空，按仓库惯例手写重建迁移：
-- 旧行全部回填 scopeType='PROJECT'，保持旧 scopeKey/唯一身份与既有查询兼容。
CREATE TABLE "AgentClaim_new" (
 "id" TEXT NOT NULL PRIMARY KEY, "ownerUserId" TEXT NOT NULL, "projectId" TEXT,
 "scopeType" TEXT NOT NULL DEFAULT 'PROJECT',
 "scopeKey" TEXT NOT NULL, "conversationId" TEXT, "missionId" TEXT,
 "originKey" TEXT NOT NULL, "originJson" JSONB NOT NULL, "kind" TEXT NOT NULL,
 "canonicalStatement" TEXT NOT NULL, "conditionsJson" JSONB NOT NULL,
 "currentRevision" INTEGER NOT NULL DEFAULT 1, "statusProjection" TEXT NOT NULL DEFAULT 'PROPOSED',
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
 CHECK ("scopeType" IN ('PROJECT','ACCOUNT')),
 CHECK ("scopeType" <> 'PROJECT' OR ("projectId" IS NOT NULL)),
 CHECK ("scopeType" <> 'ACCOUNT' OR ("projectId" IS NULL AND "conversationId" IS NULL AND "missionId" IS NULL)),
 FOREIGN KEY("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 FOREIGN KEY("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "AgentClaim_new" ("id","ownerUserId","projectId","scopeType","scopeKey","conversationId","missionId",
 "originKey","originJson","kind","canonicalStatement","conditionsJson","currentRevision","statusProjection","createdAt","updatedAt")
SELECT "id","ownerUserId","projectId",'PROJECT',"scopeKey","conversationId","missionId",
 "originKey","originJson","kind","canonicalStatement","conditionsJson","currentRevision","statusProjection","createdAt","updatedAt"
FROM "AgentClaim";
DROP TABLE "AgentClaim";
ALTER TABLE "AgentClaim_new" RENAME TO "AgentClaim";
CREATE UNIQUE INDEX "AgentClaim_ownerUserId_scopeKey_originKey_key" ON "AgentClaim"("ownerUserId","scopeKey","originKey");
CREATE INDEX "AgentClaim_ownerUserId_projectId_idx" ON "AgentClaim"("ownerUserId","projectId");
CREATE INDEX "AgentClaim_ownerUserId_scopeType_statusProjection_idx" ON "AgentClaim"("ownerUserId","scopeType","statusProjection");

-- 项目成员级个人记忆例外：INHERIT 跟随账户策略；PROJECT_ONLY 本项目不注入；ALLOW 显式允许。
ALTER TABLE "ProjectMembership" ADD COLUMN "personalMemoryMode" TEXT NOT NULL DEFAULT 'INHERIT';
ALTER TABLE "ProjectMembership" ADD COLUMN "personalMemoryModeVersion" INTEGER NOT NULL DEFAULT 0;

-- 账户使用策略：只存开关与版本水位，不存记忆正文。关闭读取不等于删除。
CREATE TABLE "UserMemoryPolicy" (
 "id" TEXT NOT NULL PRIMARY KEY, "ownerUserId" TEXT NOT NULL,
 "useInContextEnabled" BOOLEAN NOT NULL DEFAULT true,
 "explicitCaptureEnabled" BOOLEAN NOT NULL DEFAULT true,
 "candidateInferenceEnabled" BOOLEAN NOT NULL DEFAULT false,
 "cloudProcessingEnabled" BOOLEAN NOT NULL DEFAULT false,
 "settingsVersion" INTEGER NOT NULL DEFAULT 1,
 "privacyRevision" INTEGER NOT NULL DEFAULT 1,
 "extractionNotBefore" DATETIME,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
 FOREIGN KEY("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "UserMemoryPolicy_ownerUserId_key" ON "UserMemoryPolicy"("ownerUserId");

-- 最小账户控制回执：幂等重放与清除状态；不保存被删记忆正文，防止旧请求重放重建条目。
CREATE TABLE "UserMemoryControlReceipt" (
 "id" TEXT NOT NULL PRIMARY KEY, "ownerUserId" TEXT NOT NULL, "requestId" TEXT NOT NULL,
 "operation" TEXT NOT NULL, "targetClaimId" TEXT, "payloadHash" TEXT NOT NULL,
 "resultVersionJson" JSONB NOT NULL, "purgeJson" JSONB NOT NULL,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "UserMemoryControlReceipt_ownerUserId_requestId_key" ON "UserMemoryControlReceipt"("ownerUserId","requestId");
CREATE INDEX "UserMemoryControlReceipt_ownerUserId_createdAt_idx" ON "UserMemoryControlReceipt"("ownerUserId","createdAt");
