#!/bin/bash
# Focused integration: expected180s, emergency1800s, own isolated desktop only.
set -euo pipefail
PACKAGE=$(realpath "${1:?packaged client directory}")
EVIDENCE=$(realpath -m "${2:?absolute evidence directory}")
ROOT=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$EVIDENCE/config" "$EVIDENCE/cache" "$EVIDENCE/records"
chmod 700 "$EVIDENCE"
export VKLAD_ISOLATED_DESKTOP=1 VKLAD_JOURNEY_EVIDENCE="$EVIDENCE" VKLAD_JOURNEY_ARTICLE="$ROOT/docs/research/contribution-based-equity.md"
export XDG_CONFIG_HOME="$EVIDENCE/config" XDG_CACHE_HOME="$EVIDENCE/cache" PYTHONPATH="$ROOT/linux"
export XDG_DATA_HOME="$EVIDENCE/desktop-data"
mkdir -p "$XDG_DATA_HOME"
timeout 1800s xvfb-run -a -s '-screen 0 1280x900x24 -nolisten tcp' dbus-run-session -- bash -c '
 /usr/bin/python3 "$1/linux/research-workspace.py" &
 workspace_pid=$!
 trap "kill $workspace_pid 2>/dev/null || true" EXIT
 export VKLAD_JOURNEY_WORKSPACE_PID=$workspace_pid
 /usr/bin/python3 "$2/vklad.py" --helper "$2/screenpipe-vklad" --data-dir "$3/records" --journey "$3"
' bash "$ROOT" "$PACKAGE" "$EVIDENCE"
/usr/bin/python3 - "$EVIDENCE/journey-result.json" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]));assert r['passed'] and r['child_exited'] and r['state']=='stopped' and r['frames_after_stop']==0
print(json.dumps({k:v for k,v in r.items() if k not in ('summary','assessment')},ensure_ascii=False))
PY
