# Tester follow-up G, Part 2 (budget): the group cap is the only hard line — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In groups confirmed after this release, a task's token amount is an expectation (≥1M), the group token limit is the one hard line (claude/omp stopped mid-call, codex between turns), a task far over its expectation pauses for a person's or an orchestrating agent's decision, and a person can still make one task's amount a hard cap.

**Architecture:** ccloop gains an opt-in, Orca-updatable **live token ceiling** per run (a file in the run's control directory, written through a new control method, re-read while the phase streams). Orca keeps one ceiling per running task run, **reserved in the group ledger before it is delivered** (apportioned slices, rebalanced from free headroom by the driver), so the sum of ceilings never exceeds the group's remainder. A ceiling stop ends the run `exhausted` with a recoverable checkpoint; Orca classifies it by the cause it wrote (`group` / `pause-line` / `task-cap`) and continues, pauses or blocks the task. Everything new is behind a per-group marker `budgetModel: "expectation-v1"`; the marker is stamped by default only in the last Orca task (O7), so every earlier task leaves existing criteria untouched.

**Tech Stack:** TypeScript (Node ≥22, `node:sqlite`), zod, vitest; Orca Web (React) under `web/`; ccloop CLI (`dist/cli.js`).

**Spec:** `docs/superpowers/specs/2026-11-12-tester-followup-g-design.md` — Part 2 (§2) and §10.3, §10.5 (§10 wins over §2 where they differ). Background: ccloop `docs/superpowers/specs/2026-11-10-live-token-threshold-design.md`; Orca `docs/superpowers/specs/2026-11-11-budget-defaults-and-reviewed-acceptance-design.md` §7.

## Global Constraints

- Expectation floor: **1,000,000 tokens** (`EXPECTATION_FLOOR_TOKENS = 1_000_000`), applied when an expectation is written.
- Pause line: **`min(10 × expectation, 0.5 × group limit)`** in a finite group; **`10 × expectation`** in an unlimited group. Next line after a "continue": see O5 (formula fixed there).
- A task with no expectation (never estimated, or no amount set) has **no pause line**; only the group cap binds.
- A hard cap exists only when a person turns on the separate hard switch (Web form checkbox / CLI `--hard`); provenance alone (`human`, `model`, `system`, `complex-1m-default`) never makes an amount hard (§10.3). A hard cap has no pause line.
- Migration (§10.5): groups without `budgetModel: "expectation-v1"` keep today's rules byte-for-byte (finite-legacy, optional-v1, unlimited, parking, the 1.2 live threshold). Unlimited groups with the marker get the 10×-expectation pause line and nothing else.
- Overshoot honesty: the UI never claims a strict cap for codex; codex is stopped between turns (a codex phase is one turn: `CodexUsageFold` refuses a second `turn.completed`).
- ccloop Rule 15: **no existing ccloop criterion is rewritten**. The ccloop half is add-only and opt-in (absent `liveCeiling` ⇒ byte-identical envelope parse, collect output and run behaviour). ccloop `features` is **not** changed (it is pinned by `tests/control/protocol4.test.ts:13` with `toEqual`); Orca relies on its pin instead.
- Orca Rule 15 / ccloop Rule 13: the ccloop commits are pushed by the human; Orca tasks run against a local build via `ORCA_CCLOOP_BIN=/Users/biran/code/skills/orca/ccloop/dist/cli.js` (run `npm run build` in ccloop first). The Orca repin (O8) waits for that push.
- Orca Rule 18: per task, `npm test`-equivalent only — `TMPDIR=/tmp ORCA_CCLOOP_BIN=… node scripts/test-affected.mjs --base=<task base>` redirected to a log and read back whole (Rule 14: no `grep`/`tail` on verification runs). No full gate.
- Mutations only in a `git clone --local` copy (copy uncommitted files in first); restore proof = byte counts of `git diff` and `git diff --cached` (both 0).
- Every new activity kind joins `ACTIVITY_KINDS` (`src/control/activity.ts`), `WEB_ACTIVITY_KINDS` (`web/src/controlTypes.ts`) and the wire enum, with en/zh text.
- Prompts/strings sent to agents: English. Docs in English; any `docs/handoff/**` entry in Chinese (memory: language convention).
- No paid real-agent runs. All criteria use fakes / fake ports.

## Review Focus

1. **Parallel runs racing for the last tokens** — three runs of one finite group dispatched together near the cap: the sum of their booked usage must stay ≤ limit + one in-flight request (claude/omp) or one turn (codex) per run. Test: O3 `three parallel runs never hold more ceiling than the group's remainder` (property over random interleavings of claim / book / extend / settle).
2. **Top-up while tasks are stopped or running** — `set-limit` raising the group limit while one task is `group-cap-reached` and another still runs: the stopped task continues with its work, the running one gets a raised ceiling, and `set-limit` is not refused as "unbounded run active". Test: O4 `a top-up continues a group-cap-stopped task and raises a running one's ceiling`.
3. **Crash between reserve and delivery** — Orca reserves a ceiling raise, crashes before the `live-ceiling` call: the run keeps the older ceiling, the reservation is held (never lost or double-counted), and the next driver pass delivers it. Test: O3 `an undelivered raise is redelivered after a restart and the ledger is unchanged`.
4. **Usage the ceiling cannot see** — a phase whose usage is unknown (null `tokenUsage`) or approximate: ccloop's boundary check uses the known lower bound, Orca's existing `usage-unknown` block applies, and no pause/over-expectation row is written from an unknown total. Test: O6 `an unknown usage writes no over-expectation row and no pause`.
5. **A person lowers the group limit below what running tasks hold** — running ceilings are never lowered (lowering would stop a run mid-call for a value a person may revert); `set-limit` keeps today's conservation refusal (`assertKnownConservation`). Test: O4 `a lowered limit leaves running ceilings unchanged and the next claim is refused group-budget-unavailable`.

---

## Resolved design decisions (the spec left these to the builder)

**D1 — Transport for a running run's ceiling (spec "open point").** ccloop *can* update a running run's threshold without restarting the phase: the worker re-reads `<sourceDir>/control/live-ceiling.json` (poll, 50 ms, same pattern as the 20 ms handoff-request watcher in `src/control/worker.ts`) and `runPhaseWithTimeout` evaluates the ceiling through a getter on every `onObservedUsage`. Orca writes the file only through a new control method `live-ceiling` (atomic, mode 0600, revision strictly increasing), never by touching ccloop's run directory itself — the same ownership boundary `handoff` keeps. The initial ceiling rides in the v4 start envelope (`liveCeiling`), so a run is bounded from its first token.

**D2 — Apportioned slices, not a shared counter, and why.** Each ccloop run is a separate OS process; a shared counter would need a cross-process lock on every usage observation (claude emits one per message) or Orca in the loop on every observation (overshoot then grows with polling latency, unbounded in tokens). With slices, every stop decision is local and immediate, and the only shared state — the reservation — lives in Orca's SQLite store, where claims, raises and releases already serialize in one transaction. Rules:
- *Claim:* the slice is what `decideFundedAllowance` already computes for a non-fixed demand (group remainder split among ready candidates, min over spend-cap binders, minimum 1). It is reserved (`reserveCommitment`) and becomes the run's ceiling; the run's own grant tokens are `null` (ccloop sees no token budget, so neither the 1.2 threshold nor allowance parking applies).
- *Raise:* each driver pass, per expectation-v1 finite group with **no claimable ready task** and free headroom `H = limit − used − reserved > 0`, each running ceiling-bearing run gets `floor(H / runningCount)` more, reserved first, then delivered. While a claimable task exists, `H` is left for its claim (no geometric drain that would starve later tasks). Groups with an applicable spend cap get no raises (gap, see D7).
- *Release:* booked work usage of the run releases `min(delta, outstanding)`; settle releases the rest.
- *Invariant:* delivered ≤ reserved, Σ reserved ≤ limit − used ⇒ Σ booked ≤ limit + Σ per-run overshoot, where overshoot is one in-flight request (claude: the message whose `message_start` crossed, plus its output until kill; omp: requests in flight) or one codex turn. **The spec's "one codex turn" reads as per running run**; with N parallel runs the bound is N such units. Stated in the UI copy and in the spec correction (O7).
- *Safety net:* correctness never depends on the raise heuristic. A run stopped with cause `group` while `H ≥ 1,000,000` is auto-continued from its checkpoint (O4); below that the task blocks `group-cap-reached` until a top-up.

**D3 — What a ceiling stop is.** The same terminal ccloop's live threshold produces today: `exhausted`, `failureCause` `budget-exhausted`, the run's attempt captured into a `partial` candidate, so Orca's `commitCandidate` makes the run `recoverable` and `continue-task`'s machinery (`registerContinuation`, `armContinuationWake`) continues it **with its work** (spec "keeps its work through the existing handoff / saved-result paths"). ccloop adds `stopReason: "live token ceiling reached"` and a `liveCeilingStop` record; Orca classifies by the `cause` it wrote, not by re-deriving.

**D4 — Representation of expectation and hard cap.** In expectation-v1 groups every task work allocation keeps `amount.tokens = null` (so every existing ledger reader treats it as group-bounded, which is now true) and carries an optional `tokenIntent: { tokens, hard, provenance, estimateId }`. Confirm freezes it onto the work item. Non-hard intents are floored at 1M when written. Attempts and active time of an estimate are advisory, exactly as in unlimited groups (`advisoryTaskWork`).

**D5 — Where the marker is stamped.** `budgetModel: "expectation-v1"` is written on the group and its budget proposal at creation in `src/control/planImport.ts` (the single `INSERT INTO budget_proposals` site, line 433 at `7ed465dd`). Flow child groups (hidden work-step groups) stay legacy: their run budget pool is a separate design. The spec says "confirmed after"; stamping at creation means an editable proposal created before the upgrade stays legacy — controller's call, reversible, chosen so values a person reviewed under the old rules are never reinterpreted at confirm. Reported for review.

**D6 — Over-expectation, pause and stop states** live on the work item (`overExpectation`, `usagePause`, `usageStopped`, `groupCapStop`), with `work.status = "blocked"` as today for a settled-but-not-done task. No new work status value (the status enum is pinned across views).

**D7 — Gaps recorded, not built.** (a) Spend caps bound the initial slice but runs under a cap get no live raises. (b) Reconcile and goal-review runs keep their finite reserved grants and ccloop's 1.2 threshold (≤20 % of their own grant over). (c) Single calls (estimate, criteria review, requirement review) keep reserved grants; they have no live callback in ccloop. (d) claude's observation is a lower bound; booked usage can exceed it. All four go into the spec correction (O7) and the round's handoff.

---

## File map

**ccloop** (`/Users/biran/code/skills/orca/ccloop`, base `f6920b0`)
- Create `src/budget/liveCeiling.ts` — schema, constants, pure checks.
- Create `src/control/liveCeilingFile.ts` — read/write `control/live-ceiling.json`, watcher.
- Modify `src/control/protocol.ts` — `ControlMethodV1` + `"live-ceiling"`; v4 envelope optional `liveCeiling`; request/response schemas.
- Modify `src/control/command.ts` — dispatch + `validateResponse` for `live-ceiling`.
- Modify `src/control/worker.ts` — seed file, start watcher, pass getter + base tokens to `runLoop`.
- Modify `src/controller/runLoop.ts` — `RunLoopOptions.liveCeiling`; boundary check before each phase; `runPhaseWithTimeout` option `liveCeilingThreshold`; stop reason + `liveCeilingStop`.
- Modify `src/state/types.ts` — `RunState.liveCeilingStop?`.
- Modify `src/control/collect.ts` — strip from v4 terminal core, expose top level.
- Tests: create `tests/control/liveCeilingMethod.test.ts`, `tests/controller/liveCeiling.test.ts`, `tests/control/liveCeilingCollect.test.ts`.
- Docs: create `docs/superpowers/specs/2026-11-12-live-ceiling-design.md`; append a dated section to `docs/superpowers/specs/2026-11-10-live-token-threshold-design.md` (Rule 16: append only).

**Orca** (`/Users/biran/code/skills/orca/Orca`, base = branch point of this plan's branch)
- Create `src/control/expectationModel.ts` — marker, floor, intent writes, pause-line formula.
- Create `src/control/liveCeiling.ts` — ceiling rows, claim ceiling, raise, release, delivery.
- Create `src/control/usagePause.ts` — stop classification, `usage-pause-decide`.
- Modify `src/control/planImport.ts`, `src/control/webProtocol.ts`, `src/control/webService.ts` (proposal-edit ~614, set-task-loop ~2398, setLimit ~2285, confirm), `src/control/budgetSuggestions.ts`, `src/control/webDispatch.ts` (`createStartingRun` ~425–460), `src/control/startEnvelope.ts`, `src/control/executionPort.ts`, `src/control/ccloopPort.ts` (collect v4 schema line 52, new method near line 308), `src/control/usage.ts` (`recordUsage`), `src/control/budget.ts` (`releaseRunReserve`), `src/control/executionDriver.ts` (`pass()` ~1590, terminal routing ~887), `src/control/continuation.ts` (export `registerContinuation` use), `src/control/migrations.ts`, `src/control/activity.ts`, `src/control/errors.ts`, `src/panel/humanOnly.ts`, `src/panel/controlViews.ts` (`deriveExpectations` ~1366, `cardExpectation` ~1403), `src/commands/domains/proposal.ts`, `src/commands/domains/work.ts`, `src/commands/domains/reads.ts` (group show formatter), `web/src/BudgetEditor.tsx`, `web/src/BoardView.tsx`, `web/src/TaskDetail.tsx`, `web/src/GroupDetailRegions.tsx`, `web/src/controlTypes.ts`, `web/src/locales/en.ts`, `web/src/locales/zh.ts`.

---

## ccloop tasks (first; the human pushes them before O8)

### Task K1: the live ceiling contract and its control method

**Files:**
- Create: `src/budget/liveCeiling.ts`, `src/control/liveCeilingFile.ts`
- Modify: `src/control/protocol.ts:10-29` (method union), `:334-343` (v4 envelope), `src/control/command.ts:288-330` (handler), `:339-360` (`validateResponse`)
- Test: `tests/control/liveCeilingMethod.test.ts`

**Interfaces:**
- Produces:
  - `liveCeilingSchema = z.object({ protocol: z.literal(1), revision: positiveSafeInteger, tokens: safe, cause: z.enum(["group","pause-line","task-cap"]) }).strict()`; `type LiveCeiling`; `type LiveCeilingCause`.
  - `LIVE_CEILING_STOP_REASON = "live token ceiling reached"`.
  - `ceilingReachedAtBoundary(runTokens: number, ceiling: LiveCeiling): boolean` — `runTokens >= ceiling.tokens`.
  - `phaseCeilingThreshold(runTokensBeforePhase: number, ceiling: LiveCeiling): number` — `ceiling.tokens - runTokensBeforePhase` (may be ≤0; the boundary check runs first).
  - `liveCeilingPath(sourceDir): string` = `<sourceDir>/control/live-ceiling.json`.
  - `readLiveCeilingOptional(sourceDir): Promise<LiveCeiling | null>`; `writeLiveCeiling(sourceDir, ceiling): Promise<void>` (via `atomicReplacePrivateFile`, mode 0600; throws `ControlProtocolError("control-live-ceiling-stale")` when `revision <=` the stored one, `control-live-ceiling-invalid` on a bad body).
  - v4 envelope: optional `liveCeiling: liveCeilingSchema`, refined: present ⇒ `claim.grant.work.tokens === null` and `mode === undefined`.
  - Control method `live-ceiling`: request `{ method: "live-ceiling", input: <v4 loop envelope with liveCeiling>, ceiling: LiveCeiling }` → response `{ revision: number, tokens: number }` (strict). Input without `liveCeiling` ⇒ `control-live-ceiling-unsupported`.

- [ ] **Step 1: Write the failing tests** in `tests/control/liveCeilingMethod.test.ts` (use `runControlCommand` as `tests/control/protocol4.test.ts` does):
  - `writes the ceiling with mode 0600 and answers its revision` — `expect(answer).toEqual({ revision: 2, tokens: 5000 })`; `statSync(path).mode & 0o777` is `0o600`.
  - `refuses a revision that is not newer` — second write with revision 2 ⇒ stderr code `control-live-ceiling-stale`; file bytes unchanged.
  - `refuses an envelope that carries both a finite work grant and a live ceiling` — parse fails (`control-envelope-invalid` or the existing invalid-envelope code the parser raises).
  - `refuses live-ceiling for a run started without one` — `control-live-ceiling-unsupported`.
  - `an envelope without liveCeiling parses and hashes exactly as before` — `canonicalJson(parse(fixture))` equals the fixture's canonical bytes captured from an existing v4 fixture.
- [ ] **Step 2: Run** `npx vitest run tests/control/liveCeilingMethod.test.ts > /tmp/k1-red.log 2>&1; echo $?` — expect non-zero; read the log whole; the first line `RUN` points at the ccloop checkout.
- [ ] **Step 3: Implement** the interfaces above. `features` is not touched.
- [ ] **Step 4: Run** `npx vitest run tests/control > /tmp/k1-green.log 2>&1; echo $?` and `npx tsc --noEmit -p . > /tmp/k1-tsc.log 2>&1; echo $?` — both 0; read both logs whole; `tests/control/protocol4.test.ts` green unchanged.
- [ ] **Step 5: Mutations** (clone `git clone --local . /tmp/k1-mut`, copy uncommitted files in, criteria file only):
  - M1 drop the revision check ⇒ `refuses a revision that is not newer` red.
  - M2 drop the `grant.work.tokens === null` refine ⇒ the both-set test red.
  - M3 write with the default umask mode ⇒ the 0600 test red.
  Record each red line; restore proof `git diff | wc -c` and `git diff --cached | wc -c` both `0`.
- [ ] **Step 6: Commit** `feat(control): an Orca-updatable live token ceiling for a run, opt-in through the v4 envelope (Orca G part 2)`.

### Task K2: stop at the ceiling — mid-call for claude/omp, between turns for every adapter

**Files:**
- Modify: `src/control/worker.ts:176-300` (seed + watcher + options), `src/controller/runLoop.ts:730-790` (`runPhaseWithTimeout`), `:1705-1770` (option, base tokens), plan/execute/verify launch sites `:2043`, `:2108`, `:2343` and their timed-out branches, `src/state/types.ts:30-40`, `src/control/collect.ts:140-150`, `:195-230`
- Test: `tests/controller/liveCeiling.test.ts`, `tests/control/liveCeilingCollect.test.ts`
- Docs: create `docs/superpowers/specs/2026-11-12-live-ceiling-design.md`; append `## Addendum 2026-11-12: an opt-in ceiling Orca updates (Orca G part 2)` to `docs/superpowers/specs/2026-11-10-live-token-threshold-design.md`

**Interfaces:**
- Consumes: K1's `LiveCeiling`, `readLiveCeilingOptional`, `writeLiveCeiling`, `ceilingReachedAtBoundary`, `phaseCeilingThreshold`, `LIVE_CEILING_STOP_REASON`.
- Produces:
  - `RunLoopOptions.liveCeiling?: { current(): LiveCeiling; baseTokens: number }` — `baseTokens` is the run's work tokens recorded in earlier invocations (last work `threadTotalTokens` in the usage events, 0 for a fresh run), so a crash-resumed worker compares the run's whole total.
  - `runPhaseWithTimeout(..., options?: { …existing…; liveCeilingThreshold?: () => number | null })` — evaluated on every `onObservedUsage`; crossing aborts with `LIVE_TOKEN_STOP_REASON` exactly like the existing threshold and resolves `budgetStop`. The existing `liveTokenThreshold` option is untouched.
  - `RunState.liveCeilingStop?: { revision: number; tokens: number; cause: LiveCeilingCause; observedTokens: number; phase: "plan" | "execute" | "verify"; at: "mid-call" | "boundary" }`.
  - Collect (protocol 4): `terminal` never carries `liveCeilingStop` (stripped beside `savedResult`/`failureCause`/`pathPolicyMisses`); the collection gains top-level `liveCeilingStop` only when present.
  - `createLiveCeilingWatch(sourceDir: string, initial: LiveCeiling): { current(): LiveCeiling; stop(): Promise<void> }` in `liveCeilingFile.ts` (keeps the highest revision seen; a read error keeps the last good value and is recorded as a run event `live_ceiling_read_failed`).
- Behaviour:
  - Worker: if `envelope.liveCeiling` and the file's revision is lower or absent, write the envelope's value; start the watch; stop it in `onRunSettledBeforeLeaseRelease` beside the handoff watcher.
  - Before each phase launch (plan, execute, verify; after setup), if `ceilingReachedAtBoundary(baseTokens + observedTokens, current())` ⇒ write attempt artifacts, `persistTerminalState(..., "exhausted", LIVE_CEILING_STOP_REASON)` with `liveCeilingStop.at = "boundary"`, `phase` = the phase not started, clean up as the budget path does. This is the codex stop ("between turns": a codex phase is one turn).
  - Mid-call: `liveCeilingThreshold = () => phaseCeilingThreshold(baseTokens + observedTokens, current())`; the existing timed-out branches use `LIVE_CEILING_STOP_REASON` and set `liveCeilingStop.at = "mid-call"` when the stop came from the ceiling; booked tokens are `budgetStopTokens(outcome)` as today.
  - Without `options.liveCeiling` every branch is byte-for-byte today's.

- [ ] **Step 1: Write the failing tests** in `tests/controller/liveCeiling.test.ts` (reuse `budgetWorld`/`run`/`ompEventTokens`/`claudeAdapter` from `tests/controller/liveTokenThreshold.test.ts` by copying the helpers; contracts with `tokenBudget: null`):
  1. `omp execute is stopped mid-call at a group ceiling` — ceiling `{revision:1,tokens:1_000,cause:"group"}`, fake-omp 40 × 500. Expect `state.status === "exhausted"`, `state.stopReason === "live token ceiling reached"`, `state.liveCeilingStop` matches `{cause:"group",at:"mid-call",phase:"execute",tokens:1000}`, stream contains `terminated` and not `done`, booked execute total `> 1_000` and `<= 1_000 + 500 + plan tokens`, verify never ran.
  2. `claude execute is stopped mid-call through its runner` — fake-claude `usage-stream` 40 × 2,000, ceiling 3,000; same shape, booked equals the runner's `observed-usage.json`.
  3. `codex is stopped between turns, never mid-phase` — fake-codex `high-usage`, ceiling below the plan's usage: plan `completedWithResult === true`; execute never starts; `liveCeilingStop` `{at:"boundary",phase:"execute"}`.
  4. `a ceiling raised while the phase streams lets it finish` — omp verify streaming 4 × 400 against ceiling 1,000 (revision 1); the test's watch stub returns revision 2 / 10,000 after the second observation. The run `succeeded`; fake records `done`. (This criterion answers the spec's open point.)
  5. `a resumed run counts the tokens of its earlier invocation` — `baseTokens: 900`, ceiling 1,000, omp plan of 2 × 100 ⇒ stopped mid-call after the first observation that crosses (`observedTokens >= 100`).
  6. `no liveCeiling: nothing is written and nothing changes` — the existing `liveTokenThreshold.test.ts` run shape with `tokenBudget: null` succeeds, and `existsSync(liveCeilingPath(sourceDir)) === false` (worker-level, in `tests/control/liveCeilingCollect.test.ts`).
  7. `a ceiling-stopped execute keeps the agent's file in the candidate's result repository` — fake-omp writes `answer.txt` then streams; after the stop, the collected candidate is `partial` and `<sourceDir>/repo` at the attempt commit contains `answer.txt`. **If this is red after implementation, do not change capture code: report it as the open point "ceiling stop loses in-flight execute edits" to the controller.**
  In `tests/control/liveCeilingCollect.test.ts`: 8. `the v4 terminal stays strict and liveCeilingStop is top level` — collect through the control command; `validateResponse` passes; `terminal` has no `liveCeilingStop` key; `collection.liveCeilingStop.cause === "group"`.
- [ ] **Step 2: Run** `npx vitest run tests/controller/liveCeiling.test.ts tests/control/liveCeilingCollect.test.ts > /tmp/k2-red.log 2>&1; echo $?` — non-zero; read whole.
- [ ] **Step 3: Implement** the behaviour above.
- [ ] **Step 4: Run** `npx vitest run > /tmp/k2-full.log 2>&1; echo $?` and `npx tsc --noEmit -p . > /tmp/k2-tsc.log 2>&1; echo $?` — both 0; read whole. Explicitly confirm `tests/controller/liveTokenThreshold.test.ts` (all six criteria) and `tests/control/protocol4.test.ts` are green and unedited (`git diff --stat -- tests/` lists only the new files). **If any existing ccloop test is red, stop: it needs the human to name it (Rule 15). Do not edit it.**
- [ ] **Step 5: Mutations** in a clone:
  - M1 never consult `liveCeilingThreshold` ⇒ criteria 1, 2 red (`to include 'terminated'`).
  - M2 drop the boundary check ⇒ criterion 3 red (execute starts).
  - M3 read the ceiling once at phase start (no getter) ⇒ criterion 4 red.
  - M4 `baseTokens` ignored ⇒ criterion 5 red.
  - M5 leave `liveCeilingStop` in the terminal core ⇒ criterion 8 red (strict schema).
  - M6 seed the file even without `liveCeiling` ⇒ criterion 6 red.
  Record red lines; restore proof 0/0 bytes.
- [ ] **Step 6: Docs** — the new ccloop spec (what, why, interfaces, criteria, mutations table, limits: lower-bound observation, per-run overshoot); the addendum to the 2026-11-10 spec says the opt-in ceiling replaces the 1.2 factor and the allowance exclusion only for envelopes carrying `liveCeiling`, original text untouched.
- [ ] **Step 7: Commit** `feat(control): stop a run at its live ceiling -- mid-call for claude and omp, between turns for codex (Orca G part 2)`; update ccloop `docs/handoff/handoff.md` with the push request (the human pushes; then O8).

---

## Orca tasks (against `ORCA_CCLOOP_BIN=/Users/biran/code/skills/orca/ccloop/dist/cli.js`)

Every task's verification step is:
`TMPDIR=/tmp ORCA_CCLOOP_BIN=/Users/biran/code/skills/orca/ccloop/dist/cli.js node scripts/test-affected.mjs --base=<this task's base commit> > /tmp/oN-affected.log 2>&1; echo $?` — exit 0, read the log whole, copy its "selected N files / skipped" lines into the task report (a 0-file selection is reported as 0, not as green).

Tasks O1–O6 create expectation-v1 groups **only through a test helper** (`importPlan` option `budgetModel`), so no existing criterion changes before O7.

### Task O1: the expectation model — marker, intent, hard switch, estimate apply

**Files:**
- Create: `src/control/expectationModel.ts`
- Modify: `src/control/planImport.ts:433` (accept `budgetModel` option; stamp group + proposal), `src/control/webProtocol.ts:476-500` (`executionAllocationSchema` + proposal allocation: optional `tokenIntent`; proposal-edit operation: optional `hard`; set-task-loop payload: optional `hardTokens`; group/proposal record: optional `budgetModel`), `src/control/budgetSuggestions.ts` (`estimateIsAdvisory`, `suggestedOperations`, `suggestedLoopActions`), `src/control/webService.ts` (`refuseAdvisoryTaskWork` ~498, proposal-edit ~614, set-task-loop ~2398, confirm freeze), `src/control/executionSnapshot.ts` (freeze `tokenIntent` onto work), `src/control/errors.ts`, `src/commands/domains/proposal.ts` (set-budget `--hard`), `src/commands/domains/work.ts:465` (set-loop `--hard`), `src/commands/local/applyEstimate.ts`, `web/src/BudgetEditor.tsx`, locales
- Test: `tests/control/expectationModel.test.ts`, `tests/commands/expectationModelCli.test.ts`, `web/tests/expectationModelEditor.test.tsx`

**Interfaces:**
- Produces (`src/control/expectationModel.ts`):
  - `type BudgetModel = "expectation-v1"`; `EXPECTATION_FLOOR_TOKENS = 1_000_000`.
  - `isExpectationModel(group: { budgetModel?: unknown }): boolean`.
  - `interface TokenIntent { tokens: number; hard: boolean; provenance: "complex-1m-default" | "model" | "human" | "system"; estimateId: string | null }`.
  - `writeTokenIntent(value: number | null, hard: boolean, source: { provenance; estimateId }): TokenIntent | null` — null value ⇒ null; non-hard ⇒ `tokens = max(1_000_000, value)`; hard ⇒ `tokens = value` (must be > 0).
  - `expectationOf(work: { tokenIntent?: TokenIntent }): number | null` — non-hard intent's tokens, else null.
  - `hardCapOf(work): number | null` — hard intent's tokens, else null.
- Behaviour in an expectation-v1 group:
  - proposal-edit / set-task-loop on task-work `tokens`: the allocation's `amount.tokens` stays `null`; the value goes to `tokenIntent` (`hard` from the operation, default `false`); attempts/activeMs `model` values are refused `estimate-advisory-in-unlimited-group` as in unlimited groups (same code, by design: same rule).
  - Estimate apply (panel and CLI `group apply-estimate`) emits a `tokenIntent` operation per task (`provenance: "model"`, `estimateId`) and skips attempts/activeMs.
  - Refusals (add to `durableCommandErrorStatuses`, 422, en/zh text): `hard-cap-legacy-group` (`hard` set in a group without the marker), `hard-cap-needs-tokens` (`hard: true` with `value: null` or on a non-task-work-tokens target).
  - Confirm freezes `tokenIntent` onto the work item record and into the execution snapshot allocation (absent key when no intent — legacy snapshot bytes unchanged).
  - Web: BudgetEditor shows the task token field as "Expected" with a "Hard cap" checkbox (default off) in expectation-v1 groups.
  - CLI: `orca proposal set-budget <group> --task <t> --tokens <n> [--hard]`; `orca task set-loop … --hard`; `--hard` in a legacy group is the server's refusal, printed by name.

- [ ] **Step 1: Failing tests** (`tests/control/expectationModel.test.ts`, groups made via `importPlan(..., { budgetModel: "expectation-v1" })`, finite limit 20M):
  - `an estimate applied in a finite expectation-v1 group writes an expectation, not a ceiling` — after apply: allocation `amount.tokens === null`, `tokenIntent` `{tokens: 1_000_000, hard:false, provenance:"model"}` for an estimate of 300,000; attempts/activeMs unchanged.
  - `a person's amount is an expectation unless the hard switch is on` — proposal-edit `{value: 5_000_000, provenance:"human"}` ⇒ `{tokens:5_000_000, hard:false}`; with `hard:true` and `value: 400_000` ⇒ `{tokens:400_000, hard:true}` (no floor).
  - `hard without tokens is refused by name` — `hard-cap-needs-tokens`.
  - `hard in a legacy group is refused by name` — `hard-cap-legacy-group`; legacy group's proposal unchanged.
  - `confirm freezes the intent onto the task and keeps legacy snapshot bytes` — work record has `tokenIntent`; a legacy group's `executionSnapshot` canonical bytes equal those of the same plan imported without the option.
  - `an unlimited expectation-v1 group stores the expectation it used to derive` — estimate apply writes `tokenIntent` (unlimited legacy groups still derive, unchanged).
  CLI test (`tests/commands/expectationModelCli.test.ts`): `--hard` sends `hard:true`; the refusal prints `hard-cap-legacy-group`. Web test: the checkbox renders only with the marker and posts `hard`.
- [ ] **Step 2: Run** the three files (`npx vitest run <files>` from repo root and `web/`) to a log — red.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify** with the Orca command above (`--base=<O1 base>`), exit 0.
- [ ] **Step 5: Mutations** in a clone: M1 no 1M floor ⇒ first test red; M2 ignore `hard` ⇒ second red; M3 apply attempts from the estimate ⇒ first red; M4 always write `tokenIntent` key (even absent) ⇒ legacy-bytes test red. Restore proof 0/0.
- [ ] **Step 6: Commit** `feat(budget): a task's tokens are an expectation in an expectation-v1 group; a person's hard switch makes a cap`.

### Task O2: the ceiling ledger, claim and envelope

**Files:**
- Create: `src/control/liveCeiling.ts`
- Modify: `src/control/migrations.ts` (table `live_ceilings(run_id TEXT PRIMARY KEY, group_id TEXT NOT NULL, body TEXT NOT NULL)`), `src/control/webDispatch.ts:425-460` (`createStartingRun`: ceiling + `liveCeiling` on the start envelope), `src/control/startEnvelope.ts` / `src/control/executionPort.ts` (`StartEnvelope.liveCeiling?`, `ExecutionPort.setLiveCeiling?`, `ExecutionReport.liveCeilingStop?`), `src/control/ccloopPort.ts:52` (collect v4 schema: top-level optional `liveCeilingStop`), `:308` (`setLiveCeiling` → `raw("live-ceiling", {input, ceiling})`), `src/control/usage.ts:14-60` (`recordUsage` release), `src/control/budget.ts:176-196` (`releaseRunReserve` release), `src/control/webService.ts:2285` (`setLimit`: a run with a ceiling row is bounded for `assertNoActiveUnbounded`)
- Test: `tests/control/liveCeilingLedger.test.ts`, `tests/control/ccloopPortLiveCeiling.test.ts`

**Interfaces:**
- Consumes: O1 `isExpectationModel`, `expectationOf`, `hardCapOf`; K1 wire shapes.
- Produces (`src/control/liveCeiling.ts`):
  - `type LiveCeilingCause = "group" | "pause-line" | "task-cap"`.
  - `interface LiveCeilingRow { revision: number; tokens: number; cause: LiveCeilingCause; reservedTokens: number; deliveredRevision: number }` (body JSON of `live_ceilings`).
  - `runCeiling(input: { groupSliceTokens: number | null; pauseLineTokens: number | null; hardCapTokens: number | null; inheritedTaskTokens: number }): { tokens: number; cause: LiveCeilingCause } | null` — min over the non-null of `groupSliceTokens`, `pauseLineTokens − inherited`, `hardCapTokens − inherited` (each clamped at 0); tie order `task-cap`, `pause-line`, `group`; all null ⇒ null.
  - `openLiveCeiling(store, run: { runId; groupId }, ceiling, reserve: boolean): LiveCeilingRow` — inside the claim transaction; `reserveCommitment(store, groupId, {tokens: ceiling.tokens, activeMs:0, attempts:0, sessions:0})` when `reserve` (finite group); revision 1, deliveredRevision 1 (it rides in the envelope).
  - `releaseOnUsage(store, runId, deltaTokens): number` — returns released `min(delta, reservedTokens)`; caller subtracts from `group.reserved` as `recordUsage` does today.
  - `releaseOnSettle(store, runId): void` — `releaseCommitment` of the remaining `reservedTokens`; row kept with `reservedTokens: 0` (evidence for O4).
  - `readLiveCeiling(store, runId): LiveCeilingRow | null`; `hasLiveCeiling(store, runId): boolean`.
- Claim (expectation-v1 group, task work only): the allowance from `decideFundedAllowance` is unchanged except `grant.work.tokens` becomes `null` and its former value is `groupSliceTokens` (null in an unlimited group); the pause line comes from O5's `pauseLineFor(work, group)` (O2 ships it as `10 × expectation` / `min(10×E, floor(L/2))` with multiple 1 — O5 generalises); `inheritedTaskTokens` = `inheritedWorkUsage(...).tokens`. A null `runCeiling` ⇒ no row and no `liveCeiling` on the envelope (unlimited group, no expectation, no hard cap: today's behaviour). The envelope's `tokenPolicy` is computed as today (with null tokens ccloop neither parks nor applies the 1.2 threshold).
- `ExecutionPort.setLiveCeiling(input: StartEnvelope, ceiling: { protocol: 1; revision: number; tokens: number; cause: LiveCeilingCause }): Promise<{ revision: number; tokens: number }>`.

