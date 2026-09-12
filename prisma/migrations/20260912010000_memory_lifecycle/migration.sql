-- M1: memory lifecycle audit trail + archive preference + attachment revisions.
-- Additive only: no existing row changes meaning; archivedAt NULL keeps cards visible.
CREATE TABLE "MemoryLifecycleEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "reason" TEXT,
    "actor" TEXT NOT NULL DEFAULT 'user',
    "relationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MemoryLifecycleEvent_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "KnowledgeCard" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MemoryLifecycleEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "MemoryLifecycleEvent_cardId_createdAt_idx" ON "MemoryLifecycleEvent"("cardId", "createdAt");
CREATE INDEX "MemoryLifecycleEvent_projectId_createdAt_idx" ON "MemoryLifecycleEvent"("projectId", "createdAt");

-- Rollback guidance: dropping these tables only loses future audit history;
-- do not delete lifecycle audit automatically.
CREATE TABLE "AttachmentRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "attachmentId" TEXT NOT NULL,
    "revisionIndex" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AttachmentRevision_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "Attachment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AttachmentRevision_attachmentId_revisionIndex_idx" ON "AttachmentRevision"("attachmentId", "revisionIndex");

ALTER TABLE "KnowledgeCard" ADD COLUMN "archivedAt" DATETIME;
