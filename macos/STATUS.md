# Native macOS delivery · 2026-09-07

Client version: 0.1.1. Existing server remains 0.1.0; this change does not replace it.

## Verified on the user's actual Mac

- Apple M1 Max, arm64; macOS 26.6 (25G5052e); Swift 6.3.3.
- Compiled from macos/Vklad.swift using system AppKit/WebKit only.
- Mach-O 64-bit arm64. No Rosetta, Python, Node or Electron runtime bundled.
- 21 URL/origin assertions passed in the release binary.
- Info.plist validated. Ad-hoc code signature passed codesign --verify --deep --strict.
- DMG checksum validated with hdiutil verify.
- DMG mounted read-only; the bundled app copied to /Applications/Vklad.app.
- Installed executable SHA-256 matches the tested build:
  4032e71af4c6e0ebc60cb8b3de2c406a823d65812a5352d97400a7cc5bd13364.
- Both pre-install and installed real WebKit smoke checks passed against the live server.
  Checked: login form, work form, JSON-import input and explicit no-screen-recording disclaimer.
- Native WebKit snapshot saved for each smoke test. Production mutations: zero.
- Normal app opened with LaunchServices after installation; process confirmed running.
- DMG and ZIP copied into the user's Downloads folder.
- Existing service still returns {status:ok, version:0.1.0}.

## Not claimed / not verified

- No Developer ID certificate found: not notarized; Gatekeeper was NOT disabled.
- No live authenticated monetary mutations from this Mac client during these read-only checks.
- No automated capture, Screenpipe Start/Stop, local recording, offline queue, or Screenpipe license bundled.
- No live OmniRoute completions verified in this delivery; previous missing API authorization remains separate.
- Deployment target is macOS 13, but only the actual macOS 26.6 host was exercised.
- The user-uploaded Next.js archive was inspected, not substituted for the server.
  Its model-family persona simulation and demo database were not deployed.

## Release artifacts

Vklad-macOS-arm64-v0.1.1.dmg
SHA-256: 5e5271ea354d5e49aec68406ba92615bbfce093d0225d969568b974e8c3250e2

Vklad-macOS-arm64-v0.1.1.zip
SHA-256: 41a758dfe809c6465399b103f0d0948bafd53e3f457c36fa4b27451325f210b0

## Reproducible verification

bash macos/build.sh
/Applications/Vklad.app/Contents/MacOS/Vklad --self-test
/Applications/Vklad.app/Contents/MacOS/Vklad --smoke-dir "$HOME/Library/Caches/contribution-ledger/verification"

The smoke test renders the real page using an ephemeral cookie store. It does not assume a successful HTTP response proves recording or model execution.
