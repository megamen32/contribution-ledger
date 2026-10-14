"""Real multi-application capture and optional subscription consumer canary."""
import json,os,signal,time,sqlite3,subprocess
from datetime import datetime
import re
from pathlib import Path
from gi.repository import GLib
class Journey:
    def __init__(self,client,path):
        self.c=client;self.out=Path(path);self.stage=0;self.error=None;self.wait_since=time.monotonic();self.transitions=[]
        self.config=json.loads(Path(os.environ['VKLAD_JOURNEY_CONFIG']).read_text()) if os.environ.get('VKLAD_JOURNEY_CONFIG') else None
        GLib.timeout_add(500,self.tick)
    def fail(self,message):self.error=message
    def csrf(self,data,error):
        if error:self.fail(error);return
        self.c.api('/api/auth/callback/credentials',{'csrfToken':data['csrfToken'],'login':self.config['login'],'password':self.config['password'],'json':'true','callbackUrl':self.c.args.server},self.logged_in,form=True)
    def logged_in(self,data,error):
        if error:self.fail(error);return
        self.c.api('/api/me',None,self.me)
    def me(self,data,error):
        if error:self.fail(error);return
        self.project=data['user']['workspaceId']
        if self.config.get('taskId'):
            self.c.api('/api/tasks/'+self.config['taskId'],None,self.task,self.project);return
        self.c.api('/api/tasks',{'title':'Сколько стартапов распределяют доли по реальному вкладу','description':'Два источника, статья в редакторе; количественный результат без выдуманных данных.','category':'research'},self.task,self.project)
    def task(self,data,error):
        if error:self.fail(error);return
        self.task_id=data['task']['id'];(self.out/'task.json').write_text(json.dumps({'id':self.task_id,'project':self.project}));self.stage=3
    def signal(self):
        os.kill(int(os.environ['VKLAD_JOURNEY_WORKSPACE_PID']),signal.SIGUSR1);self.wait_since=time.monotonic()
    def events(self):
        path=self.c.session/'events.jsonl' if self.c.session else None
        return [json.loads(line) for line in path.read_text().splitlines()] if path and path.exists() else []
    def finish(self):
        events=self.events();texts='\n'.join(e.get('text') or '' for e in events)
        frames={}
        for key,needle in [('slicing','slicing pie'),('yc','co-founder'),('editor','стартап')]:
            matching=[e for e in events if needle in (e.get('text') or '').lower() and (('editor' if key=='editor' else 'browser') in (e.get('window_name') or '').lower())]
            if not matching:raise ValueError(f'Нет OCR свидетельства {key}')
            frame=matching[-1];image=Path(frame['snapshot_path']);ocr=subprocess.run(['tesseract',str(image),'stdout','-l','eng+rus'],capture_output=True,text=True,timeout=20)
            # Independently verify actual pixels, not accessibility text alone.
            if needle not in ocr.stdout.lower():raise ValueError(f'JPEG не подтверждает {key}')
            frames[key]={'frame_id':frame['frame_id'],'snapshot':str(image),'pixel_ocr':True}
        with sqlite3.connect(self.c.session/'db.sqlite') as db:count=db.execute('SELECT count(*) FROM frames').fetchone()[0]
        state=json.loads((self.c.session/'session.json').read_text())
        result={'passed':True,'frames':count,'evidence':frames,'state':state['state'],'child_exited':self.c.process is None,'frames_after_stop':self.c.frames-self.stop_frames,'article':str(Path(self.config['recording']).parent.parent/'article.md') if self.config and self.config.get('recording') else str(self.out/'article.md'),'session':str(self.c.session),'application_icon':self.c.window.get_icon() is not None,'elapsed_seconds':round(time.monotonic()-self.c.started_at,2),'reopened_recording':bool(self.config and self.config.get('recording'))}
        if self.config:
            result['summary']=json.loads((self.c.session/'summary-receipt.json').read_text())
            result['assessment']=json.loads((self.c.session/'assessment-receipt.json').read_text())
            result['task_id']=self.task_id
        self.c.screenshot(self.out/'journey-final.png');(self.out/'journey-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));self.c.close()
    def tick(self):
        c=self.c
        try:
            if self.error or c.error or time.monotonic()-c.started_at>1800:raise ValueError(self.error or c.error or 'Journey emergency deadline')
            if self.stage==0 and c.loaded:
                if c.process:raise ValueError('Запись началась сама')
                if self.config:self.stage=1;c.api('/api/auth/csrf',None,self.csrf)
                else:self.stage=3
            elif self.stage==3:
                if self.config and self.config.get('recording'):
                    self.stop_frames=json.loads((Path(self.config['recording'])/'session.json').read_text())['frames'];self.stop_time=time.monotonic()-4
                    c.frames=self.stop_frames;self.stage=8
                else:c.button.emit('clicked');self.signal();self.stage=4
            elif self.stage in (4,5,6):
                state=json.loads((self.out/'workspace-state.json').read_text())
                if time.monotonic()-self.wait_since>300:raise ValueError('Не получены текст/кадр текущего приложения за300 секунд')
                if state.get('error'):raise ValueError(state['error'])
                needle={4:'slicing pie',5:'co-founder',6:'стартап'}[self.stage]
                latest=self.events()[-1:] or [{}]
                if state.get('ready') and datetime.fromisoformat(re.sub(r'(\.\d{6})\d+',r'\1',latest[0].get('captured_at','1970-01-01T00:00:00+00:00')).replace('Z','+00:00')).timestamp()>=state.get('ready_at',0) and time.monotonic()-self.wait_since>7 and needle in (latest[0].get('text') or '').lower():
                    c.screenshot(self.out/f'captured-stage-{self.stage}.png')
                    if self.stage<6:self.signal();self.stage+=1
                    else:c.button.emit('clicked');self.stage=7
            elif self.stage==7 and c.process is None:
                self.stop_frames=c.frames;self.stop_time=time.monotonic();self.stage=8
            elif self.stage==8 and time.monotonic()-self.stop_time>3:
                if self.config:
                    if self.config.get('recording'):
                        def choose():
                            if not getattr(c,'recording_picker',None):return True
                            if c.recording_picker.get_filename()!=self.config['recording']:
                                c.recording_picker.set_filename(self.config['recording']);return True
                            from gi.repository import Gtk
                            c.recording_picker.response(Gtk.ResponseType.OK);return False
                        GLib.timeout_add(250,choose)
                    c.report_button.emit('clicked');self.stage=9
                else:self.finish();return False
            elif self.stage==9 and getattr(c,'report_dialog',None) and c.report_dialog.send.get_sensitive():
                d=c.report_dialog;d.tasks.set_active_id(self.task_id);d.send.emit('clicked');self.stage=10
            elif self.stage==10:
                d=c.report_dialog
                if d.draft and d.approve.get_sensitive():
                    c.screenshot(self.out/'summary-draft.png');d.approve.emit('clicked');self.stage=11
                elif 'не получена' in d.label.get_text() or 'ошибка' in d.label.get_text().lower():raise ValueError(d.label.get_text())
            elif self.stage==11 and (c.session/'assessment-receipt.json').exists():
                self.finish();return False
        except Exception as error:
            c.screenshot(self.out/'journey-failure.png');(self.out/'journey-result.json').write_text(json.dumps({'passed':False,'error':str(error),'stage':self.stage},ensure_ascii=False))
            # Retain the failed owned desktop for same-session screenshot inspection.
            if os.environ.get('VKLAD_HOLD_SMOKE_FAILURE')!='1':c.close()
            return False
        return True
