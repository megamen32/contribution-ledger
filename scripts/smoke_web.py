"""HTTP acceptance test against an isolated local database, never the production ledger."""
import json
import os
from pathlib import Path
import subprocess
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import uuid

root = Path(__file__).resolve().parents[1]
data = root / '.tmp/deploy/test.db'
assert data.is_file() and 'test' in data.name
base = 'http://localhost:8769'
env = dict(os.environ, DATABASE_URL='file:' + str(data), PORT='8769', HOSTNAME='127.0.0.1', NODE_ENV='production', PUBLIC_ORIGIN=base)
log = (root / '.tmp/deploy/http-test.log').open('w')
process = subprocess.Popen(['/usr/local/bin/node', 'server.js'], cwd=root/'web/.next/standalone', env=env, stdout=log, stderr=log)
cookie = ''
def request(path, body=None, origin=base):
    headers = {'Content-Type': 'application/json', 'Origin': origin}
    if cookie: headers['Cookie'] = cookie
    req = Request(base+path, data=json.dumps(body).encode() if body is not None else None, headers=headers)
    with urlopen(req, timeout=20) as response: return json.load(response)
try:
    for _ in range(40):
        try: request('/api/health'); break
        except URLError: time.sleep(.25)
    else: raise RuntimeError('Test server failed to start')
    user = request('/api/users', {'displayName':'Release test '+uuid.uuid4().hex[:6]})['user']
    cookie = 'vklad_uid='+user['id']
    request('/api/rate-cards', {'category':'all','ratePerHourMinor':100000})
    task = request('/api/tasks', {'title':'Synthetic 90-minute research','manualSeconds':5400})['task']
    body = {'kind':'cash_contribution','amountMinor':200000,'businessKey':uuid.uuid4().hex,'reason':'Synthetic test cash'}
    entry = request('/api/ledger', body)['entry']
    assert request('/api/ledger', body)['entry']['id'] == entry['id']
    def balance():
        return next(x for x in request('/api/team')['members'] if x['id']==user['id'])['contribution']
    assert balance() == 350000, balance()
    payout = request('/api/ledger', {'kind':'settlement','amountMinor':50000,'targetEntryId':entry['id'],'reason':'Synthetic payout'})['entry']
    assert balance() == 300000
    request('/api/ledger', {'kind':'reversal','amountMinor':50000,'targetEntryId':payout['id'],'reason':'Cancel synthetic payout'})
    assert balance() == 350000
    request('/api/rate-cards', {'category':'all','ratePerHourMinor':200000})
    assert balance() == 350000, 'A new rate rewrote posted work'
    request('/api/tasks', {'title':'Synthetic new half-hour','manualSeconds':1800})
    assert balance() == 450000, 'New work did not use latest rate'
    try: request('/api/ledger', body, origin='https://untrusted.invalid')
    except HTTPError as error: assert error.code == 403
    else: raise AssertionError('Cross-origin write was allowed')
    result = {'passed': True, 'database': 'isolated test.db', 'checks':['new participant','agreed rate','90 minutes = 1500 RUB','cash + work = 3500 RUB','retry does not double credit','payout and reversal','new rates preserve old entries','latest rate on new work','cross-origin write rejected']}
    (root/'.tmp/deploy/http-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
    print(json.dumps(result,ensure_ascii=False,indent=2))
finally:
    process.terminate()
    process.wait(timeout=15)
    log.close()
