import os
import stat
import sys

from contribution.__main__ import main


def test_init_creates_private_key_and_preserves_it(tmp_path, monkeypatch):
    root = tmp_path / "private"
    monkeypatch.setattr(sys, "argv", ["contribution", "init", "--data", str(root)])
    main()
    key = root / "team.key"
    original = key.read_text()
    assert len(original) >= 24
    if os.name != "nt":
        assert stat.S_IMODE(key.stat().st_mode) == 0o600
    main()
    assert key.read_text() == original
