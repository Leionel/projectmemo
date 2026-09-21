-- 归并确认需要在并发请求下保持 requestId 唯一，并能识别同 ID 不同载荷。
-- requestId 保持可空以兼容升级前可能存在的历史回执；新服务请求始终写入非空值。
ALTER TABLE "MemoryMergeReceipt" ADD COLUMN "inputHash" TEXT;

-- 早期版本只有应用层 findFirst，极端并发下可能留下重复回执。
-- 保留全部历史行，仅给后到的重复项加 legacy 后缀，再建立约束，避免旧库升级失败。
UPDATE "MemoryMergeReceipt" AS current
SET "requestId" = current."requestId" || ':legacy:' || current."id"
WHERE current."requestId" IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM "MemoryMergeReceipt" AS previous
    WHERE previous."projectId" = current."projectId"
      AND previous."requestId" = current."requestId"
      AND (
        previous."createdAt" < current."createdAt"
        OR (previous."createdAt" = current."createdAt" AND previous."id" < current."id")
      )
  );

CREATE UNIQUE INDEX "MemoryMergeReceipt_projectId_requestId_key"
ON "MemoryMergeReceipt"("projectId", "requestId");
