-- P3-A 项目内经验复用：AgentExperience / AgentExperienceUse。
-- 只新增两张表与索引，不改写既有表。
CREATE TABLE "AgentExperience" (
"id" TEXT NOT NULL PRIMARY KEY,"projectId" TEXT NOT NULL,"ownerUserId" TEXT NOT NULL,"kind" TEXT NOT NULL,"patternHash" TEXT NOT NULL,"title" TEXT NOT NULL,"statement" TEXT NOT NULL,"applicabilityJson" JSONB NOT NULL,"toolVersionsJson" JSONB NOT NULL DEFAULT '{}',"protocolVersionsJson" JSONB NOT NULL DEFAULT '[]',"counterExamplesJson" JSONB NOT NULL DEFAULT '[]',"status" TEXT NOT NULL DEFAULT 'CANDIDATE',"sampleMissionIdsJson" JSONB NOT NULL DEFAULT '[]',"supportCount" INTEGER NOT NULL DEFAULT 0,"counterCount" INTEGER NOT NULL DEFAULT 0,"activatedAt" DATETIME,"revokedAt" DATETIME,"revokedReason" TEXT,"schemaVersion" INTEGER NOT NULL DEFAULT 1,"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" DATETIME NOT NULL,
FOREIGN KEY("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
FOREIGN KEY("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE INDEX "AgentExperience_projectId_status_idx" ON "AgentExperience"("projectId","status");
CREATE UNIQUE INDEX "AgentExperience_projectId_kind_patternHash_key" ON "AgentExperience"("projectId","kind","patternHash");
CREATE TABLE "AgentExperienceUse" (
"id" TEXT NOT NULL PRIMARY KEY,"experienceId" TEXT NOT NULL,"missionId" TEXT NOT NULL,"stage" TEXT NOT NULL,"contextHash" TEXT,"injectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
FOREIGN KEY("experienceId") REFERENCES "AgentExperience"("id") ON DELETE CASCADE ON UPDATE CASCADE,
FOREIGN KEY("missionId") REFERENCES "AgentMission"("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE INDEX "AgentExperienceUse_experienceId_injectedAt_idx" ON "AgentExperienceUse"("experienceId","injectedAt");
CREATE UNIQUE INDEX "AgentExperienceUse_experienceId_missionId_stage_key" ON "AgentExperienceUse"("experienceId","missionId","stage");
