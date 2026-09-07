"""Task evidence, reviewable reports and immutable, anonymous council rounds."""
from __future__ import annotations

import json
import re
import time
import uuid
from typing import Annotated

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from contribution_spec.contracts import BlindPacket, MarketRate, Report, SourceExcerpt
from contribution_spec.rules import digest, find_known_identifiers, make_blind_packet
from contribution_spec.store import Conflict, enqueue

from .config import Settings
from .db import database, transaction


class RequestBody(BaseModel):
    model_config = ConfigDict(extra='forbid')


class JobRequest(RequestBody):
    id: Annotated[str, Field(pattern=r'^[A-Za-z0-9_-]{1,80}$')]


class EvaluationRequest(JobRequest):
    reviewed: bool
    packet: BlindPacket


class EvidenceImport(RequestBody):
    excerpts: list[SourceExcerpt] = Field(min_length=1, max_length=200)
    reviewed: bool


def get_work(db, work_id):
    row = db.execute('SELECT * FROM work_records WHERE id=?', (work_id,)).fetchone()
    if row is None:
        raise HTTPException(404, 'Работа не найдена')
    return dict(row)


def excerpts_for(db, work):
    excerpts = [dict(evidence_id='statement', artifact_id=None, locator=None,
                     kind='participant_statement', text=work['notes'] or work['title'])]
    row = db.execute('SELECT body_json FROM work_evidence WHERE work_id=?', (work['id'],)).fetchone()
    if row:
        excerpts.extend(json.loads(row[0]))
    return excerpts


def redact_text(text, names):
    for name in sorted(names, key=len, reverse=True):
        if len(name) >= 3:
            text = re.sub(re.escape(name), '[участник]', text, flags=re.I)
    text = re.sub(r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}', '[почта]', text)
    return re.sub(r'(?:/Users/|/home/|[A-Z]:\\Users\\)[^\s/\\]+', '[домашний каталог]', text)


