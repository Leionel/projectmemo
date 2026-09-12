-- P1 修复：快照唯一键加入 previousSnapshotId。
-- 旧键 (projectId, sourceHash, policyVersion, evaluationKey) 会阻止"回到旧内容"再次成行，
-- 导致 A→B→A 时 refresh 复用历史行而最新状态停留在 B。新键允许同一源版本在
-- 历史不同位置各自生成状态记录；仅当最新行对应当前源版本时才复用。
DROP INDEX IF EXISTS "ProjectStateSnapshot_projectId_sourceHash_policyVersion_evaluationKey_key";
CREATE UNIQUE INDEX "ProjectStateSnapshot_projectId_sourceHash_policyVersion_evaluationKey_previousSnapshotId_key"
ON "ProjectStateSnapshot"("projectId", "sourceHash", "policyVersion", "evaluationKey", "previousSnapshotId");

-- 回滚指引：恢复旧唯一索引前必须先合并同键历史行，否则会因重复失败；
-- 历史行不删除。
