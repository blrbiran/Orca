# Review exit, over-grant in unlimited groups, start queue, no automatic estimate when unlimited (D1–D4)

Session 3cfc2e73 (Orca dev, 2026-11-05). Written on Orca main `606b2ebd`. Source: the tester's dogfooding issues #127,
#128, #129, #137, #145, #160, #161 (`orca_archived_files/issue-20261023.md`), triaged against Orca 3cdced36 in
`.superpowers/sdd/2026-11-05-session-3cfc2e73/triage/A-state.md` and `B-estimate.md`. Revision 2 after an independent
review (session 3cfc2e73, findings 1–20 in the scratchpad file `review-spec-D1D4.md`, resolutions in §6).

**Implementation requires, merged first:** `fix/start-gate-and-blocked-reason` (paused groups hold no slot,
`group-dependency-unmet`, D14 `blockedReason`, goal-review wording) and `fix/estimate-plan-split` (`orca group
apply-estimate`, #147 refusal of an estimate on a confirmed proposal).

## 1. Human rulings

The human's words (verbatim, session ledger `progress.md`): 「D1-D8其余都同意。」 (all except #70; and earlier
「这个session允许改写必要的判据」). The recommendations they accepted, as put to the human (verbatim from the controller's
message):

- **D1** 「组里所有任务都完成并落地后，组自动变成 `done`，不再占槽位。组里没有在跑、也没有能派的任务时（比如剩下的任务都在等人
  处理），不占槽位，但组仍留在需要人处理的位置。目标评审仍然延后。」
- **D2** 「组不限 token（soft 或不限模式）时，task 超额只记录并在面板提示，组不卡住，其他任务照常跑。组有上限时仍然卡住，但允许在
  卡住状态下提高额度或上限，然后继续。」
- **D3** 「不加强制。`group confirm` 在额度是默认不限、又没有应用估算时，在输出里明确写出来。不限模式的组不再自动估算，人需要时手动跑
  `orca group estimate`，再用新加的 `group apply-estimate` 应用。」
- **D4** 「上限满了时，显式 start 进入排队，有空位就自动开跑；回复里写明『已排队，前面有几个』。」

Decisions below that go beyond these words are marked **[controller, Rule 1 rung 2]** (reversible) and listed for the
human in §6.

## 2. What each ruling overrides (named; each overridden spec gets a Correction section at implementation, Rule 13)

- **D1** overrides kanban spec `2026-10-20-kanban-and-group-orchestration-design.md` §S2 "A group holds a slot while
  running, in review, or ready and executing" and narrows web-recoverable spec `2026-09-19-web-recoverable-control-design.md`
  line 884 ("V1 does not … move the group to `done` on the operator's behalf"). D14 (empty result ⇒ work blocked) is kept.
