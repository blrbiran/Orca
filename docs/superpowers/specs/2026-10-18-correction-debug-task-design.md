# A correction opens an independent debug task

Orca session `a3b2a7a7` (Claude Code interactive session, not an orca run), 2026-10-18. Observation anchor: Orca
`main` at `555fb232`. Supersedes, for this path only, part of corrections-store spec
`2026-09-06-corrections-store-and-writer-design.md` §1 row 4 (ruling 4); see §6. The earlier handoff idea "feed
corrections into every later task's input" is dropped (§2).

## 1. Problem

`orca correct` records that a human overturned a ledger decision, and in its closing mode writes two ledger rows (a new
`decision` and an `overturned`). Nothing ever changes the code: the decision the human refused is still what the repo
does. Measured on the anchor: `deriveFixRunId` (`src/corrections/fields.ts:77`) only names the ledger file
`.decisions/orca-fix-….jsonl`; no work item, group or run is ever created from a correction
(`src/scheduler/runId.ts:34`: "is not a scheduled task"). Today only `src/metrics/` reads corrections.

## 2. Rulings (verbatim)

The controller proposed that a correction becomes a debug task an independent agent runs. The human answered, in chat
on 2026-10-18:

- 「纠正应该派到一个独立的 debug task 的 agent 中，基于此你分析一下怎们做最好」 — the premise of this document.
- On who writes `undo.how`: 「人写是optional，人不愿意写就由 agent 写。」
- On which agent runs the debug task: 「应该说默认还是原来的 agent 和模型，但是人可以选择换其他 agent 和模型。但是要在不同session中。」
- On feeding corrections into every later task's input: 「同意你的建议」 (the recommendation was: do not; the debug task
  replaces it).
- The operating principle, recorded in `docs/handoff/goal.md` §1.1: 「我整体的思路是orca的整体操作要简单，agent
  能帮人做的就尽量帮人做掉，尽量不要让人填东西。但是保留人修改默认值的能力。」

After the builder check (§9a) two more questions went to the human, each with a recommendation: (1) let a correction
name a finished task's run, not only a ledger decision, with a "correct" button beside the task in the panel; (2)
close a correction only once the fix is integrated into the target, with a "fixed, awaiting merge" state until then.
The human answered, verbatim:

- On (1): 「同意，但是这个当前基本无效，因为人可能不清楚哪个具体task / group 有问题。但是现在的 group / task
  的决定要记录在 decision 中的这条路也要尽快接好。」
- On (2): 「合入才算关闭，具体合入方法根据人选的方法决定。如果当前agent 合入有问题，那就需要解决这个问题。」
- On the extra waiting state: 「这个不能接受」.

Everything below that is not one of these quotes is design; the controller's own calls are marked as such.

## 3. What happens

1. A human records a correction (CLI `orca correct` or the panel; both go through `recordNewCorrection`,
   `src/corrections/record.ts`). Nothing about recording changes. `--chose-instead`/`--undo-how` stay optional
   everywhere they are optional today, and `not_my_taste` still requires `chose_instead` (schema rule, unchanged).
2. Orca opens **one debug group per correction**, in code, with a generated plan holding one task (§4). Opening is
   free: no model call. Opening the same correction twice returns the existing group (idempotent on `correctionId`).
3. The group waits for the human. The human sees it in the panel like any group and presses the existing buttons
   (estimate, confirm, start). The human can change the defaults before confirming: agent, model, write set, goal text.
   No field must be filled in.
4. The debug agent runs in a fresh session: reproduce, then fix (§4.3).
5. When the fix lands on the group's branch, Orca writes the closing ledger rows onto that same branch in code (§5),
   with the human's `chose_instead`/`undo.how` if given and the agent's otherwise. The group then integrates exactly
   like any other group, by the integration scheme the human chose for it. There is no extra state: the correction
   **is closed when its closing rows are reachable from the integration target**, which is the moment the fix is.

### 3.0 What a correction can name (human's ruling, §2)

- **A ledger decision** (`<runId>/<n>`), as today.
- **A finished task's run** (new): a "correct" button beside a finished task in the panel. The correction row then
  carries the run id instead of a decision id; the corrections store's schema widens to "exactly one of `decisionId`,
  `runId`" (`src/corrections/schema.ts` says the store is deliberately migratable). The repo is the run's group's repo,
  so no `projectKey` lookup is needed.

