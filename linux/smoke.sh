#!/bin/bash
# Focused native integration: expected60s, emergency600s. Own private X11 desktop only.
set -euo pipefail
PACKAGE=${1:?Pass packaged client directory containing vklad.py, vklad.png and screenpipe-vklad}
EVIDENCE=${2:?Pass an absolute directory for native evidence}
mkdir -p "$EVIDENCE/config" "$EVIDENCE/cache" "$EVIDENCE/records"
chmod 700 "$EVIDENCE"
PACKAGE=$(realpath "$PACKAGE")
EVIDENCE=$(realpath "$EVIDENCE")
export VKLAD_ISOLATED_DESKTOP=1
export XDG_CONFIG_HOME="$EVIDENCE/config"
export XDG_CACHE_HOME="$EVIDENCE/cache"
export XDG_DATA_HOME="$EVIDENCE/desktop-data"
mkdir -p "$XDG_DATA_HOME"
# Xvfb's -a and private cookie avoid other desktops; dbus-run-session owns this desktop bus.
FIXTURE="$(cd "$(dirname "$0")" && pwd)/capture-fixture.py"
timeout 600s xvfb-run -a -s '-screen 0 1280x900x24 -nolisten tcp' dbus-run-session -- bash -c '
  /usr/bin/python3 "$1" &
  fixture_pid=$!
  trap "kill $fixture_pid 2>/dev/null || true" EXIT
  export VKLAD_SMOKE_FIXTURE_PID=$fixture_pid
  /usr/bin/python3 "$2/vklad.py" --helper "$2/screenpipe-vklad" --data-dir "$3/records" --smoke "$3" "${@:4}"
' bash "$FIXTURE" "$PACKAGE" "$EVIDENCE" ${VKLAD_TEST_SERVER:+--server "$VKLAD_TEST_SERVER"}
/usr/bin/python3 - "$EVIDENCE" <<'PY'
import json,sys
from pathlib import Path
p=Path(sys.argv[1]);r=json.loads((p/'result.json').read_text())
assert r['passed'] and r['loaded'] and r['child_exited'] and r['ocr_marker']
assert r['frames']>=1 and r['state']=='stopped' and r['frames_after_stop']==0
print(json.dumps(r,ensure_ascii=False))
PY
