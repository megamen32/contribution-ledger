import json
from dataclasses import replace

import httpx
import pytest
from fastapi.testclient import TestClient

from contribution.ai import OmniRoute, ProviderError, SummaryDraft, run_once
from contribution.app import create_app
from contribution.config import Settings
from contribution.db import database
from contribution.screenpipe import collect
from contribution_spec.contracts import JudgeAnswer
from contribution_spec.rules import aggregate_samples


@pytest.fixture
def c(tmp_path):
    settings = Settings(tmp_path, 'x' * 32)
    client = TestClient(create_app(settings), headers={'Authorization': 'Bearer ' + settings.token})
    client.settings = settings
    member = client.post('/api/members', json={'name': 'PrivatePerson', 'hourly_minor': 100000}).json()['id']
    client.post('/api/work', json={'id': 'w1', 'member_id': member, 'title': 'Исследовать API',
        'work_date': '2026-09-07', 'seconds': 3600, 'notes': 'PrivatePerson проверил API. a@example.com /home/PrivatePerson/test'})
    return client


class FakeProvider:
    """Synthetic provider; never a claim about model quality or real connectivity."""
    def __init__(self, fail_at=None):
        self.calls = []
        self.fail_at = fail_at

    def complete(self, model, instruction, data, schema):
        self.calls.append((model, data))
        if len(self.calls) == self.fail_at:
            raise ProviderError('synthetic interruption')
        meta = {'requested_model': model, 'response_model': model, 'request_id': str(len(self.calls))}
        if schema is SummaryDraft:
            return SummaryDraft(goal='Проверка API', actions=[], result={
                'text': 'Проверены ограничения API', 'basis': 'participant_statement', 'evidence_ids': ['statement']},
                result_status='negative_research', limitations=[]), meta
        return JudgeAnswer(packet_id=data['packet_id'], assessment='assessable', category='research',
            grade='middle', complexity=2, typical_duration={'low_seconds': 1800, 'high_seconds': 7200},
            price_status='no_price_data', rate_id=None, evidence_ids=[data['evidence'][0]['evidence_id']],
            limitations=['Synthetic provider, no quality conclusion'], missing_information=[], rationale='Synthetic only'), meta


def queue_council(c, ident='r1'):
    packet = c.get('/api/work/w1/packet').json()
    return c.post('/api/work/w1/evaluate', json={'id': ident, 'reviewed': True, 'packet': packet})


def test_summary_durable_queue_and_sources(c):
    r = c.post('/api/work/w1/summary', json={'id': 's1'})
    assert r.status_code == 202
    assert c.post('/api/work/w1/summary', json={'id': 's1'}).json() == r.json()
    fake = FakeProvider()
    assert run_once(c.settings, fake)
    state = c.get('/api/work/w1/ai').json()
    assert state['jobs'][0]['state'] == 'done'
    assert state['jobs'][0]['result']['report']['result_status'] == 'negative_research'
    assert fake.calls[0][0] == 'minimax/MiniMax-M3'
    assert c.get('/api/state').json()['total_minor'] == 100000


def test_packet_projection_and_review(c):
    p = c.get('/api/work/w1/packet').json()
    text = json.dumps(p)
    assert 'PrivatePerson' not in text and 'a@example.com' not in text
    assert 'hourly_minor' not in text and 'author_id' not in text and 'work_date' not in text
    assert p['rates'] == []
    assert c.post('/api/work/w1/evaluate', json={'id': 'r1', 'reviewed': False, 'packet': p}).status_code == 422
    p['outcome'] = 'PrivatePerson did it'
    assert c.post('/api/work/w1/evaluate', json={'id': 'r1', 'reviewed': True, 'packet': p}).status_code == 422


def test_six_slots_and_no_money_change(c):
    assert queue_council(c).json()['required_slots'] == 6
    fake = FakeProvider()
    assert run_once(c.settings, fake)
    assert len(fake.calls) == 6
    assert [m for m, _ in fake.calls] == ['glm-5.3'] * 3 + ['gpt-6'] * 3
    result = c.get('/api/work/w1/ai').json()['jobs'][0]['result']
    assert result['collection_status'] == 'complete'
    assert result['price_status'] == 'unknown' and result['low_minor'] is None
    assert c.get('/api/state').json()['total_minor'] == 100000
    export = c.get('/api/rounds/r1/export').json()
    assert len(export['slots']) == 6 and 'work_id' not in export
    assert 'author_id' not in json.dumps(export)


