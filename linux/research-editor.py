#!/usr/bin/python3
"""Distinct native editor with staged typing and a saved research article."""
import gi,json,os,signal
from pathlib import Path
gi.require_version('Gtk','3.0')
from gi.repository import Gtk,GLib,Gdk,Pango
out=Path(os.environ['VKLAD_JOURNEY_EVIDENCE']);article=Path(os.environ['VKLAD_JOURNEY_ARTICLE']).read_text()
GLib.set_application_name('ResearchEditor')
window=Gtk.Window(title='Research editor — contribution-based-equity.md');window.set_default_size(1180,800)
view=Gtk.TextView();view.set_wrap_mode(Gtk.WrapMode.WORD_CHAR);view.override_font(Pango.FontDescription('Sans 15'))
view.set_left_margin(24);view.set_right_margin(24)
scroll=Gtk.ScrolledWindow();scroll.add(view);window.add(scroll);window.show_all();window.present();view.grab_focus()
paragraphs=article.split('\n\n');buf=view.get_buffer()
def type_paragraph():
    if paragraphs:
        view.emit('insert-at-cursor',paragraphs.pop(0)+'\n\n');view.scroll_mark_onscreen(buf.get_insert());return True
    (out/'article.md').write_text(buf.get_text(buf.get_start_iter(),buf.get_end_iter(),True))
    view.scroll_to_iter(buf.get_start_iter(),0,False,0,0)
    (out/'editor-ready.json').write_text(json.dumps({'ready':True,'title':window.get_title()}))
    root=Gdk.get_default_root_window();Gdk.pixbuf_get_from_window(root,0,0,root.get_width(),root.get_height()).savev(str(out/'article-editor.png'),'png',[],[])
    return False
GLib.timeout_add(1000,type_paragraph)
GLib.unix_signal_add(GLib.PRIORITY_DEFAULT,signal.SIGTERM,lambda:Gtk.main_quit())
Gtk.main()
