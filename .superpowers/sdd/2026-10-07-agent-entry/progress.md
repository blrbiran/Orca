# SDD ledger — plan: docs/superpowers/plans/2026-10-07-agent-entry.md

Controller: Claude Code session 6cc0c1e9, 2026-10-07. Spec: docs/superpowers/specs/2026-10-07-agent-entry-design.md (§12 = plan-time decisions D1–D5). Start commit: 97ca3f4 (main).

## Pre-flight scan

| Pair / task | Produces → consumes | Finding |
|---|---|---|
| T1 → T4 | `withCommandClient`, `CLIENT_HEADER`, `CLIENT_PATTERN` → T4 header middleware and route wrapper | consistent names |
| T1 → T5/T6/T8 | `CLIENT_HEADER`, `CLIENT_PATTERN` → socketClient, controlCommand, mcp | consistent |
| T2 → T4 | `humanOnlyRefusal(verb, payload)` → socket gate | consistent |
| T3 → T4 | `ControlChannel`, channel param of `registerControlReadRoutes`/`registerControlMutationRoutes`, `buildControlSocketApp` → gate + middleware | consistent; T3 adds param with no behaviour, T4 uses it |
| T3 → T5 | `CONTROL_SOCKET_NAME`, `socketPathTooLong` → discovery, socketClient | consistent |
| T3 → T4/T6/T8 tests | workspace/boot/overSocket helpers copied into each test file | duplication across four test files (see Ruling P2) |
| T5 → T6/T8 | `controlGet`, `controlSend`, `discoverSocketPath`, `exitCodeFor`, `localError`, `EntryRejection` | consistent signatures |
| T6/T8 | both edit `src/cli.ts` dispatch and USAGE | sequential, no conflict |
| T1 self | test reads `control.sqlite`; store file name unverified | brief says to check store.ts |
| T2 self | walker relies on zod 3 internals (ZodEffects.innerType, discriminatedUnion.options) | acceptable, zod pinned ^3 |
| T3 self | C2 stale-socket uses `_handle.close()` hack; brief gives SIGKILL child alternative | implementer picks the reliable one |
| T3 self | close order: socket closed before control.close in three paths | consistent with spec §3.3 |
| T4 self | ledger read via read-only node:sqlite while panel holds the DB | fine (separate read connection) |
| T5 self | tests/expectations agree with code (checked by hand: path/argument refusals, commandId on local errors) | consistent |
| T6 self | in-process argv tests agree with parser (checked each arg vector) | consistent |
| T7 self | route-regex test counts 23 routes from controlApi.ts source | brittle-by-design drift check |
| T8 self | SDK API names may differ by version; brief says adapt and record | ok |

Ruling P1: implement on main, not a worktree branch — the human asked for this round to be implemented with SDD and every prior round (project filtering) landed on main; no other agent is working on main (worktree list 2026-10-07 shows only stale/other branches) — if wrong, the commits are local and unpushed and can be moved to a branch with `git branch` + reset by the human.
Ruling P2: the shared socket-panel test helpers live in one fixture module `tests/panel/fixtures/socketPanel.ts` created in Task 3 and imported by Tasks 4, 6 and 8, instead of copying them into four files — the plan's "copy, do not import across test files" was to avoid importing from another *test* file; a fixture module is the repo's convention (`tests/panel/fixtures/controlPanel.ts`) — if wrong, cost is a fixture file to inline.
Ruling P3: this ledger is kept and committed with `git add -f` at the end instead of deleting the workspace as the SDD skill says — repo convention and CLAUDE.md Rule 13 keep `.superpowers/sdd/**` as evidence — if wrong, the human deletes one directory.