def test_interrupted_council_resumes_only_missing_slots(c):
    queue_council(c)
    fake = FakeProvider(fail_at=3)
    run_once(c.settings, fake)
    state = c.get('/api/work/w1/ai').json()
    assert state['rounds'][0]['slots_completed'] == 2
    with database(c.settings.data_dir) as db:
        db.execute('UPDATE jobs SET available_at=0')
    fake2 = FakeProvider()
    run_once(c.settings, fake2)
    assert len(fake2.calls) == 4
    assert c.get('/api/work/w1/ai').json()['jobs'][0]['state'] == 'done'


def test_missing_provider_key_is_visible_not_free_fallback(c):
    c.post('/api/work/w1/summary', json={'id': 's1'})
    run_once(c.settings)
    row = c.get('/api/work/w1/ai').json()['jobs'][0]
    assert row['state'] == 'retry_wait'
    assert 'OMNIROUTE_API_KEY_FILE' in row['last_error']
    assert c.get('/api/state').json()['total_minor'] == 100000


def test_evidence_import_review_idempotency_and_immutability(c):
    e = {'evidence_id': 'sp-1', 'artifact_id': 'frame-1', 'locator': 'screenpipe frame 1',
         'kind': 'artifact_excerpt', 'text': 'API response'}
    assert c.post('/api/work/w1/evidence', json={'excerpts': [e], 'reviewed': False}).status_code == 422
    for _ in range(2):
        assert c.post('/api/work/w1/evidence', json={'excerpts': [e], 'reviewed': True}).status_code == 200
    e['text'] = 'Changed evidence'
    assert c.post('/api/work/w1/evidence', json={'excerpts': [e], 'reviewed': True}).status_code == 409


def test_two_model_aggregation(packet, answer):
    result = aggregate_samples(packet, {'glm': [answer] * 3, 'gpt': [answer] * 3}, {'glm', 'gpt'})
    assert result['collection_status'] == 'complete'
    with pytest.raises(ValueError):
        aggregate_samples(packet, {'glm': [answer] * 3}, {'glm'})


def test_screenpipe_explicit_window_dedup_no_audio():
    seen = []
    def handle(request):
        seen.append(request)
        def event(frame, stamp, text):
            return {'type': 'OCR', 'content': {'frame_id': frame, 'timestamp': stamp, 'text': text}}
        return httpx.Response(200, json={'data': [event(1, '2026-09-07T10:01:00Z', 'Work'),
            event(2, '2026-09-07T10:02:00Z', 'Work'), event(3, '2026-09-07T12:00:00Z', 'Outside'),
            {'type': 'Audio', 'content': {'text': 'Not selected'}}]})
    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        result = collect('2026-09-07T10:00:00Z', '2026-09-07T11:00:00Z', client=client)
    assert len(result) == 1 and result[0]['text'] == 'Work'
    assert seen[0].url.params['content_type'] == 'ocr'
    assert 'start_time' in seen[0].url.params and 'end_time' in seen[0].url.params


@pytest.mark.parametrize('start,end,url', [
    ('2026-09-07T10:00:00', '2026-09-07T11:00:00Z', 'http://localhost:3030'),
    ('2026-09-07T10:00:00Z', '2026-09-07T11:00:00Z', 'https://remote.example'),
    ('2026-09-07T11:00:00Z', '2026-09-07T10:00:00Z', 'http://localhost:3030')])
def test_screenpipe_rejects_ambiguous_or_remote_capture(start, end, url):
    with pytest.raises(ValueError):
        collect(start, end, url=url)


def test_omniroute_403_sanitized_no_key_leak(c, monkeypatch, tmp_path):
    key = tmp_path / 'api.key'; key.write_text('secret-never-log')
    real_client = httpx.Client
    def client(**kwargs):
        return real_client(transport=httpx.MockTransport(lambda req: httpx.Response(403, text='secret-never-log')))
    monkeypatch.setattr('contribution.ai.httpx.Client', client)
    with pytest.raises(ProviderError) as e:
        OmniRoute(replace(c.settings, omniroute_key_file=key)).complete('glm-5.3', 'test', {}, JudgeAnswer)
    assert '403' in str(e.value) and 'secret-never-log' not in str(e.value)
