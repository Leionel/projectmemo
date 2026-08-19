-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "scenario" TEXT NOT NULL,
    "deadline" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "Capture" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "sourceType" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Capture_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "KnowledgeCard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "captureId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "keywords" JSONB NOT NULL,
    "relatedTasks" JSONB NOT NULL,
    "nextActions" JSONB NOT NULL,
    "importance" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KnowledgeCard_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeCard_captureId_fkey" FOREIGN KEY ("captureId") REFERENCES "Capture" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CardRelation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "currentCardId" TEXT NOT NULL,
    "relatedCardId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CardRelation_currentCardId_fkey" FOREIGN KEY ("currentCardId") REFERENCES "KnowledgeCard" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CardRelation_relatedCardId_fkey" FOREIGN KEY ("relatedCardId") REFERENCES "KnowledgeCard" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "GeneratedArtifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "artifactType" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GeneratedArtifact_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Project_updatedAt_idx" ON "Project"("updatedAt");
CREATE INDEX "Capture_projectId_createdAt_idx" ON "Capture"("projectId", "createdAt");
CREATE UNIQUE INDEX "KnowledgeCard_captureId_key" ON "KnowledgeCard"("captureId");
CREATE INDEX "KnowledgeCard_projectId_createdAt_idx" ON "KnowledgeCard"("projectId", "createdAt");
CREATE INDEX "KnowledgeCard_projectId_type_idx" ON "KnowledgeCard"("projectId", "type");
CREATE UNIQUE INDEX "CardRelation_currentCardId_relatedCardId_key" ON "CardRelation"("currentCardId", "relatedCardId");
CREATE INDEX "CardRelation_relatedCardId_idx" ON "CardRelation"("relatedCardId");
CREATE INDEX "GeneratedArtifact_projectId_createdAt_idx" ON "GeneratedArtifact"("projectId", "createdAt");
