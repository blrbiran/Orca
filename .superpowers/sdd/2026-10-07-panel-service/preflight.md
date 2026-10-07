# Pre-flight conflict scan: panel service plan

- Who: read-only pre-flight subagent, session `015m3hAnKcXK1pE3xYwnLTXz`, 2026-10-07.
- Read: `docs/superpowers/plans/2026-10-07-panel-service.md` and its spec, at commit `58d5e5e` (main checkout, unchanged; this worktree is at the same commit).
- Code spot checks: the same commit. No file in any repository was modified. The one probe ran in a temp directory that has since been removed (see A-T1).
- Each row has a recommended ruling, chosen as the smallest change consistent with the spec. "consistent" means no change is needed.

## 1. Task pairs that share a file or an interface

| # | Tasks | Produced vs consumed | Finding | Ruling |
|---|---|---|---|---|
| P1 | T1 → T3 | T1 builds `dist/cli.js`. `checkDist` reads `join(checkout,"dist","cli.js")` | consistent | — |
| P2 | T1 → T12, T13 | The gate and smoke run `node dist/cli.js panel run --service` | consistent | — |
| P3 | T2 → T3, T11 | `ServiceRejection(code, message)`. T11 passes `panelDir: paths.panelDir` into `buildServiceConfig` | consistent | — |
| P4 | T2 → T4 | `ServicePaths.{envFile, runScript, outLog, errLog, panelDir, label}` are used by the renderers | consistent | — |
| P5 | T2 → T5 | `testPaths(root)` sets all five relocation variables | consistent | — |
| P6 | T2 → T9 | `panelDir(env)` is exported in T2 and imported by `src/entry/discovery.ts` | consistent | — |
| P7 | T2 setup file → T9, T12 | The discovery criteria rely on the relocated `ORCA_PANEL_DIR`. The smoke overrides every variable | consistent | — |
| P8 | T3 → T4, T5 | `ServiceConfigV1` matches. T5 `files.ts` imports `SERVICE_CONFIG_SCHEMA`, which T3's code exports but T3's **Interfaces** block does not list | The code is consistent. The interface list is incomplete | Add `SERVICE_CONFIG_SCHEMA` to T3's Produces list (doc-only) |
| P9 | T3 → T11 | `buildServiceConfig({args, env, execPath, checkout, home, panelDir})`. `isDirectory` is optional | consistent | — |
| P10 | T4 → T5 | `writeServiceFiles` renders `renderServiceEnv`/`renderRunSh` before it writes anything. T5 expects the refusal code `service-env-value-unsupported` from T4 | consistent | — |
| P11 | T4 → T6, T7, T11 | `renderPlist(paths)`, `renderUnit(config, paths)`. The dry run uses all four renderers | consistent | — |
| P12 | **T5 → T6, T7, T10, T11** (fake tools) | The `SCRIPT` consumes its exit-code queue with `tail -n +2 "$queue"`. `tail` is one of the faked names, and `${bin}` comes first on `PATH`. The fixture comment ("/usr/bin:/bin stay on PATH for head/tail/mv … the fakes shadow nothing there") is false | **mismatch.** Every consumed code also logs a `tail -n +2 …codes` line and empties the queue. These go red: T5 "logs argv, consumes queued exit codes in order" (exact `toEqual`); T6 install (`bootout [113]`, exact `toEqual`); T6 retry `[5,5,0]` (the second bootstrap gets 0); T6 deadline (returns 0, not 1); T6 `it.each` kickstart 3/113/125 (exact `toEqual`) | Change the line in `SCRIPT` to `sed '1d' "$queue" > "$queue.next"` (`sed` is not faked; `/usr/bin/tail` also works), and correct the comment |
| P13 | T5 → T8 | `instance.ts` uses `readTextOrNull` and `writePrivateFile`. `servicePanel.ts` uses `ensurePrivateDir` | consistent (but see P20) | — |
| P14 | T6 → T7 | `ServiceManager`, `ServiceContext`, `fakeContext`. `ctx.user` is "ann", so the fake logs `loginctl show-user ann -p Linger` | consistent | — |
| P15 | T6 → T8 | T6 creates `processInfo.ts` and T8 tests it (stated in T6 Files) | consistent | — |
| P16 | T6 → T9 | `ManagerState {loaded, state, pid}` feeds `statusLines` | consistent | — |
| P17 | T6 → T10 | `waitExit`, `ctx.startWaitMs`, `ctx.startTimeOf` | consistent | — |
| P18 | T6 ↔ T10 | `launchd.logs` and `detached.logs` are character-for-character the same `ctx.run("tail", ["-n", …, ...(follow?["-F"]:[]), outLog, errLog], {env, inherit:true}).code` | defect (verbatim duplicated logic) | Export `tailLogs(ctx, opts)` from `manager.ts`, and have both managers call it |
| P19 | T7 → T11 | `systemdEnv` and `realRuntimeProbe` are exported and used by `selectManager` | consistent | — |
| P20 | T3/T5/T8 → T9 | `discovery.ts` (loaded by `orca control` and `orca mcp serve`) imports `service/instance.js`. That module imports `files.js`, which imports `config.js` (a value import of `SERVICE_CONFIG_SCHEMA`), which imports `../panel/server.js` (express, the control runtime). Reading one JSON file would load the whole panel server module | defect (coupling; the agent entry path gets heavier) | Move the generic helpers (`ensurePrivateDir`, `ensurePrivateFile`, `writePrivateFile`, `readTextOrNull`, `tailLines`) into a leaf `src/service/privateFiles.ts` that imports only `node:fs`, `node:path` and `node:crypto`. `files.ts` re-exports them and keeps `writeServiceFiles`/`readServiceConfig`. `instance.ts` imports the leaf. The accounts plan reuses the same leaf (see its X11) |
| P21 | T8 → T9, T10 | `PanelJsonV1 {pid, startTime, url, socketPath, version}`. `fakePanel.mjs` writes the same fields and reads the start time with the same `ps -o lstart=` under `LC_ALL=C` | consistent | — |
| P22 | T8 ↔ T11 (`src/cli.ts`) | T8 adds the `--service` branch inside `runPanel`. T11 dispatches `panel run` to `runPanel(rest.slice(1))`. Before T11, `panel run --service …` reaches `runPanel(["run","--service",…])`. `parsePanelArgs` ignores unknown words (lookup by `indexOf`, `server.ts:82-90`), so the T8 criteria pass before T11 | consistent (T11 mutation (b) correctly predicts it is equivalent) | — |
| P23 | T9 → T10, T11 | `identifyPanel(file)` and `statusLines(kind, state, identity, errTail, errLog)` have the same signatures at every call site | consistent | — |
| P24 | T10 ↔ T11 | The CLI criterion for `panel start --detach` with `ORCA_SERVICE_MANAGER=detached` (D15) goes green only after T11. T10 Step 3 says so | consistent | — |
| P25 | T11 ↔ T2, T12 | `ORCA_SERVICE_CHECKOUT` (D15) is used only by `command.test.ts`. The smoke uses the real checkout | consistent | — |
| P26 | T0 ↔ T1–T14 | Every D1–D20 is cited by the task that implements it (D16 in T12, D19 in T6 `uninstall`, D20 in T11 `restart`) | consistent | — |
| P27 | T14 ↔ T3 | `PANEL_SH_ARGS`/`PANEL_SH_ENV` were compared with `~/.orca/panel.sh` at pre-flight (read only): same flags and the same three exports | consistent (no drift) | — |
| P28 | T8 ↔ `server.ts` | `runServicePanel` waits on `started.closed`. The SIGTERM/SIGINT drain is registered inside `createPanelServer` (`server.ts:281-298`), so the service path keeps the signal handling | consistent | — |

