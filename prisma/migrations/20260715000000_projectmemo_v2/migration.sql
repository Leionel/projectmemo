-- ProjectMemo 2.0 Extended Schema Migration

-- 1. Attachment table
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "extractedText" TEXT,
    "extractionStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "extractionError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Attachment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 2. Alter KnowledgeCard for Attachment support
ALTER TABLE "KnowledgeCard" ADD COLUMN "attachmentId" TEXT;

-- 3. CardEmbedding table for Hybrid Search
CREATE TABLE "CardEmbedding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cardId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "vectorJson" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CardEmbedding_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "KnowledgeCard" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 4. Milestone & Deliverables
CREATE TABLE "Milestone" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "targetDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Milestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Deliverable" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "milestoneId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "expectedEvidence" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Deliverable_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "DeliverableEvidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deliverableId" TEXT NOT NULL,
    "cardId" TEXT,
    "attachmentId" TEXT,
    "evidenceType" TEXT NOT NULL,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeliverableEvidence_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "Deliverable" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Indices
CREATE INDEX "Attachment_projectId_sha256_idx" ON "Attachment"("projectId", "sha256");
CREATE INDEX "Attachment_projectId_createdAt_idx" ON "Attachment"("projectId", "createdAt");
CREATE UNIQUE INDEX "CardEmbedding_cardId_key" ON "CardEmbedding"("cardId");
CREATE INDEX "CardEmbedding_cardId_idx" ON "CardEmbedding"("cardId");
CREATE INDEX "KnowledgeCard_attachmentId_idx" ON "KnowledgeCard"("attachmentId");
CREATE INDEX "Milestone_projectId_status_idx" ON "Milestone"("projectId", "status");
CREATE INDEX "Deliverable_milestoneId_idx" ON "Deliverable"("milestoneId");
CREATE INDEX "DeliverableEvidence_deliverableId_idx" ON "DeliverableEvidence"("deliverableId");
