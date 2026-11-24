# Pre-existing failures: a requirement that says "only add" meets a check that is already red (#341, #322 residue)

Orca session `4389b15f`, 2026-11-18. Tester issues #341 and the residue of #322 in
`orca_archived_files/issue-20261023.md`. Status: design approved in direction by the human; not built.

## Human rulings this design rests on

- The controller first proposed running the group's required checks on the base before every start. Human, verbatim:
  「不希望每次跑之前都跑一次组的必需检查，既浪费时间，又浪费token，你要再好好考虑一下怎么做」.
- The controller's second proposal (four layers below: free in the normal case, paying only after something already
  failed) was answered 「同意」 (2026-11-18).

## The problem

`audit-dogfood-20261117-1`: the requirement said "do not change or remove any existing document contract … only add" and
"`npm test` must pass at the end"; at the base, `test/readme.test.js` already failed (README showed a version-1 example,
the CLI exports version 3). Every path breaks one criterion. The agent of the first task that ran the suite silently chose
to edit README; seven tasks and 19.54M tokens later the review reported `checkConflict` and the group stopped
`not-passed`. Nothing in clarify, split or the runs said earlier "this check was red before anyone changed anything".

Two facts shape the fix:

1. Whether two sentences of a requirement contradict each other is a judgment (Rule 5): code cannot read "only add".
2. Whether a check is red at the base is a fact code can learn -- but learning it by running the suite costs minutes and,
   for an agent-run check, tokens. The agents already run the suite near the start of their work; Orca already runs a
   check on the base when the group's tip is red (`src/control/groupAcceptance.ts`, `baselineRed`).

## Design: four layers, cheapest first

### L1. Clarify asks, only when both sentences are present (no extra call)

The clarify instruction (`src/control/requirementClarify.ts`, the "Which questions are the person's" section) gains one
rule: when the requirement both forbids changing existing behaviour, contracts or documents and requires a whole check
(a test suite, a lint, a build) to pass, ask on the frontier how a failure that already exists in the repository should
be handled -- fix it (an allowed change), or judge the check relative to the base. It is asked at most once per
requirement and never when either sentence is absent. The instruction version rises (prompt head constant, and every
fake that matches on the head is updated; see the #328 lesson in the handoff).

Cost: some instruction bytes in a call that runs anyway.

### L2. The agent reports a pre-existing failure; the group shows it at once (no extra call)

Every loop contract Orca writes gains one constraint line (it goes with the plan version that is current when this is
built; old contracts keep their bytes):

`If a required check already fails before you change anything, report it as a major decision whose question starts with "Pre-existing failure:" followed by the command, and say in "chose" what you did about it.`

ccloop carries `decisions` opaquely and Orca already reads them (`src/control/reportedDecisions.ts`); the marker is a
string Orca defines and the agent is told verbatim, not a reading of free text. When a run lands (or ends) with such a
decision, Orca records an activity `preexisting-failure {taskId, runId, command, chose}` and shows a problem row on the
group: "Task T found `<command>` already failing before its change; it chose: <chose>". The row offers three exits,
each a recorded answer the review reads in "What Orca recorded beyond the diff":

1. **Allow the fix** -- the change the agent made to repair the failure is allowed (the review is told so).
2. **Judge it relative to the base** -- the check is accepted relative to the base (the review is told so; group
   acceptance already reports `passed-relative` for a suite red at the base).
3. **Edit the requirement** -- the existing requirement edit flow.

The group keeps running: most of its work is valid either way, and a person who is away should not stop it. What
changes is that the conflict is visible after the first task, not after the review.

### L3. A task's check failed: learn whether it was red at the base, once (pays only after a failure)

When a task run ends `required-check-failed`, Orca runs that one failing command once at the group's base commit,
with the same runner and the same base the group acceptance uses (`runAcceptance` with a base tip), in its own
temporary checkout, and caches the answer by (repository, base commit, command). If the command is red at the base:

- the run's prior failure handed to the next attempt (`src/control/priorFailures.ts`) carries one evidence line:
  `This check already failed at the group's base, before any change: <tail>`;
- the same problem row as L2 is shown (source: `base-check`).

No retry rule changes. A green answer at the base is cached too and adds nothing.

### L4. Use what Orca already knows about the base (free)

When a group is confirmed, if an earlier group's acceptance on the same repository recorded the full suite (or a
required check) at exactly this group's base commit, its result is shown on the confirm screen and in `group brief`:
"At this group's base, `<command>` was red (group G's acceptance, <date>)". Nothing is run.

