# Task B2 review

Reviewer: Orca session 026d10e3 task-reviewer subagent, 2026-10-15. Package `review-20301d89..08276cf2.diff`
(f084ed58, a3c723c9, 08276cf2). Clone `/private/tmp/oec/mut/b2` at 08276cf2, web build rc=0
(`/private/tmp/oec/logs/b2-webbuild.log`). Logs: `/private/tmp/oec/mut/logs/<name>.*`; specs `/private/tmp/oec/mut/specs/b2/`.

## Spec compliance: ✅

- `errors.ts`: `"group-execution-pending": 409` with the brief's comment, after `start-state-conflict`. Verbatim.
- `webDispatch.ts`: `startRefusedAsPending` / `refuseStart` verbatim. The pre-probe check is the first statement in `try {`,
  after `preflightWebCommand`, so the order is: replay / revision-conflict / group-archived, then requirement-not-split
  (a clarifying group is excluded before the probe and refused first inside the transaction), then
  group-execution-pending, then the rest. The refusal is ledgered through `applyWebCommand` with a throwing
  `expand`/`apply`. The in-transaction re-check sits directly after the clarifying check. This is spec B §3.2 as written.
- "Nothing booked": C1 fingerprints groups (revision, projection_seq, body), activity, wakes, funded_allowances and
  work_items, and checks that they are unchanged. The ask count is unchanged, the ledger row has status 409, and a
  replay of the same `commandId` returns an identical body with no new ask.
- resume-dispatch, resume-from-handoff, continue-task, retry-task and recovery-retry are unaffected. The only caller of
  `scheduleStart` is `WebControlService.start` (`webService.ts:566`), and no other command path changed.
- `SKILL.md:32`, `en.ts`, `zh.ts`: verbatim from the brief. SKILL.md names the refusal.
- Tests: verbatim from the brief, with one deviation. The held real-state criterion uses one task and delivers the
  resume wake (`{kind:"idle"}`) before the premise. This is justified: the brief's premise `[0,0]` is false in
  production. The criterion is still red under B2e-held (see below), so it is not hollow.
- Controller rulings (they are rulings, not findings), checked to be implemented exactly:
  - R1 / Option A and the handoffFailedRetry ruling (`driverHarness.ts`): `claim()` delivers an undelivered
    start/no-start/resume wake that is already waiting. It arms one with `replenishStartWakes` only when none is
    waiting, and keeps a fresh `start` when nothing is pending. This is default-preserving.
  - `handoffFailedRetry.test.ts`: only the `reopen()` `t.claim` changed, by one guarded line plus a comment and an
    import. No assertion changed. It uses the file's own `claim(t)` (the driver's `deliverScheduledStart`) rather than
    the fixture's `t.claim`, because the fixture's would hold the closed store's service. That matches the ruling's
    intent: claim through the driver path instead of a fresh start.
  - `shutdownHealing.test.ts:142`, ruling option (a), which supersedes the first shutdownHealing ruling in progress.md:
    one added `deliverScheduledStart(...) → {kind:"claimed"}` assertion, plus `"scheduled"` → `"group-execution-pending"`
    with the #53 comment. No other assertion changed.
- The implementer-named model trailers are a controller ruling, not a finding.

## Findings

### Critical
None.

### Important
None.

### Minor
1. **Misplaced JSDoc.** In `src/control/webDispatch.ts:127-129`, the existing doc comment of `scheduleStart`
   ("Commit the durable start wake only after the frozen profiles still probe clean.") now sits directly above the new
   JSDoc of `startRefusedAsPending`, so `scheduleStart` (`:138`) has lost its doc comment. The brief said to add the
   helpers "before `export async function scheduleStart`".
   - Fix: move the two helpers above line 127, so the original comment stays attached to `scheduleStart`.
2. **The socket criterion goes red with a TypeError, not an assertion diff.** In
   `tests/panel/startGuardSocket.test.ts:29`, `JSON.parse(socket.text).error.code` throws a TypeError on a 202 answer.
   It throws at the named assertion line, but the 202 is never shown.
   - Fix: use `JSON.parse(socket.text).error?.code`. Under B2j it then reads `[202, undefined]`.
3. **Stale test title.** `tests/control/shutdownHealing.test.ts:108` still says "…and then accepts start", but the
   criterion now asserts that the start is refused with `group-execution-pending`.
   - The ruling did not name the title, so it was rightly left alone. The controller may wish to retitle it under the
     same ruling (for example, "…and then dispatches the queued task").
4. **(Informational) The C2 "active work run alone" premise also holds a running estimate,** as the implementer noted.
   - B2f still goes red on this criterion, and only through the work-run disjunct. The test's premise excludes the
     other two disjuncts: it asserts 0 undelivered execution wakes, and it sets the task to `ready`. Under the
     mutation, start falls through to `estimate-in-flight` (received `estimate-in-flight`, expected
     `group-execution-pending`).
   - The criterion is therefore sound. The co-running estimate only changes which code the mutant answers.

