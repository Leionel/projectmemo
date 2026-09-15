-- Phase 2: stale state visibility, atomic intervention budget/preferences,
-- and idempotent intervention acceptance. All changes are additive.
ALTER TABLE "ActionItem" ADD COLUMN "dedupeKey" TEXT;
CREATE UNIQUE INDEX "ActionItem_dedupeKey_key" ON "ActionItem"("dedupeKey");

CREATE TABLE "ProjectStateFreshness" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'STALE',
    "snapshotId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "attemptedAt" DATETIME,
    "refreshedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectStateFreshness_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProjectStateFreshness_projectId_key" ON "ProjectStateFreshness"("projectId");

CREATE TABLE "InterventionBudgetLedger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "windowKey" TEXT NOT NULL,
    "windowStartAt" DATETIME NOT NULL,
    "windowEndAt" DATETIME NOT NULL,
    "timezone" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "dailyBudget" INTEGER NOT NULL,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "InterventionBudgetLedger_scope_windowKey_key" ON "InterventionBudgetLedger"("scope", "windowKey");
CREATE INDEX "InterventionBudgetLedger_scope_windowStartAt_windowEndAt_idx" ON "InterventionBudgetLedger"("scope", "windowStartAt", "windowEndAt");

CREATE TABLE "InterventionPreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "reducedSince" DATETIME,
    "suggestionDismissedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InterventionPreference_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "InterventionPreference_projectId_triggerType_key" ON "InterventionPreference"("projectId", "triggerType");
CREATE INDEX "InterventionPreference_projectId_reducedSince_idx" ON "InterventionPreference"("projectId", "reducedSince");
