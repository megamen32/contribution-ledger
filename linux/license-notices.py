#!/usr/bin/env python3
import re,shutil,sys
from pathlib import Path
cache=Path(sys.argv[1]);out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
notices=['Bundled Screenpipe is the pinned MIT fork; ee/ is not bundled.','Rust dependency licenses (inclusive list of fetched public build inputs):']
roots=list((cache/'cargo-home/registry/src').glob('*/*'))
for root in sorted(roots):
 manifest=root/'Cargo.toml'
 if not manifest.exists():continue
 text=manifest.read_text();block=text.split('[package]',1)[-1].split('\n[',1)[0]
 def field(name):
  m=re.search(r'^'+name+r'\s*=\s*"([^\"]+)"',block,re.M);return m.group(1) if m else 'not declared'
 notices.append(root.name+': '+field('license'))
 for p in root.iterdir():
  if p.is_file() and p.name.upper().startswith(('LICENSE','COPYING','NOTICE')):
   dest=out/'ThirdPartyLicenses'/root.name;dest.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,dest/p.name)
(out/'THIRD_PARTY_NOTICES.txt').write_text('\n'.join(notices)+'\n')
