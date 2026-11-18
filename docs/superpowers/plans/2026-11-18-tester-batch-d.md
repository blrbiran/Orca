# Tester batch D (small fixes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the small, verified tester-ledger defects of 2026-11-18 (Section 1 of the triage): things a person cannot see, small CLI frictions, and three loops that waste work or disk.

**Architecture:** No new subsystem. Read-side derivations in `src/panel/controlViews.ts` (stored state is never rewritten to fix a display), CLI rendering in `src/commands/**`, and four narrow driver/control changes. Three independent tracks, one worktree each, merged `--ff-only` in order V → C → D.

**Tech Stack:** TypeScript, Node, vitest, React (web), node:sqlite.

**Spec:** the triage reports and human rulings in `.superpowers/sdd/2026-11-18-tester-pm/` (git-ignored, main repo): `progress.md` (rulings), `g1-split-requirement.md`, `g2-runs-settle-storage.md`, `g3-groups-cli-ui.md`, `review-salvage-accept.md`, `review-repair-attempt.md` (C1). The tester's text is `/Users/biran/code/skills/orca/orca_archived_files/issue-20261023.md` — read one `### Issue <n>:` section at a time, **never edit that file** (it has the tester's uncommitted rewrite). Line numbers below were measured at Orca `f4b035a5`; re-find them before editing.

## Global Constraints

- Rules: `CLAUDE.md` (esp. Rule 9: every new branch names the mutation that deletes it and that mutation is seen red; Rule 14: verification output redirected to a file and read back whole; Rule 17: tests never write the real `~/.orca`; Rule 18: per patch set `npm test`, per merge batch `npm run test:wide` with `ORCA_CCLOOP_BIN=/Users/biran/code/skills/orca/ccloop/dist/cli.js`).
- Human ruling this session: changing existing criteria is approved when necessary — each rewritten assertion gets a comment `// Ruling (2026-11-18 tester batch D): <why>` and is listed in the task report.
- Worktrees live under `/Users/biran/code/skills/orca/.wt-batchd-<track>/` (not `/private/tmp`: wiped every ~30 min). Their `node_modules` is a symlink to the main repo: **never** `npm ci`/`npm install`/`rm` it (`/Users/biran/code/skills/orca/.agent-notice-node-modules.md`).
- vitest in subagents: `--maxWorkers=2`; `TMPDIR=$(mktemp -d /tmp/oXX)` (socket paths must stay under 103 bytes).
- No change to stored group/work/run state shapes, no control-schema migration, no ccloop change in this plan. Protocol additions are optional fields only.
- Words shown to people follow existing i18n (`web/src/i18n/en.ts` and the zh file next to it; CLI strings in place). Facts, no imperative to the agent in prompt text.
- No edit to any agent's profile or config file (human ruling).

## Review Focus

