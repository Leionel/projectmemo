-- 提醒请求回执：把「一次请求」变成不可变的幂等事实。
--
-- 背景：原实现只用 ActionReminder.requestId 比较「最新一次请求」，
-- 于是延迟重放的旧请求既不会被识别成重放，还会覆盖较新的提醒；
-- 也无法区分「同 ID 不同项目/不同待办」这类复用。
--
-- 纯增量：只新增一张表和它的索引，不修改或删除任何现有列与数据。
-- 空库可重放，旧库副本可直接增量升级；回退方式是关闭 feature flag，不删数据。
--
-- 唯一键取 (userId, deviceKey, requestId)：一次用户意图只生成一个 ID，
-- 同一 ID 换项目或换待办复用一律落到同一条回执上，由服务层返回 409。

CREATE TABLE "ActionReminderRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceKey" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'ARRANGE',
    "inputHash" TEXT NOT NULL,
    "reminderId" TEXT,
    "reminderStatus" TEXT,
    "reminderRevision" INTEGER,
    "requestedReminderAt" DATETIME,
    "durationMinutes" INTEGER,
    "createdAt" DATETIME NOT NULL,
    CONSTRAINT "ActionReminderRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ActionReminderRequest_userId_deviceKey_requestId_key"
ON "ActionReminderRequest"("userId", "deviceKey", "requestId");

CREATE INDEX "ActionReminderRequest_projectId_actionId_idx" ON "ActionReminderRequest"("projectId", "actionId");
CREATE INDEX "ActionReminderRequest_reminderId_idx" ON "ActionReminderRequest"("reminderId");
