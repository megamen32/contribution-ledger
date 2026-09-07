# Private pilot on server 100

The units are intentionally specific to this existing host, not a generic deployment platform.
Binary: `/opt/contribution-ledger/contribution`.
Data/key: `/home/roomhacker/.local/share/contribution-ledger/`.
Optional environment overrides: `/etc/contribution-ledger.env` (no key contents).
The server binds `192.168.2.100:8766`, not every network interface. Use only on the private
network/VPN; this deployment is not an Internet-facing HTTPS service.

Initialize as roomhacker before starting the units:
```
sudo -u roomhacker -H /opt/contribution-ledger/contribution init --data /home/roomhacker/.local/share/contribution-ledger
```
Install the two unit files under `/etc/systemd/system`, run `systemctl daemon-reload`, start
web first and verify `/health`, then start worker. Do not run against smoke/test data.

Updating: test source and native binary first, keep the prior binary outside the data directory,
stop these two units only, atomically replace the executable, start web/worker, verify health.
If verification fails, restore the previous binary. Never overwrite the database or team key.

`OMNIROUTE_API_KEY_FILE` must refer to a team-owned key allowed to execute completions.
Do not repurpose another application's credentials or edit the installed OmniRoute runtime.
Screenpipe is not started or stopped by these units. Each participant controls local recording;
only explicitly reviewed interval exports enter the ledger.