1. A group whose review is not passed AND whose task also failed: the task failure must still win `firstFailure` (group-level problem only fills an empty slot).
2. A group archived while its stored status is `running`: list shows `archived (was running)`, and `orca status` work health still excludes it (#222).
3. An error whose `message` is `code:detail` where detail itself contains `:` — rendering must keep the whole detail.
4. A settled-failed run with no report whose ccloop execution is still alive (accepted, no stop proof): workspace is kept, one log line only, never deleted.
5. A run whose final attempt failed a required check but whose stored verification cannot be read (artifact missing): prior failure falls back to today's `run-failed:<cause>` line, never throws.

---

## Track V — read views (`src/panel/controlViews.ts` and its readers). Worktree `.wt-batchd-v`.

### Task V1: a not-passed requirement review is visible everywhere a person looks (#359, #377 layer 4)

**Files:** `src/panel/controlViews.ts` (`cardFacts` ~625-659, `requirementReview.problem` ~831), `src/commands/domains/reads.ts` (brief `format`), `src/commands/status.ts` (~70-95), `src/control/webProtocol.ts` (summary schema), web card if it renders `firstFailure`.
**Interfaces:** Produces `summary.groupProblem: { code: string; why: string; next: string[] } | null` (new optional field; do **not** make `firstFailure.taskId` nullable).

- [ ] Test (`tests/panel/groupProblemVisible.test.ts`): group with all tasks done and `requirementReview = {state:"not-passed", why:"unfunded"}` ⇒ `summary.groupProblem.code === "requirement-review-not-passed:unfunded"`, `next` contains `orca group review-rerun` (or the existing `next` lines from `verbs.ts:358-385`); same group with a failed task ⇒ `firstFailure.taskId` is that task and `groupProblem` still set. Brief text output contains the review line. `orca status` work health counts the group as needing a person.
- [ ] Run it red; implement; run green. Mutation: drop the `groupProblem` assignment ⇒ red; drop the status count ⇒ red.
- [ ] Commit `fix(view): a not-passed requirement review reaches the card, the brief and orca status (#359)`.

### Task V2: a running group reads as running; landed-not-settled tasks count as settling (#361, #376)

**Files:** `src/panel/controlViews.ts` (counts ~483-514, `summary.state` ~792), `src/control/webProtocol.ts` (`counts` gains `settling`), `web/src/**` where `WorkItemCategory`/counts render, CLI brief.
**Interfaces:** `summary.state` derived: stored `ready|review` and (`executionPending` or `counts.running > 0`) ⇒ `"running"`; `summary.storedState` added. `counts.settling`: work stored `running` whose current run is `landed` (or `settled` before its commit) — counted there, not in `running`.

- [ ] Tests: 2 of 7 tasks claimed on a Web-started group ⇒ `state === "running"`, `storedState === "ready"`; a task whose run is `landed` ⇒ `counts.settling === 1`, `counts.running === 0`, `done` unchanged. Guards that read stored status (`DISPATCHABLE_GROUP_STATES`, `prestart`) untouched — assert a dispatch still claims on the derived-running group.
- [ ] Mutations: remove the derivation ⇒ state test red; count landed as running ⇒ settling test red.
- [ ] Commit `fix(view): a group with a task under way reads running, and a landed task waiting to settle counts as settling (#361 #376)`.

### Task V3: archived groups show what they are; unarchive never starts a group (#370)

**Files:** `src/commands/domains/reads.ts` (~211-221 list rendering), `web/src/GroupList.tsx` (state chip), `src/panel/controlViews.ts` (~1900-1913 deferredWakes), `src/control/archiveGroup.ts` (unarchive), `src/control/webDispatch.ts` (~286-288 start wake kept for archived), spec Correction in `docs/superpowers/specs/2026-10-08-*issue-fixes*` §6.3 (find exact file by grep "§6.3").
**Behaviour:** list/CLI/Web show `archived (was <state>)`, archived groups listed last (still listed by default — Issue 151). `unarchive`: a queued start wake for the group is dropped in the same transaction; the receipt says `start it with: orca group start <id>`; `recovery list` no longer shows `group-archived` deferred wakes as pending starts.

- [ ] Tests: CLI list line for archived-running group is `archived (was running)`; unarchive of a ready group with a queued start wake ⇒ wake row gone, no claim on the next driver pass, receipt text contains `orca group start`; `orca status` still excludes archived groups.
- [ ] Rewrite (Ruling) any test that pins "unarchive delivers the start wake" (grep `tests/` for `group-archived` and `deferredWakes`).
- [ ] Spec Correction appended (do not edit the original paragraph): human ruling 2026-11-18 「unarchive 一个 ready 组时，不应该自动开跑」.
- [ ] Commit `fix(control): unarchiving a group never starts it; archived groups read archived (was <state>) (#370)`.

### Task V4: recovery list hides finished handoff rows (#372)

**Files:** `src/panel/controlViews.ts` (~1859-1877), `src/control/webProtocol.ts` (`finishedHidden?: number`), CLI `recovery list` (`--all`), web if it lists the outbox.
- [ ] Tests: 3 finished + 1 pending row ⇒ default list has 1 row and `finishedHidden: 3`; `--all` returns 4. Rows are not modified (no `delivered` write — #170 untouched).
- [ ] Commit `fix(view): recovery list shows only handoff rows still in flight; --all shows the history (#372)`.

### Task V5: a landing watch taken over by group acceptance is not a problem (#371)

**Files:** `src/panel/controlViews.ts` (~834-836), `web/src/ControlGroupView.tsx` (~635 Problems count), `src/commands/domains/verbs.ts` (~395-400 "runs again on the next landing").
- [ ] Test: done group whose last watch recorded a regression and acceptance has a result ⇒ `landingWatch.supersededBy === "acceptance"`, Problems count excludes it, CLI says the watch was taken over by group acceptance. Mutation: drop the superseded check ⇒ red.
- [ ] Commit `fix(view): a landing watch the group acceptance took over no longer counts as a problem (#371)`.

---

## Track C — CLI and small Web copy. Worktree `.wt-batchd-c`.

### Task C1: one error line, with the next step (#373, #368a, #374d)

**Files:** `src/commands/output.ts:42` (`printResponse`), new `src/commands/errorNext.ts` (`nextForCode(code: string): string | null`), `src/control/webService.ts:301,405` (give `grant-amendment-unsupported` a detail `group-started` / `task-started`), `src/commands/domains/reads.ts:615` (stop suggesting `proposal set-agent` for a started group; suggest `orca task retry <g> <t> --agent <inst>`), `tests/commands/groupDependHint.test.ts:14` (Ruling rewrite).
**Behaviour:** `message === code` ⇒ `orca: <code>`; `message` starts with `code:` ⇒ `orca: <code>: <rest>`; otherwise unchanged. When the verb has no `hint`, append `nextForCode` for: `group-execution-pending` (start is queued; it begins when the estimate ends or a slot frees), `stop-mode-conflict`, `grant-amendment-unsupported`, `requirement-not-split`, `group-state-invalid`, `no-op-command`, `group-archived`. `ControlError.message` is **not** changed (it is persisted in command results).
- [ ] Tests for both shapes + Review Focus 3; mutation: remove the dedupe ⇒ red.
- [ ] Commit `fix(cli): print a refusal's code once and say the next step (#373)`.

### Task C2: `orca <domain> --help` and `project show <project>` (#374 a, b)

**Files:** `src/commands/run.ts:54-60` (`runRegistered`), project domain command file (grep `project show`).
- [ ] Tests: `orca project --help` and `orca run --help` exit 0 and print the same text as `orca help project` / `orca help run`; `orca project show foo` ≡ `orca --project foo project show`; an unknown domain still gets did-you-mean, exit 1.
- [ ] Commit `fix(cli): a domain's --help is its help page; project show takes the project as an argument (#374)`.

### Task C3: a zero-question round finishes instead of dropping glossary and ADRs (#354)

**Files:** `src/commands/domains/work.ts:96-101` (`unansweredRefusal`), `web/src/RequirementsPanel.tsx:331-336`.
**Behaviour:** CLI: round with `questions.length === 0` ⇒ refusal text names the K glossary entries and M ADRs waiting and gives `orca requirement answer <g> --finish` (accepts them by default). Web: with zero questions and any glossary/ADR, the consensus button sends answer-finish (default accept) instead of consensus. Server semantics unchanged.
- [ ] Tests: CLI text; Web: clicking the button on such a round sends `requirement-answer {finish:true}` and the glossary survives in the document fixture. Mutation: keep the old consensus send ⇒ red.
- [ ] Commit `fix(requirement): a round with no questions finishes by accepting its glossary and ADRs (#354)`.

### Task C4: a `keep` delivery says where the files are (#365 a)

**Files:** `web/src/ResultsConclusion.tsx:88`, `web/src/i18n/en.ts:1301` (+ zh), CLI group done/brief delivery line.
- [ ] Test: done group with delivery `keep` ⇒ text names `orca/<group>`, its tip, and `git checkout orca/<group> -- <paths>` (paths: the group's changed paths, at most 5 then `…`), and says local delivery is the alternative.
- [ ] Commit `fix(results): a kept delivery names the branch and how to take its files (#365)`.

---

## Track D — driver and control. Worktree `.wt-batchd-d`.

### Task D1: a failed run with no report is cleaned once, quietly (#360, #364 a)

**Files:** `src/control/executionDriver.ts` (`stepCleanupFailed` ~1902/1697, `savedReport` ~1517, `recordStepFailure` ~1925-1937), `src/control/archive.ts` (~92-141: temp files removed in `finally` unless renamed).
**Behaviour:** no `report:<runId>` ⇒ if the run was never accepted by ccloop (`executionId === null`) or ccloop proved it stopped (collect has stop proof or terminal), archive with `stopProof: null` (`missing: ["stop-unconfirmed"]`), clean the workspace, `cleanedUp: true`. Otherwise keep the workspace, set `cleanupError: "cleanup-awaiting-stop"`. `recordStepFailure` writes stderr only when `cleanupError` changes. Archive temp files never outlive a failed publish.
- [ ] Tests incl. Review Focus 4; a failing `pipeline` in `archiveFile` leaves no file in `staging/`. Mutations: re-throw on missing report ⇒ red; remove the change-only log guard ⇒ log count test red.
- [ ] Spec Correction (issue-fixes §4.2(2)), commit `fix(driver): a failed run without a report is archived and cleaned once, and archive temp files do not leak (#360 #364)`.

### Task D2: the next attempt is told which check failed (#321 C1)

**Files:** `src/control/priorFailures.ts` (~54-110), `src/control/executionDriver.ts:1111` and `src/control/baseCheckRecord.ts:89` (base-check request).
**Interfaces:** new `finalRejectionOf(store, runId): Promise<{ rejectCategory: string; failingCommand: string | null; evidence: string[] } | null>` — the highest-attempt stored verification observation with `verification === "failed"` (same reader as `readStoredRejection`, without the fingerprint match).
**Behaviour:** when `drive.lastFailure` is undefined and the run ended `required-check-failed` (or another verification rejection), `priorFailureOf` uses `finalRejectionOf` for `rejectCategory`/`failingCommand`/`evidence`; the base-check request uses its `failingCommand`. Unreadable ⇒ today's `run-failed:<cause>` (Review Focus 5).
- [ ] Tests: fixture run with one attempt, final verification failed on `npm test` ⇒ prior failure carries `failingCommand: "npm test"` and evidence; the base-check request is recorded for `npm test`. Mutation: return null from `finalRejectionOf` ⇒ both red.
- [ ] Commit `fix(control): the next run is told the check that failed its predecessor's last attempt, and #341's base check runs for it (#321)`.

### Task D3: a review answer with a broken shape is asked once more (#358 a, b)

**Files:** `src/control/requirementReview.ts` (~559 call failure, ~594 `why:"failed"`, prompt ~151-158).
**Behaviour:** call result `single-call-output-invalid` (or ccloop's not-single/answer-shape causes) ⇒ rerun the review call once in the same round; second failure ⇒ today's `not-passed/failed`. Prompt states `"checkConflict": null when there is none` (review prompt has no version mark — change the text only).
- [ ] Tests: fake call failing invalid then succeeding ⇒ review passes, 2 calls recorded, both billed; failing twice ⇒ `failed`, exactly 2 calls. Mutation: no retry ⇒ red.
- [ ] Commit `fix(review): a review answer with a broken shape is asked once more (#358)`.

### Task D4: an abandoned run stays abandoned after a lower-bound settle; pause says what it does (#369 b, c)

**Files:** `softLoopSettlement` / `finishUsageSettlement` (grep), `src/control/abandonRun.ts:17-19`, pause receipts (CLI + `web/src/i18n/en.ts`).
- [ ] Tests: abandoned run settled at its lower bound ⇒ `operatorSettlement.kind === "abandoned"`; ledger arithmetic unchanged (assert totals equal to before). Pause receipt with a running run says it keeps running and names `orca run abandon`.
- [ ] Commit `fix(control): a lower-bound settle keeps an abandon's record; pause says a running run keeps going (#369)`.

### Task D5: a run Orca's own bound stopped can be closed and retried (salvage narrow fix)

**Files:** `src/control/retryTask.ts:292`, `src/control/driveRecord.ts:301-306`, `src/control/terminalRunClosure.ts:70-71` (predicate next to `isTerminallyFailedRun`), `src/panel/controlViews.ts:2042` (recovery list), RunReason fallback text (grep "offered recovery action").
**Behaviour:** a run blocked at C by Orca's harvest bound with `outcome: "succeeded"` is (a) listed in `recovery list` with its out-of-bound paths, (b) closable by `close-run`, (c) retryable by `task retry` (with `--after <sibling>` suggested when the path is a sibling's frozen claim). The fallback text names the actual commands.
- [ ] Tests: fixture of that shape ⇒ recovery row present; `close-run` succeeds; `task retry` succeeds; a normal succeeded+landed run is still refused by both. Mutation: drop the predicate ⇒ red.
- [ ] Commit `fix(recovery): a run Orca's own bound stopped can be seen, closed and retried`.

### Task D6: implied paths are a hint, not an edit (#353 c)

**Files:** `src/control/splitImpliedPaths.ts` (`applyImpliedPaths` ~153-168), `src/control/requirementCalls.ts:474`, `src/commands/domains/reads.ts:136` (hint line), spec Correction in `docs/superpowers/specs/2026-11-16-implied-write-paths-design.md` (human ruling 「同意」 to downgrade).
**Behaviour:** `impliedPathsOutsideTargets` still computed and shown, with the existing one-click `add-implied-path`; `targetPaths` are no longer changed automatically, so no implicit edge appears from them. #345's goal-path addition (`applyGoalPaths`) is **not** changed.
- [ ] Tests: the `deps-dogfood` shape (successCondition "does not import src/deps-report.js") ⇒ `targetPaths` unchanged, layers parallel, hint present with the add command; `add-implied-path` still adds it. Rewrite (Ruling) existing tests that pin the auto-add.
- [ ] Commit `fix(split): a path a success condition mentions is suggested, not added (#353)`.

---

## Merge

- [ ] Each track: whole-track review by a fresh reviewer, fix, re-review; then `npm run test:wide` (with `ORCA_CCLOOP_BIN`) once per track tree, red files rerun alone and against untouched main.
- [ ] `--ff-only` into main in order V, C, D (rebase C and D onto the new main first; re-run typecheck after each rebase).
- [ ] Log each merge in `.superpowers/sdd/2026-11-18-tester-pm/progress.md`.
