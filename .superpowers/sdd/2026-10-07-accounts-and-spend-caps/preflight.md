# Pre-flight conflict scan: accounts, per-model usage and spend caps plan

- Who: read-only pre-flight subagent, session `015m3hAnKcXK1pE3xYwnLTXz`, 2026-10-07.
- Read: `docs/superpowers/plans/2026-10-07-accounts-and-spend-caps.md` and its spec, plus the panel service plan, all at commit `58d5e5e` (main checkout, unchanged).
- Code spot checks: the same commit. No file in any repository was modified.
- Part B (ccloop B1–B4) is skipped except where Orca tasks consume it.
- Assumption (from the caller): the panel service plan (A) lands first on `panel-service`, and this plan rebases onto A's final commit. So this plan is "the plan that lands second" in A's "Dependency on the accounts plan" section.
- Each row has a recommended ruling, chosen as the smallest change consistent with the spec.

## 1. Task pairs that share a file or an interface

| # | Tasks | Produced vs consumed | Finding | Ruling |
|---|---|---|---|---|
| Q1 | T1 → T5 | `withCommandContext` and `commandPrincipalFor`. T5 says "Delete `withCommandClient` once nothing calls it (`rg -n withCommandClient src tests` empty)". But `tests/control/commandClientLedger.test.ts:3,41,60` and `tests/control/commandClient.test.ts:6,20` call it, and neither file is in the rewrite inventory for this | **mismatch.** The `rg` condition can never be met without rewriting criteria that are not listed | Keep `withCommandClient` as the documented wrapper and do not delete it. Record a Ruling line |
| Q2 | T1 → T7 | `usage_ledger` columns and CHECKs (source list, `tokens >= 0`, quality list) match `bookUsageDelta`'s INSERT | consistent | — |
| Q3 | T1 → T8, T9 | `usage_calendar(singleton, time_zone, week_start)` matches `readUsageCalendar`'s `WHERE singleton=1`. `spend_caps` and `spend_settings` match the T9 readers | consistent | — |
| Q4 | T1 → T10 | `spend_cap_blocks(group_id, body)` matches `gateClaim`'s upsert | consistent | — |
| Q5 | T2 → T3 | T2's `AccountsStore` interface lists methods only. T3's throttle test calls `store.db.prepare("SELECT COUNT(*) … FROM security_events …")` | **mismatch** (type error, then `undefined.prepare`) | Add `readonly db: DatabaseSync` to `AccountsStore`, documented as for criteria only (as `auth.store` is) |
| Q6 | T2 → T6 | `rotateSigningKey`, `revokeAllSessions`, `appendSecurityEvent("key-rotated")`. `key-rotated` is in both `SecurityEventKind` and `openNotices` | consistent | — |
| Q7 | T2 (internal) | `initialOwner.ts` repeats `signingKey.ts`'s `writeNew` body (`openSync(…,"wx",0o600)` / `writeSync` / `closeSync`) | defect (duplicated logic) | Export `writeNew` and call it from `initialOwner.ts`, or use the shared leaf helper (X11) |
| Q8 | **T3** routes ↔ middleware | Step 6 calls `registerAuthRoutes(app, auth)` **before** `buildApi`, and the `/api` middleware lives inside `buildApi` (`api.ts:178`, replaced by `authMiddleware`). Express runs handlers in registration order, so `/api/auth/me`, `/refresh`, `/logout`, `/password`, `/users` and `/notices` never pass the middleware. They get no `res.locals.orcaUser`, no `login-required`, no CSRF check and no password-change gate. That contradicts T3's route table ("session", CSRF on every non-login POST) | **mismatch** | Register `/api/auth/login`, then `app.use("/api", authMiddleware(...))`, then the other auth routes. Simplest form: `buildApi` calls `registerAuthRoutes(app, deps.auth)` immediately after its `/api` middleware. T4 Step 4's fixture uses the same order |
| Q9 | T3 → T4 | The legacy token arm is added in T3 and deleted in T4. The `tests/panel/fixtures/auth.ts` helpers are reused by T4 Step 5 | consistent | — |
| Q10 | T3 → T5 | `res.locals.orcaUser` (T3) becomes `res.locals.orcaPrincipal`, which T5 sets in both `authRoutes.ts` and `controlSocket.ts` | consistent | — |
| Q11 | T3 → T11 | The `GET /api/auth/me` body `{user:{id,name,roles,mustChangePassword}, expiresAt, sessionDays}` matches the web `Me`. The notices and ack routes match too | consistent | — |
| Q12 | T5 → T9 | `permissionRefusal` delegates to `humanOnlyRefusal`. T9 adds the three verbs to `HUMAN_ONLY_VERBS` | consistent | — |
| Q13 | T7 → T8, T9 | D18: the authoritative row is `unattributed` and the per-model rows are `breakdown-mismatch`. `usedTokens` excludes `breakdown-mismatch`. `groupRepoIdOf` is reused in `committedTokens` | consistent | — |
| Q14 | T8 → T9 | T8's `UsageViewV1.caps: CapStatus[]` is "`[]` until Task 9", but `CapStatus` is declared in T9's `spendCaps.ts` | **mismatch** (T8 cannot typecheck) | In T8, type it `caps: never[]` and widen it in T9, or declare `CapStatus` in `usageQuery.ts` and import it in T9 |
| Q15 | T9 → T10 | `spendCapBlocking(store, repoId, grant, at, excludeGroupId?)` is called with 4 arguments by `gateClaim` and 5 by the import ceiling. `AgentCeilingRefusal(cap, limitTokens)` matches the route message (`cap.scope/period/headroom`) | consistent | — |
| Q16 | T9 → T11 | The three routes, the `@spend` lookup, and `spendRevision` used as `expectedRevision` | consistent | — |
| Q17 | T10 → T11 | The `spendCapBlock` view shape matches the web type and the render | consistent | — |
| Q18 | T7 ↔ B1–B3 (consumed) | `ModelUsage {model,input,output,cacheRead,cacheWrite}` is sorted, unique, and absent or null when unknown. D7 reconciliation: B2's runner fixture totals 65, equal to the breakdown; B3's codex `input = input_tokens − cached` sums back to codex's own total | consistent | — |
| Q19 | T12 ↔ B-gate | T12 needs a sha the human has pushed. The fallback `c3af4d6` equals the current `package.json` pin | consistent | — |
| Q20 | T4, T7, T10 → "Task 14" | The flake list is cited as "Task 14", but the plan has no Task 14. The list is in T13 Step 2 | **mismatch** (dangling reference) | Read "Task 14" as "Task 13 Step 2" (one Ruling line) |
| Q21 | T13 Step 3 ↔ (missing step) | T13 compares against "a listing taken before Task 1 (`$SCRATCH/home-before.txt`)", but no step before Task 1 takes it | **mismatch** | Add a step to Task 0: `ls -1A ~/.orca/control > $SCRATCH/home-before.txt` (see B-T13) |