## 2. Each task checked against itself and against current code

| # | Task | Check | Finding | Ruling |
|---|---|---|---|---|
| A-T0 | 0 | Appends §10 to the spec | Append-only, so it satisfies Rule 13 | — |
| A-T1 | 1 | Test 2 (compiled CLI under plain node) on macOS | **mismatch.** `out = mkdtemp(tmpdir())` is under `/var/folders`, which is a symlink to `/private/var`. Node sets `import.meta.url` to the real path, but `process.argv[1]` keeps `/var/…`, so the main-module guard at `src/cli.ts:597` is false. `node out/dist/cli.js` then exits 0 with empty stderr, and `expect(usage.status).toBe(1)` goes red. Measured at pre-flight: a module in `mkdtemp(os.tmpdir())` printed `argv[1]=/var/folders/…`, `import.meta.url=file:///private/var/folders/…`, equal=false. The plan-time probe ran under `/private/tmp`, which is not a symlink, so it missed this | Use `const out = await realpath(await mkdtemp(...))` in the test. Optional one-line hardening: `buildServiceConfig` realpaths the entry, so a symlinked `ORCA_SERVICE_CHECKOUT` cannot install a service that exits 0 silently |
| A-T1b | 1 | `package.json` and `.gitignore` | The `typecheck` script exists. `verify` starts `npm run typecheck && npm test`, so the insertion point exists. `dist/` is already in `.gitignore`. 2 tests | consistent |
| A-T2 | 2 | `relocateUserData.ts` | The `ORCA_PROJECTS_FILE` line and the `afterAll` ~/.orca expectation exist. `statSync`/`homedir` are already imported. The relocated root is under the scoped TMPDIR, not under HOME. 4 tests | consistent |
| A-T3 | 3 | `parsePanelArgs` and `panelArgsWithDefaultProjects` | Both exist with `(args, env)` signatures. Parsing is pure for `--repo` args (`controlOptions.ts` performs no I/O). `--profile` and `--plan` (`planId=repoId=path`) are real flags. `Dirent.parentPath` exists on Node 22.13. 7 tests. Note: with no `--repo`/`--root`/`--projects-file`, the parse **reads** the projects file. That is a read only, and no criterion hits it | consistent |
| A-T3b | 3 | Mutation (a) text | Deleting the `continue` makes `isAbsolute(undefined)` throw a TypeError. That is red, but for another reason | Mutate only the `isAbsolute` check and record the red |
| A-T4 | 4 | Snapshots and escapes | Recomputed `systemdQuote`, `shQuote`, `xmlEscape` and the round trip by hand. 7 tests (plutil runs on macOS) | consistent |
| A-T5 | 5 | `files.test.ts` "writes … nothing when one of them is refused" | **defect.** `expect(renderServiceEnv(config)).not.toBe(renderRunSh(config, paths))` compares two different renderers and can never be red | Delete the line |
| A-T5b | 5 | Mutation (a), the chmod loop | It is equivalent under umask 077 and 002 alike: 0700 has no group or other bits, so no umask that lets `mkdir` succeed changes it. Only an owner-bit umask (for example `0o200`) on a **single-level** create goes red | Run (a) with `process.umask(0o200)` and a one-level `ensurePrivateDir`, or record it as equivalent (the plan allows this) |
| A-T6 | 6 | Count, imports, spec §4 macOS table | 16 tests (13 + 3 `it.each`). The steps match the spec table. `fakeContext`'s imports are placed mid-file. ESM hoists them, but they belong at the top | Move the `fakeContext` imports to the top of the fixture (style) |
| A-T7 | 7 | Count | Step 4 says "PASS" with no count. There are 7 tests | State 7 |
| A-T8 | 8 | Cited seams | The `listen` arm (`server.ts:245-250`) and the socket block (`:259`) exist as described. `PanelRejection(code, message, exitCode)` exists. `PanelExitCode` is `1\|4\|5` today | consistent |
| A-T8b | 8 | `instance.test.ts` "leaves a log under the limit alone" | **defect.** `truncateSync(log, 0)` runs after the last assertion and has no effect | Delete it |
| A-T8c | 8 | M-acc in `servicePanel.test.ts` | The guarded assertion is vacuous until the accounts plan lands. That is stated, and handled by the accounts preflight (X4) | — |
| A-T9 | 9 | `requestOverSocket`, `discoverSocketPath`, `EntryRejection` | Signatures match (`socketClient.ts:16`, path prefixed `/api/control/`). `cli:orca-service-status` matches `CLIENT_PATTERN`. `isSocket` exists in `discovery.ts` | consistent |
| A-T9b | 9 | Other callers with explicit env objects | `tests/entry/controlCommand.test.ts:5` has a default env with no `ORCA_PANEL_DIR`. After T9 it would read the real `~/.orca/panel/panel.json`, and would find the human's service once it is installed (Rule 17) | Add `ORCA_PANEL_DIR: "/nonexistent/panel"` to that default (the plan's grep step, named here) |
| A-T10 | 10 | Fixture and paths | The socket path is about 85 bytes under the scoped TMPDIR. `run.sh` `exec`s node, so the spawn pid is the panel pid. Mutation (d) may be equivalent, as the plan acknowledges | consistent |
| A-T11 | 11 | Branch `service-detach-required` | **conflict with spec §8 and Rule 9.** No criterion covers it: mutation (f) says "covered by selection only — record". It cannot be reached on macOS because `runServiceCommand` reads `process.platform` | Export a pure `startNeedsDetach(kind, auto, detach)`, used by the `start` case, and add one assertion to `command.test.ts`. The weaker alternative is to record it as an uncovered branch in the ledger |
| A-T11b | 11 | `logs` exit code | **conflict with the Global Constraint** ("`orca panel <service subcommand>`: 0 success, 1 anything else"). `logs` returns tail's or journalctl's raw code (130 on Ctrl-C under `-f`, 1, 127) | Use `case "logs": return manager.logs(ctx, parseLogs(rest)) === 0 ? 0 : 1;` |
| A-T11c | 11 | Test seams | `captureStreams` exists (`tests/scheduler/sandbox.ts:397`, returns `{result, stdout, stderr}`). `main` is exported. Each pinned USAGE substring falls on one line of the planned text. The SKILL.md bullet "You must never start a panel" exists (line 17). `skill.test.ts` counts routes from `controlApi.ts`, so a bullet does not change the count | consistent |
| A-T12 | 12 | `expect(label).not.toBe(DEFAULT_SERVICE_LABEL)` | **defect** (Rule 9 corollary 2). It asserts a value the test built itself, so it cannot go red | Replace it with `expect(existsSync(join(root,"la",`${label}.plist`))).toBe(true)` after install, or drop it |
| A-T12b | 12 | `second !== first` after restart | Flaky: `untilStatus(0)` can return while the old instance still answers (a `kickstart -k` race) | Loop until the status stdout differs from `first` |
| A-T12c | 12 | Residue in the real launchd | Each run's `launchctl enable gui/<uid>/dev.orca.panel.smoke-<random>` leaves a persistent override entry in launchd's per-user disabled database, which nothing clears. It is not the human's service, but it is an out-of-repo write | Use the fixed label `dev.orca.panel.smoke` (one reused entry), and register the write in spec §10 (Rule 17, third bullet) |
| A-T12d | 12 | Socket path length | `…/T/orca-tmp-XXXXXX/rs-XXXXXX/c/s-xxxxxxxx/control.sock` is about 100 bytes on this host, against a limit of 103. Under D13 an overflow exits 78 | Shorten the temp prefix (`mkdtemp(join(tmpdir(), "r"))`) and say why in the smoke comment |
| A-T13 | 13 | Commands exist | `verify:panel`, `verify:control`, `scripts/check-tmp-leak.mjs`, `--ws check`, and `build` (after T1) all exist | consistent |
| A-T14 | 14 | `panel.sh` drift | None (P27) | consistent |

