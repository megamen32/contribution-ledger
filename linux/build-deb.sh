#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
ENGINE=${SCREENPIPE_LINUX_BINARY:?Set the pinned Linux Screenpipe binary}
[[ $(uname -m) == x86_64 ]] || { echo 'Build the amd64 package on x86_64 Linux'; exit 1; }
file "$ENGINE" | grep -q 'ELF 64-bit.*x86-64' || { echo 'Linux binary required'; exit 1; }
OUT="$PWD/dist/linux"
mkdir -p "$OUT"
STAGE=$(mktemp -d "$OUT/package.XXXXXX")
mkdir -p "$STAGE/DEBIAN" "$STAGE/usr/lib/vklad" "$STAGE/usr/bin" "$STAGE/usr/share/applications" "$STAGE/usr/share/icons/hicolor/256x256/apps" "$STAGE/usr/share/icons/hicolor/scalable/apps" "$STAGE/usr/share/doc/vklad"
cp linux/capture_report.py linux/report_dialog.py "$STAGE/usr/lib/vklad/"
cp linux/vklad.py "$STAGE/usr/lib/vklad/vklad.py"
cp "$ENGINE" "$STAGE/usr/lib/vklad/screenpipe-vklad"
cp assets/vklad-256.png "$STAGE/usr/lib/vklad/vklad.png"
cp assets/vklad-256.png "$STAGE/usr/share/icons/hicolor/256x256/apps/vklad.png"
cp assets/vklad.svg "$STAGE/usr/share/icons/hicolor/scalable/apps/vklad.svg"
cp linux/vklad.desktop "$STAGE/usr/share/applications/"
cp linux/launch.sh "$STAGE/usr/bin/vklad"
cp linux/README.md "$STAGE/usr/share/doc/vklad/README"
cp linux/screenpipe-source.json "$STAGE/usr/lib/vklad/source.json"
cp "${SCREENPIPE_LICENSE:?Set original MIT license}" "$STAGE/usr/share/doc/vklad/Screenpipe-LICENSE"
python3 linux/license-notices.py "${VKLAD_BUILD_CACHE:-$PWD/.tmp/ubuntu-client}" "$STAGE/usr/share/doc/vklad"
chmod 755 "$STAGE/usr/bin/vklad" "$STAGE/usr/lib/vklad/vklad.py" "$STAGE/usr/lib/vklad/screenpipe-vklad"
cat > "$STAGE/DEBIAN/control" <<'CONTROL'
Package: vklad
Version: 0.3.2
Architecture: amd64
Maintainer: Vklad <noreply@vklad.bezrabotnyi.com>
Depends: python3, python3-gi, gir1.2-gtk-3.0, gir1.2-webkit2-4.0, tesseract-ocr, tesseract-ocr-eng, tesseract-ocr-rus, libpipewire-0.3-0, libdbus-1-3, libx11-6, libxcb1, libxcb-randr0, libegl1, libgbm1, libwayland-client0, libwayland-server0, liblzma5
Section: utils
Priority: optional
Homepage: https://vklad.bezrabotnyi.com/
Description: Team contribution workspace with opt-in local Screenpipe capture
 Native GTK/WebKit cabinet and bundled MIT Screenpipe recorder.
CONTROL
python3 - "$STAGE" <<'PYCODE'
import sys
from pathlib import Path
root=Path(sys.argv[1]);root.chmod(0o755)
for p in root.rglob('*'):p.chmod(0o755 if p.is_dir() else 0o644)
for p in ['usr/bin/vklad','usr/lib/vklad/vklad.py','usr/lib/vklad/screenpipe-vklad']:(root/p).chmod(0o755)
PYCODE
# Build is independent of host usernames/owners; private files are never included.
dpkg-deb --root-owner-group --build "$STAGE" "$OUT/Vklad-Ubuntu-amd64-v0.3.2.deb"
(cd "$OUT" && sha256sum Vklad-Ubuntu-amd64-v0.3.2.deb > SHA256SUMS)
