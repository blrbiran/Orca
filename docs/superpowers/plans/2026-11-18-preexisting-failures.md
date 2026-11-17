# Pre-existing failures (#341, #322 residue) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Written 2026-11-18 by the controller of Orca session `4389b15f`, on `main` after batch 2 of that session
(`test(abandon): the drive-outcome mutation note sits where it was seen red …`). **Starts only after #346
(off-plan writes, `docs/superpowers/plans/2026-11-18-off-plan-writes.md`) is on main**: Task 2 adds a line to the loop
plan v4 contract that #346 introduces.

**Goal:** A check that is already red at the group's base is noticed when it first matters — by clarify, by the first agent
that meets it, or by Orca after a task's check fails — never first at the review after the whole group ran.

**Architecture:** Four layers, cheapest first (spec): L1 one conditional rule in the existing clarify instruction; L2 one
constraint line in every v4 loop contract asking the agent to report a pre-existing failure as a major decision with a fixed
marker, which Orca turns into an activity row and a group problem with three answers; L3 after a task run ends
`required-check-failed`, run that one command once at the group's base (cached by repository, base commit, command) and
carry the answer into the next attempt's prior failure; L4 show an earlier group's recorded result at this base on the
confirm screen and in `group brief`. No check runs before a start.

**Tech Stack:** TypeScript, zod, vitest, SQLite control store, React web panel.

**Spec:** `docs/superpowers/specs/2026-11-18-preexisting-failures-design.md`

## Global Constraints

