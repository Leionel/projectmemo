ALTER TABLE "AgentMission" ADD COLUMN "nextAttemptAt" DATETIME;
CREATE INDEX "AgentMission_status_nextAttemptAt_idx" ON "AgentMission"("status","nextAttemptAt");
CREATE TABLE "ExternalSource" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "missionId" TEXT NOT NULL,
 "requestedUrl" TEXT NOT NULL,
 "resolvedUrl" TEXT,
 "retrievalMode" TEXT NOT NULL,
 "title" TEXT NOT NULL,
 "publisher" TEXT,
 "publishedAt" DATETIME,
 "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "normalizedContentHash" TEXT NOT NULL,
 "excerptJson" JSONB NOT NULL,
 "availability" TEXT NOT NULL DEFAULT 'AVAILABLE',
 "trustLabel" TEXT NOT NULL DEFAULT 'EXTERNAL_UNVERIFIED',
 CONSTRAINT "ExternalSource_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "AgentMission"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ExternalSource_missionId_requestedUrl_retrievalMode_normalizedContentHash_key" ON "ExternalSource"("missionId","requestedUrl","retrievalMode","normalizedContentHash");
CREATE INDEX "ExternalSource_missionId_fetchedAt_idx" ON "ExternalSource"("missionId","fetchedAt");
