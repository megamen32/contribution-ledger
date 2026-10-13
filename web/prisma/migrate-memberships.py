#!/usr/bin/env python3
"""Add memberships and project scopes; posted ledger rows and triggers stay untouched."""
import sqlite3
import sys
with sqlite3.connect(sys.argv[1], timeout=10) as db:
    db.execute("PRAGMA foreign_keys=ON")
    db.execute("BEGIN IMMEDIATE")
    initial_memberships = not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='WorkspaceMembership'").fetchone()
    db.execute('CREATE TABLE IF NOT EXISTS "WorkspaceMembership" ("workspaceId" TEXT NOT NULL, "userId" TEXT NOT NULL, "role" TEXT NOT NULL DEFAULT \'member\', "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY ("workspaceId", "userId"), FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE, FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE)')
    db.execute('CREATE INDEX IF NOT EXISTS "WorkspaceMembership_userId_idx" ON "WorkspaceMembership"("userId")')
    if initial_memberships:
        db.execute('INSERT OR IGNORE INTO "WorkspaceMembership" ("workspaceId", "userId", "role") SELECT "workspaceId", "id", "role" FROM "User"')
    cols={r[1] for r in db.execute('PRAGMA table_info("InviteToken")')}
    if "usedById" not in cols:
        db.execute('ALTER TABLE "InviteToken" ADD COLUMN "usedById" TEXT')
    for table, owner in (("Task", "ownerId"), ("Session", "userId"), ("AgreedLaborRate", "userId"), ("Job", "actorId"), ("Change", "actorId")):
        cols={r[1] for r in db.execute(f'PRAGMA table_info("{table}")')}
        if "workspaceId" not in cols:
            db.execute(f'ALTER TABLE "{table}" ADD COLUMN "workspaceId" TEXT NOT NULL DEFAULT \'legacy\'')
            db.execute(f'UPDATE "{table}" SET "workspaceId"=COALESCE((SELECT "workspaceId" FROM "User" WHERE "User"."id"="{table}"."{owner}"),\'legacy\')')
    initial_ledger_scope = not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='LedgerProjectScope'").fetchone()
    db.execute('CREATE TABLE IF NOT EXISTS "LedgerProjectScope" ("entryId" TEXT NOT NULL PRIMARY KEY, "workspaceId" TEXT NOT NULL, FOREIGN KEY ("entryId") REFERENCES "LedgerEntry"("id") ON DELETE CASCADE)')
    db.execute('CREATE INDEX IF NOT EXISTS "LedgerProjectScope_workspaceId_idx" ON "LedgerProjectScope"("workspaceId")')
    if initial_ledger_scope:
        db.execute('INSERT OR IGNORE INTO "LedgerProjectScope" ("entryId","workspaceId") SELECT e."id", u."workspaceId" FROM "LedgerEntry" e JOIN "User" u ON u."id"=e."userId"')
    db.commit()
print("Membership migration complete; posted ledger entries and triggers unchanged")