- [ ] **Step 1: Failing tests** (`tests/control/liveCeilingLedger.test.ts`, fake port):
  - `runCeiling picks the binding bound` — table: `{slice: 4M, pause: 10M, hard: null, inh: 0}` ⇒ `{4M, group}`; `{slice: 4M, pause: 3M, hard: null, inh: 1M}` ⇒ `{2M, pause-line}`; `{null, null, 2M, 500k}` ⇒ `{1.5M, task-cap}`; all null ⇒ null.
  - `a claim in a finite expectation-v1 group reserves its ceiling and sends a null grant` — envelope `claim.grant.work.tokens === null`, `liveCeiling` `{revision:1, cause:"group"}`; `group.reserved.tokens` grew by exactly `liveCeiling.tokens`.
  - `booked usage releases the ceiling's reservation and settle releases the rest` — book 300k of a 2M ceiling ⇒ reserved −300k; settle ⇒ reserved back to the pre-claim value; `used` +300k.
  - `a legacy finite group's claim is byte-identical` — envelope canonical bytes equal those of the same fixture without the marker code path (golden captured in the test from a legacy import).
  - `set-limit is not refused while ceiling-bounded runs are active` — finite limit raise succeeds with one running ceiling run; a legacy group with a null-grant run is still refused as today.
  `tests/control/ccloopPortLiveCeiling.test.ts` (real `ORCA_CCLOOP_BIN` build): `setLiveCeiling writes revision 2 and a stale revision is refused control-live-ceiling-stale`; `collect parses a top-level liveCeilingStop`.
