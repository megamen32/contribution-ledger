#!/usr/bin/env python3
"""Finite emergency wall/disk bounds for this build's exact owned process group."""
import argparse,os,signal,subprocess,time
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--cache',required=True);p.add_argument('--seconds',type=int,default=6000);p.add_argument('command',nargs=argparse.REMAINDER);a=p.parse_args()
command=a.command[1:] if a.command[:1]==['--'] else a.command
child=subprocess.Popen(command,start_new_session=True);start=time.monotonic();failed=None
try:
 while child.poll() is None:
  total=sum(f.stat().st_size for f in Path(a.cache).rglob('*') if f.is_file())
  if total>15*1024**3:failed='Owned build disk budget exceeds15GiB';break
  if time.monotonic()-start>a.seconds:failed='Emergency wall budget exceeded';break
  time.sleep(10)
 if failed:
  print(failed,flush=True);os.killpg(child.pid,signal.SIGTERM)
  try:child.wait(timeout=10)
  except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait()
  raise SystemExit(1)
 raise SystemExit(child.returncode)
finally:
 if child.poll() is None:os.killpg(child.pid,signal.SIGTERM)
 print('elapsed_seconds='+str(round(time.monotonic()-start,2)),flush=True)