def install_ai_routes(app: FastAPI, settings: Settings, protected: list):
    @app.post('/api/work/{work_id}/evidence', dependencies=protected)
    def import_evidence(work_id: str, body: EvidenceImport):
        if not body.reviewed:
            raise HTTPException(422, 'Сначала просмотрите материалы, отправляемые команде')
        ids = [e.evidence_id for e in body.excerpts]
        if len(set(ids)) != len(ids) or 'statement' in ids:
            raise HTTPException(422, 'Идентификаторы источников должны быть уникальными')
        text = json.dumps([e.model_dump(mode='json') for e in body.excerpts], ensure_ascii=False)
        if len(text.encode()) > 400000:
            raise HTTPException(413, 'Слишком много материала для одной задачи; выберите меньший интервал')
        with database(settings.data_dir) as db, transaction(db):
            get_work(db, work_id)
            old = db.execute('SELECT body_json FROM work_evidence WHERE work_id=?', (work_id,)).fetchone()
            if old and old[0] != text:
                raise Conflict('Материалы уже закреплены; перезапись старых оснований не допускается')
            db.execute('INSERT OR IGNORE INTO work_evidence VALUES (?,?,?)', (work_id, text, int(time.time())))
        return {'ok': True, 'excerpts': len(ids)}

    @app.post('/api/work/{work_id}/summary', dependencies=protected, status_code=202)
    def summarize(work_id: str, body: JobRequest):
        with database(settings.data_dir) as db:
            work = get_work(db, work_id)
            payload = {'work_id': work_id, 'author_id': work['member_id'], 'model': settings.summary_model,
                       'input': {'title': work['title'], 'excerpts': excerpts_for(db, work)}}
            job_id = enqueue(db, 'summary', f'summary:{work_id}:{body.id}', payload, now=int(time.time()))
        return {'job_id': job_id, 'status': 'queued'}

    @app.get('/api/work/{work_id}/packet', dependencies=protected)
    def packet(work_id: str):
        with database(settings.data_dir) as db:
            work = get_work(db, work_id)
            names = [r[0] for r in db.execute('SELECT display_name FROM members')]
            summary = db.execute("""SELECT result_json FROM jobs WHERE kind='summary' AND state='done'
                AND json_extract(payload_json,'$.work_id')=? ORDER BY rowid DESC LIMIT 1""", (work_id,)).fetchone()
            if summary:
                report = Report.model_validate(json.loads(summary[0])['report'])
            else:
                sources = excerpts_for(db, work)
                report = Report(task_id=work_id, author_id=work['member_id'], revision=1,
                    goal=work['title'], actions=[], result={'text': work['notes'] or 'Результат не описан',
                    'basis': 'participant_statement', 'evidence_ids': ['statement']}, result_status='unknown',
                    excerpts=sources, omitted_material=[], limitations=['Отчёт ИИ ещё не подтверждён; пакет требует проверки'],
                    suggested_task_split=[])
        path = settings.data_dir / 'rates.json'
        rates = [MarketRate.model_validate(x) for x in json.loads(path.read_text())] if path.exists() else []
        data = make_blind_packet(report, packet_id='p-' + uuid.uuid4().hex, scope=work['title'],
            available_tools=[], constraints=[], rates=rates, rate_card_id='r-' + digest([r.model_dump() for r in rates])[:24])
        # Only natural-language fields are scrubbed; identifier/reference structure stays consistent.
        value = data.model_dump(mode='json')
        for key in ['scope', 'goal', 'outcome']:
            value[key] = redact_text(value[key], names)
        for key in ['constraints', 'available_tools', 'limitations', 'omitted_material']:
            value[key] = [redact_text(t, names) for t in value[key]]
        for e in value['evidence']:
            e['text'] = redact_text(e['text'], names)
        value['limitations'].append('Проверьте имена, личную ставку и фактические часы в тексте перед оценкой.')
        return BlindPacket.model_validate(value)

    @app.post('/api/work/{work_id}/evaluate', dependencies=protected, status_code=202)
    def evaluate(work_id: str, body: EvaluationRequest):
        if not body.reviewed:
            raise HTTPException(422, 'Требуется проверка обезличенного пакета')
        packet_json = body.packet.model_dump(mode='json')
        with database(settings.data_dir) as db, transaction(db):
            get_work(db, work_id)
            names = [r[0] for r in db.execute('SELECT display_name FROM members') if len(r[0]) >= 3]
            if find_known_identifiers(body.packet, names):
                raise HTTPException(422, 'В пакете осталось известное имя участника; замените его перед отправкой')
            models = list(settings.judge_models)
            old = db.execute('SELECT * FROM evaluations WHERE id=?', (body.id,)).fetchone()
            text = json.dumps(packet_json, ensure_ascii=False, sort_keys=True)
            if old and (old['work_id'] != work_id or old['packet_json'] != text or json.loads(old['models_json']) != models):
                raise Conflict('ID раунда уже использован с другим пакетом или моделями')
            db.execute("INSERT OR IGNORE INTO evaluations VALUES (?,?,?,?,'{}',?)",
                       (body.id, work_id, text, json.dumps(models), int(time.time())))
            payload = {'work_id': work_id, 'round_id': body.id, 'packet': packet_json,
                       'packet_hash': digest(packet_json), 'models': models, 'samples_per_model': 3}
            job_id = enqueue(db, 'council', 'council:' + body.id, payload, now=int(time.time()))
        return {'job_id': job_id, 'round_id': body.id, 'required_slots': 3 * len(models)}

    @app.get('/api/work/{work_id}/ai', dependencies=protected)
    def ai_state(work_id: str):
        with database(settings.data_dir) as db:
            get_work(db, work_id)
            jobs = [dict(r) for r in db.execute("""SELECT id,kind,state,attempt_count,last_error,result_json
                FROM jobs WHERE json_extract(payload_json,'$.work_id')=? ORDER BY rowid DESC LIMIT 20""", (work_id,))]
            rounds = [dict(r) for r in db.execute('SELECT id,models_json,slots_json FROM evaluations WHERE work_id=?', (work_id,))]
        for j in jobs:
            j['result'] = json.loads(j.pop('result_json') or 'null')
        for r in rounds:
            r['slots_completed'] = len(json.loads(r.pop('slots_json')))
            r['slots_required'] = 3 * len(json.loads(r.pop('models_json')))
            r['export'] = '/api/rounds/' + r['id'] + '/export'
        key = settings.omniroute_key_file
        return {'jobs': jobs, 'rounds': rounds, 'provider_configured': key is not None and key.is_file(),
                'note': 'Настроенный файл ключа не гарантирует доступ к моделям. ИИ не меняет начисления.'}

    @app.get('/api/rounds/{round_id}/export', dependencies=protected)
    def export(round_id: str):
        with database(settings.data_dir) as db:
            row = db.execute('SELECT * FROM evaluations WHERE id=?', (round_id,)).fetchone()
            if not row:
                raise HTTPException(404, 'Раунд не найден')
            job = db.execute('SELECT result_json FROM jobs WHERE business_key=?', ('council:' + round_id,)).fetchone()
        return JSONResponse({'packet': json.loads(row['packet_json']), 'models': json.loads(row['models_json']),
            'slots': json.loads(row['slots_json']), 'result': json.loads(job[0] or 'null') if job else None},
            headers={'Content-Disposition': 'attachment; filename="evaluation.json"'})
