"""Reviewable text projection of an owned Screenpipe session. No images upload."""
import json
from pathlib import Path

def capture_input(session):
    session=Path(session).resolve()
    if json.loads((session/'session.json').read_text())['state']!='stopped': raise ValueError('Сначала остановите запись')
    selected=[]
    for line in (session/'events.jsonl').read_text().splitlines():
        event=json.loads(line);text=(event.get('text') or '').strip()
        if not text:continue
        if not Path(event['snapshot_path']).resolve().is_relative_to(session): raise ValueError('Кадр вне этой записи')
        key=(event.get('app_name'),event.get('window_name'),text)
        if selected and selected[-1][0]==key:continue
        selected.append((key,event))
    # Keep the last visible text in each app/window instead of many duplicate revisions.
    groups={}
    for key,event in selected:groups[(key[0],key[1])]=(key,event)
    selected=list(groups.values())
    if len(selected)>24:selected=[selected[round(i*(len(selected)-1)/23)] for i in range(24)]
    excerpts=[];remaining=18000
    per_frame=max(400,min(3000,18000//len(selected)))
    for _,event in selected:
        text=f"Окно: {event.get('window_name') or 'неизвестно'}; приложение: {event.get('app_name') or 'неизвестно'}\n{event['text']}"[:min(per_frame,remaining)]
        if not text:break
        remaining-=len(text)
        excerpts.append({'evidence_id':f'capture-{len(excerpts)+1}','text':text,'locator':f"frame:{event['frame_id']} at {event['captured_at']}"})
    if not excerpts:raise ValueError('В записи нет распознанного текста')
    return {'sessionId':session.name,'excerpts':excerpts}
