-- Additive migration for installations originally initialized with prisma db push.
-- Does not recreate tables, remove triggers, or modify existing account/ledger rows.
CREATE TABLE IF NOT EXISTS "OwnerSetup" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'first-owner',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME
);
CREATE UNIQUE INDEX IF NOT EXISTS "OwnerSetup_tokenHash_key" ON "OwnerSetup"("tokenHash");
