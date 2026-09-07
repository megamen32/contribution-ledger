"""Transactional reference ledger/queue used by the contract tests; not an application service."""
from __future__ import annotations

import json
import sqlite3
import time
import uuid
from pathlib import Path

from .contracts import LedgerCommand
from .rules import canonical_bytes, digest


class Conflict(ValueError):
    pass


def connect(path: str | Path) -> sqlite3.Connection:
    db = sqlite3.connect(path, isolation_level=None, timeout=5)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    db.execute("PRAGMA journal_mode=DELETE")
    db.execute("PRAGMA synchronous=FULL")
    db.execute("PRAGMA busy_timeout=5000")
    return db


def initialize(db: sqlite3.Connection, schema_path: Path):
    db.executescript(schema_path.read_text())


def post_entry(db: sqlite3.Connection, command: LedgerCommand, *, now: int | None = None) -> dict:
    now = int(time.time()) if now is None else now
    request_hash = digest(command.model_dump())
    owns_transaction = not db.in_transaction
    if owns_transaction:
        db.execute("BEGIN IMMEDIATE")
    db.execute("SAVEPOINT ledger_post")
    try:
        old = db.execute("SELECT * FROM ledger_entries WHERE business_key=?", (command.business_key,)).fetchone()
        if old:
            if old["request_hash"] != request_hash:
                raise Conflict("same business key, different command")
            db.execute("RELEASE SAVEPOINT ledger_post")
            if owns_transaction:
                db.execute("COMMIT")
            return dict(old)
        signed = command.amount_minor
        if command.target_entry_id:
            target = db.execute("SELECT * FROM ledger_entries WHERE id=?", (command.target_entry_id,)).fetchone()
            if target is None:
                raise ValueError("target not found")
            if target["member_id"] != command.member_id or target["currency"] != command.currency:
                raise ValueError("target has a different member or currency")
            if db.execute("SELECT 1 FROM ledger_entries WHERE kind='reversal' AND target_entry_id=?", (target["id"],)).fetchone():
                raise Conflict("target already reversed")
            if command.kind == "settlement":
                if target["kind"] not in {"cash", "expense", "labor", "bonus"}:
                    raise ValueError("settlement requires an unreversed positive entry")
                paid = db.execute("""SELECT COALESCE(SUM(-s.amount_minor),0) FROM ledger_entries s
                    WHERE s.kind='settlement' AND s.target_entry_id=? AND NOT EXISTS
                    (SELECT 1 FROM ledger_entries r WHERE r.kind='reversal' AND r.target_entry_id=s.id)""", (target["id"],)).fetchone()[0]
                if command.amount_minor > target["amount_minor"] - paid:
                    raise ValueError("settlement exceeds outstanding amount")
                signed = -command.amount_minor
            else:
                if target["kind"] == "reversal":
                    raise ValueError("do not reverse a reversal; post a new explicitly sourced entry")
                if command.amount_minor != abs(target["amount_minor"]):
                    raise ValueError("a full reversal must match the original amount")
                outstanding_children = db.execute("""SELECT 1 FROM ledger_entries s
                    WHERE s.kind='settlement' AND s.target_entry_id=? AND NOT EXISTS
                    (SELECT 1 FROM ledger_entries r WHERE r.kind='reversal' AND r.target_entry_id=s.id)""", (target["id"],)).fetchone()
                if outstanding_children:
                    raise ValueError("reverse active settlements before correcting their parent")
                signed = -target["amount_minor"]
        entry_id = uuid.uuid4().hex
        db.execute("""INSERT INTO ledger_entries VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                   (entry_id, command.member_id, command.kind, signed, command.currency,
                    command.business_key, request_hash, command.source_id, command.policy_id,
                    command.target_entry_id, command.reason, now))
        result = dict(db.execute("SELECT * FROM ledger_entries WHERE id=?", (entry_id,)).fetchone())
        db.execute("RELEASE SAVEPOINT ledger_post")
        if owns_transaction:
            db.execute("COMMIT")
        return result
    except BaseException:
        if db.in_transaction:
            db.execute("ROLLBACK TO SAVEPOINT ledger_post")
            db.execute("RELEASE SAVEPOINT ledger_post")
            if owns_transaction:
                db.execute("ROLLBACK")
        raise


def enqueue(db: sqlite3.Connection, kind: str, key: str, payload: dict, *, now: int = 0) -> str:
    request_hash = digest({"kind": kind, "payload": payload})
    owns_transaction = not db.in_transaction
    if owns_transaction:
        db.execute("BEGIN IMMEDIATE")
    db.execute("SAVEPOINT enqueue_job")
    try:
        existing = db.execute("SELECT id,request_hash FROM jobs WHERE business_key=?", (key,)).fetchone()
        if existing:
            if existing["request_hash"] != request_hash:
                raise Conflict("job key reused with different input")
            db.execute("RELEASE SAVEPOINT enqueue_job")
            if owns_transaction:
                db.execute("COMMIT")
            return existing["id"]
        job_id = uuid.uuid4().hex
        db.execute("""INSERT INTO jobs(id,kind,business_key,payload_json,request_hash,state,available_at)
                   VALUES(?,?,?,?,?,'queued',?)""", (job_id, kind, key, canonical_bytes(payload).decode(), request_hash, now))
        db.execute("RELEASE SAVEPOINT enqueue_job")
        if owns_transaction:
            db.execute("COMMIT")
        return job_id
    except BaseException:
        if db.in_transaction:
            db.execute("ROLLBACK TO SAVEPOINT enqueue_job")
            db.execute("RELEASE SAVEPOINT enqueue_job")
            if owns_transaction:
                db.execute("ROLLBACK")
        raise


def claim_job(db: sqlite3.Connection, *, now: int, lease_seconds: int = 120) -> dict | None:
    db.execute("BEGIN IMMEDIATE")
    try:
        db.execute("""UPDATE jobs SET state='failed',last_error='attempt budget exhausted'
                   WHERE state='running' AND lease_until<=? AND attempt_count>=max_attempts""", (now,))
        row = db.execute("""SELECT * FROM jobs WHERE attempt_count<max_attempts AND
            ((state IN ('queued','retry_wait') AND available_at<=?) OR
             (state='running' AND lease_until<=?)) ORDER BY available_at,id LIMIT 1""", (now, now)).fetchone()
        if row is None:
            db.execute("COMMIT")
            return None
        db.execute("""UPDATE jobs SET state='running',attempt_count=attempt_count+1,
            lease_generation=lease_generation+1,lease_until=? WHERE id=?""", (now + lease_seconds, row["id"]))
        claimed = dict(db.execute("SELECT * FROM jobs WHERE id=?", (row["id"],)).fetchone())
        db.execute("COMMIT")
        return claimed
    except BaseException:
        if db.in_transaction:
            db.execute("ROLLBACK")
        raise


def heartbeat(db: sqlite3.Connection, job_id: str, generation: int, *, now: int, lease_seconds: int = 120) -> bool:
    cur = db.execute("""UPDATE jobs SET lease_until=? WHERE id=? AND state='running'
        AND lease_generation=? AND lease_until>?""", (now + lease_seconds, job_id, generation, now))
    return cur.rowcount == 1


def finish_job(db: sqlite3.Connection, job_id: str, generation: int, result: dict, *, now: int) -> bool:
    cur = db.execute("""UPDATE jobs SET state='done',result_json=?,lease_until=NULL
        WHERE id=? AND state='running' AND lease_generation=? AND lease_until>?""",
        (json.dumps(result), job_id, generation, now))
    return cur.rowcount == 1
