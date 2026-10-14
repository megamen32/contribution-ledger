#!/usr/bin/python3
"""Visible acceptance window on the test's private desktop, separate from the recorder app."""
import signal
import gi
gi.require_version('Gtk','3.0')
from gi.repository import Gtk,GLib
GLib.set_application_name('CaptureAcceptance')
w=Gtk.Window(title='Capture acceptance');w.set_default_size(1100,100)
label=Gtk.Label();label.set_markup('<span size="32000" foreground="black" background="white">VKLAD REAL DESKTOP CAPTURE 314159</span>');w.add(label)
w.show_all();w.move(60,790);w.present()
GLib.unix_signal_add(GLib.PRIORITY_DEFAULT,signal.SIGUSR1,lambda:(w.present(),False)[1])
GLib.unix_signal_add(GLib.PRIORITY_DEFAULT,signal.SIGTERM,lambda:(Gtk.main_quit(),False)[1])
Gtk.main()
