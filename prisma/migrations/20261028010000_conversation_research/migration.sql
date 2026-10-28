ALTER TABLE "Conversation" ADD COLUMN "researchScopeJson" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Conversation" ADD COLUMN "researchScopeVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ConversationTurn" ADD COLUMN "sessionId" TEXT;
ALTER TABLE "ConversationTurn" ADD COLUMN "leaseToken" TEXT;
ALTER TABLE "ConversationTurn" ADD COLUMN "leaseUntil" DATETIME;
CREATE INDEX "ConversationTurn_status_leaseUntil_idx" ON "ConversationTurn"("status", "leaseUntil");
