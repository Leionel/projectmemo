ALTER TABLE "User" ADD COLUMN "continuitySeq" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "AgentDirectiveEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "ownerUserId" TEXT NOT NULL,
  "seq" INTEGER NOT NULL,
  "commandId" TEXT NOT NULL,
  "eventIndex" INTEGER NOT NULL DEFAULT 0,
  "inputHash" TEXT NOT NULL,
  "directiveId" TEXT NOT NULL,
  "previousEventId" TEXT,
  "projectId" TEXT NOT NULL,
  "conversationId" TEXT,
  "missionId" TEXT,
  "kind" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "quote" TEXT NOT NULL,
  "sourceJson" JSONB NOT NULL,
  "admissionJson" JSONB NOT NULL,
  "sourceIdsJson" JSONB NOT NULL DEFAULT '[]',
  "validFrom" DATETIME NOT NULL,
  "validUntil" DATETIME,
  "timezone" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentDirectiveEvent_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AgentDirectiveEvent_ownerUserId_seq_key" ON "AgentDirectiveEvent"("ownerUserId","seq");
CREATE UNIQUE INDEX "AgentDirectiveEvent_ownerUserId_commandId_eventIndex_key" ON "AgentDirectiveEvent"("ownerUserId","commandId","eventIndex");
CREATE INDEX "AgentDirectiveEvent_ownerUserId_projectId_seq_idx" ON "AgentDirectiveEvent"("ownerUserId","projectId","seq");
CREATE INDEX "AgentDirectiveEvent_ownerUserId_directiveId_seq_idx" ON "AgentDirectiveEvent"("ownerUserId","directiveId","seq");
