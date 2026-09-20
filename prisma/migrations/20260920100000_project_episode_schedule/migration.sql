-- R2 阶段检查点与可执行安排：ProjectEpisode / EpisodeRevision / SchedulePlan / ScheduleBlock。
--
-- 纯增量：只新增四张表和索引，不改动任何现有列，空库重放与旧库副本增量升级等价。
-- 回退方式是关闭 feature flag 与隐藏入口，不删除已生成的检查点或计划历史。

-- PRAGMA foreignKeys=off;
BEGIN TRANSACTION;

CREATE TABLE "ProjectEpisode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'MANUAL',
    "title" TEXT NOT NULL DEFAULT '',
    "windowStart" DATETIME NOT NULL,
    "windowEnd" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectEpisode_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "EpisodeRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "episodeId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "baseSnapshotId" TEXT,
    "endSnapshotId" TEXT,
    "sourceHash" TEXT NOT NULL,
    "sourceRefs" JSONB NOT NULL,
    "claims" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "generationMode" TEXT NOT NULL DEFAULT 'TEMPLATE',
    "provider" TEXT,
    "fallbackReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "requestId" TEXT,
    "createdAt" DATETIME NOT NULL,
    CONSTRAINT "EpisodeRevision_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "ProjectEpisode" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "SchedulePlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "episodeRevisionId" TEXT,
    "requestId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "rangeStart" DATETIME NOT NULL,
    "rangeEnd" DATETIME NOT NULL,
    "inputHash" TEXT NOT NULL,
    "sourceSnapshotId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SchedulePlan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ScheduleBlock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "actionVersion" INTEGER NOT NULL,
    "startAt" DATETIME NOT NULL,
    "endAt" DATETIME NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "reasonCode" TEXT,
    CONSTRAINT "ScheduleBlock_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SchedulePlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ProjectEpisode_projectId_status_idx" ON "ProjectEpisode"("projectId", "status");
CREATE INDEX "ProjectEpisode_projectId_createdAt_idx" ON "ProjectEpisode"("projectId", "createdAt");
CREATE UNIQUE INDEX "EpisodeRevision_episodeId_revision_key" ON "EpisodeRevision"("episodeId", "revision");
CREATE INDEX "EpisodeRevision_episodeId_status_idx" ON "EpisodeRevision"("episodeId", "status");
CREATE UNIQUE INDEX "SchedulePlan_projectId_requestId_key" ON "SchedulePlan"("projectId", "requestId");
CREATE INDEX "SchedulePlan_projectId_status_idx" ON "SchedulePlan"("projectId", "status");
CREATE INDEX "SchedulePlan_projectId_rangeStart_rangeEnd_idx" ON "SchedulePlan"("projectId", "rangeStart", "rangeEnd");
CREATE INDEX "ScheduleBlock_planId_idx" ON "ScheduleBlock"("planId");
CREATE INDEX "ScheduleBlock_actionId_idx" ON "ScheduleBlock"("actionId");

COMMIT;

-- PRAGMA foreignKeys=on;
