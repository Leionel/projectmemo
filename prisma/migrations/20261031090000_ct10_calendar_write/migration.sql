-- CT-10：OAuth state 记录本次请求的只读/写入模式；不改变既有连接与观察。
ALTER TABLE "CalendarOAuthState" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'READ';
