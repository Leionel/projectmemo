CREATE TABLE "AccountSecurity" (
  "userId" TEXT NOT NULL PRIMARY KEY,
  "email" TEXT NOT NULL,
  "emailVerifiedAt" DATETIME,
  "dailyCloudLimit" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "AccountSecurity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AccountSecurity_email_key" ON "AccountSecurity"("email");
CREATE TABLE "AuthRequestLimit" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "count" INTEGER NOT NULL,
  "expiresAt" DATETIME NOT NULL
);
CREATE INDEX "AuthRequestLimit_expiresAt_idx" ON "AuthRequestLimit"("expiresAt");
CREATE TABLE "AccountToken" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "usedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AccountToken_tokenHash_key" ON "AccountToken"("tokenHash");
CREATE INDEX "AccountToken_userId_purpose_idx" ON "AccountToken"("userId", "purpose");
CREATE TABLE "AccountCloudUsage" (
  "userId" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "used" INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY ("userId", "day"),
  CONSTRAINT "AccountCloudUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
