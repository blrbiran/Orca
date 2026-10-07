# Panel as a per-user service — design

Session 9a20ac38, 2026-10-07. Status: draft for human review.

## 1. Human rulings

- S1. The panel must run as a daemon, never attached to the shell (or agent session) that started it.
- S2. Cross-platform: macOS and Linux are the targets. (Same constraint as the accounts spec, H2.)
- S3. Model on how openclaw and hermes-agent do it (research authorized; summary in §9).

## 2. Shape

Orca does not daemonize itself (no double fork, no pid-file daemon). It writes a per-user service definition and lets the platform's service manager start, keep alive and restart one foreground process:

- macOS: a launchd LaunchAgent, `~/Library/LaunchAgents/dev.orca.panel.plist`.
- Linux: a systemd user unit, `${XDG_CONFIG_HOME:-~/.config}/systemd/user/orca-panel.service`.
- Neither available (container, WSL without systemd): `orca panel start --detach` spawns a detached process (`spawn(..., {detached:true, stdio:[ignore, log, log]}).unref()`) and says plainly that it neither restarts on crash nor survives a reboot.

The process the manager runs is today's foreground `orca panel` (renamed in help to `orca panel run`, the old form kept as an alias).

## 3. Configuration the service carries

A service does not inherit the shell, so everything the panel needs is recorded at install time in `~/.orca/panel/service.json` (0600, explicit mode):

