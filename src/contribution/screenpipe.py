"""Read only the explicitly selected Screenpipe interval on the participant's laptop.

This is an importer, NOT capture control. The user starts/stops Screenpipe itself.
No screenshots, audio or key contents are sent. Review exported text before upload.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import httpx

from contribution_spec.contracts import SourceExcerpt


def utc(value: str) -> datetime:
    dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if dt.tzinfo is None:
        raise ValueError('Timestamp must include its time zone, e.g. +03:00 or Z')
    return dt.astimezone(timezone.utc)


def collect(start: str, end: str, *, url: str = 'http://127.0.0.1:3030',
            token: str = '', client=None) -> list[dict]:
    begin, finish = utc(start), utc(end)
    if not 0 < (finish - begin).total_seconds() <= 86400:
        raise ValueError('Choose a positive work interval no longer than 24 hours')
    address = urlparse(url)
    if address.scheme != 'http' or address.hostname not in {'127.0.0.1', 'localhost', '::1'}:
        raise ValueError('Screenpipe is read locally on the participant laptop, not via a remote URL')
    owned = client is None
    client = client or httpx.Client(timeout=20, follow_redirects=False)
    excerpts, seen = [], set()
    headers = {'Authorization': 'Bearer ' + token} if token else {}
    try:
        for offset in range(0, 2000, 100):
            response = client.get(url.rstrip('/') + '/search', headers=headers, params={
                'content_type': 'ocr', 'start_time': begin.isoformat(), 'end_time': finish.isoformat(),
                'limit': 100, 'offset': offset, 'include_frames': 'false'})
            response.raise_for_status()
            data = response.json()
            if not isinstance(data, dict) or not isinstance(data.get('data'), list):
                raise ValueError('Unsupported Screenpipe /search response; no data imported')
            items = data['data']
            for item in items:
                if item.get('type', '').lower() != 'ocr':
                    continue
                content = item.get('content', {})
                text = content.get('text', '')
                stamp = content.get('timestamp')
                if not isinstance(text, str) or not text.strip() or not stamp:
                    continue
                if not begin <= utc(stamp) < finish:
                    continue
                # Adjacent unchanged screens must not inflate the model's input or monetary credit.
                text = text.strip()
                if text in seen:
                    continue
                if len(text) > 20000:
                    raise ValueError('An OCR record is too large. Select a smaller excerpt manually.')
                seen.add(text)
                frame = content.get('frame_id')
                if not isinstance(frame, int) or isinstance(frame, bool):
                    raise ValueError('Screenpipe frame lacks a stable frame_id; review API compatibility')
                excerpt = SourceExcerpt(evidence_id='sp-' + str(frame), artifact_id='frame-' + str(frame),
                    locator='screenpipe frame ' + str(frame) + ' at ' + stamp,
                    kind='artifact_excerpt', text=text)
                excerpts.append(excerpt.model_dump(mode='json'))
                if len(excerpts) > 200 or sum(len(e['text'].encode()) for e in excerpts) > 300000:
                    raise ValueError('Too much evidence for one task; split the selected interval (nothing uploaded)')
            if len(items) < 100:
                return excerpts
            pagination = data.get('pagination', {})
            if isinstance(pagination.get('total'), int) and offset + len(items) >= pagination['total']:
                return excerpts
        raise ValueError('Safety page limit reached; select a smaller interval, no silent truncation')
    finally:
        if owned:
            client.close()


def export(start: str, end: str, output: Path, url: str, key_file: Path | None):
    excerpts = collect(start, end, url=url, token=key_file.read_text().strip() if key_file else '')
    # Do not overwrite a participant's previous export by accident.
    with output.open('x', encoding='utf-8') as f:
        json.dump({'excerpts': excerpts, 'reviewed': False}, f, ensure_ascii=False, indent=2)
    print(f'{len(excerpts)} excerpts saved to {output}. Review before upload; no data sent to the team.')
