# A live-ceiling stop keeps its paid work — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A resumable live-ceiling stop leaves a continuable checkpoint whose continuation resumes the interrupted phase on the
saved tree (no re-plan, no extra attempt), and every surface names the exits (raise the limit / continue, or accept-attempt).

**Architecture:** ccloop (producer) keeps the terminal `exhausted` + `liveCeilingStop` stop and additionally attaches the
allowance-continuation evidence and excludes the interrupted phase's file from `missing`. Orca (consumer) validates that
evidence inside the existing `settleCeilingStop`, so the checkpoint becomes continuable and `classifyCeilingStop` routes the
task as today. Orca repins ccloop between the two phases.

**Tech Stack:** TypeScript (Node 22/24), vitest, zod; git worktrees.

**Spec:** `docs/superpowers/specs/2026-11-25-ceiling-stop-keeps-work-design.md` (read it whole; §5 is normative, §6 lists the
criteria, §9 the review resolutions).

## Global Constraints

- Repos: ccloop `/Users/biran/code/skills/orca/ccloop`, Orca `/Users/biran/code/skills/orca/Orca`. Use `/usr/bin/git` only.
- Not resumable ⇒ byte-identical to today: task-cap, no `tokenPolicy`, protocol < 4, unknown observations, `attemptsUsed = 0`,
  multi-directory runs, an open handoff request, recovery runs.
- No new envelope or report fields (spec §5.1 "Protocol"). One new loop event type: `ceiling_interrupted`, detail
  `<phase> in attempt <N>`.
- A partial execute result maps to `nextPhase: "execute"`; only a complete execute result maps to `"verify"`.
- Resuming does not consume an attempt; a stop on the last attempt is resumable (spec goal 2).
- Every new criterion is seen red on the old code; mutations only in `git clone --local` copies outside the worktrees.
  Rewriting existing criteria is human-approved this session: mark each `// Ruling (#478, session 5d3d0c09): <why>`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; subjects name `(#478)`.
- Published specs are append-only: ccloop's protocol spec gets a dated, named Correction, never an in-place edit.

## Review Focus

1. A ceiling stop during a **continuation** (second ceiling) — must again be resumable and resume correctly (Task 2 test).
2. A ceiling stop on the **last attempt** of a 1-attempt task — must park and later resume without `attempts` refusal (Task 2).
3. **Crash between checkpoint commit and `onSettled`**, then a re-settle of the same report — same end state (Task 4).
4. A person's **refused** `accept-attempt` on a resumable ceiling run — must stay continuable and waiting (Task 5).
5. A **plain allowance park** (no ceiling) — must be unchanged on both sides (regression guards in Tasks 1 and 4).

---

## Phase 1 — ccloop (worktree `ccloop/.worktrees/ceiling-continuation-478`, branch `feat/ceiling-continuation-478`)

### Task 1: The ceiling stop carries its continuation evidence

**Files:**
- Modify: `src/controller/runLoop.ts` (the seven ceiling sites listed in spec §2; a shared helper for "resumable" and
  "nextPhase + evidence for this site")
- Modify: `src/control/handoff.ts` (`enteredPhaseFiles` excludes a `ceiling_interrupted` phase; the entered filter applies to
  a resumable ceiling terminal; build `allowanceContinuation` for it)
- Modify: `src/control/worker.ts` (`allowanceUsage` set for a resumable ceiling terminal, as for a park)
- Modify: `src/state/types.ts` only if the event union needs the new type
- Test: `tests/…/ceilingContinuation.test.ts` (new; place it beside the existing live-ceiling runLoop tests)

**Interfaces:**
- Produces: `isResumableCeilingStop(state, options, stop): boolean` and `ceilingContinuationPhase(site, result):
  "plan" | "execute" | "verify"` (names are the plan's; keep them unless the file's conventions say otherwise).
- Produces: event `{ type: "ceiling_interrupted", detail: "<phase> in attempt <N>" }`.

