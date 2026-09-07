from __future__ import annotations

import argparse
import os
import secrets
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="Contribution Ledger — private team installation")
    parser.add_argument("command", choices=["serve", "init", "worker", "screenpipe-export"], nargs="?", default="serve")
    parser.add_argument("--data", type=Path)
    parser.add_argument("--from", dest="start")
    parser.add_argument("--to", dest="end")
    parser.add_argument("--out", type=Path)
    parser.add_argument("--screenpipe-url", default="http://127.0.0.1:3030")
    parser.add_argument("--screenpipe-key-file", type=Path)
    args = parser.parse_args()
    if args.command == "screenpipe-export":
        if not all([args.start, args.end, args.out]):
            parser.error("screenpipe-export requires --from, --to and --out")
        from .screenpipe import export
        export(args.start, args.end, args.out, args.screenpipe_url, args.screenpipe_key_file)
        return
    if args.data:
        os.environ["CONTRIBUTION_DATA"] = str(args.data)
    if args.command == "init":
        root = (args.data or Path("~/.local/share/contribution-ledger")).expanduser()
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        key = root / "team.key"
        if not key.exists():
            with open(key, "x", opener=lambda p, f: os.open(p, f, 0o600)) as out:
                out.write(secrets.token_urlsafe(32))
        print(f"Team key file: {key}\nSet CONTRIBUTION_TOKEN_FILE={key}; keep it out of version control.")
        return
    from .config import Settings
    settings = Settings.from_env()
    if args.command == "worker":
        from .ai import worker
        worker(settings)
        return
    import uvicorn
    from .app import create_app
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port, access_log=False)


if __name__ == "__main__":
    main()