## Non-goals

- Running any check before a start (ruled out by the human).
- Code deciding that two sentences of a requirement contradict each other.
- Changing the review's verdict rules or `checkConflict` (it stays the last net).
- #108 (structured acceptance fields carried into task contracts) is a separate design: it changes the clarify →
  split hand-over for every requirement, not only this conflict.

## Acceptance (each a command that exits 0 / non-0)

1. The clarify instruction contains the L1 rule; a clarify fake that answers with the question produces it as a frontier
   question (unit on the prompt + `tests/control/requirementClarify*.test.ts`).
2. A run whose result carries a major decision with question `Pre-existing failure: npm test` records
   `preexisting-failure` and the group view shows the row with its three exits; a decision without the marker records
   nothing.
3. Each exit's answer appears in the review prompt's Orca facts.
4. A task run ending `required-check-failed` on a command red at the base: one base run, cached (a second failure of the
   same command at the same base runs nothing), and the next attempt's prior failure carries the evidence line; green at
   the base adds nothing.
5. A group whose base equals an earlier group's accepted tip with a red full suite shows the L4 line; no command runs.
6. Old contracts' bytes are unchanged; new contracts carry the L2 constraint line.

## Left to the builder

Exact activity body fields, en/zh strings, where the cache lives (a control-store table or a canonical record keyed by
the triple), and which plan version carries the L2 line (with #346 landing v4 first, the line rides v4 if #346 is not
yet released, otherwise v5).

## Correction 1 (plan 2026-11-18)

Written by a subagent of Orca session ca534c51 (2026-11-18), following commit `265cf1fd`. The text above is unchanged; this
section records what the build decided and where it differs from or fills in the design. Sources: the SDD ledger
`.superpowers/sdd/2026-11-18-preexisting-failures/progress.md` and the task 1-4 reports in the same directory.

### 1. Build order and sources

- **What:** the tasks were built 1 -> 3 -> 4 -> 2, not 1 -> 2 -> 3 -> 4. L4 reads the L3 table as its second source.
  L2's problem row has two sources: `agent` (a reported decision) and `base-check` (a red L3 row).
- **Why:** Task 2 needed #346's v4 plan contract, which was not on main yet; the human asked for independent work to run
  in parallel. The branch was rebased onto #346 before Task 2.
- **Cost / limit:** one rebase with a conflict in `executionDriver` step C, resolved by keeping #346's parallel-claim
  classification and L3's `requestBaseCheck`. Task 3 therefore stores each red-at-base result durably (see item 3) so
  Tasks 4 and 2 can read it.

### 2. L1: clarify instruction version 4

- **What:** `CLARIFY_PROMPT_HEAD` now says "instruction version 4" and "Which questions are the person's" carries the L1
  rule (ask once how a failure already in the repository is handled, only when the requirement forbids changing existing
  behaviour/contracts/documents AND requires a whole check to pass). `FEEDBACK_CLARIFY_INSTRUCTION`
  (`flow/feedback/host.ts`) inherits the v4 head but not the L1 rule.
- **Why:** the head is shared; the rule belongs only to the clarify round for a requirement.
- **Cost / limit:** the feedback clarify says "version 4" without the rule (harmless, unpinned). The trailing "ask it only
  when both ..." sentence is pinned only by the golden file. Constant names still say V3.

### 3. L3: the cache

- **What:** a control-store table `base_check_results` (schema migration 24 -> 25), primary key (repository id, base,
  command); columns include `result` in `pending` / `red` / `green` / `unknown`, `tail`, `why`, asker group/task/run,
  `requested_at`, `at`, `attempts`. Only a command in the failing task's confirmed required checks is run. Step C writes a
  `pending` row for a work run that ended `required-check-failed` (not saved-result verifies, not recovery runs).
- **Why:** a canonical record is content-addressed and cannot be keyed by the triple; `check_state` is strictly parsed and
  would block on a foreign row; activity rows are not queryable by key. Only failures that settle after this change ask,
  so earlier groups get nothing new.
