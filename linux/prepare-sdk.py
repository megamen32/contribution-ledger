#!/usr/bin/env python3
"""Build-only SPA headers; no host libraries are replaced. Exact Ubuntu archive packages."""
import hashlib,subprocess,sys,urllib.request
from pathlib import Path
cache=Path(sys.argv[1]).resolve();sdk=cache/'sdk';sdk.mkdir(parents=True,exist_ok=True)
packages=[('libpipewire-0.3-dev','c0b34ed6a34391a94c0711966dbea9b6b5a98758d88813824c05d6662e0b60c9'),('libspa-0.2-dev','6c99d162e23e13cacf8bc3edc312c60545281078398e52e34dc5ebb4209649dc')]
for name,expected in packages:
 p=cache/(name+'_1.0.5-1_amd64.deb')
 if not p.exists():
  with urllib.request.urlopen('https://archive.ubuntu.com/ubuntu/pool/main/p/pipewire/'+p.name,timeout=60) as r:p.write_bytes(r.read())
 assert hashlib.sha256(p.read_bytes()).hexdigest()==expected,'Ubuntu SDK package hash mismatch'
 subprocess.run(['dpkg-deb','--extract',str(p),str(sdk)],check=True)
for p in (sdk/'usr/lib/x86_64-linux-gnu/pkgconfig').glob('*.pc'):
 s=p.read_text().replace('prefix=/usr','prefix='+str(sdk/'usr'))
 # Link Ubuntu22's stable ABI; only compile-time headers come from this SDK.
 s=s.replace('libdir=${prefix}/lib/x86_64-linux-gnu','libdir=/usr/lib/x86_64-linux-gnu')
 p.write_text(s)
print(sdk/'usr/lib/x86_64-linux-gnu/pkgconfig')