- [ ] **Step 1: Write the failing tests** — one `it` per row of spec §5.1's table, each asserting: final status `exhausted`,
  `stopReason === LIVE_CEILING_STOP_REASON`, `liveCeilingStop` present, the handoff packet's
  `allowanceContinuation.nextPhase` equals the row's value and `plan/execution/verification` non-null exactly as the row
  lists, `candidate.missing` contains no `attempts/` entry, and (mid-call rows) a `ceiling_interrupted` event exists.
  Plus one `it` per non-resumable case (Global Constraints list) asserting the state and packet equal today's (snapshot the
  current output before changing code).
- [ ] **Step 2: Run** `TMPDIR=/tmp npx vitest run <the new file>` — expected: the resumable rows FAIL (no
  `allowanceContinuation`, `missing` has `attempts/1/execution.json`), the non-resumable rows PASS.
- [ ] **Step 3: Implement** per spec §5.1 items 1–4 and the saved-state rules (real `tokenBudgetRemaining`; no
  `waitingCause`).
- [ ] **Step 4: Run** the new file and the existing live-ceiling, allowance-park and handoff test files — all PASS.
- [ ] **Step 5: Commit** `feat(control): a resumable live-ceiling stop carries its allowance continuation (#478)`.

### Task 2: The continuation resumes the interrupted phase, same attempt, with a note

**Files:**
- Modify: `src/control/materialize.ts` (`readAllowanceContinuation`: accept a saved state with `liveCeilingStop`
  (cause `group`|`pause-line`) instead of `waitingCause:"token-allowance"`; `tokenBudgetRemaining` real value;
  `nextPhase:"plan"` with `verification:null` only for attempt 1 with `liveCeilingStop`; `attemptsRemaining` may be 0 with
  `liveCeilingStop`)
- Modify: `src/controller/runLoop.ts` (resumed attempt does not call `consumeAttemptBudget`; interrupted-phase note via the
  existing note channel)
- Test: extend `ceilingContinuation.test.ts`

**Interfaces:**
- Consumes: Task 1's packet shape.
- Produces: note text constant `CEILING_RESUME_NOTE` = "The previous run of this phase stopped at the token ceiling before it
  finished. The worktree already holds its changes: review them and finish the phase; do not start over."

- [ ] **Step 1: Write the failing tests:**
  - `resumes execute, not plan, on the interrupted tree` — fake adapter; first run stops mid-execute after writing `a.txt`;
    continuation from its checkpoint: the adapter's `plan` is never called, `execute` is called once, the worktree contains
    `a.txt`, the execute prompt contains `CEILING_RESUME_NOTE`.
  - `a 1-attempt task stopped on its only attempt resumes` — `maxAttempts: 1`; continuation is not refused and the attempt
    count after the continuation is 1.
  - `a second ceiling inside a continuation is resumable again` — continuation stops mid-verify; its packet has
    `nextPhase:"verify"`; a third run resumes verify.
  - `boundary stop carries no note`.
  - `reader refuses plan without verification unless liveCeilingStop on attempt 1`.
- [ ] **Step 2: Run** — expected FAIL (reader refuses `control-allowance-evidence-invalid`, or plan is called).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file plus all allowance/continuation/materialize tests — PASS.
- [ ] **Step 5: Commit** `feat(control): a ceiling continuation resumes the interrupted phase in the same attempt (#478)`.

### Task 3: Protocol Correction, gate, merge, push

- [ ] Append to ccloop's protocol spec (find it: `grep -l "allowanceContinuation" docs/superpowers/specs/*`) a section
  `## Correction (2026-11-25, Orca session 5d3d0c09, #478)` describing: a terminal `exhausted` + `liveCeilingStop` candidate
  may carry `allowanceContinuation`; the relaxed reader rules; the `ceiling_interrupted` event; attempts not consumed.
- [ ] Mutations in a `git clone --local` copy: (a) drop the `missing` exclusion, (b) map partial execute to verify, (c) charge
  the attempt again, (d) drop the task-cap exclusion — each must turn its own test red.
- [ ] `npm run build` RC 0; `TMPDIR=/tmp npm test > log 2>&1` (affected) and read it fully; red ⇒ rerun that file alone and
  compare with main before classifying.
- [ ] Commit the Correction; controller merges `--ff-only` into main and pushes ccloop (allowed this session).

## Phase 2 — Orca (worktree via the controller; branch `feat/ceiling-continuation-478`)

