import sqlite3
from contextlib import closing

import pytest

from contribution_spec.backup import create_backup, safe_relative, verify_backup


def test_database_and_evidence_restore(database,tmp_path):
    archive=tmp_path/"archive"; archive.mkdir(); (archive/"pinned.txt").write_text("Important evidence")
    dest=tmp_path/"backup"
    create_backup(database,archive,dest,["pinned.txt"])
    verify_backup(dest)
    assert (dest/"COMPLETE").exists()
    with closing(sqlite3.connect(dest/"ledger.sqlite3")) as restored:
        assert restored.execute("SELECT COUNT(*) FROM members").fetchone()[0]==2
    assert (dest/"evidence/pinned.txt").read_text()=="Important evidence"


def test_corrupt_backup_detected(database,tmp_path):
    archive=tmp_path/"archive"; archive.mkdir(); (archive/"pinned.txt").write_text("Important evidence")
    dest=tmp_path/"backup"; create_backup(database,archive,dest,["pinned.txt"])
    (dest/"evidence/pinned.txt").write_text("Corrupted")
    with pytest.raises(ValueError):
        verify_backup(dest)


def test_missing_evidence_not_marked_complete(database,tmp_path):
    archive=tmp_path/"archive"; archive.mkdir(); dest=tmp_path/"backup"
    with pytest.raises(FileNotFoundError):
        create_backup(database,archive,dest,["missing"])
    assert not (dest/"COMPLETE").exists()


def test_no_overwrite_existing_backup(database,tmp_path):
    dest=tmp_path/"backup"; dest.mkdir()
    with pytest.raises(FileExistsError):
        create_backup(database,tmp_path,dest,[])


@pytest.mark.parametrize("relative", ["../escape", "/etc/passwd", "."])
def test_archive_path_escape_rejected(tmp_path,relative):
    with pytest.raises(ValueError):
        safe_relative(tmp_path,relative)