- **Cost / limit:** `attempts` was edited into the unreleased schema-25 DDL in place; a store migrated by the first
  Task 3 commit would lack it (none is known). Multi-directory, dir and dir-flow groups get no row; archived groups ask
  nothing.

### 4. L3: ownership, retry and unknown results

- **What:** the newest asker owns a `pending` row. `unknown` carries a `why`: one that starts `error:` is re-run when a
  different run asks, up to 2 attempts; `timeout`, `setup-failed` and `not-runnable` stay cached. Exit 126/127 gives
  `unknown` with `not-runnable` (not red). An answered red/green row is never re-run.
- **Why:** an archived or stopped group's pending row must not block the triple for everyone; a transient git error must
  not poison it for good.
- **Cost / limit:** at most 2 extra base runs per triple; attribution on a pending row shows the latest asker.

### 5. L3: where it runs, what bounds it, which setup

- **What:** the driver pass `checkBases` runs after the landing watch, off the round (it starts a run and returns), one run
  in flight per repository, each command bounded by the failing task's `executionPolicy.perAttemptTimeoutMs`; `stop()`
  aborts it and waits for the worktree to be removed. It uses the failing task's own `setupCommands`, not the group's
  union.
- **Why:** a union may include setup that only works after another task landed; the settle lane must not be held.
- **Cost / limit:** a one-line change to revert the setup choice. The tail shown is cut from the front, with an
  omitted-bytes marker (4096 B for prior failures, 2048 B for live notes).

### 6. L3: reaching a running attempt, and the second group

- **What:** when a base result arrives red and the task has a live run, the evidence line is queued as a live note
  (`by: "orca"`, id `orca-base-check-<runId>`). Later attempts get it through prior failures as the design says. No wait
  at dispatch, no retry-rule change. A second group asking an already-red triple gets prior failures only, no live note.
- **Why:** the spec forbids changing retry rules.
- **Cost / limit:** the note arrives at the agent's next phase start, not at the attempt's start. If the next attempt is
  prepared before the base run ends, that attempt is told nothing.

### 7. L4: the brief and the base rule

- **What:** `group brief` gains `knownRedAtBase` (absent when empty); the CLI prints the spec's line. The group's base is
  the base its first work run recorded; before any run, a flow child's composition commit or a `done` stacked
  prerequisite's accepted tip. The latter two are not checked against git. Facts come from other groups' recorded
  acceptances on the same repository and from `base_check_results`; per (repository, base, command) the latest record
  wins, so a later green cancels an earlier red. Timeouts, exit 126/127 and signals answer nothing. The brief route
  spawns no process.
- **Why:** the human's ruling forbids running a check before a start.
- **Cost / limit:** the stacked prediction assumes the prerequisite's branch is still at its accepted tip. The brief's
  groups read scans `groups.body` with `json_extract` (a prefilter bounds the rows read, not scanned). Delivered
  acceptances and the group's own acceptance are not read as sources.

### 8. L4: the confirm step

- **What:** the design's premise that a base exists at confirm was false for a group that starts at its target's HEAD. A
  separate route `GET /api/control/groups/:groupId/confirm-known-red` serves the confirm note. It may run ONE
  `git rev-parse` of the target HEAD, only when: single tree, no recorded base and no unreadable run body, not stacked
  and not a flow child, every prerequisite `done`, and the store already holds a red record for that repository. The line
  is worded as a prediction: "At the target's current HEAD (`abc1234`), ... was red".
- **Why:** the ruling forbids running checks, not a rev-parse; the confirm screen is where L4 matters.
- **Cost / limit:** the prediction is stale if HEAD moves before the first run (the brief self-corrects at the real
  base). Route errors map to 5xx and the web swallows them.

### 9. L2: plan version carrying the constraint line

