#!/usr/bin/python3
"""Native Ubuntu client. Team data stays on the server; Screenpipe sessions stay local."""
import argparse
import json
import os
import signal
import subprocess
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import urlsplit

import gi
gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.0")
from gi.repository import Gtk, GLib, Gdk, WebKit2

VERSION = "0.3.2"
ROOT = Path(__file__).resolve().parent

class Client:
    def __init__(self, args):
        self.args = args
        self.helper = Path(args.helper) if args.helper else ROOT / "screenpipe-vklad"
        self.recordings = Path(args.data_dir).resolve() if args.data_dir else Path(os.environ.get("XDG_DATA_HOME", Path.home()/".local/share"))/"vklad/sessions"
        self.process = None
        self.session = None
        self.frames = 0
        self.error = None
        self.stopping = False
        self.closing = False
        self.loaded = False
        self.smoke_stage = 0
        self.started_at = time.monotonic()
        self.stopped_at = None
        self.marker = "VKLAD REAL DESKTOP CAPTURE 314159"
        self.api_callbacks = {}
        self.window = Gtk.Window(title="Вклад")
        self.window.set_default_size(1200, 820)
        self.window.set_wmclass("vklad", "Vklad")
        self.window.set_icon_from_file(str(ROOT / "vklad.png"))
        self.window.connect("delete-event", self.close)
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        self.window.add(box)
        bar = Gtk.Box(spacing=12)
        bar.set_border_width(12)
        self.button = Gtk.Button(label="Начать запись")
        self.button.connect("clicked", self.toggle)
        bar.pack_start(self.button, False, False, 0)
        self.status = Gtk.Label(label="Запись выключена · сохраняется только на этом компьютере")
        self.status.set_xalign(0)
        bar.pack_start(self.status, True, True, 0)
        files = Gtk.Button(label="Записи")
        files.connect("clicked", self.open_files)
        bar.pack_end(files, False, False, 0)
        self.report_button=Gtk.Button(label="Сводка и оценка")
        self.report_button.set_sensitive(False)
        self.report_button.connect("clicked",self.open_report)
        bar.pack_end(self.report_button,False,False,0)
        box.pack_start(bar, False, False, 0)
        # A persistent WebKit profile keeps the user's login across launches.
        profile = Path(os.environ.get("XDG_CONFIG_HOME", Path.home()/".config"))/"vklad/webkit"
        profile.mkdir(parents=True, exist_ok=True)
        manager = WebKit2.WebsiteDataManager(base_data_directory=str(profile), base_cache_directory=str(profile/"cache"))
        scripts=WebKit2.UserContentManager()
        scripts.register_script_message_handler("vklad")
        scripts.connect("script-message-received::vklad",self.api_message)
        self.web = WebKit2.WebView(web_context=WebKit2.WebContext.new_with_website_data_manager(manager),user_content_manager=scripts)
        self.web.get_settings().set_enable_webgl(False)
        self.web.get_settings().set_hardware_acceleration_policy(WebKit2.HardwareAccelerationPolicy.NEVER)
        self.web.connect("load-changed", self.load_changed)
        self.web.connect("load-failed", self.load_failed)
        self.web.connect("decide-policy", self.policy)
        box.pack_start(self.web, True, True, 0)
        self.web.load_uri(args.server)
        self.window.show_all()
        if args.smoke:
            GLib.timeout_add(250, self.smoke_tick)
        if args.journey:
            from journey import Journey
            self.journey=Journey(self,args.journey)
        GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGTERM, self.close)
        GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGINT, self.close)

    def open_report(self,*unused):
        try:
            from report_dialog import ReportDialog
            self.report_dialog=ReportDialog(self)
        except Exception as error:self.status.set_text(str(error))

    def api_message(self,manager,result):
        try:
            message=json.loads(result.get_js_value().to_string())
            callback=self.api_callbacks.pop(message['id'],None)
            if callback:callback(message.get('data'),message.get('error'))
        except (ValueError,KeyError):pass

    def api(self,path,body,callback,project=None,form=False):
        if urlsplit(self.web.get_uri() or '').netloc!=urlsplit(self.args.server).netloc:
            callback(None,'Откройте кабинет Вклад');return
        request_id=str(uuid.uuid4());self.api_callbacks[request_id]=callback
        options={'method':'GET' if body is None else 'POST','headers':{'Content-Type':'application/json'}}
        if project:options['headers']['x-vklad-project']=project
        if body is not None:
            if form:
                from urllib.parse import urlencode
                options['body']=urlencode(body);options['headers']['Content-Type']='application/x-www-form-urlencoded'
            else:options['body']=json.dumps(body,ensure_ascii=False)
        script=f"""(async()=>{{try{{const r=await fetch({json.dumps(path)},{json.dumps(options)});const data=await r.json();window.webkit.messageHandlers.vklad.postMessage(JSON.stringify({{id:{json.dumps(request_id)},data:r.ok?data:null,error:r.ok?null:(data.error||'Ошибка кабинета')}}));}}catch(e){{window.webkit.messageHandlers.vklad.postMessage(JSON.stringify({{id:{json.dumps(request_id)},error:'Соединение потеряно. Проверьте задачу; запрос не повторяется автоматически.'}}));}}}})();"""
        self.web.run_javascript(script,None,None,None)

    def policy(self, web, decision, kind):
        if kind == WebKit2.PolicyDecisionType.NAVIGATION_ACTION:
            target = decision.get_navigation_action().get_request().get_uri()
            a,b = urlsplit(target),urlsplit(self.args.server)
            if (a.scheme,a.hostname,a.port or (443 if a.scheme=="https" else 80)) != (b.scheme,b.hostname,b.port or (443 if b.scheme=="https" else 80)):
                decision.ignore()
                return True
        return False

    def load_changed(self, web, event):
        if event == WebKit2.LoadEvent.FINISHED:
            self.loaded = bool(web.get_title() and "Вклад" in web.get_title())
            if not self.loaded and self.args.smoke:
                self.error = "Загруженная страница не является кабинетом Вклад"

    def load_failed(self, web, event, uri, error):
        self.error = "Не удалось загрузить кабинет: " + str(error.message)
        self.status.set_text(self.error)
        return False

    def open_files(self, *unused):
        self.recordings.mkdir(parents=True, exist_ok=True)
        Gtk.show_uri_on_window(self.window, self.recordings.as_uri(), Gdk.CURRENT_TIME)

    def toggle(self, *unused):
        if self.process:
            self.stop()
            return
        try:
            if not self.helper.is_file() or not os.access(self.helper, os.X_OK):
                raise RuntimeError("В сборке отсутствует Screenpipe")
            if os.environ.get("XDG_SESSION_TYPE")=="wayland" and not self.args.smoke:
                raise RuntimeError("В этой версии запись проверена только в сеансе X11. Выберите Ubuntu on Xorg при входе.")
            self.session = self.recordings / str(uuid.uuid4())
            self.recordings.mkdir(parents=True, exist_ok=True)
            self.frames = 0
            self.report_button.set_sensitive(False)
            self.error = None
            self.stopping = False
            command = [str(self.helper), "record", "--data-dir", str(self.session), "--parent-pid", str(os.getpid()), "--interval", "2" if self.args.smoke or self.args.journey else "30"]
            self.process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
            self.button.set_label("Остановить")
            self.status.set_text("Запускается Screenpipe…")
            threading.Thread(target=self.read_events, args=(self.process,), daemon=True).start()
            GLib.timeout_add(100, self.reap)
        except Exception as error:
            self.error = str(error)
            self.status.set_text("Запись не началась: " + self.error)

    def read_events(self, process):
        for line in process.stdout:
            try: event=json.loads(line)
            except (ValueError, TypeError): continue
            GLib.idle_add(self.event, event)

    def event(self, event):
        if self.args.smoke or self.args.journey:
            with (Path(self.args.smoke or self.args.journey)/"client-events.jsonl").open("a") as f:f.write(json.dumps(event)+"\n")
        if event.get("event")=="ready":
            self.status.set_text("Идёт запись · ожидается первый кадр")
        elif event.get("event")=="skipped_private_window":
            self.status.set_text("Идёт запись · это окно пропущено")
        elif event.get("event")=="frame":
            self.frames += 1
            self.status.set_text(f"Идёт запись · {self.frames} кадров")
        elif event.get("event")=="error":
            self.error = str(event.get("message", "Ошибка Screenpipe"))
            self.status.set_text(self.error)
        return False

    def stop(self):
        if not self.process or self.stopping: return
        self.stopping = True
        self.stopped_at = time.monotonic()
        self.button.set_sensitive(False)
        self.status.set_text("Останавливается запись…")
        try:
            self.process.stdin.write("stop\n")
            self.process.stdin.flush()
            self.process.stdin.close()
        except (BrokenPipeError, OSError, ValueError): pass
        GLib.timeout_add(5000, self.force_stop)

    def force_stop(self):
        if self.process and self.process.poll() is None:
            # Only the exact owned child/session; never a foreign Screenpipe process.
            os.killpg(self.process.pid, signal.SIGTERM)
            GLib.timeout_add(3000, self.kill_stuck)
        return False

    def kill_stuck(self):
        if self.process and self.process.poll() is None:
            os.killpg(self.process.pid, signal.SIGKILL)
        return False

    def reap(self):
        if not self.process: return False
        code = self.process.poll()
        if code is None: return True
        stderr = self.process.stderr.read().strip()
        if code != 0:
            self.error = f"Screenpipe завершился с ошибкой {code}: {stderr[-600:]}"
        self.process = None
        self.stopping = False
        self.button.set_sensitive(True)
        self.button.set_label("Начать запись")
        self.status.set_text(self.error or f"Запись сохранена · {self.frames} кадров")
        self.report_button.set_sensitive(not self.error and self.frames>0)
        if self.closing: Gtk.main_quit()
        return False

    def close(self, *unused):
        self.closing = True
        if self.process: self.stop()
        else: Gtk.main_quit()
        return True

    def screenshot(self, path):
        window = Gdk.get_default_root_window()
        if window:
            image = Gdk.pixbuf_get_from_window(window, 0, 0, window.get_width(), window.get_height())
            if image: image.savev(str(path), "png", [], [])

    def smoke_tick(self):
        out=Path(self.args.smoke).resolve()
        out.mkdir(parents=True,exist_ok=True)
        if self.error or time.monotonic()-self.started_at > 600:
            self.screenshot(out/"failure.png")
            (out/"result.json").write_text(json.dumps({"passed":False,"error":self.error or "Native acceptance timeout","stage":self.smoke_stage},ensure_ascii=False))
            if os.environ.get("VKLAD_HOLD_SMOKE_FAILURE")!="1": self.close()
            return False
        if self.smoke_stage==0 and self.loaded:
            if self.process is not None:
                self.error = "Клиент начал запись без нажатия кнопки"
                return True
            self.button.emit("clicked")
            os.kill(int(os.environ["VKLAD_SMOKE_FIXTURE_PID"]), signal.SIGUSR1)
            self.smoke_stage=1
        elif self.smoke_stage==1 and self.frames >= 1:
            self.screenshot(out/"recording.png")
            self.button.emit("clicked")
            self.smoke_stage=2
        elif self.smoke_stage==2 and self.process is None:
            self.stop_frames=self.frames
            self.stop_time=time.monotonic()
            self.smoke_stage=3
        elif self.smoke_stage==3 and time.monotonic()-self.stop_time >= 3:
            state=json.loads((self.session/"session.json").read_text())
            import sqlite3
            with sqlite3.connect(self.session/"db.sqlite") as db:
                count=db.execute("SELECT COUNT(*) FROM frames").fetchone()[0]
            events=(self.session/"events.jsonl").read_text()
            frame_events=[json.loads(line) for line in events.splitlines()]
            snapshot=Path(frame_events[0]["snapshot_path"])
            assert snapshot.resolve().is_relative_to(self.session.resolve()), "Frame must belong to this exact local session"
            ocr=subprocess.run(["tesseract",str(snapshot),"stdout","-l","eng"],capture_output=True,text=True,timeout=15)
            screen_marker=ocr.returncode==0 and self.marker.lower() in ocr.stdout.lower()
            passed=self.frames==self.stop_frames and count>=1 and state["state"]=="stopped" and screen_marker
            self.screenshot(out/"stopped.png")
            (out/"result.json").write_text(json.dumps({"passed":passed,"loaded":self.loaded,"initial_recording":False,"start_button_used":True,"stop_button_used":True,"application_icon":self.window.get_icon() is not None,"frames":count,"state":state["state"],"ocr_marker":screen_marker,"snapshot":str(snapshot),"child_exited":self.process is None,"frames_after_stop":self.frames-self.stop_frames,"session":str(self.session),"elapsed_seconds":round(time.monotonic()-self.started_at,2)},ensure_ascii=False))
            self.close()
            return False
        return True