## 2. Each task checked against itself and against current code

| # | Task | Check | Finding | Ruling |
|---|---|---|---|---|
| B-T0 | 0 | Step 2 pipes `git diff … \| rg -c` | Conflicts with Rule 14 and with the plan's own Global Constraint ("never piped through grep/tail") | Write the diff to a file, then run `rg -c '^-[^-]' <file> > out; echo rc=$?` |
| B-T1 | 1 | Cited lines and structure | `store.ts:86` (the version allow-list), `requirementRecords.test.ts:27`, and `commandClient.test.ts:44,60` all hold `"7"` today. `migrateSchema` has branches "1"–"6" plus `else throw` (`migrations.ts:81-89`). `groups(id,revision,graph_version,body)` exists. The `commandLedger*.test.ts` glob matches one file | consistent |
| B-T2 | 2 | Interfaces vs tests | See Q5 and Q7. In the key test, `rotateSigningKey` uses a fixed temp name `jwt.key.<pid>.tmp` with `wx`, so a leftover from a crash makes the next rotate EEXIST | Low: unlink a stale temp first, or add random bytes to the name |
| B-T3 | 3 | Cited seams | `server.ts:40` `now?: () => Date`, `controlOptions.ts:56` `controlRoot`, `api.ts:178` middleware, `GET /api/metrics` (`api.ts:192`) and `POST /api/reviews` (`api.ts:397`) all exist. Q8 is the defect | as Q8 |
| B-T3b | 3 | Throttle expectation | 5 failures give `until = now + 2^0 s`, so `retryAfterSec` is 1 under the fixed clock | consistent |
| B-T4 | 4 | Rewrite inventory vs current token users | `rg` for `x-orca-token\|__ORCA_TOKEN__\|orca-panel-token\|TOKEN_ANCHOR\|token-required\|panel.token\|started.token` matched exactly the inventory files plus the T4 source files on `58d5e5e` | consistent on `58d5e5e`. After the rebase onto A, see X3 |
| B-T5 | 5 | `withCommandClient` deletion | See Q1 | as Q1 |
| B-T6 | 6 | `cli.ts` wiring says `case "user": …` | `main()` is an `if (command === …)` chain (`cli.ts:501-590`), not a switch. The rotate-key test body is left to the implementer (acknowledged). `tests/cli` exists | Write it as `if (command === "user") return runUserCommand(...)` |
| B-T7 | 7 | Cited call sites and fixtures | `executionDriver.ts:478` and `schedulerBridge.ts:46` call `recordUsage`. `usage.ts` drains with `subtract(next.cumulative, run.cumulative[bucket])`. `usage_events(run_id, seq, body)` supports `baseline()`. `seedBudgetCase` returns `t1Claim` and `usageRef`. Rows recomputed by hand: 15/50/10, then the unknown-baseline 20/30, then the mismatch 40 + 50 | consistent |
| B-T8 | 8 | Calendar expectations | Recomputed: NY 2026-03-08 and 2026-11-01 are the DST Sundays. Tokyo: 2026-12-27 is a Sunday, and the Jan 2027 month bounds hold. `WEEKDAYS` maps Mon…Sun to 1…7. See Q14 | as Q14 |
| B-T9 | 9 | Skill counts | `skill.test.ts` pins 22 routes and the phrase "not a security boundary" today. 22 → 25 matches the three new mutation routes. The test bodies are given as comments (acknowledged) | consistent |
| B-T10 | 10 | Dispatch shapes | `deliverScheduledStart` already returns `{kind:"blocked"; reason:string}` (`webDispatch.ts:183`). `WebDispatchDeps` has no `now` yet, and the plan adds it | consistent |
| B-T11 | 11 | — | No mismatch found | — |
| B-T12 | 12 | Pin | `c3af4d6` is current. `scripts/pin-ccloop.mjs` and `verify-ccloop-pin.mjs` exist | consistent |
| B-T13 | 13 | Step 3, "real home untouched" | **defect.** `ls -la ~/.orca/control` lists sizes and mtimes. The human's `panel.sh` panel is live and keeps writing `~/.orca/control/<key>/control.sqlite`, so `cmp` goes red whatever this round does. The baseline is also missing (Q21) | Compare names only (`ls -1A ~/.orca/control`), or assert directly that `accounts.sqlite`, `jwt.key` and `initial-password` are absent from the real control root |

