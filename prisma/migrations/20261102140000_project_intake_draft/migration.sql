-- S1-A：项目前材料草稿与受控临时材料身份。
-- Capture/Attachment 都要求 projectId；为了复用它们先建假项目会污染业务事实。
-- 这里只新增两张临时表：owner、内容 hash、草稿身份、期限、处理状态、清理责任齐备，
-- 不进入记忆、目标或工具授权。既有表不做任何改写。
CREATE TABLE "ProjectIntakeDraft" (
"id" TEXT NOT NULL PRIMARY KEY,
"ownerUserId" TEXT NOT NULL,
"createRequestId" TEXT NOT NULL,
"createInputHash" TEXT NOT NULL,
"revision" INTEGER NOT NULL DEFAULT 0,
"status" TEXT NOT NULL DEFAULT 'DRAFT',
"materialsHash" TEXT NOT NULL DEFAULT '',
"understandingJson" JSONB,
"understandingHash" TEXT,
"understandingState" TEXT NOT NULL DEFAULT 'NONE',
"previewJson" JSONB NOT NULL DEFAULT '{}',
"userRevisionJson" JSONB NOT NULL DEFAULT '{}',
"userRevisionHash" TEXT,
"acceptedJson" JSONB,
"processingJson" JSONB NOT NULL DEFAULT '{}',
"confirmRequestJson" JSONB NOT NULL DEFAULT '{}',
"cleanupAttempts" INTEGER NOT NULL DEFAULT 0,
"projectId" TEXT,
"expiresAt" DATETIME NOT NULL,
"understoodAt" DATETIME,
"confirmedAt" DATETIME,
"withdrawnAt" DATETIME,
"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
"updatedAt" DATETIME NOT NULL,
FOREIGN KEY("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE);

CREATE UNIQUE INDEX "ProjectIntakeDraft_ownerUserId_createRequestId_key" ON "ProjectIntakeDraft"("ownerUserId","createRequestId");
CREATE INDEX "ProjectIntakeDraft_ownerUserId_updatedAt_idx" ON "ProjectIntakeDraft"("ownerUserId","updatedAt");
CREATE INDEX "ProjectIntakeDraft_status_expiresAt_idx" ON "ProjectIntakeDraft"("status","expiresAt");

CREATE TABLE "ProjectIntakeMaterial" (
"id" TEXT NOT NULL PRIMARY KEY,
"draftId" TEXT NOT NULL,
"ownerUserId" TEXT NOT NULL,
"kind" TEXT NOT NULL,
"ordinal" INTEGER NOT NULL,
"requestId" TEXT,
"requestHash" TEXT,
"fileName" TEXT,
"mimeType" TEXT,
"type" TEXT,
"size" INTEGER NOT NULL DEFAULT 0,
"storageKey" TEXT,
"sha256" TEXT,
"rawText" TEXT,
"extractionStatus" TEXT NOT NULL DEFAULT 'PENDING',
"extractionError" TEXT,
"revision" INTEGER NOT NULL DEFAULT 1,
"contentHash" TEXT NOT NULL DEFAULT '',
"cleanupState" TEXT NOT NULL DEFAULT 'PENDING',
"cleanedAt" DATETIME,
"syncJson" JSONB NOT NULL DEFAULT '{}',
"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
"updatedAt" DATETIME NOT NULL,
FOREIGN KEY("draftId") REFERENCES "ProjectIntakeDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE);

CREATE UNIQUE INDEX "ProjectIntakeMaterial_draftId_requestId_key" ON "ProjectIntakeMaterial"("draftId","requestId");
CREATE INDEX "ProjectIntakeMaterial_draftId_ordinal_idx" ON "ProjectIntakeMaterial"("draftId","ordinal");
CREATE INDEX "ProjectIntakeMaterial_draftId_cleanupState_idx" ON "ProjectIntakeMaterial"("draftId","cleanupState");