### Task 4: Repin and intake

**Files:**
- Modify: `package.json`, `package-lock.json` (ccloop pin → the Phase 1 main commit; follow the existing repin commits'
  shape, e.g. `chore(deps): repin ccloop to 276114a …`; run the pin script/E2E the repo uses for repins)
- Modify: `src/control/executionDriver.ts` (`settleCeilingStop`: when the packet carries `allowanceContinuation`, run the
  relaxed `validateAllowanceCheckpoint`; failure ⇒ `blockRun(…, "C", "ceiling-continuation:<why>")`)
- Modify: `src/control/fundedAllowance.ts` (`validateAllowanceCheckpoint` relaxations mirroring Task 2's reader; the attempts
  lineage counting the resumed attempt once)
- Modify: continuation grant code if the attempts dimension needs it (goal 2)
- Modify: run view wording (`src/panel/controlViews.ts` / CLI run show) per spec §5.2
- Test: extend the live-ceiling settle tests (`tests/…/liveCeilingSettle.test.ts` or nearest) and a `handoffWire` E2E

**Interfaces:**
- Consumes: ccloop packet from Tasks 1–2.

- [ ] **Step 1: Write the failing tests:** spec §6 criteria 6, 7, 8, 11 — names: `a resumable ceiling stop is continuable and
  auto-continues at ≥1M headroom`, `below 1M it waits and set-limit continues it`, `pause-line waits and decide-usage
  continue continues it`, `the continuation inherits the predecessor's work tokens and pays no plan`, `a crash between commit
  and onSettled re-settles to the same state`, `a plain allowance park is unchanged`, `a non-resumable ceiling stop is
  unchanged`.
- [ ] **Step 2: Run** — expected FAIL on `recoverable:false` / fresh start.
- [ ] **Step 3: Implement.** **Step 4: Run** the files plus existing usagePause / allowance / settle suites — PASS.
- [ ] **Step 5: Commit** (repin as its own commit first, then `feat(control): a ceiling stop with its continuation settles
  continuable (#478)`).

### Task 5: accept-attempt keeps the continuation; exits on every surface

**Files:**
- Modify: `src/control/acceptAttempt.ts` (refusal restores `settled-recoverable` and the wait — or convert only on landing)
- Modify: `src/control/checkpoints.ts` `completeAcceptedAttempt` (clear `groupCapStop`, `usagePause`,
  `allowancePredecessorRunId`)
- Modify: `src/panel/controlViews.ts`, `src/control/verbs.ts`, recovery list, Web card — the §5.4 `next:` lines; align with
  batch A's #478 short-term wording already on main
- Test: acceptAttempt tests; view tests; web jsdom test for the card

- [ ] **Step 1: Failing tests:** `a refused accept on a resumable ceiling run stays continuable and waiting`; `a landed
  accept clears the wait and no continuation starts`; `group show, brief, recovery list and the card name set-limit (or
  decide-usage) and accept-attempt for a waiting ceiling-stopped task`.
- [ ] **Step 2–4:** red, implement, green (incl. existing acceptAttempt suites).
- [ ] **Step 5: Commit** `fix(control): a refused accept-attempt keeps a ceiling stop's continuation; every surface names
  the exits (#478)`.

### Task 6: Gate, merge, push, paid acceptance

- [ ] Mutations (clone): drop the validator call; keep `missing` check strict; skip clearing the wait on landing — each
  reddens its own test.
- [ ] Controller: stop the panel (`launchctl bootout gui/501/dev.orca.panel`), `TMPDIR=/tmp
  ORCA_CCLOOP_BIN=<new ccloop dist> npm test -- --base main`, restart the panel (`launchctl bootstrap gui/501
  ~/Library/LaunchAgents/dev.orca.panel.plist`, `orca panel restart`), merge `--ff-only`, `npm ci` + build in the main
  checkout, push Orca.
- [ ] Paid acceptance (spec §6, once): scratch project + group with a limit that lets plan finish and stops execute; then
  `orca group set-limit … --as-person`; assert the second run's usage has no plan phase and the task completes. Record
  commands and token counts in the Orca handoff.
