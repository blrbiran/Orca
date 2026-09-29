# Loop plans (goal.md §3.3) — design

> Session `1d7d9aa0`, 2026-09-30. Source: `docs/handoff/goal.md` §3.3 and §10.1 item 2; N1 and N8 depend on it.
> Design only, no implementation. The plan is written only after the human has reviewed this file.
> Every code reference was read during this session on Orca `0cc3c07` and ccloop `6ece875`. Line numbers move:
> re-measure before citing (Rule 14).

## 0. What this builds

A **loop plan** is a named, built-in recipe that turns a few task-specific inputs into a complete ccloop task contract.
A task in a plan file can name a loop plan (or let its labels choose one) instead of pointing at a hand-written
contract. The panel shows the plan in plain words and lets a person change it — the plan, its inputs, and the task's
budget — until the task starts, before or after the group is confirmed.

### 0.1 Not in v1

- Git workspace scheme and skill set (goal.md §3.3 table): the ccloop contract cannot express them today
  (`worktreeRequired` is `true` only; landing policy is `local-merge` only; no skill injection exists). The panel shows
  them as fixed / unsupported (§4.1). Ruling D1.
- User-defined plans (in `~/.orca/` or in a target repository). Ruling D2.
- A different loop shape (plan → execute → verify is fixed by ccloop) and any autonomy level but `L2`.
- `loop` tasks on the CLI path (`orca plan`, `orca run`): refused by name (§3.4). Controller decision C1, reversible.
- Changing a task after it has started.
- Per-plan budget defaults (§2.3).
- Converting a hand-written-contract task to a loop plan.

## 1. Rulings (this session, human's words quoted)

| # | Question | Ruling |
|---|---|---|
| D1 | Dimensions the contract cannot express (git scheme, skills) | "A：只做契约现在能表达的维度，这两项在面板上显示为固定值或「暂不支持」" |
| D2 | Where plans come from | "A：v1 只有 Orca 内置的几个方案" |
| D3 | How a plan-file task uses a plan | "A" — a `loop` object as an alternative to `contract`; exactly one of the two |
| D4 | When the panel may change a task's plan | "B：确认后也能改，只对还没开始的 task 生效" |
| D5 | What may change after confirmation | "C：钱也能随便改。往上调要从组余量里扣，不够就拒绝 … 都换方案了，结果预算不能改是很奇怪的一件事" |
| D6 | Label → default plan table and priority | "可以，按这张表和优先级" (§2.4) |
| D7 | Implementation route | "可以，按路子 1 往下走" — expand at import into the original contract; downstream unchanged |
| D8 | Execute-abort recovery window default | 60 s ("可以，用 60 秒"); minute-scale wrap-up time is registered as a follow-up (§8) |
| D9 | Display principle | The panel shows high-level plain-language descriptions, not code or contract JSON (human, this session) |

Controller decisions (reversible, reported to the human): C1 CLI refuses `loop` tasks; C2 `maxFilesTouched` default 25
(unmeasured); C3 `perAttemptTimeoutMs` default 3 600 000 (unmeasured); C4 the plans' `rejectOn` strings (§2.2,
unmeasured against real verifier output).

⚠️ goal.md §3.3 hard constraint 1 says the expansion "must be pure code". That means **the expansion is done by
deterministic code, never by a model** (Rule 5). It is not a display rule; D9 is the display rule.

## 2. The five plans

### 2.1 What ccloop enforces (read on ccloop `6ece875`)

- Hard, enforced by code: `verification.requiredChecks` (run in the attempt worktree, `src/controller/runLoop.ts`
  `runVerification`); `safetyPolicy.allowlistPaths` / `denylistPaths` / `maxFilesTouched` (`src/policy/pathPolicy.ts`,
  a violation is a human gate).
- Semi-hard: `verification.verifierType: "agent"` adds a model verification after every check passed;
  `rejectOn` / `evidenceRequired` are substring matches on the verifier's evidence (`enforceVerificationContract`).
- Soft: `objective.nonGoals` and `context.constraints` only reach the prompts (`src/runtime/claude/prompts.ts`).

### 2.2 The plans (version 1)