- the panel arguments (`--by`, `--port`, `--repo …`, `--profile`, estimator flags) and the environment variables Orca reads (`ORCA_AGENTS_TABLE`, `ORCA_CCMEM_BIN`, `ORCA_SYNCSKILL_BIN`, `ORCA_CCLOOP_BIN`, `ORCA_CONTROL_DIR`, `SYNCSKILL_DIR`, `CCMEM_DATA_ROOT`) — taken from `orca panel install <panel args>` and from the installing shell's environment, only for the named variables;
- `node`: absolute `process.execPath` at install time; a warning when it lives under a version manager (`~/.nvm`, fnm, volta), since uninstalling that version breaks the service; `orca panel install` re-run after a node change repairs it;
- the entry: absolute path of the built `dist/cli.js` (the service never runs tsx from a checkout's `node_modules/.bin`); install refuses when `dist` is missing or older than `src` and says to run `npm run build`;
- `PATH`: dirname(node) + `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin` (only existing directories); `HOME`; `NODE_OPTIONS=""`.

The plist / unit is generated from `service.json` by a pure function (snapshot-testable). The plist runs `/bin/sh <state>/panel/run.sh`, which sources `service.env` (0600) and execs node — so secrets and env values are not inline in the plist (openclaw's layout). The unit uses `EnvironmentFile=` for the same file.

## 4. Commands

`orca panel install [panel args]`, `uninstall`, `start`, `stop`, `restart`, `status`, `logs [-f] [-n N]`.

macOS (domain `gui/<uid>` when `launchctl managername` answers Aqua, else `user/<uid>`):

| command | steps |
|---|---|
| install | write `service.json`, `service.env`, `run.sh`, plist → `launchctl bootout <dom>/<label>` (errors ignored) → `enable` → `bootstrap <dom> <plist>`; exit 5 (stale) → bootout, retry until a deadline |
| start | `kickstart <dom>/<label>`; not loaded (3/113/125) → bootstrap |
| stop | `bootout <dom>/<label>` (a stopped but loaded job can respawn under KeepAlive) |
| restart | if the generated plist differs from disk: rewrite, bootout, wait for the pid to exit (≤ ExitTimeOut + 10 s), bootstrap; else `kickstart -k` |
| status | `launchctl print <dom>/<label>` (state, pid) **and** a socket identify (§5); never the launchctl exit code alone |
| uninstall | bootout, remove plist and `run.sh` (keeps `service.json` and logs) |

Plist keys: `Label`, `ProgramArguments=[/bin/sh, run.sh]`, `RunAtLoad=true`, `KeepAlive={SuccessfulExit:false}`, `ThrottleInterval=10`, `ExitTimeOut=20`, `ProcessType=Interactive`, `StandardInPath=/dev/null`, `StandardOutPath`/`StandardErrorPath` = `~/.orca/panel/logs/panel.{out,err}.log`, `WorkingDirectory=~/.orca/panel`, `SoftResourceLimits.NumberOfFiles=4096` (launchd's soft default is 256; Orca's per-task fd cost makes that matter).

Linux:

| command | steps |
|---|---|
| install | write files and unit → `systemctl --user daemon-reload` → `enable --now orca-panel` |
| start/stop/restart | `systemctl --user <verb> orca-panel` (restart rewrites the unit and daemon-reloads first when it changed) |
| status | `systemctl --user show orca-panel -p ActiveState,SubState,MainPID,NRestarts` **and** socket identify |
| logs | `journalctl --user -u orca-panel` |
| uninstall | `disable --now`, remove unit, daemon-reload |

Unit: `After=/Wants=network-online.target`, `StartLimitBurst=10`, `StartLimitIntervalSec=300`, `ExecStart="<node>" "<dist/cli.js>" panel run`, `EnvironmentFile=%h/.orca/panel/service.env`, `WorkingDirectory=%h/.orca/panel`, `Restart=always`, `RestartSec=5`, `RestartPreventExitStatus=78`, `SuccessExitStatus=0 143`, `KillMode=mixed`, `TimeoutStopSec=30`, `LimitNOFILE=4096`, `WantedBy=default.target`. `%` in values is escaped as `%%`; CR/LF refused.

Linux preflight before any `systemctl --user`: set `XDG_RUNTIME_DIR=/run/user/<uid>` when unset or not ours; set `DBUS_SESSION_BUS_ADDRESS` when `$XDG_RUNTIME_DIR/bus` exists; check linger (`loginctl show-user $USER -p Linger`) and, when off, try `loginctl enable-linger $USER` and otherwise print `sudo loginctl enable-linger $USER` (without linger the panel stops at logout). No `sudo` is ever run by Orca.

## 5. Single instance and discovery

- Before binding, the panel takes an `O_EXCL` lock `~/.orca/panel/panel.lock` holding `{pid, startTime}`. A lock whose pid is dead, or whose process start time differs (pid reuse), is stale and taken over.
- When a live panel holds the lock, the new process exits 0. Under launchd that parks the job (`KeepAlive={SuccessfulExit:false}` does not respawn a clean exit); under systemd the unit treats 0 as success and does not loop.
- When the port or socket bind fails for another reason (another program holds the port), the panel exits 78: systemd stops retrying (`RestartPreventExitStatus=78`); launchd retries at `ThrottleInterval`, and `status` reports the bind error from the log.
- `~/.orca/panel/panel.json` (atomic write): `{pid, startTime, url, socketPath, version}`. `status` and `orca control` discovery read it; liveness is a socket request (`GET /api/control/summary` over the socket), never the pid alone.
- Signals: SIGTERM/SIGINT drain as today. No SIGUSR1 (Node's inspector).

## 6. Logs

stdout/stderr to `~/.orca/panel/logs/` on macOS and the detached fallback; on start the panel rotates them when over 10 MiB (keep 3). The journal on Linux. The initial-password line (accounts spec §3.2) names the file, never the password.

## 7. What changes elsewhere

- `~/.orca/panel.sh` (hand-written launcher) is superseded by `orca panel install`; the install command reads the same flags. The human's current flags migrate one-to-one.
- Agents never start or stop the service on their own: `install`/`uninstall`/`stop` touch the human's running system. They stay human-run commands (not Tier 0 git operations, but listed in the skill as "ask the human").

## 8. Criteria (outline)

- Plist and unit generation: snapshot from a fixed `service.json`; escaping (`%`, quotes, CR/LF refused); only named env vars captured.
- Install refuses a missing/stale `dist`.
- Command sequences against a fake `launchctl` / `systemctl` / `loginctl` on PATH that logs argv: exact order for install/start/stop/restart/uninstall, the exit-5 retry, the 3/113/125 → bootstrap path, the "plist changed → bootout+bootstrap" vs "unchanged → kickstart -k" branch.
- Status combines manager state with a real socket identify (a manager that says "running" while the socket is dead → reported as not answering).
- Second instance: exits 78 on a held port; lock held by a live pid → exit 0; stale lock (dead pid / start-time mismatch) is taken.
- Detached fallback: process survives its parent's exit; stop verifies start time before SIGTERM.
- One real smoke per platform, opt-in (`ORCA_SERVICE_REAL=1`), under a relocated label and state dir, never the human's service. Every new branch gets its own deletion mutation seen red.

## 9. Research summary (openclaw, hermes-agent)

Both write per-user launchd/systemd definitions and run a foreground server under them; neither daemonizes itself. Shared lessons adopted here: stop with `bootout` (not `unload`/`stop`, KeepAlive revives a loaded job); refresh the definition before restart (`kickstart -k` reuses the old plist); bound bootstrap retries (the label stays reserved during drain); never trust a launchctl exit code, check a live pid / endpoint; bake absolute node + curated PATH (services skip shell init; nvm paths break); linger on Linux; raise launchd's 256 fd soft limit. Not adopted for v1: openclaw's transactional install rollback, system-scope units / LaunchDaemons, Windows, hermes's osascript Local Network wrapper (the panel makes no LAN connections from the service).
