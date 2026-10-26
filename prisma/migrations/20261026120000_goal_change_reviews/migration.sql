ALTER TABLE "DecisionScenarioProposal" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'FIXED_SCENARIOS';
ALTER TABLE "DecisionScenarioProposal" ADD COLUMN "reviewKey" TEXT;
ALTER TABLE "DecisionScenarioProposal" ADD COLUMN "reviewStateJson" JSONB;
CREATE UNIQUE INDEX "DecisionScenarioProposal_ownerUserId_purpose_reviewKey_key" ON "DecisionScenarioProposal"("ownerUserId", "purpose", "reviewKey");
CREATE INDEX "DecisionScenarioProposal_missionId_purpose_createdAt_idx" ON "DecisionScenarioProposal"("missionId", "purpose", "createdAt");
CREATE INDEX "DecisionScenarioProposal_parentId_purpose_idx" ON "DecisionScenarioProposal"("parentId", "purpose");
CREATE TABLE "DecisionReviewRequest" (
  "ownerUserId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "proposalId" TEXT NOT NULL,
  PRIMARY KEY ("ownerUserId", "requestId"),
  CONSTRAINT "DecisionReviewRequest_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "DecisionScenarioProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
