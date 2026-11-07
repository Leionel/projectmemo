-- 从用户日常输入发现个人记忆候选的开关；默认开启，候选确认前不生效。
ALTER TABLE "UserMemoryPolicy" ADD COLUMN "expressionSuggestEnabled" BOOLEAN NOT NULL DEFAULT true;
