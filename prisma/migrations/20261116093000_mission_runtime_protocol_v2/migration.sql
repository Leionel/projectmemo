-- Existing missions remain protocol v1; no lifecycle/status or receipt is rewritten.
ALTER TABLE "AgentMission" ADD COLUMN "runtimeProtocolVersion" INTEGER NOT NULL DEFAULT 1;