- No check is run before a group or task starts (human ruling quoted in the spec).
- Code never decides that two sentences of a requirement contradict each other (Rule 5).
- L2 marker, verbatim: a major decision whose `question` starts with `Pre-existing failure:` followed by the command.
- L2 constraint line, verbatim: `If a required check already fails before you change anything, report it as a major decision whose question starts with "Pre-existing failure:" followed by the command, and say in "chose" what you did about it.`
- L3 evidence line, verbatim prefix: `This check already failed at the group's base, before any change: ` followed by the failure tail (bounded by the existing prior-failure evidence bound).
- Contracts of loop plan version ≤ 3 keep their bytes; the clarify instruction version rises from 3 to 4 and every fake that matches the head is updated (tests/control/fixtures/requirementHarness.ts `HEADS`, and the four real-ccloop E2E fakes: agentWalk, dirRequirementE2E, dirRequirementOutOfRepo, requirementE2E — the #328 lesson).
- Repo rules: Rule 9 (each new branch: a mutation seen red in a `git clone --local` copy), Rule 14, Rule 18 (quick tier per task; `test:wide` at merge). Durable clones only (not `/private/tmp`).

## Review Focus

1. A decision whose question merely mentions "pre-existing failure" in the middle (not as the prefix) records nothing.
2. The same pre-existing failure reported by three tasks of one group produces one problem row (keyed by command), with each reporting task listed.
3. L3 cache: a second `required-check-failed` on the same command at the same base runs nothing; a different base or command runs once.
4. L3 base run that itself cannot run (setup fails, timeout) records "could not tell", never "red at base".
5. Old drafts and groups confirmed before this change show nothing new and change no bytes.

---

### Task 1: Clarify asks, only when both sentences are present (L1)

**Files:** Modify `src/control/requirementClarify.ts` (instruction text, `CLARIFY_PROMPT_HEAD` → version 4); `tests/control/fixtures/requirementHarness.ts` (`HEADS`) and the four E2E fakes listed above. Test: `tests/control/requirementClarify*.test.ts` (+ a golden if one exists for the instruction).

- [ ] **Step 1: Failing tests:** the instruction contains the new rule under "Which questions are the person's"; the head reads `Orca requirement clarification, instruction version 4.`; a harness clarify round whose fake answers with the question surfaces it on the frontier.
- [ ] **Step 2:** run, see them fail.
- [ ] **Step 3:** add the rule (spec L1 wording: when the requirement both forbids changing existing behaviour, contracts or documents and requires a whole check to pass, ask once how a failure already in the repository is handled — fix it as an allowed change, or judge the check relative to the base); bump the head; update every fake head.
- [ ] **Step 4:** focused runs including the four E2E files with `ORCA_CCLOOP_BIN`; mutation: drop the rule ⇒ red.
- [ ] **Step 5: Commit** `feat(clarify): ask how a failure already in the repository is handled when the requirement says both "only add" and "all green" (#341 L1)`.

### Task 2: The agent reports a pre-existing failure; the group shows it (L2)

**Files:** Modify `src/control/loopPlans.ts` (v4 constraint line, after `OFF_PLAN_TARGETS_CONSTRAINT`); new `src/control/preexistingFailure.ts`; `src/control/driverLanding.ts` (where reported decisions are read at landing) and the terminal path for runs that end without landing; `src/control/activity.ts` + `webProtocol.ts` (`preexisting-failure` kind); `src/panel/controlViews.ts` (group problem rows); `src/control/requirementReview.ts` `reviewFacts`; web Problems region + locales; new command `answer-preexisting-failure` (verb table, permissions, CLI `orca group preexisting-failure <g> --command <cmd> --answer allow-fix|relative|edit-requirement`).
Test: new `tests/control/preexistingFailure.test.ts`, `web/tests/preexistingFailure.test.tsx`.

**Interfaces:**
- `PREEXISTING_FAILURE_CONSTRAINT: string` (exported, verbatim above).
- `preexistingFailuresOf(decisions: unknown[]): Array<{ command: string; chose: string }>` — major decisions only, question prefix exact.
- activity `preexisting-failure { taskId, runId, command, chose }`.
- group view `preexistingFailures?: Array<{ command; reportedBy: Array<{ taskId; runId; chose }>; answer: null | "allow-fix" | "relative" | "edit-requirement" }>` (absent when none).

- [ ] **Step 1: Failing tests:** marker decision ⇒ activity + one problem row; non-marker / minor / mid-string mention ⇒ nothing (Review Focus 1); three tasks ⇒ one row with three reporters (Focus 2); each answer is recorded and appears in `reviewFacts`; `edit-requirement` routes to the existing requirement edit flow (no new editor); v3 contracts unchanged, v4 contracts carry the line.
- [ ] **Steps 2–4:** fail, implement, focused runs; mutations: drop the prefix check; drop the major filter; drop the reviewFacts line; drop the de-dup by command.
- [ ] **Step 5: Commit** `feat(control): an agent's pre-existing-failure report becomes one group problem with three answers (#341 L2)`.

### Task 3: A failed check is run once at the base (L3)

**Files:** new `src/control/baseCheck.ts` (cache in a control-store table `base_check_results(repo_id, base, command, result, tail, at)` via a migration, or canonical records keyed by sha256 of the triple — builder's choice, recorded); driver hook where a run settles `required-check-failed`; `src/control/priorFailures.ts` (`priorFailureOf` adds the evidence line); the L2 problem row gains `source: "base-check"`.
Test: new `tests/control/baseCheck.test.ts`.

**Interfaces:** `baseCheckResult(deps, { repo, base, command }): Promise<"red" | "green" | "unknown">` — runs through `runAcceptance`'s scratch-tip runner (`src/control/groupAcceptance.ts:267`, `runOnScratchTip` + `runCheckSequence`) with the group's setup, cached.

- [ ] **Step 1: Failing tests:** red at base ⇒ next attempt's prior failure carries the evidence line and the problem row appears; green ⇒ nothing added; second failure same triple ⇒ no second run (Focus 3); base run cannot run ⇒ `unknown`, nothing claimed (Focus 4); no retry rule changes.
- [ ] **Steps 2–4:** fail, implement, focused runs; mutations: drop the cache; treat unknown as red; drop the evidence line.
- [ ] **Step 5: Commit** `feat(control): a task's failed check is run once at the group's base, and the next attempt is told (#341 L3)`.

### Task 4: Show what Orca already knows about the base (L4) and the spec Correction

**Files:** `src/panel/controlViews.ts` (confirm view and `group brief`), web confirm step, locales; spec `docs/superpowers/specs/2026-11-18-preexisting-failures-design.md` (append "Correction 1 (plan 2026-11-18)" naming the cache choice, the command name, and anything the builders decided).
Test: new cases in `tests/control/preexistingFailure.test.ts` (or a view test).

- [ ] **Step 1: Failing test:** an earlier group's acceptance on the same repository recorded a red full suite at exactly this group's base ⇒ the confirm view and `group brief` show the line; no command runs (spy on the runner); a different base ⇒ nothing (Focus 5 for old groups: no bytes change when there is nothing to show).
- [ ] **Steps 2–4:** fail, implement, focused runs; mutation: match on repository only (not base) ⇒ red.
- [ ] **Step 5: Commit** `feat(panel): the confirm step names a check an earlier group found red at this base (#341 L4); spec Correction 1`.
