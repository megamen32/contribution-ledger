"""Minimal reference backup for DB + explicitly selected immutable evidence files.
The caller must hold the application's publication/retention maintenance barrier.
This file does not implement that distributed/application barrier.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import sqlite3
from contextlib import closing
from pathlib import Path


def file_sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def safe_relative(root: Path, relative: str) -> Path:
    if Path(relative).is_absolute():
        raise ValueError("absolute path")
    candidate = (root / relative).resolve()
    if not candidate.is_relative_to(root.resolve()) or candidate == root.resolve():
        raise ValueError("path escapes root")
    return candidate


def create_backup(db: sqlite3.Connection, archive: Path, destination: Path, required: list[str]):
    """Copies, validates and marks complete. Existing destinations are never overwritten."""
    destination.mkdir(parents=True, exist_ok=False)
    target_db = destination / "ledger.sqlite3"
    with closing(sqlite3.connect(target_db)) as target:
        db.backup(target)
        if target.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("database backup integrity failure")
    entries = [{"path": "ledger.sqlite3", "sha256": file_sha(target_db)}]
    for relative in sorted(set(required)):
        source = safe_relative(archive, relative)
        if not source.is_file():
            raise FileNotFoundError(relative)
        target = safe_relative(destination / "evidence", relative)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        if file_sha(source) != file_sha(target):
            raise ValueError("evidence copy changed")
        entries.append({"path": "evidence/" + relative, "sha256": file_sha(target)})
    (destination / "manifest.json").write_text(json.dumps({"files": entries}, indent=2))
    verify_backup(destination)
    (destination / "COMPLETE").write_text("reference manifest verified\n")


def verify_backup(destination: Path):
    manifest = json.loads((destination / "manifest.json").read_text())
    for item in manifest["files"]:
        path = safe_relative(destination, item["path"])
        if file_sha(path) != item["sha256"]:
            raise ValueError("backup checksum mismatch")
