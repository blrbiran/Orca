# SDD ledger — plan: docs/superpowers/plans/2026-10-07-panel-service.md

Plan written by Claude Code session 9a20ac38, 2026-10-07, on top of `docs(spec): design the panel as a per-user service; revise accounts per review` (main). Spec: docs/superpowers/specs/2026-10-07-panel-service-design.md (§10 = plan-time decisions D1–D20, appended by Task 0). Execution: subagent-driven, new session, worktree branch `panel-service`.
Controller: (the executing session fills in: session id, date, start commit subject).

## Pre-flight scan

| Pair / task | Produces → consumes | Finding |
|---|---|---|

## Tasks

## Controller (appended by the executing session)

Controller: Claude Code session 30bd7e40 (claude.ai session_015m3hAnKcXK1pE3xYwnLTXz), 2026-10-07. Start commit: `docs(handoff): N2 reviewed; two approved plans (panel service, accounts and spend caps) are next` (= origin main by `git ls-remote`). Worktree `/Users/biran/code/skills/loop/Orca-panel-service`, branch `panel-service`. Gate ccloop: clone of `c3af4d6` built in the session scratchpad. Execution order and worktree placement rulings: see the accounts ledger's Controller section.

## Pre-flight scan (executed)

The table (63 rows, per task pair sharing a file/interface and per task self-consistency) is in `preflight.md` beside this ledger (committed with it). Rulings on its findings:

Ruling: P12 — Task 5's fake tool script consumes its exit-code queue with `tail`, but `tail` is itself faked and first on the test PATH; use `sed '1d'` in the fake script instead — cost if wrong: one fixture line.
Ruling: T1 — on macOS `mkdtemp` under `/var` is a symlink to `/private/var`, so the built CLI's main-module guard never fires and `node dist/cli.js` exits 0 silently; the Task 1 test resolves its temp dir with `realpath` — cost if wrong: none (also tests the real installed path shape).
Ruling: P20 / accounts X11 — `discovery.ts` must not import the panel server module, and both plans define an `ensurePrivateDir` with different behaviour; one dependency-free helper module `src/service/privateFiles.ts` serves both — cost if wrong: a later merge of two helpers.
Ruling: T11 — the `service-detach-required` branch is unreachable on macOS; export a pure check and pin it directly — cost if wrong: none.
Ruling: T11b — `orca panel logs` maps a non-zero `tail`/`journalctl` exit to 1, per the global "0 success, 1 anything else" — cost if wrong: loses the raw code (still printed on stderr by the tool).
Ruling: defects — the never-red assertion (Task 5) and the dead line (Task 8) are replaced by assertions that observe behaviour or dropped; the smoke's self-built label assertion (Task 12) is dropped; the launchd and detached managers share one `tailLogs` helper instead of verbatim duplicate code; the real smoke uses a fixed relocated label so repeated runs do not leave a launchd override entry per random label — cost if wrong: small.

## Tasks (execution)

