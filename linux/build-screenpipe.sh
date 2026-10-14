#!/bin/bash
# Slow native dependency build: expected600s, emergency6000s; cargo jobs <=4.
set -euo pipefail
cd "$(dirname "$0")/.."
CACHE=${VKLAD_BUILD_CACHE:-"$PWD/.tmp/ubuntu-client"}
PIN=737416b73938fb4d1857cd019363ecf5707a8653
mkdir -p "$CACHE/cargo-home" "$CACHE/target" "$CACHE/tmp"
if [[ ! -f "$CACHE/screenpipe-source.tar.gz" ]]; then curl -fLsS --max-time 120 "https://github.com/megamen32/screenpipe/archive/$PIN.tar.gz" -o "$CACHE/screenpipe-source.tar.gz"; fi
if [[ ! -d "$CACHE/screenpipe-$PIN" ]]; then tar -xzf "$CACHE/screenpipe-source.tar.gz" --exclude='*/ee/*' -C "$CACHE"; fi
python3 - "$CACHE/screenpipe-$PIN" <<'PY'
from pathlib import Path
import hashlib,json,sys
p=Path(sys.argv[1]);pin=json.loads(Path('linux/screenpipe-source.json').read_text())
assert hashlib.sha256((p/'vklad/src/main.rs').read_bytes()).hexdigest()==pin['main_sha256']
assert hashlib.sha256((p/'vklad/Cargo.lock').read_bytes()).hexdigest()==pin['lock_sha256']
assert (p/'LICENSE.md').read_text().startswith('MIT License')
print('Exact pinned MIT source and lock verified')
PY
export PKG_CONFIG_PATH=$(python3 linux/prepare-sdk.py "$CACHE")
export CARGO_HOME="$CACHE/cargo-home" CARGO_TARGET_DIR="$CACHE/target" TMPDIR="$CACHE/tmp" CARGO_BUILD_JOBS=4
python3 linux/bounded-command.py --cache "$CACHE" --seconds 6000 -- cargo build --release --locked -j4 --manifest-path "$CACHE/screenpipe-$PIN/vklad/Cargo.toml"
# No ee/, source sessions or credentials are copied to the package.
ldd "$CACHE/target/release/screenpipe-vklad"
echo "$CACHE/target/release/screenpipe-vklad"
