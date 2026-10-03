# Loop plans (goal.md §3.3) — design

> Session `1d7d9aa0`, 2026-09-30. Source: `docs/handoff/goal.md` §3.3 and §10.1 item 2; N1 and N8 depend on it.
> Revision 2: rewritten after an independent review (§10 lists every finding and what changed). Design only.
> Code references were read on Orca at the spec commit's parent chain (`0cc3c07` … `5b2b006`) and ccloop `6ece875`.
> Line numbers move: re-measure before citing (Rule 14).

## 0. What this builds

A **loop plan** is a named, built-in recipe that turns a few task-specific inputs into a complete ccloop task contract.
A task in a plan file can name a loop plan (or let its labels choose one) instead of pointing at a hand-written
contract. The panel shows the plan in plain words and lets a person change it — the plan, its inputs, and the task's
work budget — until the task starts, before or after the group is confirmed.

Two parts, implemented in this order (one plan, two parts, a gate after each):

- **Part A** — plan registry and expansion, the plan-file `loop` form, CLI refusal, Web import with the recipe in the
  archived plan, a read-only panel card.
- **Part B** — task amendments (the effective-contract reader), the `set-task-loop` command with budget moves and the
  snapshot rebuild, the editable card.

### 0.1 Not in v1

- Git workspace scheme and skill set (goal.md §3.3 table): the ccloop contract cannot express them today
  (`worktreeRequired` is `true` only; landing policy is `local-merge` only; no skill injection exists). The panel shows
  them as fixed / unsupported (§4.1). Ruling D1.
- User-defined plans. Ruling D2.
- A different loop shape (plan → execute → verify is fixed by ccloop) and any autonomy level but `L2`.
- `loop` tasks on the CLI path (`orca plan`, `orca run`, controlled CLI rounds): refused by name (§3.4). C1.
- Changing a task after it has started; changing a hand-written-contract task's contract.
- Per-plan budget defaults (§2.3); editing the handoff allocation from the card.

## 1. Rulings (this session, human's words quoted)

| # | Question | Ruling |
|---|---|---|
| D1 | Dimensions the contract cannot express (git scheme, skills) | "A：只做契约现在能表达的维度，这两项在面板上显示为固定值或「暂不支持」" |
| D2 | Where plans come from | "A：v1 只有 Orca 内置的几个方案" |
| D3 | How a plan-file task uses a plan | "A" — a `loop` object as an alternative to `contract`; exactly one of the two |
| D4 | When the panel may change a task's plan | "B：确认后也能改，只对还没开始的 task 生效" |
| D5 | What may change after confirmation | "C：钱也能随便改。往上调要从组余量里扣，不够就拒绝 … 都换方案了，结果预算不能改是很奇怪的一件事" |
| D6 | Label → default plan table and priority | "可以，按这张表和优先级" (§2.4) |
| D7 | Implementation route | "可以，按路子 1 往下走" — expand at import into the original contract. ⚠️ Corrected by R1 (§10): a *later change* cannot leave downstream untouched |
| D8 | Execute-abort recovery window default | 60 s ("可以，用 60 秒"); minute-scale wrap-up is registered (§8) |
| D9 | Display principle | The panel shows high-level plain-language descriptions, not code or contract JSON |
| D10 | Standing instruction for this round | "这一轮执行过程中如果有问题，先按你的建议执行（不要再找我）。执行完在最后阶段报给我审核" — the controller decisions below are made under it and reported at the end |

Controller decisions (reversible, reported to the human):

- C1 CLI refuses `loop` tasks.
- C2 `maxFilesTouched` default 25 (unmeasured).
- C3 `perAttemptTimeoutMs` default 3 600 000 (unmeasured).
- C4 `rejectOn` tokens (§2.2; unmeasured against a real verifier — measuring needs a paid call).
- C5 amendments as a hashed override layer, not a rewritten archived plan (R1).
- C6 who owns a task's work budget (§4.3).
- C7 summary text built server-side.

⚠️ goal.md §3.3 hard constraint 1 says the expansion "must be pure code". That means **the expansion is done by
deterministic code, never by a model** (Rule 5). It is not a display rule; D9 is the display rule.

## 2. The five plans

### 2.1 What is actually enforced (ccloop `6ece875`, Orca)