The human noted this is of little use today, because a person often cannot tell which task or group is at fault, and
asked that recording group/task decisions into the ledger be wired up soon (§10: a separate design, high priority).
Today no control run writes ledger decisions: the only writer is the scheduler's `ledgerWiring.ts`, and control plans
carry `ledgerMode: "out-of-repo"`, which `src/scheduler/run.ts:649` refuses as not implemented. Measured:
`grep -rn "appendEvent" src` (only `src/scheduler/ledgerWiring.ts` uses it outside the ledger module), and this repo's
`.decisions/` holds 20 files, all `orca-dev-*`, last changed `ab49c1f9` (2026-09-16).

The human's manual `orca correct --close` stays available and is unchanged; it is the override, not the default path.

### 3.1 Trigger (controller's call)

A new control command verb, working name `correction-debug-open {correctionId}`. Access "any" in `VERB_ACCESS`
(`src/panel/humanOnly.ts`), like `import-plan`, since it spends nothing.

- Panel: recording a correction sends the verb right after the row is stored. If the verb fails, the correction stays
  recorded and the panel shows the verb's error with a retry button. A failed open never undoes a recorded correction.
- CLI: `orca correct` sends the verb through `controlSend` (`src/entry/operations.ts:33`) when the control service is
  reachable. When it is not, the CLI prints the one command that opens it later and exits with the correction's
  normal code. The correction is the human's data and its success does not depend on the service.

## 4. The generated debug group

### 4.1 How it is built (controller's call)

Like `applyRequirementDraftAccept` (`src/control/requirementCommands.ts:192-257`): an in-memory `ControlPlanV1`
through `normalizeControlPlan` and `writeImportedPlan` (`src/control/planImport.ts:243-258`), with the contract
inline (`originalContractCanonicalJson` + hash). It does **not** go through `import-plan`'s file allow-list
(`resolveTarget` only accepts plan files listed at config time; there is no `addPlan`). Building the plan is a
deterministic transform of stored rows (Rule 5): no model call.

Group identity carries the correction: the group records `correctionId`, so idempotency is a lookup, and the panel can
label it as a debug group.

### 4.2 What the debug agent is given (frozen into the run)

All of it read by code and frozen with the plan, so the same correction gives the same input:

- the correction row (`kind`, `because`, `chose_instead` if any, `by`, `at`);
- the original `decision` row (`question`, `chose`, `alternatives`, `because`, `undo`, `scope`) from
  `<repo>/.decisions/<runId>.jsonl`, archives included;
- the original run's commits: from `readRun` (`src/control/budget.ts:29`) and the drive record (`base`,
  `landedCommit`; `src/control/driveRecord.ts`), the diff `base..landedCommit` as text;
- the original work item's contract (goal, `targetPaths`, `allowlistPaths`, `buildTestCommands`).

**Not** given: the original agent's transcript or session. Independence means judging from the evidence, not
continuing the original line of thought.

When the decision's run id is not a control run (a scheduler-era `orca-<taskId>-<hash8>` id with no `runs` row), the
commits and contract are omitted and the group says so in its goal text; the correction and decision rows are always
there.

### 4.3 The contract: reproduce, then fix

- `objective.goal`: generated text naming the decision, what was chosen, the human's reason, and the alternative if
  given. Three `kind`s, one shape: `wrong` fix what is wrong; `not_my_taste` change to `chose_instead`; `stale` bring it
  up to date.
- The agent first adds a test that expresses the correction and **fails on the current code**, then changes the code
  until that test and the existing checks pass. Reason: CLAUDE.md Rule 9 (a criterion is not a criterion until it has
  been seen red) and Rule 4 (success is a command).
- `successCondition` and `verification`: the original contract's `buildTestCommands`, plus the requirement that the
  new test was observed failing at `base`. How "observed failing at base" is checked mechanically is the builder's
  first design question (§9).
- Write set default: the original contract's `targetPaths ∪ allowlistPaths`, plus the repo's test directories. The
  human can widen or narrow it before confirming.
- Budgets: the original contract's `executionPolicy`, unchanged.

### 4.4 Agent and model (human's ruling)

