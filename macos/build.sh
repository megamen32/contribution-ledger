#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] || { echo 'Build on an Apple Silicon Mac.' >&2; exit 1; }
ROOT="$PWD"
OUT="$ROOT/dist/macos"
APP="$OUT/Vklad.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
xcrun swiftc -swift-version 5 -parse-as-library -O -target arm64-apple-macos13.0 \
    -framework AppKit -framework WebKit -framework UniformTypeIdentifiers \
    macos/Vklad.swift -o "$APP/Contents/MacOS/Vklad"
cp macos/Info.plist "$APP/Contents/Info.plist"
printf 'APPL????' > "$APP/Contents/PkgInfo"
plutil -lint "$APP/Contents/Info.plist"
codesign --force --sign - --timestamp=none --options runtime "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"
"$APP/Contents/MacOS/Vklad" --self-test
file "$APP/Contents/MacOS/Vklad"
STAGE="$(mktemp -d "$OUT/dmg-stage.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
cp macos/README.md "$STAGE/Прочитайте перед запуском.txt"
hdiutil create -ov -volname 'Вклад Apple Silicon' -srcfolder "$STAGE" -format UDZO "$OUT/Vklad-macOS-arm64-v0.2.0.dmg"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$OUT/Vklad-macOS-arm64-v0.2.0.zip"
(cd "$OUT" && shasum -a 256 Vklad-macOS-arm64-v0.2.0.dmg Vklad-macOS-arm64-v0.2.0.zip > SHA256SUMS)
echo "Built $APP"
