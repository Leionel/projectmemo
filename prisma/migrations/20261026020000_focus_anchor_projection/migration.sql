ALTER TABLE "ConversationAnchor" ADD COLUMN "rootKey" TEXT;
ALTER TABLE "ConversationAnchor" ADD COLUMN "missionId" TEXT;
ALTER TABLE "ConversationAnchor" ADD COLUMN "originEntryJson" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "ConversationAnchor" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "ConversationAnchor" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ConversationAnchor" ADD COLUMN "snoozedUntil" DATETIME;
ALTER TABLE "ConversationAnchor" ADD COLUMN "eventCursor" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ConversationAnchor" ADD COLUMN "projectedSeq" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ConversationAnchor" ADD COLUMN "seenSeq" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ConversationAnchor" ADD COLUMN "lastSyncedAt" DATETIME;
UPDATE "ConversationAnchor" SET "missionId" = COALESCE(
 (SELECT "missionId" FROM "AgentMissionEvent" WHERE "id"="ConversationAnchor"."originId" AND "type"='QUESTION'),
 (SELECT "missionId" FROM "ProjectImpactEffect" WHERE "id"="ConversationAnchor"."originId"),
 (SELECT "id" FROM "AgentMission" WHERE 'impact:' || "id"="ConversationAnchor"."originId")
) WHERE "originKind" IN ('GOAL_QUESTION','IMPACT');
UPDATE "ConversationAnchor" SET "originEntryJson" = json_object('entry',json_object('kind',"originKind",'id',"originId",'projectId',"projectId"),'title',
 COALESCE((SELECT "title" FROM "Conversation" WHERE "id"="ConversationAnchor"."conversationId"),'原主题'));
CREATE UNIQUE INDEX "ConversationAnchor_rootKey_key" ON "ConversationAnchor"("rootKey");
CREATE INDEX "ConversationAnchor_ownerUserId_conversationId_mode_idx" ON "ConversationAnchor"("ownerUserId", "conversationId", "mode");
CREATE TABLE "ConversationAnchorProjection" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "anchorId" TEXT NOT NULL,
 "revisionKey" TEXT NOT NULL,
 "seq" INTEGER,
 "messageId" TEXT,
 "payloadJson" JSONB NOT NULL,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ConversationAnchorProjection_anchorId_fkey" FOREIGN KEY ("anchorId") REFERENCES "ConversationAnchor"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "ConversationAnchorProjection_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AgentMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ConversationAnchorProjection_messageId_key" ON "ConversationAnchorProjection"("messageId");
CREATE UNIQUE INDEX "ConversationAnchorProjection_anchorId_revisionKey_key" ON "ConversationAnchorProjection"("anchorId", "revisionKey");
CREATE UNIQUE INDEX "ConversationAnchorProjection_anchorId_seq_key" ON "ConversationAnchorProjection"("anchorId", "seq");
CREATE TABLE "ConversationEntryRequest" (
 "ownerUserId" TEXT NOT NULL,
 "requestId" TEXT NOT NULL,
 "inputHash" TEXT NOT NULL,
 "conversationId" TEXT NOT NULL,
 PRIMARY KEY ("ownerUserId", "requestId")
);
CREATE TABLE "ConversationAnchorAction" (
 "anchorId" TEXT NOT NULL,
 "actionId" TEXT NOT NULL,
 "lastCheckedAt" DATETIME,
 "observedStatus" TEXT,
 "observedResultCardId" TEXT,
 PRIMARY KEY ("anchorId","actionId"),
 CONSTRAINT "ConversationAnchorAction_anchorId_fkey" FOREIGN KEY ("anchorId") REFERENCES "ConversationAnchor"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "ConversationAnchorAction_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "ActionItem"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ConversationAnchorAction_anchorId_lastCheckedAt_idx" ON "ConversationAnchorAction"("anchorId","lastCheckedAt");
