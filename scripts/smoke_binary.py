"""Real binary + browser smoke. Synthetic records stay in a separate private directory."""
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BINARY = ROOT / 'dist/contribution'
BROWSER = os.environ.get('AGENT_BROWSER_BIN', '/home/roomhacker/.npm-global/bin/agent-browser')
EVIDENCE = Path(os.environ.get('SMOKE_EVIDENCE_DIR', str(Path.home() / '.cache/contribution-build/smoke')))
EVIDENCE.mkdir(parents=True, exist_ok=True)
DATA = Path(tempfile.mkdtemp(prefix='contribution-smoke-', dir=EVIDENCE))
subprocess.run([str(BINARY), 'init', '--data', str(DATA)], check=True, capture_output=True)
KEY = (DATA / 'team.key').read_text().strip()
with socket.socket() as probe:
    probe.bind(('127.0.0.1', 0))
    PORT = probe.getsockname()[1]
URL = f'http://127.0.0.1:{PORT}'
env = dict(os.environ, CONTRIBUTION_HOST='127.0.0.1', CONTRIBUTION_PORT=str(PORT), CONTRIBUTION_DATA=str(DATA))
env.pop('OMNIROUTE_API_KEY_FILE', None)
browser_env = dict(os.environ, AGENT_BROWSER_SESSION='contribution-smoke-' + str(os.getpid()))
checks = []
server = None
log = (EVIDENCE / 'server.log').open('w')

def request(path, body=None, authenticated=True):
    headers = {'Authorization': 'Bearer ' + KEY} if authenticated else {}
    if body is not None:
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(URL + path, data=None if body is None else json.dumps(body).encode(), headers=headers)
    with urllib.request.urlopen(req, timeout=10) as response:
        return json.load(response)

def start():
    global server
    server = subprocess.Popen([str(BINARY), 'serve', '--data', str(DATA)], env=env, stdout=log, stderr=log)
    for _ in range(100):
        if server.poll() is not None:
            raise RuntimeError('Native server exited; inspect server.log')
        try:
            if request('/health', authenticated=False)['status'] == 'ok':
                return
        except (urllib.error.URLError, ConnectionError):
            time.sleep(.15)
    raise RuntimeError('Health readiness failed')

def browser(*args):
    result = subprocess.run([BROWSER, *args], env=browser_env, capture_output=True, text=True, timeout=35)
    if result.returncode:
        subprocess.run([BROWSER, 'screenshot', str(EVIDENCE / 'failure.png')], env=browser_env, capture_output=True, timeout=20)
        raise RuntimeError('Browser command failed: ' + args[0] + ': ' + result.stderr[:500])
    return result.stdout

def wait_js(condition):
    return browser('wait', '--fn', condition)

try:
    start()
    assert request('/api/state')['members'] == []
    try:
        request('/api/state', authenticated=False)
        raise AssertionError('Unauthenticated access accepted')
    except urllib.error.HTTPError as error:
        assert error.code == 401
    checks.append('native health, empty database and authentication')
    browser('open', URL)
    browser('snapshot', '-i')
    browser('fill', '#key', KEY)
    browser('click', '#login-form button')
    wait_js("!document.querySelector('#app').hidden")
    browser('click', 'details summary')
    browser('fill', '#name', 'CanaryAlice')
    browser('fill', '#rate', '1000')
    browser('click', '#member-form button')
    wait_js("document.querySelector('#count').textContent === '1'")
    checks.append('browser login and member creation')
    browser('fill', '#title', 'Canary research')
    browser('fill', '#minutes', '90')
    browser('fill', '#notes', 'Reviewed two approaches. First rejected, second documented. Synthetic smoke only.')
    browser('click', '#work-form button:not([type])')
    wait_js("document.querySelectorAll('#work-list tr').length === 1")
    browser('fill', '#amount', '2000')
    browser('fill', '#reason', 'Synthetic equipment contribution')
    browser('click', '#money-form button')
    wait_js("document.querySelectorAll('#ledger tr').length === 2")
    assert request('/api/state')['total_minor'] == 350000
    checks.append('browser work at agreed rate plus cash = 3500 RUB')
    browser('fill', '#title', 'Canary result opt-out')
    browser('fill', '#minutes', '5')
    browser('uncheck', '#effort')
    browser('fill', '#result', '700')
    browser('click', '#work-form button:not([type])')
    wait_js("document.querySelectorAll('#work-list tr').length === 2")
    assert request('/api/state')['total_minor'] == 420000
    checks.append('browser opt-out credits explicit result, no double count')
    browser('click', '#work-list tr:first-child button')
    browser('click', '#evaluate-btn')
    wait_js("!document.querySelector('#packet-review').hidden")
    packet = browser('get', 'value', '#packet')
    assert 'CanaryAlice' not in packet
    checks.append('browser renders reviewable anonymized packet')
    browser('check', '#effort')
    browser('fill', '#title', 'Canary pending timer')
    browser('click', '#timer-start')
    wait_js("!document.querySelector('#timer-stop').hidden")
    browser('click', '#timer-stop')
    wait_js("document.querySelector('#timerbar').textContent.includes('остановлен')")
    before = request('/api/state')
    assert len(before['timers']) == 1 and before['timers'][0]['stopped_at']
    checks.append('browser Stop persists a draft, not an automatic payment')
    browser('screenshot', str(EVIDENCE / 'ledger-desktop.png'))
    server.terminate()
    server.wait(timeout=10)
    start()
    after = request('/api/state')
    assert after['total_minor'] == before['total_minor']
    assert after['timers'] == before['timers']
    browser('reload')
    wait_js("!document.querySelector('#app').hidden")
    wait_js("document.querySelector('#timerbar').textContent.includes('остановлен')")
    checks.append('native restart preserves cash, work, stopped draft and login')
    browser('screenshot', str(EVIDENCE / 'after-restart.png'))
    report = {'status': 'passed', 'checks': checks, 'binary': str(BINARY), 'screenpipe_live': False, 'omniroute_live': False}
    (EVIDENCE / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps(report, ensure_ascii=False, indent=2))
except Exception:
    try:
        browser('screenshot', str(EVIDENCE / 'failure.png'))
    except Exception:
        pass
    raise
finally:
    subprocess.run([BROWSER, 'close'], env=browser_env, capture_output=True, timeout=20)
    if server and server.poll() is None:
        server.terminate()
        server.wait(timeout=10)
    log.close()
