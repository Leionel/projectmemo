-- R2 修复批次：排程按用户隔离、未安排原因持久化、确认时间、日历同步回执、记忆归并回执。
--
-- 纯增量：只新增列、索引和一张新表，不修改或删除任何现有列与数据。
-- 旧库副本可直接增量升级，空库重放同样成立；回退方式是关闭 feature flag，不删数据。
-- SchedulePlan.userId 允许 NULL：升级前生成的计划没有归属用户，按用户过滤时自然不可见，
-- 不会把某个成员的个人时段错误地算给另一个成员。

-- PRAGMA foreign_keys=off;
BEGIN TRANSACTION;

ALTER TABLE "EpisodeRevision" ADD COLUMN "confirmedAt" DATETIME;

ALTER TABLE "SchedulePlan" ADD COLUMN "userId" TEXT;
ALTER TABLE "SchedulePlan" ADD COLUMN "unscheduled" JSONB;

ALTER TABLE "ScheduleBlock" ADD COLUMN "calendarId" TEXT;
ALTER TABLE "ScheduleBlock" ADD COLUMN "calendarEventId" TEXT;
ALTER TABLE "ScheduleBlock" ADD COLUMN "calendarSyncStatus" TEXT;
ALTER TABLE "ScheduleBlock" ADD COLUMN "calendarSyncedAt" DATETIME;
ALTER TABLE "ScheduleBlock" ADD COLUMN "calendarError" TEXT;

CREATE TABLE "MemoryMergeReceipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "masterCardId" TEXT NOT NULL,
    "mergedCardIds" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "similarityScore" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "requestId" TEXT,
    "createdAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    CONSTRAINT "MemoryMergeReceipt_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "SchedulePlan_userId_status_idx" ON "SchedulePlan"("userId", "status");
CREATE INDEX "ScheduleBlock_calendarEventId_idx" ON "ScheduleBlock"("calendarEventId");
CREATE INDEX "MemoryMergeReceipt_projectId_status_idx" ON "MemoryMergeReceipt"("projectId", "status");
CREATE INDEX "MemoryMergeReceipt_masterCardId_idx" ON "MemoryMergeReceipt"("masterCardId");

COMMIT;

-- PRAGMA foreign_keys=on;