- **Hard**:
  - `verification.requiredChecks` run in the attempt worktree; a failing check rejects the attempt (ccloop
    `src/controller/runLoop.ts` `runRequiredChecks`, `runVerification`).
  - Orca's own write-set check on the **real diff** at driver step C: `harvest(…, writeSetOf(contract))` refuses a
    change outside `targetPaths ∪ allowlistPaths` as `out-of-bounds` (`src/control/executionDriver.ts`,
    `src/scheduler/writeSet.ts` `writeSetOf`).
- **Model-reported only**: ccloop's path policy (`allowlistPaths` / `denylistPaths` / `maxFilesTouched`,
  `src/policy/pathPolicy.ts`) runs on the executor's self-reported `changedFiles` (for a completed execute, the model's
  structured output; git porcelain only for partial outcomes, `scripts/claude-phase-runner.mjs`). So
  **`denylistPaths` and `maxFilesTouched` have no git-backed check anywhere**.
- **Semi-hard**: `verifierType: "agent"` adds a model verification after every check passed; `rejectOn` /
  `evidenceRequired` are case-sensitive substring matches over every evidence string (`enforceVerificationContract`); a
  match sets `safeToRetry: false`, which ends the run `failed` with no retry.
- **Soft**: `objective.nonGoals` reach the planner prompt only; `context.constraints` reach planner and executor, not
  the verifier (`src/runtime/claude/prompts.ts`). The verifier prompt lists the `rejectOn` phrases verbatim.
- Codex reuses the same prompts and the same `runLoop` enforcement (`src/runtime/codex/codexAdapter.ts`), so all of the
  above holds for both runtimes. D8's window is claude-only (§2.3).

### 2.2 The plans (version 1)

| id | Panel name | Hard (git-backed) | Model-reported | Soft constraints (→ `context.constraints`) | `verifierType` | `rejectOn` |
|---|---|---|---|---|---|---|
| `standard` | 标准 | write set = `targetPaths` | — | — | `command` | `REJECT:unused` |
| `bugfix` | 修 bug（先红后绿） | write set = `targetPaths` | — | `First add or change a test that reproduces the bug and fails for that reason; only then change the code so that it passes.` · `Do not change behavior the bug does not involve.` | `agent` | `REJECT:no-red-first` |
| `refactor` | 安全重构 | write set = `targetPaths` | denylist = `protectedPaths` | `Change no observable behavior; every existing check must pass unchanged.` | `command` | `REJECT:unused` |
| `design` | 先写设计／文档 | write set = `targetPaths` (documents) | — | `The deliverable is a document; change no code.` | `agent` | `REJECT:empty-document` |
| `investigate` | 只调研不改代码 | write set = the one report file | `maxFilesTouched` = 1 | `Investigate only; write the findings to the report file and change nothing else.` | `agent` | `REJECT:empty-report` |

- `rejectOn` must be non-empty (ccloop schema). For the two `command` plans it is a **dead placeholder**: a command
  verifier's evidence is only the checks' output, and ccloop runs every check or fails, so nothing emits it. The panel
  never shows it as a discipline.
- For `agent` plans the token is distinctive on purpose (case-sensitive substring): an echo such as "checked whether the
  report is empty: it is not" can no longer match. Whether a real verifier emits the token when it rejects is
  **unmeasured** (C4; measuring needs a paid call) — registered in §8.
- `bugfix`'s "red first" rests on the verifier and its `rejectOn` token only (constraints do not reach the verifier).
  The panel says "由模型核对，不是机械证明".
- `denylistPaths` = `protectedPaths` for every plan that is given them; it is model-reported (§2.1) and the panel marks
  it so.
- The texts above are plan version 1. Any change to a plan's text or rules adds a new version; **every version's
  definition stays in the registry** so old recipes still render and still re-expand to their stored bytes.

### 2.3 Defaults shared by every plan

`executionPolicy`: `autonomyLevel` `"L2"`, `maxAttempts` 3, `tokenBudget` 3 000 000, `totalRuntimeBudgetMs`
14 400 000, `perAttemptTimeoutMs` 3 600 000 (C3), `worktreeRequired` true, `partialOutcomeRecoveryWindowMs` 60 000 (D8).
`safetyPolicy.maxFilesTouched` 25 (C2) unless the input overrides it (`investigate`: always 1).
`escalationAndExit`: the schema defaults. `evidenceRequired`, `humanGateConditions`: empty.

- The budget numbers equal today's Web default allocation `TASK_WORK` (`src/control/estimator.ts`); import keeps giving
  `TASK_WORK`. Plans do not differ in budget: no measurement justifies different numbers (Rule 14).