Task 0: complete (commits 58d5e5e..2e0c8f0) — Ruling: a doc-only verbatim append is reviewed mechanically by the controller instead of a reviewer seat: old spec is a byte prefix of the new one, and the brief's fenced block appears verbatim in the appended tail (4551 bytes = block + separating newline) — cost if wrong: none (byte checks).
Task 1: review Approved (Minors: isMainModule catch swallowed errors; uncleared 30 s timer — plan-mandated; two full tsc builds per test; relative tsc path — brief-mandated). Implementer Rulings accepted by the reviewer: Ruling: the main-module guard realpaths both sides (an install reached through a symlink would otherwise exit 0 silently), pinned by a symlink-invocation test seen red before the fix; Ruling: test temp dir via realpath(mkdtemp); Ruling: the brief's `verify` assertion `toContain("npm run build")` also matched `npm run build --workspace web`, so mutation (c) stayed green — strengthened to `npm run typecheck && npm run build && npm test`.
Task 1: fix round 1/5 (2 addressed, 0 open — guard rethrows non-ENOENT realpath errors, ENOENT falls back to unresolved compare; timer cleared; commits b6fb1f7..66d2f43; mutations e, f seen red, restore 0/0)
Task 1: minor (deferred): each build test runs a full tsc build (slow under load); relative `node_modules/.bin/tsc` path requires vitest from the repo root (brief-mandated); ENOENT fallback `self === entry` is behaviour-equivalent to `return false`.
Task 1: note: full `npm test` first run had 36 `panel-dist-missing` reds (worktree had no web/dist) — after `npm run build --workspace web` the 10 files re-ran 63/64 with only controlShutdown 143 (3/3 alone); driverRecovery and driverRequirementSplit red in the full run, green on re-run (load 16–23).
Task 1: complete (commits 2e0c8f0..66d2f43, review clean after 1 fix round)
Task 2: complete (commits 2dcd73b..e93413d, review clean; full suite 2816 passed / 53 skipped, rc=0; mutations a–d seen red)
Task 2: minor (deferred): `given()` empty-string fallback in src/service/paths.ts has no test/mutation; paths.test.ts `startsWith(homedir())` would false-red if TMPDIR is under HOME and prefix-matches siblings (use path.relative); relocateUserData's afterAll stops at the first failing expect; a human installing the real service mid-suite turns every in-flight file red by name (by design).
Task 2: minor → carried to Task 3: relative ORCA_PANEL_DIR / ORCA_LAUNCH_AGENTS_DIR / XDG_CONFIG_HOME are accepted unchecked by paths.ts — Task 3's `service-path-not-absolute` must cover them.
Task 3: complete (commits e93413d..4bcb29e, review clean; config 7 + paths 5 tests; 13 mutations seen red, restore 0/0). Implementer Rulings accepted by review: Ruling: the brief's dist test used `await` in non-async arrows (would not compile) — checkouts awaited first, assertions unchanged; Ruling: added config assertions for relative panelDir and `--plan` so two branches have a mutation that can go red; Ruling: relative ORCA_PANEL_DIR / ORCA_LAUNCH_AGENTS_DIR / ORCA_SYSTEMD_USER_DIR / XDG_CONFIG_HOME refused with `service-path-not-absolute` in `servicePaths` (the single resolver, so every subcommand refuses) — a relative XDG_CONFIG_HOME is refused even on macOS (fail loud); Ruling: `panelDir()` stays unchecked (Task 9 discovery's read-only caller).
Task 3: full suite 2867 passed / 9 skipped / 1 failed: `tests/control/handoffE2E.test.ts` H2 timed out (388 s, load 5–11), alone 12/12 green — Ruling: load flake (handoffE2E G is already registered for its 30 s real-time window; H2 joins the flake list for this round's triage) — cost if wrong: a real handoff regression hidden; the final gate re-checks it.
Task 3: minor (deferred): ORCA_PANEL_DIR absoluteness checked in both config.ts (plan-mandated) and paths.ts with different messages.
Carried: Task 9 pins that a relative ORCA_PANEL_DIR in discovery reads nothing (unchecked `panelDir()` must never be reused for a write); Task 11 passes absolute `entry`/`checkout` (config does not check them).
Task 4: review — spec compliant (code + test byte-for-byte the brief); Important: `systemdPlain` `%`→`%%` (D5) and newline guard had no mutation that could go red (plan-mandated gap); Minors: service.env keys unvalidated (D20 re-renders from disk), "sorted" test relied on config.ts's order. Ruling (implementer): mutation clone symlinks node_modules instead of `npm ci` — accepted.
Task 4: fix round 1/5 (3 addressed, 0 open — %-escape and newline tests; renderer sorts and refuses invalid keys with `service-config-invalid`; commits 0c5a115..fa5f02f; mutations g,h,i,j seen red, restore 0/0). Ruling (implementer): bad env key → `service-config-invalid` (in the named-code list) — cost if wrong: a rename.
Task 4: minor (deferred): `xmlEscape` passes XML-invalid control characters (e.g. \x01) → unparseable plist; the unit text is unchecked against a real systemd (D16).
Task 4: complete (commits 4bcb29e..fa5f02f, review clean after 1 fix round; full suite at 0c5a115: 2874 passed, 1 red = gateCheck K13 load flake, alone 19/19)
Task 5: review (fa5f02f..7c4f38b) — spec compliant; implementer Rulings accepted: P20 leaf `src/service/privateFiles.ts` (node: imports only, pinned by a test), P12 `sed '1d'`, brief's tailLines missing-path case was ENOTDIR (fixed to a missing sibling), never-red `.not.toBe` replaced by reading service.env/run.sh back and comparing with the renderers, schema-literal/strict/JSON-refusal test strengthened (brief's version survived mutation c). Important: no restore proof on disk for Task 5 mutations; parent-chmod loop could not go red (one level only). Controller note: the implementer left a `cp -i` hung on its prompt; the controller killed it.
Task 5: fix round 1/5 (4 addressed, 0 open — commits 7c4f38b..83e038f). Ruling (implementer): recursive mkdir fails EACCES under umask 0o200 for two levels, so `ensurePrivateDir` now creates each missing level top-down (mkdir + chmod 0700 per level; EEXIST-as-directory is skipped and never chmod'ed; existing dirs never chmod'ed) — cost if wrong: one more syscall per level. 13 mutations (a1,a2,b,c1–c3,d,e,f,g,h1–h3) re-run in a fresh clone, each red with a `0 0` restore file (`scratchpad/ps/m5-*`).
Task 5: minor (deferred): the EEXIST-tolerance branch of `ensurePrivateDir` has no test (needs a creation race); `readServiceConfig`/`ensurePrivateFile` let EISDIR/EACCES escape raw — Tasks 8/9 callers should name them.
Task 5: complete (commits fa5f02f..83e038f, review clean after 1 fix round; full suite at 318e108: 2842 passed / 53 skipped, rc=0)
Task 6: complete (commits 0e5cdb7..b974bc1, review clean, opus reviewer; launchd.test.ts 18/18; full suite 2861 passed / 53 skipped rc=0 twice; 22 mutations red with `restore 0 0` files `scratchpad/ps/m6-*`). Implementer Rulings accepted: `tailLogs` lives in src/service/manager.ts (pre-flight P18) and is shared as `launchd.logs` (Task 10 reuses it); `fakeContext.sleep` also yields one macrotask (the brief's version made mutant f2 hang the worker forever); tests added for logs follow=false / exit-code path, restart when `kickstart -k` reports not loaded, enable/stop/uninstall failure paths, not-loaded uninstall. Controller note: the implementer's first-pass mutation runner survived and left a vitest worker hung for 27 min in the worktree (killed by the controller); its report's process note is wrong on that point, the evidence it cites (`m6-all.txt`) is valid.
Task 6: minor (deferred): a failed `enable`/`bootstrap` leaves the plist with nothing loaded — re-running install recovers (spec §9 rejects transactional rollback for v1); restart's changed-plist branch discards bootout's exit code and stderr (brief-mandated); `domain()`'s `answer.code === 0` clause has no mutation; `launchctl print` regexes are only checked by the Task 12 smoke.
Carried to Task 11: (a) when enable/bootstrap fails, the CLI message names the next step (re-run `orca panel install`); (b) spec §9 "never trust a launchctl exit code" — install/start/restart currently return 0 on launchctl's code alone; Task 11 decides whether they wait for `identifyPanel` up to `startWaitMs` (recommended: yes).
Task 7: review — spec compliant (§4 Linux table, linger, D18 preflight); Important: failure paths unpinned (daemon-reload failure in install/restart, uninstall after failed disable, systemctl non-zero → 1). Implementer Ruling accepted: the brief's restart test wrote into a not-yet-created relocated unit dir — one `ensurePrivateDir` line added, no assertion changed. Reviewer agreed `logs` returns the tool's raw code at the manager level (launchd shares that contract); the 0/1 mapping (pre-flight A-T11b) belongs to Task 11's `runServiceCommand`, with its own test and mutation.
Task 7: fix round 1/5 (3 addressed, 0 open — commits 028f49b..438e131; 9 mutations red, restore 0). Ruling (controller): systemd `restart` always runs `daemon-reload` before `restart` (unit rewritten only when its text changed) — a failed reload after a rewrite would otherwise leave the next restart seeing "unchanged" and restarting the old unit; this departs from spec §4's "daemon-reload when it changed" and is recorded in the spec's execution corrections (Task 13) — cost if wrong: one idempotent systemctl call per restart.
Task 7: minor (deferred): `systemctl show` exits 0 for a missing unit, so `state().loaded` is true when uninstalled (Task 9/11 status must not trust it — carried); an inherited DBUS_SESSION_BUS_ADDRESS is kept after XDG_RUNTIME_DIR is replaced; `status`/`logs` may run `loginctl enable-linger` (D18 as written); `realRuntimeProbe` is never exercised (no Linux host, D16).
Task 7: complete (commits b974bc1..438e131, review clean after 1 fix round; full suite at 028f49b: 2867 passed, 1 red = controlShutdown load flake, alone 6/6)
Carried to Task 9/11: status must not treat systemd `loaded` as installed (show exits 0 for a missing unit); Task 11 maps `manager.logs` non-zero to 1 with a test + mutation (A-T11b).
Task 8: review (opus) — spec compliant (§5, §6, D2, D9, D10, D11, D13; D2 non-service path byte-for-byte). Implementer Rulings accepted: dropped the A-T8b dead `truncateSync` line; imports from the P20 leaf; servicePanel.test realpaths its temp root and passes a short `--control-state-dir` (the brief's socket path was 108 bytes vs darwin's 104, so every service start exited 78; the default socket location is not exercised in service mode); added the D13 socket-bind exit-78 test and a D2 "plain run on a held port still exits 3" assertion; tests spawn detached and kill the process group (the brief's `c.kill("SIGKILL")` killed only the tsx wrapper and orphaned live panels on red runs — 6 orphan panels from the first mutation pass were killed by the implementer). Important: a post-bind failure (`orcaVersion`/`writePanelJson`) released the lock but left the bound panel alive. Both exit-78 paths go through one `bindFailed()` in src/panel/server.ts (the accounts plan's `auth.close()` is a one-line edit there).
Task 8: fix round 1/5 (4 addressed, 0 open — version computed before bind, close-before-rethrow after bind, logs rotated only by the lock holder, lock bytes pinned on the loser path, instance.ts docblock says check-then-unlink; commits 02f4d35..d81c2c4; mutations n–q red, restore 0/0; full suite 2888 passed / 53 skipped rc=0).
Task 8: minor (deferred): stale-lock takeover is check-then-unlink, not atomic (D10 as worded); detached test children miss Ctrl-C on an interrupted run (repo pattern); non-Rejection errors in `run --service` exit 3, not "1 other refusal" (plan-mandated; under launchd/systemd any non-zero restarts the same way); a rejecting `started.close()` masks the original panel.json error (exit and lock release unaffected).
Task 8: complete (commits eb83039..d81c2c4, review clean after 1 fix round). M-acc (initial-password never printed by the service panel) stays pending for the accounts plan.
Task 9: review (opus) — spec compliant; discovery order flag → panel.json → projects file → `<root>/panel` → §14 legacy single-socket scan (unchanged); every discovery/control/mcp test relocates ORCA_PANEL_DIR/HOME (checked caller by caller). Implementer additions accepted: discovery ignores a relative ORCA_PANEL_DIR (pinned no-write); a non-ENOENT panel.json read error is refused by name in discovery (`control-panel-json-invalid`) and is a not-answering reason in identify; an import-purity test keeps discovery off the panel server/service config (P20); tests for non-200 replies and not-loaded manager; the brief's test helper types did not compile (fixed); mutation f plants its live panel.json under a fake HOME (brief's version could not go red); mutation p (drop ORCA_PANEL_DIR from controlCommand's default env) is equivalent on a machine with no real panel.json. Important (brief's code): a stale panel.json (crash/SIGKILL/reboot) won discovery and shadowed the §14 legacy socket.
Task 9: fix round 1/5 (2 addressed, 0 open — panel.json's socket is used only while its pid is alive (`isProcessAlive`, kill 0, EPERM = alive, ESRCH falls through); dead-socket identify asserts `panel-not-running`; commits 62496c0..e2ae5d3; mutations q, r red, restore 0/0; full suite 2900 passed / 53 skipped rc=0).
Task 9: minor (deferred / known limitation): a reused pid (or a hand-edited pid ≤ 0) still lets a stale panel.json win, then the connect fails loudly with `panel-not-running`; identify does not compare the answering panel with panel.json's pid (consistent with spec §5).
Task 9: complete (commits 6ea467d..e2ae5d3, review clean after 1 fix round)
Carried to Task 11 (not in its brief): `status` decides "installed" from the plist/unit file existing — never from systemd `loaded` (`systemctl show` exits 0 for a missing unit) — and answers `service-not-installed` otherwise, with a test and a deletion mutation.
Task 10: review (opus) — spec compliant (S1 setsid/detached, stdio to 0600 logs, unref, `exec` in run.sh so pid = group leader; §8/D9 start-time compare before signalling; D14 notice). Implementer Rulings accepted: manager-level test for own process group + stop/state refusing a start-time-mismatched pid; tests for start's three failure branches; afterEach kills CLI groups and any pid panel.json names; `logs: tailLogs` (P18). Known red until Task 11: the brief's CLI test `panel start --detach` (detached.test.ts, refused `no-viewer-identity` before spawn) — the only red in the full suite (2903 passed / 53 skipped / 1 failed). Carried to Task 11: run Task 10 mutation (c) delete `child.unref()` and (d) `pid === pid` (possibly equivalent) against the CLI test once it is green. Important: install / stop-not-running / waitExit timeout / restart / uninstall / start's early return had no test that could go red.
Task 10: fix round 1/5 (6 addressed, 0 open — manager tests for stop-nothing-recorded, invalid panel.json (now exit 1 by name — Ruling (controller): fail loud), install, restart, uninstall, refusal paths, ESRCH between check and kill (= stopped), waitExit timeout; start's early return pinned (mutation q); afterEach kills only pids whose start time still matches; mismatch refusal names `orca panel start --detach`; deadline test uses `sleep 60` killed by pid; commits 848a248..5cebf74; mutations a,b,e–s red, restore 0/0). Ruling (implementer, accepted): start-deadline message is "no answer from pid P within N ms" — cost if wrong: message text only.
Task 10: minor (deferred): the remedy text in the mismatch refusal is not asserted; a missed pid regex in the deadline test leaves `sleep 60` for ≤60 s only when that test is already red.
Task 10: complete (commits def4905..5cebf74, review clean after 1 fix round; the brief's CLI test stays red until Task 11)
Task 11: review (opus) — spec compliant; all seven carried items implemented with tests and mutations (absolute entry/checkout h6; failed enable/bootstrap names `orca panel install` h5; install/start/restart wait for identify — bounded ≈35 s, restart ignores the pre-existing panel by pid+start time h4a–h4f; status decides installed from the manager's own file, else `service-not-installed` h3/h3b; logs → 0/1 h1; pure `startNeedsDetach` f1/f2); Task 10 mutations (a)–(c) red against the now-green CLI test, (d) equivalent (argument recorded). Implementer Rulings accepted: optional 5th `seams` parameter on `runServiceCommand`; two brief tests changed (install through the seam with an answering panel; status writes the plist first); `setup()` reads paths from the stubbed `process.env`; detached "installed" = run.sh exists; Ruling (controller): install/start/restart wait for the panel to answer identify (spec §9 "never trust a launchctl exit code"). Important (brief-mandated wording): SKILL said `status` is read-only, but on Linux status/logs ran `loginctl enable-linger`.
Task 11: fix round 1/5 (4 addressed, 0 open — commits 381a5da..d10dfd7; mutations L1–L3, R1, R2, Z1, D1 red, restore 0/0; full suite 2930 passed / 53 skipped / 0 failed). Ruling (controller): systemd `state()`/`logs()` use a read-only preflight (sets XDG_RUNTIME_DIR/DBUS, reports "linger is off", never runs `enable-linger`); only install/start/restart enable linger — departs from D18 on read paths only — cost if wrong: a human must run install/start once to get linger. Ruling (controller): systemd install is `enable` + `restart` (not spec §4's `enable --now`, which leaves an already-active old panel running) and install's wait ignores a panel answering before it — cost if wrong: one restart on first install. Ruling (controller): `SERVICE_SUBCOMMANDS` lives in leaf `src/service/subcommands.ts`; plain `orca panel` never loads service modules (cliLazy.test.ts). The Task 7 systemd install test was swapped whole to the new four-call list (still a full ordered `toEqual`).
Task 11: minor (deferred): "a failed enable stops install before the restart" has no named mutation; `install --dry-run` on Linux still runs read-only `systemctl --user show-environment` unless the manager is forced; unexpected errors (EACCES) exit 3 not 1 (Task 5 deferral); `--dry-run` stripped anywhere in args (cosmetic).
Task 11: complete (commits 5cf5445..d10dfd7, review clean after 1 fix round)
Task 12: review — spec compliant, Approved; implementer Rulings accepted: fixed relocated label `dev.orca.panel.smoke` (afterAll boots it out); the self-built-label assertion replaced by "plist exists after install"; `checkDist`/`TOKEN_ANCHOR` names correct; install/start/restart already wait for identify, so `untilStatus` is kept only for stop; temp root `realpath(/tmp)/r…` (tmpdir() under vitest exceeds the 104-byte socket limit). Never run with ORCA_SERVICE_REAL=1 (no human authorization). The Rule 17 registration of the smoke's persistent launchd override entry is spec §11 bullet 11 (controller, commit `docs(spec): record the panel service execution-time corrections`, which also records every execution-time departure from §1–§10).
Task 12: fix round 1/5 (3 addressed — every CAPTURED_ENV name and ORCA_SERVICE_CHECKOUT blanked before relocation, afterAll waits ≤5 s for the old panel after bootout, stop pinned as "panel: not answering"; commits 2c721fa..a318aae) — Ruling: this test-only fix of an opt-in skipped file is re-reviewed inside the final whole-branch review rather than its own seat — cost if wrong: one less review seat on a file no gate runs.
Task 12: complete (commits e7cfd2b..a318aae; flag-off 1 skipped; full suite at 2c721fa: 2929 passed / 54 skipped / 1 red = controlShutdown 143 load flake, alone 6/6). No mutation possible for an opt-in skipped test.
Final whole-branch review (opus, 58d5e5e..693d0f2, `final-review.md`): ready to merge, no Critical/Important. Integration verified: one path resolver (`servicePaths`) end to end; D2 byte-identical (cliLazy pins no service-module load); no test/default path writes real ~/.orca, ~/Library/LaunchAgents, ~/.config/systemd; every wait bounded (worst launchd restart ≈95 s; only `logs -f` is unbounded by design); exit codes run --service 0/78/1, subcommands 0/1 (+3 for unexpected errors). Human install path: if panel.sh's panel is still running, the service exits 78 on the held port, launchd retries every 10 s and comes up once panel.sh is stopped; install fails after ≈30 s pointing at status/logs. Reviewer recommends the human authorizes the opt-in real smoke before the real install (launchctl print/managername parsing has only met fakes).
Final fix wave (one dispatch): a4b08a6 `test(service): the smoke boots out the domain the manager uses` (exports launchd `domain`, no behaviour change; smoke uses it instead of hard-coded gui/<uid>); 438df4e `docs(spec): record three more panel service corrections` (§11 items 12–14: D17 Linux dry-run probe; Rule 17 leftovers surviving uninstall — launchd enable override for `dev.orca.panel`, Linux wants link if disable fails; unexpected errors exit 3) — existing spec bytes cmp-identical. Ruling: the fix-wave re-review is the controller's own read of the 2-file code diff (export + two call sites in an opt-in skipped test) — cost if wrong: small.
Final review minors (deferred, reported to the human): restart does not check the build is current (after `git pull` without `npm run build` it restarts old code); a service panel whose control store is held by another live panel serves reviews only yet `status` exits 0; a startup refusal that repeats (e.g. web/dist missing) restarts every 10 s under launchd without end.

## Task 13: gate (session 30bd7e40, Task 13 implementer, 2026-10-07; tree = branch panel-service at the commit with subject `docs(sdd): record the panel service final review in its ledger`)

Isolated `git clone --local` of the branch (`git status --short` empty) under the session scratchpad `ps/gate/orca-svc-gate`. HOME and the four XDG roots relocated under `ps/gate` (0700), `TMPDIR=/private/tmp/claude-501/psg/t`, `ORCA_CCLOOP_BIN` = ccloop clone build whose `git rev-parse HEAD` equals package.json's ccloop SHA (c3af4d6bdfbe...), `ORCA_AGENTS_TABLE` = `ccloop-agents-table-v1` with one codex installation, command `[node, <ccloop-pin>/tests/fixtures/fake-codex.mjs, "integration", <marker>]`, version `9.9.9-fake` (read back from the fake's `--version`), file 0600. Each command went to its own file with `echo rc=$?` appended and was read back (raw files in the scratchpad `ps/gate/*.txt`; they expire with the session). Caveat: the gate script's env file exported `PATH=$PATH` unquoted, which printed "not a valid identifier" errors in `run.out`; node, npm and git all resolved, every command ran, but PATH inside the gate shell may have been cut at its first space. The flake re-runs used a corrected env file with no PATH line.

### Gate table

| command | rc | counts | load (1 min, from `uptime`) |
|---|---|---|---|
| `npm ci` | 0 | 250 packages added, 0 vulnerabilities | not recorded |
| `npm run build` | 0 | tsc, no output | not recorded |
| `npm run typecheck` | 0 | tsc, no output | not recorded |
| `npm run build --workspace web` | 0 | vite, 106 modules | not recorded |
| `npm run --ws check` | 0 | web: 70 files, 490 tests passed | not recorded |
| `npm run verify:panel` | 0 | 14 PASS lines, no FAIL | not recorded |
| `npm run verify:control` | **1** | no test ran: `CACError: Unknown option --minWorkers` (vitest 5.0.3); see below | not recorded |
| `npm test` | 1 | 332 files: 329 passed, 3 failed; 2984 tests: 2974 passed, 3 failed, 7 skipped; 498.65 s; log has 1286 lines, 3 `FAIL` lines (read from the summary section and the failure list, not line by line) | 7.75 before, 4.79 after (`uptime`, 21:52 and 22:00) |
| `node scripts/check-tmp-leak.mjs` | 0 | it runs the suite itself: "vitest exit 1, 2984 tests, 0 entries left"; 0 leaked entries | not recorded |

The 3 `npm test` failures are all registered load flakes, each a 5000 ms timeout: `tests/chain/gateCheck.test.ts` K13, `tests/control/driverRecovery.test.ts` ("drives a retried run on from where it was blocked, to settled"), `tests/control/driverRequirementSplit.test.ts` ("fails the third consecutive invalid draft as split-validation-exhausted..."). The `check-tmp-leak` run's own vitest exit is also 1 (same kind of flake; its log mentions one `control-store-closed` driver line, not a test failure).

Flake re-runs, each file alone, 3 times each, all rc=0:

| file | runs | result | load before first / after last (1 min) |
|---|---|---|---|
| gateCheck.test.ts | 3 | 19/19 passed each | 5.80 / 4.42 |
| driverRecovery.test.ts | 3 | 8/8 passed each | 4.42 / 4.51 |
| driverRequirementSplit.test.ts | 3 | 8/8 passed each | 5.43 / 4.51 |

Skipped by name (7 in the full run): `ccloopDefaultE2E` x3 (ORCA_CCLOOP_BIN-unset cases), `driverSkillsReal` x1, `syncskillReal` x1, `ccmemReal` x1, and the opt-in launchd smoke `tests/service/realSmoke.test.ts` "real launchd smoke (opt-in)" (`ORCA_SERVICE_REAL`), which was not run and never has been (no human authorization).

REAL RED, not a flake and not caused by this branch: `npm run verify:control` fails before running anything. `scripts/verify-control.mjs` passes `--minWorkers=1 --maxWorkers=4` to vitest; the installed vitest 5.0.3 rejects `--minWorkers` (`CACError: Unknown option`). The script is unchanged on this branch (`git diff main..panel-service -- scripts/verify-control.mjs` is empty) and main's vitest is also 5.0.3 (the 2-to-5 upgrade is commit subject `build(deps): upgrade vitest 2 to 5.0.3 to clear the remaining audit advisories`), so this is a pre-existing break on main. Not fixed here (Task 13 may not touch source). Supplementary evidence with the same environment and `ORCA_CONTROL_VERIFY=1`: `vitest run tests/control --maxWorkers=4 --reporter=verbose` gives rc=0, 129 files passed, 1321 tests passed, 4 skipped (the 3 `ccloopDefaultE2E` plus `driverSkillsReal`), load 4.34 before, 8.70 after. Proposed one-line fix for the owner: drop `--minWorkers=1` from `scripts/verify-control.mjs` line 21.

### Built-dist smoke (D4 layout)

Run in the clone with a short relocated HOME (`/private/tmp/claude-501/psg/h`, XDG roots under it, TMPDIR as above), never the real `~/.orca`. A first attempt with HOME inside the long scratchpad path was refused by the product as designed (`panel-bind-failed: control-socket-path-too-long: 157 bytes`, D13), so HOME was shortened. Repo `g` = a fresh empty `git init` repo.

- `node dist/cli.js panel run --service --by gate --repo g=<gate-repo> --port 0`: the ready line `orca-panel ready url=http://127.0.0.1:<port> token=...` appeared within the poll; `$HOME/.orca/panel/panel.json` (0600) and `panel.lock` existed.
- `ORCA_SERVICE_MANAGER=detached node dist/cli.js panel status` before any `panel install`: rc=1, `service-not-installed: .../run.sh does not exist`. That is the designed refusal (Task 11 mutation h3), so the brief's "rc 0" needs the install step. After `ORCA_SERVICE_MANAGER=detached node dist/cli.js panel install --by gate --repo g=<gate-repo>` (rc=0, "installed without a service manager", starts nothing; wrote `run.sh`, `service.env`, `service.json`, `logs/`), the same `status` while the panel ran answered rc=0: `manager: detached running pid=<pid>` and `panel: answering at http://127.0.0.1:<port> (socket ..., pid <pid>, version 0.1.0)`.
- SIGTERM to the panel (started under `sh -c '...; wait; echo rc=$? > file'`): exit rc=0, `panel.json` and `panel.lock` gone (`ls` shows only `logs run.sh service.env service.json`).
- `pgrep -fl` on the smoke HOME and on the clone path: empty after each run.

### Mutation table (Tasks 1-12 and fix rounds)

Source: the mutation tables in `task-<n>-report.md` (and `task-11-rereview.md` for the Task 11 fix round), whose per-mutation outputs are `m*.txt` files in the session scratchpad `ps/`. Every mutation ran in a `git clone --local` copy of the task's tree with the work copied in by `cat` and proven byte-identical by `cmp`; each restore proof is `git diff | wc -c` and `git diff --cached | wc -c`, both 0, unless noted. This task did not re-run them; the counts below are tallied from those reports, a mutation re-run in a later round counted once. Red = seen red by a named test assertion.

| task | mutation | criterion | observed red | restore |
|---|---|---|---|---|
| 1 | a rootDir "src" to "." | build test 1 | `expected '.' to be 'src'` | 0/0 |
| 1 | b delete the `build` script | build test 1 | `expected undefined to be 'tsc -p tsconfig.build.json'` | 0/0 |
| 1 | c drop `npm run build &&` from `verify` | build test 1 (assertion strengthened, see Ruling) | first run green; after strengthening red `expected '...typecheck && npm test...' to contain ...` | 0/0 |
| 1 | d guard back to plain path equality | build test 3 (symlinked invocation) | `expected +0 to be 1` | 0/0 |
| 1 | e (fix) non-ENOENT throw becomes return false | build test 4 | `expected +0 not to be +0` | 0/0 |
| 1 | f (fix) always throw, drop ENOENT fallback | build test 4 | missing-entry case rc 1 with ENOENT stack | 0/0 |
| 2 | a delete `given(env.ORCA_PANEL_DIR) ??` | paths tests | panelDir deep-equal; startsWith(homedir) | 0/0 equivalent state (7341 B baseline cmp) |
| 2 | b delete ORCA_SERVICE_LABEL line in setup | "every test process..." | label `not.toBe` default | same |
| 2 | c delete NAME.test check | "refuses a label or unit name..." | expected throw | same |
| 2 | d delete the realServiceDefinitions afterAll expect | relocation guard (temp test under a fake HOME) | red with guard, green without | same |
| 3 | a1 delete capture-loop `isAbsolute` throw | config "refuses a relative path..." | expected function to throw | 0/0 |
| 3 | a2 delete `continue` guard | 5 config tests | TypeError path undefined | 0/0 |
| 3 | b iterate `Object.keys(input.env)` | one-to-one env `toEqual` | +EDITOR, +ORCA_UNRELATED, +SHELL | 0/0 |
| 3 | c delete `parsePanelArgs` try block | "refuses arguments the panel itself would refuse" | expected throw | 0/0 |
| 3 | d disable stale-src throw | "refuses a missing or stale dist" | expected throw | 0/0 |
| 3 | e drop `isDirectory` from PATH filter | PATH test | got `/usr/local/bin:/opt/homebrew/bin:...` | 0/0 |
| 3 | f warnings = [] | "warns..." | `expected '' to contain 'version manager'` | 0/0 |
| 3 | g delete `givenAbsolute` throw | paths "refuses a relative directory variable" | `{"ORCA_PANEL_DIR":"p"}` | 0/0 |
| 3 | h delete `input.panelDir` check | config relative-path test | expected throw | 0/0 |
| 3 | i drop `--plan` arm of `pathOf` | config relative-path test | `--plan p=orca=/abs/plan.md` wrongly refused | 0/0 |
| 3 | j disable `--service` check | "refuses arguments..." | expected throw | 0/0 |
| 3 | k disable PATH_FLAGS check | config relative-path test | expected throw | 0/0 |
| 3 | l missing dist falls through | "refuses a missing or stale dist" | error does not match `service-dist-missing` | 0/0 |
| 4 | a Restart=on-failure to always | unit test | red (first attempt hit a comment, redone on the quoted string) | 0/0 |
| 4 | b drop `%` to `%%` in systemdQuote | escapes test | `50\%` | 0/0 |
| 4 | c delete shQuote `'` replace | escapes test, /bin/sh round-trip | unexpected EOF | 0/0 |
| 4 | d env-value throw becomes no-op | escapes test | expected function to throw | 0/0 |
| 4 | e drop noBreaks in xmlEscape | escapes test | `\r` expectation | 0/0 |
| 4 | f delete SoftResourceLimits lines | plist test | red | 0/0 |
| 4 | g (fix) drop `%` to `%%` in systemdPlain | "unit escapes % and refuses line breaks..." | red | 0/0 |
| 4 | h (fix) drop its noBreaks | same test | red | 0/0 |
| 4 | i (fix) drop key sorting | render sorted-env test | red | 0/0 |
| 4 | j (fix) drop key-name check | same test | red | 0/0 |
| 5 | a1 delete per-level chmod | umask 0o200 two-level test | red | 0/0 |
| 5 | a2 chmod leaf only | same | red | 0/0 |
| 5 | b ensurePrivateDir before the renders | "writes ... nothing when one is refused" | `expected true to be false` | 0/0 |
| 5 | c1 schema literal to z.string() | "names a missing or broken service.json" | red (survived the brief's test; test strengthened) | 0/0 |
| 5 | c2 `.strict()` removed | same | red | 0/0 |
| 5 | c3 JSON try/catch removed | same | red | 0/0 |
| 5 | d delete runTool `result.error` branch | "answers 127" | `expected 1 to be 127` | 0/0 |
| 5 | e fake script uses tail not sed '1d' | "logs argv, consumes queued exit codes" | extra tail call | 0/0 |
| 5 | f ensurePrivateFile chmod removed | "gives new files 0600 under a umask..." | red | 0/0 |
| 5 | g writePrivateFile chmod removed | same | red | 0/0 |
| 5 | h1 `import { z } from "zod"` in privateFiles.ts | import-purity test | red | 0/0 |
| 5 | h2 `import "zod"` | same | red | 0/0 |
| 5 | h3 `import("zod")` | same | red | 0/0 |
| 6 | a `r.code !== 5` to true | retry test, deadline test | `install` toBe(0); bootstrap count 3 | 0/0 |
| 6 | b delete `\|\| ctx.now() >= deadline` | deadline test | `install` toBe(1), got 0 | 0/0 |
| 6 | c delete not-loaded branch in `start` | it.each 3/113/125 | `start` toBe(0) | 0/0 |
| 6 | c2 delete it in `restart` | "restart ... kickstart -k says not loaded" | toBe(0) | 0/0 |
| 6 | d plist equality to false | unchanged-restart | exact calls | 0/0 |
| 6 | e plist equality to true | changed-restart, never-exits | plist content; toBe(1) | 0/0 |
| 6 | f waitExit guard to `if (false)` | changed-restart, never-exits | polls toBe(3); toBe(1) | 0/0 |
| 6 | f2 delete waitExit deadline line | never-exits | red by timeout (8000 ms) | 0/0 |
| 6 | g domain test to always gui/ | user-domain test | last call `user/501` | 0/0 |
| 6 | h delete `rmSync(runScript)` | uninstall test | existsSync array | 0/0 |
| 6 | h2 delete `rmSync(plistFile)` | failure test, uninstall test | plist gone | 0/0 |
| 6 | i tailLogs follow always `-F` | uninstall/logs test | `tail -n 5 out err` | 0/0 |
| 6 | j delete `enable` failure check | failure test | `install` toBe(1) | 0/0 |
| 6 | k delete stop's not-loaded branch | stop test | second stop toBe(0) | 0/0 |
| 6 | k2 stop's final `failed()` to `return 0` | failure test | `stop` toBe(1) | 0/0 |
| 6 | l delete uninstall bootout failure check | failure test | `uninstall` toBe(1) | 0/0 |
| 6 | l2 uninstall drop `!LAUNCHD_NOT_LOADED.has` | failure test | not-loaded `uninstall` toBe(0) | 0/0 |
| 6 | m delete bootout in exit-5 retry loop | retry test | exact call sequence | 0/0 |
| 6 | n delete restart plist rewrite | changed-restart | plist content | 0/0 |
| 6 | o printState pid to null | state test, changed-restart, never-exits | pid 4242; polls; toBe(1) | 0/0 |
| 6 | p delete install's ignored bootout | install test, retry test | exact calls | 0/0 |
| 6 | q delete printState not-loaded return | state test | not-loaded `toEqual` | 0/0 |
| 7 | a delete enable-linger call | "turns linger on..." | red | 0 (working diff) |
| 7 | b `changed &&` to `false &&` | "restart daemon-reloads..." | red | 0 |
| 7 | c delete `\|\| probe.ownerOf(runtime) !== uid` | preflight test | red | 0 |
| 7 | d delete DBUS assignment | preflight test | `expected undefined to be 'unix:path=/run/user/1000/bus'` | 0 |
| 7 | e delete `rmSync(unitFile)` | "state ... uninstall" | red | 0 |
| 7 | f1-f9 (fix) install reload `return 1` dropped; restart reload `return 1` dropped; `r.code===0?0:1` to `r.code`; systemctl error line deleted; uninstall disable made fatal; restart reload deleted (red in 2 tests); state show-failure branch deleted; `pid>0?pid:null` to `pid`; `-f` spread deleted (9 mutations) | the Task 7 fix-round tests (daemon-reload failure, non-zero exit is 1, uninstall after failed disable, state, logs -f) | each seen red (e.g. `expected +0 to be 1`; `expected '' to contain 'exited 5'`) | 0 |
| 8 | a delete `return { kind: "held", holder }` | "a live holder keeps it"; process exit-0 test | `acquired` vs `held`; timeout | 0/0 |
| 8 | b `=== holder.startTime` to `!== null` | pid-reuse takeover (unit and process) | `held` vs `acquired` | 0/0 |
| 8 | c restore `server.once("error", reject)` | exits 78 on held port | `3 vs 78` | 0/0 |
| 8 | d delete `lock.release()` | port-held, socket-78, SIGTERM tests | `[false,true]` vs `[false,false]` | 0/0 |
| 8 | e delete `removePanelJsonIfOurs` in runServicePanel | SIGTERM test | `[true,false]` vs `[false,false]` | 0/0 |
| 8 | f delete `size <= maxBytes` guard | "leaves a log under the limit alone" | red | 0/0 |
| 8 | g delete the `--service` branch in runPanel | 5 process tests | `missing` vs `valid` | 0/0 |
| 8 | h release without the `=== body` check | "released only by its holder" | `false vs true` | 0/0 |
| 8 | i delete the service-mode socket-bind throw | D13 socket 78 test | `ready` vs 78 | 0/0 |
| 8 | j delete the service-mode guard on listen error | port-held test, D2 assertion | `78 vs 3` | 0/0 |
| 8 | k removePanelJsonIfOurs without the pid check | panel.json round-trip | `false vs true` | 0/0 |
| 8 | l delete `chmodSync(.1, 0o600)` | rotation test | `420 vs 384` | 0/0 |
| 8 | m parseLock rethrows | "taken over from a body no panel wrote" | SyntaxError | 0/0 |
| 8 | n (fix) delete `await started.close()` | panel.json failure test | `'still running'` vs 3 | 0/0 |
| 8 | o (fix) rotate before the lock | live-holder test | `[0,true]` vs `[10485761,false]` | 0/0 |
| 8 | p (fix) delete the rotation | first process test | ENOENT stat of `panel.err.log.1` | 0/0 |
| 8 | q (fix) loser unlinks the holder's lock | live-holder lock-bytes read | ENOENT | 0/0 |
| 8 | EQUIVALENT: delete `rmSync(.keep)` in rotateLogs | none possible | `renameSync(.2 to .3)` overwrites `.3` anyway | not run |
| 9 | a not-answering status returns `state.loaded ? 0 : 1` | status running-but-dead | `expected +0 to be 1` | 0/0 |
| 9 | b delete panel.json `return` in discovery | prefers live panel.json; relative-dir test | got fromfile | 0/0 |
| 9 | c delete the `invalid` throw | refuses broken panel.json | did not throw | 0/0 |
| 9 | d TCP fallback to not answering | D12 test, 503-over-url | false vs true | 0/0 |
| 9 | e delete errTail lines | status running-but-dead | red | 0/0 |
| 9 | f restore 6ea467d discovery tests, live-socket panel.json under a fake HOME | 4 of 5 discovery tests | got the injected socket | 0/0 |
| 9 | g relative-dir guard to `length > 0` | relative ORCA_PANEL_DIR test | followed it to the svc socket | 0/0 |
| 9 | h drop discovery try/catch around readPanelJson | ENOTDIR assertion | raw Error, not `control-panel-json-invalid` | 0/0 |
| 9 | i drop identify try/catch | identify broken-file test | ENOTDIR thrown | 0/0 |
| 9 | j discovery `import "../service/config.js"` | P20 import-closure test | red after the walker regex fix (first run survived) | 0/0 |
| 9 | j2 value-import `SERVICE_CONFIG_SCHEMA` | P20 test | `["service/config.ts","panel/server.ts"]` | 0/0 |
| 9 | k socket status check always answering | 503-over-socket | red | 0/0 |
| 9 | l url status check always answering | 503-over-url | red | 0/0 |
| 9 | m delete pid-mismatch note | status answering test | red | 0/0 |
| 9 | n manager line ignores `loaded` | not-loaded status test | red | 0/0 |
| 9 | o drop `isSocket` on panel.json's path | not-a-socket fall-through | got `.../not-a-socket` | 0/0 |
| 9 | q (fix) delete `isProcessAlive(service.body.pid) &&` | "a panel.json whose pid is dead falls through" | got the svc socket | 0/0 |
| 9 | r (fix) identify catch reason without `code:` | dead-socket reason assertion | red | 0/0 |
| 9 | EQUIVALENT p: drop `ORCA_PANEL_DIR` from controlCommand.test.ts default env | green here because this machine has no `~/.orca/panel/panel.json`; the hazard is shown red by f | none | n/a |
| 10 | a delete stop's `own.now !== own.startTime` guard | own-group test; refuse test | `stop` toBe(1) got 0 | 0/0 |
| 10 | b `detached: true` to false | own-group test pgid | own pid vs vitest's group | 0/0 |
| 10 | e state ignores the start time | own-group test | got `{loaded: true, running}` | 0/0 |
| 10 | f delete "exited during start" check | failure test | got "no answer from pid ..." | 0/0 |
| 10 | g delete start deadline | failure test | timed out at 60 s (red by timeout) | 0/0 |
| 10 | h delete no-run.sh check | failure test | got "exited during start" | 0/0 |
| 10 | i delete invalid-panel.json branch in stop | empty/invalid test | TypeError `process.kill(undefined)` | 0/0 |
| 10 | j delete missing / not-running return | same | TypeError at first stop | 0/0 |
| 10 | k install prints nothing | install test | `out.pop()` undefined | 0/0 |
| 10 | l restart = start only | install test, refuse test | same pid after restart; restart -> 0 | 0/0 |
| 10 | m uninstall keeps run.sh | install test | `[false,true]` vs `[false,false]` | 0/0 |
| 10 | n uninstall skips stop | install test, refuse test | pid alive; uninstall -> 0 | 0/0 |
| 10 | o restart ignores stop's refusal | refuse test | `restart -> 1` got 0 | 0/0 |
| 10 | p uninstall ignores stop's refusal | refuse test | `uninstall -> 1` got 0 | 0/0 |
| 10 | q delete start's already-answering return | no-op test | second start -> 1 | 0/0 |
| 10 | r delete the ESRCH catch | stop test | `kill ESRCH` thrown | 0/0 |
| 10 | s delete the waitExit check | stop test, no-op, install | stop returned before exit | 0/0 |
| 10 | c delete `child.unref()` | CLI test (Task 11) | CLI test "start survives its parent" timed out at 90 s | 0/0 (counted under Task 11) |
| 10 | EQUIVALENT d: delete `id.panel.pid === pid` | none | start returns early whenever any panel answers, so only a different panel appearing between the check and the poll could satisfy the weakened condition; no test can stage that without a race (confirmed again in Task 11) | n/a |
| 11 | a delete dry-run `return 0` | dry-run test, relative-checkout test | install proceeds to the 30 s wait, 5 s test timeout | 0/0 |
| 11 | b' alias `runPanel(rest)` to `return 1` | "panel run is the foreground panel, and the old form is its alias" | red | 0/0 |
| 11 | c delete `service-manager-invalid` throw | "refuses bad arguments and an unknown manager by name" | red | 0/0 |
| 11 | d always systemd on linux | selection test; detach-required test | red | 0/0 |
| 11 | e parseLogs throw to continue | "refuses bad arguments..." | red | 0/0 |
| 11 | f1 start-case `startNeedsDetach` throw disabled | "start without a manager found needs --detach typed" | red | 0/0 |
| 11 | f2 `startNeedsDetach` to false | same | red | 0/0 |
| 11 | h1 logs returns raw code | "logs answers 0 or 1..." | red | 0/0 |
| 11 | h3 delete installed-file check in status | "status without the manager's file is service-not-installed" | red | 0/0 |
| 11 | h3b systemd installed file to plist | same, systemd half | red | 0/0 |
| 11 | h4a install returns manager code (no wait) | install-waits, no-answer, restart-new-pid tests | red | 0/0 |
| 11 | h4b start without wait | no-answer test | red | 0/0 |
| 11 | h4c restart without wait | no-answer, restart-new-pid | red | 0/0 |
| 11 | h4d `old` clause to false | "restart does not count the panel from before it" | red | 0/0 |
| 11 | h4e deadline never reached | no-answer, restart tests | red by timeouts | 0/0 |
| 11 | h4f detached manager not skipped by the wait | "the detached manager's install starts nothing" | red | 0/0 |
| 11 | h5 delete install-failure message | "a failed enable names the next step" | red | 0/0 |
| 11 | h6 drop `resolve()` on checkout | relative-checkout test | red | 0/0 |
| 11 | u drop the "ask the person" sentence from USAGE | usage test | red | 0/0 |
| 11 | s delete the SKILL.md bullet | "the agent skill says the service commands are the human's" | red | 0/0 |
| 11 | T10 a, b | detached tests incl. the CLI test | red | 0/0 (counted under Task 10 a, b) |
| 11 | L1, L2, L3 (fix) read-only systemd preflight mutations | systemd.test.ts "status and logs never turn linger on"; command.test.ts through `main` | each seen red | 0/0/0 |
| 11 | R1, R2 (fix) systemd install `restart` deleted; install's `before` identity dropped | command.test.ts stale pid 4242 vs new pid 4343 | each seen red | 0/0/0 |
| 11 | Z1 (fix) service-module lazy import broken | cliLazy.test.ts | red | 0/0/0 |
| 11 | D1 (fix) detached installedFile check | "the detached manager is installed when run.sh exists" | red | 0/0/0 |
| 11 | EQUIVALENT b: delete the `sub === "run"` branch | none | falls to `runPanel(["run",...])`; parsePanelArgs ignores the word; same `no-viewer-identity` | n/a |
| 11 | review minor, no mutation: "a failed enable stops install before the restart" | named in task-11-rereview.md | not seen red (deferred) | n/a |
| 12 | none possible | opt-in skipped smoke (`ORCA_SERVICE_REAL`) | n/a | n/a |
| acc | M-acc: initial password never printed by the service panel | PENDING on the accounts plan; the guarded assertion stays vacuous until it lands | n/a | n/a |

Tally (distinct lettered mutations, a re-run in a later round counted once; Task 7 fix round f1-f9 counted as 9): red 164 (T1 6, T2 4, T3 13, T4 10, T5 13, T6 22, T7 14, T8 17, T9 18, T10 17, T11 30 incl. 3 Task 10 mutations run against the CLI test and 7 fix-round ones), equivalent 4 (T8 `.keep`, T9 p, T10/T11 d, T11 b), 1 unrun review minor, 1 pending (M-acc), Task 12 none possible.

### Decisions

D1-D20 adopted as in spec §10, execution corrections spec §11 (items 1-14; the Task 12 Rule 17 registration is §11 bullet 11, the final fix wave added 12-14). Every execution-time Ruling is in the Task 1-12 entries above and the corresponding `task-<n>-report.md`.