## Tasks
Task 0: complete (commit 97ca3f4, controller; spec §12 appended, plan committed)
Ruling P4: Task 2's implementer is dispatched while Task 1's review runs (disjoint files, one implementer at a time); a Task 1 fix round waits for Task 2 to finish — saves wall-clock — if wrong, cost is serialising one fix.
Task 1: review 1 — spec ✅, Needs fixes: Important (plan-mandated) no test covers the client write in persistCommandOutcome (commandLedger.ts) nor hash invariance; fix round 1 queued until Task 2's implementer finishes (P4).
Task 1: minor (deferred): commandClient test's "background work" comment does not start background work.
Task 1: minor (deferred): schema6To7 not idempotent (SQLite lacks ADD COLUMN IF NOT EXISTS); downgrade tests coupled via DROP COLUMN.
Task 1: minor (deferred): implementer commit trailer names Claude Sonnet 5.5 (the subagent's real model) rather than common.md's Opus line — Ruling: keep, attribution is accurate — cost if wrong: one trailer wording.
Task 2: minor (deferred): C19 walker silently skips unhandled zod kinds (record/lazy/pipeline/tuple…); a future amount nested there escapes — final review to triage (fail-loud else branch).
Task 2: complete (commits 3997564..91d63cb, review clean)
Task 1: fix round 1/5 (2 addressed, 0 open — ledger-level client write + hash invariance test; real background-timer test; commits 91d63cb..8244e17)
Task 1: complete (commits 97ca3f4..8244e17 [3997564, 8244e17], review clean)
Ruling P5: Task 5 (src/entry, disjoint files) is implemented before Task 4 and while Task 3's review runs; Task 4 follows Task 3's review — order does not matter for interfaces (T5 consumes only T1/T3 exports) — if wrong, cost is one reorder.
Task 3: review 1 — Needs fixes. Important (plan-mandated): socket.close() does not wait for in-flight socket requests before control.close() releases the store (spec §3.3). Ruling: the spec wins over the brief's sync close shape — handle.close() returns a promise resolved on the socket server's close event; control.close() runs only after both servers closed — cost if wrong: slightly slower shutdown.
Task 3: minors folded into fix round 1 (cheap): bind pre-listen errors fail soft; isSocketAt guarded in close; C15 fetches the Web UI; comment on why the explicit unlink is safe. Ruling: D1 stderr-line test is owned by Task 6's spawned-panel C3 criterion (it waits for that line) — cost if wrong: one more assertion.
Task 3: minor (deferred): leftover once("error") listener after listen (mirrors TCP code).
Task 5: minor (deferred): control-socket-timeout branch untested (socketClient.ts).
Task 5: minor (deferred, plan-mandated): socket errors other than ENOENT/ECONNREFUSED (ECONNRESET, EACCES, ENOTDIR, bad query chars) throw raw → CLI exit 3 instead of one-line local error — final review should triage (candidate: map to control-socket-error).
Task 5: minor (deferred): checkPath split("?", 2) drops text after a second "?" in its check only.
Task 5: complete (commits 7279483..8efb01a, review clean)
Task 3: fix round 1/5 (5 addressed, 0 open — socket drained before control.close; fail-soft pre-listen; guarded close unlink; C15 Web check; unlink comment; new C16 in-flight criterion; commits 8efb01a..944f502)
Task 3: minor (deferred): TCP server has no closeIdleConnections, a keep-alive browser connection delays control.close (pre-existing).
Task 3: complete (commits 8244e17..944f502 [7279483, 944f502], review clean)
Ruling P6: Task 6's implementer moves the execution-port boot (fake-ccloop, inline in controlSocketGate.test.ts) into the shared fixture as an exported option and reuses it — set-workspace-mode 404s without a port, and T6/T8 E2E need it — cost if wrong: one fixture refactor.
Task 4: minor (deferred): stale comment controlApi.ts:111 ("for now it is only carried").
Task 4: minor (deferred): Web channel ignoring x-orca-client untested (add header to C12 webPost).
Task 4: minor (deferred): C11 "books nothing" assertion targets a 404 route, may be vacuous (status assertion carries it).
Task 4: minor (deferred): String(res.locals.orcaClient) would record "undefined" if middleware absent — fail loud instead.
Task 4: complete (commits 944f502..c6f6a87, review clean)
Ruling P7: the spec's "23 mutation routes" (§2) is wrong — 23 verbs, 22 routes (shutdown has no route); the skill test pins 22 — correction recorded here, the spec text stays verbatim (Rule 13) — cost if wrong: none (measured from controlApi.ts).
Task 7: minor (deferred): SKILL.md should name the revision field (commandRevision) and where repoId/operatorId come from; exit-code token check is loose.
Task 7: complete (commits 66e6b92..c7a50b5, review clean)
Task 6: Ruling: accept the out-of-brief controlApi.ts fix (command-result GET looks the result up before readVersions) — repository/operator scope results were unlookable on both channels (no groups row → group-not-found); reviewer traced every normal Web response unchanged; the only change is a retained row for a group with no groups row now answers 200 (fixes an endless retry in App.tsx) — cost if wrong: one route revert.
Task 6: minor (deferred): socket/projects-file errors beyond ENOENT/ECONNREFUSED crash with exit 3 and empty stdout (same as Task 5 deferred item).
Task 6: minor (deferred): repository-scope miss answers group-not-found, not command-result-not-found (agents cannot tell "absent" for @repository/@operator scopes).
Task 6: minor (deferred): E2E replay assertions weaker than test name (no code/status/byte compare on replay).
Task 6: minor (deferred): spawned E2E panel inherits developer ORCA_AGENTS_TABLE/ORCA_CCLOOP_BIN; set ORCA_AGENTS_TABLE="".
Task 6: minor (deferred): USAGE lists exit 0/1/2, not 3.
Task 6: minor (deferred): C3 stderr assertion never seen red by a mutation.
Task 6: complete (commits c6f6a87..66e6b92, review clean)
Task 8: note — npm audit --package-lock-only reports 8 vulnerabilities (3 moderate, 2 high, 3 critical: vitest/vite/esbuild/tinypool/proxy-addr/source-map-js) both at 97ca3f4 and at 05a1e70; none introduced by @modelcontextprotocol/sdk 1.32.1 (outputs scratchpad/n2/audit-base.txt, audit-head.txt). Not fixed this round (dependency upgrades out of scope).
Task 8: minor (deferred): stdin-end path returns without server.close().
Task 8: minor (deferred): bridge expectedRevision type check untested (equivalent mutant; operations re-validates).
Task 8: minor (deferred): no test asserts the mcp:<name> header reaches the panel.
Task 8: complete (commits c7a50b5..05a1e70, review clean)

## Final review (opus, 97ca3f4..05a1e70)
Verdict: Needs fixes — I1 transport/discovery errors break one-JSON-line + lose commandId; I2 human-only gate is a guardrail not a boundary (GET / serves the token to any same-user process; Web channel ungated) — undocumented; I3 skill revision sources/id sources; I4 C3 stderr assertion never seen red; triage 10 stale comment; triage 18 hermetic env in spawned tests.
Ruling F1: one fix wave covers I1, I2 (spec correction appended as §13, Rule 13), I3, I4 (clone mutation), triage 10, 18, plus cheap hardening: channel param required (no fail-open default), C19 walker throws on unhandled zod kinds, timeout test, Web-ignores-header assertion, `--control-state-dir ""` refused, control-cli-response-invalid retryable on send, fail loud when res.locals.orcaClient is not a string — cost if wrong: small extra diff.
Ruling F2: deferred (recorded, not fixed): socket-owner uid check in the client; warning for a pre-existing group/other-writable state dir; leftover once("error") listener; mcp stdin-end without server.close; mcp:<name> header test; repository-scope miss answering group-not-found (skill tells agents to resend with the same --command-id instead); planImport limit shaped by agent-chosen task count (declined-to-judge, surfaced to the human) — cost if wrong: hardening later.
Final fix wave: commits 786d959, affbb4a, d82826f, 8b8a022 (on top of checkpoint 145467b); report final-fix-report.md (11 clone mutations, 10 red, 0/0 restores; I4 C3 stderr mutation red).
Final fix wave re-review (opus): all findings addressed, no new Critical/Important.
Final: parked — H7 typeof guard survives its own deletion (ledger insert already rejects undefined → same 500, nothing booked) — Ruling: keep the guard as a named early failure; equivalent mutant recorded — cost if wrong: one redundant line.
Final: parked — discovery EACCES branch has no own test (shares the ENOTDIR catch, which is tested) — Ruling: accept — cost if wrong: one test.
Final: note — subagents reported a hook context estimate (~367k) mid-task; Rule 6's figure is per context window of the agent, the fix agent finished; controller window at ~376k at this point (hook level line) — surfaced to the human in the final report.

## Task 9: gates (controller, 2026-10-07)
Tree: 8b8a022 (subject `docs(skill): say where each revision and id comes from; correct the gate's reach`). Isolated `git clone --local` at scratchpad/orca-n2; HOME + four XDG roots relocated to scratchpad/home; TMPDIR=/private/tmp/claude-501/og7/t; ORCA_CCLOOP_BIN = ccloop c3af4d6 clone build (scratchpad/ccloop-pin), ORCA_AGENTS_TABLE = fake codex `integration` table. Script scratchpad/gate2.sh; raw outputs scratchpad/g2/*.txt (session scratchpad, expires with the session; conclusions only here).

| Gate | RC | Counts | Load (1/5/15 at end) |
|---|---|---|---|
| npm ci | 0 | | |
| web build | 0 | | |
| typecheck | 0 | | |
| npm run --ws check | 0 | web 70 files / 490 tests | 13.7 6.9 6.1 |
| npm test | 1 | 318 files (316 passed, 2 failed); 2860 tests (2852 passed, 2 failed, 6 skipped) | 7.7 14.1 11.1 |
| verify:control | 0 | 129 files; 1321 passed, 4 skipped | 12.3 11.3 10.8 |
| verify:panel | 0 | PASS 0–14 | 16.7 12.4 11.2 |
| check-tmp-leak | 0 | 0 entries left (its inner vitest exit 1; failures not recorded by the script) | 5.7 11.4 11.8 |

npm test failures: `tests/chain/gateCheck.test.ts` K13 and `tests/control/driverRequirementSplit.test.ts` "fails the third consecutive invalid draft…" (5000 ms timeout) — both already registered load flakes. Re-run alone together 3 times at load 5.5→4.6: 3/3 green (2 files, 27 tests each). Flakes stay registered, not closed. The 6 skips are the real-binary files (ccloopDefaultE2E 3, driverSkillsReal, syncskillReal, ccmemReal).
Reading note (Rule 14): the controller read rc.txt whole and the summary/FAIL sections of fulltest/vcontrol/vpanel/tmpleak outputs (tail), plus a FAIL count (2) of the whole fulltest file — not every line of the 2860-test log.

Mutation evidence (Rule 9): every task's mutation table lives in its report in this directory (task-1..8-report.md, final-fix-report.md). Spec §9's named branches: stale-socket unlink (T3 a), chmod (T3 b), shutdown unlink (T3 c equivalent — server.close unlinks; c2 red), in-flight drain (T3 fix C16), human-only verb (T2 a, T4 b), human-only fields (T2 b/c, T4 b), client header (T4 a), client write (T1 #4), commandId match (T1 a), discovery order + projects file (T5 a/b), panel-not-running (T5 e), exit mapping (T5 d), one-line output (T6 a), D1 stderr line (final I4), transport mapping (final), MCP isError/prefix/arg check (T8). Equivalent mutants recorded: T3 c, T8 c, final H7 guard.

Round status: Tasks 0–9 complete; final review → one fix wave → scoped re-review clean. Nothing pushed.

## Human review (2026-10-07, session 9a20ac38, recorded on top of `docs(handoff): N2 agent entry is done; next is isolated ccmem/syncskill acceptance and the ccloop reds`)

Earlier lines are kept as written; this section records the human's answers to the round's open points.

- Every `Ruling:` line in this ledger (P1, P7, Task 3 exit order, Task 6 out-of-brief fix, F1/F2 and the parked items) — Human: approved ("同意替我做的决定").
- Spec §13 (human-only gate is a guardrail, not a boundary) — Human: it must become a real boundary. Constraint from the human: no separate OS user, no system-level user isolation. Not yet designed; goes to a new spec.
- Open item "group limit computed from the plan's task count, which an agent chooses" — Human: accepts the controller's proposal — a human-only ceiling on what agent-channel imports may produce, settable per project and overall; caps may be total-only or periodic (per week / per month); the human can see current usage (total / this week / this month, period adjustable) and change the caps. Research of openclaw and hermes-agent usage tracking authorized. Goes to the same new spec.
- `npm audit` 8 vulnerabilities — Human: fix them this round.
- Panel restart — Human: authorized. Session 9a20ac38 stopped an orphaned test-fixture panel (pid 96962, `--by tester`, state dir under the system TMPDIR, parent pid 1) and started `~/.orca/panel.sh`; `control.sock` exists, mode 0600; `orca control get groups --control-state-dir ~/.orca/control/orca-e0c92460` → RC 0.
- Found while restarting: with one `--repo` the panel's state dir is `~/.orca/control/<repo key>`, but `orca control` without `--control-state-dir` falls back to `~/.orca/control/panel` and answers `panel-not-running` (RC 1, measured). Discovery does not find the human's panel by default. To fix.
- Discovery fix (session 9a20ac38): `src/entry/discovery.ts` lists `<control root>/*/control.sock` when the default path holds no socket; one → used, several → `control-socket-ambiguous`; spec §14. Mutations a (drop single return), b (drop ambiguous throw), c (drop default-first) each red in a `git clone --local` copy; copy restored byte-identical (`cmp`). Ruling: the existing criterion "prefers the flag, then …" stubs HOME for its `~/.orca` line (tightening, intent unchanged; against the real home it would now find the person's running panel) — Human to review — cost if wrong: one assertion's setup. Live check after the fix: `orca control get groups` with no flag → RC 0 against the human's panel.
- Follow-ups (session 9a20ac38): human chose accounts + JWT login for the whole Web UI, an `agent` principal on the socket, per-model tokens reported by ccloop, caps in tokens (overall/per project × total/week/month). Draft spec `docs/superpowers/specs/2026-10-07-accounts-and-spend-caps-design.md`, awaiting human review. Human named the three ccloop criteria (stopProof, codexWatchdog ×2) → ccloop human ruling 139, landed locally in ccloop. Human asked to merge the UI branch: the Orca Tier 0 gate blocked the agent's `git merge --ff-only` (Rule 15) → awaitingHuman; the npm-audit branch (vitest 2→5.0.3, audit 8→0) is stacked on it. syncskill rebuilt by the agent at the human's request (`npm run build`, RC 0; tree clean).
