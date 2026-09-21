-- 待办日历提醒生命周期回执。
--
-- 纯增量：只新增一张表和它的索引，不修改或删除任何现有列与数据。
-- 空库可重放，旧库副本可直接增量升级；回退方式是关闭 feature flag，不删数据。
--
-- 设计要点：
-- 1. 唯一键是 (projectId, actionId, userId, deviceKey)：提醒回执按「设备」归属，
--    同一项目的其他成员、同一成员的另一台设备都无法读取或撤销不属于自己的设备日历事件。
-- 2. reminderAt 只表示项目内计划时间；只有带 calendarEventId 的 SYNCED 才代表设备上
--    真实存在由 ProjectMemo 创建的事件，因此 ActionItem.dueAt 不能充当写入回执。
-- 3. 每行只承载一次提醒意图的当前状态：修改时间原地更新并递增 revision，
--    不新增行，从结构上避免同一待办留下重复的应用自有事件。

CREATE TABLE "ActionReminder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceKey" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "reminderAt" DATETIME NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 30,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "calendarId" TEXT,
    "calendarEventId" TEXT,
    "syncStatus" TEXT NOT NULL DEFAULT 'PLANNED',
    "error" TEXT,
    "inputHash" TEXT,
    "completionChoice" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    CONSTRAINT "ActionReminder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ActionReminder_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "ActionItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ActionReminder_projectId_actionId_userId_deviceKey_key"
ON "ActionReminder"("projectId", "actionId", "userId", "deviceKey");

CREATE INDEX "ActionReminder_userId_syncStatus_idx" ON "ActionReminder"("userId", "syncStatus");
CREATE INDEX "ActionReminder_projectId_syncStatus_idx" ON "ActionReminder"("projectId", "syncStatus");
CREATE INDEX "ActionReminder_calendarEventId_idx" ON "ActionReminder"("calendarEventId");
CREATE INDEX "ActionReminder_projectId_updatedAt_idx" ON "ActionReminder"("projectId", "updatedAt");
