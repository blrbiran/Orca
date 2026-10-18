# Control runs record their decisions in the ledger

Orca session `a3b2a7a7` (Claude Code interactive session, not an orca run), 2026-10-18. Observation anchor: Orca
`main` at `be13bef6`. Prerequisite of `2026-10-18-correction-debug-task-design.md` (its §10): a correction can only
name a decision that was recorded.

## 1. Problem

The ledger exists so a person can see every choice and overturn it (`goal.md` §1: 可审计). But no work Orca dispatches
through the control service (web panel, MCP `orca_send`, `orca control send`) writes a single decision.

Measured on the anchor:

- The only decision writers are the old scheduler round's: `reconcileDecision` and `boundaryDecision`
  (`src/scheduler/ledgerWiring.ts:56-102`, `:120-167`), the implicit-edge decisions (`src/scheduler/graph.ts:209`,
  appended at `src/scheduler/run.ts:738`) and the landing-order decision (`run.ts:295`, appended at `:1142`). All four
  are written by Orca's own code from templates.
- The control path builds `PlanFile`s with `ledgerMode: "out-of-repo"` (`src/control/driverLanding.ts:299`,
  `src/control/integrationResolve.ts:260`) and calls scheduler helpers directly. It never reaches the round function,
  so it never writes a decision (and never reaches `run.ts:649`'s "not implemented" refusal either).
- No agent's own choices are recorded anywhere. ccloop returns no decisions; its handoff's `pendingDecisions` and
  `awaitingHuman` are id-less strings filled from failure categories (`ccloop/src/control/handoff.ts:44-45, 344-357`).
- Every reader assumes `<repo>/.decisions/<runId>.jsonl` plus `.decisions/archive/<YYYY>/`: the panel
  (`src/panel/decisionSource.ts:11-31`, `src/panel/ledgerViews.ts:59-92`), metrics (`src/metrics/discover.ts:107-116`,
  `collect.ts:225`, `resolve.ts:94`) and `orca correct` (`src/corrections/correct.ts:104`). The `out-of-repo` mode of
  scheduler spec §8.5 has no reader.
- Control run ids are `run-<uuid>` (`src/control/budget.ts:157`), which `RUN_ID` (`src/ledger/writer.ts:16`) accepts.

## 2. Rulings (verbatim)

The controller recommended three things in chat on 2026-10-18. The human answered:

- (1) Record mainly the decisions an agent makes inside a task, and wire the four code-authored kinds along the way:
  「以 agent 在 task 里做的决定为主，代码生成的那四类顺手接上。」
- (2) Keep the ledger in the target repo's `.decisions/`, committed with the task's work on the group branch and
  integrated by the group's scheme: 「同意你的建议」.
- (3) A decision the agent reports whose `undo.how` is not executable: 「同意你的建议。这个 task 照常完成，那条决定在
  Web UI 里显示成「需要人确认」」. The recommendation it agreed to: the human approves it (supplying or accepting an
  executable `undo.how`, then it is written) or rejects it (which records a correction and, per the debug-task
  design, opens a debug group).

Standing principles that apply (`goal.md` §1.1, §1.2): agents fill what they can and humans can change defaults; every
action can be done in the web UI and through the agent path, with no reliance on a terminal.

## 3. Sources of decisions

### 3.1 The agent's own decisions (main source)

The executing agent reports the decisions it made in its final structured result, as a `decisions` array. Each entry
carries the ledger's own fields, minus what Orca supplies:

`{ question, chose, alternatives: [{ option, why_not }] (≥1), because, undo: { how, cost, blast_radius }, scope, kind }`

Orca supplies `ev`, `id`, `at`, `run` and `evidence` (the run id, the landed commit, the ccloop version), so an agent
cannot forge them. `kind` and `scope` use the ledger's existing enums (`src/ledger/types.ts`); an entry with any other
value is refused by name, not coerced.

What counts as a decision is told to the agent in the execute phase's instructions: a choice between alternatives a
reviewer could reasonably have made differently (an interface shape, a dependency, a success criterion, dropping part
of the goal). Not every edit. An empty array is a valid answer.

This needs ccloop to carry the array from the agent's final output into its result. ccloop has its own rules and a
round in flight (Orca CLAUDE.md Rule 16), so the ccloop half is its own design in the ccloop repo; this document fixes
only the shape Orca reads. Until ccloop returns the array, Orca records the code-authored decisions of §3.2 and an
absent array means "no agent decisions reported", which the task view says in so many words.

### 3.2 The code-authored kinds (ported)

The old scheduler's four templates, moved onto the control path at the matching points:

| Kind (`kind`) | Old writer | When it applies | Control-path point |
|---|---|---|---|
| implicit edge (`scheduling`) | `graph.ts:209` | two tasks' write sets intersect and nothing says which runs first; Orca picks an order | where the control plan's graph is built (`src/control/graph.ts`), recorded when the group is confirmed |
| landing order (`scheduling`) | `run.ts:295` | several finished tasks of one layer land on the group branch and nothing says which merges first | the driver's landing step (`src/control/driverLanding.ts`) |
| reconcile (`reconcile`) | `ledgerWiring.ts:56` | a landing conflicts although the write sets do not intersect; Orca reconciles it with a ccloop task | `driverLanding.ts:178` / `integrationResolve.ts`, where the reconcile contract is synthesized |
| boundary (`boundary`) | `ledgerWiring.ts:120` | a task wrote outside its write set and Orca lands it anyway | **none today**: the control path blocks such a run (`src/control/executionDriver.ts:612`) instead of landing it, so there is no decision to record. Ported only if the control path ever lands one. |

The templates' text is reused, not rewritten, so one decision reads the same whichever path made it.

**Narrowed after the builder check (human's ruling, 2026-10-18).** Only **reconcile** is ported in this round. The
control path never makes the implicit-edge or landing-order choice (§7a) and blocks instead of landing out of bounds,
so those three rows above have no true decision to record. The controller recommended porting reconcile only and
moving the other two into the next session's group-ordering topic (handoff §4.2 item 14), where dispatch would really
choose an order and could then record it. The human answered, verbatim: 「同意，按建议。」

## 4. Where and when decisions are written

- File: `<repo>/.decisions/<runId>.jsonl`, `runId` the control run's `run-<uuid>`. Group-level decisions with no run
  of their own (implicit edges at confirm) go to a file named for the group (builder: an id that passes `RUN_ID` and
  cannot collide with a run id, e.g. `group-<groupId>`).
- Written by Orca, never by the agent: the agent's `decisions` come back in its result and Orca appends them with
  `appendEvents` (`src/ledger/writer.ts`), so every line passes the same validator as today (schema, `run` matches the
  file name, no duplicate id, `validateLine` tiers).
- Committed on the group branch together with the task's landing (the agent's decisions) or the landing/reconcile
  commit (the code's), and integrated into the target by the group's own scheme. A decision is on the target exactly
  when the work it explains is.
- `.decisions/` is append-only (`src/ledger/appendOnly.ts`); the closing rows of a correction (debug-task design §5)
  go to their own file, as today.

## 5. A decision the gate refuses (human's ruling, §2)

`validateLine` downgrades an entry whose `undo.how` is not executable to tier 0, and `appendEvent` refuses it
(`src/ledger/writer.ts:60`: "this decision is not the agent's to make"). For an agent-reported decision:

- The task completes and lands as usual. The refused entry is **not** written to the ledger.
- It is stored in the control DB against the run, and the web UI shows it on the task (and on the group) as 需要人确认,
  with the agent's text.
- **Approve**: the human supplies an executable `undo.how` (the field prefilled with the agent's text), and Orca appends
  the decision with it, committed on the group branch if the group has not integrated yet, else through the same
  integration as a follow-up commit (builder: the exact mechanics). The human's `undo.how` passes the same gate.
- **Reject**: Orca records a correction against that decision's content and the run (kind `wrong`, `because` from the
  human's one line, optional) and, per the debug-task design, opens a debug group.
- Both are control verbs with UI buttons, reachable through the agent path too (`goal.md` §1.2). Approve is human-only
  in `VERB_ACCESS` (`src/panel/humanOnly.ts`): it is the human's tier-0 authorization; an agent sending it is refused.

## 6. Reading them

- The panel's decision views read `<repo>/.decisions/` from the repo's working tree. Decisions still on an
  unintegrated group branch are not there. The group and task views show them by reading the group branch
  (`git show <branch>:.decisions/<file>`), labelled "not yet integrated". Builder: the exact reader seam.
- Each decision row in the UI carries a "纠正" action that opens the correction form prefilled with its id
  (debug-task design §3.0).

## 7. Verification

- A fake agent result with two decisions lands a task: both appear in `.decisions/<run-…>.jsonl` on the group branch,
  with Orca's `id`/`at`/`run`/`evidence`; an entry with a `kind` outside the enum is refused by name and the task still
  lands. Mutations: drop the append → red; let the agent's `id` through → red.
- A fake decision with `undo.how` "revert it" (not executable): the task lands, the ledger has no such line, the
  UI/API lists it as pending; approve with `git revert <sha>` writes it; reject records a correction and opens a debug
  group. Approve sent through the agent path → refused as human-only.
- Each ported template: one scenario per control-path point produces the same text as the old writer for the same
  inputs (shared function, not a copy). Boundary: a control run that writes out of bounds is still blocked and writes
  no decision.
- Integration: after the group integrates with `local`, the decision file is on the target branch; before, only on
  the group branch, and the panel shows it as not yet integrated.
- Out-of-repo writes: none new (the target repo's `.decisions/` is the existing in-repo mode). Tests use temp repos.
- Mutations in a `git clone --local` copy, each named against the assertion it turns red (CLAUDE.md Rule 9, Rule 15).

## 7a. Builder check (2026-10-18) and the controller's calls on it

A fresh builder read this document against `be13bef6`. All citations held (the refusal message itself is at
`src/ledger/writer.ts:62`). One premise did not: `src/control/graph.ts` builds the graph only to check cycles and
duplicate ids and discards it; dispatch follows explicit `dependsOn` only (`src/control/webDispatch.ts:373`), and
landing merges each finished run on its own by compare-and-swap (`src/control/driverLanding.ts:82-118`). So the
control path never makes the implicit-edge or landing-order choice, and writing those templates would put false
statements in an audit ledger. That question went to the human; the answer is in §3.2.

Controller's calls:

- **Rejecting a refused decision.** The refused entry is stored in the control DB with its own id (`pending-<n>` on the
  run). Reject records a correction naming the **run** (debug-task design §3.0), with `because` = the human's line
  (optional) followed by the refused entry's `question`/`chose`. The debug group's frozen plan carries the pending
  entry from the DB in place of a ledger row. No third target kind.
- **Where Orca reads `decisions`.** From ccloop's final result for the run, wherever the ccloop design puts it; this
  document fixes only the shape. Each run reports only the decisions it made itself (the instruction says so), and
  its entries go to that run's file. A continuation is a new run with its own file; Orca does not dedupe across runs.
- **Which commit.** The agent's decisions file is written into the landing merge commit itself, so `findLanding`
  (`driverLanding.ts:34-41`) is unchanged and the decision cannot exist without its work. `evidence` names the
  `attemptSha` (the agent's commit), not the landing commit, which cannot contain its own sha. `landOnTip`'s produce
  step changes accordingly.
- **Other schema failures** (empty `alternatives`, missing `because`, unknown fields, bad `kind`/`scope`): the entry
  is not written and becomes a pending item exactly like §5, with the refusal reason shown. Agent-supplied `ev`, `id`,
  `at`, `run`, `evidence` are dropped and Orca's own values written (never refused for them). Filtering happens before
  `appendEvents`, which refuses a whole batch on one bad line.
- **Reconciles.** A landing reconcile (`reconcile-run-<uuid>`) writes the reconcile decision into its own run's file in
  its landing commit. An integration-conflict reconcile (`integrationResolve.ts`) writes it into the resolution commit
  itself, so the decision reaches the target exactly when the resolution does.
- **Reject is human-only too.** It records a correction, which is the human's act; an agent sending it is refused.

## 8. Non-goals

- Requirement-stage ADRs (agent proposes, human accepts) as ledger decisions. The ledger's `kind` enum has no kind for
  them; a second step.
- Choices the human makes directly (agent selection, integration scheme, plan confirmation): already the human's, and
  recorded in the control DB.
- A per-repo switch to keep `.decisions/` outside a repo that does not want it (scheduler spec §8.5's `out-of-repo`):
  later, if a repo asks.
- The ccloop half (the agent emitting `decisions` and ccloop carrying them): its own design in the ccloop repo.

## 9. Anti-goals

- An agent writing ledger lines itself, or setting `id`/`run`/`at`.
- A refused decision silently dropped, or a task failed because one decision was refused.
- A decision on the target branch before the work it explains is, or the reverse.
- Any step that needs a terminal.
