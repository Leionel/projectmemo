-- P3-B 单仓库只读感知：SourceConnection / ExternalSignal。
-- 只新增两张表与索引，不改写既有表。
CREATE TABLE "SourceConnection" (
"id" TEXT NOT NULL PRIMARY KEY,"projectId" TEXT NOT NULL,"ownerUserId" TEXT NOT NULL,"repo" TEXT NOT NULL,"ref" TEXT NOT NULL,"signalKind" TEXT NOT NULL DEFAULT 'COMMITS',"status" TEXT NOT NULL DEFAULT 'ACTIVE',"revokedAt" DATETIME,"revokedReason" TEXT,"etag" TEXT,"cursorSha" TEXT,"lastFetchedAt" DATETIME,"lastStatus" TEXT,"lastError" TEXT,"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" DATETIME NOT NULL,
FOREIGN KEY("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
FOREIGN KEY("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE INDEX "SourceConnection_projectId_status_idx" ON "SourceConnection"("projectId","status");
CREATE UNIQUE INDEX "SourceConnection_projectId_repo_ref_key" ON "SourceConnection"("projectId","repo","ref");
CREATE TABLE "ExternalSignal" (
"id" TEXT NOT NULL PRIMARY KEY,"connectionId" TEXT NOT NULL,"projectId" TEXT NOT NULL,"ownerUserId" TEXT NOT NULL,"sha" TEXT NOT NULL,"kind" TEXT NOT NULL DEFAULT 'COMMITS',"title" TEXT NOT NULL,"authorName" TEXT NOT NULL,"committedAt" DATETIME,"url" TEXT NOT NULL,"status" TEXT NOT NULL DEFAULT 'CANDIDATE',"adoptedByUserId" TEXT,"adoptedAt" DATETIME,"adoptedCaptureId" TEXT,"linkedActionId" TEXT,"fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
FOREIGN KEY("connectionId") REFERENCES "SourceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE,
FOREIGN KEY("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
FOREIGN KEY("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE INDEX "ExternalSignal_projectId_status_committedAt_idx" ON "ExternalSignal"("projectId","status","committedAt");
CREATE UNIQUE INDEX "ExternalSignal_connectionId_sha_key" ON "ExternalSignal"("connectionId","sha");
