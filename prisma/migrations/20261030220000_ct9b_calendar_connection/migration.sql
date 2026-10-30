-- CT-9B：Google Calendar 只读连接、一次性 OAuth state 与窗口快照。
-- 只新增表与索引，不改写既有表。token 以服务端 AES-GCM 密文存储。
CREATE TABLE "CalendarConnection" (
"id" TEXT NOT NULL PRIMARY KEY,"projectId" TEXT NOT NULL,"ownerUserId" TEXT NOT NULL,"provider" TEXT NOT NULL DEFAULT 'FEISHU_CALENDAR',"accountId" TEXT NOT NULL,"accountEmail" TEXT NOT NULL,"accountName" TEXT NOT NULL DEFAULT '',"calendarId" TEXT NOT NULL,"calendarSummary" TEXT NOT NULL DEFAULT '',"calendarTimeZone" TEXT NOT NULL DEFAULT 'UTC',"accessRole" TEXT NOT NULL DEFAULT 'reader',"scope" TEXT NOT NULL,"authGeneration" INTEGER NOT NULL DEFAULT 1,"status" TEXT NOT NULL DEFAULT 'ACTIVE',"revokedAt" DATETIME,"revokedReason" TEXT,"tokenCipher" TEXT,"tokenVersion" INTEGER NOT NULL DEFAULT 1,"tokenExpiresAt" DATETIME,"syncToken" TEXT,"windowStart" DATETIME,"windowEnd" DATETIME,"lastFetchedAt" DATETIME,"lastStatus" TEXT,"lastError" TEXT,"revision" INTEGER NOT NULL DEFAULT 0,"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" DATETIME NOT NULL,
FOREIGN KEY("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
FOREIGN KEY("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE INDEX "CalendarConnection_projectId_status_idx" ON "CalendarConnection"("projectId","status");
CREATE UNIQUE INDEX "CalendarConnection_projectId_provider_accountId_calendarId_key" ON "CalendarConnection"("projectId","provider","accountId","calendarId");

CREATE TABLE "CalendarOAuthState" (
"id" TEXT NOT NULL PRIMARY KEY,"stateHash" TEXT NOT NULL,"ownerUserId" TEXT NOT NULL,"projectId" TEXT NOT NULL,"provider" TEXT NOT NULL,"redirectUri" TEXT NOT NULL,"scope" TEXT NOT NULL,"codeVerifierCipher" TEXT NOT NULL,"calendarId" TEXT,"expiresAt" DATETIME NOT NULL,"consumedAt" DATETIME,"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX "CalendarOAuthState_stateHash_key" ON "CalendarOAuthState"("stateHash");
CREATE INDEX "CalendarOAuthState_ownerUserId_expiresAt_idx" ON "CalendarOAuthState"("ownerUserId","expiresAt");

CREATE TABLE "CalendarObservation" (
"id" TEXT NOT NULL PRIMARY KEY,"connectionId" TEXT NOT NULL,"projectId" TEXT NOT NULL,"ownerUserId" TEXT NOT NULL,"calendarId" TEXT NOT NULL,"eventKey" TEXT NOT NULL,"eventId" TEXT NOT NULL,"recurringEventId" TEXT,"eventStatus" TEXT NOT NULL,"title" TEXT NOT NULL,"startAt" DATETIME,"endAt" DATETIME,"allDay" BOOLEAN NOT NULL DEFAULT false,"startDate" TEXT,"endDate" TEXT,"eventTimeZone" TEXT,"transparency" TEXT,"eventUpdatedAt" DATETIME,"eventEtag" TEXT,"revision" TEXT NOT NULL,"scopeKey" TEXT NOT NULL DEFAULT 'PROJECT',"windowStart" DATETIME NOT NULL,"windowEnd" DATETIME NOT NULL,"windowComplete" BOOLEAN NOT NULL DEFAULT false,"missionId" TEXT,"conversationTurnId" TEXT,"payloadJson" JSONB NOT NULL,"observedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
FOREIGN KEY("connectionId") REFERENCES "CalendarConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE INDEX "CalendarObservation_connectionId_startAt_idx" ON "CalendarObservation"("connectionId","startAt");
CREATE INDEX "CalendarObservation_projectId_calendarId_startAt_idx" ON "CalendarObservation"("projectId","calendarId","startAt");
CREATE INDEX "CalendarObservation_missionId_idx" ON "CalendarObservation"("missionId");
CREATE UNIQUE INDEX "CalendarObservation_connectionId_eventKey_revision_scopeKey_key" ON "CalendarObservation"("connectionId","eventKey","revision","scopeKey");