## 3. Global Constraints, the spec, and defects a reviewer would flag

| # | Item | Finding | Ruling |
|---|---|---|---|
| G1 | D1 vs spec §4 `Restart=always` | The contradiction is surfaced and decided in §10 (Rule 7), not averaged | consistent |
| G2 | D2 vs spec §5 "before binding, the panel takes … lock" | Narrowed to `--service`, with reasons recorded (Rule 17) | consistent |
| G3 | Global exit codes vs `logs` | See A-T11b | as A-T11b |
| G4 | Spec §8 / Rule 9 "every new branch … seen red" | A-T11 (`service-detach-required`) is genuinely uncovered. T5(a) and T10(d) are acknowledged equivalents | as A-T11 |
| G5 | Global "never touch `~/.orca` in any criterion" | Writes: none found. Reads: A-T9b (fix) and A-T3's projects-file read (no criterion reaches it) | as A-T9b |
| G6 | Spec §5 "`status` reports the bind error from the log" | `systemd` passes `errTail = []` (the journal), so Linux status shows no bind error. The spec sentence is about launchd | consistent. Optional: `journalctl --user -u <unit> -n 5` for systemd |
| G7 | Reviewer-visible defects | Vacuous assertion (A-T5), dead line (A-T8b), self-built assertion (A-T12), duplicated logs logic (P18), heavy import chain (P20) | as listed |
| G8 | Rule 14 | Every verification command redirects to a file. `git diff \| wc -c` is the restore proof that CLAUDE.md Rule 15 mandates | consistent |
| G9 | The new plist/unit guard in `relocateUserData.ts` | If the human runs `orca panel install` while a test file is running, that file goes red spuriously (mtime changes). Low risk | No change. Note it in the ledger |

Row counts: §1 28, §2 26, §3 9; 63 in total.