- **D2** overrides tester-round2 spec `2026-10-24-tester-round2-design.md` §4.2.1 item 1 ("A breach by a work, handoff or
  other single-call run still blocks as before") for groups with no token limit, extending H2
  (「…超上限之后仅提示用户异常而不是卡住不让做。」) from estimate runs to every run there. The controller ruling "Final review I1"
  (`checkpoints.ts:101-102`: a budget-blocked group stays blocked through a settle) is kept for limited groups.
- **D3** keeps token policy choice A and H4; it changes when the automatic estimate is queued.
- **D4** fills a gap (kanban §S2 defines the cap for the automatic start only) and overrides kanban §S2 "Any `start` or
  `resume-dispatch` records the group as started" for a queued start: it is recorded as started when it actually starts.

## 3. Design

### 3.1 D1 — group done, and who holds a slot

- **Done (a pump pass, code, Rule 5).** Each round, after the integration, placement and landing passes: for every
  non-archived Web group with `planHash`, status `review` or `running`, no active run of any phase and no stop intent, if
  `prerequisiteDone(store, id)` holds (`groupEdges.ts:75`: every task `done`/completed, plus by delivery — `local`:
  integration idle, integrated, nothing pending; dir group: placement caught up; multi group: landing `landed`;
  `keep`/`push-branch`/`github-pr`/`push-target`: nothing more), set `status = "done"` in one transaction with an activity
  row. A pass rather than a hook in `commitCandidate`, so it also covers `repairAcceptedWork` (`checkpoints.ts:128-142`),
  the later integration/placement/landing settles, and the groups already left in `review` before this change (no
  migration needed for them). A `blocked` group is never touched (Final review I1).
- **Slot.** `runningGroupIds` (still one SQL statement: `orchestration.ts:117-119`, bound by
  `tests/bench/controlPollPerformance.ts` / `tests/control/controlPollBenchmark.test.ts`) counts a non-archived, non-paused
  group when (a) it has an active run of any phase, or a task in `BUSY_WORK`; or (b) its status is
  `ready`/`running`/`review`, it has no group-scope recovery blocker and no recorded spend-cap or claim-capability block,
  and it has an undelivered `start`/`no-start`/`resume` wake, or a `ready` task whose `dependsOn` are all `done` and that has
  no active run (the test `nextClaimableTask` applies, `webDispatch.ts:381`). A wake delivery keeps pending for a spend cap,
  a capability blocker, unknown usage or a null funded allowance (`webDispatch.ts:271-296`) holds no slot: it waits for a
  person. Flow children keep holding none (`orchestration.ts:126`).
- **Regained work [controller, Rule 1 rung 2].** A started group that holds no slot and regains claimable work (retry,
  continue, resume-from-handoff, resume-dispatch, verify-saved-result, D2's unblock) **waits for a slot**:
  `replenishStartWakes` (`executionDriver.ts:1333-1343`) arms its wake only while `running < cap` (debug groups first, flow
  children exempt, as in the auto-start pass). Reason: D4 makes the cap hard for starts; letting regained work over it
  would reintroduce #129 through another door.
- **System verdict groups [controller, Rule 1 rung 2].** A criteria-review judge or ladder group whose verdict is a
  D14-blocked task never meets `prerequisiteDone`; it holds no slot (above). It becomes `done` once its verdict is
  recorded (the verdict is its outcome, protect-acceptance-criteria spec lines 169-174 "settled by its run"); the builder
  names the predicate per kind from the settle code and pins it with a criterion.
- **Readers of `group.status` that see `done` (checked, review finding 12).** `schedules/pass.ts:36` — a `done` group no
  longer counts as active, so the next scheduled fire is not skipped for overlap (intended: the previous fire is
  finished); `fundedAllowance.ts:70`, `webService.ts:267,301,1934,2008`, `groupEdges.ts:125`, `executionDriver.ts:1306`,
  `orchestration.ts:128,163`, `estimateRetry.ts:50`, `budget.ts:121` (legacy), `web/src/LoopPlanCard.tsx:187`,
  `web/src/groupCategory.ts:84` — all already treat `done` as started/closed/not dispatchable. Flow child status reads the
  work item (`flow/childPort.ts:143-161`). Archive has no status gate (`archiveGroup.ts:39-50`). `done` is already valid in
  every schema (`types.ts:69`, `webProtocol.ts:1460`, `controlViews.ts:96`, `en.ts:49`).
- **UI.** The Board's done column already uses `completion.done === total`; a `done` group never shows the goal-review
  wording (narrowed on `fix/start-gate-and-blocked-reason`).

### 3.2 D2 — over-grant

- **No token limit** = `group.limit.tokens === null`: the same predicate as soft-mode spec `2026-11-03` §2, auto-confirm
  condition 2 (`autoConfirm.ts:58`) and schedule rule 5 (`schedules/pass.ts:211`). It is not `budgetMode`. Flow children
  (finite drawn limit) keep the block.
- **"Over its grant"** = any dimension of the run's grant (`usage.ts:41-48`; tokens, activeMs, attempts, sessions).
- **Group with no token limit:** no dimension's breach sets `group.status = "blocked"`. The breach stays recorded on the
  run (`RunViewV1.overGrant`, already on the wire, `webProtocol.ts:1781-1784`). Detail view: a `role="status"` line per
  non-estimate run with non-empty `overGrant` in a group that is not blocked (new en/zh key; `GrantBanners` today names
  one only when blocked, `ControlGroupView.tsx:285`). Board **[controller]**: a new `overGrant: boolean` on the strict group
  summary schema, shown as a warning chip on the card. The run's own grant inside ccloop is unchanged; whether a
  continuation/handoff of a breached run is then funded (`usage.ts:38` clamps `remaining.work` to 0;
  `continuation.ts:47-50`, `fundedAllowance.ts:84`) is traced by the builder and stated in the plan with a criterion.
- **Limited group (block kept), exits:**
  - `set-limit` accepts a `blocked` group when every recorded block reason is an over-grant breach (today it refuses
    `blocked`, `webService.ts:1934`). On success the status is set by rule, not by memory: an active run ⇒ `running`; else
    D1's done rule ⇒ `done`; else `review`. Whether the new limit "covers" anything is not checked — the person raising it
    is the authorisation; its existing conservation checks still apply (`webService.ts:1937-1940`). An unchanged limit is
    still `no-op-command`.
  - `retry-task` gains an optional `work` grant (`{tokens, activeMs, attempts, sessions}`, `set-task-loop`'s bounds),
    accepted when the group is `blocked` by an over-grant breach of that task's run; it replaces `work.grant.work` before
    the `authored-budget-exhausted` check (`retryTask.ts:159`) and, on success, clears the group block by the same rule as
    `set-limit`. Strict-schema change to the raw and effective `retry-task` commands (`webProtocol.ts:803,1200,1299`), the
    CLI `task retry` flags (`--work-tokens` etc.) and the error catalog. Today the non-optional retry resets the work but
    leaves the group blocked (triage #161); that is fixed by the same rule. A succeeded over-grant run has nothing to
    retry: its group's exit is `set-limit`.
  - The non-Web branch (`group.stopped = true`, `usage.ts:48`) is unchanged.
- **One-time repair (migration).** The control DB is backed up first (as every upgrade does). Every `blocked` Web group
  with `limit.tokens === null` whose only block reasons are over-grant breaches gets its status set by the rule above, plus
  a `statusRepairs` entry `{from:"blocked", cause:"over-grant-unlimited", runIds, by:"migration-N-to-N+1", at}`, following
  the estimate-breach precedent (`migrations.ts:296-338`, savepoint per group).

### 3.3 D3 — confirm wording, and no automatic estimate when unlimited

- `orca group confirm` (human output) prints per task `tokens: unlimited (default, not estimated)` when the task's token
  provenance is the default and no estimate was applied, then the path to an estimate. The rows come from the proposal
  `confirmPayload` already reads (`commands/domains/work.ts`); the confirm result itself carries no allocations
  (`webProtocol.ts:2084`). `orca group show` and `orca proposal show` print the same line, so an auto-confirmed group says
  it too. JSON of the confirm result unchanged. The Web confirm already shows provenance; no Web change unless it hides it.
- Import (`planImport.ts:486`) and requirement-accept (`requirementCommands.ts:412`), including schedule-fired imports, queue
  no automatic estimate when the group's token limit is null (the existing `estimate: "deferred"` path,
  `planImport.ts:289-293`). Limited groups keep it. An explicit `group estimate` still works, and its one automatic retry of
  a failed answer (`estimateRetry.ts`) stays.
- **Contract:** `imported.estimateId` and `requirement-draft-accepted.estimateId` become `idSchema.nullable()`, and
  `estimateState` gains `"none"` (`webProtocol.ts:2066-2071,2208-2214`; `web/src/controlTypes.ts:694`; every CLI/Web reader
  of those fields changed in lockstep).
- **Path to an estimate for a confirmed group** (H4 confirms an unlimited group as soon as nothing blocks,
  `autoConfirm.ts:57-73`; an estimate needs an unconfirmed proposal, `webService.ts:534,555`, and #147 refuses one on a
  confirmed proposal): reopen the proposal (`proposalReopen.ts`), `orca group estimate`, `orca group apply-estimate`,
  confirm. The confirm/show line names this path. Auto-confirm is unaffected: condition 7 (`autoConfirm.ts:68`) waits only
  for a running estimate, and none is queued now.

### 3.4 D4 — explicit start queued at the cap

- The cap is checked inside `scheduleStart`'s `apply` transaction, last, after every existing refusal (clarifying, pending,
  state, `group-dependency-unmet`, export, graph version, usage unknown, stop intent, estimate in flight, probe): a group
  that cannot start is refused, not queued. Flow children (`flow.role = child`) are exempt, as in the pass
  (`orchestration.ts:201`). The check applies to every actor, `orca-auto` included; the pass's pre-check stays an
  optimisation, and a pass start that loses the race gets `queued-for-slot`, which the pass treats as "not started, no
  refusal recorded". The resume path for a group never started (`startSchedulerWake`, `stopIntent.ts`) does the same.
- When queued: record the group as wanting to run (`group_orchestration.mode = run`, `hold` cleared). No orchestration row
  ⇒ write one with `confirmRevision` = this command's revision and `startedRevision: null`. An existing row keeps its
  `refusal` (the pass's command id `orca-auto-start-${confirmRevision}-${attempt}` counts attempts from it,
  `orchestration.ts:206-208`). The later start is `orca-auto`'s; its activity row names the person's queued command id.
- `ahead` = groups sorted before it in the pass's order (`orchestration.ts:198`) whose state would be `eligible` with a free
  slot (now `waiting-slot`); groups in backoff are not counted. A snapshot: a debug group confirmed later can still go first.
- **Contract:** `commandResultSchema` gains `{kind:"queued-for-slot", operation:"start"|"resume-dispatch", ahead:safeInteger}`
  (202), and so does `web/src/controlTypes.ts:698`. CLI prints "queued: N ahead; it starts when a slot frees (orca
  orchestration show)"; the Web Start button shows the same line (en/zh keys).

### 3.5 Protocol changes in one place (all Orca, strict zod; no ccloop contract change)

`retry-task` payload `work` grant (§3.2); `imported` / `requirement-draft-accepted` nullable `estimateId` and
`estimateState: "none"` (§3.3); `queued-for-slot` result (§3.4); group summary `overGrant: boolean` (§3.2). Each changes the
server schema, `web/src/controlTypes.ts`, and the CLI reader together.

## 4. Criteria (each a command that exits 0/non-0; each seen red on its named mutation, Rule 4/9)

Run as `./node_modules/.bin/vitest run <file> -t "<name>"`. File names are proposals; the builder may place a case in an
existing file and records the final file/name in the plan ledger.

D1
1. `tests/control/groupDone.test.ts` "a local-delivery group whose tasks land and integrate ends done" — mutation: drop the
   pass's `status = "done"` write. "…with integration still pending stays review" — mutation: drop the integration clause.
2. same file, "a dir group reaches done only after placement catches up" and "a multi group only after its landing is
   landed" — mutation: drop the dir / multi clause.
3. same file, "an all-done review group from before the change reaches done without a new checkpoint" — mutation: run the
   pass only after a checkpoint.
4. same file, "a budget-blocked group is not moved to done" — mutation: drop the `blocked` guard.
5. same file, "a done group is not re-armed by replenishStartWakes" — mutation: add `done` to the dispatchable states.
6. `tests/control/orchestration.test.ts` "with cap 1 a review group whose only task is blocked does not stop another
   group's auto-start", "…a review group with a ready task does", "a spend-capped pending wake holds no slot" — mutations:
   restore counting every `review` group; count any pending wake.
7. same file, "regained work in a slotless group waits while the cap is full" — mutation: arm the wake without the cap check.
8. `tests/control/controlPollBenchmark.test.ts` stays green (single-statement bound) — mutation: split the query per group.
9. a judge/ladder verdict case per kind (builder names it) — mutation: drop the verdict predicate.

D2
10. `tests/control/estimateBreachAdvisory.test.ts` C2 rewritten: "an unlimited group's work-run breach leaves it
    dispatchable and shows overGrant" — mutation: restore `group.status = "blocked"` at `usage.ts:48`. New: "a limited
    group's work-run breach still blocks" — mutation: apply the exemption to all groups. New: "an activeMs breach in an
    unlimited group does not block" — mutation: exempt only the tokens dimension.
11. `tests/control/overGrantExit.test.ts` "set-limit on an over-grant-blocked limited group unblocks it to review and
    dispatch resumes" — mutation: keep refusing `blocked`. "retry with a raised work grant clears the block" — mutation:
    ignore the payload grant. "set-limit is refused when a block reason is not an over-grant" — mutation: drop that check.
12. `tests/control/migrations.test.ts` "the migration repairs an unlimited over-grant-blocked group and leaves a limited one
    blocked" — mutation: drop the `limit.tokens === null` filter.
13. continuation/handoff funding after a non-blocking breach (builder states the behaviour) — mutation named in the plan.

D3
14. `tests/control/planImport*.test.ts` "importing into an unlimited group queues no estimate and the result parses with
    estimateId null, estimateState none"; "a limited group still gets one" — mutation: drop the null-limit condition.
15. requirement-accept and a schedule-fired unlimited import queue none — mutation: apply the rule only in planImport.
16. `tests/commands/*` "confirm's and group show's human output name the unestimated default and the path" — mutation: drop
    the line.

D4
17. `tests/control/startQueue.test.ts` "with the cap full an explicit start answers queued-for-slot with ahead and starts
    once a slot frees, never exceeding the cap" — mutation: skip the cap check.
18. same file, "a flow child is never queued" — mutation: drop the exemption; "group-dependency-unmet wins over queueing" —
    mutation: check the cap first; "a group with no orchestration row queues and starts" — mutation: skip writing the row.
19. same file, "a concurrent pass start and person start never exceed the cap" — mutation: check the cap before the
    transaction.
20. a Web test: the Start button parses and shows `queued-for-slot` — mutation: drop the result kind from the Web union.

Known pins to rewrite (human: 「这个session允许改写必要的判据」; each listed in the plan ledger as file:line old → new with
the rule it now pins): `tests/control/estimateBreachAdvisory.test.ts:56` (C2); slot cases in `tests/control/orchestration.test.ts`;
review-after-settle in `tests/control/checkpoints.test.ts`; `tests/control/finalReview.test.ts` I1 (kept for limited
groups — rewrite only if its fixture group has a null limit).

## 5. Out of scope

Goal review runs; a first-class "no change needed" outcome (would touch ccloop's terminal outcome); #70 UI layout (human:
「暂时不动…」).

## 6. Review round 1 (independent reviewer, session 3cfc2e73) — resolutions

All 20 findings accepted. 1 → `retry-task` `work` grant (§3.2). 2 → result contract (§3.3). 3 → done is a pump pass
(§3.1). 4 → slot gates named (§3.1). 5 → regained work waits **[controller]** (§3.1). 6, 7 → transaction placement,
row/refusal/actor/contract details, kanban override named (§3.4, §2). 8 → limited-group exit by rule (§3.2). 9 → migration
(§3.2). 10 → reopen path and branch dependency (§3.3, header). 11 → §4 rewritten as commands with mutations, missing cases
added. 12 → readers and pins listed (§3.1, §4). 13 → §1 split into verbatim words and the verbatim recommendations. 14 →
predicate cited (§3.2). 15 → detail line + Board flag **[controller]** (§3.2). 16 → `ahead` defined (§3.4). 17 → rows from
the proposal; show prints it (§3.3). 18 → base and dependencies (header). 19 → verdict groups done **[controller]**
(§3.1). 20 → estimate retry stays; funding traced by the builder (criterion 13); protocol list (§3.5).

**For the human (reversible controller decisions):** regained work waits for a slot; verdict groups become `done`; the
Board gets an over-grant chip.