| id | Panel name | Hard | Soft constraints (appended to `context.constraints`) | `verifierType` | `rejectOn` |
|---|---|---|---|---|---|
| `standard` | 标准 | allowlist = `targetPaths` | — | `command` | `a required check was skipped` |
| `bugfix` | 修 bug（先红后绿） | allowlist = `targetPaths` | `First add or change a test that reproduces the bug and fails for that reason; only then change the code so that it passes.` · `Do not change behavior the bug does not involve.` | `agent` | `the reproducing test did not fail before the fix` |
| `refactor` | 安全重构 | allowlist = `targetPaths`; denylist = `protectedPaths` | `Change no observable behavior; every existing check must pass unchanged.` | `command` | `a required check was skipped` |
| `design` | 先写设计／文档 | allowlist = `targetPaths` (documents) | `The deliverable is a document; change no code.` | `agent` | `the document is empty` |
| `investigate` | 只调研不改代码 | allowlist = `targetPaths` (exactly one report file); `maxFilesTouched` = 1 | `Investigate only; write the findings to the report file and change nothing else.` | `agent` | `the report is empty` |

- `bugfix`'s "red first" is semi-hard only: nothing in ccloop can prove a test was red before the fix. The panel says
  so (§4.1).
- `denylistPaths` = `protectedPaths` for every plan that has them, not only `refactor`.
- The soft-constraint wording above is plan version 1. Any change to a plan's text or rules bumps that plan's version.

### 2.3 Defaults shared by every plan

`executionPolicy`: `autonomyLevel` `"L2"`, `maxAttempts` 3, `tokenBudget` 3 000 000, `totalRuntimeBudgetMs`
14 400 000, `perAttemptTimeoutMs` 3 600 000 (C3), `worktreeRequired` true, `partialOutcomeRecoveryWindowMs` 60 000 (D8).
`safetyPolicy.maxFilesTouched` 25 (C2) unless the input overrides it (`investigate`: always 1).
`escalationAndExit`: the schema defaults. `evidenceRequired`, `humanGateConditions`: empty.

The budget numbers equal today's Web default allocation `TASK_WORK` (`src/control/estimator.ts`). Plans do not differ in
budget: there is no measurement to justify different numbers (Rule 14). People change budgets per task (§4.2).

D8 basis: the window is how long the claude runner waits after SIGTERM before SIGKILL
(`scripts/claude-phase-runner.mjs` `terminateClaudeProcess`). The adapter kills the runner's whole group within the
frozen `killGraceMs` (at most 60 s) of an abort, so the effective window is `min(window, killGraceMs)`; and Orca's
outcome-unknown grace is deadline + `killGraceMs` + 60 s (`handoffGraceMsOf`). A longer window would be cut short, and
if it were not, Orca would call a stop unknown while ccloop still waited.

### 2.4 Choosing a plan from labels (D6)

When `loop.plan` is absent, the plan is the first match in this priority order over the task's system labels:

| Priority | Label(s) | Plan |
|---|---|---|
| 1 | `investigate` | `investigate` |
| 2 | `design`, `doc` | `design` |
| 3 | `bug` | `bugfix` |
| 4 | `refactor` | `refactor` |
| 5 | anything else, or no label | `standard` |

`investigate` first because such a task must never change code; `bugfix` before `refactor` because a fix changes
behavior, which `refactor` forbids. `custom:` labels are ignored. The choice is made **when the task is imported or
when a person changes its plan**, and recorded (§3.3); changing labels later does not change the plan.

## 3. Plan file and expansion

### 3.1 The `loop` form (D3)

```json
{ "taskId": "fix-login", "dependsOn": [], "targetVersion": 1, "labels": ["bug"],
  "loop": {
    "plan": "bugfix",
    "goal": "...", "successCondition": "...",
    "targetPaths": ["src/auth/**"],
    "checks": ["npm test"],
    "nonGoals": [], "relevantDocs": [],
    "protectedPaths": ["tests/**"],
    "maxFilesTouched": 25
  } }
```

- Required: `goal`, `successCondition`, `targetPaths` (≥ 1), `checks` (≥ 1). Optional: `plan`, `nonGoals`,
  `relevantDocs`, `protectedPaths`, `maxFilesTouched` (positive safe integer). The object is `.strict()`.
- A task carries exactly one of `contract` and `loop`; both or neither is `malformed`.
- No budget in the plan file: Web import never read the contract's budget (every task gets `TASK_WORK`,
  `src/control/planImport.ts`), so the panel is the one place budgets change.

### 3.2 Expansion — `expandLoopTask(taskId, targetRepo, loop, labels) → contract`

A pure function (no clock, no filesystem, no model). Mapping:

| Contract field | Value |
|---|---|
| `objective` | `{ taskId, goal, successCondition, nonGoals }` |
| `context` | `{ repoPath: targetRepo, targetPaths, relevantDocs, buildTestCommands: checks, constraints: <plan's soft constraints> }` |
| `executionPolicy` | §2.3 |
| `safetyPolicy` | `{ allowlistPaths: targetPaths, denylistPaths: protectedPaths, maxFilesTouched, humanGateConditions: [] }` |
| `verification` | `{ verifierType, requiredChecks: checks, rejectOn, evidenceRequired: [] }` per plan |
| `escalationAndExit` | schema defaults |

The result must parse under `taskContractSchema` (`src/scheduler/planFile.ts`). Per-plan validation, refused at import
as `loop-plan-invalid:<taskId>:<reason>`: `investigate` needs exactly one `targetPaths` entry with no `*`; `design`
refuses a `targetPaths` entry equal to `**`; an unknown `plan` id is refused.

### 3.3 What is stored (D7)

- The expanded contract is stored exactly where today's original contract is (canonical record +
  `originalContractHash`). Estimation, confirmation (`deriveContract`), the A2 re-derivation and ccloop are unchanged:
  they see an ordinary contract. "Original contract" now means "hand-written, or expanded from a loop plan".
- The work item also carries a **recipe**: `{ planId, planVersion, chosenBy: "explicit" | "labels", inputs, loopVersion }`
  where `inputs` are the `loop` fields and `loopVersion` counts changes (starts at 1). The panel reads the recipe; the
  change command re-expands from it.
- A plan version bump does not touch imported tasks (their expansion is stored). A later change re-expands with the
  **current** version; the panel says "plan updated from v1 to v2".

### 3.4 CLI path (C1)

`orca plan` / `orca run` read each task's contract file at run time (`src/scheduler/run.ts`, `ccloopRunner.ts`). A plan
with a `loop` task is refused there by name, `loop-plan-cli-unsupported:<taskId>`. Follow-up in §8.

## 4. Panel

### 4.1 Display (D9)

The task detail panel gets a "做法" card, generated by code from the recipe — never the contract:

- Title: plan name, version, and how it was chosen ("修 bug（先红后绿）· v1 · 按标签 `bug` 选择" / "· 人指定").
- Plain-language summary: goal and success condition (the person's own words); "只改：…", "不许改：…",
  "最多改 N 个文件"; "验收：运行 N 条检查命令，全部通过", with the command text **collapsed** (shown on demand);
  one line of discipline with its strength marked, e.g. `bugfix`: "先写能复现的失败测试再修（由模型核对，不是机械证明）".
- Budget: tokens, active time, attempts. Today's budget editor moves into this card — one place per number.
- Two fixed lines (D1): "git 工作区：独立 worktree，合回 `orca/<组>` 分支，push 由人做"; "skill 集：暂不支持".
- A hand-written-contract task shows "手写契约" with its goal and success condition; no plan change in v1.
- The task list shows a small plan-name chip next to the labels.

The summary text is a pure function of `(planId, planVersion, inputs)`.

### 4.2 Change

- "修改做法" opens a form: plan picker, the `loop` inputs, and the task's work budget.
- The draft remembers the `loopVersion` it started from (same pattern as the label editor).
- The submit button states the consequence ("预算 +500 000 token，从组余量扣；余量剩 X"); it is disabled, with
  the shortfall named, when the reserve cannot cover it.
- Once the task has started, the card is read-only: "已开始，做法已冻结".

## 5. The change command `set-task-loop` (D4, D5)

One command before and after confirmation, through `applyWebCommand` (`commandId`, `expectedRevision`,
`BEGIN IMMEDIATE`). Any failure rolls the whole transaction back.

Payload: `{ groupId, taskId, baseLoopVersion, plan, inputs, work: { tokens, activeMs, attempts } }`.

1. Ledger known (`assertKnownConservation`), else `recovery-blocked`; group stopped or finished ⇒ `group-state-invalid`.
2. Not started: work item status `draft` or `ready` **and no `runs` row for it at all** (active or not), else
   `task-already-started`. Decided inside the transaction, so a command and the driver's claim
   (`nextClaimableTask` / `createStartingRun`, `src/control/webDispatch.ts`) cannot both win.
3. `baseLoopVersion` ≠ recipe's `loopVersion` ⇒ `task-loop-version-conflict`; no recipe ⇒ `task-has-no-loop-plan`.
4. Expand (§3.2); invalid ⇒ `loop-plan-invalid:<reason>`. Same contract bytes and same budget ⇒ `no-op-command`.
5. Write the new original-contract record; update the work item's contract hash and recipe (`loopVersion` + 1).
6. Budget, per dimension of the work allocation: delta = new − old. Group limit unchanged; the delta comes out of or goes
   back to the reserve. Update the allocation (`fieldProvenance` human), `group.reserved` /
   `ledger.committedRemaining`, the reserve row / `explicitUnallocatedReserve`, and `work.grant.work`. A reserve that
   would go negative in any dimension ⇒ `group-reserve-insufficient:<dimension>:<shortfall>`. `used` never changes.
   The handoff allocation is not editable in v1.
7. Confirmed group only: re-derive this task's contract with the same `derivationVersion`; rebuild the group's execution
   snapshot; write the new snapshot hash everywhere the old one is referenced (proposal, the group's mirror, queued
   start wakes). `proposalVersion` does **not** change (it is inside every task's derived record). Old snapshots are
   kept.
8. Self-check before commit: run the A2 check for this task (`readConfirmedTaskExecution`,
   `src/control/executionSnapshot.ts`) and `assertKnownConservation`; either failing throws and rolls back. So "the
   command succeeded" implies "this task can start".

⚠️ **Measure first (plan Task 0), not yet measured**: whether a task already running reads the snapshot hash it
captured and compares it with the proposal's current one. If so, changing an unstarted task would turn running tasks
`recovery-blocked`. The plan's first task lists every place that stores or compares the snapshot hash and writes the
criterion of §6 item 9; if it is red, **stop and report to the human** rather than choose a fix.

⚠️ Also to measure in Task 0: what the `sessions` budget dimension governs, and whether the form must keep it in step
with `attempts` (today both are 3 in `TASK_WORK`).

## 6. Criteria

Each states what it protects (Rule 9); every new branch gets a deletion mutation seen red (Rule 9 corollary 1).

1. Expansion is pure: each plan's fixed input expands to pinned bytes; twice ⇒ same hash; changing any one input
   changes the hash.
2. Each plan's hard constraints land in the contract: allowlist, denylist, `maxFilesTouched`, `verifierType`,
   `rejectOn` — one assertion per plan per field.
3. Plan file: `contract` + `loop` and neither are refused; per-plan validation refusals; the old `contract` form still
   loads; the CLI refuses a `loop` task by name.
4. Label choice: one row per table line; multi-label takes the highest; an explicit `plan` wins over labels.
5. Summary text: same recipe ⇒ same text; command text is not in the summary body; the "由模型核对" line appears
   for `bugfix` only.
6. `set-task-loop`: one criterion per refusal code — started (`running`, and a task with a dead run), version conflict,
   no recipe, invalid plan, no-op, insufficient reserve (dimension and shortfall named).
7. Conservation before and after confirmation, raising and lowering: per dimension, reserved + reserve =
   limit − used, and `used` unchanged.
8. After a post-confirmation change, the task starts, passes A2, and ccloop receives the newly expanded contract (real
   ccloop build + fake agent E2E).
9. Not collateral: changing task A while task B runs leaves B able to proceed to settled.
10. Race with the driver, both orders: claim first ⇒ `task-already-started`; command first ⇒ the claim uses the new
    snapshot.

Mutations (in a `clone --local` copy only): drop `protectedPaths` from the expansion; drop a plan's soft constraints;
hard-code `maxFilesTouched`; swap priorities 3 and 4; count only active runs as started; drop the reserve check; update
`reserved` but not the reserve row; leave queued start wakes on the old hash; skip the self-check; put the command text
into the summary body.

## 7. Existing criteria

None is expected to change. Import's allocation for a `loop` task stays `TASK_WORK`; the plan-file schema only adds an
alternative. If any existing criterion turns red, stop and report it by name — rewriting one needs the human to name it.

## 8. Registered, not in this design

- **Minute-scale execute wrap-up** (D8): needs ccloop's `killGraceMs` ceiling (60 s) and Orca's outcome-unknown grace
  redesigned together.
- **`proposal-edit` on a Web group whose tasks have started** (read from code, not measured): the Web claim path leaves
  the group `ready`, so `prestart` does not refuse, and `reopenProposal` would return running tasks to `draft` while
  their ccloop runs continue (`src/control/webService.ts` `prestart`, `editProposal`, `reopenProposal`). Needs a
  criterion seen red before any fix. Related to the handoff's open item "can a Web group really enter `running`".
- `loop` tasks on the CLI path (C1).
- Per-plan budget defaults, once there is usage data per plan.