## 3. Global Constraints, the spec, and defects a reviewer would flag

| # | Item | Finding | Ruling |
|---|---|---|---|
| S1 | D1 vs spec §3.1 and §9 (accounts in migration 7→8) | Recorded in §13 with reasons (no-control panels; one store per repository in legacy mode) | consistent |
| S2 | D2 vs spec §7 and §9 (first-run page; a panel with no users) | Recorded | consistent |
| S3 | D5 and D6 vs spec §6.1 (operator scope; `security_events` row per cap change) | Recorded | consistent |
| S4 | D19 vs spec §6.3.1 ("applies to every group, whoever created it") | `orca scheduler`'s `claimWork` stays ungated. This is recorded as a known gap and listed in `awaitingHuman` | consistent (the reviewer should see it named) |
| S5 | D7 vs spec §4.1 (`sum(input+output)`) | Recorded. Matches B2 and B3 | consistent |
| S6 | Error-code list vs catalogs | `csrf-required` is both in `panelOnlyErrorStatuses` (T3) and in T4's `BY_HAND`. The duplicate is harmless | No change |
| S7 | scrypt cost at every panel boot | `createPanelAuth` computes `DUMMY_HASH` (128 MiB, about 0.3 s) at every start. Under A's launchd `ThrottleInterval=10` relaunch loop (port held, exit 78), every relaunch pays it | Low: compute `DUMMY_HASH` lazily, on the first lookup that misses |

