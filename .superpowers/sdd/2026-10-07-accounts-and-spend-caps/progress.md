# SDD ledger — plan: docs/superpowers/plans/2026-10-07-accounts-and-spend-caps.md

Plan written by Claude Code session 9a20ac38, 2026-10-07, on top of `docs(plan): task-by-task implementation of the panel as a per-user service`. Spec: docs/superpowers/specs/2026-10-07-accounts-and-spend-caps-design.md (§13 = plan-time decisions D1–D19, appended by Task 0). Execution: superpowers:subagent-driven-development in a new session; the controller of that session records its own id, start commit and branch choice here. Part B runs in the ccloop worktree branch `orca/usage-by-model`; its evidence goes in the "Part B" section below.

Pre-authorized by the human: rewrites of existing Orca criteria follow the controller's recommendation and are recorded as `Ruling:` lines (rewrite inventory in the plan, 28 entries); reported at the end, no stop. Not extended to ccloop (Orca Rule 16; ccloop Rules 15, 18).

## Pre-flight scan

| Pair / task | Produces → consumes | Finding |
|---|---|---|

## Tasks

## Part B (ccloop)

## Controller (appended by the executing session)

Controller: Claude Code session 30bd7e40 (claude.ai session_015m3hAnKcXK1pE3xYwnLTXz), 2026-10-07. Start commit: `docs(handoff): N2 reviewed; two approved plans (panel service, accounts and spend caps) are next` (Orca main = origin main at start, by `git ls-remote`). Orca worktree `/Users/biran/code/skills/loop/Orca-accounts`, branch `accounts-spend-caps`; ccloop worktree `/Users/biran/code/skills/loop/ccloop-usage-by-model`, branch `orca/usage-by-model` from ccloop main `docs(handoff): roll the Orca line onto ruling 139 done and the byModel plan next`. Gate ccloop: clone of `c3af4d6` built in the session scratchpad (`ccloop-pin/dist/cli.js`).

Ruling: order is Part B (B1–B3) first, then the whole panel-service plan, then Orca Tasks 0–13 here — so the ccloop branch reaches the human early and Task 12 is not waiting at the end — cost if wrong: none beyond ordering.
Ruling: this branch is rebased onto the final `panel-service` commit before Orca Task 0 (it holds only ledger commits until then), so the human can land both with `--ff-only` in order and this plan does the "lands second" duties (servicePanel guard removal, M-acc) — cost if wrong: accounts cannot land before panel-service; rebasing onto main instead is mechanical.
Ruling: Part B and panel-service run serially, not in parallel — parallel clones raise load and the registered load flakes then dominate triage — cost if wrong: wall-clock only.
Ruling: worktrees live beside the repositories (`../Orca-panel-service`, `../Orca-accounts`, `../ccloop-usage-by-model` as the plan names for ccloop), not in the session scratchpad, so uncommitted work survives the session — cost if wrong: three sibling directories for the human to remove (Tier 0, awaitingHuman).
Ruling: in Part B, "whole ccloop suite green" means `node scripts/check-known-reds.mjs <vitest json>` exits 0 (ccloop handoff: known-red list, load flakes) and any failure outside the list is re-run alone with `uptime` before it counts as a red that stops Part B — cost if wrong: a real red mistaken for a flake; mitigated by the single-file rerun.
Ruling: the SDD skill's "delete the plan workspace at the end" is not applied — Orca Rule 13 keeps `.superpowers/sdd/**` as the evidence chain; scratch files (briefs, reports, review packages) stay untracked — cost if wrong: untracked clutter in the worktree.

## Part B progress
Task B1: complete (ccloop commits e5ad09a..2f053d6, review clean; whole suite 1191/1191, check-known-reds rc=0, typecheck rc=0, mutations (a) drop spread, (b) drop sort refine both seen red, restore 0/0 bytes — per task-B1-report.md)
Task B1: minor (deferred): `byModelSchema` accepts `[]` (two encodings of "unknown") — Ruling: B2 adds `.min(1)` to `byModelSchema` and the worker never passes an empty breakdown — cost if wrong: one extra refusal path in ccloop.
Task B1: minor (deferred): no `.max` on the breakdown length (bounded by distinct model names).
Task B1: minor (deferred): ccloop's sort is JS code-unit `<` on `model`; Orca Task 7 must sort/compare the same way, never `localeCompare` — carried into the Task 7 dispatch.
Task B2: review (ddfdf9f) — spec compliant; 2 Important: (1) a `modelUsage` in claude's `structured_output` survives into the runner answer (model could write the breakdown it is charged by); (2) worker loop wiring (`settle` call, `...byModel` spread) untested — tests copy the callback. Minor: model-name guard untested; comment on malformed modelUsage failing the run; duplicated sort comparator.
Task B2: minor (deferred): sort comparator written twice (`claude-stream.mjs`, `worker.ts`) — could share a helper in `usage.ts`.
Task B2: note: whether real claude's `modelUsage` sums to its `usage` (side calls) is unverified without a paid run; if it does not, ccloop omits `byModel` and Orca books `unattributed` — already listed as a known gap in the Orca handoff §4.0.

