-- 项目归档：可恢复的展示偏好，与事实有效性正交。
--
-- 纯增量：archivedAt 为 NULL 时行为与迁移前完全一致，旧库可直接在副本上增量升级，
-- 空库重放同样成立。归档不删除任何记忆、快照、行动或成果行，
-- 因此本迁移不提供「归档即清理」的路径，删除仍然只走 Project 级联删除。

ALTER TABLE "Project" ADD COLUMN "archivedAt" DATETIME;

CREATE INDEX "Project_archivedAt_idx" ON "Project"("archivedAt");