- On the Web path `deriveContract` overrides `tokenBudget` / `maxAttempts` / `totalRuntimeBudgetMs` with the confirmed
  work allocation and clamps `perAttemptTimeoutMs` (≤ work.activeMs) and the recovery window (≤ handoff.activeMs,
  1 800 000 by default) (`src/control/executionSnapshot.ts` `deriveContract`).
- `maxAttempts` 3 is rarely reached: a failed required check or a `rejectOn` match is terminal, and a retry after
  attempt 1 needs a person (ccloop `stopController.ts`). The panel words attempts as "最多尝试次数".
- D8 basis (claude only): the window is how long the claude runner waits after SIGTERM before SIGKILL
  (`scripts/claude-phase-runner.mjs` `terminateClaudeProcess`). The adapter kills the runner's whole group within the
  frozen `killGraceMs` (≤ 60 s) of an abort, so the effective window is `min(window, killGraceMs)`; Orca's
  outcome-unknown grace is deadline + `killGraceMs` + 60 s (`handoffGraceMsOf`). Codex only mentions the window in the
  prompt and uses `killGraceMs` itself.

### 2.4 Choosing a plan from labels (D6)

When no plan is named, the plan is the first match in this priority order over the task's system labels:

| Priority | Label(s) | Plan |
|---|---|---|
| 1 | `investigate` | `investigate` |
| 2 | `design`, `doc` | `design` |
| 3 | `bug` | `bugfix` |
| 4 | `refactor` | `refactor` |
| 5 | `feature`, `test`, `perf`, `security`, `chore`, or no label | `standard` |

`custom:` labels are ignored. The labels used are **the plan file's labels at import**. A change through `set-task-loop`
always names its plan (the form's picker is pre-filled with the current one), so labels never choose a plan after
import, and changing labels never changes a plan.

## 3. Plan file, expansion, import (Part A)

### 3.1 The `loop` form (D3)

```json
{ "taskId": "fix-login", "dependsOn": [], "targetVersion": 1, "labels": ["bug"],
  "loop": {
    "plan": "bugfix",
    "goal": "...", "successCondition": "...",
    "targetPaths": ["src/auth/**", "tests/auth/**"],
    "checks": ["npm test"],
    "nonGoals": [], "relevantDocs": [],
    "protectedPaths": ["tests/fixtures/**"],
    "maxFilesTouched": 25
  } }
```

- Required: `goal`, `successCondition`, `targetPaths` (≥ 1), `checks` (≥ 1). Optional: `plan`, `nonGoals`,
  `relevantDocs`, `protectedPaths`, `maxFilesTouched` (positive safe integer). `.strict()`.
- A task carries exactly one of `contract` and `loop`; both or neither is `malformed`.
- `bugfix` needs its test paths inside `targetPaths` (the test must be written first); the example shows it.
- No budget in the plan file: Web import never read the contract's budget.
- `loadPlan`'s path checks (relative-path on `contract`, contract-inside-target-repo) apply to `contract` tasks only;
  the `PlanTask` type becomes `contract?: string` with `loop?: LoopInput`, and every reader of `task.contract` narrows.

### 3.2 Expansion — `expandLoopTask(taskId, targetRepo, loop, labels) → { contract, recipe }`

A pure function (no clock, filesystem or model):

| Contract field | Value |
|---|---|
| `objective` | `{ taskId, goal, successCondition, nonGoals }` |
| `context` | `{ repoPath: targetRepo, targetPaths, relevantDocs, buildTestCommands: checks, constraints: <plan's soft constraints> }` |
| `executionPolicy` | §2.3 |
| `safetyPolicy` | `{ allowlistPaths: targetPaths, denylistPaths: protectedPaths, maxFilesTouched, humanGateConditions: [] }` |
| `verification` | `{ verifierType, requiredChecks: checks, rejectOn: [token], evidenceRequired: [] }` per plan |
| `escalationAndExit` | schema defaults |

`recipe` = `{ schema: "orca-loop-recipe-v1", planId, planVersion, chosenBy: "explicit" | "labels", inputs }`.

The contract must parse under `taskContractSchema`. Refusals, as `loop-plan-invalid:<taskId>:<reason>`:

- `unknown-plan`.
- `path-shape`: every `targetPaths` / `protectedPaths` entry must be an exact relative path, `<prefix>/**`, or `**` —
  the only shapes ccloop's matcher and Orca's write set understand. `*` anywhere else, absolute paths and `..` are
  refused.
- `investigate-target`: `investigate` needs exactly one `targetPaths` entry, an exact file path.
- `design-target`: `design` refuses `**`.

### 3.3 Import

- `readSchedulerControlPlanSource` (`src/scheduler/planFile.ts`) expands a `loop` task in place of `parseContract`, using
  `plan.targetRepo`. The resulting `originalContract*` fields are exactly what a hand-written contract produces, so
  estimation, confirmation, A2 and ccloop see an ordinary contract.
- The control plan's task entry gains an optional `loop` field holding the recipe (`controlPlanSchema`,
  `src/control/webProtocol.ts`; `normalizeControlPlan`, `src/control/planImport.ts`). It is inside the archived plan, so
  **`planHash` covers it** (recipe integrity).