- [ ] **Step 2: Run** red, log read whole.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify** (`--base=<O2 base>`), exit 0.
- [ ] **Step 5: Mutations:** M1 reserve nothing at claim ⇒ reserve test red; M2 forget `releaseOnUsage` ⇒ release test red; M3 send the slice as `grant.work.tokens` ⇒ null-grant test red; M4 tie order group-first ⇒ table row 2 red; M5 drop the `setLimit` exemption ⇒ set-limit test red. Restore 0/0.
- [ ] **Step 6: Commit** `feat(budget): each running task of an expectation-v1 group holds a reserved live ceiling`.

### Task O3: raise running ceilings from free headroom, deliver after reserving

**Files:**
- Modify: `src/control/liveCeiling.ts` (raise + delivery), `src/control/executionDriver.ts:1590-1600` (call in `pass()` before the run loop)
- Test: `tests/control/liveCeilingRefresh.test.ts`

**Interfaces:**
- Consumes: O2 rows, `ExecutionPort.setLiveCeiling`.
- Produces:
  - `planCeilingRaises(store, groupId): Array<{ runId: string; deltaTokens: number }>` — empty unless: expectation-v1, finite limit, no applicable spend cap (`capStatuses`), no claimable ready task (the same predicate `nextClaimableTask` in `webDispatch.ts` uses), `H = limit.tokens − used.tokens − reserved.tokens > 0`; then each active run with a row whose cause is `group` gets `floor(H / count)`.
  - `applyCeilingRaises(store, groupId, raises): void` — one transaction: `reserveCommitment` Δ, `row.tokens += Δ`, `row.reservedTokens += Δ`, `row.revision += 1`, cause stays `group` (re-run `runCeiling` with the run's pause/hard bounds: if a bound below the new group total binds, cap the raise there and set that cause; never reserve more than the raise actually given).
  - `deliverLiveCeilings(deps: ExecutionDriverDeps): Promise<boolean>` — for each active row with `deliveredRevision < revision`: `await port.setLiveCeiling(envelope, {protocol:1, revision, tokens, cause})`; on success set `deliveredRevision`; on `control-live-ceiling-stale` treat as delivered; any other error leaves it for the next pass (reservation held).
  - Driver order per pass: `applyCeilingRaises` for every group (plan in the same transaction as the read), then `deliverLiveCeilings`, then the existing run visits.

- [ ] **Step 1: Failing tests:**
  - `a lone running task gets the whole free headroom, reserved before delivered` — limit 10M, one run with ceiling 2M, no claimable task ⇒ row tokens 10M − used, `deliveredRevision` advances only after the fake port resolves; when the fake port rejects, `group.reserved` already includes Δ and `deliveredRevision` stays.
  - `headroom is left for a claimable task` — a ready task whose deps are done ⇒ `planCeilingRaises` returns `[]`.
  - `three parallel runs never hold more ceiling than the group's remainder` — seeded random sequences (fixed seeds, 200 runs) of claim / book usage / raise / settle across 3 tasks: after every step `Σ outstanding reservedTokens + used.tokens ≤ limit.tokens` and every delivered ceiling ≤ its row's reserved total.
  - `an undelivered raise is redelivered after a restart and the ledger is unchanged` — reject once, rebuild the driver on the same store, next pass delivers revision 2; `group.reserved` identical before and after the restart.
  - `a pause line caps a raise` — run with pause remainder 3M and group headroom 8M ⇒ row tokens 3M, cause `pause-line`, reserved +only the given Δ.
- [ ] **Step 2: Run** red.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify** (`--base=<O3 base>`), exit 0.
- [ ] **Step 5: Mutations:** M1 deliver before reserving ⇒ first test red; M2 ignore claimable tasks ⇒ second red; M3 raise by `H` per run (not `H / count`) ⇒ property test red; M4 mark delivered on any error ⇒ restart test red. Restore 0/0.
- [ ] **Step 6: Commit** `feat(budget): the driver raises running ceilings from the group's free headroom, reserve first`.

### Task O4: settle a ceiling stop — group cap reached, auto-continue, top-up

**Files:**
- Create: `src/control/usagePause.ts` (classification half)
- Modify: `src/control/executionDriver.ts:885-890` (route a report with `liveCeilingStop` after the normal exhausted settle, in its `onSettled` transaction), `src/control/continuation.ts` (export `registerContinuation` and `armContinuationWake` for system use), `src/control/webService.ts:2285` (`setLimit`: continue `group-cap-reached` tasks), `src/control/activity.ts` (`group-cap-reached`)
- Test: `tests/control/liveCeilingSettle.test.ts`

**Interfaces:**
- Consumes: O2 `readLiveCeiling`, `releaseOnSettle`; ccloop collect `liveCeilingStop`.
- Produces:
  - `AUTO_CONTINUE_MIN_TOKENS = 1_000_000`.
  - `classifyCeilingStop(store, runId, stop: { cause; revision; tokens; observedTokens; phase; at }): "auto-continued" | "group-cap-reached" | "usage-paused" | "task-cap"` — called in the settle transaction after `commitCandidate` made the run `recoverable`:
    - `group`: free headroom `H ≥ 1,000,000` and the group not stopped ⇒ `registerContinuation(store, groupId, {taskId, predecessorRunId, checkpointId}, revision, undefined)` + `armContinuationWake` (principal `system`); activity `group-cap-reached` `{runId, observedTokens, ceilingTokens, autoContinued: true}`. Else `work.groupCapStop = {runId, at, observedTokens}`; activity with `autoContinued: false`.
    - `pause-line`: hand to O5's `enterUsagePause` (O4 writes `work.usagePause` with `{line, multiple, usedTokens, expectationTokens, runId, at}` and activity `usage-paused`; O5 adds decisions).
    - `task-cap`: today's exhausted handling, nothing added (§10.3: no pause line).
    - A stop whose run is not `recoverable` (incomplete snapshot) ⇒ no auto-continue; `groupCapStop` is still written so the Problems entry names it.
  - `setLimit` in an expectation-v1 group, when the new limit raises tokens: in the same transaction, every task with `groupCapStop` whose run is recoverable is registered for continuation (cleared `groupCapStop`), and O3's raise runs on the next pass.
- Activity kinds added here: `group-cap-reached`, `usage-paused` (wire enum, `WEB_ACTIVITY_KINDS`, en/zh text).

- [ ] **Step 1: Failing tests** (fake port reporting `exhausted` + `liveCeilingStop` + a `partial` candidate):
  - `a group stop with headroom continues the task with its work` — `H = 3M` ⇒ new run claimed from the predecessor's checkpoint (`predecessorRunId` set), activity `group-cap-reached` `autoContinued:true`.
  - `a group stop without headroom blocks the task as group-cap-reached` — `H = 200k` ⇒ `work.groupCapStop` set, no new run, activity `autoContinued:false`; other ready tasks of the group are still claimable (group not stopped).
  - `a top-up continues a group-cap-stopped task and raises a running one's ceiling` — `set-limit` +10M ⇒ the stopped task continues; next driver pass raises the running run's row.
  - `a lowered limit leaves running ceilings unchanged and the next claim is refused group-budget-unavailable`.
  - `a task-cap stop ends exhausted as today` — no `usagePause`, no `groupCapStop`, no new activity kind.
  - `a pause-line stop waits for a decision` — `work.usagePause.multiple === 1`, `ratio` in the activity body equals `usedTokens / expectationTokens` to one decimal.
- [ ] **Step 2: Run** red.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify** (`--base=<O4 base>`), exit 0. `tests/control/activity.test.ts:165` and `tests/panel/webParity.test.ts:157` compare sets and stay green once all three lists carry the new kinds; **`web/tests/i18nPseudo.test.tsx:382` (`expect(ENUM_VALUES.length).toBe(210)`) turns red — it needs the human to name it** (see "Existing criteria"). Stop and report before rewriting it.
- [ ] **Step 5: Mutations:** M1 auto-continue at any `H > 0` ⇒ no-headroom test red; M2 skip the `setLimit` continuation ⇒ top-up test red; M3 treat `task-cap` as `group` ⇒ task-cap test red. Restore 0/0.
- [ ] **Step 6: Commit** `feat(budget): a run stopped at the group cap continues with its work when the group has room, else waits for a top-up`.

### Task O5: the pause line and its decision (continue / stop)

**Files:**
- Modify: `src/control/expectationModel.ts` (`pauseLineFor`), `src/control/usagePause.ts` (decision), `src/control/webProtocol.ts` (verb `usage-pause-decide`), `src/control/webService.ts` (route), `src/panel/humanOnly.ts` (`"usage-pause-decide": "any"`, socket tier as `continue-task`), `src/panel/controlApi.ts` (route), `src/commands/domains/work.ts` (CLI), `src/control/activity.ts` (`usage-pause-decided`), `src/control/errors.ts`
- Test: `tests/control/usagePauseDecision.test.ts`, `tests/commands/usagePauseCli.test.ts`

**Interfaces:**
- Produces:
  - `pauseLineFor(input: { expectationTokens: number; multiple: number; groupLimitTokens: number | null; taskUsedAtDecision: number; groupUsedAtDecision: number }): number` — **the formula the spec left to the builder:**
    - `multiple = 1`: `L === null ? 10·E : min(10·E, floor(L / 2))`.
    - `multiple = k > 1` (set by the (k−1)-th "continue", decided when the task had used `u` and the group `G`): `L === null ? 10k·E : min(10k·E, u + floor(max(0, L − G) / 2))`.
    - In words: each continue moves the line to the next multiple of 10× the expectation, but never lets the task take more than half of what the group had left when the person decided.
  - Verb `usage-pause-decide`, target `{kind:"task", groupId, taskId}`, payload `{ decision: "continue" | "stop", note?: OperatorNote }` (the existing `operatorNoteSchema` from `src/control/schema.ts`, exactly as `continue-task` takes it — no new bound).
    - `continue`: requires `work.usagePause`; computes the next line (`multiple + 1`); refused `usage-pause-no-headroom` when it is ≤ `u`; registers a continuation from the paused run's checkpoint with the note (`registerContinuation` + `armContinuationWake`), stores `work.pauseMultiple = multiple + 1`, clears `usagePause`; activity `usage-pause-decided` `{decision, nextLine, principal}`.
    - `stop`: clears `usagePause`, sets `work.usageStopped = {at, principal, note?}`; the task stays `blocked`; other tasks are unaffected; activity `usage-pause-decided` `{decision:"stop"}`.
    - Refusals: `usage-pause-not-waiting` (no `usagePause`), `group-stopped` (group stopped / stop intent, as `continue-task`), archived group as today.
  - CLI: `orca task decide-usage <group> <task> continue|stop [--note <text>]` (access `any`, like `task continue`).
  - O2's claim now calls `pauseLineFor` with the stored `pauseMultiple` (default 1).

- [ ] **Step 1: Failing tests:**
  - `pauseLineFor` table: `E=1M, L=20M, k=1` ⇒ 10M; `E=1M, L=8M, k=1` ⇒ 4M; `E=1M, L=null, k=3` ⇒ 30M; `E=1M, L=20M, k=2, u=10M, G=14M` ⇒ `min(20M, 10M + 3M)` = 13M.
  - `continue moves the line and continues the task with its work and note` — new run's envelope carries the note; its `liveCeiling.cause === "pause-line"` with tokens `13M − 10M` in the table's case.
  - `continue with no room left is refused by name` — `u = 10M, G = L` ⇒ `usage-pause-no-headroom`, nothing written.
  - `stop ends the task and the group goes on` — `usageStopped` set; a sibling ready task is claimed on the next wake; the group is not `stopped`.
  - `an orchestrating agent may decide` — principal `agent:<client>` accepted (humanOnly `any`).
  - `a task with no expectation never pauses` — no intent ⇒ claim sends a group-only ceiling.
  CLI: `decide-usage … continue --note x` sends `{decision:"continue", note:{…}}`; refusal printed by code.
- [ ] **Step 2: Run** red.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify** (`--base=<O5 base>`), exit 0; humanOnly table tests compare sets — extend the table, don't rewrite tests; any count pin that goes red is listed for naming.
- [ ] **Step 5: Mutations:** M1 `k·10·E` without the half-remainder cap ⇒ table row 4 red; M2 continue without the note ⇒ continue test red; M3 stop sets `group.stopped` ⇒ stop test red. Restore 0/0.
- [ ] **Step 6: Commit** `feat(budget): a task over its pause line waits for a person or an orchestrating agent to continue or stop it`.

### Task O6: over-expectation hint and the views

**Files:**
- Modify: `src/control/usage.ts` (`recordUsage`: over-expectation once per task), `src/control/activity.ts` (`usage-over-expectation`), `src/panel/controlViews.ts:1366-1416` (`deriveExpectations`/`cardExpectation`: in expectation-v1 groups read `tokenIntent`, finite or not; work-item view fields `usagePause`, `usageStopped`, `groupCapStop`, `overExpectation`), `src/control/webProtocol.ts` (view schema), `src/commands/domains/reads.ts` (group show / task show lines), `web/src/BoardView.tsx` (amber hint; "waiting for a decision" badge), `web/src/TaskDetail.tsx` (expected / used ×ratio; continue/stop buttons calling `usage-pause-decide`), `web/src/GroupDetailRegions.tsx` (Problems: "waiting for a decision: used N, ×R of the expectation"; "group cap reached — top up to continue"), `web/src/controlTypes.ts`, locales
- Test: `tests/control/overExpectation.test.ts`, `tests/commands/groupShowExpectation.test.ts`, `web/tests/expectationModelViews.test.tsx`

**Interfaces:**
- Produces: work view `expected: { tokens; estimateId; stale; usedTokens }` (existing shape) now also for finite expectation-v1 groups; new optional view keys `usagePause: { line; multiple; usedTokens; expectationTokens; ratio }`, `usageStopped: { at; principal }`, `groupCapStop: { at; observedTokens }`, `overExpectation: { at; usedTokens; expectationTokens }`.
- `recordUsage`: after a work delta is booked for a run of an expectation-v1 group whose task has a non-hard intent and no `overExpectation` yet, if the task's lineage work tokens (known, not approximate) exceed the expectation ⇒ set `work.overExpectation` and `recordActivity` `usage-over-expectation` `{usedTokens, expectationTokens, ratio}` in the same transaction (follow the writer of the existing `usage-settled` activity for the projection-transaction pattern). Unknown/approximate usage writes nothing.
- CLI `group show`: per task `expected 1.0M · used 3.2M (×3.2)`; `waiting for a decision: used 10.4M, ×10.4 of the expectation — orca task decide-usage <g> <t> continue|stop`; `group cap reached — orca group set-limit <g> …`; codex tasks add `(codex: stopped between turns)`.

- [ ] **Step 1: Failing tests:** `the first booking over the expectation writes one row and the card turns amber`; `a second booking over it writes no second row`; `an unknown usage writes no over-expectation row and no pause`; `group show names the expectation, the ratio and the decision command`; web: amber hint only with `overExpectation`, Problems entries for `usagePause` and `groupCapStop`, buttons post `usage-pause-decide`; legacy finite group views unchanged (existing `tests/control/estimateExpectation.test.ts:271` and `:337` stay green).
- [ ] **Step 2: Run** red.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify** (`--base=<O6 base>`), exit 0. `web/tests/i18nPseudo.test.tsx:382` needs the human's naming for **+4** activity kinds over this plan (`group-cap-reached`, `usage-paused`, `usage-pause-decided`, `usage-over-expectation`), on top of whatever Parts 1/3/4/5 add — re-measure the value at implementation time; rewrite only after naming, with the ruling quoted in the comment as lines 373–381 do.
- [ ] **Step 5: Mutations:** M1 write the row on every booking ⇒ "second booking" red; M2 count approximate usage ⇒ unknown-usage test red; M3 show the hint for a hard-capped task ⇒ web test red. Restore 0/0.
- [ ] **Step 6: Commit** `feat(web,cli): expected vs used, over-expectation hint, and the pause decision in Board, Problems and group show`.

### Task O7: stamp the new model on new groups (gated on the human naming existing criteria)

**Files:**
- Modify: `src/control/planImport.ts:433` (default `budgetModel: "expectation-v1"` for non-flow groups), Orca spec corrections (append dated sections, original text untouched): `docs/superpowers/specs/2026-11-11-budget-defaults-and-reviewed-acceptance-design.md`, `docs/superpowers/specs/2026-11-12-tester-followup-g-design.md` (a "Part 2 as built" section: D1–D7, the pause formula, the per-run overshoot bound)
- Test: `tests/control/expectationModelDefault.test.ts`

- [ ] **Step 1: Failing test** `a group imported after this release is expectation-v1 and a flow child stays legacy`.
- [ ] **Step 2: Implement** the default.
- [ ] **Step 3: Measure the red set** — run `TMPDIR=/tmp ORCA_CCLOOP_BIN=… node scripts/test-affected.mjs --base=<O7 base> > /tmp/o7-affected.log 2>&1; echo $?` and, because the default reaches every Web import, also `npx vitest run <each file in "Existing criteria" below> > /tmp/o7-candidates.log 2>&1; echo $?`. Read both whole. Write the list of red tests (file:line, failing assertion, which spec line changed it) into the task report.
- [ ] **Step 4: STOP.** Hand the list to the controller for the human's naming. Rewrite only the named tests, whole, not loosened, each with a comment quoting the ruling. Unnamed reds stay red and are reported.
- [ ] **Step 5: Verify** after the named rewrites, exit 0; mutation M1 default legacy ⇒ the new test red; restore 0/0.
- [ ] **Step 6: Commit** `feat(budget): groups imported from now on use the expectation model (spec G §10.5)` and the spec corrections as `docs(spec): …`.

### Task O8: repin ccloop (after the human pushes K1–K2)

- [ ] **Step 1:** `package.json` `"ccloop": "github:blrbiran/ccloop#<pushed sha>"`, `npm install`.
- [ ] **Step 2:** `npm run verify:ccloop-pin > /tmp/o8-pin.log 2>&1; echo $?` and the Orca verification command **without** `ORCA_CCLOOP_BIN`; both 0, read whole.
- [ ] **Step 3: Commit** `chore(deps): pin ccloop to the live ceiling (Orca G part 2)`.

---

## Existing criteria

### ccloop — none expected to change; if any turns red, it needs the human to name it
Designed around: `tests/control/protocol4.test.ts:13` (features `toEqual` — features not touched); `tests/controller/liveTokenThreshold.test.ts` criteria 1–6 (all paths entered only without `liveCeiling`; criterion 6's allowance exclusion untouched); collect terminal strictness (new key stripped from the v4 terminal). K2 Step 4 checks this by `git diff --stat -- tests/`.

### Orca — known now
- `web/tests/i18nPseudo.test.tsx:382` — `ENUM_VALUES.length` 210 → +4 (four new activity kinds); needs naming (O4/O6).

### Orca — expected to go red at O7 only (candidates; O7 Step 3 measures the real list)
Each pins today's finite-group behaviour for a freshly imported group, which O7 turns into expectation-v1:
- `tests/control/estimateExpectationSuggestions.test.ts` — finite-group golden output of the suggestion transform (now emits `tokenIntent`).
- `tests/control/estimateExpectation.test.ts:271`, `:337` — "absent in a finite group" (a new finite group now has expectations); `:216` unaffected (unlimited).
- `tests/control/finiteRetryGolden.test.ts:72` — finite optional-v1 retry/fund/dispatch golden (grant becomes null + `liveCeiling`).
- `tests/control/fundedAllowance.test.ts:31`, `:46`, `:100`, `:153` — finite demand/allowance shapes for imported groups.
- `tests/control/allowanceHeldSettlement.test.ts:53` — a parked token allowance (new groups never park).
- `tests/control/retryTopUp.test.ts:87`, `:298` — finite optional-v1 / finite-legacy retry top-ups.
- `tests/control/overGrantExit.test.ts` (finite cases), `tests/control/estimateGrant.test.ts`, `tests/control/estimateBreachAdvisory.test.ts`, `tests/control/tokenPolicyRuntime.test.ts`, `tests/commands/fundingPreview.test.ts`, `tests/commands/unestimatedDefault.test.ts`, `tests/commands/applyEstimate.test.ts`, `tests/control/estimateE2E.test.ts`, `tests/panel/retryFundingPreview.test.ts` — finite task ceilings, 3M default, funding preview and apply wording.
Line numbers above were measured on `7ed465dd` with `grep -n "it(\"…"`; re-measure before quoting.

---

## Self-review notes

- Spec coverage: 2.1 → K1, K2, O2–O4; 2.2 → O1 (+1M floor), O6 views; 2.3/§10.3 → O1 hard switch, O2 `task-cap`, O4 `task-cap` path; 2.4 → O6; 2.5 → O4/O5; 2.6 effects: starvation (no per-task ceiling in new groups), finished-work-exhausted (no task ceiling), funded≠authored (no authored task tokens), retries-get-remainder (null grant) — all fall out of O1/O2; 2.7/§10.5 → O1 marker, O7 default, unlimited-only-pause-line in O2/O5 (`L === null`). Spend caps → D2/D7 (initial slice only; gap recorded).
- Open point the spec asked to report: ccloop updates a running threshold without restarting the phase (K2 criterion 4). The second open point surfaced here: whether a mid-call execute stop keeps the agent's edits (K2 criterion 7) — reported if red, not patched.