Default: the original run's claim, `agent {agent, model, contextWindow}` and `configHash` (`readRun`). The human may
pick any other agent or model through the existing selection layers (`src/control/agentSelection.ts`).

"Different session": the debug group is a new group, so every claim gets a new `run-<uuid>`, and a continuation
cannot cross groups (`src/control/continuation.ts:37`, group/work-item/task must match). The debug run starts with
`inputCheckpoint: null`. No new mechanism is needed. A criterion pins it (§8).

## 5. Closing the correction

When the debug task lands, Orca closes the correction in code through the same seam `--close` uses (ledger rows from
`deriveRows`, `src/corrections/derive.ts`).

- `chose_instead`: the human's if given. Otherwise the agent's, from the task's structured result: one sentence saying
  what the code now does instead.
- `undo.how`: the human's if given. Otherwise the agent's, from the task's structured result. The agent knows the landed
  commit, so the natural answer is a command such as `git revert <sha>`.
- `cost`/`blast_radius`: inherited from the original and marked as inherited, exactly as today.
- Authorship: `DecisionEvent` has no author field and the ledger is append-only, so an agent-written value is marked in
  its own text, the same way `inherited()` marks inherited ones: suffix `（agent 写，人未填）`. A reader can tell the
  human's words from the agent's.
- Where the rows land: committed on the group's branch right after the fix lands there, so the fix and its record
  integrate together, by the group's own scheme (`keep`, `local`, `push-target`, `push-branch`, `github-pr`;
  `src/control/webProtocol.ts:788`). The exact commit sequence (which worktree, under which lock) is for the builder
  (§9).