- The projection checks `expand(recipe)` against the stored contract bytes; a mismatch blocks the task with a named
  code, like the existing identity checks in `src/panel/controlViews.ts`.

### 3.4 CLI path (C1)

`loadPlan` accepts the `loop` form (it is shared), but the CLI consumers refuse it by name,
`loop-plan-cli-unsupported:<taskId>`: in the up-front rejections `orca plan` prints, in `orca run`
(`src/scheduler/run.ts`), and in controlled CLI rounds (`src/control/schedulerBridge.ts`).

## 4. Panel

### 4.1 Display (D9, C7)

The task view gains a named field `loopPlan` (`workItemViewSchema` is `.strict()` in `src/control/webProtocol.ts`,
mirrored in `web/src/controlTypes.ts`): `null` for a hand-written contract, else
`{ planId, planVersion, planName, chosenBy, amended, inputs, summary: string[], hardness: … }`. The summary is built
**server-side** by a pure function of `(planId, planVersion, inputs)` in the projection. The card shows:

- Title: plan name, version, how it was chosen ("修 bug（先红后绿）· v1 · 按标签 `bug` 选择" / "· 人指定"), and
  "已修改" when amended.
- Summary lines: goal and success condition (the person's words); "只改：…" (hard); "不许改：…（由 agent 自报，
  不是 git 检查）"; "最多改 N 个文件（由 agent 自报）"; "验收：运行 N 条检查命令，全部通过" with the command text
  **collapsed**; one discipline line with its strength ("先写能复现的失败测试再修（由模型核对，不是机械证明）").
- Budget: tokens, active time, "最多尝试次数".
- Fixed lines (D1): "git 工作区：独立 worktree，合回 `orca/<组>` 分支，push 由人做"; "skill 集：暂不支持".
- A hand-written-contract task shows "手写契约" with its goal and success condition.
- The task list shows a plan-name chip next to the labels.

### 4.2 Change (Part B)

- "修改做法" opens a form: plan picker (pre-filled), the `loop` inputs, and the work budget (tokens, active time,
  attempts). The draft remembers the `loopVersion` it started from (label-editor pattern).
- The submit button states the consequence ("预算 +500 000 token，从组余量扣；余量剩 X"), disabled with the
  shortfall named when the reserve cannot cover it.
- Once the task has started: read-only, "已开始，做法已冻结".

### 4.3 Who owns a task's work budget (C6, Rule 7)

- A **loop** task's work allocation is changed only by `set-task-loop`, before and after confirmation. `proposal-edit`
  refuses an operation targeting it (`budget-owned-by-loop-plan`); the budget editor shows those rows read-only with
  "在做法卡片里改".
- A **hand-written** task keeps today's path: `proposal-edit`, which after confirmation reopens the whole proposal.
- Group limit, handoff allocations and goal review stay with `proposal-edit`.

## 5. Task amendments and `set-task-loop` (Part B)

### 5.1 The effective contract (C5)

- A change never rewrites the archived plan (its `planHash` reaches the proposal, the snapshot, the confirm check and
  estimate validity). It writes a canonical **amendment record**:
  `{ schema: "orca-task-amendment-v1", groupId, taskId, loopVersion, previousContractHash, recipe,
  originalContractHash, originalContractCanonicalJson }`, stored with `writeCanonicalRecord`; the work item holds
  `amendmentHash`.
- One function, `effectivePlanTask(store, groupId, archivedTask, work)`, returns the archived task entry, or — when the
  work item has an `amendmentHash` — that entry with the amendment's recipe and `originalContract*` fields, after
  verifying: the record's hash, `groupId`/`taskId`, the contract parses and hashes to `originalContractHash`, and
  `expand(recipe)` equals the contract bytes. Any failure ⇒ `recovery-blocked`.
- Every reader of a task's original contract goes through it:
  - the confirm path's snapshot input and its plan-authority check (`src/control/executionSnapshot.ts`
    `verifyPlanAuthority`, `prepareExecutionSnapshot`);
  - A2 (`readConfirmedTaskExecution`);
  - the single-task contract reader (`src/control/queries.ts`);
  - the projection's identity checks and task view (`src/panel/controlViews.ts`).
  `readArchivedPlan` keeps verifying the archived bytes against `planHash` unchanged. The plan lists every reader found
  by `git grep` of `originalContractHash|originalContractCanonicalJson|readArchivedPlan` and routes or justifies each.
