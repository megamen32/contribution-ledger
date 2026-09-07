from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    token: str
    host: str = "127.0.0.1"
    port: int = 8766
    omniroute_url: str = "http://127.0.0.1:20128/v1"
    omniroute_key_file: Path | None = None
    summary_model: str = "minimax/MiniMax-M3"
    judge_models: tuple[str, ...] = ("glm-5.3", "gpt-6")
    judge_repeats: int = 3
    secure_cookie: bool = False

    @classmethod
    def from_env(cls):
        root = Path(os.environ.get("CONTRIBUTION_DATA", "~/.local/share/contribution-ledger")).expanduser()
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        token = os.environ.get("CONTRIBUTION_TOKEN", "")
        token_file = os.environ.get("CONTRIBUTION_TOKEN_FILE")
        if not token_file and not token and (root / "team.key").is_file():
            token_file = str(root / "team.key")
        if token_file:
            token = Path(token_file).expanduser().read_text().strip()
        if len(token) < 24:
            raise ValueError("Set CONTRIBUTION_TOKEN_FILE to a team key of at least 24 characters")
        key = os.environ.get("OMNIROUTE_API_KEY_FILE")
        judges = tuple(x.strip() for x in os.environ.get("JUDGE_MODELS", "glm-5.3,gpt-6").split(",") if x.strip())
        if len(set(judges)) != len(judges) or len(judges) < 2:
            raise ValueError("At least two distinct judge model IDs are required")
        return cls(root, token, os.environ.get("CONTRIBUTION_HOST", "127.0.0.1"),
                   int(os.environ.get("CONTRIBUTION_PORT", "8766")),
                   os.environ.get("OMNIROUTE_BASE_URL", "http://127.0.0.1:20128/v1").rstrip("/"),
                   Path(key).expanduser() if key else None,
                   os.environ.get("SUMMARY_MODEL", "minimax/MiniMax-M3"), judges, 3,
                   os.environ.get("CONTRIBUTION_HTTPS") == "1")