- When it counts as closed (human's ruling, §2): when the closing rows are reachable from the scheme's target branch.
  For `local` and `push-target` that is the integration step itself. For `push-branch`, `github-pr` and `keep` it is
  whenever Orca next observes the target containing them (the same "already committed" check `--close` uses, run
  against the target). No new group state is added.
- A correction naming a run (§3.0) has no original `decision` row to overturn. Its closing writes one `decision` row
  (question generated from the task's goal; `alternatives` = the original result with `why_not` naming the correction)
  and no `overturned` row.
- If integration itself fails, that is a defect of integration to fix, not a state of the correction (human's ruling,
  §2). Integration paths not yet verified end to end are a prerequisite (§10).

If the agent's `undo.how` does not pass `undoHowIsExecutable` (`src/ledger/undoExecutable.ts:45`), `appendEvent`
refuses the line, as it refuses a human's. The correction then stays open, the group shows the refusal, and the human
can close it by hand. Nothing weakens the gate.

## 6. Correction to ruling 4 (published spec text is not edited)

Corrections spec `2026-09-06` §1 row 4 says `undo.how` is required from the human, and `src/corrections/derive.ts:65`
says "The human's, always (ruling 4): this is the field the Tier 0 gate reads, and a derived one would make that gate
unable to ever fire." For the debug-task path the human ruled 「人写是optional，人不愿意写就由 agent 写。」 (§2).

Why the gate still holds: ruling 4's worry was a **derived** value, copied from the decision being overturned, which
would pass the predicate without anyone weighing it. An agent-written value is not copied. It is written after the
fix, about the fix, and it goes through the same `validateLine` predicate (`src/ledger/validateLine.ts:64-70`). A value
that is not executable is still refused. Manual `orca correct` keeps requiring `--undo-how` for closing, unchanged.

The plan appends a dated correction section to the 2026-09-06 spec and a dated note beside the `derive.ts` comment.
Both originals stay verbatim (CLAUDE.md Rule 13).

## 7. Out-of-repo writes

None new. The corrections store (`~/.orca/corrections.jsonl`, `ORCA_CORRECTIONS_DIR`) is read, not written, by the
open verb. The control DB and the target repo's `.decisions/` are the existing writers. Tests use
`ORCA_CORRECTIONS_DIR` and temp control dirs (Rule 17).

## 8. Verification

- Opening: a correction on a control-run decision opens a group whose frozen plan contains the correction row, the
  decision row, the original diff and contract; opening it again returns the same group (one group, not two).
  Mutations: drop each input → its assertion red.
- Scheduler-era decision id: group opens with correction and decision only, and the goal text says commits are
  unavailable.
- Agent default = the original claim's agent/model/configHash; a panel override replaces it; the run's
  `inputCheckpoint` is null and its `run-<uuid>` differs from the original.
- Recording never depends on the open: the service down or the verb failing leaves the correction stored and the CLI
  exit code unchanged.
- Closing: human-given values pass through untouched; missing ones come from the agent result and carry the
  `（agent 写，人未填）` suffix; a non-executable agent `undo.how` is refused by `appendEvent` and the correction stays
  open.
- Each new branch named against the mutation that removes it, seen red (Rule 9), mutations in a `git clone --local`
  copy (Rule 15).
- One paid end-to-end run on a throwaway repo (one correction, one debug group, estimate → start → land → closed),
  only with the human's nod.

## 9. Left to the builder (to settle in the plan, or bring back)

1. How "the new test failed at `base`" is checked mechanically (a verify step that checks out `base`, applies only the
   test files, and expects the named test to fail?). This is the criterion the whole reproduce-first idea rests on.
2. The structured result fields the debug task returns (`choseInstead`, `undoHow`, the new test's id) and where they
   are stored before closing.
3. The closing commit sequence and lock (§5).
4. Whether the panel's "record correction" form and the CLI share one helper that sends the verb.

## 9a. Builder check (2026-10-18) and the controller's calls on it

A fresh builder read this document against `555fb232`. All file:line citations held. One precision: a
non-executable `undo.how` makes `validateLine` return `downgraded`, and the refusal itself is `appendEvent`'s throw at
`src/ledger/writer.ts:60`; the plan tests the refusal there.

Controller's calls (each changes nothing the human ruled):

- **Opening is free, so no estimate is queued.** `writeImportedPlan` runs `preflightEstimate`, which yields a `queued`
  estimate and reserves `ESTIMATE_GRANT` (`src/control/estimator.ts:122`). The debug open uses an import that leaves
  the estimate unrequested until the human clicks estimate. This keeps §3 step 2 and anti-goal 4 true.
- **Agent default re-resolves, not copies.** The default is the original claim's agent id and model, resolved under
  today's catalog and config, which gives a fresh `configHash`. If that agent or model no longer resolves, the operator
  default is used and the group says why. §8's criterion reads "same agent id and model as the original claim", not
  "same `configHash`".
- **Already closed.** The open verb refuses a correction that is already closed. If the human closes it by hand while
  the debug group waits or runs, the group is not stopped. Its closing step finds the rows already committed and
  records "closed by the human first" instead of writing. The human's close wins.
- **Test directories.** No detection. The write-set default is the original write set plus whichever of `test/`,
  `tests/`, `__tests__/`, `spec/` exist at the repo root. The human can change it before confirming.
- **Repo lookup** (for a correction that names a ledger decision): the open verb finds the configured repository whose
  `projectKey` matches the correction's. If none matches, it fails with that reason and the correction stays recorded.

Two questions went to the human; the answers are in §2 and applied in §3.0 and §5.

## 10. Prerequisites and follow-ups (separate designs)

- **Recording group/task decisions into the ledger for control runs** (human: 「也要尽快接好」). Without it, the
  decision path of §3.0 has nothing to point at for any work Orca dispatches. Next design round, before or alongside
  building this one.
- **Integration paths verified end to end.** `push-branch`/`github-pr` have not had their private GitHub acceptance
  (handoff §4.2 item 8). Per the human's ruling, a broken integration is fixed, not worked around here.

## 10a. Non-goals

- Writing corrections back to ccmem for the human's own sessions (handoff §4.2 item 13: later, separately).
- Feeding corrections into later tasks' inputs (dropped by ruling, §2).
- Ordering between the debug group and other groups, and a group-level dependency graph: next session's topic
  (handoff §4.2 item 14). Until then a debug group is an ordinary group.
- Backfilling debug groups for corrections recorded before this lands (there are none on the operator's machine
  today: `~/.orca/corrections.jsonl` does not exist, `ls -la ~/.orca/` on 2026-10-18).
- Starting a debug run without the human pressing start.
- Any new group state for "fixed, awaiting merge" (human's ruling, §2).

## 11. Anti-goals

- A correction that fails to record because the debug group could not be opened.
- The debug agent continuing the original session or reading its transcript.
- A gate that an agent-written `undo.how` can pass where a human-written one would be refused.
- Spending money (estimate or run) without the human's click.
