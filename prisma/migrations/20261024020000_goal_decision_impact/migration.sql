CREATE TABLE "ProjectImpactJob" (
"id" TEXT NOT NULL PRIMARY KEY,"projectId" TEXT NOT NULL,"mutationReceiptId" TEXT NOT NULL,"ruleVersion" TEXT NOT NULL DEFAULT 'impact-v1',"rootsJson" JSONB NOT NULL,"status" TEXT NOT NULL DEFAULT 'PENDING',"attempts" INTEGER NOT NULL DEFAULT 0,"nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,"resultJson" JSONB,"lastError" TEXT,"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
FOREIGN KEY("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE UNIQUE INDEX "ProjectImpactJob_projectId_mutationReceiptId_key" ON "ProjectImpactJob"("projectId","mutationReceiptId");
CREATE INDEX "ProjectImpactJob_status_nextAttemptAt_idx" ON "ProjectImpactJob"("status","nextAttemptAt");
CREATE TABLE "ProjectImpactEffect" (
"id" TEXT NOT NULL PRIMARY KEY,"jobId" TEXT NOT NULL,"missionId" TEXT NOT NULL,"oldPlanRevision" INTEGER NOT NULL,"newPlanRevision" INTEGER NOT NULL,"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
FOREIGN KEY("jobId") REFERENCES "ProjectImpactJob"("id") ON DELETE CASCADE ON UPDATE CASCADE,FOREIGN KEY("missionId") REFERENCES "AgentMission"("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE UNIQUE INDEX "ProjectImpactEffect_jobId_missionId_key" ON "ProjectImpactEffect"("jobId","missionId");
CREATE TABLE "DecisionScenarioProposal" (
"id" TEXT NOT NULL PRIMARY KEY,"projectId" TEXT NOT NULL,"missionId" TEXT NOT NULL,"ownerUserId" TEXT NOT NULL,"createRequestId" TEXT NOT NULL,"inputHash" TEXT NOT NULL,"inputJson" JSONB NOT NULL,"baseManifest" JSONB NOT NULL,"scenariosJson" JSONB NOT NULL,"proposalHash" TEXT NOT NULL,"status" TEXT NOT NULL DEFAULT 'READY',"expiresAt" DATETIME NOT NULL,"revision" INTEGER NOT NULL DEFAULT 1,"parentId" TEXT,"confirmRequestId" TEXT,"confirmHash" TEXT,"selectedKey" TEXT,"receiptJson" JSONB,"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
FOREIGN KEY("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,FOREIGN KEY("missionId") REFERENCES "AgentMission"("id") ON DELETE CASCADE ON UPDATE CASCADE,FOREIGN KEY("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE UNIQUE INDEX "DecisionScenarioProposal_ownerUserId_createRequestId_key" ON "DecisionScenarioProposal"("ownerUserId","createRequestId");
CREATE UNIQUE INDEX "DecisionScenarioProposal_ownerUserId_confirmRequestId_key" ON "DecisionScenarioProposal"("ownerUserId","confirmRequestId");
CREATE INDEX "DecisionScenarioProposal_missionId_createdAt_idx" ON "DecisionScenarioProposal"("missionId","createdAt");
CREATE TABLE "GoalQuestionPreference" (
"id" TEXT NOT NULL PRIMARY KEY,"userId" TEXT NOT NULL,"missionId" TEXT NOT NULL,"questionId" TEXT NOT NULL,"mode" TEXT NOT NULL,"contextHash" TEXT NOT NULL,"snoozedUntil" DATETIME,"updatedAt" DATETIME NOT NULL,
FOREIGN KEY("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,FOREIGN KEY("missionId") REFERENCES "AgentMission"("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE UNIQUE INDEX "GoalQuestionPreference_userId_missionId_questionId_key" ON "GoalQuestionPreference"("userId","missionId","questionId");
