# Tester follow-up G: design for the items that needed brainstorming

Date: 2026-11-12. Owner: Orca session `d1cbbd58` (controller), brainstormed with the human in chat.
Base: Orca main at `chore(deps): pin ccloop to the transcript listing that carries each call's startedAt (#252)`.
Inputs: the tester's report `orca_archived_files/issue-20261023.md` (incl. #261–#272 added 2026-11-12) and five
read-only triage passes (`/private/tmp/orca-g1112/triage-{A,B1,B2,C,D}.md`, session-local, summarised below where used).

This document covers six parts. Each states what the human decided (quoted), what the controller decided on their
behalf (marked **controller's call**, reversible, open to the human's review), and what is left to the builder.
Earlier rulings this overrides are named in §8; each overridden spec gets a dated correction section appended, its
original text untouched (Rule 13).

Small fixes that needed no design (G1–G7: #230, #206, #209, #212, #245, #170, #246, #174, #220, #219, #232, #227,
#215, #173, ccloop #116/#122/#193, first-use dead ends, #261, #267, #264, #265, #268, #272, ccloop #262; #271 queued)
are being implemented in parallel under the human's 「不用 brainstorm、可以直接做的 => 同意这个范围」 and 「可以加派实现席」;
they are not specified here.

## 0. Why

The tester's report is full of tasks that did the work and were still stuck, and of money spent past what the person
said: empty results with no exit (#127, #179), task grants that starve execute or end finished work as `exhausted`
(#162, #196, #224, #225, #234, #238, #263, #266), a group cap overrun by 35 % (#225), requirements whose delivered result
nobody compares with the requirement (#108, #204, #247/#248), agents that re-learn the repository in every task (#197),
no way to add information to a running task from the Live view (#243, #226), a slow settle blocking the next task (#192),
regressions mid-group that nobody sees (#269), and a decision request that needs the same answer over and over (#189).

The guiding principle across all six parts: **Orca keeps going on its own where the agent and its checks agree, leaves
a revocable record of what it decided, and stops only where a person's explicit statement (the group cap, a pause line,
a criterion it cannot judge) is at stake.** Every action here is available in the Web and to an orchestrating agent
(handoff §5.3 operating principle).

## 1. Part 1 — an empty result completes as "no change" (#127, #179)

### Facts (main, 2026-11-12)
- A run that ccloop reports `succeeded` (its verifier ran the contract's required checks) but whose attempt changed no
  file lands nothing; D14 writes no acceptance; the task is blocked `empty-result` (`src/control/executionDriver.ts`
  ~1330, `EMPTY_RESULT_REASON`). No command moves it: `task retry` refuses `task-not-retryable:run-state:settled`,
  `set-task-loop` refuses a started task, `accept-attempt` refuses an empty one.
- The no-change completion that exists (2026-11-08) needs `verification.commandChecksDecideGoal:true`, which requires a
  command verifier, one repository and no setup (`src/scheduler/planFile.ts` ~251); the split never writes it.
- Typical sources (controller's reading): an earlier task already did the work; a check/review task (#179); or an agent
  that wrongly claimed done and fooled the verifier.

### Decision
- Human: 「希望 Orca 自动判完成（事后在活动里留一条可撤销的记录）」.
- Human, on revoking: 「希望这个任务直接在同一组里带你写的一句说明重新跑一次」.

### Behaviour
1. **Auto-complete.** A run that ccloop reports succeeded, whose required checks passed, and whose attempt tree equals
   its base (the C step's no-change proof, bound to this attempt as today) completes its task as done with landing
   `no-change`, writing the same acceptance shape the `commandChecksDecideGoal` path writes. The declaration and its
   three preconditions are no longer required for this outcome (**controller's call**: ccloop's verifier already
   accepted the goal; Orca does not gate it twice). Multi-repo runs: complete as no-change only when every repository's
   tree is unchanged; otherwise today's landing path applies.
2. **Record.** One activity row `no-change-completed` with the run, the agent's explanation of why nothing needed
   changing (from the task result's explanation), and the revoke action. The task carries a visible "no change" marker
   on Board, task detail, `group show` and the group view (**controller's call**: the person will want to see at a
   glance which tasks touched no code). A second no-change completion of the same task says "2nd time".
3. **Downstream and group.** Dependents proceed. The group can reach done; #179's "done 0/1" disappears.
4. **Revoke = re-run with a note.** Web (task detail, beside the no-change record: "Revoke and re-run") and CLI
   `orca task reopen <group> <task> --note "<text>"` (verb name left to the builder if it collides), available to a
   person and to an orchestrating agent (principal `agent:<client>`). The note is required, ≤2048 bytes. Effect, in
   one transaction: the no-change acceptance is withdrawn (activity `no-change-revoked` with the note), the task returns
   to not-done, and a new run is dispatched in the same group with the note delivered as the operator note (same
   mechanism as `continue-task`'s `operatorNote`, round C #226). If the group was done it goes back to running.
   Dependents already started or landed are **not** rolled back (**controller's call**). Not allowed once the group is
   archived.
5. **Budget of the re-run** (**controller's call**): like round E's `task retry` fresh start — fresh attempts and active
   time; tokens follow Part 2 (an expectation, bounded by the group cap). Refused with the existing exhaustion refusal
   when the group has no remainder.
6. Unchanged: a run that changed files lands as today; a run ccloop reports failed takes the failure path.

### Left to the builder
Where the "no change" marker renders; exact activity kind names (they must enter `i18nPseudo` — the enum count is an
existing pin: rewriting it needs the human's authorisation, see §9); whether `reopen` is a new verb or a mode of an
existing one.

## 2. Part 2 — budget: the group cap is the only hard line (#162, #196, #202, #212, #224, #225, #234, #238, #263, #266; R4)

### Decision
- Human on R4 (the controller proposed "task grants soft, the group cap hard, stop mid-call when it is reached"): 「同意」.
- Human: 「既然组上限会变成真的硬线，任务额度也许不该再是会把任务停掉的线。它可以只是「预期」，就像不限额组现在的做法：超了要报出来，但只要组里还有余量就继续干。」
- Human: 「超过10倍时先暂停这个任务，等人或编排 agent 决定要不要继续」.
- Human on #266 (estimates 10–90× low make a fixed 10× line fire on most tasks): pause line = the smaller of 10× the
  expectation and half the group cap; the expectation is at least 1M — 「可以」.
- Human: 「同意预算的方案」.

### Behaviour (groups with a finite token limit)
1. **Group cap is hard.** The sum of all running calls' observed usage plus the group's booked usage may not pass the
   group's token limit. When it would, every running call of the group stops: claude and omp mid-call through ccloop's
   live threshold (ccloop #225, `onObservedUsage`), codex between turns (codex reports usage only on
   `turn.completed`; the UI says so and never claims a strict cap for codex — handoff §3.2). A stopped run keeps its
   work through the existing handoff / saved-result paths; after the person tops up the group, tasks continue.
   - ccloop change: the live threshold is driven by a value Orca can update while the run is running (the group's
     remaining amount, apportioned or shared — builder's choice, see open points), not only the task's grant.
   - Orca change: hand each running run its threshold and update it as the group remainder changes; book the stop as
     `group-cap-reached`.
   - Spend caps (`--max-budget-usd` etc.) feed the same threshold when they bind first (builder: only if cheap; else
     record as a gap).
2. **Task grants become expectations.** An estimate's task tokens are written as an expectation, not a cap, in finite
   groups too — exactly as unlimited groups already do (`feat(budget): an estimate's task work is an expectation in an
   unlimited group`): views show "expected N · used ×ratio". The expectation is at least 1,000,000 tokens (#266;
   handoff §5.2.9 already says real work ≥1M). Attempts/active time follow the same rule as unlimited groups.
3. **A task the person capped by hand stays hard.** A finite task token limit set by a person (provenance `human`, not
   `model`) is still a hard cap, with no pause line added (**controller's call**).
4. **Over the expectation:** the first time a task's usage passes its expectation, one activity row
   `usage-over-expectation` and an amber hint on its Board card. No stop.
5. **Pause line:** at `min(10 × expectation, 0.5 × group limit)` the task is stopped by the same live threshold and
   enters "waiting for a decision" (Problems, Board, `group show`): "used N, ×R of the expectation". A person or an
   orchestrating agent decides:
   - **continue** (optional note): the next pause line is the next multiple (20×, capped again by half the group
     limit's remaining share — builder settles the exact formula and states it);
   - **stop**: the task ends stopped; the group goes on.
   A task with no (or a stale) expectation has no pause line; only the group cap binds.
6. **Effects that disappear:** plan eating the task grant and starving execute (the starvation half of #196; plan cost
   itself is not addressed); finished work ending `exhausted` for being over the estimate (#238, #263 — with #261
   fixed); funded ≠ authored after a top-up (#202/#212); retries getting only the remainder (#234).
7. **Migration (controller's call):** groups confirmed before this ships keep today's rules until they finish; groups
   confirmed after use the new model. Unlimited groups are unchanged except that Part 2.5's pause line also applies
   to them? — **No**: an unlimited group has no group limit, so the pause line there is 10× the expectation only.
   (Stated explicitly so the builder does not have to guess.)

### Left to the builder
How the group remainder is shared among parallel running runs (shared counter vs. apportioned slices) — must be
correct under parallel dispatch and must never let the sum pass the cap by more than one codex turn; the transport for
updating a running ccloop's threshold; exact names of states, activity kinds and refusals.

### Open points the builder must report rather than guess
Whether ccloop can update a running run's threshold without restarting the phase; if not, the smallest ccloop change
that allows it.

## 3. Part 3 — a requirement review after group acceptance (#108, #204, P0-1, lessons of #247/#248)

### Decision
- Human, on how they judge a finished requirement: 「没有统一标准，一般会对照需求看具体实现的结果（这个结果可以是代码、文档、图片等等）」.
- Human, when a criterion is not met: 「自动在同一组里开一个修复任务（把复核的发现当说明）」.
- Human on the playback (timing, inputs, outputs, two rounds, cap): 「同意」.

### Behaviour
1. **When.** For a group created from a requirement: after every task has landed (or completed no-change) and group
   acceptance (round E #241) passed, Orca runs one requirement-review single call.
2. **Who** (**controller's call**): an independent agent — the group's reconcile slot, else its worker slot — not a
   task's own run. Its prompt (English) gets: the requirement text, the clarification consensus incl. acceptance
   criteria, and everything the group changed relative to its base (diff, changed files; non-code artefacts such as
   documents and images are read as files).
3. **Output.** Per acceptance criterion: `met` / `not-met` / `cannot-judge`, each with evidence (file, line, artefact
   path) and, for `not-met`, what is missing. Stored with the group (versioned per review round), shown in the group
   detail ("Requirement review"), `group show`, and an activity row.
4. **Not met ⇒ fix task.** Each review round with `not-met` criteria opens one fix task in the same group (one task per
   round, covering all unmet criteria — **controller's call**), whose goal is the review's findings, whose write set is
   the files the review names (plus the group's allowlist), whose checks are the group's required checks. When it
   lands, group acceptance and the review run again.
5. **Bound (controller's call):** at most two automatic fix rounds. If the second review still has `not-met` criteria,
   or any review has `cannot-judge`, the group stops in Problems: "requirement review not passed", for a person or an
   orchestrating agent to accept as is, add a fix task by hand, or re-run the review with a note.
6. **Done.** A requirement group is done only when the review passed (or a person/agent accepted it). Until then the
   group shows "reviewing" / "review not passed", not done.
7. **Cost.** The review and fix tasks count against the group and the group cap (Part 2).
8. Groups not created from a requirement (imported plans, flows) skip the review (**controller's call**: there are no
   acceptance criteria to review against).

### Left to the builder
The single-call instruction text and its output schema (strict, like split/estimate); how the diff is bounded for very
large groups (state the bound); the review's grant (bounded by the group remainder).

## 4. Part 4 — task-to-task handoff (#197)

### Decision
- Human: 「「把前一个任务的简短笔记传给下一个任务」 => 这个可以做」; it is the human's own practice; they gave their
  handoff prompts as an example (not a template): the writer updates a living handoff doc in place (bounded, not
  append-only, no hard-coded HEAD) and gives a ≤10-line executive summary; the next agent's prompt is "read the handoff
  doc first", then the summary, then its own task. 「我希望你的prompt都用英文」.
- Human: 「倾向由 Orca 保存。而且每次handoff文档名可能都要不一样，防止Orca有多个agent同时跑时改乱了」.
- Human on the playback: 「brainstorm 同意」.
- The 2026-10-28 ruling "no session reuse across calls" (#109) stands; this is not session reuse.

### Behaviour
1. **Writing.** In a task's last phase, the prompt (English) asks the agent to return, in its task result, (a) a handoff
   document — the merge of its predecessors' handoffs plus what it learned, with stale content removed, ≤8 KB, no commit
   hashes — and (b) an executive summary of ≤10 lines.
2. **Storage.** Orca stores them in the group's state directory as `handoff-<task>-<run>.md` and
   `summary-<task>-<run>.md` (never in the target repository). Each run writes only its own two files; nobody edits
   another's, so parallel tasks cannot clobber each other.
3. **Reading.** At dispatch, a task's prompt starts with "read these handoffs first": the handoff and summary of each of
   its direct predecessors (dependency edges); with none, the most recently landed task's. A task with several
   predecessors reads all and writes one merged handoff. A parallel task reads what exists when it is dispatched.
4. **Retries.** A new run of the same task reads its predecessors' handoffs, not its own failed run's; the failed run's
   summary is attached as "previous attempt" (**controller's call**).
5. **Undelivered Live notes** (Part 5) are merged into the task's handoff.
6. **Failure tolerance.** A missing or malformed handoff never fails a task: one activity row, and downstream falls back
   to the nearest earlier handoff.
7. **Viewing.** The group detail lists each task's handoff and summary (expandable, versions by run).
8. Budget: the extra prompt and output count as ordinary task usage.

### Left to the builder
Where in the ccloop contract / prompt the handoffs go (prompt prefix vs. files in the run's input directory) — prefer
files the agent reads over pasting 8 KB into every phase prompt; whether plan and execute both get them.

## 5. Part 5 — a note box on the Live view (#243, #226)

### Decision
- Human: the note is to 「补充一点信息（它下一步用上就行）」 — not to interrupt.
- Human, on a note the task never reached: 「同意」 to marking it undelivered and merging it into the task's handoff.

### Behaviour
1. A note box at the bottom of the Live view (person and orchestrating agent). A sent note joins the task's pending
   queue; Live shows it as "queued — delivered at the next step".
2. **Delivery:** at the task's next phase start (plan → execute → verify), next attempt, or continuation, the queued
   notes go into that step's prompt. Live then shows "delivered at <phase>"; one activity row.
3. **Mechanism (controller's call):** Orca writes the note into an agreed file in the run directory; ccloop reads it at
   each phase start, includes it in the prompt and writes a delivered marker. Nothing is injected into a running call.
   (ccloop change.)
4. A paused / waiting-for-decision task: the note becomes the continuation note. A finished task: the box is disabled.
5. Not delivered before the task ends: marked "not delivered" in Live and activity, and merged into the task's handoff
   (Part 4).

### Left to the builder
File name and format; ordering and size limit of queued notes; how ccloop acknowledges.

## 6. Part 6 — three smaller items

### 6.1 #192 — claim the next task right after landing (controller's call)
After a task lands and merges into the group branch, the next task may be claimed at once; archive, settle and
publish continue in the background. Until settlement completes, the run's observed usage is reserved against the group
(Part 2), so nothing is overspent. Crash safety: today's D15 re-visit of unfinished settles stays.

### 6.2 #269 — a regression mid-group is visible (controller's call)
On every landing, run the union of the group's tasks' checks (setup + required checks, as group acceptance does) on the
group branch tip, non-blocking. A check that was green and turns red after a landing goes to Problems: "after <task>
landed, <check> turned red". Local time only, no tokens. Reuse the group-acceptance worktree machinery (per-check
paths, #241 fix).

### 6.3 #189 — "allow" covers the same kind of request in the group
- Human: 「本组里同类请示都自动放行」.
- "Same kind" (**controller's call**): a path request → the same path or directory pattern, treated as inside every
  task's write set for this group; a decision request → the same decision kind and scope (e.g. "task-scope criteria
  decision").
- Two buttons: "allow this one" and "allow this kind in this group" (default). Person and orchestrating agent
  (`agent:<client>`).
- The group detail lists "allowed in this group": who, when, from which request. Revocable; revoking affects only
  later requests. Group-scoped only; never project defaults.

## 7. Non-goals and anti-goals

- Not making plan cheaper (#196's cost half), not calibrating the estimator beyond the 1M floor (#266), not session
  reuse (#109/#197 ruling stands).
- Anti-goal: any of this silently spending past the group cap, silently completing a task whose required checks did not
  run, or writing handoff/notes into the target repository.
- Anti-goal: a Web-only or CLI-only action (every action here exists in both, and for an orchestrating agent).

## 8. Earlier rulings and specs this overrides (each gets a dated correction appended)

- D14 "an empty result blocks the task" and the `commandChecksDecideGoal` preconditions as the only no-change path
  (spec 2026-11-08 no-change completion) — Part 1.
- R4 (2026-11-10/11, "budgets are soft") — for the group cap only (Part 2.1); task grants remain soft, now as
  expectations.
- Task token grants as hard caps in finite groups (live-token-threshold spec 2026-11-10 §2.6, §7.6; budget-defaults
  spec 2026-11-11) — Part 2.2.
- §5.2.9 default 3M/3 attempts per task in finite groups — superseded by expectations + the group cap (Part 2).
- Round F C3 (#116 observed floor is explicit) stands.
- The criteria-review judge (#174) is unchanged; the requirement review is a different run.

## 9. Constraints

- Orca Rules apply: criteria seen red via named mutations in `git clone --local`; Rule 17 for anything written outside
  the repo; ccloop Rule 15 (existing ccloop criteria rewritten only when the human names them one by one).
- **Existing criteria:** this design changes behaviour that existing tests pin (D14 empty-result tests, finite-group
  exhaustion tests, `i18nPseudo` enum count, etc.). Rewriting them needs the human's authorisation; the plan must list
  them before implementation.
- Cross-repo: Part 2 (live threshold from the group remainder, codex between turns) and Part 5 (phase-start note file)
  change ccloop; ccloop must be pushed by the human before Orca repins.
- No paid real-agent runs without asking the human each time.

## 10. Builder-check answers (controller's calls, 2026-11-12; the human was away — for review at round end)

A fresh reviewer read §1–§9 as a builder and asked five questions only the human could answer. The human had said
「这一轮执行过程中如果有问题，先按你的建议执行。执行完在最后阶段报给我审核。」, so the controller answered them:

1. **Part 1 with a command verifier.** A command verifier runs the checks in code and never judges the goal
   (ccloop `runLoop.ts` ~333), so "the verifier accepted the goal" holds only for agent verifiers. Therefore Part 1.1's
   auto-complete applies directly when (a) the run's verifier is an agent verifier that approved, or (b) the contract
   declares `commandChecksDecideGoal` (today's path). For a command-verified no-change run, Orca first runs one cheap
   single call ("goal already met?", worker slot, its grant bounded by the group remainder; input: task goal, success
   conditions, the agent's explanation, read access to the base tree). `met` ⇒ auto-complete as in Part 1 (the record
   names the judge's answer). `not-met` ⇒ the task is re-run once automatically in the same group with the judge's
   finding as the operator note (Part 1.4's mechanism, principal `system`). A second no-change ⇒ the task stops in
   Problems as "no change twice" with Part 1.4's revoke-style re-run and "accept as no change" (person or orchestrating
   agent) as the exits. `cannot-judge` ⇒ treated as `not-met`.
2. **Part 4 changes ccloop.** Authorised by handoff §5.3 ("需要时允许改" for sister repos) and added to §9's cross-repo
   list. Shape: the ccloop contract gains an optional `handoff: { inputDir, outputDir }` (both outside the worktree,
   Orca-owned, 0700); prompts of all three runtimes tell the agent to read `inputDir` first and, in its last phase, write
   `handoff.md` and `summary.md` into `outputDir`; ccloop does not count `outputDir` writes as changed paths and reports
   the two files (presence, bytes) in its collect report. `taskResult` schemas are not changed.
3. **Part 2.3: one input, an explicit hard flag.** A task's token amount is an expectation whoever set it (model,
   `system`, `complex-1m-default`, or a person). A person makes it a hard cap only by turning on a separate "hard cap"
   switch (default off) in the Web allocation form / `--hard` in the CLI; only then is it a cap without a pause line.
   Existing `human` provenance alone no longer means "hard".
4. **Part 6.3 path scope.** "Allow this kind in this group" grants exactly the path or pattern the request named —
   never widened by derivation (a concrete file grants that file; a pattern the agent asked for grants that pattern).
   "Same kind" for a path request therefore means "the same named path/pattern".
5. **Migration.** Part 2 (budget) and Part 3 (requirement review, which spends tokens) apply only to groups confirmed
   after the release that ships them; groups confirmed earlier keep today's rules and do not start a review. Parts 1, 4,
   5 and 6 apply to every group from the upgrade on (Part 1 only to runs that finish after it). A per-group marker
   records which model a group was confirmed under.

## 11. Correction (2026-11-12, same session, controller): one model marker, stamped at group creation

§10.5 said "groups confirmed after the release". The Part 2 plan needs the marker before confirm (an estimate writes a
task's expectation into the editable proposal), so the marker is stamped when the group is created
(`planImport.ts`, the only place a budget proposal is inserted), and Parts 1–3 read the same marker: one field
`modelVersion: "followup-g"` on the group body. Groups created before the release keep today's rules for Parts 2 and 3.
The Part 1 plan's `confirmedUnder` and the Part 2 plan's `budgetModel` are both replaced by it.

## Part C builder notes (plan 2026-11-12 part C, Orca session d1cbbd58, implementation seat; code at commit 5279d557)

Appended by the Part C seat; earlier sections untouched (Rule 13).

**Writers outside the repository (Rule 17).** All paths derive from `store.stateDir` or a run's `sourceDir`, so a test
that redirects the state directory touches no real one. Directories are created 0700 (`privateDirectory`), files 0600
(`writePrivateFile`, temp + rename); no existing file's mode is changed.

| Path | Written by | Residue on failure |
|---|---|---|
| `<stateDir>/groups/<g>/handoffs/runs/<run>/in/**` | the driver at A2 (`prepareRunHandoff`; rewritten whole, idempotent) | a stale `in/` of a run that never dispatched |
| `<stateDir>/groups/<g>/handoffs/runs/<run>/out/` | created at A2; the agent writes `handoff.md` / `summary.md` into it | the agent's files (kept after ingest; no removal yet -- a known gap) |
| `<stateDir>/groups/<g>/handoffs/{handoff,summary}-<task>-<run>.md`, `record-<task>-<run>.json` | the driver at stepC (`ingestRunHandoff`; record written last) and the driver-round live-note pass (`mergeUndeliveredNotes`) | the validated files without a record; the next ingest of that run redoes it whole |
| `<sourceDir>/live-notes.json` | the add-live-note command after its commit, A2 for the next run, and the driver-round pass (stale file repair) | a file one note behind the queue until the next pass |

**Decisions taken (each reversible).** As the part C plan's "Decisions" list, plus:
- The Live note box sits under each task Live shows (running work, or the most recent run); a task Live does not show
  (paused, waiting) takes a note through `orca task note`, and its queue reaches the next run's first phase.
- `add-live-note` moves the group revision like every group-targeted command (default `authorityChanged`).
- A run's handoff ingest happens in stepC before a token-allowance pause too; such a run is not `succeeded`, so a missing
  handoff writes no row.
- Orca sends `work.handoff` unconditionally (§10.5); the branch therefore lands only after ccloop C1-C4 are pushed and
  Orca is repinned (plan O7 step 4), as a pinned ccloop without C1 refuses the key.

## 12. Part 2 as built (2026-11-12, Part B implementation seat of session `d1cbbd58`; branch `worktree-agent-a0a0614c8181cf24a`, commits `7f608ad7..` on `e88588ce`)

What the budget part does on its branch, where it differs from the plan (`2026-11-12-tester-followup-g-part-b-budget.md`),
and what it does not do. Each choice marked **builder's call** is reversible and open to review.

### 12.1 Model and representation
- The marker is §11's `modelVersion: "followup-g"`; `expectationModelApplies` (`expectationModel.ts`) is the marker minus
  a flow run's hidden child (a stripped import keeps its task grant). Which model an import uses when its caller names none
  is `DEFAULT_MODEL_VERSION` (`planImport.ts`), **held at "no marker" on this branch**: flipping it turned 77 existing
  criteria in 30 files red (they pin what a group created before the release does, several through ports that predate
  the optional token policy). That flip -- and the rewrites it needs -- is left to the controller; Part A's unconditional
  stamp makes the same flip when the branches are stacked. `modelVersion: null` (in-process only) names a pre-release group.
- **Builder's call (differs from plan D4):** a task's amount is not copied into the proposal or the execution snapshot.
  An expectation-model import writes task work tokens `null` (allocations, token policies, work items); a person's amount
  lives on the work item as `tokenIntent: {tokens, hard, provenance, estimateId}` (set by `proposal-edit`, floored at
  1M unless `hard`), and an estimate is never applied to task work there: the expectation is the newest ready,
  non-stale estimate's task tokens, floored at 1M, read when needed -- as unlimited groups already derive theirs.
  Snapshot and envelope bytes of a group created before the release are therefore untouched.
- Refusals: `hard-cap-legacy-group`, `hard-cap-needs-tokens`, `estimate-advisory-in-expectation-group` (a new code, not
  the unlimited one: that one's words say "this group has no token limit").

### 12.2 Live ceiling (spec §2.1; D1-D3)
- A claim sends a null work token grant and `liveCeiling {protocol:1, revision, tokens, cause}` on the protocol-4
  envelope: min(group slice, pause line - inherited, hard cap - inherited); ties task-cap, pause-line, group.
- **Builder's call (differs from plan O2's ledger):** no table. The run body holds `liveCeiling {revision, tokens, cause,
  deliveredRevision}`; the group body holds `liveCeilingReserved`, the part of `group.reserved` that is the active runs'
  unused ceilings, re-derived from the active runs (`syncCeilingReserve`) at the claim, at every usage booking and on
  every driver pass. A run that ends is released on the next derivation without each settle path knowing about
  ceilings; between the end and that pass the reservation is over-held (the safe direction). Conservation counts it.
- Raises (`liveCeilingRaise.ts`): per pass, a finite expectation-model group with free headroom, no claimable task and no
  spend cap gives each running group-bound run `floor(H / runs)`, capped by its pause line or hard cap; written (so
  reserved) before `deliverLiveCeilings` calls ccloop's `live-ceiling`; delivered only on ccloop's answer or its
  `control-live-ceiling-stale`. The profile router now keeps `setLiveCeiling` on the port it hands out.
- set-limit and spend caps treat a ceiling-bounded run of a finite group as bounded. A top-up in an expectation-model
  group checks conservation against the new limit, so a stop that passed the cap by its in-flight request can be topped up.

### 12.3 Stops, pause and decision (spec §2.1, §2.5, §10.3)
- A `liveCeilingStop` with cause group or pause-line (exhausted, partial candidate) is settled recoverable with its
  candidate committed as checkpoint `ceiling-<run>`; the task continues from it on its next claim through the allowance
  path's `allowancePredecessorRunId`. Group cause: headroom >= 1M ⇒ ready at once; else `groupCapStop` until a top-up
  (set-limit continues it). Pause-line cause: `usagePause` until `usage-pause-decide`. Task-cap: exhausted as today.
- The pause line formula (`pauseLineFor`): k = 1: L null ? 10E : min(10E, floor(L/2)); k > 1, decided when the task had
  used u and the group G: L null ? 10kE : min(10kE, u + floor(max(0, L - G)/2)).
- `usage-pause-decide` (task target, access any; CLI `orca task decide-usage <g> <t> --decision continue|stop [--note]`):
  continue sets the next line (refused `usage-pause-no-headroom` when it leaves the task nothing) and delivers the note
  as the continued run's operator note; stop records `usageStopped`, the group goes on. `usage-pause-not-waiting`.
- Activity kinds: `group-cap-reached`, `usage-paused`, `usage-pause-decided`, `usage-over-expectation`.

### 12.4 Gaps (not built; plan D7 plus what this branch found)
- (a) Runs under a spend cap get no live raises (initial slice only). (b) Reconcile and goal-review runs keep reserved
  grants and ccloop's 1.2 threshold. (c) Single calls keep reserved grants. (d) claude's observation is a lower bound.
- (e) The overshoot bound is per running run: one in-flight request (claude/omp) or one codex turn each.
- (f) A ceiling stop whose archived snapshot is incomplete blocks the run by name (`live-ceiling-snapshot-incomplete`);
  no `groupCapStop` marker is written for it.
- (g) `set-task-loop` has no hard switch (loop tasks' work stays owned by their loop plan's work tokens).
- (h) A stopped task (`usageStopped`) stays blocked; the group does not reach done until a person retries or archives.
- (i) The board card names a pause or a cap wait per group (counts), not per task card.
- (j) Not run against a real agent: every criterion uses the synthetic ccloop or the control stub. The Orca pin is not
  moved: this branch runs against ccloop's local main build (`ORCA_CCLOOP_BIN`), and waits for the human's ccloop push
  and Orca's repin (plan O8) before it can merge.

## 13. Part 2 as built, follow-up H (2026-11-12, Part B seat of session `7e164691`; branch `worktree-agent-a0a0614c8181cf24a` rebased onto `ae68e2e0`)

Appended; §12 stands as written. What changed on the branch after it was rebased onto `main` (Part A's unconditional
marker stamp), and why. Each **builder's call** is reversible.

### 13.1 The gap: a run Orca dispatches for the group could not be funded
Claims split a finite expectation-model group's remainder among ready tasks and raises hand out the rest, so the running
live ceilings could hold all of it; a conflicting landing then blocked `reconcile-budget` (criterion H1 seen red). Closed
without lending the reconciliation tokens the cap does not have (**builder's call**: "reserve on demand" -- the controller's
option (b) applied only while a need exists -- rather than (a) lowering running ceilings, which needs an acknowledged
ccloop revision before the reserve may shrink and stops work mid-call):
- A run whose execution ended (`collected`, `reconciling`, `landed`, `settled`; its terminal report is in, so its work
  usage is final) holds no live-ceiling reserve: its unused share returns to the group for the reconciliation or goal
  judge its landing may need (`executionEnded`, `ceilingOutstanding`).
- No running ceiling is raised while such a run is still active (`planCeilingRaises`).
- `reconcileFunding` answers `funded` / `wait` / `short`. `wait` (fits once the running runs' unused ceilings come back)
  begins the reconciliation and keeps it in R with `fundingWait` on its record; claims leave that budget aside
  (`decideFundedAllowance`'s group binder). `short` blocks `reconcile-budget` as before. Groups without the marker answer
  as `reconcileAffordable` did.
- The reconciliation is funded in the write that marks its spawn, and a spawned, unbooked reconciliation is held in the
  group's reserve at its whole budget (`reconcileInFlight`, part of `liveCeilingReserved`) until its spend is booked; the
  driver's next re-derivation drops the hold (until then the spend is held twice -- the safe direction).
- The goal judge and the requirement review need nothing new: the driver's pass re-derives the reserve before those
  steps (a fresh re-derivation inside their funding was tried and removed: no criterion could see it red).
Criteria `tests/control/reconcileFunding.test.ts` H1-H7; mutations M1-M10b.

### 13.2 A second gap the flip measured: spend caps and an expectation-model run
`committedTokens` read every active run's remaining work grant; an expectation-model run has none, so any spend-cap check
threw `recovery-blocked:run-remaining-invalid` while one was active. Its commitment is now its live ceiling less what it
used (H8, M11).

### 13.3 The default flipped
`DEFAULT_MODEL_VERSION` is `followup-g` (Part A already stamped it on every group); `null` stays in-process only. The
criteria the flip turned red were classified one by one: those pinning a pre-release group's rules (finite or authored
task grants, their top-ups and exhaustion, estimates applied to task work, the unlimited group's refusal name, funded
grants as commitments) now name `modelVersion: null` or the new refusal name; the panel and benchmark fixtures' synthetic
ccloop now says `tokenPolicy: "optional-v1"` (as the pinned ccloop does); the import stored-bytes golden was regenerated
(exactly 12 task-work token fields, 100 -> null). Each rewrite is its own commit carrying the ruling.

### 13.4 Left open (not built)
- (k) A handoff-stopped expectation-model run whose usage is unknown settles `release-unmetered` (its work grant is null),
  so the unused ceiling is released rather than charged: the group cap is not hard for that run's unknown spend.
  `handoffStopUnknownUsage` "optional-v1, finite" stays red as the evidence; the fix (charge the unused ceiling) touches the
  settlement arithmetic and its acknowledgement names, and was not attempted here.
- (l) Two real-ccloop criteria pin token-allowance parking, which only a pre-release group does (`allowanceHeldSettlement`,
  `tokenPolicyRuntime`); the real-ccloop world imports through the service, which takes no `modelVersion`, so they were
  left red rather than given a new import path.

## 14. Follow-up H, second pass (2026-11-13, same seat; branch rebased onto `b177c19c`): §13.4 (k) and (l) closed

Appended; §13 stands as written, and its §13.4 "left open" items are superseded by this section.

### 14.1 (k) Unknown usage of an expectation-model run settles at its ceiling (ruling R4)
- **Arithmetic (builder's call, reversible):** such a run may have spent anything up to its live ceiling, so what its
  unknown usage could have cost is the ceiling's unused part, `ceiling.tokens - cumulative.work.tokens`. That part stays
  held in `liveCeilingReserved` from the moment it is unknown -- ended or not, active or not (a handoff-stopped run leaves
  `active`) -- until the usage is settled. The only admitted settlement is `charge-remaining-grant` (refusal name
  `finite-remainder` for any other); it books the whole unused part as used (marker method `remaining-grant`, charged
  work tokens = that part) together with the handoff remainder, and the re-derivation in the same write gives the hold
  back, so `used + reserved` is unchanged by the settlement and never passes the limit.
- `charge-observed-floor` is not admitted for such a run: booking the floor alone would release the rest of the ceiling as
  unspent, which R4 forbids. `release-unmetered` stays the path of a run with no ceiling (an unlimited group's run with
  no pause line).
- Criteria H9, H10 (`tests/control/reconcileFunding.test.ts`); mutations M12-M15, M16b, M17.

### 14.2 (l) Token-allowance parking criteria on a pre-release world
`importControlPlanAsync` now forwards the in-process `modelVersion` option `importControlPlan` already had (type only; no
payload field, route or flag). The real-ccloop world fixture takes a test-only `preRelease` option that imports with
`modelVersion: null`; `allowanceHeldSettlement` and `tokenPolicyRuntime`'s saved-allowance renewal use it, since parking
at a token grant exists only in a pre-release group. (Setting the marker off after import would not do: the import has
already written the task's work tokens as null.)

## 15. Follow-up H, third pass (2026-11-13, same seat; branch rebased onto `2fa541c8`): the stuck handoff is a ccloop race

`agentSelectionE2E` C3 failed intermittently once new groups used the expectation model: a handoff request stayed
`collecting` while its run stayed `accepted`. Cause, on the ccloop side (read only; identical at ccloop `9c2fbe47` and
`d5a4bd2`): `createLiveCeilingWatch` (`src/control/liveCeilingFile.ts` L86-112) sleeps between reads on an **unref'd**
50 ms timer (L105) and `stop()` (L110) wakes only the timer of the iteration that is sleeping. When `stop()` lands while a
read is in flight, the loop then arms a fresh unref'd timer that nothing wakes; the worker
(`src/control/worker.ts` L356-359, `onRunSettledBeforeLeaseRelease`: handoff watcher stopped, then
`await liveCeilingWatch?.stop()`) has nothing else keeping Node's event loop alive, so the process exits silently before the
candidate is persisted or the worker sealed -- no `candidate.json`, no `worker-error.json`, pid gone. Only a run whose
envelope carries `liveCeiling` starts the watch, which is why the flip exposed it. Smallest ccloop fix: `if (stopped)
break;` right before arming the sleep timer (or not unref'ing it). Evidence: a standalone repro exits 5/5 before `stop()`
resolves and resolves with the one-line fix; C3 against a ccloop copy whose watch read is slowed by 45 ms fails 2/2 on this
branch, passes 2/2 with the fix added, passes 2/2 on `main` (no ceiling). No Orca change: the branch waits for that ccloop
fix and a repin.

## 16. Follow-up I (2026-11-13): an expectation-model run's unknown usage may settle at the observed floor

Appended by implementer seat F of tester follow-up I (Orca session `d467cbd2`), on the branch
`worktree-agent-a86417d89fd981a2c` (commit `afad7548` on `8fe365ad`). §14.1 stands as written; on the one point below it
is superseded.

- **Ruling.** The human asked of §14.1's arithmetic: 「感觉不合理，扣一半是不是比较合适？」. The controller recommended
  not half (half is neither a provable floor nor a safe ceiling) but: keep holding the whole unused ceiling while the usage
  is unknown (it protects the hard group cap, R4), and at settlement also admit `charge-observed-floor` with an explicit
  acknowledgement when ccloop reported an observed floor -- the shape tester follow-up F gave finite groups for #116.
  Human: 「Part B 的结算算术 => 按你的建议走」.
- **Supersedes** §14.1's "the only admitted settlement is `charge-remaining-grant`" and its "`charge-observed-floor` is
  not admitted for such a run". Everything else in §14.1 holds: the hold while unknown, `charge-remaining-grant`'s
  arithmetic, and `finite-remainder` for `release-unmetered`.
- **Admission.** As the finite path (tester follow-up F §2): the explicit `acknowledge: "charge-observed-floor"` only,
  from a person or a socket agent without a token (never a run Orca dispatched); a run with a live ceiling counts as a
  finite remainder for it. No floor (`usageLowerBound` absent): refused `run-usage-not-settleable:observed-floor-unknown`,
  nothing written, the ceiling stays held; the CLI hint names `charge-remaining-grant` (or waiting). Never automatic:
  the view's default `acknowledge` stays `charge-remaining-grant`, the floor is an offer beside it
  (`unknownUsageSettlement.observedFloor`).
- **Arithmetic.** By `bookObservedFloor` unchanged: charged work tokens = the floor F (other dimensions 0), the run's
  cumulative becomes B + F (never below what was booked), `used += F`, the run is marked `usageApproximate`, marker
  method `observed-floor`. The re-derivation of the ceiling reserve runs in the same write: the run's usage is no longer
  unknown, so its held unused ceiling U leaves `liveCeilingReserved` and `reserved`. For a handoff-stopped run (disposition
  `recovered`, optional-v1) the handoff remainder H is released as any recovered settlement releases it. So
  `used + reserved` moves by `F - U - H`: below its old value whenever F < U. A floor above U is booked as it stands
  (observed usage is not capped), the same as the finite path; the group then reads over its limit by what was observed.
- Criteria I1-I4 (`tests/control/ceilingObservedFloor.test.ts`); mutations M1-M6 all seen red
  (`/private/tmp/orca-i1113/seatF/mutations.md`). No existing criterion pinned the refusal (H9 pins
  `release-unmetered` → `finite-remainder`, unchanged), so none was rewritten.

## 17. Follow-up I, seat K (2026-11-13): a worker-lost run's floor, and the settled run's readability

Appended by implementer seat K of tester follow-up I (Orca session `d467cbd2`). §14.1 and §16 stand as written, except:
a worker-lost run that observed usage has the observed floor 0 when ccloop wrote none (its dead worker could not), so
`charge-observed-floor` is admitted for it; a worker-lost run's `charge-remaining-grant` charges tokens only; and the
settled run keeps a null work token remainder (the old stored 0 is read). Details: worker-lost recovery spec
(2026-11-12), "Correction (2026-11-13, tester follow-up I, implementer seat K …)".

## 18. Follow-up I, seat L (2026-11-13): "continue" after a mid-phase stop, the blocked run nobody saw, and the 1M floor

Appended by implementer seat L of tester follow-up I (Orca session `d467cbd2`, Claude Opus 5.5; branch
`worktree-agent-a0ba926ac7655137a`, commits `d7cfa747`, `7cf26b8f`, `8a50284b` on `bcb6d815`). §12.3 ("the task is ready
again and continues from its stopped run") and the O4/O5 commits stand, corrected as follows.

Measured (the controller's paid dogfood run, group `g-28d9b560`, read-only from the panel database): codex run
`run-b89650fe…` stopped at its pause line (2,000,000) at an execute boundary. Its committed checkpoint
`ceiling-run-b89650fe…` names `attempts/1/execution.json` and `attempts/1/verify.json` missing, so commitCandidate stored
`recoverable: false` (§6.3 ruling of 2026-09-22: only a complete checkpoint is continuable) -- while classifyCeilingStop
still pointed `allowancePredecessorRunId` at it. `task decide-usage … --decision continue` then claimed `run-4c75c470…`,
whose A2 called exportResumeBundle on that predecessor and blocked `resume-predecessor-unrecoverable` (0 tokens used);
`recovery retry --run` re-ran A2 into the same refusal; `task retry` and `group close-run` named recovery retry; recovery
list and `recoveryBlockerCount` were empty.

1. **Resume or fresh start (A).** A2 continues from the allowance predecessor (a live-ceiling stop's or a token
   allowance's) only when it meets exportResumeBundle's own precondition: settled or settled-recoverable, `recoverable`,
   a checkpoint id. Otherwise the run is prepared fresh: base the group's work branch, no input checkpoint, priorFailures
   built as for any fresh run, the run's handoff directories (dependencies' handoffs and the previous attempt's summary),
   live and operator notes; the stopped run's workspace is removed as a continued predecessor's is (its archived snapshot
   stays). This covers every route into such a claim: decide-usage continue, the group-cap auto-continue, a set-limit
   top-up. A complete checkpoint is still resumed. A multi-directory group is unchanged (it refuses continuations by
   name, `multi-dir-continuation-unsupported`); not built.
2. **No silent blocked run (B).** The recovery view gains `blockedRuns` -- every current work run blocked where
   `recovery retry --run` resumes it (driveRecord `resumableBlockedRun`: blocked anywhere but a ccloop failure at C) --
   with `blockedAt`, `reason` and `next` (`orca recovery retry --run <r>`). The group summary's `recoveryBlockerCount`
   counts them too; `claimBlocked` does not (they hold no other task's claim). A run the old driver left blocked as in
   the measurement is started fresh by that retry (item 1), so the real `run-4c75c470…` needs no database edit.
3. **The expectation was not lost (C).** `orca group apply-estimate` recorded the estimate (search: 150,000), and the
   task's expectation is that estimate floored at 1,000,000 -- §2 item 2 (#266), `EXPECTATION_FLOOR_TOKENS`; no person
   amount (`tokenIntent`) was stored. First pause line `min(10 × 1M, 4M / 2) = 2,000,000`; the continue's line
   `min(20M, 2,093,082 + ⌊(4,000,000 − 2,970,713) / 2⌋) = 2,607,725`, both as measured. Only the apply-estimate line misled:
   it now adds "an expectation is at least 1000000, so its pause line counts from 1000000" (`floorTokens`, only-add).
   (The 2,093,082 includes 1,932,240 booked by the earlier worker-lost settlement under the charging seat K corrected.)
4. **Retry wording (D).** A retry receipt's `nextRun` gains `because`: `no-token-limit` (§E8 fresh start) or
   `worker-lost` (worker-lost recovery spec §5.4 credit); the CLI line names that reason.

## 19. Correction (tester follow-up J, 2026-11-13): no pause line in an unlimited group; the continue's next line

Recorded by the P0 implementation seat of Orca session `c8b75eac`, on branch `j/p0` from main `ef48cb04`. §2 item 7 and
§12.3 above are kept as written; where they disagree with this section, this section holds.

1. **An unlimited group has no pause line (#300).** Human ruling, session `c8b75eac`: 「#300 => 无限制组不要暂停线」. §2 item 7's
   "an unlimited group has no group limit, so the pause line there is 10× the expectation only" no longer holds: a group
   whose token limit is null has no pause line at all. `pauseLineFor` answers null when L is null (§12.3's
   `L null ? 10E` / `L null ? 10kE` branches are gone), `pauseLineOf` answers none, so a claim's live ceiling never has
   cause `pause-line` there; with no spend cap and no hard cap the claim carries no live ceiling (as a task with no
   expectation already did). The expectation itself, the over-expectation hint and a person's hard cap are unchanged. A
   task already waiting at a pause line in such a group (paused before this) may still be decided; a continue there
   sets no next line. Groups with a finite limit are unchanged. Criterion: `tests/control/usagePauseDecision.test.ts`
   "a task with an expectation in an unlimited group has no pause line".
2. **The continue's next line is above what the task used (#305).** §2 item 5 left the formula to the builder; §12.3's
   "continue sets the next line (refused `usage-pause-no-headroom` when it leaves the task nothing)" refused for good a
   task whose run overshot its line past the next multiple too (ccloop stops a phase at a boundary or between turns).
   The continue now takes k = max(k + 1, ⌊used / 10E⌋ + 1) -- the first multiple of 10E above the task's whole-lineage
   use -- still capped at u + ⌊max(0, L − G) / 2⌋. Only when that cap holds the line at or below what the task used is
   it refused, as `usage-pause-group-headroom` (detail `<line><=<used>:orca group set-limit <g> --limit <a higher
   limit>`); `usage-pause-no-headroom` is left for a task with no expectation. Criterion:
   `tests/control/usagePauseDecision.test.ts` "continue after an overshoot past the next multiple".