## Mutations (all in the b2 clone)

- Runner self-check, bad spec: the runner exits 2, and `.mutate` says "found 0".
- Baseline: 7 files, 90/90 passed, 0 skipped, rc=0 (`/private/tmp/oec/logs/b2r-baseline.log`).
- For every mutation below, the sha after differs from the sha before, the restored sha equals the sha before, and the
  restore bytes are 0 / 0.
- `pgrep -fl "fake-ccloop|worker.js|vitest"` before and after, including around B2z: none (rc=1).
- The clone's `git status --porcelain` is empty, and the worktree is untouched.

| Name | File | Test | Red on |
|---|---|---|---|
| B2a drop pre-probe check | webDispatch.ts | startGuard | C1 only, `[asked delta, fingerprint same]` = `[2,true]` ≠ `[0,true]` (startGuard:42). The refusal is still 409 from the transaction, as the brief predicted |
| B2b move check after probe | webDispatch.ts | startGuard | C1 only, same assertion, `[2,true]` |
| B2c drop in-transaction check | webDispatch.ts | startGuard | C4 only, received `scheduled` (startGuard:116) |
| B2d no-start | executionPending.ts | startGuard | C2 `no-start` wake only |
| B2d resume | executionPending.ts | startGuard | C2 `resume` wake only |
| B2e running | executionPending.ts | startGuard | C2 running task only |
| B2e active | executionPending.ts | startGuard | C2 active task only |
| B2e starting | executionPending.ts | startGuard | C2 starting task only |
| B2e start-unknown | executionPending.ts | startGuard | C2 start-unknown task only |
| B2e held | executionPending.ts | startGuard | C2 held task, and the real-state held criterion (startGuard:88) |
| B2e continuing | executionPending.ts | startGuard | C2 continuing task only |
| B2f drop work-run disjunct | executionPending.ts | startGuard | "C2: refuses on an active work run alone" only; received `estimate-in-flight` (startGuard:69) |
| B2g count every active run | executionPending.ts | startGuard | C3 estimate only, received `group-execution-pending` (startGuard:95). The C3 clarifying criterion stays green: the pending half alone does not reach it |
| B2h (two files, manual run recorded like mut.sh) | executionPending.ts + webDispatch.ts | startGuard | C3 clarifying, `group-execution-pending` instead of `requirement-not-split` (startGuard:104), plus C3 estimate from the pending half |
| B2h dispatch half alone | webDispatch.ts | startGuard | **green** (15/15), as the brief predicted. It needs two edits because the store entry reads no task work items for a clarifying group, and a single call is not a work run |
| B2i count inactive runs | executionPending.ts | startGuard | C6 only, received `group-execution-pending` (startGuard:127) |
| B2j drop both checks | webDispatch.ts | startGuardSocket | the socket test at :29. It throws a TypeError on `.error.code` because the answer is 202 (Minor 2) |
| B2k restore old SKILL sentence | SKILL.md | skill.test | the new skill test, `toContain("`group-execution-pending`")` (skill.test:106) |
| B2x (reviewer) fixture: always arm, never deliver a waiting wake | fixtures/driverHarness.ts | handoffFailedRetry | 10/19, each with `claim: the driver would arm no start wake` (driverHarness:85). These are exactly the 10 criteria the ruling was for |
| B2y (reviewer) reopen() claim without the pending branch | handoffFailedRetry.test.ts | handoffFailedRetry | "resumes a pre-provider stopped retry without a second reservation" only; the start is refused with `group-execution-pending` (:47) |
| B2z (reviewer) the pre-probe clarifying exclusion in `startRefusedAsPending`, removed together with B2g's predicate edit | webDispatch.ts + executionPending.ts | startGuard | C3 clarifying, `group-execution-pending` (startGuard:104), plus C3 estimate from the predicate half. B2g alone left clarifying green, so this red is the exclusion's |

Result: 20/20 required or extra mutations red. The B2h dispatch half alone is a recorded expected green, not a
mutation of a criterion.

On the shapes of the reds:
- B2x and B2y are red through the fixture's own named throw, not through an `expect`. That is the only failure mode
  these code paths have, and it is not a load error or a crash.
- B2j's TypeError is at the asserted expression (Minor 2).

## ⚠️ Cannot verify from diff

- Whether the census after the rulings shows no unexplained red. The implementer reports 251/252 before the
  shutdownHealing option (a), then 4/4 for that file alone. I ran only the targeted files: 7 files, 90/90. The full
  census is Task G's.
- `profiledService.test.ts` › "probes both profiles…" is a timeout candidate that the implementer flagged (3/3 green
  alone). Registering it is for the human or Task G.
- MCP parity: no MCP-specific criterion exists. Parity is argued from the shared route, and the brief pins only the
  socket and the CLI.
- The diagnostic clone `/private/tmp/oec/mut/b2-diag` from the implementer still exists. Deleting it is the human's call.