def main():
    os.umask(0o077)
    parser=argparse.ArgumentParser(description="Вклад — клиент Ubuntu")
    parser.add_argument("--server",default="https://vklad.bezrabotnyi.com/")
    parser.add_argument("--helper")
    parser.add_argument("--data-dir")
    parser.add_argument("--journey",help="Run the isolated multi-application acceptance")
    parser.add_argument("--smoke",help="Run actual native Start/Stop acceptance on an isolated desktop")
    parser.add_argument("--version",action="version",version=VERSION)
    args=parser.parse_args()
    url=urlsplit(args.server)
    if url.scheme not in ("http","https") or not url.hostname or url.username or url.password or url.query or url.fragment:
        parser.error("Укажите адрес HTTPS-кабинета или локального тестового сервера")
    if (args.smoke or args.journey) and os.environ.get("VKLAD_ISOLATED_DESKTOP")!="1":
        parser.error("Smoke requires its own isolated desktop; use linux/smoke.sh")
    Client(args)
    Gtk.main()
    if args.smoke or args.journey:
        result=Path(args.smoke or args.journey)/("result.json" if args.smoke else "journey-result.json")
        return 0 if result.exists() and json.loads(result.read_text()).get("passed") else 1
    return 0

if __name__=="__main__": raise SystemExit(main())
