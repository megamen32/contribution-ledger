#!/usr/bin/env python3
"""Add project scopes without rebuilding tables or removing ledger triggers.

Run with an explicit SQLite path, after taking a SQLite backup. Safe to rerun.
"""
import sqlite3
import sys

with sqlite3.connect(sys.argv[1], timeout=10) as db:
    db.execute("BEGIN IMMEDIATE")
    db.execute('CREATE TABLE IF NOT EXISTS "Workspace" ("id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)')
    db.execute('INSERT OR IGNORE INTO "Workspace" ("id", "name") VALUES (?, ?)', ("legacy", "Команда Вклада"))
    for table in ("User", "InviteToken", "RateCardVersion", "RuleVersion", "ModelProfile"):
        columns = {row[1] for row in db.execute(f'PRAGMA table_info("{table}")')}
        if "workspaceId" not in columns:
            db.execute(f'ALTER TABLE "{table}" ADD COLUMN "workspaceId" TEXT NOT NULL DEFAULT \'legacy\'')
    db.execute('CREATE INDEX IF NOT EXISTS "User_workspaceId_idx" ON "User"("workspaceId")')
    for table, field in (("RateCardVersion", "version"), ("RuleVersion", "version"), ("ModelProfile", "profileId")):
        db.execute(f'DROP INDEX IF EXISTS "{table}_{field}_key"')
        db.execute(f'CREATE UNIQUE INDEX IF NOT EXISTS "{table}_workspaceId_{field}_key" ON "{table}"("workspaceId", "{field}")')
    db.commit()
print("Project migration complete; existing records and triggers retained")