## Pre-flight scan (executed)

The table (61 rows, 18 cross-plan against panel-service landing first) is in `preflight.md` beside this ledger. Rulings:

Ruling: Q8 (Task 3) — the auth routes must be registered after the `/api` middleware so `/me`, `/refresh`, `/logout`, `/password`, `/users` get the login check, CSRF and the password-change gate (only `POST /api/auth/login` is exempt, per Global Constraints) — cost if wrong: none; the plan's order was an auth bypass.
Ruling: Q5 — Task 2's `AccountsStore` exposes `db` (Task 3 uses it) — cost if wrong: a wider store interface.
Ruling: Q14 — Task 8 types `caps` as `never[]` until Task 9 introduces `CapStatus` — cost if wrong: none.
Ruling: Q1 — Task 5 keeps `withCommandClient` (two existing tests call it) — cost if wrong: one unused-looking helper.
Ruling: Q20 — the plan's "Task 14" reference reads as Task 13 Step 2 — cost if wrong: none.
Ruling: Q21 / T13 — the real-home check cannot compare `ls -la` (the human's live panel changes it). Baseline taken by the controller before any task: `find ~/.orca -name accounts.sqlite -o -name jwt.key -o -name initial-password` → empty (0 bytes, file `home-acc-files-before.txt` in the session scratchpad); Task 13 Step 3 re-runs it and requires empty — cost if wrong: misses another kind of stray write (the per-file `relocateUserData` snapshot still guards those).
Ruling: X1, X3 — after panel-service lands, the ready line lives in `panelReadyLines` in `src/panel/server.ts`, and three `tests/service` files import `TOKEN_ANCHOR`; those files join this plan's rewrite inventory — cost if wrong: none.
Ruling: X4, X5, X12 — this plan takes over panel-service's "lands second" duties: remove the `existsSync(initial)` guard in `tests/service/servicePanel.test.ts` and run mutation M-acc; Task 3's regression run includes `tests/service`; Task 13's gate includes the root `npm run build` — cost if wrong: none.
Ruling: X2, X13 — panel-service's exit-78 bind-failure paths call `auth.close()`; `orca user` resolves the same `ORCA_CONTROL_DIR` as the service panel (the service env carries it), so it never writes a second accounts store — cost if wrong: none.
Task B2: fix round 1/5 (4 addressed, 0 open — structured_output modelUsage dropped; real-worker loop test; model-name guard cases; adapter comment; commits ddfdf9f..917d65e; suite 1207/1207, known-reds rc=0; mutations h,i,j,k,k2 seen red, restore 0/0)
Task B2: complete (ccloop commits 2f053d6..917d65e, review clean after 1 fix round)
Task B3: complete (ccloop commits 917d65e..bb96485, review clean; suite 1210/1211 with the one red = load flake claudeAgentAdapter "a complete answer written after a stop is returned for execute" outside the ccloop known-red list, re-run alone 24/24 green at lower load; mutations (a) no cached subtraction, (b) adapter does not attach — seen red, restore 0/0; codex has no singleCall path, confirmed by grep: no `singleCall` in src/runtime/codex)
Task B3: minor: the controller-added null-model branch had no named deletion mutation (a test case for "" exists) — run as mutation (c) in the B-gate dispatch.
Task B3: minor (deferred): malformed-usage and cached>total null branches in `codexModelUsage` are unreachable after `decodeCodexResult` validation; no test.
B-gate (ccloop worktree, head = `feat(codex): report usage for the run's model`): typecheck rc=0; build rc=0; vitest 1211/1211 rc=0, check-known-reds rc=0 (load 6.5 before, 27.4 after); verify:control rc=0 (51 files / 490 tests) with ORCA_CCLOOP_BIN = the worktree's own dist and a scratch agents table of the two fake CLIs — bare it exits 1 because it requires those two env vars (not a code failure); add-only holds: tests diff = 4 new files, 0 deletions; mutation B3(c) (drop the null-model guard) seen red at codexModelUsage.test.ts:28, restore 0/0. Full table: `partB-gate.md` beside this ledger.
Part B mutation table: B1 (a) drop spread, (b) drop sort refine; B2 (a)(b)(c) per brief + extras, fix round h (structured_output modelUsage kept), i (drop byModel spread in worker), j (drop settle call), k/k2 (model-name guard); B3 (a) no cached subtraction, (b) adapter does not attach, (c) drop null-model guard — every one seen red with restore 0/0 bytes (details in task-B1/B2/B3 reports and partB-gate.md).
awaitingHuman (Part B): ccloop branch `orca/usage-by-model` (4 commits on ccloop main `docs(handoff): roll the Orca line onto ruling 139 done and the byModel plan next`) is green; merge it into ccloop main (`--ff-only` if main has not moved) and push, then give the Orca session the pushed 40-hex commit for Task 12. B4: name `tests/control/singleCallCapability.test.ts` C1 for the `usageBreakdown` flag, or drop the flag (Orca consumes no behaviour from it).
