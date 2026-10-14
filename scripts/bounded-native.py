#!/usr/bin/env python3
"""Own native build emergency bounds on macOS where RSS rlimits are not enforced."""
import argparse,os,resource,signal,subprocess,time
p=argparse.ArgumentParser();p.add_argument('--ram-mib',type=int,default=2048);p.add_argument('--seconds',type=int,default=300);p.add_argument('command',nargs=argparse.REMAINDER);a=p.parse_args()
cmd=a.command[1:] if a.command[:1]==['--'] else a.command
resource.setrlimit(resource.RLIMIT_CPU,(a.seconds,a.seconds))
child=subprocess.Popen(cmd,start_new_session=True);start=time.monotonic();peak=0
try:
 while child.poll() is None:
  rows=[tuple(map(int,l.split())) for l in subprocess.check_output(['ps','-axo','pid=,ppid=,rss='],text=True).splitlines() if len(l.split())==3]
  own={child.pid}
  while True:
   more={pid for pid,ppid,rss in rows if ppid in own};new=more-own
   if not new:break
   own.update(new)
  rss=sum(rss for pid,ppid,rss in rows if pid in own);peak=max(peak,rss)
  if rss>a.ram_mib*1024 or len(own)>256 or time.monotonic()-start>a.seconds:
   os.killpg(child.pid,signal.SIGTERM);child.wait(timeout=10);raise RuntimeError('Owned native emergency resource bound exceeded')
  time.sleep(.5)
 raise SystemExit(child.returncode)
finally:
 if child.poll() is None:os.killpg(child.pid,signal.SIGTERM)
 print('native_build_elapsed_seconds='+str(round(time.monotonic()-start,2))+' peak_rss_kib='+str(peak),flush=True)
