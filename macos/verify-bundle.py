"""Verify the installed/built bundle without capturing a user's screen."""
import hashlib
import json
from pathlib import Path
import os
import subprocess
import sys
import tempfile

app = Path(sys.argv[1]).resolve()
helper = app / 'Contents/MacOS/screenpipe-vklad'
main = app / 'Contents/MacOS/Vklad'
pin = json.loads((app / 'Contents/Resources/Screenpipe/source.json').read_text())
build = json.loads((app / 'Contents/Resources/Screenpipe/build.json').read_text())
for key, value in pin.items():
    assert build[key] == value, key
assert hashlib.sha256(helper.read_bytes()).hexdigest() == build['packaged_binary_sha256']
subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
for binary in (main, helper):
    subprocess.run(['lipo', str(binary), '-verify_arch', 'arm64'], check=True)
    linked = subprocess.check_output(['otool', '-L', str(binary)], text=True).splitlines()[1:]
    assert all(line.strip().startswith(('/System/Library/', '/usr/lib/')) for line in linked)
subprocess.run([str(main), '--self-test'], check=True)
check = json.loads(subprocess.check_output([str(helper), 'check'], text=True))
assert check['engine'] == 'screenpipe' and not check['recording']
assert not check['http_listener'] and not check['audio']
assert json.loads(subprocess.check_output([str(main), '--capture-check'], text=True))['bundled_screenpipe']
# Refuse accidental capture during validation. Exercise only the denied-permission path.
permission_test = 'not_run_permission_already_granted'
if not check['screen_recording_allowed']:
    with tempfile.TemporaryDirectory(prefix='vklad-permission-test-') as temp:
        directory = Path(temp) / 'must-not-record'
        result = subprocess.run([str(helper), 'record', '--data-dir', str(directory), '--parent-pid', str(os.getpid())],
                                input='', text=True, capture_output=True, timeout=15)
        assert result.returncode != 0 and 'permission' in result.stdout.lower()
        assert not directory.exists(), 'Permission denial created recording data'
        permission_test = 'passed_no_capture_or_data'
print(json.dumps({'bundle_verified': True, 'screenpipe_inside': True, 'source_ref': pin['source_ref'],
                  'system_libraries_only': True, 'permission_denial': permission_test,
                  'real_screen_capture_tested': False}, indent=2))