- The estimator's input stays the archived plan; an estimate made before a change reflects the old contract. v1:
  `set-task-loop` refuses while an estimate is in flight (`estimate-in-flight`, existing code); a finished estimate's
  suggestions stay applicable (they are numbers).

### 5.2 The command

One command before and after confirmation, through `applyWebCommand` (`commandId`, `expectedRevision` against
`groups.revision`, `BEGIN IMMEDIATE`). Any failure rolls the whole transaction back.

Payload: `{ groupId, taskId, baseLoopVersion, plan, inputs, work: { tokens, activeMs, attempts } }`. `sessions` is not in
the payload: it is carried over unchanged (it is never mapped into the contract and only has to be > 0).

1. Ledger known (`assertKnownConservation`), else `recovery-blocked`. Group status must be `draft` or `ready`, and not
   stopped, else `group-state-invalid` (Web group statuses: `src/control/webService.ts`).
2. Not started: work item status `draft` or `ready` **and no `runs` row for it at all** (a finished run returns a task
   to `ready`, `webDispatch.ts`), else `task-already-started`. Decided inside the transaction, so the command and the
   driver's claim (`nextClaimableTask` / `createStartingRun`) cannot both win.
3. An estimate in flight ⇒ `estimate-in-flight`. `baseLoopVersion` ≠ the current `loopVersion` ⇒
   `task-loop-version-conflict`; a hand-written task ⇒ `task-has-no-loop-plan`.
4. Expand (§3.2); invalid ⇒ `loop-plan-invalid:<reason>`. Same contract bytes and same budget ⇒ `no-op-command` (a
   plan-version bump with identical bytes is a no-op; the recipe keeps its version).
5. Write the amendment record; set the work item's `amendmentHash`, contract hash and `loopVersion`.
6. Budget, per dimension of the work allocation: delta = new − old. Group limit unchanged; the delta comes out of or
   goes back to the reserve. Update the allocation (`fieldProvenance` human), `group.reserved` /
   `ledger.committedRemaining`, the reserve row / `explicitUnallocatedReserve`, and `work.grant.work`. A reserve that
   would go negative in any dimension ⇒ `group-reserve-insufficient:<dimension>:<shortfall>`. `used` never changes.
7. Draft group: the proposal version advances (as every proposal change does), so a stale confirm is refused.
   Confirmed group:
   - `proposalVersion` does **not** change — it is inside every task's derived record and checked at A2 and in the
     projection, so changing it would invalidate every other task;
   - re-derive only this task's contract (same `derivationVersion`) and write its record;
   - build the new snapshot by **copying the old snapshot and replacing only this task's `derivedContracts` entry and
     its two allocations**; every other task's entries, `agents` and the rest stay byte-identical (a full rebuild would
     re-derive held/continuing/terminal tasks from their re-amounted allocations and change their hashes);
   - write it and point `proposal.executionSnapshotHash` and the group's mirror (`group.proposal`, kept in step by
     `saveWebAuthority`) at it. Old snapshots are kept. Wakes carry the hash but nothing reads it back; they are left as
     they are.
8. Self-check before commit: `readConfirmedTaskExecution` for this task (confirmed group) and
   `assertKnownConservation`; either failing throws and rolls back.

