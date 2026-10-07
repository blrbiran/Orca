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

## 10. Plan-time decisions (2026-10-07, session 9a20ac38)

- D1. The unit uses `Restart=on-failure`, not §4's `Restart=always`. §5 requires that a second instance exiting 0 "does not loop" under systemd; `Restart=always` restarts after a clean exit too, so the two sentences contradict and §5's behaviour is the one that matters. `on-failure` with `SuccessExitStatus=0 143` and `RestartPreventExitStatus=78` matches launchd's `KeepAlive={SuccessfulExit:false}`.
- D2. The single-instance lock, `panel.json`, log rotation and exit 78 belong to `orca panel run --service` only — the form `run.sh` and the unit execute. Plain `orca panel` / `orca panel run` are unchanged: dozens of criteria boot panels concurrently, and a lock in `~/.orca/panel` would make all but one exit 0 and would write into the real home (Rule 17).
- D3. Captured variables add `ORCA_CORRECTIONS_DIR`, `ORCA_PROJECTS_FILE` and `ORCA_PANEL_DIR` to §3's list: a relocated install (the opt-in smoke) must keep every user-data path relocated inside the service, or the service writes the real `~/.orca`.
- D4. The build is `tsc -p tsconfig.build.json` with `rootDir: src`, `outDir: dist`, so `src/cli.ts` → `dist/cli.js` and `src/panel/x.ts` → `dist/panel/x.js`. Modules locate the checkout as `../..` from their own file (`staticFiles.ts`, `chains.ts`, `chain/run.ts`, `level/invocation.ts`); that stays the checkout root from `dist/`. `npm run verify` runs the build so a `src` import from outside `src` (TS6059) is caught.
- D5. The unit names `service.env` and the working directory by absolute path (escaped `%` → `%%`) instead of `%h/.orca/panel`: identical for the default, and correct for a relocated panel directory.
- D6. A relative path in a path-valued panel flag (`--repo`, `--root`, `--profile`, `--projects-file`, `--control-state-dir`, `--dist`, `--plan`) or captured variable is refused at install (`service-path-not-absolute`), not resolved against the installing shell's directory.
- D7. Install validates the panel arguments with the panel's own parser (`parsePanelArgs`) and refuses before writing anything (`service-panel-args-invalid`).
- D8. `service.env` lines are `KEY="value"`, readable by both `/bin/sh` (`set -a; . file`) and systemd `EnvironmentFile=`. A value containing `"`, `\`, `$`, a backtick or a line break is refused (`service-env-value-unsupported`) rather than escaped two different ways.
- D9. A process's start time is `ps -o lstart= -p <pid>` with `LC_ALL=C`, on both platforms (one-second resolution).
- D10. The lock is created by `link()` from a complete temp file, so no reader sees a half-written lock; a stale lock is removed only if its bytes are unchanged since it was judged stale.
- D11. Log rotation is copy-truncate: launchd opens `StandardOutPath`/`StandardErrorPath` before the panel runs, so a rename would leave the panel writing into the rotated file.
- D12. With no control socket (`--no-control`), liveness is `GET /` on the panel's URL; with a socket it is `GET /api/control/summary` over the socket (§5).
- D13. In service mode a control-socket bind failure also exits 78 (§5 says "port or socket"); outside service mode it stays fail-soft (agent entry spec §3).
- D14. `orca panel start --detach` forces the detached manager. When no manager is detected, `start` without `--detach` is refused (`service-detach-required`), so the person types the flag that says "no restart, no reboot survival".
- D15. Test relocation knobs beyond Rule 17's paths: `ORCA_SERVICE_MANAGER` (`launchd|systemd|detached`) and `ORCA_SERVICE_CHECKOUT` (the checkout whose `dist/cli.js` is installed; default: the running checkout).
- D16. The Linux real smoke is not in this round: no Linux host, and `systemctl --user enable` writes a `default.target.wants` link into the real `~/.config/systemd/user`. Linux behaviour is pinned by generator snapshots and fake-tool sequences only; a real Linux smoke is an open item.
- D17. `orca panel install --dry-run <args>` prints every file it would write and runs no tool, so the person can compare it to their launcher before anything touches launchd.
- D18. The systemd preflight (XDG_RUNTIME_DIR, DBus, linger) runs before every `systemctl --user` command (§4 "before any").
- D19. `uninstall` removes exactly what §4 lists (plist or unit, and `run.sh` on macOS); `service.json`, `service.env` and logs stay.
- D20. Restart re-renders `service.env` and `run.sh` from `service.json` before asking the manager, so an Orca upgrade that changes the renderer takes effect on restart.

## 11. Execution-time corrections (2026-10-07, session 30bd7e40)

These record where the implementation departs from or sharpens §1–§10. Each was decided during execution and recorded as a `Ruling:` in `.superpowers/sdd/2026-10-07-panel-service/progress.md`; §1–§10 are left verbatim.

- **Relative path overrides.** The spec did not say what a relative override means. `servicePaths` now refuses a relative `ORCA_PANEL_DIR`, `ORCA_LAUNCH_AGENTS_DIR`, `ORCA_SYSTEMD_USER_DIR` or `XDG_CONFIG_HOME` (when used) with `service-path-not-absolute`; discovery ignores a relative `ORCA_PANEL_DIR` and never writes through it. A relative path would resolve against whatever cwd the caller happens to have, so service files could land anywhere.
- **Main-module guard.** The built CLI's main-module guard compares real paths. An install reached through a symlink (for example macOS `/var` → `/private/var`) otherwise failed the string comparison and exited 0 silently without doing anything.
- **`ensurePrivateDir`.** The spec's 0700 rule is implemented by creating each missing level itself (mkdir plus chmod 0700 per level), because a recursive mkdir fails with EACCES under a restrictive umask. Existing directories are never chmod'ed (Rule 17: not the human's data to re-mode).
- **service.env keys.** Keys are validated against `^[A-Za-z_][A-Za-z0-9_]*$` (otherwise `service-config-invalid`) and sorted by the renderer. This keeps the rendered plist/unit/run.sh injection-safe and its bytes deterministic.
- **§4 Linux restart and install.** `restart` always runs `daemon-reload` first, since a rewritten unit whose reload failed would otherwise be restarted stale. `install` is `enable` + `restart`, not `enable --now`, because `enable --now` leaves an already-active old panel running.
- **D18 linger.** `status` and `logs` use a read-only preflight: they report "linger is off" and never run `loginctl enable-linger`. Only install/start/restart enable linger, so a read-only command never changes the user's system.
- **§9 launchctl exit codes.** Following "never trust a launchctl exit code", install/start/restart wait (bounded) for the panel to answer identify, ignoring a panel that was already answering beforehand. `status` decides "installed" from the plist/unit/run.sh file, never from systemd `loaded`, which can be true for a unit that is not installed.
- **§5 `run --service` ordering.** The version is computed before bind, and a failure after bind closes the server before the lock is released, so a failed start never leaves a bound socket without a lock holder. Only the lock holder rotates logs.
- **§5 discovery liveness.** panel.json's socket is used only while its pid is alive (kill 0; EPERM counts as alive); a dead pid falls through to the agent-entry §14 legacy scan. Known limitation: a reused pid still wins and then fails loudly with `panel-not-running`.
- **Detached manager `stop`.** `stop` refuses an unparseable panel.json by name (exit 1) instead of reporting "nothing to stop", which would hide a possibly running panel. ESRCH between the check and the kill counts as stopped.
- **Repo-external write registration (Rule 17).** The opt-in real smoke (`ORCA_SERVICE_REAL=1`, human-authorized only) uses the fixed label `dev.orca.panel.smoke`. `launchctl enable` leaves one persistent override entry for that label in the user's launchd database, removed only by the OS; its temp root under /tmp is removed in `afterAll`.
