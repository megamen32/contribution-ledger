#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] || { echo 'Build on an Apple Silicon Mac.' >&2; exit 1; }
ROOT="$PWD"
OUT="$ROOT/dist/macos"
APP="$OUT/Vklad.app"
BUNDLE="${SCREENPIPE_BUNDLE_DIR:?Build the pinned Screenpipe fork first and set SCREENPIPE_BUNDLE_DIR to its vklad/bundle directory}"
VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' macos/Info.plist)
BUNDLE="$BUNDLE" python3 - <<'PY'
import hashlib, json, os
from pathlib import Path
pin=json.loads(Path('macos/screenpipe-source.json').read_text())
b=Path(os.environ['BUNDLE']); built=json.loads((b/'build.json').read_text())
for field in pin:
    assert built[field]==pin[field], 'Screenpipe provenance mismatch: '+field
actual=hashlib.sha256((b/'screenpipe-vklad').read_bytes()).hexdigest()
# Icon-only releases may reuse an already verified ad-hoc-signed helper.
assert actual in {built['binary_sha256'], built.get('packaged_binary_sha256')}, 'Screenpipe binary checksum mismatch'
assert (b/'LICENSE.md').read_text().startswith('MIT License')
assert (b/'THIRD_PARTY_NOTICES.txt').stat().st_size>100
assert (b/'ThirdPartySource').is_dir()
print('Pinned MIT Screenpipe bundle verified')
PY
# Only build outputs are recreated. Never touch installed app or session data here.
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/Screenpipe"
cp "$BUNDLE/screenpipe-vklad" "$APP/Contents/MacOS/screenpipe-vklad"
cp "$BUNDLE/LICENSE.md" "$BUNDLE/THIRD_PARTY_NOTICES.txt" "$BUNDLE/VKLAD_FORK.md" "$BUNDLE/build.json" "$APP/Contents/Resources/Screenpipe/"
cp -R "$BUNDLE/ThirdPartySource" "$APP/Contents/Resources/Screenpipe/"
cp macos/screenpipe-source.json "$APP/Contents/Resources/Screenpipe/source.json"
xcrun swiftc -swift-version 5 -parse-as-library -O -target arm64-apple-macos13.0 \
    -framework AppKit -framework WebKit -framework UniformTypeIdentifiers -framework CoreGraphics \
    macos/Vklad.swift macos/ScreenpipeController.swift -o "$APP/Contents/MacOS/Vklad"
cp macos/Info.plist "$APP/Contents/Info.plist"
cp assets/Vklad.icns "$APP/Contents/Resources/Vklad.icns"
printf 'APPL????' > "$APP/Contents/PkgInfo"
plutil -lint "$APP/Contents/Info.plist"
for binary in "$APP/Contents/MacOS/Vklad" "$APP/Contents/MacOS/screenpipe-vklad"; do lipo "$binary" -verify_arch arm64; done
codesign --force --sign - --timestamp=none --options runtime "$APP/Contents/MacOS/screenpipe-vklad"
# Ad-hoc signing changes Mach-O bytes; retain both build and packaged checksums.
APP="$APP" python3 - <<'PY'
import hashlib, json, os
from pathlib import Path
app=Path(os.environ['APP']); f=app/'Contents/Resources/Screenpipe/build.json'
data=json.loads(f.read_text()); data['packaged_binary_sha256']=hashlib.sha256((app/'Contents/MacOS/screenpipe-vklad').read_bytes()).hexdigest()
f.write_text(json.dumps(data,indent=2)+'\n')
PY
codesign --force --sign - --timestamp=none --options runtime "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"
"$APP/Contents/MacOS/Vklad" --self-test
"$APP/Contents/MacOS/Vklad" --capture-check
"$APP/Contents/MacOS/screenpipe-vklad" check
file "$APP/Contents/MacOS/Vklad" "$APP/Contents/MacOS/screenpipe-vklad"
STAGE="$(mktemp -d "$OUT/dmg-stage.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
cp macos/README.md "$STAGE/Прочитайте перед запуском.txt"
NAME="Vklad-macOS-arm64-v$VERSION"
hdiutil create -ov -volname 'Вклад Apple Silicon' -srcfolder "$STAGE" -format UDZO "$OUT/$NAME.dmg"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$OUT/$NAME.zip"
(cd "$OUT" && shasum -a 256 "$NAME.dmg" "$NAME.zip" > SHA256SUMS)
echo "Built $APP with Screenpipe inside"