Measured by reading (independent review, §10 R3): no run, envelope, driver step or checkpoint stores the snapshot hash
and compares it later; every reader resolves `proposal.executionSnapshotHash` live. The collateral risks are the full
rebuild (fixed by step 7's copy) and `proposalVersion` (kept). §6 item 9 still measures it end to end.

## 6. Criteria

Each states what it protects (Rule 9); every new branch gets a deletion mutation seen red (Rule 9 corollary 1).

Part A:

1. Expansion is pure: each plan's fixed input expands to pinned bytes; twice ⇒ same hash; changing any one input
   changes the hash.
2. Each plan's fields land in the contract: allowlist, denylist, `maxFilesTouched`, `verifierType`, `rejectOn`,
   constraints — one assertion per plan per field.
3. Refusals: unknown plan, each `path-shape` case, `investigate-target`, `design-target`.
4. Plan file: `contract` + `loop` and neither refused; the old form still loads; `loadPlan`'s path checks skip `loop`
   tasks; `orca plan`, `orca run` and a controlled CLI round refuse a `loop` task by name.
5. Label choice: one row per table line; multi-label takes the highest; `custom:` ignored; an explicit plan wins.
6. Import: a `loop` task's archived entry carries the recipe; `planHash` changes when an input changes; the stored
   contract equals the expansion; a tampered recipe blocks the task in the projection.
7. Summary: same recipe ⇒ same lines; command text not in the lines; the "由模型核对" line for `bugfix` only;
   `rejectOn` tokens never shown.

Part B:

8. `set-task-loop` refusals, one criterion each: `group-state-invalid` (per refused status), `recovery-blocked`,
   `task-already-started` (running, and a task with a finished run), `estimate-in-flight`,
   `task-loop-version-conflict`, `task-has-no-loop-plan`, `loop-plan-invalid`, `no-op-command`,
   `group-reserve-insufficient` (dimension and shortfall); `proposal-edit` on a loop task's work row ⇒
   `budget-owned-by-loop-plan`.
9. Conservation before and after confirmation, raising and lowering: per dimension, reserved + reserve =
   limit − used; `used` and `sessions` unchanged.
10. Confirmed change: every other task's snapshot entries and allocations are byte-identical before and after;
    `proposalVersion` unchanged; the changed task passes A2 and ccloop receives the newly expanded contract (real
    ccloop build + fake agent E2E).
11. Not collateral: changing A while B runs leaves B able to proceed to settled.
12. Race with the driver, both orders: claim first ⇒ `task-already-started`; command first ⇒ the claim runs the new
    contract.
13. Effective-contract reader: a tampered amendment record (hash, task, recipe/contract mismatch) ⇒ `recovery-blocked`.

Mutations (only in a `clone --local` copy): drop `protectedPaths` from the expansion; drop a plan's soft constraints;
hard-code `maxFilesTouched`; swap priorities 3 and 4; accept a `*.ts` path shape; count only active runs as started;
drop the reserve check; update `reserved` but not the reserve row; full snapshot rebuild instead of copy; bump
`proposalVersion` on a confirmed change; skip the self-check; bypass `effectivePlanTask` in A2; put the command text into
the summary.

## 7. Existing criteria

None is expected to change: import's allocation stays `TASK_WORK`; the schema only adds alternatives; readers see the
archived entry when there is no amendment. If any existing criterion turns red, stop and report it by name — rewriting
one needs the human to name it.

## 8. Registered, not in this design

- **Minute-scale execute wrap-up** (D8): needs ccloop's `killGraceMs` ceiling (60 s) and Orca's outcome-unknown grace
  redesigned together.
- **Git-backed `denylistPaths` / `maxFilesTouched`** (R4): Orca's write-set check could also refuse denylist hits and
  count files on the real diff; that changes hand-written contracts' behavior, so it needs its own ruling.
- **`rejectOn` tokens against a real verifier** (C4): one paid run per `agent` plan.
- **`proposal-edit` on a Web group whose tasks have started** (read from code, not measured): the Web claim path leaves
  the group `ready`, so `prestart` does not refuse, and `reopenProposal` would return running tasks to `draft` while
  their ccloop runs continue (`src/control/webService.ts`). Needs a criterion seen red before any fix.
- `loop` tasks on the CLI path (C1); per-plan budget defaults; converting hand-written tasks.

## 9. Assumptions the plan must re-check before building on them

- The exact list of original-contract readers (§5.1) — by `git grep`, not from this file.
- That `groups.revision` refuses a stale `set-task-loop` the same way it refuses other commands
  (`src/control/commandLedger.ts`).

## 10. Independent review (revision 1 → 2)

An independent agent reviewed revision 1 (read-only; its report is in the session transcript). The controller verified
the two Critical findings against the source before acting. Finding → change:

- **R1 (Critical)** A2 derives from the archived plan entry, which `planHash` covers
  (`readConfirmedTaskExecution`: `plan.plan.tasks.find`), so revision 1's "update the work item's contract hash" could
  never pass A2, and D7's "downstream unchanged" cannot hold for a later change. → §5.1 amendment records and
  `effectivePlanTask` (C5), chosen over rewriting the archived plan because a new `planHash` cascades into the proposal,
  the snapshot, the confirm check and estimate validity.
- **R2 (Critical)** A full snapshot rebuild re-derives held/continuing/terminal tasks from re-amounted allocations. →
  §5.2 step 7 copies the old snapshot and replaces one task; criterion 10.
- **R3** The "measure first" risk is answered by reading: nothing stores and compares the snapshot hash; rewriting wakes
  is unnecessary. → §5.2 last paragraph; wake rewriting removed.
- **R4** Denylist and `maxFilesTouched` are checked on model-reported files only; the hard check is Orca's write set. →
  §2.1, §2.2 columns, §4.1 wording, §8.
- **R5** `rejectOn` is a case-sensitive substring over all evidence, terminal on match, and is echo-prone in an agent
  verifier; for command verifiers it can never fire. → §2.2 tokens and notes.
- **R6** `nonGoals` reach the planner only, constraints not the verifier; codex shares prompts; D8 is claude-only. →
  §2.1, §2.3.
- **R7** The bugfix example put tests in `protectedPaths`. → §3.1 example and note.
- **R8** ccloop matches only exact, `prefix/**`, `**`. → `path-shape` refusal, criterion 3.
- **R9** `contract` is required and read unconditionally by `loadPlan` and CLI consumers, including
  `schedulerBridge.ts`. → §3.1, §3.4, criterion 4.
- **R10** `sessions` is never mapped into the contract. → carried over unchanged (§5.2).
- **R11** The view schema is strict; the summary needs a home; old plan versions must be kept; two commands would own
  one budget. → §4.1, §2.2 last bullet, §4.3.
- **R12** The recipe lived in an unhashed work item. → recipe in the archived plan entry (import) or the hashed
  amendment record (change), checked against the contract bytes.
- **R13** Missing criteria and ambiguities (state refusals, same-bytes version bump, which labels choose). → §6, §5.2
  step 4, §2.4.
- **R14–R16 (Minor)** Commit reference, the implicit label rows, reachable attempts. → header, §2.4, §2.3.
- Scope: split into Part A and Part B (§0); both are implemented this round, with a gate after each.

## 11. Plan-stage corrections (controller, under D10)

Made while reviewing the drafted plan `docs/superpowers/plans/2026-09-30-loop-plans.md` ("Controller rulings on the
draft" there has the details):

- **Panel strings are English.** The Chinese strings in §2.2, §4.1 and §4.2 were illustrations; the panel speaks English
  (Rule 11) and UI strings are code under the language rule. The plan carries the exact English table.
- **Criterion 7** reads: the red-first line for `bugfix` only; "checked by a model" on exactly the three `agent` plans
  (§2.1 already says all three are model-checked).
- **`investigate` + `maxFilesTouched` ≠ 1 is refused** (`investigate-max-files`), not silently replaced by 1 (Rule 12).
- The command's `groupId` / `taskId` travel in the command target, as `set-task-labels` does (Rule 11).
- A draft-group change goes through `reopenProposal`, as every draft proposal change does.
- The CLI refusal sits in `loadRound`, the one door `orca plan`, `orca run` and controlled rounds share.

## 12. Corrections after the human's review (2026-10-01, session `e604b1ba`)

The text above stays as written; where it differs from this section, this section wins. Rulings are quoted in
`.superpowers/sdd/2026-10-01-loop-plans-followups/progress.md` (H1–H20).

- **C2, C3 → plans v2.** New tasks expand at version 2 of all five plans: `safetyPolicy.maxFilesTouched` defaults to
  no limit (`Number.MAX_SAFE_INTEGER`; `investigate` stays 1), `executionPolicy.perAttemptTimeoutMs` to
  `MAX_TIMER_MS` = 2 147 483 647, so on the Web path each phase may use the task's whole active time. Version 1 stays
  in the registry unchanged. Orca caps every derived phase timeout at `MAX_TIMER_MS`, because Node's `setTimeout`
  turns a larger delay into 1 ms.
- **A budget-only `set-task-loop` keeps the task's plan version**; only a change of plan or inputs expands at the
  current version.
- **C4 measured** (six paid real-claude verify calls). §2.1's "a match sets `safeToRetry: false`, which ends the run
  `failed` with no retry" holds only when the verifier approved: a rejecting verifier sets its own `safeToRetry`
  (retryable in every measured case) and the token then changes nothing. An approving verifier quoted the rule
  ("…so REJECT:empty-document does not apply") in two of three good runs, and the substring match failed that good
  work with no retry. §2.2's claim that a distinctive token prevents echo matches is therefore false. The v2 change
  that stops relying on these tokens waits for the human to name the criteria it rewrites.
- **C6 kept, R-F14 superseded**: an estimate's suggestion for a loop task's work budget is applied in one click and
  sent as `set-task-loop` with model provenance, verified against the estimate.
- **§5.1 estimates**: an estimate is built from every task's effective contract; one made before a plan change is
  marked stale and its suggestions cannot be applied (`estimate-stale`). Values applied before the change stay.
- **§4.1 "changed"**: shown once a task's contract was ever changed by `set-task-loop`, also after a change back; a
  budget-only change never shows it.
- **§8 `proposal-edit` on a started Web group**: measured red and fixed — edit, set-agent and confirm refuse
  `grant-amendment-unsupported` once any task left draft/ready. The group-state column still never leaves `ready`.
- **C7 and R-F5 superseded** by `docs/superpowers/specs/2026-10-01-panel-i18n-design.md`: the panel speaks English or
  Chinese; the server sends loop-plan fields, not sentences.

## 13. C4 change and a three-hour phase timeout (2026-10-01, session `ceca1c47`)

The text above stays as written; where it differs from this section, this section wins. Rulings are quoted in
`.superpowers/sdd/2026-10-01-c4-and-phase-timeout/progress.md`.

- **v2 edited in place** (human ruling, a one-off exception to §2.2's "no version is ever edited"): v2 had been pushed
  but no task used it. v1 is unchanged.
- **Phase timeout**: v2's `executionPolicy.perAttemptTimeoutMs` is three hours (10 800 000 ms), not `MAX_TIMER_MS`
  (§12 first bullet). On the Web path the derived contract still clamps it to the task's active time and to
  `MAX_TIMER_MS`. H3's "each phase may use the task's whole active time" no longer holds for a task granted more than
  three hours.
- **C4 (no rule-bearing rejectOn token in v2)**: design and investigate are command-verified; ahead of the task's own
  checks, the contract carries one required check per target path: an exact path must be a non-empty regular file,
  `<prefix>/**` must hold at least one non-empty regular file (`documentCheck`, loopPlans.ts). Their `rejectOn` is the
  dead placeholder `REJECT:unused`. "No code change" stays an instruction to the agent, with Orca's write set
  (`targetPaths`) as the enforced part. bugfix keeps the agent verifier; its red-first requirement is appended to the
  contract's success condition, and its `rejectOn` is `REJECT:unused`. Not measured: whether a verifier echoes the
  placeholder (needs a paid call).
- The panel card's "Acceptance: N check commands" still counts the task's own checks only; the document checks are
  named in the plan's discipline line.

## 14. ccloop no longer searches evidence for rejectOn (2026-10-01, session `ceca1c47`)

The text above stays as written; where it differs from this section, this section wins. Orca pins ccloop at
`1e4e43437c72a405fccd09f0158b87593218cc9e`, where `rejectOn` is only a condition in the verifier prompt (ccloop spec
`docs/superpowers/specs/2026-10-01-rejecton-verifier-judgment-design.md`, human ruling "D"). So §2.1's "a match sets
`safeToRetry: false`, which ends the run `failed`" and §2.2's description of a case-sensitive substring over every
evidence string no longer hold for any version: an approving verifier is never overridden by a token, and a check's
output containing one does not reject either. v1's agent plans keep their tokens (versions are not edited), which now
reach the verifier only as bare conditions in its prompt; no stored task uses v1 (real `~/.orca`: 0 loop recipes).

## 15. The card's git line follows the workspace mode (2026-10-03, session `6a4dd7f3`)

The text above stays as written; where it differs from this section, this section wins. §4's fixed line "git 工作区：独立
worktree，合回 `orca/<组>` 分支，push 由人做" (D1) was false for a repository set to `clone` (execution driver spec §3.2).
Board spec `docs/superpowers/specs/2026-10-03-board-graph-and-git-design.md` D7: the card now takes the repository's
workspace mode the page already reads -- worktree keeps the old line word for word, clone has its own, and a page that
has not read the mode (or read another repository's) says so. A caller passing no mode keeps the old line (the default
mode). The skill-set line is unchanged.
