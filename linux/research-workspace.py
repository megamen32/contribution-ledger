#!/usr/bin/python3
"""Two real sites and a distinct native editor, in the acceptance desktop only."""
import gi,json,os,signal,time,subprocess,sys
from pathlib import Path
gi.require_version('Gtk','3.0');gi.require_version('WebKit2','4.0')
from gi.repository import Gtk,GLib,Gdk,WebKit2,Pango
out=Path(os.environ['VKLAD_JOURNEY_EVIDENCE']);article=Path(os.environ['VKLAD_JOURNEY_ARTICLE']).read_text()
state={'stage':0,'ready':False};urls=['https://slicingpie.com/the-new-pie-slicer/','https://www.ycombinator.com/library/5x-how-to-split-equity-among-co-founders']
GLib.set_application_name('ResearchBrowser')
browser=Gtk.Window(title='Research browser');browser.set_default_size(1180,780)
box=Gtk.Box(orientation=Gtk.Orientation.VERTICAL);browser.add(box)
address=Gtk.Label();box.pack_start(address,False,False,8)
web=WebKit2.WebView();web.get_settings().set_enable_webgl(False);web.get_settings().set_hardware_acceleration_policy(WebKit2.HardwareAccelerationPolicy.NEVER)
box.pack_start(web,True,True,0)
editor=None

def save(): (out/'workspace-state.json').write_text(json.dumps(state,ensure_ascii=False))
def shot(name):
    root=Gdk.get_default_root_window();p=Gdk.pixbuf_get_from_window(root,0,0,root.get_width(),root.get_height());p.savev(str(out/name),'png',[],[])
def load_changed(w,event):
    if event==WebKit2.LoadEvent.FINISHED and w.get_uri()!='about:blank' and ((state['stage']==1 and 'Slicing Pie' in (w.get_title() or '')) or (state['stage']==2 and 'How to split' in (w.get_title() or ''))):
        browser.set_title('Research browser — '+str(w.get_title()))
        state.update(ready=True,ready_at=time.time(),url=w.get_uri(),title=w.get_title());save();shot(f"site-{state['stage']}.png")
def failed(w,event,uri,error):
    if error.matches(WebKit2.network_error_quark(),WebKit2.NetworkError.CANCELLED):return True
    state.update(error=error.message);save();shot('workspace-failure.png');return False
def dom_ready():
    if state['stage'] in (1,2) and not state['ready']:
        def checked(w,result,*unused):
            try:
                if w.run_javascript_finish(result).get_js_value().to_boolean() and ((state['stage']==1 and 'Slicing Pie' in (w.get_title() or '')) or (state['stage']==2 and 'How to split' in (w.get_title() or ''))):
                    browser.set_title('Research browser — '+str(w.get_title()))
                    state.update(ready=True,ready_at=time.time(),url=w.get_uri(),title=w.get_title());save();shot(f"site-{state['stage']}.png")
            except GLib.Error:pass
        web.run_javascript("Boolean(document.body && document.body.innerText.length>300 && document.querySelector('h1,h2'))",None,checked,None)
    return True
GLib.timeout_add(500,dom_ready)
web.connect('load-changed',load_changed);web.connect('load-failed',failed)
def action(*unused):
    global editor,web
    state['stage']+=1;state['ready']=False
    if state['stage'] in (1,2):
        if state['stage']==2:
            web.stop_loading();box.remove(web)
            # Open the second site in a fresh view/context; video subresources of
            # the first site must not hold a cross-site navigation indefinitely.
            web=WebKit2.WebView(web_context=WebKit2.WebContext.new_ephemeral())
            web.get_settings().set_enable_webgl(False);web.get_settings().set_hardware_acceleration_policy(WebKit2.HardwareAccelerationPolicy.NEVER)
            web.connect('load-changed',load_changed);web.connect('load-failed',failed);box.pack_start(web,True,True,0)
        browser.show_all();browser.present();address.set_text(urls[state['stage']-1]);web.load_uri(urls[state['stage']-1])
    elif state['stage']==3:
        browser.hide()
        editor=subprocess.Popen([sys.executable,str(Path(__file__).with_name('research-editor.py'))])
        def editor_ready():
            if (out/'editor-ready.json').exists():
                state.update(ready=True,ready_at=time.time(),title='Research editor');save();return False
            return True
        GLib.timeout_add(250,editor_ready)
    save();return True
GLib.unix_signal_add(GLib.PRIORITY_DEFAULT,signal.SIGUSR1,action)
def close():
    if editor and editor.poll() is None:editor.terminate()
    Gtk.main_quit();return False
GLib.unix_signal_add(GLib.PRIORITY_DEFAULT,signal.SIGTERM,close)
save();Gtk.main()
