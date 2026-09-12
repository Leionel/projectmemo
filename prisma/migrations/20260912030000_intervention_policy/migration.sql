-- B1: intervention budget policy, decision log and feedback events.
-- Additive only; AgentIntervention keeps handling user processing status.
CREATE TABLE "InterventionPolicy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL DEFAULT 'GLOBAL',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "dailyBudget" INTEGER NOT NULL DEFAULT 3,
    "quietStartMinute" INTEGER NOT NULL DEFAULT 1380,
    "quietEndMinute" INTEGER NOT NULL DEFAULT 480,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "reducedTopics" JSONB,
    "suggestionState" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "InterventionPolicy_scope_key" ON "InterventionPolicy"("scope");

CREATE TABLE "InterventionDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "candidateKey" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "whyNow" TEXT NOT NULL,
    "evidenceRefs" JSONB,
    "channel" TEXT NOT NULL DEFAULT 'IN_APP',
    "policyVersion" INTEGER NOT NULL,
    "interventionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InterventionDecision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "InterventionDecision_projectId_createdAt_idx" ON "InterventionDecision"("projectId", "createdAt");
CREATE INDEX "InterventionDecision_candidateKey_createdAt_idx" ON "InterventionDecision"("candidateKey", "createdAt");
CREATE INDEX "InterventionDecision_projectId_decision_createdAt_idx" ON "InterventionDecision"("projectId", "decision", "createdAt");

CREATE TABLE "InterventionFeedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "interventionId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "feedbackType" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InterventionFeedback_interventionId_fkey" FOREIGN KEY ("interventionId") REFERENCES "AgentIntervention" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "InterventionFeedback_interventionId_feedbackType_key" ON "InterventionFeedback"("interventionId", "feedbackType");
CREATE INDEX "InterventionFeedback_projectId_createdAt_idx" ON "InterventionFeedback"("projectId", "createdAt");
