from __future__ import annotations

import json
import time
from contextlib import contextmanager
from pathlib import Path

from contribution_spec.store import connect


@contextmanager
def database(root: Path):
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    db = connect(root / "ledger.sqlite3")
    try:
        yield db
    finally:
        db.close()


@contextmanager
def transaction(db):
    db.execute("BEGIN IMMEDIATE")
    try:
        yield
        db.execute("COMMIT")
    except BaseException:
        if db.in_transaction:
            db.execute("ROLLBACK")
        raise


def initialize(root: Path):
    with database(root) as db:
        if not db.execute("SELECT 1 FROM sqlite_master WHERE name='members'").fetchone():
            db.executescript(Path(__file__).with_name("core.sql").read_text())
        db.executescript("""
          CREATE TABLE IF NOT EXISTS app_rates (
            member_id TEXT PRIMARY KEY REFERENCES members(id),
            hourly_minor INTEGER NOT NULL CHECK(hourly_minor>=0));
          CREATE TABLE IF NOT EXISTS work_records (
            id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id),
            title TEXT NOT NULL, work_date TEXT NOT NULL, seconds INTEGER NOT NULL CHECK(seconds>0),
            hourly_minor INTEGER NOT NULL CHECK(hourly_minor>=0),
            effort_credit INTEGER NOT NULL CHECK(effort_credit IN (0,1)),
            credited_minor INTEGER NOT NULL CHECK(credited_minor>=0),
            notes TEXT NOT NULL, payload_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS work_evidence (
            work_id TEXT PRIMARY KEY REFERENCES work_records(id), body_json TEXT NOT NULL,
            imported_at INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS evaluations (
            id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES work_records(id),
            packet_json TEXT NOT NULL, models_json TEXT NOT NULL,
            slots_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS live_timers (
            member_id TEXT PRIMARY KEY REFERENCES members(id), id TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL, started_at INTEGER NOT NULL, stopped_at INTEGER);
        """)
        db.execute("INSERT OR IGNORE INTO policies VALUES ('honest-v1',?,'[]',?)", (
            json.dumps({"currency": "RUB", "effort_credit_default": True,
                        "ai_changes_credit": False, "kind": "accounting_not_equity"}), int(time.time())))
