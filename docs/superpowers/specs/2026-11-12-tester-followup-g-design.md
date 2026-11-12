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
