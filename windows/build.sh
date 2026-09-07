#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export GOOS=windows GOARCH=amd64 CGO_ENABLED=0
go mod verify
go vet ./...
mkdir -p ../dist/windows
go build -trimpath -ldflags='-s -w -H windowsgui' -o ../dist/windows/Vklad-Windows-x64-v0.2.0.exe .
python3 - <<'PY'
from pathlib import Path
import zipfile
out=Path('../dist/windows')
with zipfile.ZipFile(out/'Vklad-Windows-x64-v0.2.0.zip','w',zipfile.ZIP_DEFLATED) as z:
    z.write(out/'Vklad-Windows-x64-v0.2.0.exe','Vklad-Windows-x64-v0.2.0.exe')
    z.write('README.md','README.txt')
    for f in Path('licenses').iterdir(): z.write(f,str(f))
PY
