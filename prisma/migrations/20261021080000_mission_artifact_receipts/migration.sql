CREATE TABLE "MissionArtifactReceipt" (
 "id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT NOT NULL, "missionId" TEXT NOT NULL,
 "outputId" TEXT NOT NULL, "outputRevision" INTEGER NOT NULL, "outputHash" TEXT NOT NULL,
 "artifactId" TEXT NOT NULL, "artifactType" TEXT NOT NULL, "sourceManifestJson" JSONB NOT NULL,
 "blockMapJson" JSONB NOT NULL, "verificationSnapshotJson" JSONB NOT NULL,
 "createdByUserId" TEXT NOT NULL, "requestId" TEXT NOT NULL, "payloadHash" TEXT NOT NULL,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 FOREIGN KEY ("missionId") REFERENCES "AgentMission"("id") ON DELETE NO ACTION ON UPDATE CASCADE,
 FOREIGN KEY ("outputId") REFERENCES "AgentMissionOutput"("id") ON DELETE NO ACTION ON UPDATE CASCADE,
 FOREIGN KEY ("artifactId") REFERENCES "GeneratedArtifact"("id") ON DELETE NO ACTION ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MissionArtifactReceipt_artifactId_key" ON "MissionArtifactReceipt"("artifactId");
CREATE UNIQUE INDEX "MissionArtifactReceipt_outputId_artifactType_key" ON "MissionArtifactReceipt"("outputId","artifactType");
CREATE UNIQUE INDEX "MissionArtifactReceipt_createdByUserId_requestId_key" ON "MissionArtifactReceipt"("createdByUserId","requestId");
CREATE INDEX "MissionArtifactReceipt_projectId_createdAt_idx" ON "MissionArtifactReceipt"("projectId","createdAt");
