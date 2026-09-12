-- E1：快照增加项目内递增 sequence，历史身份与内容去重分离。
-- 回填按 (evaluatedAt, id) 确定历史顺序；旧 ID 与游标引用保留。
ALTER TABLE "ProjectStateSnapshot" ADD COLUMN "sequence" INTEGER;
UPDATE "ProjectStateSnapshot" SET "sequence" = (
  SELECT COUNT(*) FROM "ProjectStateSnapshot" AS p2
  WHERE p2."projectId" = "ProjectStateSnapshot"."projectId"
    AND (p2."evaluatedAt" < "ProjectStateSnapshot"."evaluatedAt"
      OR (p2."evaluatedAt" = "ProjectStateSnapshot"."evaluatedAt" AND p2."id" < "ProjectStateSnapshot"."id"))
) + 1;

-- 历史身份不再依赖源哈希组合键：恢复旧内容（A→B→A）天然获得新 sequence
DROP INDEX IF EXISTS "ProjectStateSnapshot_projectId_sourceHash_policyVersion_evaluationKey_previousSnapshotId_key";
CREATE UNIQUE INDEX "ProjectStateSnapshot_projectId_sequence_key" ON "ProjectStateSnapshot"("projectId", "sequence");
CREATE INDEX "ProjectStateSnapshot_projectId_sourceHash_idx" ON "ProjectStateSnapshot"("projectId", "sourceHash");

-- 回滚指引：回退需先移除 sequence 列并重建旧组合唯一索引；同键历史行须先归档，
-- 否则会因重复失败。历史行不删除。
