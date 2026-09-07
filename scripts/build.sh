#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
uv sync --all-groups "${@}"
uv run pytest -q
uv run pyinstaller --noconfirm --clean --onefile --name contribution \
  --paths src --add-data src/contribution/index.html:contribution \
  --add-data src/contribution/core.sql:contribution --collect-submodules uvicorn scripts/entry.py
./dist/contribution --help
