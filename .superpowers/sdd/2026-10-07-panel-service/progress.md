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