- **What:** the marker/constraint line rides loop plan v4 (same gate as #346's off-plan line); v1-v3 bytes are unchanged.
- **Why:** #346 is unreleased (last tag v0.1.1; the panel has not been reinstalled since), so no stored v4 recipe should
  exist.
- **Cost / limit:** if a stored v4 recipe exists, its group view blocks with `loop-plan-recipe-mismatch`. Reinstall the
  panel only after #341 merges.

### 10. L2: recording

- **What:** one `preexisting-failure` activity row per command per run, recorded once at step C for every terminal outcome
  (landed or not); saved-result verifications and recovery runs are excluded; recording never fails the collect. A
  decision counts only if major (absent importance reads as major) and its question starts `Pre-existing failure:`;
  the command is trimmed with one pair of enclosing backticks dropped; bounds: command 1024 B, chose 2048 B, 16 per run.
- **Why:** one site reading the report just saved covers "lands or ends".
- **Cost / limit:** the same command repeated across runs shows each run as a reporter (per-run repeats not collapsed).

### 11. L2: the command and what an answer does

- **What:** verb `answer-preexisting-failure` (route `POST groups/:groupId/preexisting-failure`, CLI
  `orca group preexisting-failure <g> --command <cmd> --answer allow-fix|relative|edit-requirement`), human-only (socket
  tier token, as waive-acceptance). An answer only adds a line to the requirement review's facts ("What Orca recorded
  beyond the diff"). It changes no acceptance rule, retry rule, verdict rule or `checkConflict`.
- **Why:** spec: each answer is "a recorded answer the review reads".
- **Cost / limit:** an answer given after the review has run needs a rerun of the review; the UI does not say so.

### 12. L2: rows, refusals and storage

- **What:** a row is `answerable` only for a group whose requirement review runs and which is not multi-directory or dir;
  otherwise it is information only. Refusal codes: `preexisting-failure-not-reported`,
  `preexisting-failure-person-required`, `preexisting-failure-not-answerable` (409). Answers live in the group body field
  `preexistingFailureAnswers[command] = {answer, by, at}` (absent until answered; a later answer replaces an earlier one).
  An answer outlives activity-retention pruning: a stored answer with no surviving source still yields a row (`sources: []`)
  and still reaches the review facts. The view row carries `sources`, `baseCheck` and `answered`.
- **Why:** activity keeps 500 rows per group; a pruned report must not erase a human's answer.
- **Cost / limit:** without a surviving source the agent report can no longer be answered afresh (the command is refused
  with not-reported); the schema allows `sources: []` with a null answer though construction prevents it.

### 13. L2: edit-requirement

- **What:** the design's "existing requirement edit flow" premise was false: Orca cannot change an accepted requirement
  (`requirement-revise` and draft feedback work only while clarifying). `edit-requirement` therefore records the answer
  for the requirement review and opens the requirement page (web, only after the command succeeds; CLI prints a next
  line naming `orca requirement show <g>`). Wording in en, zh and the CLI says so.
- **Why:** honesty; building an edit flow is a separate design.
- **Cost / limit:** the human cannot actually change the accepted requirement through Orca today.

### 14. Known limits (deferred minors)

- Task 3: a taken-over pending row notes only the newest asker's live run, and `requested_at` bumps on takeover; the
  abort branch in `checkBases` is unreachable (kept defensively); the recovery-blocked log re-fires per sibling row; a
  crash between `blockRun` and the request write loses the request (nothing is claimed).
- Task 4: `TARGET_HEAD_TIMEOUT_MS` sits inside an import block in `webService.ts`; a failed refetch leaves a stale note;
  `acceptanceFacts(null)` parses every acceptance body per confirm refetch; the once-guard on brief failure logging is
  per process.
- Task 2: the answerable path is not measured by `controlPollPerformance`; `group brief` does not list the preexisting
  failure rows (only `group show` does).
- Tests: `criteriaBaseRun` and `acceptAttemptLanding` flaked under load in quick-tier runs; watch them at test:wide.

### Added by the final fix wave

Written by the final-review fix agent of Orca session ca534c51 (2026-11-18), following commit `6d37f342`. The items above
are unchanged.

- **What:** "latest wins" -- a later green acceptance at the same base cancels an earlier red -- is applied in L4 (the
  brief and the confirm step) only. L2's problem row and L3's evidence line can still show that red.
- **Why:** kept to the reviewed scope; the final whole-branch review recorded it as a minor rather than a fix.
- **Cost:** a stale red on the row and in the evidence line until the next base check at that base.
- The same wave fixed, in code: an unanswerable row no longer counts on the Problems tab or in the Results conclusion;
  the view's base for the base-check source follows `baseCheckScopeOf` (no base past an unreadable earlier run body, none
  for a dir flow group); and `TARGET_HEAD_TIMEOUT_MS` (item 14) now sits after the import block.

