# Tester follow-up G, Part 6 (three smaller items: #192, #269, #189) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dependent task is claimed as soon as its dependency lands (archive/settle/publish continue off the driver round); a regression a landing introduces mid-group shows in Problems naming the landing task; a person or an orchestrating agent can let one request, or every request of the same kind in this group, through, with a revocable list in the group detail.

**Architecture:** #192 adds one readiness predicate (`dependencyReady`) read by the two claim paths, and moves step E of a run with no open request onto a serialized background lane in the driver, so later passes advance the new run while the old one archives. #269 is a new driver pass (`watchLandings`) beside group acceptance: it reuses acceptance's per-check scratch worktree runner, runs every check (not first-red), keeps a per-command green/red state on the group body and reports green→red transitions. #189 keeps a group-body list of allowances, a new `allow-request` / `revoke-allowance` verb pair, applies decision allowances in the landing write, and applies path allowances through the existing observed-path retry, issued by Orca from `systemDebugPass`.

**Tech Stack:** TypeScript (Node ≥22, `node:sqlite`), zod, vitest; Orca Web (React, react-i18next) under `web/`.

**Spec:** `docs/superpowers/specs/2026-11-12-tester-followup-g-design.md` — Part 6 (§6.1–§6.3) and §10.4, §10.5 (§10 wins). Background: tester report `~/code/skills/orca/orca_archived_files/issue-20261023.md` (#189 line 378, #192 line 384, #269 line 3472); group acceptance `src/control/groupAcceptance.ts` (#241) and follow-up F §5 w5 (per-check paths).

Observed at `7ed465dd` (this plan's base; command: `git rev-parse --short HEAD`). Line numbers below were read at that commit (`sed -n`/`grep -n`); re-read before editing — other seats are landing in the same files.

## Global Constraints

- **No schema migration.** Schema stays `"23"` (`src/control/migrations.ts:6`). Everything new is a JSON body field: group body `landingWatch`, group body `allowances`, pending-decision body `allowed`, flagged-decision body `kind`/`scope`. `pending_decisions.state`'s CHECK (`'pending','approved','rejected'`, migrations.ts:130) is not widened: an allowed pending decision is stored `state='approved'` with body `allowed` and no `approvedId`, and read back as domain state `"allowed"`.
- **#192 claim rule (exact):** a dependency counts as satisfied when its work item is `done`, OR its `currentRunId` run is `state === "landed"`, `phase === "work"`, `landedAnywhere(drive)`, `drive.outcome === "succeeded"`, `drive.blockedReason === null`, and `hasObservedUsage(store, run)` with no `usage_events` row above `run.highWater`. Nothing else changes in the claim (funding, slots, brakes stay).
- **#192 "observed usage reserved until settled":** satisfied by construction — booked usage is already in `group.used` (usage.ts:36) and the run's remaining grant stays in `group.reserved` until `releaseRunReserve` (budget.ts:176) at commit. The predicate refuses a dependency whose usage is not fully observed. If Part 2 (plan `…-part-b-budget.md`, D2) changes what a running task holds in `group.reserved`, Task 1's fit test (`limit − used − reserved` at claim) must stay green.
- **#192 D15 kept:** a run left `landed` or `settled`-but-not-cleaned by a death is still in `driverRunIds` (executionDriver.ts:1512) and runs step E again; step E's body is not changed by this plan.
- **#269:** local commands only, no tokens, never blocks a claim, a landing or acceptance. Single-repo groups only (multi-dir and folder groups have no single tree, as acceptance's `not-run`). Skipped once every task is done (group acceptance owns the final tip).
- **#269 problem copy (exact, en):** `after {{tasks}} landed, {{command}} turned red`; zh: `{{tasks}} 落地后，{{command}} 变红了`. Problem code: `landing-regression:<command>`.
- **#189 §10.4:** "allow this kind in this group" grants exactly the path the request named (equality match; the only path requests today are ccloop's exact `pathPolicyMisses`), never a derived parent or pattern. A decision request's kind is the tuple below; matching is exact equality on every field (a `null` matches only `null`):
  - pending decision: `{ type: "pending-decision", kind: entry.kind|null, scope: entry.scope|null }` (strings only, else `null`);
  - flagged decision: `{ type: "flagged-decision", source, kind: body.kind ?? null, scope: body.scope ?? null }`.
- **#189 principals:** a person (Web owner, or socket with any person token) or an orchestrating agent on the socket (`agent:<client>`, tier `open`); a run Orca dispatched is refused (`control-dispatched-run-refused`); a Web member is refused (`control-verb-human-only`). Group-scoped only: nothing reads another group's `allowances`, and nothing copies them (no project default).
- **#189 revocation:** a revoked allowance applies to nothing after `revoked.at`; what it already let through stays as it is.
- **New verbs:** `allow-request`, `revoke-allowance` (group target). **New activity kinds:** `landing-watch` (Task 3), `allowance` (Task 5) — each joins `ActivityKind`/`ACTIVITY_KINDS` (`src/control/activity.ts:11-22`), `WEB_ACTIVITY_KINDS` (`web/src/controlTypes.ts:610-614`), the wire enum (`src/control/webProtocol.ts` near 1829), and `enums.activityKind` in `web/src/locales/en.ts:109` and `zh.ts:2103`. **New refusal codes:** `allowance-request-invalid` (422), `allowance-not-found` (404) in `src/control/errors.ts`, with en/zh entries in `enErrors`/`zhErrors`.
- **Overlapping seats (rebase before each task, re-read the lines):**
  - `src/control/executionDriver.ts` pass `catch` (~1606–1662): #267 (step-C transient retries) and #230 (`blockRun`) edit it. Task 2 extracts that block into a function — **start Task 2 only after #267 and #230 are on `main`**, and move their code verbatim.
  - `src/control/webDispatch.ts` `nextClaimableTask` (390) and `src/control/fundedAllowance.ts` (87): #268 (dispatch write-set intersection) and Part 2 (O2) edit them. Task 1 changes only the `dependsOn` line in each.
  - `src/control/driverLanding.ts` `markLanded`/`landedWithPending` (61–100): #245 (post-merge stopped record) edits `markLanded`. Task 5 adds one call inside `landedWithPending` only.
  - Driver round, after `acceptGroups` (~1680–1685): Part 1's plan adds `reviewRequirements(...)` there; Task 3 adds `watchLandings(...)` right after `acceptGroups`, before it.
  - `web/tests/i18nPseudo.test.tsx:382` (`ENUM_VALUES.length`): every seat adding an enum value bumps it. Recompute after rebase, one commit per bump.
  - #268 (dispatch write-set intersection): Task 6 amends only the blocked task's own contract (the existing observed-path chain), so allowed paths enter a task's write set only after that task asked for them. Report to the controller if #268 reads amended allowlists for intersection (it would then serialize tasks that share an allowed path).
- **Rule 18 / 14:** per task, `TMPDIR=/tmp ORCA_CCLOOP_BIN=/Users/biran/code/skills/orca/ccloop/dist/cli.js node scripts/test-affected.mjs --base=<task base> > /tmp/g-partd-T<n>.log 2>&1; echo "exit=$?"`, then read the whole log (no grep/tail). `<task base>` = `git rev-parse HEAD` recorded in the task's Step 0. Zero selected files or skipped files are reported as such, never as green. No `npm run verify`.
- **Mutations** only in `git clone --local /Users/biran/code/skills/orca/Orca /tmp/g-partd-mut-T<n>` (copy uncommitted files in first); each named mutation is applied, the named test is run and seen red (log kept), then reverted; restore proof = byte counts of `git diff | wc -c` and `git diff --cached | wc -c` both `0`. The main worktree is never mutated.
- **Existing criteria** (listed in "Existing criteria" below) are rewritten only after the human names them; until then a task that needs one stops at that step and reports.
- No paid real-agent runs; every criterion uses the fake ccloop port (`tests/control/fixtures/driverPort.ts`) or direct store writes.
- Code, comments and docs in English; any `docs/handoff/**` entry in Chinese. Commit trailers name the model that wrote the commit.

## Review Focus

1. **A dependency whose settle fails after its dependent started (#192).** Expected: the dependent keeps running and lands; the dependency is blocked at E and shows in Problems; the group is not done. Test: Task 2 `a dependency whose settle fails after its dependent started blocks only itself`.
2. **The panel dies while a background settle runs (#192, D15).** Expected: the next driver finds the run `landed`, runs step E once, the task becomes `done`, the dependent is unaffected. Test: Task 2 `a settle cut by a crash is finished by the next driver`.
3. **The group tip moves while a landing watch runs (#269).** Expected: the running watch finishes and is recorded for the tip it ran on; the next watch runs on the new tip and names only the landings since the previous record. Test: Task 3 `a tip that moved under a watch is watched next, naming the later landing`.
4. **A watch command that hangs (#269).** Expected: it is killed at the longest `perAttemptTimeoutMs`, recorded red with `exit: "timeout N ms"`, nothing waits on it. Test: Task 3 `a check that times out is red and blocks nothing`.
5. **An allowance revoked before Orca acted on a covered request (#189).** Expected: a blocked run whose misses only the revoked allowance covered is not retried; a pending decision inserted after the revoke stays pending. Test: Task 6 `a revoke before the pass leaves the covered run blocked`; Task 5 `a revoked allowance settles no later request`.

---

## Resolved ambiguities (controller-style calls, reversible; for the human's round-end review)

- **A1 (#192) Which landings release a dependent:** only a landed commit (`landedAnywhere`) with outcome `succeeded`, no block reason, fully observed usage. A Part-1 no-change completion (no commit) still waits for `done` — it moves nothing on the branch, and Part 1 owns that path.
- **A2 (#192) "In the background":** one serialized settle lane per driver (step E calls never overlap each other; `publishPending` is already serialized per store, projection.ts:15). `round()` still resolves only after the settles it started finished, so a caller awaiting a round sees today's end state; the next pass may start while a settle runs (`inFlight` covers the pass only). A run with an open handoff request keeps settling inline through `stepH`.
- **A3 (#269) Union scope:** every task of the group (any status), not only done tasks — a check of a task not yet landed is often red before it lands, and is never reported because it was never green.
- **A4 (#269) Baseline:** the first watch of a group records states only; a check red at the first watch is not a regression (no "was green"). `setup` commands count as checks for the green→red rule; when setup fails, the checks are `not-run` and keep their previous state.
- **A5 (#269) Attribution:** "after <task> landed" names the tasks of the landed runs not covered by the previous watch record (`coveredRunIds`); when several landed in between, all are named (`t3, t4`). A regression keeps its first attribution while it stays red; it clears when the check is green again.
- **A6 (#189) "Allow" of a pending (refused) decision:** approve needs an executable `undo.how` only a person can give, so "allow" does not write a ledger line: the row is settled as allowed (who, when, which allowance). `decision approve` (with `--undo-how`) stays the way to put the line in the ledger. "Allow" of a flagged decision is a ratify recorded with the allowance.
- **A7 (#189) Path requests are applied reactively:** "treated as inside every task's write set" is realised by retrying each covered blocked task through the existing observed-path retry (its contract amended with exactly the missed paths, by `allowance:<id>`), not by pre-amending every task's contract. Why: the observed-path chain is hash-linked to the task's own blocked run (`readObservedPathChain`, observedPathAmendment.ts:118-145), and pre-amending every task would put the path in every write set (see the #268 line above). Cost: the covered task's blocked attempt is re-run; no person waits.
- **A8 (#189) Granting applies to requests already pending:** 「本组里同类请示都自动放行」 — a group-scoped grant settles the originating request and every same-kind request of the group still open at grant time, and later ones; revoke stops only the later ones.
- **A9 (#189) "Allow this one" for a path request** = today's `retry-task --allow-observed-paths` (`allow-request` with `scope: "one"` performs exactly that retry).

## File map

- Create `src/control/dependencyReady.ts` — the #192 readiness predicate.
- Modify `src/control/webDispatch.ts:401-405`, `src/control/fundedAllowance.ts:87` — read it.
- Modify `src/control/executionDriver.ts` — settle lane, `recordStepFailure`, `beforeSettle` seam, `watchLandings` call, `ExecutionDriver` doc.
- Modify `src/control/checkCommand.ts` — `runEveryCheck`.
- Modify `src/control/workspace.ts:50-55` — `landingWatchPathOf`, `isLandingWatchPathOf`.
- Modify `src/control/groupAcceptance.ts` — extract `runOnScratchTip`, `acceptanceCommands(…, which)`.
- Create `src/control/landingWatchRecord.ts` (types + pure transition logic, no runner imports), `src/control/landingWatch.ts` (the pass).
- Create `src/control/groupAllowances.ts` (record, match, apply), `src/control/allowanceCommands.ts` (the two verbs).
- Modify `src/control/pendingDecisions.ts`, `src/control/flaggedDecisions.ts`, `src/control/decisionCommands.ts:38-43`, `src/control/driverLanding.ts` (`landedWithPending`, the criteria flag `kind`/`scope`), `src/control/retryTask.ts:230-238`, `src/control/webService.ts` (verb methods, `allowancePass`, `systemDebugPass`), `src/control/webProtocol.ts`, `src/control/errors.ts`, `src/control/activity.ts`.
- Modify `src/panel/controlViews.ts:580-643` (summary fields), `src/panel/controlApi.ts:879,1011` (routes), `src/panel/humanOnly.ts:76,178`, `src/panel/groupDecisions.ts` (pending `allowed`), `src/commands/domains/settings.ts:110-120`, `src/commands/domains/verbs.ts:196-215` (`group show` lines).
- Create `web/src/LandingWatchProblem.tsx`, `web/src/GroupAllowances.tsx`, `web/src/AllowRequestButtons.tsx`; modify `web/src/ControlGroupView.tsx:743,835-845`, `web/src/RunDecisions.tsx:47-80,130-140`, `web/src/ObservedPathRetry.tsx`, `web/src/controlTypes.ts`, `web/src/controlApi.ts:486,581`, `web/src/locales/en.ts`, `web/src/locales/zh.ts`.
- Docs: `skills/orca-control/references/escape-hatch.md` (two route rows), `npm run gen:cli-docs` output.

---

### Task 1: A dependent is claimable once its dependency landed (#192, claim half)

**Files:**
- Create: `src/control/dependencyReady.ts`
- Modify: `src/control/webDispatch.ts:401-405` (the `ready` computation in `nextClaimableTask`)
- Modify: `src/control/fundedAllowance.ts:87` (the `dependsOn` line in `decideFundedAllowance`)
- Test: `tests/control/dependencyReady.test.ts`

**Interfaces:**
- Produces: `export function dependencyReady(store: ControlStore, groupId: string, dependencyWorkItemId: string): boolean` (exact rule in Global Constraints). `runningGroupIds` (orchestration.ts:146) is not changed: a landed run is `active=1` and not `blocked`, so its group already holds a slot.

- [ ] **Step 0: Record the base** — `git rev-parse HEAD > /tmp/g-partd-T1.base`.
- [ ] **Step 1: Write the failing tests** in `tests/control/dependencyReady.test.ts` with `driverHarness([{ taskId: "a" }, { taskId: "b", dependsOn: ["a"] }])`, driving `a` with `t.until(driver, () => t.body(runId).state === "landed")`:
  - `a dependent is claimable once its dependency landed, before it settles` — `expect(nextClaimableTask(t.h.store, "g")).toEqual({ workItemId: "b" })`; `expect(decideFundedAllowance(t.h.store, "g", null, Date.now()).workItemId).toBe("b")`; `a`'s work status is not `done`.
  - `a landed dependency whose usage is not fully observed releases nothing` — patch `a`'s run body `unknown.work = true` ⇒ `nextClaimableTask(...)` is `null`; separately insert a `usage_events` row with `seq = highWater + 1` ⇒ `null`.
  - `a landed dependency with a block reason, or no commit, releases nothing` — `drive.blockedReason = "x"` ⇒ `null`; `drive.landedCommit = null, landedDirs = null` ⇒ `null`.
  - `the dependent's fit counts the landed run's usage and its held reserve` — finite group (`budgetMode` default, `workTokens: () => 40`): before claiming `b`, `limit − used − reserved` read from `readGroup` equals `limit − 40 − a.remaining.work.tokens − a.remaining.handoff.tokens` (a's run still `active=1`, `state "landed"`), and after `deliverScheduledStart` claims `b`, `group.reserved` has grown by exactly `b`'s grant while `a`'s part is unchanged (nothing of `a` was released before its settle).
- [ ] **Step 2: Run** `TMPDIR=/tmp npx vitest run tests/control/dependencyReady.test.ts > /tmp/g-partd-T1-red.log 2>&1` — expect the first test FAIL (`null` / `task-budget-unavailable`), read the log whole.
- [ ] **Step 3: Implement** `dependencyReady` (reads the work row, its `currentRunId` run row, `landedAnywhere` from `driveRecord.ts:245`, `hasObservedUsage` from `budget.ts:166`); replace the `status === "done"` check in `nextClaimableTask` and the `.status!=="done"` check in `decideFundedAllowance` with it. Display readers (`controlViews.ts:377`, `controlOverview.ts:138`) stay as they are.
- [ ] **Step 4: Run** the file again — PASS.
- [ ] **Step 5: Affected run** `TMPDIR=/tmp ORCA_CCLOOP_BIN=/Users/biran/code/skills/orca/ccloop/dist/cli.js node scripts/test-affected.mjs --base=$(cat /tmp/g-partd-T1.base) > /tmp/g-partd-T1.log 2>&1; echo "exit=$?"` — read whole; expect exit 0. Any red among the candidates in "Existing criteria" C1 is reported, not edited.
- [ ] **Step 6: Mutations** (clone): M1 `dependencyReady` answers `status === "done"` only ⇒ test 1 red; M2 drop the `hasObservedUsage`/`usage_events` clause ⇒ test 2 red; M3 drop `blockedReason === null` ⇒ test 3 red. Logs `/tmp/g-partd-M1..M3.log`, restore proof 0/0.
- [ ] **Step 7: Commit** `feat(control): a dependent task is claimed once its dependency landed (#192)`.

---

### Task 2: Step E runs on a background settle lane (#192, settle half)

Precondition: #267 and #230 are on `main` (Global Constraints). Rebase first.

**Files:**
- Modify: `src/control/executionDriver.ts` — `DriverContext` (161-178), `ExecutionDriverDeps` (near `settleSlowMs`, 128), `ExecutionDriver` (185-196), `createExecutionDriver` pass loop and catch (~1598-1662), `round`/`kick`/`stop` (~1712-1760)
- Test: `tests/control/driverSettleLane.test.ts`

**Interfaces:**
- Consumes: Task 1's `dependencyReady` (through `replenishStartWakes`/`nextClaimableTask`).
- Produces:
  - `DriverContext.settles?: Map<string, Promise<boolean>>` (runs whose step E is in flight) and `DriverContext.settleLane?: Promise<unknown>` (the serializing chain).
  - `ExecutionDriverDeps.beforeSettle?: (runId: string) => Promise<void>` — test seam, awaited at the start of a lane settle.
  - `async function recordStepFailure(deps: ExecutionDriverDeps, context: DriverContext, runId: string, error: unknown): Promise<"next" | "progressed" | "draining">` — the pass's current catch body moved verbatim (settled/settled-failed cleanupError, already-blocked `laterError`, landed transient retries up to `TRANSIENT_E_RETRIES`, #267's step-C retries, `blockRun`, the stderr lines byte-identical); `DriverCrash` is rethrown.
- Behaviour: in the pass loop, a run in `context.settles` is skipped. A run with no open request whose state is `landed` or `settled` and whose `singleCallPurposeOf(run) === null` is not awaited: `settles.set(runId, lane)` where `lane = settleLane.then(() => beforeSettle?.(runId)).then(() => stepE(deps, runId))`, errors through `recordStepFailure`, `DriverCrash` sets `crashed` and stops the timer, entry deleted when done, `setImmediate(kick)` when it moved and the driver is not stopped. `round()` = the pass (the only thing `inFlight` holds) then `await` the settles this pass started; answers `progressed || anySettleMoved`. `stop()` awaits every in-flight settle after the round in flight.

- [ ] **Step 0: Record the base** `/tmp/g-partd-T2.base`.
- [ ] **Step 1: Write the failing tests** (`driverHarness([{ taskId: "a" }, { taskId: "b", dependsOn: ["a"] }])`, wakes delivered with `createWebWakeHandlers` + `deliverSchedulerWakes` as in `driverSettle.test.ts:178-186`; `beforeSettle` holds `a` on a deferred that auto-releases after 5 s and records `releasedByTimeout`):
  - `the dependent starts while its dependency's settle is held` — `const first = driver.round()` until `a` enters the seam; then loop `deliverSchedulerWakes` + `await driver.round()` (≤ 60) until `b`'s run state is `accepted`; expect `t.body(aRun).state === "landed"` at that moment and `releasedByTimeout === false`; release; `await first`; `a` is `settled`, `a` and `b` work `done` at the end.
  - `a settling run is visited by no second pass` — the seam counts entries for `a`: exactly 1 while held across ≥ 3 rounds.
  - `stop waits for an in-flight settle` — hold `a`, call `driver.stop()`, release after 50 ms; when `stop()` resolves, `a`'s drive `cleanedUp === true`.
  - `a dependency whose settle fails after its dependent started blocks only itself` (Review Focus 1) — after `b` is `accepted`, the seam throws `new Error("boom")`; `a` ends `blocked` with `blockedAt "E"`, reason `boom`; `b` lands and its work is `done`; `groupDone` has not marked `g` done.
  - `a settle cut by a crash is finished by the next driver` (Review Focus 2) — `deps.crash` throws `DriverCrash` at `"E-after-acceptance"` on the first driver; `driver.crashed === "E-after-acceptance"` after its round; a second `t.driver()` brings `a` to `settled` with `cleanedUp`, and the checkpoints table has exactly one row for `a`'s run.
- [ ] **Step 2: Run** the file — expect tests 1 and 2 FAIL (inline step E: `b` is not started while held / `releasedByTimeout === true`). Read the log whole.
- [ ] **Step 3: Implement** as in Interfaces. Extract `recordStepFailure` first in its own commit-ready state and run `tests/control/driverRoundIsolation.test.ts`, `tests/control/driverSettleRetry.test.ts`, `tests/control/blockedStaysPut.test.ts` (must stay green: byte-identical messages), then add the lane.
- [ ] **Step 4: Run** the file — PASS.
- [ ] **Step 5: Affected run** to `/tmp/g-partd-T2.log`, read whole, exit 0. Candidates C1–C3 that go red: stop and report (file:line, assertion, why) — do not edit.
- [ ] **Step 6: Mutations** (clone): M4 call `stepE` inline (no lane) ⇒ test 1 red; M5 remove the `settles.has(runId)` skip ⇒ test 2 red; M6 drop the settle wait in `stop()` ⇒ test 3 red; M7 swallow lane errors instead of `recordStepFailure` ⇒ test 4 red.
- [ ] **Step 7: Commit** `feat(control): settle a landed run off the driver round so the next task starts (#192)`.

---

### Task 3: The landing watch pass and its record (#269)

**Files:**
- Modify: `src/control/checkCommand.ts` (after `runCheckSequence`)
- Modify: `src/control/workspace.ts:50-55`
- Modify: `src/control/groupAcceptance.ts` (extract runner; `acceptanceCommands` filter)
- Create: `src/control/landingWatchRecord.ts`, `src/control/landingWatch.ts`
- Modify: `src/control/executionDriver.ts` (`DriverContext.landingWatches`, round call after `acceptGroups`, `stop()` abort + await like `acceptanceChecks`)
- Modify: `src/control/activity.ts`, `web/src/controlTypes.ts:610-614`, `src/control/webProtocol.ts` (activity enum), `web/src/locales/en.ts:109`, `web/src/locales/zh.ts:2103` — kind `landing-watch` (en "landing watch", zh "落地后检查")
- Test: `tests/control/landingWatch.test.ts`

**Interfaces:**
- Produces:
  - `export interface EveryCheckOutcome { setupFailure: CheckFailure | null; commands: Array<{ command: string; exit: string; ms: number; tail?: string }> }` and `export async function runEveryCheck(cwd: string, setup: readonly string[], checks: readonly string[], timeoutMs: number, as: DispatchedAs, signal?: AbortSignal): Promise<EveryCheckOutcome>` — setup in order, stop at the first failing setup (checks then not run); otherwise every check runs; `tail` kept for non-zero exits only; setup named `setup: <cmd>`.
  - `landingWatchPathOf(roots, groupId, check: number) = join(workspacesRoot, \`landing-watch-${groupId}.check-${check}\`)`, `isLandingWatchPathOf(name, groupId)` (same shape as `isGroupAcceptancePathOf`).
  - In `groupAcceptance.ts`: `export async function runOnScratchTip<T>(deps: GroupAcceptanceDeps, repo: string, path: string, isOwnLeftover: (name: string) => boolean, tip: string, as: DispatchedAs, body: (path: string) => Promise<T>): Promise<T>` (today's `runAcceptance` worktree add / sweep / `beforeScratchRemoved` / remove, sharing the module's `inUse` set), and `acceptanceCommands(store, groupId, which: "done" | "all" = "done")`.
  - `landingWatchRecord.ts`: `type CheckState = "green" | "red" | "not-run"`; `interface LandingRegression { command: string; landedTaskIds: string[]; tip: string; exit: string; tail?: string; since: number }`; `interface LandingWatch { tip: string; at: number; coveredRunIds: string[]; commands: EveryCheckOutcome["commands"]; states: Record<string, CheckState>; regressions: LandingRegression[] }`; `landingWatchOf(body: unknown): LandingWatch | null`; `nextLandingWatch(previous: LandingWatch | null, run: { tip: string; at: number; coveredRunIds: string[]; landedTaskIds: string[]; outcome: EveryCheckOutcome }): { record: LandingWatch; turnedRed: LandingRegression[]; turnedGreen: string[] }` (pure: A4/A5 rules); `landingRegressionProblems(record): string[]` = `landing-regression:<command>` per regression.
  - `landingWatch.ts`: `export interface LandingWatchCheck { controller: AbortController; tip: string; coveredRunIds: string[]; landedTaskIds: string[]; settled: { outcome: EveryCheckOutcome } | { error: unknown } | null; done: Promise<void> }`; `export async function watchLandings(deps: GroupAcceptanceDeps, checks: Map<string, LandingWatchCheck>): Promise<boolean>`.
- Behaviour of `watchLandings`, per group: skip unless `planHash` set, not archived, no stop intent, not multi/dir/dir-flow, not every task `done`. Landed runs = task runs whose `drive.landedCommit` is a string. Start a watch when some landed run is not in the record's `coveredRunIds` and no watch of the group is in flight: commands = `acceptanceCommands(store, g, "all")`, tip = `revParse(orca/<g>)`, path `landingWatchPathOf(..., ++seq)`, `as = { runId: \`landing-watch-${g}\` }`. An in-flight watch is **not** aborted when the tip moves (A2 / Review Focus 3). When settled: `nextLandingWatch`, then in one `deps.write`: save `body.landingWatch` + `recordProjectionChange`, and one `landing-watch` activity row per transition `{ transition: "turned-red" | "turned-green", command, tip, landedTaskIds, exit?, tail? }` (taskId = first landed task id, or null). `stop()` aborts and awaits `done`, as for acceptance.

- [ ] **Step 0: Record the base** `/tmp/g-partd-T3.base`.
- [ ] **Step 1: Write the failing tests** in `tests/control/landingWatch.test.ts` (`driverHarness` with three tasks `a`, `b`, `c` (c independent so the group is not all-done), `requiredChecks` per task; checks are shell commands over files the fake ccloop writes, e.g. `a`: `test ! -e broken`, `b` writes `broken`):
  - `every check runs even after one fails` — `runEveryCheck(tmp, [], ["false", "true"], 5000, as)` ⇒ two commands, exits `["1", "0"]`.
  - `a failed setup runs no check` — setup `["false"]` ⇒ `setupFailure.command === "setup: false"`, `commands.length === 1`.
  - `a landing that breaks an earlier task's check is a problem naming it` — land `a` (watch records `test ! -e broken` green), land `b`; after rounds, `landingWatchOf(group body).regressions` equals `[{ command: "test ! -e broken", landedTaskIds: ["b"], … }]`; one `landing-watch` activity row `turned-red`; `c`'s run was claimed and not blocked (non-blocking).
  - `a check red from its first watch is no regression` — break the tree before the first landing ⇒ `regressions` empty, `states[cmd] === "red"`.
  - `a regression clears when the check is green again` — a later landing removes `broken` ⇒ `regressions` empty, a `turned-green` row.
  - `a tip that moved under a watch is watched next, naming the later landing` (Review Focus 3) — `beforeScratchRemoved` holds the first watch; land another task meanwhile; release ⇒ first record's `tip` is the old tip; the next record's regression (if any) lists only the later task; two watches total.
  - `a check that times out is red and blocks nothing` (Review Focus 4) — a check `sleep 5` with `perAttemptTimeoutMs: 300` ⇒ `exit === "timeout 300 ms"`, the other task's run reached `accepted` meanwhile.
  - `a group whose tasks are all done is left to acceptance` — all tasks done ⇒ no new watch started (`checks.size === 0`), `group-acceptance` still runs.
  - `an acceptance sweep never removes a running watch worktree` — a held watch's path exists after an acceptance check of the same group started and finished.
- [ ] **Step 2: Run** — FAIL (`runEveryCheck`/`watchLandings` not defined). Read log whole.
- [ ] **Step 3: Implement** per Interfaces; the round calls `watchLandings({ ...same deps as acceptGroups }, context.landingWatches ??= new Map())` right after `acceptGroups`, same `panel-draining` handling.
- [ ] **Step 4: Run** — PASS. Also run `tests/control/groupAcceptance.test.ts`, `tests/control/groupAcceptanceGuards.test.ts`, `tests/control/activity.test.ts`, `tests/panel/webParity.test.ts` — green.
- [ ] **Step 5: Existing criterion R1** (needs the human's naming): `web/tests/i18nPseudo.test.tsx:382` `toBe(210)` → `+1` for `landing-watch` (recompute after rebase), with a dated ruling comment line in the style of 360-381. Own commit.
- [ ] **Step 6: Affected run** to `/tmp/g-partd-T3.log`, read whole, exit 0.
- [ ] **Step 7: Mutations** (clone): M8 `runEveryCheck` returns at the first red ⇒ test 1 red; M9 `nextLandingWatch` reports red with no previous green ⇒ test 4 red; M10 attribution uses every landed task ⇒ test "tip moved" red; M11 abort the watch when the tip moves ⇒ test "tip moved" red; M12 drop the all-done skip ⇒ test "left to acceptance" red; M13 give the watch the `group-acceptance-<g>` prefix ⇒ sweep test red.
- [ ] **Step 8: Commit** `feat(control): run the group's checks on every landed tip and record green-to-red (#269)`.

---

### Task 4: The landing regression in Problems, `group show` and the group view (#269)

**Files:**
- Modify: `src/panel/controlViews.ts:580-643` (summary `landingWatch`)
- Modify: `src/control/webProtocol.ts` (GroupView summary schema, beside `acceptance` ~1591)
- Modify: `src/commands/domains/verbs.ts` (new `landingWatchLines`, next to `acceptanceLines` 198-215, and its call site in the group-show formatter)
- Create: `web/src/LandingWatchProblem.tsx`
- Modify: `web/src/controlTypes.ts` (`LandingWatchV1`, `GroupSummaryV1.landingWatch?`), `web/src/ControlGroupView.tsx:743` (problem hint `+ regressions.length`), `:838` (render after `GroupAcceptanceProblem`), `web/src/locales/en.ts`, `web/src/locales/zh.ts`
- Test: `tests/commands/groupShowLandingWatch.test.ts`, `tests/panel/landingWatchView.test.ts`, `web/tests/landingWatchProblem.test.tsx`

**Interfaces:**
- Consumes: Task 3's `landingWatchOf`, `landingRegressionProblems`, `LandingWatch`.
- Produces: summary field `landingWatch?: { tip; at; commands; regressions: Array<{ command; landedTaskIds; tip; exit; tail?; since; problem: string }> }` (omitted when no record). `export function landingWatchLines(groupId: string, w: LandingWatchView | undefined): string[]` — per regression: `problem: landing-regression:<command> (after <t1, t2> landed; exited <exit> on orca/<g> at <tip12>)`, the tail lines indented two spaces, then `next: add a task that fixes it, or wait for the task that owns it; the watch runs again on the next landing`. No lines without regressions. i18n keys: `control.landingWatch.turnedRed` = the Global Constraints copy; `control.landingWatch.title` en "Regressions on the group branch" / zh "组分支上的回归".

- [ ] **Step 0: Record the base** `/tmp/g-partd-T4.base`.
- [ ] **Step 1: Write the failing tests:**
  - `group show names a landing regression with its command, tasks and tail` — `landingWatchLines("g", view)` equals the exact lines above for one regression with tail `"AssertionError: 3 !== 1"`; `[]` for none.
  - `the group view carries the regression and its problem code` — a store with `body.landingWatch` set ⇒ `readControlGroup(...).summary.landingWatch.regressions[0].problem === "landing-regression:npm test"`, and the summary parses with the protocol schema.
  - `Problems lists each regression and the tab counts it` (web) — render `ControlGroupView` with one regression ⇒ text `after b landed, npm test turned red`, the tail in a `<pre>`, the Problems hint count includes 1; in zh: `b 落地后，npm test 变红了`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS; plus `tests/commands/groupShowAcceptance.test.ts`, `web/tests/i18nPseudo.test.tsx` (no new enum values here), `tests/panel/refusalCoverage.test.ts` green.
- [ ] **Step 5: Affected run** `/tmp/g-partd-T4.log`, read whole, exit 0.
- [ ] **Step 6: Mutations** (clone): M14 omit `landingWatch` from the summary ⇒ view test red; M15 Problems hint ignores regressions ⇒ web count assertion red.
- [ ] **Step 7: Commit** `feat(panel): show a mid-group regression in Problems and group show (#269)`.

---

### Task 5: Allowances — record, verbs and decision requests (#189)

**Files:**
- Create: `src/control/groupAllowances.ts`, `src/control/allowanceCommands.ts`
- Modify: `src/control/pendingDecisions.ts` (row type/state, `allowPendingDecision`)
- Modify: `src/control/flaggedDecisions.ts` (`flagBodySchema` + `FlagInput` optional `kind`, `scope`; `ratifyFlag` optional `allowanceId` recorded in `note`)
- Modify: `src/control/driverLanding.ts:97` (criteria flag passes `kind: "criteria", scope: "task"`), `landedWithPending` (call `applyDecisionAllowances` after the inserts)
- Modify: `src/control/decisionCommands.ts:38-43` (`rowRefusal`/`rejectRefusal`: an allowed row ⇒ `pending-decision-settled`)
- Modify: `src/control/webProtocol.ts` (verbs in `commandVerbSchema` ~666, payload schemas, raw ~1284 and effective ~1387 unions, `CommandSuccess` result kinds, group summary `allowances`, decisions view pending `state` enum at 2532 + `allowed`), `src/control/errors.ts`, `src/control/activity.ts` (+ `allowance` kind in the four lists, en "allowance", zh "放行")
- Modify: `src/control/webService.ts` (`allowRequest(command)`, `revokeAllowance(command)`), `src/panel/controlApi.ts` (routes near 879, dispatch near 1011), `src/panel/humanOnly.ts` (`VERB_ACCESS` "human-only", `SOCKET_TIER` "open"), `src/panel/controlViews.ts` (summary `allowances`), `src/panel/groupDecisions.ts` (pending item `allowed`)
- Test: `tests/control/groupAllowances.test.ts`

**Interfaces:**
- Produces (`groupAllowances.ts`):
  - `type AllowanceRequest = { type: "path"; paths: Array<{ repoKey: string | null; path: string }> } | { type: "pending-decision"; kind: string | null; scope: string | null } | { type: "flagged-decision"; source: string; kind: string | null; scope: string | null }`
  - `interface GroupAllowance { allowanceId: string; request: AllowanceRequest; from: { runId: string } | { pendingId: string } | { decisionId: string }; by: string; via: string; principal: string | null; commandId: string; at: number; revoked?: { by: string; via: string; commandId: string; at: number } }` — kept as group body `allowances: GroupAllowance[]`; ids `allow-<n>`, n = length + 1, never reused.
  - `allowancesOf(body: unknown): GroupAllowance[]`; `activeAllowances(body: unknown, at: number): GroupAllowance[]`.
  - `pendingRequestKey(entry: unknown): Extract<AllowanceRequest, { type: "pending-decision" }>`; `flaggedRequestKey(row: FlaggedDecisionRow): Extract<AllowanceRequest, { type: "flagged-decision" }>`; `sameDecisionKind(a, b): boolean`.
  - `pathsCovered(allowances: GroupAllowance[], misses: readonly PathPolicyMissV1[]): GroupAllowance[] | null` — the allowances covering every miss (exact `repoKey` + `path`), or `null` if any miss is uncovered.
  - `applyDecisionAllowances(store: ControlStore, groupId: string): Array<{ allowanceId: string; pendingId?: string; decisionId?: string }>` — inside the caller's transaction: every `state='pending'` pending row and `state='flagged'` flag row **of this group** matching an active decision allowance is settled (pending ⇒ `allowPendingDecision(store, pendingId, { by: \`allowance:${id}\`, …, allowanceId })`; flag ⇒ `ratifyFlag(…, { actorId: \`allowance:${id}\`, note: \`allowed by ${allowanceId}\` })`), one `allowance` activity row `{ action: "applied", allowanceId, pendingId|decisionId }` each.
- Produces (`pendingDecisions.ts`): `PendingDecisionRow.state` gains `"allowed"` and `allowed: { by: string; via: string; at: number; commandId: string; allowanceId: string | null } | null`; `toRow` maps a stored `approved` row with body `allowed` to `"allowed"`; `export function allowPendingDecision(store, pendingId, allowed): void` writes `state='approved'`, body `allowed` (no `approvedId`).
- Produces (verbs, `allowanceCommands.ts`, both via `applyWebCommand`):
  - `allow-request`, payload `allowRequestPayloadSchema = z.object({ request: z.discriminatedUnion("kind", [ z.object({ kind: z.literal("path"), runId: idSchema }).strict(), z.object({ kind: z.literal("pending-decision"), pendingId: nonemptyString }).strict(), z.object({ kind: z.literal("flagged-decision"), decisionId: nonemptyString }).strict() ]), scope: z.enum(["one", "group"]) }).strict()`. Decisions: the named row must be this group's and open (`pending-decision-not-found` / `flagged-decision-not-found` / `pending-decision-settled` / `no-op-command`); `scope: "group"` appends an allowance (request key from the row), then settles the row and (A8) runs `applyDecisionAllowances`; `scope: "one"` settles that row only. Path: the run must be this group's, `blocked` at C, outcome `blocked_waiting_human`, `stopReason` starting `allowlist miss: ` and non-empty `pathPolicyMisses`, else `allowance-request-invalid` with detail `not-an-allowlist-block`. (The retry itself is Task 6.) Result `{ kind: "request-allowed", allowanceId: string | null, settled: string[] }`; an `allowance` activity row `{ action: "granted", allowanceId, request, from }` for a group grant.
  - `revoke-allowance`, payload `{ allowanceId: idSchema }`: unknown ⇒ `allowance-not-found`; already revoked ⇒ `no-op-command`; else sets `revoked` (attribution from `commandAttributionFor`), activity `{ action: "revoked", allowanceId }`. Result `{ kind: "allowance-revoked", allowanceId }`.
  - Routes: `POST /api/control/groups/:groupId/allowances/allow` (`allow-request`), `POST /api/control/groups/:groupId/allowances/revoke` (`revoke-allowance`).
  - Summary field: `allowances?: GroupAllowanceV1[]` (omitted when empty).

- [ ] **Step 0: Record the base** `/tmp/g-partd-T5.base`.
- [ ] **Step 1: Write the failing tests** in `tests/control/groupAllowances.test.ts` (world: `driverHarness` with `decisions:` reporting entries whose `undo.how` is prose so the landing refuses them to pending, and `requiredChecks` + a check-file change so a `test-change` criteria flag is raised; two groups `g` and `h` on the same repo for isolation):
  - `allow this kind settles the request, the open same-kind ones, and later ones` — pending rows P1, P2 (`kind: "interface", scope: "task"`), P3 (`kind: "interface", scope: "repo"`); `allow-request {pending-decision P1, group}` ⇒ P1, P2 `state === "allowed"`, P3 `pending`; a later landing reporting another `interface`/`task` entry ⇒ its row is `allowed` in the landing write, with `allowed.allowanceId === "allow-1"`.
  - `allow this one settles only that request` — `scope: "one"` ⇒ P1 allowed, P2 pending, `allowances` empty.
  - `a task-scope criteria flag of the same kind is ratified by the allowance` — flag `run-x/orca-criteria` ⇒ `allow-request {flagged-decision, group}` ⇒ ratified; the next task's criteria flag is ratified at its landing; `ratifiedBy === "allowance:allow-1"`.
  - `a revoked allowance settles no later request` (Review Focus 5) — revoke ⇒ the next same-kind pending row stays `pending`; the already allowed rows stay allowed; a second revoke ⇒ `no-op-command`.
  - `another group's request is untouched` — the same kind in group `h` stays pending; `h`'s body has no `allowances`.
  - `an allowed pending decision cannot be approved or rejected again` — approve ⇒ `pending-decision-settled`; reject ⇒ `pending-decision-settled`; the card's `pendingDecisions` count drops by the allowed rows.
  - `who may allow` — `permissionRefusal` for `allow-request`/`revoke-allowance`: socket `cli:claude` ⇒ `null`; dispatched run ⇒ `control-dispatched-run-refused`; Web member ⇒ `control-verb-human-only`; Web owner ⇒ `null`. The recorded `principal` is `agent:cli:claude` for the socket call (via `withCommandContext` + `routedCommandContext`).
  - `the group view lists allowances with who, when and from which request` — summary `allowances[0]` has `by`, `via`, `at`, `from.pendingId`, and `revoked` after a revoke.
- [ ] **Step 2: Run** — FAIL. Read log whole.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run** — PASS; also `tests/control/flaggedDecisions.test.ts`, `tests/control/rejectDecision.test.ts`, `tests/panel/groupDecisionsApi.test.ts`, `tests/control/activity.test.ts`, `tests/panel/webParity.test.ts`, `tests/panel/refusalCoverage.test.ts` (with the two new codes' en/zh entries) — green.
- [ ] **Step 5: Existing criteria R1–R4** (need the human's naming; each its own commit): R1 `web/tests/i18nPseudo.test.tsx:382` +1 (`allowance`); R2 `tests/control/archiveGroup.test.ts:193-243` add `"allow-request"` and `"revoke-allowance"` to `CALLS` (both `target: "group"`); R3 `tests/entry/skill.test.ts:35-75` add both to `schemaByVerb` and the two rows to `skills/orca-control/references/escape-hatch.md`; R4 `tests/panel/accessMatrix.test.ts:30-60` add `{ entry: "allow-request", payload: {}, tier: "open", member: V }` and the same for `revoke-allowance`.
- [ ] **Step 6: Affected run** `/tmp/g-partd-T5.log`, read whole, exit 0.
- [ ] **Step 7: Mutations** (clone): M16 `sameDecisionKind` ignores `scope` ⇒ test 1 (P3) red; M17 `activeAllowances` ignores `revoked` ⇒ revoke test red; M18 `applyDecisionAllowances` reads every group's rows ⇒ isolation test red; M19 drop the `applyDecisionAllowances` call in `landedWithPending` ⇒ "later ones" assertion red; M20 `VERB_ACCESS["allow-request"] = "any"` ⇒ member assertion red.
- [ ] **Step 8: Commit** `feat(control): allow one request or every request of its kind in a group, revocably (#189)`.

---

### Task 6: Path allowances act on blocked runs (#189)

**Files:**
- Modify: `src/control/webProtocol.ts:823` (`retryTaskPayloadSchema` + `allowanceId: idSchema.optional()`, refined: only with `allowObservedPaths: true`)
- Modify: `src/control/retryTask.ts:230-238` (the orca-auto/dispatched refusal) and the two `applyObservedPaths` calls (320, 354: actor)
- Modify: `src/control/allowanceCommands.ts` (path branch performs the retry), `src/control/webService.ts` (`allowancePass()`; first line of `systemDebugPass` at 1087 calls it)
- Test: `tests/control/groupAllowancePaths.test.ts`

**Interfaces:**
- Consumes: Task 5's `pathsCovered`, `activeAllowances`, `applyDecisionAllowances`.
- Produces:
  - `retry-task` with `allowObservedPaths: true` and `allowanceId`: accepted from `orca-auto` iff the group's active allowance list contains `allowanceId`, it is a `path` allowance, and `pathsCovered(activeAllowances(body, now), drive.pathPolicyMisses)` is non-null; otherwise today's `observed-paths-not-allowed` (`dispatched-or-auto`). The amendment's `actor` is `allowance:<allowanceId>`. A dispatched run stays refused (permissions.ts:98-102 unchanged).
  - `allow-request` path branch: after its transaction, calls `this.retryTask` with `{ taskId, runId, allowObservedPaths: true }`, commandId `${commandId}:retry`, the same routed context (the person or agent is the retry's principal). `scope: "group"` first records `{ type: "path", paths: drive.pathPolicyMisses }`. Result adds `retry: <the retry-task success result> | { error: CommandErrorV1 }`.
  - `async allowancePass(): Promise<{ retried: string[]; settled: number }>` — (1) for every group with an active decision allowance: one admitted write running `applyDecisionAllowances` (flags written outside a landing: integration-conflict, model-review). (2) every run with `state === "blocked"`, `blockedAt === "C"`, outcome `blocked_waiting_human`, `stopReason` starting `allowlist miss: `, `work.currentRunId === runId`, no `allowance` activity row `{ action: "applied" }` for it, and `pathsCovered` non-null ⇒ `this.retryTask({ actorId: ORCHESTRATION_ACTOR, commandId: \`allowance-retry-${runId}\`, payload: { taskId, runId, allowObservedPaths: true, allowanceId: covering[0].allowanceId } })`; on success one `allowance` activity row `{ action: "applied", allowanceId, runId }`. One candidate's error never stops the pass (stderr line, as `failoverPass`).

- [ ] **Step 0: Record the base** `/tmp/g-partd-T6.base`.
- [ ] **Step 1: Write the failing tests** (world as `blockedWorld` in `tests/control/observedPathRetry.test.ts:22-30`, two tasks `a`, `b` both missing `docs/notes.md`, plus a third task `c` missing `docs/notes.md` and `docs/other.md`):
  - `allowing a path for the group retries this task now and another task later` — `allow-request {path, runId: aRun, group}` as `OWNER` ⇒ result `retry` is a success, `a`'s contract allowlist contains `docs/notes.md`; drive `b` to blocked; `service.allowancePass()` ⇒ `retried` contains `b`'s run; `b`'s amendment record `actor === "allowance:allow-1"`.
  - `allow this one retries without recording an allowance` — `scope: "one"` ⇒ retried, `allowances` empty, `b` later stays blocked after `allowancePass()`.
  - `a run with one uncovered miss is not retried` — `c` stays `blocked` after the pass.
  - `a revoke before the pass leaves the covered run blocked` (Review Focus 5) — grant from `a`, revoke, drive `b` blocked, pass ⇒ `b` blocked.
  - `orca-auto still needs a covering allowance` — `retry-task` as `orca-auto` with `allowanceId: "allow-9"` ⇒ `observed-paths-not-allowed`; existing `observedPathRetry.test.ts:50-58` stays green unchanged.
  - `another group's blocked run is not retried` — the same miss in group `h` stays blocked.
  - `the pass runs at most one retry per blocked run` — two passes ⇒ one `task-retried` row for `b`'s run.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS; plus `tests/control/observedPathRetry.test.ts`, `tests/control/retryTask.test.ts`, `tests/control/systemDebug*.test.ts` green.
- [ ] **Step 5: Affected run** `/tmp/g-partd-T6.log`, read whole, exit 0.
- [ ] **Step 6: Mutations** (clone): M21 `pathsCovered` accepts when *some* miss is covered ⇒ `c` test red; M22 the orca-auto exception skips the coverage check ⇒ "orca-auto still needs" red; M23 drop the applied-row guard ⇒ "at most one retry" red.
- [ ] **Step 7: Commit** `feat(control): a group path allowance retries every covered allowlist block (#189)`.

---

### Task 7: The allow buttons, the allowance list and the CLI (#189)

**Files:**
- Modify: `src/commands/domains/settings.ts:110-120` — three verbs in the `decision` domain:
  - `orca decision allow <group> <id> [--one]` → `allow-request`, `request` = `{ kind: "pending-decision", pendingId: id }` when `id` starts `pending-`, else `{ kind: "flagged-decision", decisionId: id }`; `scope` = `--one ? "one" : "group"`; route `groups/<g>/allowances/allow`; summary "let a decision request through: every request of its kind in this group (default), or only this one with --one".
  - `orca decision allow-paths <group> --run <runId> [--one]` → `allow-request` `{ kind: "path", runId }`; summary "let a task's allowlist-blocked paths through and retry it: for every task of this group (default), or only this task with --one".
  - `orca decision revoke-allowance <group> <allowanceId>` → `revoke-allowance`.
- Modify: `src/commands/domains/verbs.ts` — `allowanceLines(view)`: `allowed in this group:` then per allowance `  <id>: <request> by <by> via <via> at <ISO> from <run|pending|decision id>[ (revoked by <by> at <ISO>)]`; request text: `paths a, b` / `pending decisions of kind <kind|?> scope <scope|?>` / `<source> flags of kind <kind|?> scope <scope|?>`.
- Create: `web/src/AllowRequestButtons.tsx` — `AllowRequestButtons(props: { groupId: string; revision: number; request: AllowRequestV1; archived: boolean; onCommand: (a: ControlAction) => void }): JSX.Element | null` — two buttons, "Allow this kind in this group" first and styled primary (default), "Allow this one" second (`btn-quiet`); null when archived.
- Create: `web/src/GroupAllowances.tsx` — `GroupAllowances(props: { groupId: string; revision: number; allowances: GroupAllowanceV1[] | undefined; roles?: readonly Role[]; archived: boolean; onCommand })` — heading "Allowed in this group", one row per allowance (request, by, via, time, from), Revoke for an owner on active ones; nothing when empty.
- Modify: `web/src/RunDecisions.tsx` (`PendingRow` open rows and flagged rows render `AllowRequestButtons` before the existing Approve/Reject/Ratify, which stay as they are), `web/src/ObservedPathRetry.tsx` (the existing button stays; `AllowRequestButtons` with `{ kind: "path", runId }` above it), `web/src/ControlGroupView.tsx:845` (`GroupAllowances` at the end of the `problem` region, not counted in the hint), `web/src/controlApi.ts:486,581` (two `ControlAction` variants and their routes), `web/src/controlTypes.ts` (`AllowRequestV1`, `GroupAllowanceV1`, summary `allowances?`, decisions pending `state` + `"allowed"` and `allowed?`), locales en/zh (button labels; zh "本组同类都放行" / "只放行这一条" / "本组已放行" / "撤销").
- Regenerate: `npm run gen:cli-docs` (references `decision.md`, `error-codes.md`), `skills/orca-control/references/observed-path-retry.md` mentions `orca decision allow-paths`.
- Test: `tests/commands/decisionAllow.test.ts`, `web/tests/groupAllowances.test.tsx`

**Interfaces:**
- Consumes: Task 5/6 payloads and summary fields exactly as produced there.

- [ ] **Step 0: Record the base** `/tmp/g-partd-T7.base`.
- [ ] **Step 1: Write the failing tests:**
  - `decision allow sends a group-scoped allow by default and --one narrows it` — the registry's payload for `orca decision allow g pending-r-0` equals `{ request: { kind: "pending-decision", pendingId: "pending-r-0" }, scope: "group" }`; with `--one` `scope: "one"`; `orca decision allow g r1/orca-criteria` ⇒ `flagged-decision`; `allow-paths g --run run-1` ⇒ `{ kind: "path", runId: "run-1" }`; `revoke-allowance g allow-1` ⇒ `{ allowanceId: "allow-1" }`.
  - `group show lists what is allowed in the group` — `allowanceLines` exact text for one active path allowance and one revoked decision allowance.
  - (web) `the default button allows the kind in the group` — clicking the first button on a pending row ⇒ `onCommand` called with `{ verb: "allow-request", groupId: "g", expectedRevision: 6, payload: { request: { kind: "pending-decision", pendingId: "p1" }, scope: "group" } }`; the second ⇒ `scope: "one"`; the existing Approve/Ratify calls are unchanged.
  - (web) `the group lists allowances and an owner revokes one` — a revoked row shows "revoked"; Revoke on the active one ⇒ `{ verb: "revoke-allowance", payload: { allowanceId: "allow-1" } }`; a member sees no Revoke.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**; run `npm run gen:cli-docs`. **Step 4: Run** — PASS; plus `tests/commands/drift.test.ts`, `tests/commands/verbCoverage.test.ts`, `tests/entry/skill.test.ts`, `web/tests/controlDecisions.test.tsx`, `web/tests/checksSettings.test.tsx`, `web/tests/i18nPseudo.test.tsx` green (C4 below if not).
- [ ] **Step 5: Affected run** `/tmp/g-partd-T7.log`, read whole, exit 0.
- [ ] **Step 6: Mutations** (clone): M24 CLI default `scope: "one"` ⇒ CLI test red; M25 swap the button order ⇒ web default-button test red; M26 Revoke shown to a member ⇒ web test red.
- [ ] **Step 7: Commit** `feat(web,cli): allow buttons, the allowance list and decision allow / allow-paths / revoke-allowance (#189)`.

---

## Existing criteria

Rewrites below need the human to name them before the task's step runs (spec §9 "Existing criteria"):

| # | File:line | Why | Change |
|---|---|---|---|
| R1 | `web/tests/i18nPseudo.test.tsx:382` `ENUM_VALUES.length` (210 at `7ed465dd`) | two activity kinds (`landing-watch` Task 3, `allowance` Task 5) | +1 per kind, own commit each, number recomputed after rebase (other seats bump it too) |
| R2 | `tests/control/archiveGroup.test.ts:193-243` `CALLS` (asserted complete at 246-249) | two new group verbs | add `allow-request`, `revoke-allowance` entries; the assertion is unchanged |
| R3 | `tests/entry/skill.test.ts:35-75` `schemaByVerb` (+ escape-hatch route rows read at 27) | two new routes | add both verbs/schemas and their escape-hatch rows |
| R4 | `tests/panel/accessMatrix.test.ts:30-60` `ROWS` (asserted to cover every human-only verb at 170-176) | two new human-only verbs | add one row each, `tier: "open"`, `member: V` |

Candidates — run, expected green; if one is red, stop and report file:line and the failing assertion, do not edit:

| # | File:line | What could move it |
|---|---|---|
| C1 | `tests/control/driverSettle.test.ts:175-198` (CR1 side by side), `:217-233` (I1 brake: `b` must not be claimed in a blocked group — Task 1 keeps the brake) | Task 1/2 timing of `b`'s claim |
| C2 | `tests/control/executionDriverE2E.test.ts:43`, `tests/control/handoffE2E.test.ts:168,246,292`, `tests/control/observedPathRetry.test.ts:120`, `tests/control/webContinuation.test.ts:582`, `tests/control/agentUpgradeE2E.test.ts:80` (dependsOn worlds) | a dependent now claimed while its dependency is `landed` |
| C3 | `tests/control/driverRoundIsolation.test.ts`, `tests/control/driverSettleRetry.test.ts`, `tests/control/blockedStaysPut.test.ts`, `tests/control/groupDone.test.ts`, `tests/control/groupAcceptance*.test.ts`, `tests/control/integrationGit.test.ts` | Task 2's extracted catch (messages must be byte-identical); a group's done/acceptance may come one round later when its last settle ran on the lane |
| C4 | `web/tests/controlDecisions.test.tsx:169,192`, `web/tests/checksSettings.test.tsx:347,362` | Task 7 adds buttons before Ratify/Approve; tests that index buttons by position |

## Self-review notes

- Spec coverage: §6.1 claim (Task 1), background settle + reserve + D15 (Tasks 1–2, Global Constraints); §6.2 union on every landed tip, non-blocking, green→red to Problems naming the task, local only, per-check worktree reuse (Tasks 3–4); §6.3 path and decision kinds, two buttons with group default, person and `agent:<client>`, list with who/when/from, revocable for later only, group-scoped (Tasks 5–7); §10.4 exact path (Global Constraints, Task 6 `c` test); §10.5 Part 6 applies to every group from the upgrade (no marker read anywhere in this plan).
- Types used across tasks: `dependencyReady`, `recordStepFailure`, `runEveryCheck`/`EveryCheckOutcome`, `runOnScratchTip`, `LandingWatch`/`nextLandingWatch`/`landingWatchOf`, `GroupAllowance`/`AllowanceRequest`/`pathsCovered`/`applyDecisionAllowances`/`allowPendingDecision`, verbs `allow-request`/`revoke-allowance`, kinds `landing-watch`/`allowance` — same names in every task.
- Not verified by running (read only): whether any test in C1–C4 actually turns red; the exact line ranges after the other seats land.
