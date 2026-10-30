-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SourceConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'GITHUB',
    "environmentKey" TEXT,
    "deploymentConfigJson" JSONB,
    "repo" TEXT,
    "ref" TEXT,
    "signalKind" TEXT NOT NULL DEFAULT 'COMMITS',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "revokedAt" DATETIME,
    "revokedReason" TEXT,
    "etag" TEXT,
    "cursorSha" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "scanHeadSha" TEXT,
    "scanNextPage" INTEGER,
    "scanEtag" TEXT,
    "lastFetchedAt" DATETIME,
    "lastStatus" TEXT,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SourceConnection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SourceConnection_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SourceConnection" ("createdAt", "cursorSha", "etag", "id", "lastError", "lastFetchedAt", "lastStatus", "ownerUserId", "projectId", "ref", "repo", "revision", "revokedAt", "revokedReason", "scanEtag", "scanHeadSha", "scanNextPage", "signalKind", "status", "updatedAt") SELECT "createdAt", "cursorSha", "etag", "id", "lastError", "lastFetchedAt", "lastStatus", "ownerUserId", "projectId", "ref", "repo", "revision", "revokedAt", "revokedReason", "scanEtag", "scanHeadSha", "scanNextPage", "signalKind", "status", "updatedAt" FROM "SourceConnection";
DROP TABLE "SourceConnection";
ALTER TABLE "new_SourceConnection" RENAME TO "SourceConnection";
CREATE INDEX "SourceConnection_projectId_status_idx" ON "SourceConnection"("projectId", "status");
CREATE UNIQUE INDEX "SourceConnection_projectId_repo_ref_key" ON "SourceConnection"("projectId", "repo", "ref");
CREATE UNIQUE INDEX "SourceConnection_projectId_provider_environmentKey_key" ON "SourceConnection"("projectId", "provider", "environmentKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