## Correction 2 (2026-11-18, tester batch D review, #321 C1)

Who / when / base: fix-wave implementer subagent (Claude Opus 5.5) of the Orca session running plan
`docs/superpowers/plans/2026-11-18-tester-batch-d.md`, 2026-11-18, on branch `fix/batchd-d` after `e276ca35` (review of
task D2, findings I1 and I2). §3's "Step C writes a `pending` row for a work run that ended `required-check-failed`" stays
as written; it is corrected here.

1. **Which command.** ccloop puts a rejection in `recentFailures` (Orca's `lastFailure`) only when it retries after it
   (`runLoop.ts`, the `retryable` branch), so the final attempt's rejection is never there: a one-attempt run has no
   `lastFailure`, and a longer one has an earlier attempt's. A run whose cause is a verification rejection
   (`required-check-failed` / `verifier-rejected`, phase `verify`) is now remembered by the collector's stored rejected
   verification of the attempt the stored page names as current (`finalRejectionOf`); `lastFailure` only when that cannot
   be read. The next run's prior failure and the base check both use it.
2. **Where it is asked.** Step C still asks with `lastFailure` when there is one (unchanged, and it may name an earlier
   attempt's command). It never waits for the collector, which stores the final attempt's verification after C. A fresh
   run's A2, where its prior failures are built, asks for the newest failed run of its task with the rule of item 1 (the
   asker is that failed run); a red answer reaches the new run while it works as §6's live note. Continuations, saved-result
   verifies and recovery runs ask nothing there. A failed run that is never followed by another gets no base check for its
   final attempt's command; one followed before the collector stored that verification gets `lastFailure`'s (or none).

## Correction (2026-11-19, session 3ba26002): an `allow-fix` answer withholds the review's relative pass (#377)

§11 said an answer "changes no acceptance rule, retry rule, verdict rule". Since #377 (follow-up G spec, Correction of
2026-11-19) code judges a not-met criterion about the full suite a relative pass when the suite was already red at the
group's base. One answer now matters to that rule: `allow-fix` on the suite's command (the person asked for the
pre-existing failure to be repaired) withholds the relative pass, so the criterion stays not-met and takes the fix path
as before. `relative` and `edit-requirement`, and no answer, leave the rule to apply.

## Correction (2026-11-25, Orca session `6add92a5`, Claude Opus 5.5, on main after `chore(deps): repin ccloop to 276114a…`): an agent's report is checked at the base before anyone is asked (#466)

Human ruling 2026-11-24 (session `d7ca40c0`, 「同意你的建议」 on #466). L2 and §11 stay as written for the rows they
describe; this narrows when an agent-only row asks the person.

- **Why:** tester #466 — a group green at its base (473/0) and at its tip (605/0) sat at `review` because one task's
  agent reported `npm test` red "before its change" (598/1). The agent ran it at its own start, which holds the group's
  earlier tasks' work, not at the group's base; the review read the unanswered row and did not pass.
- **What:** when a work run's agent reports a pre-existing failure on a command that is one of the task's confirmed
  required checks, step C asks L3's base run for it (same table, cache and runner; `requestReportedBaseCheck`). A command
  that is not a confirmed required check is never run (§3's rule holds). When the base answers **green**, the row carries
  `notConfirmedAtBase`, leaves the brief's `preexistingFailuresWaiting` and the Problems count, and the review's fact line
  says the check passed at the base ("not confirmed … judge this check as the requirement states it"). Red or unknown at
  the base: the row is as before. The requirement review waits while such a base run is pending for an unanswered row.
- **Cost / limit:** one base run per distinct reported required check per (repository, base), paid only after an agent
  reported a failure (the 2026-11-18 ruling against running checks before a start is untouched). A reported command that
  is not word-for-word a required check stays an unconfirmed, waiting row as before. The tester's three `prunable`
  worktrees (`/private/tmp/base2-*`, `basecheck-*`, `cl-*`) are not paths Orca's base run uses (it uses the acceptance
  scratch path); they are not addressed here.
