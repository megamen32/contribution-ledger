#!/bin/bash
set -euo pipefail
# Bound client and all WebKit/Screenpipe descendants together on the user's desktop.
exec systemd-run --user --scope --quiet --collect \
  -p MemoryHigh=2G -p MemoryMax=2G -p MemorySwapMax=0 -p CPUQuota=200% -p TasksMax=128 -p IOWeight=50 \
  /usr/bin/python3 /usr/lib/vklad/vklad.py "$@"
