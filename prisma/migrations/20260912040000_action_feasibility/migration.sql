-- F1: structured action requirements + user estimate.
-- Satisfaction is never persisted; it is recomputed from current source state.
CREATE TABLE "ActionRequirement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actionId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "targetKind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "hard" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActionRequirement_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "ActionItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ActionRequirement_actionId_idx" ON "ActionRequirement"("actionId");

ALTER TABLE "ActionItem" ADD COLUMN "estimatedMinutes" INTEGER;
