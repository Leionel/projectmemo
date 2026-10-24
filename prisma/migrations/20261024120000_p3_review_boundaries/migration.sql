DROP INDEX "AgentExperience_projectId_kind_patternHash_key";
CREATE UNIQUE INDEX "AgentExperience_projectId_ownerUserId_kind_patternHash_key"
ON "AgentExperience"("projectId","ownerUserId","kind","patternHash");

-- 修正旧版可能合并的异主样本；保留行、历史使用记录与撤销状态。
UPDATE "AgentExperience" SET "sampleMissionIdsJson" = (
 SELECT json_group_array(j.value) FROM json_each("AgentExperience"."sampleMissionIdsJson") j
 JOIN "AgentMission" m ON m.id=j.value AND m."ownerUserId"="AgentExperience"."ownerUserId" AND m."projectId"="AgentExperience"."projectId"
), "counterExamplesJson" = (
 SELECT json_group_array(json(j.value)) FROM json_each("AgentExperience"."counterExamplesJson") j
 JOIN "AgentMission" m ON m.id=json_extract(j.value,'$.missionId') AND m."ownerUserId"="AgentExperience"."ownerUserId" AND m."projectId"="AgentExperience"."projectId"
);
UPDATE "AgentExperience" SET "supportCount"=json_array_length("sampleMissionIdsJson"), "counterCount"=json_array_length("counterExamplesJson");
UPDATE "AgentExperience" SET "status"='CANDIDATE' WHERE "supportCount" < 2 AND "status" IN ('ACTIVE','SHADOW');

ALTER TABLE "SourceConnection" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SourceConnection" ADD COLUMN "scanHeadSha" TEXT;
ALTER TABLE "SourceConnection" ADD COLUMN "scanNextPage" INTEGER;
ALTER TABLE "SourceConnection" ADD COLUMN "scanEtag" TEXT;

CREATE TABLE "RepoSignalCommand" (
 "id" TEXT NOT NULL PRIMARY KEY, "signalId" TEXT NOT NULL, "ownerUserId" TEXT NOT NULL,
 "requestId" TEXT NOT NULL, "payloadHash" TEXT NOT NULL, "resultJson" JSONB NOT NULL,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("signalId") REFERENCES "ExternalSignal"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RepoSignalCommand_ownerUserId_requestId_key" ON "RepoSignalCommand"("ownerUserId","requestId");