## 4. Cross-plan rows (A landed first; what this plan must do differently)

| # | Shared surface | After A | What B must change | Ruling |
|---|---|---|---|---|
| X1 | `src/panel/server.ts` ready line | A adds `panelReadyLines(started)` (stdout `orca-panel ready url=… token=${started.token}`; stderr "…(the page already carries the token)"). Both `cli.ts` `runPanel` and `runServicePanel` print through it. A also adds `PanelMode`, `createPanelServer(opts, env, mode)` and `startPanelFromArgs(args, mode)` | B T4 lists D11 and the stderr wording under `src/cli.ts` and removes `StartedPanel.token`. That breaks `panelReadyLines` at compile time | B T4 edits `panelReadyLines` only: stdout `orca-panel ready url=<url>`, stderr "open <url> in a browser and log in". `cli.ts` needs no D11 edit. Keep A's `mode` parameter when wiring `createPanelAuth` |
| X2 | `createPanelServer` close paths | A's service-mode bind failures close only `control` before throwing 78: the `listen` error closes `control?.close()`; a socket-bind failure runs `server.close` and `control.close` | B T3 adds `auth.close()` only in the `closed` handler, so the accounts DB stays open on the 78 paths | Call `auth.close()` in both of A's 78 branches too, after `control` |
| X3 | `tests/service/{build,servicePanel,realSmoke}.test.ts` | All three import `TOKEN_ANCHOR` and write it into a fixture `index.html` | B T4 deletes `TOKEN_ANCHOR`. Typecheck and the Step 9 scan (`TOKEN_ANCHOR` in `tests`) go red | Add the three files to the rewrite inventory (T4). The fixture becomes `<!doctype html><html><body></body></html>`. One Ruling line each |
| X4 | M-acc (A's "Dependency on the accounts plan") | `servicePanel.test.ts` guards `if (existsSync(initial))`, which is vacuous until this plan. A delegates "remove the guard + run M-acc" to whichever plan lands second | This plan never mentions it. The paths agree: A checks `join(ORCA_CONTROL_DIR, "initial-password")`; B writes `<controlRoot(env)>/initial-password`, and `controlRoot` = `ORCA_CONTROL_DIR` (`controlOptions.ts:57-60`). B's log line names the path only | Add to B T3 (where the line first prints): remove the guard (inventory row), and run M-acc in a clone (make `ensureDefaultOwner`'s log line include the password). Confirm `servicePanel` test 1 goes red, and record it in this ledger and next to A's pending M-acc |
| X5 | Regression scope | `tests/service` boots panels through `startPanelFromArgs` and `createPanelServer` (service mode, the build test) | B T3 Step 7 runs `tests/panel tests/memory tests/entry` only | Add `tests/service` to T3 Step 7. T4 onward already runs the full suite |
| X6 | `src/cli.ts` dispatch and USAGE | A rewrote the `panel` branch (`run`/service subcommands). The USAGE entry is now `orca panel run --by <who> …`, plus install/start/status/logs lines. `tests/panel/usage.test.ts` pins "orca panel run --by <who>", "orca panel install", "orca panel status", "orca panel logs [-f] [-n <lines>]", "orca panel start [--detach]", "neither restarts on crash nor survives a reboot" and "ask the person" | B T4 (`--session-days`, token sentences) and B T6 (`user`) edit the same text | Rebase the text only: keep every pinned A substring, add `--session-days` to the `orca panel run` entry, and use `if (command === "user")` (B-T6) |
| X7 | `skills/orca-control/SKILL.md`, `tests/entry/skill.test.ts` | A adds one §1 bullet (service commands: ask the human). It is not a route and not a table row | B T9 edits §2/§4/§6, the phrase list, and the route count 22 → 25 | consistent. Keep A's bullet. The count is unaffected |
| X8 | `tests/panel/usage.test.ts` | A adds one `it` | B T6 Step 4 runs the file | consistent |
| X9 | `src/panel/rejection.ts` | A: `PanelExitCode = 1\|4\|5\|78`, `PANEL_BIND_FAILED` | B renames `TOKEN_REQUIRED` → `LOGIN_REQUIRED` and adds codes | consistent (text only) |
| X10 | `tests/setup/relocateUserData.ts` | A relocates `ORCA_PANEL_DIR`, `ORCA_LAUNCH_AGENTS_DIR`, `ORCA_SYSTEMD_USER_DIR`, `ORCA_SERVICE_LABEL` and `ORCA_SERVICE_UNIT`, and guards the real plist and unit | B does not edit the file. B's Global statement (it relocates `ORCA_CONTROL_DIR` and snapshots `~/.orca`) still holds | consistent |
| X11 | Private-file helpers | A's `src/service/files.ts` `ensurePrivateDir` creates new levels 0700 and **chmods** them. B's `src/panel/accounts/signingKey.ts` exports its own `ensurePrivateDir` (`mkdirSync` mode only, no chmod) | That makes two exported helpers with the same name and different semantics (Rule 7). Importing A's helper from `panel/accounts` as A wrote it would make a cycle: `server.ts` → `auth` → `signingKey` → `service/files` → `config` → `server.ts` | Take A's preflight ruling P20 (a leaf `src/service/privateFiles.ts` that imports only `node:fs`). B imports `ensurePrivateDir` and `writePrivateFile` from it instead of defining its own. B's mutation (d) is unchanged |
| X12 | Gate | A added `npm run build` (`tsc -p tsconfig.build.json`, `rootDir: src`) and put it in `verify` | B T13 Step 1 does not run it. A B `src` file that imports from outside `src` (TS6059) would pass B's gate and break the service build | Add `npm run build` to B T13 Step 1 |
| X13 | `ORCA_CONTROL_DIR` across the service and `orca user` | A's `service.json` records `ORCA_CONTROL_DIR` only when the installing shell set it. B's accounts live at `controlRoot(env)` | If `orca user add` runs with a different `ORCA_CONTROL_DIR` than the service, it silently writes a second accounts store | B T6 prints the accounts path it opened (one line). B T11's README "Logging in" says to run `orca user` with the service's `ORCA_CONTROL_DIR` (`orca panel install --dry-run` shows it) |
| X14 | A's Global Constraint "same stdout ready line `orca-panel ready url=<url> token=<token>`" | Superseded by this plan's D11. A's ledger is history (Rule 13) | — | One Ruling line in this ledger names A's constraint as superseded by D11. `README.md:225` is already in T4 |
| X15 | A's `status` identify | Over the socket it is `GET /api/control/summary`, which B T5's agent principal may read. With no socket it falls back to `GET /`, and static files stay unauthenticated (B spec §3.4) | — | consistent |
| X16 | A's panel-booting criteria after B | Every boot creates `accounts.sqlite`, `jwt.key` and `initial-password` under that test's `ORCA_CONTROL_DIR` (`join(out,"c")`, `w.controlDir`, the smoke's `root/c`), never under the real home | — | consistent |
| X17 | Handoff to the human under the service | The first login needs `~/.orca/control/initial-password`. The log line lands in `~/.orca/panel/logs/panel.err.log` (A spec §6) or the journal | B T11's README paragraph does not say where the line goes under the service | Add one sentence: "under `orca panel install`, see `orca panel logs`" |
| X18 | Relaunch cost under A's launchd throttle | See S7 | — | as S7 |

Row counts: §1 21, §2 15, §3 7, §4 18; 61 in total.
