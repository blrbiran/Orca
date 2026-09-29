# Loop plans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the loop-plans design (spec revision 2) exactly: Part A gives Orca five built-in, versioned loop plans that expand a plan-file `loop` object into a complete ccloop contract at Web import (CLI refuses such tasks by name), archives the recipe under `planHash`, and shows the plan read-only on the panel; Part B lets a person change a not-yet-started loop task's plan, inputs and work budget before or after confirmation through `set-task-loop`, via hashed amendment records that every original-contract reader goes through.

**Architecture:** One new pure module, `src/control/loopPlans.ts` (registry of every plan version, path-shape rules, expansion, label choice, summary text). It lives in `src/control/` and imports only `zod`, `canonicalJson.ts` and `schema.ts`, because both `src/scheduler/planFile.ts` (plan-file door) and `src/control/webProtocol.ts` (recipe and view schemas) import it: importing `taskContractSchema` from `planFile.ts` or `TASK_WORK` from `estimator.ts` (which imports `webProtocol.ts`) would close an import cycle, so those two equalities are pinned by criteria instead. A second new module, `src/control/taskAmendments.ts` (Part B), holds the amendment record schema, its writer and `effectivePlanTask`; it imports `snapshot.ts`, `planFile.ts` and `loopPlans.ts` and is imported by `queries.ts`, `executionSnapshot.ts`, `webService.ts` and `controlViews.ts` (it imports none of them). The CLI narrows the plan file once, at `loadRound` (`src/scheduler/run.ts`), so every CLI reader keeps a `PlanTask` whose `contract` is a string.

**Tech Stack:** TypeScript (NodeNext ESM), zod 3, vitest, node:sqlite control store, React 19 + @testing-library/react under `web/`.

**Spec:** `docs/superpowers/specs/2026-09-30-loop-plans-design.md` (revision 2). Rulings D1-D10 and controller decisions C1-C7 are not reopened here.

> Drafter: read-only drafting sub-agent of Orca session `1d7d9aa0` (Claude Opus 5.5), 2026-09-30. Nothing but this file was written.
> Observation anchor: Orca subject `docs(spec): revise the loop-plans design after an independent review` (`bd7590c`). Line numbers are "measured 2026-09-30 at that commit, re-measure before use" (Rule 14); each Task's executor re-measures after the previous Task's commit.

---

## Controller rulings on the draft (session `1d7d9aa0`; these override the text below wherever they differ)

Made under the human's standing instruction D10 (spec §1); reported to the human at the end of the round.

- **R-F5 — panel strings are English, not the spec's Chinese.** Rule 11: the panel speaks English
  (`web/src/TaskDetail.tsx`), and the human's language rule puts code (UI strings included) in English; the spec's
  Chinese strings were illustrations written in a Chinese conversation. Everywhere below that a Chinese string appears
  — in code, in expected test values, in accessible names — use its English form from this table. Separators stay
  ` · `; list joiners `、` become `, `; `；` becomes `; `; full-width `：` becomes `: `; `（…）` becomes ` (…)`.

  | Chinese (as drafted) | English (use this) |
  |---|---|
  | 标准 | Standard |
  | 修 bug（先红后绿） | Bug fix (red first) |
  | 安全重构 | Safe refactor |
  | 先写设计／文档 | Design / docs first |
  | 只调研不改代码 | Investigate only |
  | 人指定 | chosen by hand |
  | 按标签 `<label>` 选择 | chosen by label `<label>` |
  | 无标签，按默认 | no label, default |
  | 已修改 | changed |
  | 目标：X | Goal: X |
  | 完成条件：X | Done when: X |
  | 只改：X | Only changes: X |
  | 不许改：X（由 agent 自报，不是 git 检查） | Must not change: X (reported by the agent, not checked in git) |
  | 最多改 N 个文件（由 agent 自报） | At most N files changed (reported by the agent) |
  | 验收：运行 N 条检查命令，全部通过 | Acceptance: N check commands, all must pass |
  | 验收：X（the collapsed command list） | Checks: X |
  | 先写能复现的失败测试再修（由模型核对，不是机械证明） | Write a failing test that reproduces the bug, then fix it (checked by a model, not proven mechanically) |
  | 不改可观察行为（写给 agent 的约束；只有检查命令是硬的） | No observable behavior change (an instruction to the agent; only the checks are enforced) |
  | 交付物是文档，不改代码（由模型核对，不是机械证明） | The deliverable is a document, no code changes (checked by a model, not proven mechanically) |
  | 只调研，结论写进报告文件，别的都不改（由模型核对，不是机械证明） | Investigate only; findings go to the report file, nothing else changes (checked by a model, not proven mechanically) |
  | 由模型核对 (as a matched substring) | checked by a model |
  | git 工作区：独立 worktree，合回 orca/<g> 分支，push 由人做 | Git workspace: its own worktree, merged back into orca/<g>; pushing is done by a person |
  | skill 集：暂不支持 | Skill set: not supported yet |
  | 手写契约 | Hand-written contract |
  | 修改做法 / 修改做法 <taskId> | Change plan / Change plan <taskId> |
  | 做法 <taskId> | Plan <taskId> |
  | 做法摘要 <taskId> | Plan summary <taskId> |
  | 已开始，做法已冻结 | Started; the plan is frozen |
  | 在做法卡片里改 | Change it in the plan card |
  | 方案 | Plan |
  | 目标 / 完成条件 | Goal / Done when |
  | 只改（每行一个路径） | Only changes (one path per line) |
  | 不许改（每行一个路径） | Must not change (one path per line) |
  | 检查命令（每行一条） | Check commands (one per line) |
  | 不做的事（每行一条） | Non-goals (one per line) |
  | 相关文档（每行一个） | Relevant docs (one per line) |
  | 最多改几个文件（留空按默认） | Max files changed (blank for default) |
  | token 预算 / 活跃时间（ms） / 最多尝试次数 | Token budget / Active time (ms) / Max attempts |
  | 预算：A token · 活跃时间 B ms · 最多尝试次数 C | Budget: A tokens · active time B ms · max attempts C |
  | 预算 ±D <unit>，从组余量扣；余量剩 R | Budget +D <unit>, taken from the group reserve; R left |
  | 预算 −D <unit>，退回组余量；余量剩 R | Budget -D <unit>, returned to the group reserve; R left |
  | 预算不变 | Budget unchanged |
  | 预算要填正整数 | Budgets must be positive integers |
  | 组余量不够：<dim> 还差 N | Group reserve too small: <dim> short by N |

  The registry's `name` for `refactor` is `Safe refactor` (the draft has one stray `重构`; there is one name per plan).

- **R-F15 — refuse, do not silently override.** Rule 12 (fail loud): an `investigate` input that carries
  `maxFilesTouched` other than 1 is refused with reason `investigate-max-files` (import:
  `loop-plan-invalid:<taskId>:investigate-max-files`; command: `loop-plan-invalid` detail `investigate-max-files`).
  Absent or 1 is accepted and expands to 1. Task A1 adds this reason to the refusal list, one criterion for it, and a
  mutation that deletes the check (must go red on that criterion).
- **R-F6 accepted**: "checked by a model" on the three `agent` plans; the red-first line on `bugfix` only.
- **R-F14 accepted and registered** in the round ledger: no one-click apply of an estimate's suggestion to a loop card.
- **R-F12 accepted**: the re-amounted-task case of the full-rebuild risk is unmeasured (U8); registered.

## Global Constraints

- **Repository:** `/Users/biran/code/skills/loop/Orca`, local commits only on the branch the controller names. Never push, merge into `main`, delete a branch or a worktree (Rule 15).
- **Language:** this plan, code, code comments and commit messages are English (session memory: only conversation and handoffs are Chinese). Panel strings for this feature are the spec's Chinese strings, verbatim (Drafter finding F5).
- **Commit trailer** — every commit message ends with exactly these two lines:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GCbsgLfqFPgpeG3gTbBkbh
  ```
- **Scratch:** `SCRATCH=/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/1d7d9aa0-4a2b-478b-b0ec-d970d3a51afe/scratchpad`; `REPO=/Users/biran/code/skills/loop/Orca`. Before running criteria: `export TMPDIR=$(mktemp -d /private/tmp/cl-XXXX) ECC_GATEGUARD=off DISABLE_OMC=1`.
- **Evidence (Rule 14):** every run is `<command> > "$SCRATCH/<name>.txt" 2>&1; echo rc=$?`, then the file is read whole with the Read tool. Never `| tail`, `| grep`, `| head`. Git is `/usr/bin/git` (the rtk hook rewrites `git`). Copy files with `cat a > b`.
- **Commands:** single root criterion file: `./node_modules/.bin/vitest run <file>`; typecheck: `npm run typecheck`; web typecheck: `(cd web && ../node_modules/.bin/tsc --noEmit -p tsconfig.json)`; single web criterion file: `(cd web && ../node_modules/.bin/vitest run tests/<file>)`. The main tree never runs `npm run build` or the full suite.
- **Mutations (Rule 15)** only in `$SCRATCH/mut-<task>`:
  ```bash
  M="$SCRATCH/mut-<task>"
  /usr/bin/git clone --local "$REPO" "$M" > "$SCRATCH/<task>-clone.txt" 2>&1; echo rc=$?
  ln -s "$REPO/node_modules" "$M/node_modules"; ln -s "$REPO/web/node_modules" "$M/web/node_modules"
  for f in <every file this Task created or modified>; do mkdir -p "$M/$(dirname "$f")"; cat "$REPO/$f" > "$M/$f"; cmp "$REPO/$f" "$M/$f" || echo "COPY-DIFF $f"; done > "$SCRATCH/<task>-copy.txt" 2>&1; echo rc=$?
  ```
  (`<task>-copy.txt` must be empty.) Per mutation: make the exact edit in `$M`, run the named criterion file from `$M` into `$SCRATCH/<task>-<mutation>.txt`, expect `rc=1` with the named test red, then restore with `cat "$REPO/$f" > "$M/$f"; cmp "$REPO/$f" "$M/$f" > "$SCRATCH/<task>-<mutation>-restore.txt" 2>&1; echo rc=$?` (expect `rc=0`, empty file). Clones are kept (deleting needs the human).
- **Rule 17:** criteria write only under `mkdtemp` roots (the fixtures here already do); none touches `~/.orca`.
- **Existing criteria (spec §7):** none is expected to change. The only edits to existing test files are additive (new fields in fixtures `tests/control/fixtures/web.ts` and `tests/control/fixtures/ccloopWorld.ts`, new parity functions in `tests/panel/webParity.test.ts`). If any existing criterion turns red, stop and report it by full name; rewriting one needs the human to name it.

**Verbatim values from the spec:**

- Plan ids, version 1 each: `standard`, `bugfix`, `refactor`, `design`, `investigate`.
- Panel names: `standard` 标准 · `bugfix` 修 bug（先红后绿） · `refactor` 安全重构 · `design` 先写设计／文档 · `investigate` 只调研不改代码.
- Soft constraints (→ `context.constraints`): `bugfix`: `First add or change a test that reproduces the bug and fails for that reason; only then change the code so that it passes.` and `Do not change behavior the bug does not involve.`; `refactor`: `Change no observable behavior; every existing check must pass unchanged.`; `design`: `The deliverable is a document; change no code.`; `investigate`: `Investigate only; write the findings to the report file and change nothing else.`; `standard`: none.
- `verifierType` / `rejectOn`: `standard` command / `REJECT:unused`; `bugfix` agent / `REJECT:no-red-first`; `refactor` command / `REJECT:unused`; `design` agent / `REJECT:empty-document`; `investigate` agent / `REJECT:empty-report`.
- `executionPolicy`: `autonomyLevel "L2"`, `maxAttempts 3`, `tokenBudget 3000000`, `totalRuntimeBudgetMs 14400000`, `perAttemptTimeoutMs 3600000`, `worktreeRequired true`, `partialOutcomeRecoveryWindowMs 60000`. `safetyPolicy.maxFilesTouched` 25 unless the input overrides it; `investigate` always 1. `escalationAndExit`: schema defaults (`[]`, `[]`, `[]`, all five terminal states). `evidenceRequired`, `humanGateConditions`: `[]`.
- Label priority (system labels at import; `custom:` ignored): 1 `investigate`→investigate · 2 `design`,`doc`→design · 3 `bug`→bugfix · 4 `refactor`→refactor · 5 `feature`,`test`,`perf`,`security`,`chore` or no label→standard.
- Plan-file `loop`: required `goal`, `successCondition`, `targetPaths` (≥1), `checks` (≥1); optional `plan`, `nonGoals`, `relevantDocs`, `protectedPaths`, `maxFilesTouched` (positive safe integer); `.strict()`. Exactly one of `contract` / `loop`.
- Recipe: `{ schema: "orca-loop-recipe-v1", planId, planVersion, chosenBy: "explicit" | "labels", inputs }`.
- Amendment record: `{ schema: "orca-task-amendment-v1", groupId, taskId, loopVersion, previousContractHash, recipe, originalContractHash, originalContractCanonicalJson }`.
- Expansion refusal reasons: `unknown-plan`, `path-shape`, `investigate-target`, `design-target`. At import: `control-plan-rejected` with detail `loop-plan-invalid:<taskId>:<reason>`. In the command: `loop-plan-invalid` with detail `<reason>`.
- CLI refusal: `loop-plan-cli-unsupported:<taskId>`.
- `set-task-loop` refusal codes: `recovery-blocked`, `group-state-invalid`, `work-not-found`, `task-already-started`, `estimate-in-flight`, `task-loop-version-conflict`, `task-has-no-loop-plan`, `loop-plan-invalid`, `no-op-command`, `group-reserve-insufficient` (detail `<dimension>:<shortfall>`), `numeric-overflow`. `proposal-edit` on a loop task's work row: `budget-owned-by-loop-plan`.
- View field: `workItemViewSchema.loopPlan` (null for a hand-written contract). Command verb `set-task-loop`; route `POST /api/control/groups/:groupId/tasks/:taskId/loop`; result kind `task-loop-set`.

## Review Focus

1. **Canonical fixed point of the expansion (Task A1).** `readArchivedPlan` (`src/control/queries.ts:122-127`) re-parses every archived contract with `taskContractSchema` and compares canonical bytes; an expansion whose bytes are not a fixed point of that parse would make every loop group `recovery-blocked`. Pinned by A1's `is a fixed point of the contract schema` criterion for all five plans.
2. **Conservation under a negative delta, before and after confirmation (Tasks B2, B3).** The reserve row, `explicitUnallocatedReserve`, `committedRemaining`/`reserved` and the task's `grant.work` must move together; `used` and `sessions` never. Pinned by B2 `a change before confirmation` and B3 `a change after confirmation` (raising and lowering).
3. **Copy, not rebuild, of the confirmed snapshot; `proposalVersion` untouched (Task B3).** Everything but the changed task's derived entry and two allocations stays byte-identical, reserve row included. Pinned by B3 `leaves every other part of the snapshot byte-identical`.
4. **Every original-contract reader goes through `effectivePlanTask`, and a missing work row means "not amended" (Task B1).** `tests/control/executionSnapshot.test.ts:39-60` builds snapshots with no `work_items` rows; a reader that required one would turn existing criteria red. Pinned by B1's tamper criteria (seven cases) and by the unchanged existing suite.
5. **The claim/command race (Task B3).** Both run inside `BEGIN IMMEDIATE`; "started" means work status not `draft`/`ready` or any `runs` row at all. Pinned by B2 `task-already-started` (running and finished run) and B3 `a command before the claim: the claim runs the new contract`.

## Drafter findings

Where the spec's description differs from the code read at `bd7590c`, and what this plan does. **Bold** rows change the spec's letter or intent and are listed in the report to the controller.

| # | Spec says | Measured in code | Plan's handling |
|---|---|---|---|
| F1 | §3.1: `PlanTask` becomes `contract?: string` and every reader of `task.contract` narrows. | `PlanTask.contract` is read by the CLI round only: `src/scheduler/run.ts:180,184,193,630`, `src/scheduler/ccloopRunner.ts:318`, `src/control/schedulerBridge.ts:151`, plus constructors in `src/control/driverLanding.ts:174,296`, `src/scheduler/run.ts:456`, `src/control/graph.ts:9`. All of them receive tasks from `loadRound` (`run.ts:134-202`). | Keep `PlanTask` (a contract task, `contract: string`); add `LoopPlanTask` and `LoadedPlanFile` (what `loadPlan` returns). `loadRound` refuses loop tasks and narrows once, so the type checker proves no CLI reader sees a loop task. Same intent, one narrowing instead of seven. `detectCycle` (`src/scheduler/graph.ts:33`) widens its parameter to `Pick<PlanTask, "taskId" \| "dependsOn">`. |
| F2 | §3.4: the refusal is in `orca plan`, `orca run` and `src/control/schedulerBridge.ts`. | All three go through `loadRound`: `src/cli.ts:228` (`orca plan`), `run.ts:615` (`orca run`), `src/control/service.ts:49,59` (controlled rounds, then `makeControlledExecution`). `service.ts:50,60` throw `control-plan-rejected` with no detail. | Refuse in `loadRound` (the shared door); `service.ts:50,60` forward the rejection codes as the detail, so a controlled round names `loop-plan-cli-unsupported:<taskId>`. `schedulerBridge.ts` itself is untouched (it only ever sees narrowed `PlanTask`s). |
| F3 | §5.2: payload `{ groupId, taskId, baseLoopVersion, plan, inputs, work }`. | Task-scoped commands carry `groupId`/`taskId` in `target: taskCommandTargetSchema` (`src/control/webProtocol.ts:731`; `set-task-labels` at `:765`, `:802`). | Rule 11: target `{ kind: "task", groupId, taskId }`, payload `{ baseLoopVersion, plan, inputs, work: { tokens, activeMs, attempts } }`. |
| F4 | §4.1: view `{ planId, planVersion, planName, chosenBy, amended, inputs, summary, hardness: … }`; a hand-written task shows "手写契约" with its goal and success condition. | `hardness` is unspecified; each summary line already states its strength. The work item view carries no contract text (`workItemViewSchema`, `webProtocol.ts:930-953`), so a hand-written card has no goal to show. The Part B form needs the version its draft starts from. | `loopPlan` = `{ planId, planVersion, planName, chosenBy, chosenByLabel, amended, loopVersion, inputs, summary }` (no `hardness`); a sibling optional field `objective: { goal, successCondition }` read from the effective contract. |
| **F5** | §2.2/§4.1: Chinese panel names and summary lines. | The panel speaks English (`web/src/TaskDetail.tsx:30-33`, "finding F10: the panel speaks English"). | Follow the spec: this feature's panel strings are the spec's Chinese strings verbatim; everything else stays English. Mixed-language panel flagged for the controller. |
| **F6** | §6 criterion 7: "the 由模型核对 line for `bugfix` only". | §2.1/§2.2: `design` and `investigate` are `agent` verifiers too; their discipline also rests on the model. | The red-first line appears for `bugfix` only; "由模型核对" appears in the discipline line of exactly the three `agent` plans and never for the two `command` plans. Changes the criterion's letter; the intent (never overclaim hardness) is kept. |
| F7 | §5.1: route or justify every reader found by `git grep -n "originalContractHash\|originalContractCanonicalJson\|readArchivedPlan\|plan.plan.tasks" -- src web/src scripts`. | 67 hits (list below). | See the reader table right after this one. |
| F8 | §5.2 step 3: "An estimate in flight ⇒ `estimate-in-flight` (existing code)". | The existing predicate is `["running", "start-unknown"]` (`src/control/webDispatch.ts:124-126`); a queued estimate's request, including `planSnapshotCanonicalJson`, is frozen at creation (`webService.ts:309`, `planImport.ts:313-320`). | Reuse the predicate verbatim; a queued estimate is not in flight (its input is the archived plan either way). |
| F9 | §3.3: the projection checks `expand(recipe)` against the stored bytes. | The recipe holds no repository path; the archived plan stores `repoId` only. `context.repoPath` is overwritten with the run's workspace at A2 (`src/control/executionDriver.ts:257-258`), so it is not execution authority. | Re-expansion takes `repoPath` from the stored contract's `context.repoPath`; every other byte is checked. |
| F10 | §5.2 step 5: set the work item's `amendmentHash`, contract hash and `loopVersion`. | The projection also compares `work.contract.contentAddressedHash` (`src/panel/controlViews.ts:490`) and `derivedContractHash` (`:491`); a claim copies `work.derivedContractHash` (`webDispatch.ts:297`) and `work.grant` (`:287`) into the run. | The command also sets `originalContractHash`, `contract.contentAddressedHash`, and (confirmed group) `grant.work` and `derivedContractHash`. |
| F11 | §5.1: `effectivePlanTask(store, groupId, archivedTask, work)`. | `tests/control/executionSnapshot.test.ts:39-60` builds groups with no `work_items` rows and calls `prepareExecutionSnapshot`; `readWork` throws `work-not-found` on a missing row (`queries.ts:43-46`). | `workBodyOf(store, groupId, taskId)` answers `null` for a missing or unparsable row, and `effectivePlanTask` treats a non-object `work` as "not amended" (the reader's own later checks keep their existing error details). |
| F12 | §5.2 step 7: "a full rebuild would re-derive held/continuing/terminal tasks" (R2). | Seeing that red needs a re-amounted allocation (`stopIntent.ts:709`, handoff settle), which needs a handoff stop, which sets `group.stopped` (`stopIntent.ts:338`) and so blocks `set-task-loop` itself. A full rebuild also rewrites the snapshot's reserve row whenever the budget moves. | B3's criterion compares the whole snapshot minus the changed task's entries ("the rest stays byte-identical", step 7), with a budget delta ≠ 0, so the full-rebuild mutation is seen red through the reserve row. The re-amounted-task case is not measured (Self-Review U8). |
| F13 | §5.2 step 7 draft: "the proposal version advances (as every proposal change does)". | Every draft proposal change calls `reopenProposal` (`webService.ts:178-196`), which also resets every task to `draft` and drops frozen agent fields. | The draft path calls `reopenProposal` exactly as `editProposal` does (`webService.ts:231-235`). |
| **F14** | §5.1: "a finished estimate's suggestions stay applicable (they are numbers)"; §4.3: `proposal-edit` refuses a loop task's work row. | The editor applies suggestions through `proposal-edit` (`web/src/BudgetEditor.tsx:160-167`); an "Apply all" containing a loop work row would be refused whole. | Loop work rows are excluded from edits and suggestion buttons (read-only, "在做法卡片里改"); the estimate's numbers stay visible in its rationale and are typed into the card's form. A one-click "apply to the loop card" is not built. |
| **F15** | §2.3: `investigate` maxFilesTouched "always 1". | An input `maxFilesTouched` for `investigate` would be ignored silently. | Followed literally (always 1); the summary line shows 1, so the card never claims the ignored value. Flagged: a refusal reason would be louder but is not in the spec's list. |
| F16 | §5.2 step 2: "a finished run returns a task to `ready` (`webDispatch.ts`)". | Not measured (read-only claim). | The criterion inserts an inactive `runs` row for a `ready` task directly (Self-Review U10). |
| F17 | §9: `groups.revision` refuses a stale `set-task-loop` like other commands. | `applyWebCommand` compares `expectedRevision` with the scope's revision for every group- or task-scoped command (`src/control/commandLedger.ts:277-294`). | Measured by B2's `refuses a stale revision` criterion. |
| F18 | §5.2 last paragraph (R3): nothing reads a wake's snapshot hash back. | `executionDriver.ts:705-709` only copies it into a re-armed wake; the claim resolves `proposal.executionSnapshotHash` live (`webDispatch.ts:46-51`). | Confirmed; wakes are left as they are. |

**Original-contract readers** (`git grep -n "originalContractHash\|originalContractCanonicalJson\|readArchivedPlan\|plan.plan.tasks" -- src web/src scripts`, run at `bd7590c`, 67 lines (`wc -l`); saved as `$SCRATCH/readers.txt` by the drafter):

| Hit (file:line) | What it reads | Routed through `effectivePlanTask`? |
|---|---|---|
| `scripts/live-driver-acceptance.ts:57,309,348` | `planHash` only | No — no contract read. |
| `src/control/agentFreeze.ts:6,67` | plan tasks' agent layers | No — no contract read. |
| `src/control/estimatePrompt.ts:16` | prompt text naming the field | No — the estimator's input stays the archived plan (spec §5.1). |
| `src/control/executionSnapshot.ts:17,70` (`verifyPlanAuthority`) | archived plan bytes vs `planHash` | No — spec §5.1: `planHash` authority unchanged. |
| `src/control/executionSnapshot.ts:44-45,111-112` (`verifyTaskSet`) | confirm input vs plan task | **Yes (Task B1).** |
| `src/control/executionSnapshot.ts:179-180,209` (`deriveContract`) | the task entry it is given | Receives the effective entry from its callers (B1, B2). |
| `src/control/executionSnapshot.ts:283,293` (`readConfirmedTaskExecution`, A2) | archived task | **Yes (Task B1).** |
| `src/control/planImport.ts:95-128,293-300` | import-time normalization and first write | No — at import no amendment exists; this is where the archived entry is made. |
| `src/control/queries.ts:113-133` (`readArchivedPlan`) | archived bytes vs `planHash` | No — spec §5.1: keeps verifying the archive unchanged. |
| `src/control/queries.ts:139-147` (`readArchivedContract`, the single-task reader) | archived contract | **Yes (Task B1).** Only tests call it today (`tests/control/planImport.test.ts`). |
| `src/control/queries.ts:181` (`readBudgetProposal`), `:252` (`readEstimateRecord`) | task ids; estimate request vs archive | No — ids and the estimator's archived input. |
| `src/control/webProtocol.ts:433-434,940` | schema definitions | n/a. |
| `src/control/webService.ts:280,357` (estimate create/claim) | archived plan for the estimator | No — spec §5.1. |
| `src/control/webService.ts:427,459` (confirm: `agentTasks`) | task ids | No — ids only. |
| `src/control/webService.ts:465` (confirm: `tasks`) | the task entries frozen into the snapshot | **Yes (Task B1).** |
| `src/control/webService.ts:537` (`setTaskLabels`) | plan labels | No — labels are not contract. |
| `src/control/webService.ts:580,587` (`completeEstimateInStore`) | task ids | No. |
| `src/panel/controlViews.ts:12,256-269` (`taskCompletion`, summary) | task ids | No. |
| `src/panel/controlViews.ts:330-373` (`validateExecutionSnapshot`) | derived record vs plan task | **Yes (Task B1)**, via the effective `plan` passed from `readControlGroup`. |
| `src/panel/controlViews.ts:471-516` (`workViews`) | work item identity vs plan task; view | **Yes (Task B1)**, same. |
| `src/panel/controlViews.ts:685,803` (`readControlGroup`, `readRunEvidence`) | entry points | `readControlGroup` builds the effective plan (B1); `readRunEvidence` reads runs only. |
| `src/panel/controlViews.ts:75,103` | schema fields | n/a. |
| `src/scheduler/planFile.ts:50-51,273-274` | source type and import-time parse | No — import (Task A3 adds the expansion here). |
| `web/src/controlTypes.ts:87` | view type | n/a. |

---

## File Structure

| File | Task | Responsibility |
|---|---|---|
| `src/control/loopPlans.ts` (new) | A1, A2 | Plan registry (every version), input/recipe schemas, path-shape rules, `expandRecipe` / `expandLoopPlan` / `expandLoopTask`, `choosePlanByLabels`, `describeLoopPlan`. Pure. |
| `tests/control/loopPlans.test.ts` (new) | A1 | Criteria 1, 2, 3, 5. |
| `tests/control/loopPlanSummary.test.ts` (new) | A2 | Criterion 7. |
| `src/scheduler/planFile.ts` | A3 | `loop` form in `planTaskSchema`; `LoopPlanTask`, `LoadedPlanFile`, `isLoopPlanTask`; path checks skip loop tasks; `readSchedulerControlPlanSource` expands loop tasks. |
| `src/scheduler/graph.ts` | A3 | `detectCycle` parameter widened to `taskId`/`dependsOn`. |
| `src/scheduler/run.ts` | A3 | `loadRound` refuses loop tasks by name and narrows to `PlanFile`. |
| `src/control/service.ts` | A3 | Controlled rounds forward the rejection codes as detail. |
| `tests/scheduler/planFileLoop.test.ts`, `tests/scheduler/loopPlanCli.test.ts` (new) | A3 | Criterion 4; import expansion. |
| `src/control/webProtocol.ts` | A4, A5, B2 | `controlPlanSchema` task `loop`; `loopPlanViewSchema`, work item `loopPlan`/`objective`; `set-task-loop` verb, payload, result. |
| `src/control/planImport.ts` | A4 | `normalizeControlPlan` archives the recipe. |
| `tests/control/fixtures/web.ts` | A4 | `WebFixtureTask.loop` (additive). |
| `tests/control/loopPlanImport.test.ts` (new) | A4 | Criterion 6 (import half). |
| `src/panel/controlViews.ts` | A5, B1 | Recipe check and `loopPlan`/`objective` view (A5); effective tasks (B1). |
| `web/src/controlTypes.ts` | A5, B2, B5 | Web mirrors: view types (A5), verb/result/payload (B2), `WEB_LOOP_PLANS` (B5). |
| `tests/control/loopPlanView.test.ts`, `tests/control/loopPlanDrift.test.ts` (new) | A5 | View content; tampered (drifted) recipe blocks. |
| `web/src/LoopPlanCard.tsx` (new) | A6, B6 | The card: read-only (A6), edit form (B6). |
| `web/src/TaskDetail.tsx`, `web/src/ControlGroupView.tsx` | A6, B6 | Render the card (and pass the draft props, B6); plan-name chip in the list. |
| `web/tests/loopPlanCard.test.tsx` (new) | A6 | Card display. |
| `src/control/taskAmendments.ts` (new) | B1 | Amendment schema, `writeTaskAmendment`, `workBodyOf`, `effectivePlanTask`. |
| `src/control/executionSnapshot.ts` | B1, B2, B3 | Readers routed (B1); `deriveContract` exported (B2); `replaceTaskInSnapshot` (B3). |
| `src/control/queries.ts` | B1 | `readArchivedContract` routed. |
| `src/control/webService.ts` | B1, B2, B3, B4 | Confirm routed (B1); `setTaskLoop` (B2, B3); `proposal-edit` refusal (B4). |
| `tests/control/taskAmendments.test.ts` (new) | B1 | Criterion 13 and the routed readers. |
| `src/control/errors.ts` | B2, B4 | New codes. |
| `tests/panel/webParity.test.ts` | B2 | Two parity functions (additive). |
| `tests/control/fixtures/taskLoop.ts` (new), `tests/control/setTaskLoop.test.ts` (new) | B2 | Shared Part B helpers; criteria 8, 9 (draft), self-check. |
| `tests/control/setTaskLoopConfirmed.test.ts` (new) | B3 | Criteria 9 (confirmed), 10 (synthetic), 11, 12. |
| `web/src/BudgetEditor.tsx`, `tests/control/loopBudgetOwner.test.ts`, `web/tests/loopBudgetRows.test.tsx` (new tests) | B4 | §4.3 ownership. |
| `src/panel/controlApi.ts`, `tests/panel/taskLoopApi.test.ts` (new) | B5 | The HTTP route; `WEB_LOOP_PLANS` parity. |
| `web/src/controlApi.ts`, `web/src/App.tsx`, `web/tests/loopPlanEdit.test.tsx`, `web/tests/loopPlanDraft.test.tsx` (new tests) | B6 | Client action and path, the form, draft clearing. |
| `tests/control/fixtures/ccloopWorld.ts`, `tests/control/loopPlanE2E.test.ts` (new) | B7 | Criterion 10 against real ccloop. |

---

# Part A — registry, expansion, plan file, import, read-only card

### Task A1: The plan registry, expansion and label choice

**Files:**
- Create: `src/control/loopPlans.ts`
- Create: `tests/control/loopPlans.test.ts`

**Interfaces:**
- Consumes: `canonicalBytes`, `sha256Canonical` (`src/control/canonicalJson.ts`); `safeInteger` (`src/control/schema.ts`).
- Produces:
  ```ts
  export const LOOP_PLAN_IDS: readonly ["standard", "bugfix", "refactor", "design", "investigate"];
  export type LoopPlanId = (typeof LOOP_PLAN_IDS)[number];
  export const LOOP_RECIPE_SCHEMA: "orca-loop-recipe-v1";
  export interface LoopPlanDefinition { planId: LoopPlanId; version: number; name: string; constraints: readonly string[]; verifierType: "command" | "agent"; rejectOn: string; discipline: string | null }
  export const loopInputsSchema: z.ZodObject<...>;   // { goal, successCondition, targetPaths, checks, nonGoals, relevantDocs, protectedPaths, maxFilesTouched: number | null }, strict
  export type LoopInputs = z.infer<typeof loopInputsSchema>;
  export const loopPlanFileSchema: z.ZodObject<...>; // plan-file door: plan?, goal, successCondition, targetPaths, checks, nonGoals?, relevantDocs?, protectedPaths?, maxFilesTouched?, strict
  export type LoopPlanFileInput = z.infer<typeof loopPlanFileSchema>;
  export const loopRecipeSchema: z.ZodObject<...>;
  export type LoopRecipe = z.infer<typeof loopRecipeSchema>;
  export type LoopRefusal = "unknown-plan" | "path-shape" | "investigate-target" | "design-target";
  export type LoopExpansion = { ok: true; contract: Record<string, unknown>; canonicalJson: string; hash: string } | { ok: false; reason: LoopRefusal };
  export type LoopTaskExpansion = { ok: true; contract: Record<string, unknown>; canonicalJson: string; hash: string; recipe: LoopRecipe } | { ok: false; reason: LoopRefusal };
  export function isLoopPlanId(value: string): value is LoopPlanId;
  export function loopPlanDefinition(planId: string, version: number): LoopPlanDefinition | null;
  export function currentLoopPlanVersion(planId: string): number | null;
  export function expandRecipe(taskId: string, repoPath: string, recipe: LoopRecipe): LoopExpansion;
  export function expandLoopPlan(taskId: string, repoPath: string, planId: string, inputs: LoopInputs, chosenBy?: "explicit" | "labels"): LoopTaskExpansion;
  export function normalizeLoopInputs(input: LoopPlanFileInput): LoopInputs;
  export function expandLoopTask(taskId: string, repoPath: string, input: LoopPlanFileInput, labels: readonly string[]): LoopTaskExpansion;
  export function choosePlanByLabels(labels: readonly string[]): { planId: LoopPlanId; label: string | null };
  ```

- [ ] **Step 1: Write the failing criteria** — `tests/control/loopPlans.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { TASK_WORK } from "../../src/control/estimator.js";
import {
  LOOP_PLAN_IDS, choosePlanByLabels, currentLoopPlanVersion, expandLoopTask, expandRecipe, loopPlanDefinition, type LoopPlanFileInput,
} from "../../src/control/loopPlans.js";
import { taskContractSchema } from "../../src/scheduler/planFile.js";

/**
 * Loop plans spec §2.2, §2.3, §2.4, §3.2 (criteria 1, 2, 3, 5). The expansion is deterministic code (goal.md §3.3 hard
 * constraint 1, Rule 5); each plan's rules must land in the contract fields ccloop and Orca enforce (spec §2.1); a path
 * shape neither ccloop's matcher nor Orca's write set reads is refused before it becomes a contract (R8); labels choose a
 * plan only by the table's priority (D6).
 */
const REPO = "/abs/repo";
const BUGFIX_CONSTRAINTS = [
  "First add or change a test that reproduces the bug and fails for that reason; only then change the code so that it passes.",
  "Do not change behavior the bug does not involve.",
];
const TERMINAL = ["succeeded", "blocked_waiting_human", "exhausted", "cancelled", "failed"];
const input = (over: Partial<LoopPlanFileInput> = {}): LoopPlanFileInput => ({
  goal: "fix login", successCondition: "the login test passes", targetPaths: ["src/auth/**", "tests/auth/**"], checks: ["npm test"], ...over,
});
/** Each plan's own well-formed input: investigate needs exactly one exact report file (spec §3.2). */
const inputFor = (plan: string, over: Partial<LoopPlanFileInput> = {}): LoopPlanFileInput =>
  input({ plan, ...(plan === "investigate" ? { targetPaths: ["docs/report.md"] } : {}), ...over });
const expanded = (plan: string, over: Partial<LoopPlanFileInput> = {}) => {
  const result = expandLoopTask("fix-login", REPO, inputFor(plan, over), []);
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result;
};
const contractOf = (plan: string, over: Partial<LoopPlanFileInput> = {}) => JSON.parse(expanded(plan, over).canonicalJson);
const refusal = (loop: LoopPlanFileInput): string | null => {
  const result = expandLoopTask("fix-login", REPO, loop, []);
  return result.ok ? null : result.reason;
};

describe("the expansion is pure and pinned (criterion 1)", () => {
  it("expands bugfix's fixed input to exactly these bytes, and records its recipe", () => {
    const result = expanded("bugfix");
    expect(JSON.parse(result.canonicalJson)).toEqual({
      objective: { taskId: "fix-login", goal: "fix login", successCondition: "the login test passes", nonGoals: [] },
      context: { repoPath: REPO, targetPaths: ["src/auth/**", "tests/auth/**"], relevantDocs: [], buildTestCommands: ["npm test"], constraints: BUGFIX_CONSTRAINTS },
      executionPolicy: { autonomyLevel: "L2", maxAttempts: 3, tokenBudget: 3_000_000, totalRuntimeBudgetMs: 14_400_000, perAttemptTimeoutMs: 3_600_000, worktreeRequired: true, partialOutcomeRecoveryWindowMs: 60_000 },
      safetyPolicy: { allowlistPaths: ["src/auth/**", "tests/auth/**"], denylistPaths: [], maxFilesTouched: 25, humanGateConditions: [] },
      verification: { verifierType: "agent", requiredChecks: ["npm test"], rejectOn: ["REJECT:no-red-first"], evidenceRequired: [] },
      escalationAndExit: { escalationTargets: [], pauseOn: [], stopOn: [], terminalStates: TERMINAL },
    });
    expect(result.hash).toBe(sha256Canonical(JSON.parse(result.canonicalJson)));
    expect(result.recipe).toEqual({
      schema: "orca-loop-recipe-v1", planId: "bugfix", planVersion: 1, chosenBy: "explicit",
      inputs: { goal: "fix login", successCondition: "the login test passes", targetPaths: ["src/auth/**", "tests/auth/**"], checks: ["npm test"], nonGoals: [], relevantDocs: [], protectedPaths: [], maxFilesTouched: null },
    });
  });

  it.each([...LOOP_PLAN_IDS])("%s: is a fixed point of the contract schema, re-expands from its recipe, and hashes the same twice", (plan) => {
    const first = expanded(plan), second = expanded(plan);
    expect(second.hash).toBe(first.hash);
    // queries.ts readArchivedPlan re-parses every archived contract and compares canonical bytes (Review Focus 1).
    expect(canonicalBytes(taskContractSchema.parse(JSON.parse(first.canonicalJson))).toString("utf8")).toBe(first.canonicalJson);
    const again = expandRecipe("fix-login", REPO, first.recipe);
    expect(again.ok && again.canonicalJson).toBe(first.canonicalJson);
    expect(loopPlanDefinition(plan, 1)).not.toBeNull();
    expect(currentLoopPlanVersion(plan)).toBe(1);
  });

  const changes: Array<[string, Partial<LoopPlanFileInput>]> = [
    ["goal", { goal: "fix logout" }], ["successCondition", { successCondition: "all tests pass" }],
    ["targetPaths", { targetPaths: ["src/auth/**"] }], ["checks", { checks: ["npm test", "npm run lint"] }],
    ["nonGoals", { nonGoals: ["no UI change"] }], ["relevantDocs", { relevantDocs: ["docs/auth.md"] }],
    ["protectedPaths", { protectedPaths: ["tests/fixtures/**"] }], ["maxFilesTouched", { maxFilesTouched: 7 }],
  ];
  it.each(changes)("changing %s alone changes the hash", (_field, over) => {
    expect(expanded("bugfix", over).hash).not.toBe(expanded("bugfix").hash);
  });

  it("gives every plan today's Web default work budget (spec §2.3: TASK_WORK)", () => {
    for (const plan of LOOP_PLAN_IDS) {
      const policy = contractOf(plan).executionPolicy;
      expect([policy.tokenBudget, policy.totalRuntimeBudgetMs, policy.maxAttempts]).toEqual([TASK_WORK.tokens, TASK_WORK.activeMs, TASK_WORK.attempts]);
    }
  });
});

describe("each plan's rules land in the contract (criterion 2)", () => {
  const GIVEN: Partial<LoopPlanFileInput> = { protectedPaths: ["tests/fixtures/**"], maxFilesTouched: 7 };
  const WRITE_SET = ["src/auth/**", "tests/auth/**"];
  const rows: Array<[string, { allow: string[]; max: number; verifier: string; rejectOn: string[]; constraints: string[] }]> = [
    ["standard", { allow: WRITE_SET, max: 7, verifier: "command", rejectOn: ["REJECT:unused"], constraints: [] }],
    ["bugfix", { allow: WRITE_SET, max: 7, verifier: "agent", rejectOn: ["REJECT:no-red-first"], constraints: BUGFIX_CONSTRAINTS }],
    ["refactor", { allow: WRITE_SET, max: 7, verifier: "command", rejectOn: ["REJECT:unused"], constraints: ["Change no observable behavior; every existing check must pass unchanged."] }],
    ["design", { allow: WRITE_SET, max: 7, verifier: "agent", rejectOn: ["REJECT:empty-document"], constraints: ["The deliverable is a document; change no code."] }],
    ["investigate", { allow: ["docs/report.md"], max: 1, verifier: "agent", rejectOn: ["REJECT:empty-report"], constraints: ["Investigate only; write the findings to the report file and change nothing else."] }],
  ];
  describe.each(rows)("%s", (plan, want) => {
    it("allowlist = targetPaths (the git-backed write set)", () => {
      expect(contractOf(plan, GIVEN).safetyPolicy.allowlistPaths).toEqual(want.allow);
      expect(contractOf(plan, GIVEN).context.targetPaths).toEqual(want.allow);
    });
    it("denylist = protectedPaths", () => expect(contractOf(plan, GIVEN).safetyPolicy.denylistPaths).toEqual(["tests/fixtures/**"]));
    it("maxFilesTouched", () => expect(contractOf(plan, GIVEN).safetyPolicy.maxFilesTouched).toBe(want.max));
    it("verifierType", () => expect(contractOf(plan, GIVEN).verification.verifierType).toBe(want.verifier));
    it("rejectOn", () => expect(contractOf(plan, GIVEN).verification.rejectOn).toEqual(want.rejectOn));
    it("constraints", () => expect(contractOf(plan, GIVEN).context.constraints).toEqual(want.constraints));
    it("checks are both the build/test commands and the required checks", () => {
      const contract = contractOf(plan, GIVEN);
      expect([contract.context.buildTestCommands, contract.verification.requiredChecks]).toEqual([["npm test"], ["npm test"]]);
    });
  });
});

describe("refusals (criterion 3)", () => {
  it("refuses an unknown plan", () => expect(refusal(input({ plan: "yolo" }))).toBe("unknown-plan"));
  it.each([["/etc/passwd"], ["src/../secrets"], ["src/*.ts"], ["src/*"], ["*"], ["**/x.ts"], ["src/**/x.ts"], ["src//a.ts"], ["./src/a.ts"], ["src/"]])(
    "refuses the path shape %s in targetPaths and in protectedPaths", (path) => {
      expect(refusal(input({ plan: "standard", targetPaths: [path] }))).toBe("path-shape");
      expect(refusal(input({ plan: "standard", protectedPaths: [path] }))).toBe("path-shape");
    });
  it.each([["src/a.ts"], ["src/**"], ["**"], ["README.md"]])("accepts the path shape %s", (path) => {
    expect(refusal(input({ plan: "standard", targetPaths: [path] }))).toBeNull();
  });
  it.each([[["docs/a.md", "docs/b.md"]], [["docs/**"]], [["**"]]])("investigate refuses targetPaths %j", (targetPaths) => {
    expect(refusal(input({ plan: "investigate", targetPaths }))).toBe("investigate-target");
  });
  it("design refuses the whole repository and accepts a documents prefix", () => {
    expect(refusal(input({ plan: "design", targetPaths: ["**"] }))).toBe("design-target");
    expect(refusal(input({ plan: "design", targetPaths: ["docs/**"] }))).toBeNull();
  });
});

describe("choosing a plan from labels (criterion 5, spec §2.4)", () => {
  const table: Array<[string[], string, string | null]> = [
    [["investigate"], "investigate", "investigate"], [["design"], "design", "design"], [["doc"], "design", "doc"],
    [["bug"], "bugfix", "bug"], [["refactor"], "refactor", "refactor"],
    [["feature"], "standard", "feature"], [["test"], "standard", "test"], [["perf"], "standard", "perf"],
    [["security"], "standard", "security"], [["chore"], "standard", "chore"], [[], "standard", null],
  ];
  it.each(table)("%j chooses %s", (labels, planId, label) => expect(choosePlanByLabels(labels)).toEqual({ planId, label }));
  it("takes the highest priority of several labels, whatever their order", () => {
    expect(choosePlanByLabels(["bug", "refactor"]).planId).toBe("bugfix");
    expect(choosePlanByLabels(["refactor", "bug"]).planId).toBe("bugfix");
    expect(choosePlanByLabels(["chore", "design", "bug"]).planId).toBe("design");
    expect(choosePlanByLabels(["bug", "investigate"]).planId).toBe("investigate");
  });
  it("ignores custom labels", () => {
    expect(choosePlanByLabels(["custom:bug"])).toEqual({ planId: "standard", label: null });
    expect(choosePlanByLabels(["custom:investigate", "refactor"]).planId).toBe("refactor");
  });
  it("lets an explicit plan win over the labels, and records how the plan was chosen", () => {
    const explicit = expandLoopTask("t", REPO, input({ plan: "standard" }), ["bug"]);
    const chosen = expandLoopTask("t", REPO, input(), ["bug"]);
    expect(explicit.ok && explicit.recipe).toMatchObject({ planId: "standard", chosenBy: "explicit" });
    expect(chosen.ok && chosen.recipe).toMatchObject({ planId: "bugfix", chosenBy: "labels" });
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
./node_modules/.bin/vitest run tests/control/loopPlans.test.ts > "$SCRATCH/a1-red.txt" 2>&1; echo rc=$?
```
Expected `rc=1`: the import of `../../src/control/loopPlans.js` fails (module not found).

- [ ] **Step 3: Implement** — create `src/control/loopPlans.ts`:

```ts
import { z } from "zod";
import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { safeInteger } from "./schema.js";

/**
 * Loop plans (docs/superpowers/specs/2026-09-30-loop-plans-design.md §2, §3.2; goal.md §3.3): Orca's built-in recipes
 * that turn a few task inputs into a complete ccloop task contract. Everything here is pure -- no clock, filesystem or
 * model (goal.md §3.3 hard constraint 1, Rule 5) -- so an archived recipe re-expands to the bytes it once produced.
 *
 * This module imports nothing from src/scheduler or webProtocol.ts: planFile.ts and webProtocol.ts import it, and
 * estimator.ts imports webProtocol.ts. The two facts that would need those imports -- the expansion is a fixed point of
 * taskContractSchema, and the budget equals TASK_WORK -- are pinned by tests/control/loopPlans.test.ts instead.
 */

export const LOOP_PLAN_IDS = ["standard", "bugfix", "refactor", "design", "investigate"] as const;
export type LoopPlanId = (typeof LOOP_PLAN_IDS)[number];
export const LOOP_RECIPE_SCHEMA = "orca-loop-recipe-v1" as const;

export interface LoopPlanDefinition {
  planId: LoopPlanId;
  version: number;
  /** The panel's plain-language name (spec §2.2, D9). */
  name: string;
  /** Soft constraints, into context.constraints: they reach the planner and executor, never the verifier (spec §2.1). */
  constraints: readonly string[];
  verifierType: "command" | "agent";
  /** A case-sensitive substring over every evidence string (spec §2.2, C4); a dead placeholder for a command verifier. */
  rejectOn: string;
  /** The one discipline line the panel shows, with its strength (spec §4.1); null when the plan has none. */
  discipline: string | null;
}

/**
 * Spec §2.2 last bullet: a change to a plan's text or rules adds a version; no version is ever edited or removed, so an
 * old recipe still renders and still re-expands to its stored bytes (the projection checks it, controlViews.ts).
 */
const REGISTRY: readonly LoopPlanDefinition[] = [
  { planId: "standard", version: 1, name: "标准", constraints: [], verifierType: "command", rejectOn: "REJECT:unused", discipline: null },
  {
    planId: "bugfix", version: 1, name: "修 bug（先红后绿）",
    constraints: [
      "First add or change a test that reproduces the bug and fails for that reason; only then change the code so that it passes.",
      "Do not change behavior the bug does not involve.",
    ],
    verifierType: "agent", rejectOn: "REJECT:no-red-first", discipline: "先写能复现的失败测试再修（由模型核对，不是机械证明）",
  },
  {
    planId: "refactor", version: 1, name: "安全重构", constraints: ["Change no observable behavior; every existing check must pass unchanged."],
    verifierType: "command", rejectOn: "REJECT:unused", discipline: "不改可观察行为（写给 agent 的约束；只有检查命令是硬的）",
  },
  {
    planId: "design", version: 1, name: "先写设计／文档", constraints: ["The deliverable is a document; change no code."],
    verifierType: "agent", rejectOn: "REJECT:empty-document", discipline: "交付物是文档，不改代码（由模型核对，不是机械证明）",
  },
  {
    planId: "investigate", version: 1, name: "只调研不改代码", constraints: ["Investigate only; write the findings to the report file and change nothing else."],
    verifierType: "agent", rejectOn: "REJECT:empty-report", discipline: "只调研，结论写进报告文件，别的都不改（由模型核对，不是机械证明）",
  },
];

/** Spec §2.3: shared by every plan. The budget numbers equal TASK_WORK (estimator.ts); loopPlans.test.ts pins that. */
const EXECUTION_POLICY = {
  autonomyLevel: "L2", maxAttempts: 3, tokenBudget: 3_000_000, totalRuntimeBudgetMs: 14_400_000,
  perAttemptTimeoutMs: 3_600_000, worktreeRequired: true, partialOutcomeRecoveryWindowMs: 60_000,
} as const;
/** Spec §2.3, C2 (unmeasured). */
const DEFAULT_MAX_FILES_TOUCHED = 25;
const TERMINAL_STATES = ["succeeded", "blocked_waiting_human", "exhausted", "cancelled", "failed"] as const;

const pathEntrySchema = z.string().min(1);
/** A recipe's inputs, every optional field filled, so the same task always has the same recipe bytes. */
export const loopInputsSchema = z
  .object({
    goal: z.string().min(1),
    successCondition: z.string().min(1),
    targetPaths: z.array(pathEntrySchema).min(1),
    checks: z.array(z.string().min(1)).min(1),
    nonGoals: z.array(z.string()),
    relevantDocs: z.array(z.string()),
    protectedPaths: z.array(pathEntrySchema),
    maxFilesTouched: safeInteger.positive().nullable(),
  })
  .strict();
export type LoopInputs = z.infer<typeof loopInputsSchema>;

/** Spec §3.1 (D3): the plan file's `loop` object. No budget: Web import never read a contract's budget. */
export const loopPlanFileSchema = z
  .object({
    plan: z.string().min(1).optional(),
    goal: z.string().min(1),
    successCondition: z.string().min(1),
    targetPaths: z.array(pathEntrySchema).min(1),
    checks: z.array(z.string().min(1)).min(1),
    nonGoals: z.array(z.string()).optional(),
    relevantDocs: z.array(z.string()).optional(),
    protectedPaths: z.array(pathEntrySchema).optional(),
    maxFilesTouched: safeInteger.positive().optional(),
  })
  .strict();
export type LoopPlanFileInput = z.infer<typeof loopPlanFileSchema>;

/** Spec §3.2: what an archived plan entry (import) or an amendment record (a later change) keeps of a loop task. */
export const loopRecipeSchema = z
  .object({
    schema: z.literal(LOOP_RECIPE_SCHEMA),
    planId: z.enum(LOOP_PLAN_IDS),
    planVersion: safeInteger.positive(),
    chosenBy: z.enum(["explicit", "labels"]),
    inputs: loopInputsSchema,
  })
  .strict();
export type LoopRecipe = z.infer<typeof loopRecipeSchema>;

export type LoopRefusal = "unknown-plan" | "path-shape" | "investigate-target" | "design-target";
export type LoopExpansion = { ok: true; contract: Record<string, unknown>; canonicalJson: string; hash: string } | { ok: false; reason: LoopRefusal };
export type LoopTaskExpansion =
  | { ok: true; contract: Record<string, unknown>; canonicalJson: string; hash: string; recipe: LoopRecipe }
  | { ok: false; reason: LoopRefusal };

export function isLoopPlanId(value: string): value is LoopPlanId {
  return (LOOP_PLAN_IDS as readonly string[]).includes(value);
}

export function loopPlanDefinition(planId: string, version: number): LoopPlanDefinition | null {
  return REGISTRY.find((plan) => plan.planId === planId && plan.version === version) ?? null;
}

export function currentLoopPlanVersion(planId: string): number | null {
  let newest: number | null = null;
  for (const plan of REGISTRY) if (plan.planId === planId && (newest === null || plan.version > newest)) newest = plan.version;
  return newest;
}

/** An exact relative path: no `*` anywhere, not absolute, no empty, `.` or `..` segment. */
function exactPath(entry: string): boolean {
  if (entry.startsWith("/") || entry.includes("*")) return false;
  return entry.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/**
 * Spec §3.2 path-shape (R8): the only shapes ccloop's matcher and Orca's write set (src/scheduler/writeSet.ts
 * normalizeClaim) both read -- an exact relative path, `<prefix>/**`, or `**`.
 */
function pathShapeOk(entry: string): boolean {
  if (entry === "**") return true;
  if (entry.endsWith("/**")) return exactPath(entry.slice(0, -"/**".length));
  return exactPath(entry);
}

/** Spec §2.3: 25 unless the input says otherwise; investigate always 1. Shared with the summary so it never disagrees. */
function maxFilesOf(plan: LoopPlanDefinition, inputs: LoopInputs): number {
  return plan.planId === "investigate" ? 1 : inputs.maxFilesTouched ?? DEFAULT_MAX_FILES_TOUCHED;
}

/** Spec §3.2: the recipe's contract, for the recipe's own plan version; the re-expansion the projection checks. */
export function expandRecipe(taskId: string, repoPath: string, recipe: LoopRecipe): LoopExpansion {
  const plan = loopPlanDefinition(recipe.planId, recipe.planVersion);
  if (plan === null) return { ok: false, reason: "unknown-plan" };
  const { inputs } = recipe;
  if (![...inputs.targetPaths, ...inputs.protectedPaths].every(pathShapeOk)) return { ok: false, reason: "path-shape" };
  if (plan.planId === "investigate" && (inputs.targetPaths.length !== 1 || !exactPath(inputs.targetPaths[0]!))) {
    return { ok: false, reason: "investigate-target" };
  }
  if (plan.planId === "design" && inputs.targetPaths.includes("**")) return { ok: false, reason: "design-target" };
  const contract = {
    objective: { taskId, goal: inputs.goal, successCondition: inputs.successCondition, nonGoals: [...inputs.nonGoals] },
    context: {
      repoPath, targetPaths: [...inputs.targetPaths], relevantDocs: [...inputs.relevantDocs],
      buildTestCommands: [...inputs.checks], constraints: [...plan.constraints],
    },
    executionPolicy: { ...EXECUTION_POLICY },
    safetyPolicy: {
      allowlistPaths: [...inputs.targetPaths], denylistPaths: [...inputs.protectedPaths],
      maxFilesTouched: maxFilesOf(plan, inputs), humanGateConditions: [],
    },
    verification: { verifierType: plan.verifierType, requiredChecks: [...inputs.checks], rejectOn: [plan.rejectOn], evidenceRequired: [] },
    escalationAndExit: { escalationTargets: [], pauseOn: [], stopOn: [], terminalStates: [...TERMINAL_STATES] },
  };
  return { ok: true, contract, canonicalJson: canonicalBytes(contract).toString("utf8"), hash: sha256Canonical(contract) };
}

/** A named plan at its current version (the set-task-loop door, spec §5.2 step 4, and the plan file's). */
export function expandLoopPlan(taskId: string, repoPath: string, planId: string, inputs: LoopInputs, chosenBy: "explicit" | "labels" = "explicit"): LoopTaskExpansion {
  const version = currentLoopPlanVersion(planId);
  if (version === null || !isLoopPlanId(planId)) return { ok: false, reason: "unknown-plan" };
  const recipe: LoopRecipe = { schema: LOOP_RECIPE_SCHEMA, planId, planVersion: version, chosenBy, inputs: structuredClone(inputs) };
  const expanded = expandRecipe(taskId, repoPath, recipe);
  return expanded.ok ? { ...expanded, recipe } : expanded;
}

export function normalizeLoopInputs(input: LoopPlanFileInput): LoopInputs {
  return {
    goal: input.goal, successCondition: input.successCondition, targetPaths: [...input.targetPaths], checks: [...input.checks],
    nonGoals: [...(input.nonGoals ?? [])], relevantDocs: [...(input.relevantDocs ?? [])], protectedPaths: [...(input.protectedPaths ?? [])],
    maxFilesTouched: input.maxFilesTouched ?? null,
  };
}

/** Spec §2.4, §3.2: a plan-file task -- its named plan, or the one its labels choose. */
export function expandLoopTask(taskId: string, repoPath: string, input: LoopPlanFileInput, labels: readonly string[]): LoopTaskExpansion {
  const planId = input.plan ?? choosePlanByLabels(labels).planId;
  return expandLoopPlan(taskId, repoPath, planId, normalizeLoopInputs(input), input.plan === undefined ? "labels" : "explicit");
}

/** Spec §2.4 (D6), highest priority first. `custom:` labels never match: no vocabulary word starts with the prefix. */
const LABEL_PRIORITY: ReadonlyArray<{ labels: readonly string[]; planId: LoopPlanId }> = [
  { labels: ["investigate"], planId: "investigate" },
  { labels: ["design", "doc"], planId: "design" },
  { labels: ["bug"], planId: "bugfix" },
  { labels: ["refactor"], planId: "refactor" },
  { labels: ["feature", "test", "perf", "security", "chore"], planId: "standard" },
];

export function choosePlanByLabels(labels: readonly string[]): { planId: LoopPlanId; label: string | null } {
  for (const row of LABEL_PRIORITY) {
    const hit = row.labels.find((label) => labels.includes(label));
    if (hit !== undefined) return { planId: row.planId, label: hit };
  }
  return { planId: "standard", label: null };
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
./node_modules/.bin/vitest run tests/control/loopPlans.test.ts > "$SCRATCH/a1-green.txt" 2>&1; echo rc=$?
npm run typecheck > "$SCRATCH/a1-tsc.txt" 2>&1; echo rc=$?
```
Expected both `rc=0`. If the fixed-point criterion is red, stop and report (Self-Review U1): do not change the expected bytes.

- [ ] **Step 5: Mutations** (`$SCRATCH/mut-a1`; files `src/control/loopPlans.ts tests/control/loopPlans.test.ts`; criterion file `tests/control/loopPlans.test.ts`)
  - MA1-1 drop `protectedPaths` from the expansion: `denylistPaths: [...inputs.protectedPaths]` → `denylistPaths: []`. Must go red: `each plan's rules land in the contract (criterion 2) > <each plan> > denylist = protectedPaths`.
  - MA1-2 drop a plan's soft constraints: `constraints: [...plan.constraints]` → `constraints: []`. Red: `… > bugfix > constraints` (and refactor, design, investigate).
  - MA1-3 hard-code maxFilesTouched: `maxFilesTouched: maxFilesOf(plan, inputs)` → `maxFilesTouched: 25`. Red: `… > <plan> > maxFilesTouched` for all five.
  - MA1-4 swap priorities 3 and 4: exchange the `{ labels: ["bug"], … }` and `{ labels: ["refactor"], … }` lines of `LABEL_PRIORITY`. Red: `choosing a plan from labels … > takes the highest priority of several labels, whatever their order`.
  - MA1-5 accept a `*.ts` path shape: in `exactPath`, `entry.startsWith("/") || entry.includes("*")` → `entry.startsWith("/")`. Red: `refusals (criterion 3) > refuses the path shape src/*.ts …`.
  - MA1-6 investigate's target check deleted (the `if (plan.planId === "investigate" …) return …` statement removed). Red: `… > investigate refuses targetPaths …`.
  - MA1-7 design's check deleted. Red: `… > design refuses the whole repository …`.
  - MA1-8 explicit plan ignored: in `expandLoopTask`, `input.plan ?? choosePlanByLabels(labels).planId` → `choosePlanByLabels(labels).planId`. Red: `… > lets an explicit plan win over the labels …`.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add src/control/loopPlans.ts tests/control/loopPlans.test.ts
/usr/bin/git commit -F - <<'EOF'
feat(control): add the loop plan registry and its pure expansion

Five built-in plans (standard, bugfix, refactor, design, investigate), each a
versioned registry entry that is never edited in place. A plan-file loop
object, or a recipe, expands deterministically into a complete ccloop
contract; path shapes the matcher and the write set cannot read are refused,
and labels choose a plan by the spec's fixed priority.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GCbsgLfqFPgpeG3gTbBkbh
EOF
```

---

### Task A2: The plan summary text

**Files:**
- Modify: `src/control/loopPlans.ts` (append after `choosePlanByLabels`)
- Create: `tests/control/loopPlanSummary.test.ts`

**Interfaces:**
- Consumes: `loopPlanDefinition`, `LoopRecipe`, `LoopInputs` (Task A1; `maxFilesOf` is module-private and reused).
- Produces:
  ```ts
  export function describeLoopPlan(recipe: Pick<LoopRecipe, "planId" | "planVersion" | "inputs">): { planName: string; summary: string[] } | null;
  ```

- [ ] **Step 1: Write the failing criteria** — `tests/control/loopPlanSummary.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { LOOP_PLAN_IDS, describeLoopPlan, type LoopInputs, type LoopPlanId } from "../../src/control/loopPlans.js";

/**
 * Loop plans spec §4.1 (D9, C7; criterion 7): the card's plain-language lines are a pure function of the recipe, built
 * server-side. They never carry command text (shown collapsed by the card) or a rejectOn token, and never claim more
 * hardness than the code enforces (spec §2.1): only an agent-verified discipline says the model checks it.
 */
const CHECKS = ["npm test -- --run auth/login.test.ts", "npm run lint"];
const inputs = (over: Partial<LoopInputs> = {}): LoopInputs => ({
  goal: "fix login", successCondition: "the login test passes", targetPaths: ["src/auth/**"], checks: CHECKS,
  nonGoals: [], relevantDocs: [], protectedPaths: [], maxFilesTouched: null, ...over,
});
const lines = (planId: LoopPlanId, over: Partial<LoopInputs> = {}): string[] => {
  const described = describeLoopPlan({ planId, planVersion: 1, inputs: inputs(over) });
  if (described === null) throw new Error("no such plan");
  return described.summary;
};
const AGENT_PLANS: LoopPlanId[] = ["bugfix", "design", "investigate"];

describe("the loop plan summary (criterion 7)", () => {
  it("pins bugfix's lines", () => {
    expect(lines("bugfix", { protectedPaths: ["tests/fixtures/**"] })).toEqual([
      "目标：fix login",
      "完成条件：the login test passes",
      "只改：src/auth/**",
      "不许改：tests/fixtures/**（由 agent 自报，不是 git 检查）",
      "最多改 25 个文件（由 agent 自报）",
      "验收：运行 2 条检查命令，全部通过",
      "先写能复现的失败测试再修（由模型核对，不是机械证明）",
    ]);
  });

  it("gives the same recipe the same lines, and another goal another first line", () => {
    for (const plan of LOOP_PLAN_IDS) expect(lines(plan)).toEqual(lines(plan));
    expect(lines("standard", { goal: "fix logout" })[0]).toBe("目标：fix logout");
  });

  it.each([...LOOP_PLAN_IDS])("%s: never puts a check command's text or a rejectOn token into a line", (plan) => {
    for (const line of lines(plan)) {
      for (const check of CHECKS) expect(line).not.toContain(check);
      expect(line).not.toContain("REJECT:");
    }
  });

  it("shows the red-first discipline for bugfix only, and 由模型核对 for exactly the agent-verified plans (Drafter finding F6)", () => {
    for (const plan of LOOP_PLAN_IDS) {
      expect(lines(plan).some((line) => line.startsWith("先写能复现的失败测试再修"))).toBe(plan === "bugfix");
      expect(lines(plan).filter((line) => line.includes("由模型核对")).length).toBe(AGENT_PLANS.includes(plan) ? 1 : 0);
    }
  });

  it("marks protected paths and the file cap as agent-reported, shows no protected line without protected paths, and investigate's cap as 1", () => {
    expect(lines("standard").some((line) => line.startsWith("不许改："))).toBe(false);
    expect(lines("investigate", { targetPaths: ["docs/report.md"], maxFilesTouched: 7 })).toContain("最多改 1 个文件（由 agent 自报）");
    expect(lines("refactor", { maxFilesTouched: 7 })).toContain("最多改 7 个文件（由 agent 自报）");
  });

  it("names each plan in plain words, and knows no plan version it does not have", () => {
    expect(LOOP_PLAN_IDS.map((planId) => describeLoopPlan({ planId, planVersion: 1, inputs: inputs() })!.planName))
      .toEqual(["标准", "修 bug（先红后绿）", "安全重构", "先写设计／文档", "只调研不改代码"]);
    expect(describeLoopPlan({ planId: "standard", planVersion: 2, inputs: inputs() })).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
./node_modules/.bin/vitest run tests/control/loopPlanSummary.test.ts > "$SCRATCH/a2-red.txt" 2>&1; echo rc=$?
```
Expected `rc=1`: `describeLoopPlan` is not exported (TypeError: not a function in every `it`).

- [ ] **Step 3: Implement** — append to `src/control/loopPlans.ts`:

```ts
/**
 * Spec §4.1 (D9, C7): the card's lines for one recipe, built server-side. Each line states how hard it is (spec §2.1):
 * the write set is git-checked; protected paths and the file cap are only what the agent reports; the discipline line
 * says who checks it. The check commands' text is never in a line -- the card shows it collapsed.
 */
export function describeLoopPlan(recipe: Pick<LoopRecipe, "planId" | "planVersion" | "inputs">): { planName: string; summary: string[] } | null {
  const plan = loopPlanDefinition(recipe.planId, recipe.planVersion);
  if (plan === null) return null;
  const { inputs } = recipe;
  return {
    planName: plan.name,
    summary: [
      `目标：${inputs.goal}`,
      `完成条件：${inputs.successCondition}`,
      `只改：${inputs.targetPaths.join("、")}`,
      ...(inputs.protectedPaths.length > 0 ? [`不许改：${inputs.protectedPaths.join("、")}（由 agent 自报，不是 git 检查）`] : []),
      `最多改 ${maxFilesOf(plan, inputs)} 个文件（由 agent 自报）`,
      `验收：运行 ${inputs.checks.length} 条检查命令，全部通过`,
      ...(plan.discipline === null ? [] : [plan.discipline]),
    ],
  };
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
./node_modules/.bin/vitest run tests/control/loopPlanSummary.test.ts tests/control/loopPlans.test.ts > "$SCRATCH/a2-green.txt" 2>&1; echo rc=$?
npm run typecheck > "$SCRATCH/a2-tsc.txt" 2>&1; echo rc=$?
```
Expected both `rc=0`.

- [ ] **Step 5: Mutations** (`$SCRATCH/mut-a2`; files `src/control/loopPlans.ts tests/control/loopPlanSummary.test.ts`; criterion file `tests/control/loopPlanSummary.test.ts`)
  - MA2-1 put the command text into the summary: `` `验收：运行 ${inputs.checks.length} 条检查命令，全部通过` `` → `` `验收：${inputs.checks.join("；")}` ``. Red: `… > <plan>: never puts a check command's text …` (all five) and `pins bugfix's lines`.
  - MA2-2 protected line unconditional: `...(inputs.protectedPaths.length > 0 ? [ … ] : [])` → `` `不许改：${inputs.protectedPaths.join("、")}（由 agent 自报，不是 git 检查）` ``. Red: `marks protected paths … shows no protected line …`.
  - MA2-3 hard-coded cap: `maxFilesOf(plan, inputs)` → `25` in the summary. Red: `marks protected paths … investigate's cap as 1`.
  - MA2-4 bugfix's discipline copied onto design: in `REGISTRY`, design's `discipline` → `"先写能复现的失败测试再修（由模型核对，不是机械证明）"`. Red: `shows the red-first discipline for bugfix only …`.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add src/control/loopPlans.ts tests/control/loopPlanSummary.test.ts
/usr/bin/git commit -F - <<'EOF'
feat(control): describe a loop plan in plain words for the panel

The summary lines are a pure function of the recipe, built server-side. Each
line states its strength (git-checked, agent-reported or model-checked); check
command text and rejectOn tokens never appear in a line.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GCbsgLfqFPgpeG3gTbBkbh
EOF
```

---

### Task A3: The plan file's `loop` form, its import expansion and the CLI refusal

One Task because the type change to `loadPlan`'s result reaches `readSchedulerControlPlanSource` and `loadRound` in the same compile; each half has its own criteria file.

**Files:**
- Modify: `src/scheduler/planFile.ts` — imports (lines 1-10), `PlanTask` (12-21), `SchedulerControlPlanSource` (38-53, add after 48), `planTaskSchema` (113-123), `readSchedulerControlPlanSource` task map (264-276), `loadPlan` (316-419: signature 316, path fields 336-338, contract-inside 366-373, return 418)
- Modify: `src/scheduler/graph.ts:33` (`detectCycle` parameter type)
- Modify: `src/scheduler/run.ts:158-160` (after `loadPlan`), `:201`
- Modify: `src/control/service.ts:50`, `:60`
- Create: `tests/scheduler/planFileLoop.test.ts`, `tests/scheduler/loopPlanCli.test.ts`

**Interfaces:**
- Consumes: `expandLoopTask`, `loopPlanFileSchema`, `LoopPlanFileInput`, `LoopRecipe` (Task A1).
- Produces:
  ```ts
  // src/scheduler/planFile.ts
  export interface PlanTask { taskId: string; contract: string; dependsOn: string[]; targetVersion?: number; agent?: PartialSelection; labels?: string[] } // unchanged
  export interface LoopPlanTask { taskId: string; loop: LoopPlanFileInput; dependsOn: string[]; targetVersion?: number; agent?: PartialSelection; labels?: string[] }
  export type LoadedPlanFile = Omit<PlanFile, "tasks"> & { tasks: Array<PlanTask | LoopPlanTask> };
  export function isLoopPlanTask(task: PlanTask | LoopPlanTask): task is LoopPlanTask;
  export function loadPlan(raw: unknown, baseBranch: string): { plan: LoadedPlanFile } | { rejections: PlanRejection[] };
  // SchedulerControlPlanSource["tasks"][number] gains `loop?: LoopRecipe`
  // src/scheduler/graph.ts
  export function detectCycle(tasks: ReadonlyArray<Pick<PlanTask, "taskId" | "dependsOn">>): boolean;
  ```
  `loadRound` still returns `{ round: Round }` whose `plan: PlanFile` holds contract tasks only, or rejections including `{ code: "loop-plan-cli-unsupported:<taskId>", message }`. `ControlService.run`/`runProfiled` throw `ControlError("control-plan-rejected", <codes joined by ",">)`.

- [ ] **Step 1: Write the failing criteria**

`tests/scheduler/planFileLoop.test.ts`:

```ts
import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { expandLoopTask } from "../../src/control/loopPlans.js";
import { loadPlan, readSchedulerControlPlanSource, type PlanRejection } from "../../src/scheduler/planFile.js";

/**
 * Loop plans spec §3.1, §3.3 (D3; criterion 4, criterion 6's import half): a plan-file task names a loop plan instead
 * of a contract file -- exactly one of the two -- and Web import stores the loop's expansion, from the plan file's own
 * labels and targetRepo, as the task's original contract.
 */
const LOOP = { plan: "bugfix", goal: "fix login", successCondition: "the login test passes", targetPaths: ["src/auth/**", "tests/auth/**"], checks: ["npm test"] };
const OK = { targetRepo: "/abs/repo", ccloopBin: "/abs/cli.js", runsDir: "/abs/runs", workBranch: "orca/w/x", policy: "local-merge", ledgerMode: "in-repo" };
const reported = (r: { plan: unknown } | { rejections: PlanRejection[] }): string[] =>
  "rejections" in r ? r.rejections.map((x) => `${x.code} ${x.message}`) : [];

describe("the plan file's loop form (spec §3.1, criterion 4)", () => {
  it("loads a task that names a loop plan, keeping the loop and naming no contract", () => {
    const r = loadPlan({ ...OK, tasks: [{ taskId: "T1", loop: LOOP, dependsOn: [] }] }, "main");
    if (!("plan" in r)) throw new Error(JSON.stringify(r.rejections));
    expect(r.plan.tasks).toEqual([{ taskId: "T1", loop: LOOP, dependsOn: [] }]);
  });

  it.each([["both", { contract: "/abs/t1.json", loop: LOOP }], ["neither", {}]])("refuses a task with %s of contract and loop as malformed", (_case, fields) => {
    expect(reported(loadPlan({ ...OK, tasks: [{ taskId: "T1", dependsOn: [], ...fields }] }, "main"))).toEqual(["malformed tasks.0: exactly-one-of-contract-or-loop"]);
  });

  it("refuses an unknown field inside loop (the object is strict)", () => {
    const r = loadPlan({ ...OK, tasks: [{ taskId: "T1", dependsOn: [], loop: { ...LOOP, budget: 5 } }] }, "main");
    expect("rejections" in r && r.rejections.map((x) => x.code)).toEqual(["malformed"]);
  });

  it("still loads the contract form unchanged", () => {
    const task = { taskId: "T1", contract: "/abs/t1.json", dependsOn: [] };
    expect(loadPlan({ ...OK, tasks: [task] }, "main")).toEqual({ plan: { ...OK, tasks: [task] } });
  });

  it("runs the contract path checks on contract tasks only", () => {
    // A loop task has no file: neither relative-path nor contract-inside-target-repo may fire for it...
    expect(reported(loadPlan({ ...OK, tasks: [{ taskId: "T1", loop: LOOP, dependsOn: [] }] }, "main"))).toEqual([]);
    // ...while a contract task beside it is still checked.
    const mixed = loadPlan({ ...OK, tasks: [{ taskId: "T1", loop: LOOP, dependsOn: [] }, { taskId: "T2", contract: "/abs/repo/t2.json", dependsOn: [] }] }, "main");
    expect("rejections" in mixed && mixed.rejections.map((x) => x.code)).toEqual(["contract-inside-target-repo"]);
  });
});

async function planSource(tasks: unknown[]) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-loop-source-")));
  const planPath = join(root, "plan.json");
  await writeFile(planPath, JSON.stringify({ targetRepo: root, ccloopBin: "/abs/cli.js", runsDir: root, workBranch: "orca/w/x", policy: "local-merge", ledgerMode: "out-of-repo", goal: "ship", successConditions: ["passes"], tasks }));
  return { root, read: () => readSchedulerControlPlanSource({ repositoryPath: root, planPath, validatePlanDescriptor() {} }) };
}

describe("Web import's source expands a loop task (spec §3.3)", () => {
  it("stores the expansion of the task's loop, chosen by the plan file's labels, as its original contract", async () => {
    const { plan: _named, ...unnamed } = LOOP;
    const { root, read } = await planSource([{ taskId: "fix-login", dependsOn: [], targetVersion: 1, labels: ["bug"], loop: unnamed }]);
    const want = expandLoopTask("fix-login", root, unnamed, ["bug"]);
    if (!want.ok) throw new Error(want.reason);
    expect(want.recipe).toMatchObject({ planId: "bugfix", chosenBy: "labels" });
    expect(read().tasks[0]).toMatchObject({ originalContractCanonicalJson: want.canonicalJson, originalContractHash: want.hash, loop: want.recipe });
  });

  it("refuses a loop the expansion refuses, naming the task and the reason", async () => {
    const { read } = await planSource([{ taskId: "fix-login", dependsOn: [], targetVersion: 1, loop: { ...LOOP, targetPaths: ["src/*.ts"] } }]);
    expect(read).toThrow("control-plan-rejected:loop-plan-invalid:fix-login:path-shape");
  });
});
```

`tests/scheduler/loopPlanCli.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ControlService } from "../../src/control/service.js";
import { openTestStore } from "../control/fixtures/store.js";
import { captureStreams, makeSandbox, runCli, seedRejectablePlan, type Sandbox } from "./sandbox.js";

/**
 * Loop plans spec §3.4 (C1; criterion 4): a loop task is expanded only by Web import. Every CLI consumer -- `orca
 * plan`, `orca run` and a controlled CLI round -- refuses it by name before reading any contract, rather than running a
 * round without it.
 */
const LOOP = { plan: "standard", goal: "write a.txt", successCondition: "a.txt exists", targetPaths: ["a.txt"], checks: ["true"] };
const loopPlan = (s: Sandbox): Promise<string> => seedRejectablePlan(s, { tasks: [{ taskId: "T1", loop: LOOP, dependsOn: [] }] });

describe("the CLI refuses a loop task by name (spec §3.4)", () => {
  it.each([["plan"], ["run"]])("orca %s exits 1 naming loop-plan-cli-unsupported:T1", async (command) => {
    const s = await makeSandbox();
    try {
      const planPath = await loopPlan(s);
      const { result, stderr } = await captureStreams(() => runCli([command, planPath]).catch((err: Error) => err.message));
      expect(result).toBe(1);
      expect(stderr).toContain("rejected: loop-plan-cli-unsupported:T1:");
    } finally { await s.cleanup(); }
  });

  it("a controlled CLI round refuses it with the same name", async () => {
    const s = await makeSandbox(), h = await openTestStore();
    try {
      await expect(new ControlService(h.store).run("g", await loopPlan(s))).rejects.toThrow("control-plan-rejected:loop-plan-cli-unsupported:T1");
    } finally { await h.dispose(); await s.cleanup(); }
  });
});
```

(`Sandbox` is the type `makeSandbox` returns; if `tests/scheduler/sandbox.ts` does not export it by that name, use `Awaited<ReturnType<typeof makeSandbox>>` — re-measure.)

- [ ] **Step 2: Run, expect FAIL**

```bash
./node_modules/.bin/vitest run tests/scheduler/planFileLoop.test.ts tests/scheduler/loopPlanCli.test.ts > "$SCRATCH/a3-red.txt" 2>&1; echo rc=$?
```
Expected `rc=1`: the loop task is `malformed` (`tasks.0.loop: Unrecognized key` / `tasks.0.contract: Required`), so `loads a task …` fails and the CLI criteria print `rejected: malformed:` instead of `loop-plan-cli-unsupported`.

- [ ] **Step 3: Implement**

`src/scheduler/planFile.ts`:
1. After line 10 add `import { expandLoopTask, loopPlanFileSchema, type LoopPlanFileInput, type LoopRecipe } from "../control/loopPlans.js";`
2. After `PlanTask` (line 21) add:
```ts
/**
 * Loop plans spec §3.1 (D3): a task that names a built-in loop plan instead of a contract file. Web import expands it
 * (readSchedulerControlPlanSource); every CLI consumer refuses it by name (run.ts loadRound, spec §3.4, C1).
 */
export interface LoopPlanTask {
  taskId: string;
  loop: LoopPlanFileInput;
  dependsOn: string[];
  targetVersion?: number;
  agent?: PartialSelection;
  labels?: string[];
}

export function isLoopPlanTask(task: PlanTask | LoopPlanTask): task is LoopPlanTask {
  return "loop" in task;
}
```
3. After `PlanFile` (line 36) add:
```ts
/** What loadPlan accepts (spec §3.1): either form of task. The CLI narrows it to a PlanFile once, in run.ts loadRound. */
export type LoadedPlanFile = Omit<PlanFile, "tasks"> & { tasks: Array<PlanTask | LoopPlanTask> };
```
4. In `SchedulerControlPlanSource.tasks` after `labels?: string[];` (line 48) add `    /** Loop plans spec §3.3: the recipe a loop task was expanded from; absent for a contract task. */\n    loop?: LoopRecipe;`
5. Replace `planTaskSchema` (lines 113-123) with:
```ts
const planTaskSchema = z
  .object({
    taskId: z.string().min(1),
    // Loop plans spec §3.1 (D3): exactly one of a contract file and a loop plan; both or neither is malformed.
    contract: z.string().min(1).optional(),
    loop: loopPlanFileSchema.optional(),
    dependsOn: z.array(z.string()),
    targetVersion: safeInteger.positive().optional(),
    agent: partialSelectionSchema.optional(),
    // Labels and progress spec §2.2: the vocabulary is checked here, at the input door; any order and duplicates in.
    labels: inputLabelsSchema.optional(),
  })
  .strict()
  .superRefine((task, ctx) => {
    if ((task.contract === undefined) === (task.loop === undefined)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "exactly-one-of-contract-or-loop" });
    }
  });

function loadedTask(task: z.infer<typeof planTaskSchema>): PlanTask | LoopPlanTask {
  const { contract, loop, ...rest } = task;
  // planTaskSchema's refinement admitted exactly one of the two.
  return contract !== undefined ? { ...rest, contract } : { ...rest, loop: loop! };
}

/** Loop plans spec §3.3: a loop task's expansion stands where a contract file's parse would. */
function expandPlanFileLoop(task: LoopPlanTask, targetRepo: string): { value: unknown; canonicalJson: string; hash: string; recipe: LoopRecipe } {
  const expanded = expandLoopTask(task.taskId, targetRepo, task.loop, task.labels ?? []);
  if (!expanded.ok) return sourceRejected(`loop-plan-invalid:${task.taskId}:${expanded.reason}`);
  return { value: expanded.contract, canonicalJson: expanded.canonicalJson, hash: expanded.hash, recipe: expanded.recipe };
}
```
   (`sourceRejected` is declared at line 211, below; a function declaration is hoisted.)
6. In `readSchedulerControlPlanSource` replace lines 264-276 (`tasks: plan.tasks.map(task => { … }),`) with:
```ts
    tasks: plan.tasks.map(task => {
      const original = isLoopPlanTask(task) ? expandPlanFileLoop(task, plan.targetRepo) : { ...parseContract(task.contract, task.taskId), recipe: undefined };
      return {
        taskId: task.taskId,
        dependencyTaskIds: [...task.dependsOn],
        targetVersion: task.targetVersion!,
        ...(task.agent ? { agent: task.agent } : {}),
        ...(task.labels && task.labels.length > 0 ? { labels: [...task.labels] } : {}),
        ...(original.recipe ? { loop: original.recipe } : {}),
        originalContract: original.value,
        originalContractCanonicalJson: original.canonicalJson,
        originalContractHash: original.hash,
      };
    }),
```
7. `loadPlan` (line 316): return type `{ plan: LoadedPlanFile } | { rejections: PlanRejection[] }`. Replace lines 336-338 with:
```ts
  for (const task of data.tasks) {
    // Loop plans spec §3.1: only a contract task names a file; a loop task has no path to check.
    if (task.contract !== undefined) pathFields.push([`tasks[${task.taskId}].contract`, task.contract]);
  }
```
   Replace line 367 `if (isInsideRepo(data.targetRepo, task.contract)) {` with `if (task.contract !== undefined && isInsideRepo(data.targetRepo, task.contract)) {`. Replace line 418 with `  return { plan: { ...data, policy: "local-merge", tasks: data.tasks.map(loadedTask) } };`.

`src/scheduler/graph.ts:33`: `export function detectCycle(tasks: PlanTask[]): boolean {` → `export function detectCycle(tasks: ReadonlyArray<Pick<PlanTask, "taskId" | "dependsOn">>): boolean {`.

`src/scheduler/run.ts`: the import at line 24 becomes `import { isLoopPlanTask, loadPlan } from "./planFile.js";`. Replace lines 159-160
```ts
  if ("rejections" in result) return result;
  const { plan } = result;
```
with
```ts
  if ("rejections" in result) return result;
  // Loop plans spec §3.4 (C1): a loop task names a recipe only Web import expands. Refused by name, before any contract
  // is read -- never dropped from the round.
  const loopRejections = result.plan.tasks.filter(isLoopPlanTask).map((task) => ({
    code: `loop-plan-cli-unsupported:${task.taskId}`,
    message: `task ${task.taskId} names a loop plan; loop plans run only through the Web panel (orca panel)`,
  }));
  if (loopRejections.length > 0) return { rejections: loopRejections };
  const plan: PlanFile = { ...result.plan, tasks: result.plan.tasks.filter((task): task is PlanTask => !isLoopPlanTask(task)) };
```
(`PlanFile` and `PlanTask` are already imported as types at line 25.)

`src/control/service.ts:50` and `:60`: `throw new ControlError("control-plan-rejected");` → `throw new ControlError("control-plan-rejected", loaded.rejections.map(rejection => rejection.code).join(","));` (both lines; keep each line's own indentation and `if` prefix).

- [ ] **Step 4: Run, expect PASS**

```bash
./node_modules/.bin/vitest run tests/scheduler/planFileLoop.test.ts tests/scheduler/loopPlanCli.test.ts tests/scheduler/planFile.test.ts tests/scheduler/graph.test.ts tests/scheduler/scenarios/inputRejections.test.ts tests/control/schedulerBridge.test.ts tests/control/agentPlanImport.test.ts tests/control/targetVersion.test.ts tests/control/planImport.test.ts > "$SCRATCH/a3-green.txt" 2>&1; echo rc=$?
npm run typecheck > "$SCRATCH/a3-tsc.txt" 2>&1; echo rc=$?
```
Expected both `rc=0` (the last seven files are existing criteria that must stay green).

- [ ] **Step 5: Mutations** (`$SCRATCH/mut-a3`; files: the five modified sources and two new tests; criterion files as named)
  - MA3-1 exactly-one rule deleted (the `.superRefine(…)` call removed). Red (`planFileLoop.test.ts`): `… > refuses a task with both of contract and loop as malformed` and `… with neither …`.
  - MA3-2 path check on a loop task: line `if (task.contract !== undefined) pathFields.push(…)` → `pathFields.push([\`tasks[${task.taskId}].contract\`, task.contract ?? ""]);`. Red: `… > runs the contract path checks on contract tasks only`.
  - MA3-3 contract-inside check on a loop task: `task.contract !== undefined && isInsideRepo(data.targetRepo, task.contract)` → `isInsideRepo(data.targetRepo, task.contract ?? data.targetRepo)`. Red: same criterion.
  - MA3-4 labels ignored at import: `task.labels ?? []` → `[]` in `expandPlanFileLoop`. Red: `Web import's source … > stores the expansion …`.
  - MA3-5 loop tasks dropped silently: delete `if (loopRejections.length > 0) return { rejections: loopRejections };`. Red (`loopPlanCli.test.ts`): all three criteria.
  - MA3-6 controlled round loses the name: `service.ts:50` detail removed again. Red: `… > a controlled CLI round refuses it with the same name`.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add src/scheduler/planFile.ts src/scheduler/graph.ts src/scheduler/run.ts src/control/service.ts tests/scheduler/planFileLoop.test.ts tests/scheduler/loopPlanCli.test.ts
/usr/bin/git commit -F - <<'EOF'
feat(scheduler): accept a plan-file task that names a loop plan

A task carries exactly one of contract and loop. Web import expands a loop
task into its original contract using the plan file's labels and targetRepo;
the contract path checks run on contract tasks only. Every CLI consumer goes
through loadRound, which refuses a loop task by name
(loop-plan-cli-unsupported:<taskId>) and narrows the plan to contract tasks;
controlled rounds now carry the rejection codes in their error detail.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GCbsgLfqFPgpeG3gTbBkbh
EOF
```

---

### Task A4: The recipe in the archived plan

**Files:**
- Modify: `src/control/webProtocol.ts` — imports (lines 1-6); `controlPlanSchema` task object (410-440; insert after line 432 `labels: nonEmptyStoredLabelsSchema.optional(),`)
- Modify: `src/control/planImport.ts:126` (insert after the `labels` spread in `normalizeControlPlan`)
- Modify: `tests/control/fixtures/web.ts:28` (`WebFixtureTask`), `:67` (task loop) — additive
- Create: `tests/control/loopPlanImport.test.ts`

**Interfaces:**
- Consumes: `loopRecipeSchema` (Task A1); `SchedulerControlPlanSource["tasks"][number].loop` (Task A3).
- Produces: `ControlPlanV1["tasks"][number]` gains `loop?: LoopRecipe`; `WebFixtureTask` gains `loop?: Record<string, unknown>` (the plan-file `loop` object written in place of a contract file).

- [ ] **Step 1: Write the failing criteria** — first the fixture (additive). In `tests/control/fixtures/web.ts` line 28 add `loop?: Record<string, unknown>` to `WebFixtureTask` (after `labels?: string[]`, with the comment `// Loop plans spec §3.1: a task that names a loop plan instead of a contract file.`). At the top of the `for (const task of tasks) {` body (line 67) insert:

```ts
    if (task.loop !== undefined) {
      // Loop plans spec §3.1 (D3): the plan file names the loop plan; import expands it (planFile.ts).
      planTasks.push({ taskId: task.taskId, loop: task.loop, dependsOn: task.dependsOn ?? [], targetVersion: task.targetVersion ?? 1, ...(task.agent ? { agent: task.agent } : {}), ...(task.labels ? { labels: task.labels } : {}) });
      continue;
    }
```

(`planTasks` is an untyped `[]` array whose element type TypeScript infers from the pushes; if the typecheck objects to the two shapes, declare it `const planTasks: Array<Record<string, unknown>> = [];` — a type-only change.)

Then `tests/control/loopPlanImport.test.ts`:

```ts
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sha256Canonical } from "../../src/control/canonicalJson.js";
import { expandRecipe } from "../../src/control/loopPlans.js";
import { readArchivedPlan } from "../../src/control/queries.js";
import { webFixture } from "./fixtures/web.js";

/**
 * Loop plans spec §3.3 (criterion 6, import half; R12): a loop task's recipe is archived inside its plan entry, so
 * planHash -- which reaches the proposal, the snapshot and the confirm check -- covers it, and the stored contract is
 * exactly the recipe's expansion. A hand-written task's entry gains no key: its archive bytes and planHash stay what
 * they were.
 */
const LOOP = { goal: "write a", successCondition: "a exists", targetPaths: ["a"], checks: ["true"] };

describe("Web import of a loop task (spec §3.3, criterion 6)", () => {
  it("archives the recipe with the task, and the stored contract is the recipe's expansion", async () => {
    const h = await webFixture(undefined, [{ taskId: "a", labels: ["bug"], loop: LOOP }]);
    try {
      const task = readArchivedPlan(h.store, "g").plan.tasks[0]!;
      expect(task.loop).toEqual({ schema: "orca-loop-recipe-v1", planId: "bugfix", planVersion: 1, chosenBy: "labels",
        inputs: { ...LOOP, nonGoals: [], relevantDocs: [], protectedPaths: [], maxFilesTouched: null } });
      const repoPath = JSON.parse(task.originalContractCanonicalJson).context.repoPath;
      expect(repoPath).toBe(join(h.root, "repo"));
      const again = expandRecipe("a", repoPath, task.loop!);
      expect(again.ok && again.canonicalJson).toBe(task.originalContractCanonicalJson);
    } finally { await h.dispose(); }
  });

  it("puts the recipe under planHash: the same plan without it hashes differently", async () => {
    const h = await webFixture(undefined, [{ taskId: "a", loop: LOOP }]);
    try {
      const archived = readArchivedPlan(h.store, "g");
      expect(sha256Canonical(archived.plan)).toBe(archived.planHash);
      const withoutRecipe = { ...archived.plan, tasks: archived.plan.tasks.map(({ loop: _loop, ...task }) => task) };
      expect(sha256Canonical(withoutRecipe)).not.toBe(archived.planHash);
    } finally { await h.dispose(); }
  });

  it("gives a hand-written task's archived entry no loop key", async () => {
    const h = await webFixture(undefined, [{ taskId: "a" }]);
    try { expect(Object.keys(readArchivedPlan(h.store, "g").plan.tasks[0]!)).not.toContain("loop"); }
    finally { await h.dispose(); }
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
./node_modules/.bin/vitest run tests/control/loopPlanImport.test.ts > "$SCRATCH/a4-red.txt" 2>&1; echo rc=$?
```
Expected `rc=1`: `archives the recipe …` gets `task.loop` undefined (normalizeControlPlan drops it), and `puts the recipe under planHash …` finds the two hashes equal.

- [ ] **Step 3: Implement**
  - `src/control/webProtocol.ts`: after line 3 add `import { loopRecipeSchema } from "./loopPlans.js";`. After line 432 insert:
    ```ts
          // Loop plans spec §3.3 (R12): the recipe a loop task was expanded from, inside the entry planHash covers. Optional
          // and never defaulted, for the reason given for labels above.
          loop: loopRecipeSchema.optional(),
    ```
  - `src/control/planImport.ts`: after line 126 (`...(task.labels && task.labels.length > 0 ? { labels: [...task.labels] } : {}),`) insert `      // Loop plans spec §3.3: written only for a loop task, like labels.\n      ...(task.loop ? { loop: task.loop } : {}),`.

- [ ] **Step 4: Run, expect PASS**

```bash
./node_modules/.bin/vitest run tests/control/loopPlanImport.test.ts tests/control/planImport.test.ts tests/control/webProtocol.test.ts tests/control/taskLabels.test.ts tests/control/estimator.test.ts > "$SCRATCH/a4-green.txt" 2>&1; echo rc=$?
npm run typecheck > "$SCRATCH/a4-tsc.txt" 2>&1; echo rc=$?
```
Expected both `rc=0`.

- [ ] **Step 5: Mutations** (`$SCRATCH/mut-a4`; files `src/control/webProtocol.ts src/control/planImport.ts tests/control/fixtures/web.ts tests/control/loopPlanImport.test.ts`; criterion file `tests/control/loopPlanImport.test.ts`)
  - MA4-1 recipe not archived: delete the `...(task.loop ? { loop: task.loop } : {}),` line. Red: `… > archives the recipe with the task …` and `… > puts the recipe under planHash …`.
  - MA4-2 recipe key written for every task: `...(task.loop ? { loop: task.loop } : {})` → `loop: task.loop ?? null`. Red: `… > gives a hand-written task's archived entry no loop key` (the strict schema refuses `null`, so that import is refused and the fixture throws).

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add src/control/webProtocol.ts src/control/planImport.ts tests/control/fixtures/web.ts tests/control/loopPlanImport.test.ts
/usr/bin/git commit -F - <<'EOF'
feat(control): archive a loop task's recipe inside its plan entry

The control plan's task entry gains an optional loop recipe, written only for
loop tasks, so planHash covers it and a hand-written task's archive bytes are
unchanged. The Web test fixture can now write a loop task.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GCbsgLfqFPgpeG3gTbBkbh
EOF
```

---

### Task A5: The projection's recipe check and the `loopPlan` view

**Files:**
- Modify: `src/control/webProtocol.ts` — import (line added in A4); add `loopPlanViewSchema` before `workItemViewSchema` (930); two fields after line 951 (`progress: …`)
- Modify: `src/panel/controlViews.ts` — imports (1-43); `workBodySchema` (64-80); new `taskPlanView` before `workViews` (468); `workViews` return object (after line 521)
- Modify: `web/src/controlTypes.ts` — `WorkItemViewV1` (76-97, after line 96); new types appended after line 334
- Create: `tests/control/loopPlanView.test.ts`, `tests/control/loopPlanDrift.test.ts`

**Interfaces:**
- Consumes: `LOOP_PLAN_IDS`, `loopInputsSchema`, `expandRecipe`, `describeLoopPlan`, `choosePlanByLabels` (A1, A2).
- Produces:
  ```ts
  // src/control/webProtocol.ts
  export const loopPlanViewSchema: z.ZodObject<...>;
  // WorkItemViewV1 gains:
  //   loopPlan?: { planId: LoopPlanId; planVersion: number; planName: string; chosenBy: "explicit" | "labels"; chosenByLabel: string | null;
  //                amended: boolean; loopVersion: number; inputs: LoopInputs; summary: string[] } | null;
  //   objective?: { goal: string; successCondition: string };
  // web/src/controlTypes.ts
  export type LoopPlanIdV1 = "standard" | "bugfix" | "refactor" | "design" | "investigate";
  export type LoopInputsV1 = { goal: string; successCondition: string; targetPaths: string[]; checks: string[]; nonGoals: string[]; relevantDocs: string[]; protectedPaths: string[]; maxFilesTouched: number | null };
  export type LoopPlanViewV1 = { planId: LoopPlanIdV1; planVersion: number; planName: string; chosenBy: "explicit" | "labels"; chosenByLabel: string | null; amended: boolean; loopVersion: number; inputs: LoopInputsV1; summary: string[] };
  ```
  A task whose recipe does not re-expand to its contract bytes makes `readControlGroup` throw `ControlError("recovery-blocked", "loop-plan-recipe-mismatch:<taskId>")`.

- [ ] **Step 1: Write the failing criteria**

`tests/control/loopPlanView.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { describeLoopPlan } from "../../src/control/loopPlans.js";
import { readArchivedPlan } from "../../src/control/queries.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { webFixture } from "./fixtures/web.js";

/**
 * Loop plans spec §4.1 (D9, C7): the task view names its loop plan in plain words, built server-side from the recipe;
 * a hand-written task has no plan but still shows its contract's goal and success condition.
 */
const LOOP = { goal: "fix login", successCondition: "the login test passes", targetPaths: ["a"], checks: ["npm test"] };

describe("a task's plan in the group view (spec §4.1)", () => {
  it("shows the plan, how it was chosen and its summary lines for a loop task", async () => {
    const h = await webFixture(undefined, [{ taskId: "a", labels: ["bug", "custom:x"], loop: LOOP }]);
    try {
      const recipe = readArchivedPlan(h.store, "g").plan.tasks[0]!.loop!;
      const item = readControlGroup(h.store, "epoch", "g").workItems[0]!;
      expect(item.loopPlan).toEqual({
        planId: "bugfix", planVersion: 1, planName: "修 bug（先红后绿）", chosenBy: "labels", chosenByLabel: "bug",
        amended: false, loopVersion: 0, inputs: recipe.inputs, summary: describeLoopPlan(recipe)!.summary,
      });
      expect(item.objective).toEqual({ goal: "fix login", successCondition: "the login test passes" });
    } finally { await h.dispose(); }
  });

  it("names no label for a plan the plan file named", async () => {
    const h = await webFixture(undefined, [{ taskId: "a", labels: ["bug"], loop: { ...LOOP, plan: "standard" } }]);
    try {
      expect(readControlGroup(h.store, "epoch", "g").workItems[0]!.loopPlan).toMatchObject({ planId: "standard", chosenBy: "explicit", chosenByLabel: null });
    } finally { await h.dispose(); }
  });

  it("shows a hand-written task as no plan, with its contract's goal and success condition", async () => {
    const h = await webFixture(undefined, [{ taskId: "a" }]);
    try {
      const item = readControlGroup(h.store, "epoch", "g").workItems[0]!;
      expect(item.loopPlan).toBeNull();
      expect(item.objective).toEqual({ goal: "ship", successCondition: "passes" });
    } finally { await h.dispose(); }
  });
});
```

`tests/control/loopPlanDrift.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

/**
 * Loop plans spec §3.3 (criterion 6: "a tampered recipe blocks the task in the projection"). planHash makes the archived
 * recipe itself tamper-evident (readArchivedPlan); what is left is the registry drifting under an archived recipe -- a
 * plan's text edited in place instead of versioned (spec §2.2). That is simulated here: every expandRecipe the
 * projection calls expands a changed goal, so the recipe no longer re-expands to the stored contract bytes.
 */
const state = vi.hoisted(() => ({ drift: false }));
vi.mock("../../src/control/loopPlans.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/control/loopPlans.js")>();
  return {
    ...real,
    expandRecipe: (...[taskId, repoPath, recipe]: Parameters<typeof real.expandRecipe>) =>
      real.expandRecipe(taskId, repoPath, state.drift ? { ...recipe, inputs: { ...recipe.inputs, goal: `${recipe.inputs.goal} (edited in place)` } } : recipe),
  };
});

import { readControlGroup } from "../../src/panel/controlViews.js";
import { webFixture } from "./fixtures/web.js";

const LOOP = { plan: "bugfix", goal: "fix login", successCondition: "the login test passes", targetPaths: ["a"], checks: ["npm test"] };

describe("a recipe that no longer re-expands to its task's contract (spec §3.3, criterion 6)", () => {
  it("blocks the loop task by name", async () => {
    const h = await webFixture(undefined, [{ taskId: "a", loop: LOOP }]);
    try {
      state.drift = false;
      expect(readControlGroup(h.store, "epoch", "g").workItems[0]!.loopPlan).toMatchObject({ planId: "bugfix" });
      state.drift = true;
      expect(() => readControlGroup(h.store, "epoch", "g")).toThrow("recovery-blocked:loop-plan-recipe-mismatch:a");
    } finally { state.drift = false; await h.dispose(); }
  });

  it("leaves a hand-written task's view alone", async () => {
    const h = await webFixture(undefined, [{ taskId: "a" }]);
    try {
      state.drift = true;
      expect(readControlGroup(h.store, "epoch", "g").workItems[0]!.loopPlan).toBeNull();
    } finally { state.drift = false; await h.dispose(); }
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
./node_modules/.bin/vitest run tests/control/loopPlanView.test.ts tests/control/loopPlanDrift.test.ts > "$SCRATCH/a5-red.txt" 2>&1; echo rc=$?
```
Expected `rc=1`: `item.loopPlan` and `item.objective` are `undefined`; the drift criterion does not throw.

- [ ] **Step 3: Implement**
  - `src/control/webProtocol.ts`: extend the A4 import to `import { LOOP_PLAN_IDS, loopInputsSchema, loopRecipeSchema } from "./loopPlans.js";`. Before `export const workItemViewSchema = z` (line 930) insert:
    ```ts
    // Loop plans spec §4.1 (D9, C7): a loop task's plan in plain words, built server-side from its effective recipe.
    // chosenByLabel is the plan file's label that chose it (spec §2.4); loopVersion is what set-task-loop must name.
    export const loopPlanViewSchema = z
      .object({
        planId: z.enum(LOOP_PLAN_IDS),
        planVersion: positiveSafeInteger,
        planName: nonemptyString,
        chosenBy: z.enum(["explicit", "labels"]),
        chosenByLabel: nonemptyString.nullable(),
        amended: z.boolean(),
        loopVersion: safeInteger,
        inputs: loopInputsSchema,
        summary: z.array(nonemptyString).min(1),
      })
      .strict();
    ```
    After line 951 (`progress: workItemProgressSchema.nullable().optional(),`) insert:
    ```ts
        // Loop plans spec §4.1: null for a hand-written contract. Optional on the wire like labels; the server always gives it.
        loopPlan: loopPlanViewSchema.nullable().optional(),
        // Loop plans spec §4.1 (Drafter finding F4): the effective contract's goal and success condition.
        objective: z.object({ goal: nonemptyString, successCondition: nonemptyString }).strict().optional(),
    ```
  - `src/panel/controlViews.ts`: add `import { choosePlanByLabels, describeLoopPlan, expandRecipe } from "../control/loopPlans.js";` after the `labels.js` import (line 11). In `workBodySchema`, before its closing `}).passthrough();` (line 80), insert:
    ```ts
      // Loop plans spec §5.1: a loop task's amendment and version; absent until its first set-task-loop.
      amendmentHash: hashSchema.nullable().optional(),
      loopVersion: safeInteger.optional(),
    ```
    Before `function workViews(` (line 468) insert:
    ```ts
    /**
     * Loop plans spec §3.3, §4.1 (C7): the task's plan as its card shows it. The recipe must re-expand to the contract bytes
     * the task carries (repoPath excepted: it is the stored contract's own, Drafter finding F9). A registry that no longer
     * does -- a plan's text edited instead of versioned, spec §2.2 -- blocks the task by name rather than showing a plan
     * that is not the one that runs.
     */
    function taskPlanView(
      task: ReturnType<typeof readArchivedPlan>["plan"]["tasks"][number],
      body: { amendmentHash?: string | null; loopVersion?: number },
    ): { loopPlan: WorkItemViewV1["loopPlan"]; objective: WorkItemViewV1["objective"] } {
      const contract = parseStored(taskContractSchema, task.originalContractCanonicalJson, `original-contract-invalid:${task.taskId}`);
      const objective = { goal: contract.objective.goal, successCondition: contract.objective.successCondition };
      if (task.loop === undefined) return { loopPlan: null, objective };
      const expanded = expandRecipe(task.taskId, contract.context.repoPath, task.loop);
      if (!expanded.ok || expanded.canonicalJson !== task.originalContractCanonicalJson) return blocked(`loop-plan-recipe-mismatch:${task.taskId}`);
      // expandRecipe found the recipe's plan version, so describeLoopPlan cannot answer null here.
      const described = describeLoopPlan(task.loop)!;
      return {
        objective,
        loopPlan: {
          planId: task.loop.planId, planVersion: task.loop.planVersion, planName: described.planName, chosenBy: task.loop.chosenBy,
          chosenByLabel: task.loop.chosenBy === "labels" ? choosePlanByLabels(task.labels ?? []).label : null,
          amended: typeof body.amendmentHash === "string", loopVersion: body.loopVersion ?? 0,
          inputs: task.loop.inputs, summary: described.summary,
        },
      };
    }
    ```
    In `workViews`' returned object, after line 521 (`progress: currentProgress(runs, body.currentRunId ?? null),`) insert `      ...taskPlanView(task, body),`.
  - `web/src/controlTypes.ts`: after line 96 (`progress?: WorkItemProgressV1 | null;`) insert:
    ```ts
      // Loop plans spec §4.1: optional here so literal fixtures need no edit; the server always sends both.
      loopPlan?: LoopPlanViewV1 | null;
      objective?: { goal: string; successCondition: string };
    ```
    Append at the end of the file:
    ```ts
    /** Loop plans spec §2.2: the built-in plans (mirrors src/control/loopPlans.ts LOOP_PLAN_IDS). */
    export type LoopPlanIdV1 = "standard" | "bugfix" | "refactor" | "design" | "investigate";
    /** Loop plans spec §3.2: a recipe's inputs, every optional field filled. */
    export type LoopInputsV1 = { goal: string; successCondition: string; targetPaths: string[]; checks: string[]; nonGoals: string[]; relevantDocs: string[]; protectedPaths: string[]; maxFilesTouched: number | null };
    /** Loop plans spec §4.1: the server-built description of a loop task's plan. */
    export type LoopPlanViewV1 = {
      planId: LoopPlanIdV1; planVersion: number; planName: string; chosenBy: "explicit" | "labels"; chosenByLabel: string | null;
      amended: boolean; loopVersion: number; inputs: LoopInputsV1; summary: string[];
    };
    ```

- [ ] **Step 4: Run, expect PASS**

```bash
./node_modules/.bin/vitest run tests/control/loopPlanView.test.ts tests/control/loopPlanDrift.test.ts tests/control/taskLabels.test.ts tests/panel/webParity.test.ts tests/panel/controlReadApi.test.ts tests/control/confirmation.test.ts > "$SCRATCH/a5-green.txt" 2>&1; echo rc=$?
npm run typecheck > "$SCRATCH/a5-tsc.txt" 2>&1; echo rc=$?
(cd web && ../node_modules/.bin/tsc --noEmit -p tsconfig.json) > "$SCRATCH/a5-web-tsc.txt" 2>&1; echo rc=$?
```
Expected all `rc=0` (`webParity.test.ts` is compiled by `npm run typecheck`: the view mirror must be assignable both ways).

- [ ] **Step 5: Mutations** (`$SCRATCH/mut-a5`; files: the three modified sources, `web/src/controlTypes.ts`, two new tests; criterion files as named)
  - MA5-1 recipe check dropped: delete the `if (!expanded.ok || expanded.canonicalJson !== task.originalContractCanonicalJson) return blocked(…);` line. Red (`loopPlanDrift.test.ts`): `… > blocks the loop task by name`.
  - MA5-2 no plan shown: replace `if (task.loop === undefined) return { loopPlan: null, objective };` with `return { loopPlan: null, objective };`. Red (`loopPlanView.test.ts`): `… > shows the plan, how it was chosen …` and `… > names no label …`.
  - MA5-3 label lost: `task.loop.chosenBy === "labels" ? choosePlanByLabels(task.labels ?? []).label : null` → `null`. Red: `… > shows the plan, how it was chosen …`.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add src/control/webProtocol.ts src/panel/controlViews.ts web/src/controlTypes.ts tests/control/loopPlanView.test.ts tests/control/loopPlanDrift.test.ts
/usr/bin/git commit -F - <<'EOF'
feat(panel): show a task's loop plan and check its recipe in the projection

Each work item view gains loopPlan (null for a hand-written contract) and the
contract's objective. The projection re-expands every loop recipe and blocks
the task by name (loop-plan-recipe-mismatch) when the bytes differ, so the
panel never describes a plan other than the one that runs.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GCbsgLfqFPgpeG3gTbBkbh
EOF
```

---

### Task A6: The read-only plan card and the list chip

**Files:**
- Create: `web/src/LoopPlanCard.tsx`
- Modify: `web/src/TaskDetail.tsx` — imports (11-15); render (insert before `      <h5>Runs of {item.taskId}</h5>`, ~line 161)
- Modify: `web/src/ControlGroupView.tsx:130`
- Create: `web/tests/loopPlanCard.test.tsx`

**Interfaces:**
- Consumes: `LoopPlanViewV1`, `WorkItemViewV1.loopPlan`/`objective`, `GroupViewV1` (Task A5).
- Produces:
  ```ts
  export function loopPlanTitle(plan: LoopPlanViewV1): string;
  export interface LoopPlanCardProps { view: GroupViewV1; item: WorkItemViewV1 }
  export function LoopPlanCard(props: LoopPlanCardProps): JSX.Element | null;  // null when the view says nothing (loopPlan undefined)
  ```

- [ ] **Step 1: Write the failing criteria** — `web/tests/loopPlanCard.test.tsx`:

```tsx
// @vitest-environment jsdom
/**
 * Loop plans spec §4.1 (D1, D9): the card shows the plan's title, the server's summary lines, the check commands
 * collapsed, the work budget and the two dimensions the contract cannot express as fixed; a hand-written task shows its
 * goal and success condition; the task list names the plan next to the labels.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { TaskDetail } from "../src/TaskDetail.js";
import type { Amount, ControlConfigV1, GroupViewV1, LoopPlanViewV1, WorkItemViewV1 } from "../src/controlTypes.js";

const amount = (tokens: number): Amount => ({ tokens, activeMs: 14_400_000, attempts: 3, sessions: 3 });
const human = { provenance: "human", estimateId: null } as const;
const provenance = { tokens: human, activeMs: human, attempts: human, sessions: human };
const capability = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } as const;
const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a", repositories: [{ repoId: "orca", displayName: "Orca" }],
  plans: [{ planId: "plan-demo", repoId: "orca", displayName: "Demo plan" }],
  profiles: [{ profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds: ["task", "budget-estimate", "handoff", "goal-review"], contextTokenizer: null, workMaxOutputTokens: 1000, declared: capability, observed: capability, observedAt: "2026-09-29T00:00:00.000Z", probeFailureCode: null }],
  defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" }, executionPort: "configured", errorCatalog: [],
};
const PLAN: LoopPlanViewV1 = {
  planId: "bugfix", planVersion: 1, planName: "修 bug（先红后绿）", chosenBy: "labels", chosenByLabel: "bug", amended: false, loopVersion: 0,
  inputs: { goal: "fix login", successCondition: "the login test passes", targetPaths: ["src/auth/**"], checks: ["npm test -- --run auth"], nonGoals: [], relevantDocs: [], protectedPaths: [], maxFilesTouched: null },
  summary: ["目标：fix login", "完成条件：the login test passes", "只改：src/auth/**", "最多改 25 个文件（由 agent 自报）", "验收：运行 1 条检查命令，全部通过", "先写能复现的失败测试再修（由模型核对，不是机械证明）"],
};
const item = (over: Partial<WorkItemViewV1> = {}): WorkItemViewV1 => ({
  taskId: "a", status: "ready", dependencyTaskIds: [], targetVersion: 1, configHash: "d".repeat(64), originalContractHash: "e".repeat(64),
  derivedContractHash: "f".repeat(64), currentRunId: null, pendingRunId: null, lineageRunIds: [], labels: ["bug"], labelsProvenance: "plan", labelsVersion: 0,
  progress: null, objective: { goal: "fix login", successCondition: "the login test passes" }, loopPlan: PLAN, ...over,
});
const view = (items: WorkItemViewV1[]): GroupViewV1 => ({
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 4,
  summary: { groupId: "g", state: "ready", commandRevision: 6, projectionSeq: 4, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 },
  graphVersion: 1, plan: { repoId: "orca", planId: "plan-demo", planHash: "a".repeat(64), goal: "Ship", successConditions: ["done"] },
  proposal: { state: "editable", proposalVersion: 2, planHash: "a".repeat(64), budgetMode: null, contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: null },
  ledger: { groupLimit: amount(9_000_000), used: amount(0), committedRemaining: amount(3_000_000), explicitUnallocatedReserve: amount(6_000_000), budgetDeficit: amount(0), usageUnknown: false },
  allocations: [{ ownerKind: "task", ownerId: "a", bucket: "work", state: "draft-encumbered", amount: amount(3_000_000), fieldProvenance: provenance }],
  workItems: items, estimates: [], runs: [], checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [],
});
const detail = (items: WorkItemViewV1[]) => render(<TaskDetail view={view(items)} item={items[0]!} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);

afterEach(cleanup);

describe("the loop plan card (spec §4.1)", () => {
  it("titles the card with the plan, its version and how it was chosen, and lists the server's lines", () => {
    detail([item()]);
    expect(screen.getByRole("heading", { name: "修 bug（先红后绿） · v1 · 按标签 `bug` 选择" })).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "做法摘要 a" })).getAllByRole("listitem").map((line) => line.textContent)).toEqual(PLAN.summary);
  });

  it("keeps the check commands collapsed", () => {
    detail([item()]);
    const details = screen.getByText("npm test -- --run auth").closest("details");
    expect(details).not.toBeNull();
    expect(details!.open).toBe(false);
  });

  it("shows the work budget and the two dimensions the contract cannot express (D1)", () => {
    const text = detail([item()]).container.textContent ?? "";
    expect(text).toContain("预算：3000000 token · 活跃时间 14400000 ms · 最多尝试次数 3");
    expect(text).toContain("git 工作区：独立 worktree，合回 orca/g 分支，push 由人做");
    expect(text).toContain("skill 集：暂不支持");
  });

  it("says 人指定 and 已修改 when they hold", () => {
    detail([item({ loopPlan: { ...PLAN, chosenBy: "explicit", chosenByLabel: null, amended: true } })]);
    expect(screen.getByRole("heading", { name: "修 bug（先红后绿） · v1 · 人指定 · 已修改" })).toBeTruthy();
  });

  it("shows a hand-written task's goal and success condition", () => {
    const text = detail([item({ loopPlan: null, objective: { goal: "ship", successCondition: "passes" } })]).container.textContent ?? "";
    expect(screen.getByRole("heading", { name: "手写契约" })).toBeTruthy();
    expect(text).toContain("目标：ship");
    expect(text).toContain("完成条件：passes");
  });

  it("puts the plan's name next to the labels in the task list", () => {
    render(<ControlGroupView view={view([item()])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(document.querySelector("td span.plan-chip")?.textContent?.trim()).toBe("修 bug（先红后绿）");
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
(cd web && ../node_modules/.bin/vitest run tests/loopPlanCard.test.tsx) > "$SCRATCH/a6-red.txt" 2>&1; echo rc=$?
```
Expected `rc=1`: no heading, list or chip exists.

- [ ] **Step 3: Implement** — create `web/src/LoopPlanCard.tsx`:

```tsx
/**
 * Loop plans spec §4.1 (D1, D9): a task's loop plan in plain words -- the title, the server's summary lines, the check
 * commands collapsed, the work budget, and the two dimensions the contract cannot express shown as fixed. A hand-written
 * task shows its contract's goal and success condition. Read-only; the edit form is added by plan Task B6.
 */
import type { JSX } from "react";
import type { GroupViewV1, LoopPlanViewV1, WorkItemViewV1 } from "./controlTypes.js";

/** "修 bug（先红后绿） · v1 · 按标签 `bug` 选择 · 已修改" (spec §4.1). */
export function loopPlanTitle(plan: LoopPlanViewV1): string {
  const how = plan.chosenBy === "explicit" ? "人指定" : plan.chosenByLabel === null ? "无标签，按默认" : `按标签 \`${plan.chosenByLabel}\` 选择`;
  return `${plan.planName} · v${plan.planVersion} · ${how}${plan.amended ? " · 已修改" : ""}`;
}

export interface LoopPlanCardProps { view: GroupViewV1; item: WorkItemViewV1 }

export function LoopPlanCard(props: LoopPlanCardProps): JSX.Element | null {
  const { view, item } = props;
  // A view that says nothing about the plan (an older server, a literal fixture) gets no card rather than a wrong one.
  if (item.loopPlan === undefined) return null;
  if (item.loopPlan === null) {
    return (
      <section aria-label={`做法 ${item.taskId}`}>
        <h5>手写契约</h5>
        {item.objective !== undefined && (
          <ul>
            <li>目标：{item.objective.goal}</li>
            <li>完成条件：{item.objective.successCondition}</li>
          </ul>
        )}
      </section>
    );
  }
  const plan = item.loopPlan;
  const work = view.allocations.find((row) => row.ownerKind === "task" && row.ownerId === item.taskId && row.bucket === "work");
  return (
    <section aria-label={`做法 ${item.taskId}`}>
      <h5>{loopPlanTitle(plan)}</h5>
      <ul aria-label={`做法摘要 ${item.taskId}`}>
        {plan.summary.map((line, index) => <li key={index}>{line}</li>)}
      </ul>
      <details>
        <summary>检查命令（{plan.inputs.checks.length} 条）</summary>
        <ul>{plan.inputs.checks.map((check, index) => <li key={index}><code>{check}</code></li>)}</ul>
      </details>
      {work !== undefined && <p>预算：{work.amount.tokens} token · 活跃时间 {work.amount.activeMs} ms · 最多尝试次数 {work.amount.attempts}</p>}
      <p>git 工作区：独立 worktree，合回 <code>orca/{view.summary.groupId}</code> 分支，push 由人做</p>
      <p>skill 集：暂不支持</p>
    </section>
  );
}
```

  `web/src/TaskDetail.tsx`: add `import { LoopPlanCard } from "./LoopPlanCard.js";` after line 15; insert `      <LoopPlanCard view={view} item={item} />` on the line before `      <h5>Runs of {item.taskId}</h5>`.
  `web/src/ControlGroupView.tsx:130`: `<td><LabelChips labels={item.labels} /></td>` → `<td><LabelChips labels={item.labels} />{item.loopPlan ? <span className="plan-chip"> {item.loopPlan.planName}</span> : null}</td>` (class `plan-chip`, not `label …`: `web/tests/taskLabels.test.tsx` collects `td span.label`).

- [ ] **Step 4: Run, expect PASS**

```bash
(cd web && ../node_modules/.bin/vitest run tests/loopPlanCard.test.tsx tests/taskLabels.test.tsx tests/taskLabelsDraft.test.tsx tests/taskLabelsDraftBase.test.tsx tests/controlPanel.test.tsx) > "$SCRATCH/a6-green.txt" 2>&1; echo rc=$?
(cd web && ../node_modules/.bin/tsc --noEmit -p tsconfig.json) > "$SCRATCH/a6-web-tsc.txt" 2>&1; echo rc=$?
```
Expected both `rc=0`.

- [ ] **Step 5: Mutations** (`$SCRATCH/mut-a6`; files `web/src/LoopPlanCard.tsx web/src/TaskDetail.tsx web/src/ControlGroupView.tsx web/tests/loopPlanCard.test.tsx`; criterion: `(cd "$M/web" && ../node_modules/.bin/vitest run tests/loopPlanCard.test.tsx)`)
  - MA6-1 commands not collapsed: replace the `<details> … </details>` block with its inner `<ul>…</ul>`. Red: `… > keeps the check commands collapsed`.
  - MA6-2 no chip: revert `ControlGroupView.tsx:130`. Red: `… > puts the plan's name next to the labels …`.
  - MA6-3 hand-written task shows nothing: `if (item.loopPlan === undefined) return null;` → `if (!item.loopPlan) return null;`. Red: `… > shows a hand-written task's goal …`.
  - MA6-4 fixed lines dropped: delete the `git 工作区` paragraph. Red: `… > shows the work budget and the two dimensions …`.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add web/src/LoopPlanCard.tsx web/src/TaskDetail.tsx web/src/ControlGroupView.tsx web/tests/loopPlanCard.test.tsx
/usr/bin/git commit -F - <<'EOF'
feat(web): show a task's loop plan on its card and in the task list

The task detail shows the plan's title, the server's summary lines, the check
commands collapsed, the work budget and the fixed git and skill lines; a
hand-written task shows its goal and success condition. The task list names
the plan next to the labels.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GCbsgLfqFPgpeG3gTbBkbh
EOF
```

---

### Task A7 (controller): Part A gate

**Files:** none changed.

- [ ] **Step 1: Criteria of Part A, in the main tree**

```bash
./node_modules/.bin/vitest run tests/control/loopPlans.test.ts tests/control/loopPlanSummary.test.ts tests/scheduler/planFileLoop.test.ts tests/scheduler/loopPlanCli.test.ts tests/control/loopPlanImport.test.ts tests/control/loopPlanView.test.ts tests/control/loopPlanDrift.test.ts > "$SCRATCH/a7-criteria.txt" 2>&1; echo rc=$?
(cd web && ../node_modules/.bin/vitest run tests/loopPlanCard.test.tsx) > "$SCRATCH/a7-web.txt" 2>&1; echo rc=$?
npm run typecheck > "$SCRATCH/a7-tsc.txt" 2>&1; echo rc=$?
(cd web && ../node_modules/.bin/tsc --noEmit -p tsconfig.json) > "$SCRATCH/a7-web-tsc.txt" 2>&1; echo rc=$?
```
All `rc=0`.

- [ ] **Step 2: Full suite in a fresh clone** (the controller's own gate procedure: `git clone --local` of the Part A tip, `npm run build --workspace web`, `ORCA_CCLOOP_BIN` pointing at a built ccloop clone, HOME and XDG roots relocated, `vitest run --reporter=json`, web `npm run check`, `npm run verify:panel`, `~/.orca` stat before/after `cmp`). Pass: `rc=0`, zero pending, failures only the registered load flakes (single-file rerun green). Any other red existing criterion ⇒ stop and report it by name (spec §7).
- [ ] **Step 3: Rerun the Part A mutation table** (MA1-1 … MA6-4) once on a clone of the gate commit and record `mutation | predicted red | actual red (full name) | restore cmp rc`.

---

# Part B — amendments, `set-task-loop`, the editable card

### Task B1: Amendment records and the effective-contract reader

**Files:**
- Create: `src/control/taskAmendments.ts`
- Modify: `src/control/executionSnapshot.ts` — imports (1-19); `verifyTaskSet` loop head (line 109); `readConfirmedTaskExecution` (line 293)
- Modify: `src/control/queries.ts:140-141` (`readArchivedContract`)
- Modify: `src/control/webService.ts:465` (confirm's `tasks`), imports (line 8 area)
- Modify: `src/panel/controlViews.ts` — imports; `readControlGroup` (lines 685-708)
- Create: `tests/control/taskAmendments.test.ts`

**Interfaces:**
- Consumes: `expandRecipe`, `loopRecipeSchema` (A1); `readCanonicalRecord`, `writeCanonicalRecord` (`src/control/snapshot.ts`); `taskContractSchema` (`src/scheduler/planFile.ts`); `ControlPlanV1` (`src/control/webProtocol.ts`).
- Produces:
  ```ts
  export const TASK_AMENDMENT_SCHEMA: "orca-task-amendment-v1";
  export const taskAmendmentSchema: z.ZodObject<...>;
  export type TaskAmendment = z.infer<typeof taskAmendmentSchema>;
  export type ArchivedPlanTask = ControlPlanV1["tasks"][number];
  export function writeTaskAmendment(store: ControlStore, groupId: string, amendment: TaskAmendment): string; // the record's hash
  export function workBodyOf(store: ControlStore, groupId: string, taskId: string): unknown;                  // null if no row / unparsable
  export function effectivePlanTask(store: ControlStore, groupId: string, archived: ArchivedPlanTask, work: unknown): ArchivedPlanTask;
  ```
  `effectivePlanTask` returns `archived` itself when `work` is not an object or carries no `amendmentHash`; otherwise the entry with the record's `loop`, `originalContractHash`, `originalContractCanonicalJson`; any failed check throws `ControlError("recovery-blocked", "task-amendment-invalid:<taskId>")`.

- [ ] **Step 1: Write the failing criteria** — `tests/control/taskAmendments.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readConfirmedTaskExecution } from "../../src/control/executionSnapshot.js";
import { expandLoopPlan } from "../../src/control/loopPlans.js";
import { readArchivedContract, readArchivedPlan } from "../../src/control/queries.js";
import { writeCanonicalRecord } from "../../src/control/snapshot.js";
import { effectivePlanTask, writeTaskAmendment, type TaskAmendment } from "../../src/control/taskAmendments.js";
import { WebControlService } from "../../src/control/webService.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { webFixture } from "./fixtures/web.js";

/**
 * Loop plans spec §5.1 (C5; criterion 13): a change never rewrites the archived plan (its planHash reaches the proposal,
 * the snapshot, the confirm check and estimate validity). It is a hashed amendment record, and every reader of a task's
 * original contract -- the confirm path, A2, the single-task reader and the projection -- reads the task as amended,
 * after verifying the record. A record that does not verify blocks the task; it never silently falls back.
 */
type Fixture = Awaited<ReturnType<typeof webFixture>>;
const loop = (taskId: string) => ({ plan: "standard", goal: `write ${taskId}`, successCondition: `${taskId} exists`, targetPaths: [taskId], checks: ["true"] });
const workBody = (h: Fixture, taskId: string): Record<string, unknown> =>
  JSON.parse(String(h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body));
const writeWork = (h: Fixture, taskId: string, patch: Record<string, unknown>): void => {
  h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id=?").run(JSON.stringify({ ...workBody(h, taskId), ...patch }), taskId);
};
/** A well-formed amendment of `taskId` to `goal` (what set-task-loop writes, plan Task B2), with `over` applied. */
function amendment(h: Fixture, taskId: string, goal: string, over: Partial<TaskAmendment> = {}): TaskAmendment {
  const archived = readArchivedPlan(h.store, "g").plan.tasks.find((task) => task.taskId === taskId)!;
  const repoPath = JSON.parse(archived.originalContractCanonicalJson).context.repoPath;
  const expanded = expandLoopPlan(taskId, repoPath, "standard", { ...archived.loop!.inputs, goal });
  if (!expanded.ok) throw new Error(expanded.reason);
  writeCanonicalRecord(h.store, "g", expanded.hash, expanded.canonicalJson);
  return { schema: "orca-task-amendment-v1", groupId: "g", taskId, loopVersion: 1, previousContractHash: archived.originalContractHash,
    recipe: expanded.recipe, originalContractHash: expanded.hash, originalContractCanonicalJson: expanded.canonicalJson, ...over };
}
/** Point `taskId`'s work item at `record`, as set-task-loop does. */
function apply(h: Fixture, taskId: string, record: TaskAmendment): void {
  const hash = writeTaskAmendment(h.store, "g", record);
  writeWork(h, taskId, { amendmentHash: hash, loopVersion: record.loopVersion, originalContractHash: record.originalContractHash, contract: { contentAddressedHash: record.originalContractHash } });
}
const confirm = async (h: Fixture) => {
  const answer = await new WebControlService(h.deps).confirm(h.command("confirm", await h.confirmPayload()));
  if ("error" in answer) throw new Error(JSON.stringify(answer));
};

describe("the effective contract (spec §5.1)", () => {
  it("confirms, dispatches and shows an amended task as amended, and leaves the archived plan as it was", async () => {
    const h = await webFixture(undefined, [{ taskId: "a", loop: loop("a") }, { taskId: "b", loop: loop("b") }]);
    try {
      const archivedBefore = readArchivedPlan(h.store, "g");
      apply(h, "a", amendment(h, "a", "write a, as amended"));
      await confirm(h);
      expect(readConfirmedTaskExecution(h.store, "g", "a").contract.objective.goal).toBe("write a, as amended");
      expect(readConfirmedTaskExecution(h.store, "g", "b").contract.objective.goal).toBe("write b");
      expect(readArchivedContract(h.store, "g", "a").contract.objective.goal).toBe("write a, as amended");
      const item = readControlGroup(h.store, "epoch", "g").workItems.find((entry) => entry.taskId === "a")!;
      expect(item.loopPlan).toMatchObject({ amended: true, loopVersion: 1, chosenBy: "explicit" });
      expect(item.loopPlan!.summary[0]).toBe("目标：write a, as amended");
      const archivedAfter = readArchivedPlan(h.store, "g");
      expect([archivedAfter.planHash, archivedAfter.canonicalJson]).toEqual([archivedBefore.planHash, archivedBefore.canonicalJson]);
    } finally { await h.dispose(); }
  });

  it("reads a task with no work row, or an unparsable one, as not amended (Drafter finding F11)", async () => {
    const h = await webFixture(undefined, [{ taskId: "a", loop: loop("a") }]);
    try {
      const archived = readArchivedPlan(h.store, "g").plan.tasks[0]!;
      expect(effectivePlanTask(h.store, "g", archived, null)).toBe(archived);
      expect(effectivePlanTask(h.store, "g", archived, [])).toBe(archived);
      expect(effectivePlanTask(h.store, "g", archived, { status: "draft" })).toBe(archived);
    } finally { await h.dispose(); }
  });

  const tampers: Array<[string, string, (h: Fixture) => void]> = [
    ["an amendment hash with no record", "a", (h) => writeWork(h, "a", { amendmentHash: "0".repeat(64) })],
    ["a record for another group", "a", (h) => apply(h, "a", amendment(h, "a", "x", { groupId: "other" }))],
    ["a record for another task", "a", (h) => apply(h, "a", amendment(h, "a", "x", { taskId: "b" }))],
    ["a loopVersion the work item does not carry", "a", (h) => { apply(h, "a", amendment(h, "a", "x")); writeWork(h, "a", { loopVersion: 2 }); }],
    ["a contract hash that is not the contract's", "a", (h) => apply(h, "a", amendment(h, "a", "x", { originalContractHash: "f".repeat(64) }))],
    ["a recipe that does not expand to the contract", "a", (h) => apply(h, "a", { ...amendment(h, "a", "x"), recipe: amendment(h, "a", "y").recipe })],
    ["an amendment of a hand-written task", "c", (h) => apply(h, "c", amendment(h, "a", "x", { taskId: "c" }))],
  ];
  it.each(tampers)("blocks A2 and the projection for %s (criterion 13)", async (_case, taskId, tamper) => {
    const h = await webFixture(undefined, [{ taskId: "a", loop: loop("a") }, { taskId: "b", loop: loop("b") }, { taskId: "c" }]);
    try {
      await confirm(h);
      tamper(h);
      expect(() => readConfirmedTaskExecution(h.store, "g", taskId)).toThrow(`recovery-blocked:task-amendment-invalid:${taskId}`);
      expect(() => readControlGroup(h.store, "epoch", "g")).toThrow(`recovery-blocked:task-amendment-invalid:${taskId}`);
    } finally { await h.dispose(); }
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
./node_modules/.bin/vitest run tests/control/taskAmendments.test.ts > "$SCRATCH/b1-red.txt" 2>&1; echo rc=$?
```
Expected `rc=1`: `src/control/taskAmendments.js` does not exist (import failure).

- [ ] **Step 3: Implement** — create `src/control/taskAmendments.ts`:

```ts
import { z } from "zod";
import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { ControlError } from "./errors.js";
import { expandRecipe, loopRecipeSchema } from "./loopPlans.js";
import { idSchema, safeInteger } from "./schema.js";
import { readCanonicalRecord, writeCanonicalRecord } from "./snapshot.js";
import type { ControlStore } from "./store.js";
import type { ControlPlanV1 } from "./webProtocol.js";
import { taskContractSchema } from "../scheduler/planFile.js";

/**
 * Loop plans spec §5.1 (C5; independent review R1). A change to a loop task never rewrites the archived plan: its
 * planHash reaches the proposal, the snapshot, the confirm check and estimate validity. The change is a canonical,
 * hashed amendment record; the work item holds its hash. Every reader of a task's original contract goes through
 * effectivePlanTask, which verifies the record before answering the amended entry.
 *
 * Imports nothing that imports it back: queries.ts, executionSnapshot.ts, webService.ts and controlViews.ts import this.
 */

export const TASK_AMENDMENT_SCHEMA = "orca-task-amendment-v1" as const;
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const taskAmendmentSchema = z
  .object({
    schema: z.literal(TASK_AMENDMENT_SCHEMA),
    groupId: idSchema,
    taskId: idSchema,
    loopVersion: safeInteger.positive(),
    previousContractHash: hashSchema,
    recipe: loopRecipeSchema,
    originalContractHash: hashSchema,
    originalContractCanonicalJson: z.string().min(1),
  })
  .strict();
export type TaskAmendment = z.infer<typeof taskAmendmentSchema>;
export type ArchivedPlanTask = ControlPlanV1["tasks"][number];

/** The two work item fields an amendment is found by; everything else of the work item is its readers' business. */
const workAmendmentStateSchema = z
  .object({ amendmentHash: hashSchema.nullable().optional(), loopVersion: safeInteger.optional() })
  .passthrough();

export function writeTaskAmendment(store: ControlStore, groupId: string, amendment: TaskAmendment): string {
  const record = taskAmendmentSchema.parse(amendment);
  const hash = sha256Canonical(record);
  writeCanonicalRecord(store, groupId, hash, canonicalBytes(record).toString("utf8"));
  return hash;
}

/**
 * A task's work item body, or null when there is no row or it is not JSON. Null reads as "not amended": the reader's own
 * later checks still report a missing or broken work item with their existing details (Drafter finding F11).
 */
export function workBodyOf(store: ControlStore, groupId: string, taskId: string): unknown {
  const row = store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id=?").get(groupId, taskId);
  if (row === undefined) return null;
  try { return JSON.parse(String(row.body)); } catch { return null; }
}

/**
 * The task entry every original-contract reader uses (spec §5.1): the archived entry, or -- when the work item carries an
 * amendmentHash -- that entry with the amendment's recipe and contract, after verifying that the record is the one the
 * hash names (readCanonicalRecord), that it is this group's and this task's at the work item's loopVersion, that its
 * contract hashes to originalContractHash, and that its recipe re-expands to exactly those bytes. Any failure blocks.
 */
export function effectivePlanTask(store: ControlStore, groupId: string, archived: ArchivedPlanTask, work: unknown): ArchivedPlanTask {
  const detail = `task-amendment-invalid:${archived.taskId}`;
  const invalid = (): never => { throw new ControlError("recovery-blocked", detail); };
  if (typeof work !== "object" || work === null || Array.isArray(work)) return archived;
  const state = workAmendmentStateSchema.safeParse(work);
  if (!state.success) return invalid();
  const amendmentHash = state.data.amendmentHash ?? null;
  if (amendmentHash === null) return archived;
  try {
    // A hand-written task has no recipe to amend (spec §0.1: its contract is never changed).
    if (archived.loop === undefined) return invalid();
    const record = taskAmendmentSchema.parse(JSON.parse(readCanonicalRecord(store, amendmentHash)));
    if (record.groupId !== groupId || record.taskId !== archived.taskId || record.loopVersion !== (state.data.loopVersion ?? 0)) return invalid();
    const contract = taskContractSchema.parse(JSON.parse(record.originalContractCanonicalJson));
    if (sha256Canonical(contract) !== record.originalContractHash) return invalid();
    const expanded = expandRecipe(archived.taskId, contract.context.repoPath, record.recipe);
    if (!expanded.ok || expanded.canonicalJson !== record.originalContractCanonicalJson) return invalid();
    return { ...archived, loop: record.recipe, originalContractHash: record.originalContractHash, originalContractCanonicalJson: record.originalContractCanonicalJson };
  } catch (error) {
    if (error instanceof ControlError && error.detail === detail) throw error;
    return invalid();
  }
}
```

  Route the readers:
  - `src/control/executionSnapshot.ts`: add `import { effectivePlanTask, workBodyOf } from "./taskAmendments.js";` after line 19. Replace line 109 `  for (const authority of plan.tasks) {` with
    ```ts
      for (const archived of plan.tasks) {
        // Loop plans spec §5.1 (C5): the confirmation freezes a task's contract as amended, when it was.
        const authority = effectivePlanTask(input.store, input.groupId, archived, workBodyOf(input.store, input.groupId, archived.taskId));
    ```
    Replace line 293 `    const task = plan.plan.tasks.find(t => t.taskId === taskId), ref = snapshot.derivedContracts.find(t => t.taskId === taskId);` with
    ```ts
        const archived = plan.plan.tasks.find(t => t.taskId === taskId), ref = snapshot.derivedContracts.find(t => t.taskId === taskId);
        // Loop plans spec §5.1 (C5): A2 derives from the task's effective contract, never the archived entry alone.
        const task = archived === undefined ? undefined : effectivePlanTask(store, groupId, archived, workBodyOf(store, groupId, taskId));
    ```
  - `src/control/queries.ts`: add `import { effectivePlanTask, workBodyOf } from "./taskAmendments.js";` after line 21. Replace lines 140-141 (`const task = archivedPlan.plan.tasks.find(…);` / `if (!task) return recoveryBlocked();`) with
    ```ts
      const archived = archivedPlan.plan.tasks.find(candidate => candidate.taskId === taskId);
      if (!archived) return recoveryBlocked();
      // Loop plans spec §5.1 (C5): the single-task reader answers the task's contract as amended, when it was.
      const task = effectivePlanTask(store, groupId, archived, workBodyOf(store, groupId, taskId));
    ```
  - `src/control/webService.ts`: add `import { effectivePlanTask, workBodyOf } from "./taskAmendments.js";` after line 24. Replace line 465 `          const tasks = plan.plan.tasks.map(task => {` with
    ```ts
              // Loop plans spec §5.1 (C5): each task is frozen with its contract as amended, when it was.
              const tasks = plan.plan.tasks.map(archived => {
                const task = effectivePlanTask(this.store, id, archived, workBodyOf(this.store, id, archived.taskId));
    ```
  - `src/panel/controlViews.ts`: add `import { effectivePlanTask, workBodyOf } from "../control/taskAmendments.js";` after the `queries.js` import (line 12). In `readControlGroup`, after line 686 (`const proposal = readBudgetProposal(store, groupId);`) insert
    ```ts
      // Loop plans spec §5.1 (C5): the projection's identity checks and task view read every task as amended.
      const plan = { ...archived.plan, tasks: archived.plan.tasks.map(task => effectivePlanTask(store, groupId, task, workBodyOf(store, groupId, task.taskId))) };
    ```
    and change `archived.plan` to `plan` in the `validateExecutionSnapshot(…)` call (line 687) and the `workViews(…)` call (line 708). Every other `archived.` use there is unchanged.

- [ ] **Step 4: Run, expect PASS**

```bash
./node_modules/.bin/vitest run tests/control/taskAmendments.test.ts tests/control/executionSnapshot.test.ts tests/control/confirmation.test.ts tests/control/planImport.test.ts tests/control/loopPlanView.test.ts tests/control/loopPlanDrift.test.ts tests/control/executionDriver.test.ts tests/panel/controlReadApi.test.ts tests/control/taskLabels.test.ts > "$SCRATCH/b1-green.txt" 2>&1; echo rc=$?
npm run typecheck > "$SCRATCH/b1-tsc.txt" 2>&1; echo rc=$?
```
Expected both `rc=0`.

- [ ] **Step 5: Mutations** (`$SCRATCH/mut-b1`; files: the five modified sources and two new files; criterion file `tests/control/taskAmendments.test.ts`)
  - MB1-1 bypass `effectivePlanTask` in A2: in `readConfirmedTaskExecution`, `effectivePlanTask(store, groupId, archived, workBodyOf(store, groupId, taskId))` → `archived`. Red: `… > confirms, dispatches and shows an amended task as amended …` (A2 derivation no longer matches the frozen record).
  - MB1-2 bypass in the confirm path: in `webService.ts` confirm, `effectivePlanTask(…)` → `archived`. Red: same criterion (`verifyTaskSet` refuses: `plan-version-conflict`).
  - MB1-3 bypass in `verifyTaskSet`: `effectivePlanTask(input.store, …)` → `archived`. Red: same criterion.
  - MB1-4 bypass in `readArchivedContract`. Red: same criterion (its `readArchivedContract` line).
  - MB1-5 bypass in the projection: `readControlGroup`'s `plan` → `archived.plan`. Red: same criterion (the view's summary line), and `blocks A2 and the projection for …` (all seven, second assertion).
  - MB1-6..MB1-11, one per check: delete `record.groupId !== groupId ||` / `record.taskId !== archived.taskId ||` / `|| record.loopVersion !== (state.data.loopVersion ?? 0)` / the `sha256Canonical(contract) !== record.originalContractHash` line / `expanded.canonicalJson !== record.originalContractCanonicalJson` (keep `!expanded.ok`) / the `if (archived.loop === undefined) return invalid();` line. Red, respectively: `blocks A2 and the projection for a record for another group` / `… another task` / `… a loopVersion the work item does not carry` / `… a contract hash that is not the contract's` / `… a recipe that does not expand to the contract` / `… an amendment of a hand-written task`.
  - MB1-12 "no row" read as a refusal: `if (typeof work !== "object" || work === null || Array.isArray(work)) return archived;` → deleted. Red: `reads a task with no work row, or an unparsable one, as not amended`.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add src/control/taskAmendments.ts src/control/executionSnapshot.ts src/control/queries.ts src/control/webService.ts src/panel/controlViews.ts tests/control/taskAmendments.test.ts
/usr/bin/git commit -F - <<'EOF'
feat(control): read every task's contract through its verified amendment

A loop task's later change is a hashed amendment record, never a rewrite of
the archived plan. effectivePlanTask answers the amended task entry after
verifying the record's hash, group, task, loopVersion, contract hash and
recipe expansion, and blocks the task otherwise. The confirm path, A2, the
single-task reader and the projection now all read tasks through it.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GCbsgLfqFPgpeG3gTbBkbh
EOF
```

---

### Task B2: The `set-task-loop` command (protocol, refusals, the draft path, the self-check)

After this Task a change on a draft group commits; a change on a confirmed group is fully computed and then rolled back by the step-8 self-check (the snapshot still names the old derived contract, so A2 refuses). Task B3 adds the snapshot copy that lets it commit.

**Files:**
- Modify: `src/control/errors.ts` — 409 block (insert after line 47 `"labels-version-conflict": 409,`), 422 block (insert after line 115 `"group-state-invalid": 422,`)
- Modify: `src/control/webProtocol.ts` — `commandVerbSchema` (after line 588 `"set-task-labels",`); new `setTaskLoopPayloadSchema` after `setTaskLabelsPayloadSchema` (726-728); raw variants (after 765); effective variants (after 802); `commandResultSchema` (after 1212); types (after 1348)
- Modify: `src/control/executionSnapshot.ts:169` (`function deriveContract` → exported)
- Modify: `src/control/webService.ts` — imports (lines 1-29); type export (after line 36); new method `setTaskLoop` after `setTaskLabels` (ends line 547)
- Modify: `web/src/controlTypes.ts` — verb union (line 261), result union (after 279), new payload type
- Modify: `tests/panel/webParity.test.ts` — imports (lines 42, 68 area), two functions after line 205, two entries after line 266 (additive)
- Create: `tests/control/fixtures/taskLoop.ts`, `tests/control/setTaskLoop.test.ts`

**Interfaces:**
- Consumes: `effectivePlanTask`, `writeTaskAmendment`, `TASK_AMENDMENT_SCHEMA` (B1); `expandLoopPlan`, `loopInputsSchema` (A1); `readConfirmedTaskExecution`, `deriveContract` (executionSnapshot.ts); `assertKnownConservation`, `setReserve`, `reopenProposal`, `saveWebAuthority`, `estimateCommitments`, `readWebGroup` (webService.ts, same module).
- Produces:
  ```ts
  // src/control/webProtocol.ts
  export const setTaskLoopPayloadSchema: z.ZodObject<{ baseLoopVersion: safeInteger; plan: nonemptyString; inputs: loopInputsSchema;
    work: { tokens: positiveSafeInteger; activeMs: positiveSafeInteger; attempts: positiveSafeInteger } (strict) }>;  // strict
  export type SetTaskLoopPayload = z.infer<typeof setTaskLoopPayloadSchema>;
  // verb "set-task-loop", target taskCommandTargetSchema; result { kind: "task-loop-set", taskId, loopVersion: positive, proposalVersion: positive }
  // src/control/executionSnapshot.ts
  export function deriveContract(task: ConfirmedProposal["tasks"][number], proposalVersion: number): { canonicalJson: string; contractCanonicalJson: string; derivedContractHash: string };
  // src/control/webService.ts
  export type SetTaskLoopCommand = Extract<RawAuthorityCommandV1, { verb: "set-task-loop" }>;
  WebControlService.setTaskLoop(command: SetTaskLoopCommand): WebCommandResult;
  // web/src/controlTypes.ts
  export type SetTaskLoopPayloadV1 = { baseLoopVersion: number; plan: string; inputs: LoopInputsV1; work: { tokens: number; activeMs: number; attempts: number } };
  // tests/control/fixtures/taskLoop.ts (used by B2, B3, B4, B7)
  export type Fixture; export const DIMENSIONS; export function loop(taskId: string); export function inputs(taskId: string, over?: Partial<LoopInputs>): LoopInputs;
  export function workAllocation(h: Fixture, taskId: string); export interface Change; export function change(h: Fixture, taskId: string, c?: Change);
  export function errorOf(answer: unknown): { code: string; message: string } | undefined; export function workBody(h: Fixture, taskId: string): Record<string, unknown>;
  export function writeWork(h: Fixture, taskId: string, patch: Record<string, unknown>): void; export function writeGroup(h: Fixture, patch: (body: Record<string, any>) => void): void;
  export function snapshotOf(h: Fixture): any; export function expectConserved(h: Fixture): void;
  ```

- [ ] **Step 1: Write the failing criteria**

`tests/control/fixtures/taskLoop.ts`:

```ts
import { expect } from "vitest";
import type { LoopInputs } from "../../../src/control/loopPlans.js";
import { readBudgetProposal } from "../../../src/control/queries.js";
import { readCanonicalRecord } from "../../../src/control/snapshot.js";
import { readWebGroup } from "../../../src/control/webService.js";
import type { webFixture } from "./web.js";

/** Loop plans plan Tasks B2-B7: the loop tasks and set-task-loop helpers every Part B criterion shares. */
export type Fixture = Awaited<ReturnType<typeof webFixture>>;
export const DIMENSIONS = ["tokens", "activeMs", "attempts", "sessions"] as const;
/** A standard-plan loop task writing the one file the synthetic ccloop writes for it (driverPort.ts: `{ [id]: "id\n" }`). */
export const loop = (taskId: string) => ({ plan: "standard", goal: `write ${taskId}`, successCondition: `${taskId} exists`, targetPaths: [taskId], checks: ["true"] });
export const inputs = (taskId: string, over: Partial<LoopInputs> = {}): LoopInputs => ({
  goal: `write ${taskId}`, successCondition: `${taskId} exists`, targetPaths: [taskId], checks: ["true"],
  nonGoals: [], relevantDocs: [], protectedPaths: [], maxFilesTouched: null, ...over,
});
export const workAllocation = (h: Fixture, taskId: string) =>
  readBudgetProposal(h.store, "g").allocations.find((a) => a.ownerKind === "task" && a.ownerId === taskId && a.bucket === "work")!;
export interface Change { base?: number; plan?: string; inputs?: Partial<LoopInputs>; tokens?: number; activeMs?: number; attempts?: number }
/** A set-task-loop under the group's current revision; unspecified budget dimensions keep the task's current amount. */
export const change = (h: Fixture, taskId: string, c: Change = {}) => {
  const work = workAllocation(h, taskId).amount;
  return h.taskCommand("set-task-loop", taskId, {
    baseLoopVersion: c.base ?? 0, plan: c.plan ?? "standard", inputs: inputs(taskId, c.inputs),
    work: { tokens: c.tokens ?? work.tokens, activeMs: c.activeMs ?? work.activeMs, attempts: c.attempts ?? work.attempts },
  });
};
export const errorOf = (answer: unknown) => (answer as { error?: { code: string; message: string } }).error;
export const workBody = (h: Fixture, taskId: string): Record<string, unknown> =>
  JSON.parse(String(h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body));
export const writeWork = (h: Fixture, taskId: string, patch: Record<string, unknown>): void => {
  h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id=?").run(JSON.stringify({ ...workBody(h, taskId), ...patch }), taskId);
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const writeGroup = (h: Fixture, patch: (body: Record<string, any>) => void): void => {
  const body = JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
  patch(body);
  h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(body));
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const snapshotOf = (h: Fixture): any => JSON.parse(readCanonicalRecord(h.store, readBudgetProposal(h.store, "g").executionSnapshotHash!));
/** Spec §6 criterion 9: per dimension, reserved + reserve = limit - used, and the reserve row is the ledger's reserve. */
export function expectConserved(h: Fixture): void {
  const group = readWebGroup(h.store, "g");
  const reserveRow = readBudgetProposal(h.store, "g").allocations.find((a) => a.ownerKind === "reserve")!.amount;
  for (const d of DIMENSIONS) {
    expect(group.reserved[d] + group.ledger.explicitUnallocatedReserve[d]).toBe(group.limit[d] - group.used[d]);
    expect(reserveRow[d]).toBe(group.ledger.explicitUnallocatedReserve[d]);
  }
}
```

`tests/control/setTaskLoop.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readConfirmedTaskExecution } from "../../src/control/executionSnapshot.js";
import { readBudgetProposal } from "../../src/control/queries.js";
import { WebControlService, readWebGroup } from "../../src/control/webService.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { change, errorOf, expectConserved, inputs, loop, workAllocation, workBody, writeGroup, writeWork, type Fixture } from "./fixtures/taskLoop.js";
import { webFixture } from "./fixtures/web.js";

/**
 * Loop plans spec §5.2 (criteria 8, 9; §9's revision assumption): set-task-loop refuses, by name and before writing
 * anything, every state in which a change could not be honoured; on a draft group it moves the task's budget to or
 * from the reserve with the ledger conserved and advances the proposal version so a stale confirmation is refused.
 */
const draft = () => webFixture(undefined, [{ taskId: "a", loop: loop("a") }, { taskId: "b", loop: loop("b") }, { taskId: "c" }]);
const CHANGED = { inputs: { goal: "write a, changed" } };
/** Nothing of a refused command stays: the work item has no amendment and the proposal has not moved. */
const expectUntouched = (h: Fixture, proposalVersion: number) => {
  expect(workBody(h, "a").amendmentHash).toBeUndefined();
  expect(readBudgetProposal(h.store, "g").proposalVersion).toBe(proposalVersion);
};

describe("set-task-loop refusals (criterion 8)", () => {
  it.each(["running", "review", "done", "blocked"])("refuses a group whose status is %s as group-state-invalid", async (status) => {
    const h = await draft();
    try {
      writeGroup(h, (body) => { body.status = status; });
      expect(errorOf(new WebControlService(h.deps).setTaskLoop(change(h, "a", CHANGED)))).toMatchObject({ code: "group-state-invalid" });
      expectUntouched(h, 1);
    } finally { await h.dispose(); }
  });

  it("refuses a stopped group as group-state-invalid", async () => {
    const h = await draft();
    try {
      writeGroup(h, (body) => { body.stopped = true; });
      expect(errorOf(new WebControlService(h.deps).setTaskLoop(change(h, "a", CHANGED)))).toMatchObject({ code: "group-state-invalid" });
      expectUntouched(h, 1);
    } finally { await h.dispose(); }
  });

  it("refuses a ledger with unknown usage as recovery-blocked", async () => {
    const h = await draft();
    try {
      writeGroup(h, (body) => { body.ledger.usageUnknown = true; });
      expect(errorOf(new WebControlService(h.deps).setTaskLoop(change(h, "a", CHANGED)))).toMatchObject({ code: "recovery-blocked" });
      expectUntouched(h, 1);
    } finally { await h.dispose(); }
  });

  it("refuses while an estimate is running (estimate-in-flight)", async () => {
    const h = await draft();
    try {
      const service = new WebControlService(h.deps);
      expect(await service.claimEstimate("g", h.estimateId)).not.toBeNull();
      expect(errorOf(service.setTaskLoop(change(h, "a", CHANGED)))).toMatchObject({ code: "estimate-in-flight" });
      expectUntouched(h, 1);
    } finally { await h.dispose(); }
  });

  it("refuses a stale loopVersion, a hand-written task, an unknown plan, a bad path shape and an unknown task by name", async () => {
    const h = await draft();
    try {
      const service = new WebControlService(h.deps);
      expect(errorOf(service.setTaskLoop(change(h, "a", { ...CHANGED, base: 1 })))).toMatchObject({ code: "task-loop-version-conflict" });
      expect(errorOf(service.setTaskLoop(change(h, "c", CHANGED)))).toMatchObject({ code: "task-has-no-loop-plan" });
      expect(errorOf(service.setTaskLoop(change(h, "a", { plan: "yolo" })))).toMatchObject({ code: "loop-plan-invalid", message: "loop-plan-invalid:unknown-plan" });
      expect(errorOf(service.setTaskLoop(change(h, "a", { inputs: { targetPaths: ["src/*.ts"] } })))).toMatchObject({ code: "loop-plan-invalid", message: "loop-plan-invalid:path-shape" });
      expect(errorOf(service.setTaskLoop(h.taskCommand("set-task-loop", "zzz", { baseLoopVersion: 0, plan: "standard", inputs: inputs("zzz"), work: { tokens: 1, activeMs: 1, attempts: 1 } }))))
        .toMatchObject({ code: "work-not-found" });
      expectUntouched(h, 1);
    } finally { await h.dispose(); }
  });

  it("refuses the same contract and the same budget as no-op-command", async () => {
    const h = await draft();
    try {
      expect(errorOf(new WebControlService(h.deps).setTaskLoop(change(h, "a")))).toMatchObject({ code: "no-op-command" });
      expectUntouched(h, 1);
    } finally { await h.dispose(); }
  });

  it("refuses a raise the reserve cannot cover, naming the dimension and the shortfall", async () => {
    const h = await draft();
    try {
      const reserve = readWebGroup(h.store, "g").ledger.explicitUnallocatedReserve.tokens;
      const tokens = workAllocation(h, "a").amount.tokens + reserve + 1;
      expect(errorOf(new WebControlService(h.deps).setTaskLoop(change(h, "a", { tokens }))))
        .toMatchObject({ code: "group-reserve-insufficient", message: "group-reserve-insufficient:tokens:1" });
      expectUntouched(h, 1);
    } finally { await h.dispose(); }
  });

  it("refuses a stale command revision like every other command (spec §9)", async () => {
    const h = await draft();
    try {
      const service = new WebControlService(h.deps);
      const stale = change(h, "a", CHANGED);
      expect(service.setTaskLoop(change(h, "b", { inputs: { goal: "write b, changed" } }))).toMatchObject({ result: { kind: "task-loop-set", taskId: "b" } });
      expect(errorOf(service.setTaskLoop(stale))).toMatchObject({ code: "revision-conflict" });
    } finally { await h.dispose(); }
  });

  it("refuses a task that is running, and one that has any run at all, as task-already-started", async () => {
    const t = await driverHarness([{ taskId: "a", loop: loop("a") }, { taskId: "b", loop: loop("b") }]);
    try {
      await t.claim(); // nextClaimableTask takes the first ready task by id: a
      expect(errorOf(t.service.setTaskLoop(change(t.h, "a", CHANGED)))).toMatchObject({ code: "task-already-started" });
      // Spec §5.2 step 2: a finished run returns its task to ready. A ready task with an inactive run row is that state.
      t.h.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES ('run-finished','g','b',1,0,?)")
        .run(JSON.stringify({ unknown: { work: false, handoff: false } }));
      expect(errorOf(t.service.setTaskLoop(change(t.h, "b", { inputs: { goal: "write b, changed" } })))).toMatchObject({ code: "task-already-started" });
    } finally { await t.h.dispose(); }
  });
});

describe("a change before confirmation (criterion 9; spec §5.2 steps 5-7)", () => {
  it("raises the budget out of the reserve, changes the contract, and advances the proposal version so a stale confirm is refused", async () => {
    const h = await draft();
    try {
      const service = new WebControlService(h.deps);
      const before = { group: readWebGroup(h.store, "g"), work: workAllocation(h, "a") };
      const stalePayload = await h.confirmPayload();
      expect(service.setTaskLoop(change(h, "a", { ...CHANGED, tokens: before.work.amount.tokens + 500_000 })))
        .toMatchObject({ verb: "set-task-loop", result: { kind: "task-loop-set", taskId: "a", loopVersion: 1, proposalVersion: 2 } });
      expectConserved(h);
      const after = readWebGroup(h.store, "g"), work = workAllocation(h, "a");
      expect(after.used).toEqual(before.group.used);
      expect(after.ledger.explicitUnallocatedReserve.tokens).toBe(before.group.ledger.explicitUnallocatedReserve.tokens - 500_000);
      expect(work.amount).toEqual({ ...before.work.amount, tokens: before.work.amount.tokens + 500_000 });
      expect(work.fieldProvenance.tokens).toEqual({ provenance: "human", estimateId: null });
      expect(work.fieldProvenance.sessions).toEqual(before.work.fieldProvenance.sessions);
      expect(readControlGroup(h.store, "epoch", "g").workItems[0]!.loopPlan).toMatchObject({ amended: true, loopVersion: 1, inputs: { goal: "write a, changed" } });
      expect(errorOf(await service.confirm(h.command("confirm", stalePayload)))).toMatchObject({ code: "proposal-version-conflict" });
      expect(await service.confirm(h.command("confirm", await h.confirmPayload()))).toMatchObject({ result: { kind: "confirmed" } });
      const confirmed = readConfirmedTaskExecution(h.store, "g", "a");
      expect(confirmed.contract.objective.goal).toBe("write a, changed");
      expect(confirmed.contract.executionPolicy.tokenBudget).toBe(before.work.amount.tokens + 500_000);
    } finally { await h.dispose(); }
  });

  it("lowers the budget back into the reserve, sessions untouched", async () => {
    const h = await draft();
    try {
      const before = { group: readWebGroup(h.store, "g"), work: workAllocation(h, "a").amount };
      expect(new WebControlService(h.deps).setTaskLoop(change(h, "a", { tokens: before.work.tokens - 1_000_000, attempts: before.work.attempts - 1 })))
        .toMatchObject({ result: { kind: "task-loop-set" } });
      expectConserved(h);
      const after = readWebGroup(h.store, "g");
      expect(after.ledger.explicitUnallocatedReserve.tokens).toBe(before.group.ledger.explicitUnallocatedReserve.tokens + 1_000_000);
      expect(after.ledger.explicitUnallocatedReserve.attempts).toBe(before.group.ledger.explicitUnallocatedReserve.attempts + 1);
      expect(after.used).toEqual(before.group.used);
      expect(workAllocation(h, "a").amount.sessions).toBe(before.work.sessions);
    } finally { await h.dispose(); }
  });
});

describe("the self-check (spec §5.2 step 8)", () => {
  it("rolls a confirmed change back when the changed task would not pass A2", async () => {
    const h = await webFixture(undefined, [{ taskId: "a", loop: loop("a") }]);
    try {
      const service = new WebControlService(h.deps);
      expect(await service.confirm(h.command("confirm", await h.confirmPayload()))).toMatchObject({ result: { kind: "confirmed" } });
      // A work item whose frozen selection no longer matches the snapshot: nothing in the command reads it; A2 does.
      writeWork(h, "a", { configHash: "f".repeat(64) });
      const rows = () => [h.store.db.prepare("SELECT body FROM budget_proposals WHERE group_id='g'").get()!.body, h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body];
      const before = rows();
      expect(errorOf(service.setTaskLoop(change(h, "a", CHANGED)))).toMatchObject({ code: "recovery-blocked" });
      expect(workBody(h, "a").amendmentHash).toBeUndefined();
      expect(rows()).toEqual(before);
    } finally { await h.dispose(); }
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
./node_modules/.bin/vitest run tests/control/setTaskLoop.test.ts > "$SCRATCH/b2-red.txt" 2>&1; echo rc=$?
```
Expected `rc=1`: `service.setTaskLoop is not a function` in every criterion.

- [ ] **Step 3: Implement**
  - `src/control/errors.ts`: after line 47 add `  // Loop plans spec §5.2 step 3: the task's plan moved since the person read it.\n  "task-loop-version-conflict": 409,`. After line 115 add:
    ```ts
      // Loop plans spec §5.2 (step 6): a raise the group's reserve cannot cover; the detail is `<dimension>:<shortfall>`.
      "group-reserve-insufficient": 422,
      // Loop plans spec §3.2 / §5.2 step 4: the expansion refused the plan or its inputs; the detail names the reason.
      "loop-plan-invalid": 422,
      // Loop plans spec §5.2 steps 2-3: a task that has started, or that has no loop plan, cannot be changed.
      "task-already-started": 422,
      "task-has-no-loop-plan": 422,
    ```
  - `src/control/webProtocol.ts`: extend the loopPlans import with nothing new (`loopInputsSchema` is imported since A5). After line 588 add `  "set-task-loop",`. After `setTaskLabelsPayloadSchema` (line 728) add:
    ```ts
    // Loop plans spec §5.2 (Drafter finding F3): the task is the target; sessions is not here -- it is never mapped into the
    // contract and is carried over unchanged (R10). Shape only: the plan id and the path shapes are judged in apply, so a
    // refusal is ledgered and named (loop-plan-invalid).
    export const setTaskLoopPayloadSchema = z
      .object({
        baseLoopVersion: safeInteger,
        plan: nonemptyString,
        inputs: loopInputsSchema,
        work: z.object({ tokens: positiveSafeInteger, activeMs: positiveSafeInteger, attempts: positiveSafeInteger }).strict(),
      })
      .strict();
    ```
    After line 765 add `  z.object({ ...rawCommandFields, verb: z.literal("set-task-loop"), target: taskCommandTargetSchema, payload: setTaskLoopPayloadSchema }).strict(),`; after line 802 add the same with `effectiveCommandFields`. After line 1212 add `  z.object({ kind: z.literal("task-loop-set"), taskId: idSchema, loopVersion: positiveSafeInteger, proposalVersion: positiveSafeInteger }).strict(),`. After line 1348 add `export type SetTaskLoopPayload = z.infer<typeof setTaskLoopPayloadSchema>;`.
  - `src/control/executionSnapshot.ts:169`: `function deriveContract(` → `export function deriveContract(`.
  - `src/control/webService.ts`: line 8 becomes `import { deriveContract, prepareExecutionSnapshot, readConfirmedTaskExecution } from "./executionSnapshot.js";`; the B1 import becomes `import { TASK_AMENDMENT_SCHEMA, effectivePlanTask, workBodyOf, writeTaskAmendment } from "./taskAmendments.js";`; add `import { expandLoopPlan } from "./loopPlans.js";` and `import { taskContractSchema } from "../scheduler/planFile.js";`. After line 36 add `export type SetTaskLoopCommand = Extract<RawAuthorityCommandV1, { verb: "set-task-loop" }>;`. After `setTaskLabels` (closing `}` at line 547) add:
    ```ts
      /**
       * Loop plans spec §5.2 (C5, C6): change a not-yet-started loop task's plan, inputs and work budget, before or after
       * confirmation. The archived plan is never rewritten: the new contract lives in a hashed amendment record that
       * effectivePlanTask verifies (taskAmendments.ts). The budget's delta comes out of, or goes back to, the group's
       * reserve; the group limit, `used` and `sessions` never move. Any failure rolls the whole transaction back.
       */
      setTaskLoop(command: SetTaskLoopCommand): WebCommandResult {
        return this.mutate(() => applyWebCommand(this.store, {
          rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
          apply: context => {
            const id = groupId(command), taskId = command.target.taskId, payload = command.payload;
            const group = readWebGroup(this.store, id), proposal = readBudgetProposal(this.store, id), plan = readArchivedPlan(this.store, id);
            // Step 1.
            assertKnownConservation(this.store, group, proposal);
            if ((group.status !== "draft" && group.status !== "ready") || group.stopped) throw new ControlError("group-state-invalid");
            const row = this.store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id=?").get(id, taskId);
            const work = row ? JSON.parse(String(row.body)) as Record<string, unknown> : null;
            const archived = plan.plan.tasks.find(task => task.taskId === taskId);
            if (!work || work.kind !== "task" || !archived) throw new ControlError("work-not-found");
            // Step 2: any runs row counts -- a finished run returns its task to ready. Decided inside this transaction, so
            // this command and the driver's claim (webDispatch.ts nextClaimableTask, createStartingRun) cannot both win.
            if ((work.status !== "draft" && work.status !== "ready")
              || this.store.db.prepare("SELECT id FROM runs WHERE group_id=? AND work_item_id=?").get(id, taskId)) throw new ControlError("task-already-started");
            // Step 3. The in-flight predicate is scheduleStart's (webDispatch.ts), Drafter finding F8.
            for (const estimate of this.store.db.prepare("SELECT state FROM estimates WHERE group_id=?").all(id)) {
              if (["running", "start-unknown"].includes(String(estimate.state))) throw new ControlError("estimate-in-flight");
            }
            const loopVersion = typeof work.loopVersion === "number" ? work.loopVersion : 0;
            if (payload.baseLoopVersion !== loopVersion) throw new ControlError("task-loop-version-conflict");
            if (archived.loop === undefined) throw new ControlError("task-has-no-loop-plan");
            // Step 4. repoPath is the current contract's own (Drafter finding F9).
            const current = effectivePlanTask(this.store, id, archived, work);
            const repoPath = taskContractSchema.parse(JSON.parse(current.originalContractCanonicalJson)).context.repoPath;
            const expanded = expandLoopPlan(taskId, repoPath, payload.plan, payload.inputs);
            if (!expanded.ok) throw new ControlError("loop-plan-invalid", expanded.reason);
            const allocation = proposal.allocations.find(a => a.ownerKind === "task" && a.ownerId === taskId && a.bucket === "work");
            const handoff = proposal.allocations.find(a => a.ownerKind === "task" && a.ownerId === taskId && a.bucket === "handoff");
            if (!allocation || !handoff) throw new ControlError("recovery-blocked");
            const before = allocation.amount;
            // R10: sessions is not in the payload; it is carried over unchanged.
            const next: Amount = { ...before, tokens: payload.work.tokens, activeMs: payload.work.activeMs, attempts: payload.work.attempts };
            // A plan-version bump with identical bytes is a no-op too; the recipe then keeps its version.
            if (expanded.canonicalJson === current.originalContractCanonicalJson && same(next, before)) throw new ControlError("no-op-command");
            // Step 6's refusal, before anything is written: the reserve may not go negative in any dimension.
            for (const d of dimensions) {
              const shortfall = next[d] - before[d] - proposal.explicitUnallocatedReserve[d];
              if (shortfall > 0) throw new ControlError("group-reserve-insufficient", `${d}:${shortfall}`);
            }
            if (loopVersion === Number.MAX_SAFE_INTEGER) throw new ControlError("numeric-overflow");
            // Step 5.
            const amendmentHash = writeTaskAmendment(this.store, id, {
              schema: TASK_AMENDMENT_SCHEMA, groupId: id, taskId, loopVersion: loopVersion + 1, previousContractHash: current.originalContractHash,
              recipe: expanded.recipe, originalContractHash: expanded.hash, originalContractCanonicalJson: expanded.canonicalJson,
            });
            writeCanonicalRecord(this.store, id, expanded.hash, expanded.canonicalJson);
            // Drafter finding F10: the projection compares both contract hashes; the claim copies derivedContractHash and grant.
            Object.assign(work, { amendmentHash, loopVersion: loopVersion + 1, originalContractHash: expanded.hash, contract: { contentAddressedHash: expanded.hash } });
            // Step 6.
            for (const d of dimensions) if (next[d] !== before[d]) allocation.fieldProvenance[d] = { provenance: "human", estimateId: null };
            allocation.amount = next;
            if (proposal.state === "editable") {
              // Step 7, draft: the proposal version advances, as every proposal change does, so a stale confirm is refused.
              this.store.db.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id=?").run(JSON.stringify(work), id, taskId);
              const commitments = sumAmounts([...proposal.allocations.filter(a => a.ownerKind !== "reserve").map(a => a.amount), ...estimateCommitments(this.store, id).map(a => a.amount)]);
              setReserve(proposal, residual(proposal.groupLimit, group.used, commitments));
              reopenProposal(this.store, id, group, proposal, commitments);
            } else {
              // Step 7, confirmed: proposalVersion is inside every derived record and checked at A2 and in the projection,
              // so it does not move; only this task's contract is re-derived, at the same derivationVersion.
              for (const d of dimensions) group.ledger.committedRemaining[d] += next[d] - before[d];
              setReserve(proposal, residual(proposal.groupLimit, group.used, group.ledger.committedRemaining));
              const derived = deriveContract({ taskId, originalContractHash: expanded.hash, originalContractCanonicalJson: expanded.canonicalJson, work: next, handoff: handoff.amount }, proposal.proposalVersion);
              writeCanonicalRecord(this.store, id, derived.derivedContractHash, derived.canonicalJson);
              work.derivedContractHash = derived.derivedContractHash;
              work.grant = { ...(work.grant as Record<string, unknown>), work: next };
              this.store.db.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id=?").run(JSON.stringify(work), id, taskId);
              // (Task B3 inserts the snapshot copy here.)
              saveWebAuthority(this.store, group, proposal);
              // Step 8: the changed task passes A2 before this commits.
              readConfirmedTaskExecution(this.store, id, taskId);
            }
            // Step 8: the ledger still conserves.
            assertKnownConservation(this.store, readWebGroup(this.store, id), readBudgetProposal(this.store, id));
            return success(context, { kind: "task-loop-set", taskId, loopVersion: loopVersion + 1, proposalVersion: proposal.proposalVersion });
          },
        }).body);
      }
    ```
  - `web/src/controlTypes.ts`: append `| "set-task-loop"` to the verb union at line 261; after line 279 add `    | { kind: "task-loop-set"; taskId: string; loopVersion: number; proposalVersion: number }`; append `/** Loop plans spec §5.2: change a loop task's plan, inputs and work budget (sessions is carried over). */\nexport type SetTaskLoopPayloadV1 = { baseLoopVersion: number; plan: string; inputs: LoopInputsV1; work: { tokens: number; activeMs: number; attempts: number } };`.
  - `tests/panel/webParity.test.ts` (additive): import `SetTaskLoopPayload as ServerSetTaskLoopPayload` next to line 42 and `SetTaskLoopPayloadV1 as WebSetTaskLoopPayloadV1` next to line 68; after line 205 add
    ```ts
    // Loop plans spec §5.2: the set-task-loop command's payload.
    function setTaskLoopServerToWeb(x: ServerSetTaskLoopPayload): WebSetTaskLoopPayloadV1 { return x; }
    function setTaskLoopWebToServer(x: WebSetTaskLoopPayloadV1): ServerSetTaskLoopPayload { return x; }
    ```
    and add `  setTaskLoopServerToWeb,\n  setTaskLoopWebToServer,` after line 266.

- [ ] **Step 4: Run, expect PASS**

```bash
./node_modules/.bin/vitest run tests/control/setTaskLoop.test.ts tests/control/taskAmendments.test.ts tests/control/errorClassification.test.ts tests/control/webProtocol.test.ts tests/control/taskLabels.test.ts tests/control/proposal.test.ts tests/panel/webParity.test.ts > "$SCRATCH/b2-green.txt" 2>&1; echo rc=$?
npm run typecheck > "$SCRATCH/b2-tsc.txt" 2>&1; echo rc=$?
(cd web && ../node_modules/.bin/tsc --noEmit -p tsconfig.json) > "$SCRATCH/b2-web-tsc.txt" 2>&1; echo rc=$?
```
Expected all `rc=0`.

- [ ] **Step 5: Mutations** (`$SCRATCH/mut-b2`; files: the seven modified files and two new ones; criterion file `tests/control/setTaskLoop.test.ts`)
  - MB2-1 count only active runs as started: `"SELECT id FROM runs WHERE group_id=? AND work_item_id=?"` → `"SELECT id FROM runs WHERE group_id=? AND work_item_id=? AND active=1"`. Red: `… > refuses a task that is running, and one that has any run at all …` (second assertion).
  - MB2-2 drop the reserve check (the `for (const d of dimensions) { const shortfall = … }` block deleted). Red: `… > refuses a raise the reserve cannot cover …` (the draft path now fails as `group-budget-unavailable` from `residual`).
  - MB2-3 skip the self-check: delete `readConfirmedTaskExecution(this.store, id, taskId);`. Red: `the self-check … > rolls a confirmed change back …` (the change commits).
  - MB2-4 stopped group accepted: delete `|| group.stopped`. Red: `… > refuses a stopped group …`.
  - MB2-5 estimate check deleted (the `for (const estimate of …)` loop). Red: `… > refuses while an estimate is running …`.
  - MB2-6 version check deleted. Red: `… > refuses a stale loopVersion, …`.
  - MB2-7 no-op check deleted. Red: `… > refuses the same contract and the same budget as no-op-command`.
  - MB2-8 draft reserve row not updated: delete the draft branch's `setReserve(proposal, residual(proposal.groupLimit, group.used, commitments));`. Red: `a change before confirmation > raises the budget …` (the step-8 conservation check refuses the command).
  - MB2-9 draft proposal version kept: replace `reopenProposal(this.store, id, group, proposal, commitments);` with `group.ledger.committedRemaining = commitments; saveWebAuthority(this.store, group, proposal);`. Red: `… > raises the budget … advances the proposal version …` (`proposalVersion: 2` and the stale confirm).

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add src/control/errors.ts src/control/webProtocol.ts src/control/executionSnapshot.ts src/control/webService.ts web/src/controlTypes.ts tests/panel/webParity.test.ts tests/control/fixtures/taskLoop.ts tests/control/setTaskLoop.test.ts
/usr/bin/git commit -F - <<'EOF'
feat(control): add set-task-loop for a loop task that has not started

The command refuses, by name and before writing, a group that is not draft
or ready or is stopped, an unknown ledger, a started task (any run row), a
running estimate, a stale loopVersion, a hand-written task, an invalid plan
or path, a no-op and a raise the reserve cannot cover. It writes an amendment
record and moves the task's work budget to or from the reserve; on a draft
group the proposal version advances. A confirmed group's change is derived
and then self-checked against A2 and the ledger before commit.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GCbsgLfqFPgpeG3gTbBkbh
EOF
```

---

### Task B3: A change after confirmation — the snapshot copy, and the change with the driver

**Files:**
- Modify: `src/control/executionSnapshot.ts` — new exported `replaceTaskInSnapshot` after `buildExecutionSnapshot` (ends line 263)
- Modify: `src/control/webService.ts` — imports (line 8, line 17); the `(Task B3 inserts the snapshot copy here.)` line in `setTaskLoop`
- Create: `tests/control/setTaskLoopConfirmed.test.ts`

**Interfaces:**
- Consumes: `executionSnapshotSchema`, `ExecutionSnapshotV1` (webProtocol.ts); `readCanonicalRecord` (snapshot.ts); B2's `setTaskLoop` and fixture.
- Produces:
  ```ts
  export function replaceTaskInSnapshot(
    snapshot: ExecutionSnapshotV1, taskId: string, derivedContractHash: string,
    allocations: { work: ExecutionSnapshotV1["allocations"][number]; handoff: ExecutionSnapshotV1["allocations"][number] },
  ): { snapshot: ExecutionSnapshotV1; canonicalJson: string; snapshotHash: string };
  ```

- [ ] **Step 1: Write the failing criteria** — `tests/control/setTaskLoopConfirmed.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { canonicalBytes } from "../../src/control/canonicalJson.js";
import { readConfirmedTaskExecution } from "../../src/control/executionSnapshot.js";
import { readBudgetProposal } from "../../src/control/queries.js";
import { WebControlService, readWebGroup } from "../../src/control/webService.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { change, errorOf, expectConserved, loop, snapshotOf, workAllocation, workBody } from "./fixtures/taskLoop.js";
import { webFixture } from "./fixtures/web.js";

/**
 * Loop plans spec §5.2 steps 6-8 (criteria 9, 10, 11, 12; R2, R3). After confirmation a change moves the budget with the
 * ledger conserved, keeps proposalVersion (it is inside every task's derived record), copies the snapshot replacing only
 * the changed task's derived contract and two allocations, and must leave every other task -- running or not -- exactly
 * as it was. The driver then runs the new contract, and a claim that won first refuses the change.
 */
async function confirmed() {
  const h = await webFixture(undefined, [{ taskId: "a", loop: loop("a") }, { taskId: "b", loop: loop("b") }]);
  const service = new WebControlService(h.deps);
  const answer = await service.confirm(h.command("confirm", await h.confirmPayload()));
  if ("error" in answer) throw new Error(JSON.stringify(answer));
  return { h, service };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const without = (snapshot: any, taskId: string) => ({
  ...snapshot,
  derivedContracts: snapshot.derivedContracts.filter((entry: { taskId: string }) => entry.taskId !== taskId),
  allocations: snapshot.allocations.filter((row: { ownerKind: string; ownerId: string }) => !(row.ownerKind === "task" && row.ownerId === taskId)),
});
const CHANGED = { inputs: { goal: "write a, changed" } };

describe("a change after confirmation (criteria 9, 10)", () => {
  it("raises the budget from the reserve, keeps proposalVersion, and the changed task passes A2 with the new contract", async () => {
    const { h, service } = await confirmed();
    try {
      const before = { group: readWebGroup(h.store, "g"), version: readBudgetProposal(h.store, "g").proposalVersion, work: workAllocation(h, "a").amount };
      expect(service.setTaskLoop(change(h, "a", { ...CHANGED, tokens: before.work.tokens + 500_000 })))
        .toMatchObject({ result: { kind: "task-loop-set", taskId: "a", loopVersion: 1, proposalVersion: before.version } });
      expectConserved(h);
      const after = readWebGroup(h.store, "g");
      expect(readBudgetProposal(h.store, "g").proposalVersion).toBe(before.version);
      expect(after.used).toEqual(before.group.used);
      expect(after.reserved.tokens).toBe(before.group.reserved.tokens + 500_000);
      const raised = { ...before.work, tokens: before.work.tokens + 500_000 };
      expect(workAllocation(h, "a").amount).toEqual(raised);
      expect(workBody(h, "a").grant).toMatchObject({ work: raised });
      const a = readConfirmedTaskExecution(h.store, "g", "a");
      expect(a.contract.objective.goal).toBe("write a, changed");
      expect(a.contract.executionPolicy.tokenBudget).toBe(raised.tokens);
      const item = readControlGroup(h.store, "epoch", "g").workItems.find((entry) => entry.taskId === "a")!;
      expect(item.derivedContractHash).toBe(a.derivedContractHash);
      expect(item.loopPlan).toMatchObject({ amended: true, loopVersion: 1 });
    } finally { await h.dispose(); }
  });

  it("lowers the budget back into the reserve", async () => {
    const { h, service } = await confirmed();
    try {
      const before = { group: readWebGroup(h.store, "g"), work: workAllocation(h, "a").amount };
      expect(service.setTaskLoop(change(h, "a", { tokens: before.work.tokens - 1_000_000, attempts: before.work.attempts - 1 }))).toMatchObject({ result: { kind: "task-loop-set" } });
      expectConserved(h);
      const after = readWebGroup(h.store, "g");
      expect(after.ledger.explicitUnallocatedReserve.tokens).toBe(before.group.ledger.explicitUnallocatedReserve.tokens + 1_000_000);
      expect(after.ledger.explicitUnallocatedReserve.attempts).toBe(before.group.ledger.explicitUnallocatedReserve.attempts + 1);
      expect(after.used).toEqual(before.group.used);
      expect(readConfirmedTaskExecution(h.store, "g", "a").contract.executionPolicy.maxAttempts).toBe(before.work.attempts - 1);
      expect(workAllocation(h, "a").amount.sessions).toBe(before.work.sessions);
    } finally { await h.dispose(); }
  });

  it("leaves every other part of the snapshot byte-identical (spec §5.2 step 7, R2)", async () => {
    const { h, service } = await confirmed();
    try {
      const before = snapshotOf(h), b = readConfirmedTaskExecution(h.store, "g", "b");
      expect(service.setTaskLoop(change(h, "a", { ...CHANGED, tokens: workAllocation(h, "a").amount.tokens + 500_000 }))).toMatchObject({ result: { kind: "task-loop-set" } });
      const after = snapshotOf(h);
      expect(canonicalBytes(without(after, "a")).equals(canonicalBytes(without(before, "a")))).toBe(true);
      expect(after.derivedContracts.find((entry: { taskId: string }) => entry.taskId === "a")).not.toEqual(before.derivedContracts.find((entry: { taskId: string }) => entry.taskId === "a"));
      expect(readConfirmedTaskExecution(h.store, "g", "b").derivedContractHash).toBe(b.derivedContractHash);
    } finally { await h.dispose(); }
  });
});

describe("the change and the driver (criteria 11, 12)", () => {
  it("a command before the claim: the claim runs the new contract", async () => {
    const t = await driverHarness([{ taskId: "a", loop: loop("a") }]);
    try {
      expect(t.service.setTaskLoop(change(t.h, "a", CHANGED))).toMatchObject({ result: { kind: "task-loop-set" } });
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.fake.calls.accept.length > 0);
      const accepted = t.fake.calls.accept[0] as unknown as { work: { contract: { objective: { goal: string } } } };
      expect(accepted.work.contract.objective.goal).toBe("write a, changed");
      await t.until(driver, () => t.body(runId).state === "settled");
    } finally { await t.h.dispose(); }
  }, 60_000);

  it("a claim before the command: the command is refused as task-already-started", async () => {
    const t = await driverHarness([{ taskId: "a", loop: loop("a") }]);
    try {
      await t.claim();
      expect(errorOf(t.service.setTaskLoop(change(t.h, "a", CHANGED)))).toMatchObject({ code: "task-already-started" });
    } finally { await t.h.dispose(); }
  });

  it("changing one task while another runs leaves the running one able to settle (criterion 11)", async () => {
    const t = await driverHarness([{ taskId: "a", loop: loop("a") }, { taskId: "b", loop: loop("b") }]);
    try {
      const runA = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runA).state === "accepted");
      expect(t.service.setTaskLoop(change(t.h, "b", { inputs: { goal: "write b, changed" }, tokens: workAllocation(t.h, "b").amount.tokens + 500_000 })))
        .toMatchObject({ result: { kind: "task-loop-set", taskId: "b" } });
      await t.until(driver, () => t.body(runA).state === "settled");
      expect(t.body(runA).drive.blockedReason ?? null).toBeNull();
      expect(readConfirmedTaskExecution(t.h.store, "g", "b").contract.objective.goal).toBe("write b, changed");
    } finally { await t.h.dispose(); }
  }, 60_000);
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
./node_modules/.bin/vitest run tests/control/setTaskLoopConfirmed.test.ts > "$SCRATCH/b3-red.txt" 2>&1; echo rc=$?
```
Expected `rc=1`: every confirmed change is refused `recovery-blocked` by B2's self-check (the snapshot still names the old derived contract); the `task-already-started` criterion alone passes.

- [ ] **Step 3: Implement**
  - `src/control/executionSnapshot.ts`, after `buildExecutionSnapshot` (line 263):
    ```ts
    /**
     * Loop plans spec §5.2 step 7 (independent review R2): a confirmed task's change rewrites only that task's derived
     * contract entry and its two allocations. Every other entry, the agents and the rest are copied byte for byte: a full
     * rebuild would re-derive held, continuing and terminal tasks from their re-amounted allocations and change their
     * hashes, and would rewrite the reserve row.
     */
    export function replaceTaskInSnapshot(
      snapshot: ExecutionSnapshotV1, taskId: string, derivedContractHash: string,
      allocations: { work: ExecutionAllocation; handoff: ExecutionAllocation },
    ): { snapshot: ExecutionSnapshotV1; canonicalJson: string; snapshotHash: string } {
      const next = structuredClone(snapshot);
      const ref = next.derivedContracts.find(entry => entry.taskId === taskId);
      if (!ref) throw new ControlError("recovery-blocked");
      ref.derivedContractHash = derivedContractHash;
      for (const bucket of ["work", "handoff"] as const) {
        const index = next.allocations.findIndex(row => row.ownerKind === "task" && row.ownerId === taskId && row.bucket === bucket);
        if (index < 0) throw new ControlError("recovery-blocked");
        next.allocations[index] = structuredClone(allocations[bucket]);
      }
      const parsed = executionSnapshotSchema.parse(next);
      return { snapshot: parsed, canonicalJson: canonicalBytes(parsed).toString("utf8"), snapshotHash: sha256Canonical(parsed) };
    }
    ```
  - `src/control/webService.ts`: line 8 import adds `replaceTaskInSnapshot`; line 17 becomes `import { dispatchEnvelopeSchema, estimateExecutionContractSchema, executionSnapshotSchema } from "./webProtocol.js";`. Replace the line `          // (Task B3 inserts the snapshot copy here.)` with:
    ```ts
              // Step 7: copy the confirmed snapshot, replacing only this task's derived contract and its two allocations,
              // and point the proposal (and, through saveWebAuthority, the group's mirror) at it. Old snapshots are kept.
              const frozen = executionSnapshotSchema.parse(JSON.parse(readCanonicalRecord(this.store, proposal.executionSnapshotHash!)));
              const bare = ({ state: _state, ...rest }: BudgetProposalRecord["allocations"][number]) => rest;
              const rebuilt = replaceTaskInSnapshot(frozen, taskId, derived.derivedContractHash, { work: bare(allocation), handoff: bare(handoff) });
              writeCanonicalRecord(this.store, id, rebuilt.snapshotHash, rebuilt.canonicalJson);
              proposal.executionSnapshotHash = rebuilt.snapshotHash;
    ```

- [ ] **Step 4: Run, expect PASS**

```bash
./node_modules/.bin/vitest run tests/control/setTaskLoopConfirmed.test.ts tests/control/setTaskLoop.test.ts tests/control/executionSnapshot.test.ts tests/control/executionDriver.test.ts tests/control/driverSettle.test.ts > "$SCRATCH/b3-green.txt" 2>&1; echo rc=$?
npm run typecheck > "$SCRATCH/b3-tsc.txt" 2>&1; echo rc=$?
```
Expected both `rc=0`. (`driverSettle.test.ts` is a registered load flake: if it alone is red, rerun it alone and record `uptime`.)

- [ ] **Step 5: Mutations** (`$SCRATCH/mut-b3`; files `src/control/executionSnapshot.ts src/control/webService.ts tests/control/setTaskLoopConfirmed.test.ts`; criterion file `tests/control/setTaskLoopConfirmed.test.ts`)
  - MB3-1 rebuild instead of copy: in the inserted block, `replaceTaskInSnapshot(frozen, …)` → `replaceTaskInSnapshot({ ...frozen, allocations: proposal.allocations.map(bare) }, …)` (every allocation, the reserve row included, taken from the live proposal, as a full rebuild would). Red: `… > leaves every other part of the snapshot byte-identical …`.
  - MB3-2 bump `proposalVersion` on a confirmed change: add `proposal.proposalVersion += 1;` as the first line of the confirmed branch. Red: `… > raises the budget from the reserve, keeps proposalVersion …` (refused `recovery-blocked` by the self-check, or the version expectation).
  - MB3-3 update `reserved` but not the reserve row: delete the confirmed branch's `setReserve(…)` line. Red: `… > raises the budget …` and `… > lowers the budget …` (the step-8 conservation check refuses).
  - MB3-4 work item's derived hash not moved: delete `work.derivedContractHash = derived.derivedContractHash;`. Red: `… > raises the budget …` (`readControlGroup` blocks `work-item-authority:a`).
  - MB3-5 claim grant not moved: delete `work.grant = { …, work: next };`. Red: `… > raises the budget …` (`grant` assertion).
  - MB3-6 bypass `effectivePlanTask` in A2 (as MB1-1). Red: `the change and the driver > a command before the claim: …` (the command's self-check refuses it).

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add src/control/executionSnapshot.ts src/control/webService.ts tests/control/setTaskLoopConfirmed.test.ts
/usr/bin/git commit -F - <<'EOF'
feat(control): let set-task-loop change a confirmed task by copying its snapshot

A confirmed change copies the execution snapshot and replaces only the task's
derived contract and its two allocations, so every other task's entries, the
agents and the reserve row stay byte-identical and proposalVersion does not
move. The driver then runs the new contract; a claim that wins first makes
the change task-already-started, and a running task settles untouched.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GCbsgLfqFPgpeG3gTbBkbh
EOF
```

---

### Task B4: One owner for a loop task's work budget

**Files:**
- Modify: `src/control/errors.ts` (422 block, next to B2's entries)
- Modify: `src/control/webService.ts` — `editProposal` (after line 215 `assertKnownConservation(this.store, group, proposal);`, and inside the operations loop before line 221 `const row = allocationFor(proposal, op.target);`)
- Modify: `web/src/BudgetEditor.tsx` — imports (12-22), `targetOf` (45-50), the row cell (257-266 area: `if (target === null) return <td key={dimension}>{allocation.amount[dimension]}</td>;`)
- Create: `tests/control/loopBudgetOwner.test.ts`, `web/tests/loopBudgetRows.test.tsx`

**Interfaces:**
- Consumes: `ControlPlanV1` task `loop` (A4); `WorkItemViewV1.loopPlan` (A5).
- Produces: `proposal-edit` refuses an operation targeting a loop task's work allocation with `budget-owned-by-loop-plan` (422); `export function loopOwned(item: WorkItemViewV1): boolean` in `web/src/BudgetEditor.tsx`; loop work rows render read-only with "在做法卡片里改" and never appear in `editedOperations` / `suggestedOperations`.

- [ ] **Step 1: Write the failing criteria**

`tests/control/loopBudgetOwner.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readBudgetProposal } from "../../src/control/queries.js";
import { WebControlService } from "../../src/control/webService.js";
import { errorOf, loop } from "./fixtures/taskLoop.js";
import { webFixture } from "./fixtures/web.js";

/**
 * Loop plans spec §4.3 (C6, Rule 7; criterion 8's last line): a loop task's work allocation has one owner,
 * set-task-loop. proposal-edit refuses an operation on it by name; a loop task's handoff row, a hand-written task's rows,
 * the group limit and goal review stay with proposal-edit.
 */
describe("who owns a loop task's work budget (spec §4.3)", () => {
  it("refuses proposal-edit on a loop task's work row, and only there", async () => {
    const h = await webFixture(undefined, [{ taskId: "a", loop: loop("a") }, { taskId: "c" }]);
    try {
      const service = new WebControlService(h.deps);
      const edit = (taskId: string, allocation: "work" | "handoff", value: number) => service.editProposal(h.command("proposal-edit", {
        baseProposalVersion: readBudgetProposal(h.store, "g").proposalVersion,
        operations: [{ target: { scope: "task", taskId, allocation, dimension: "tokens" }, value, provenance: "human" }],
      }));
      expect(errorOf(edit("a", "work", 2_000_000))).toMatchObject({ code: "budget-owned-by-loop-plan" });
      expect(edit("a", "handoff", 200_000)).toMatchObject({ result: { kind: "proposal-edited" } });
      expect(edit("c", "work", 2_000_000)).toMatchObject({ result: { kind: "proposal-edited" } });
    } finally { await h.dispose(); }
  });
});
```

`web/tests/loopBudgetRows.test.tsx`: copy the head of `web/tests/budgetHandoffCapability.test.tsx` verbatim — from line 1 through the end of the `view` literal (≈ line 33; re-measure): the imports, `amount`, `human`, `provenance`, `PLAN`, `DURABLE`, `config`, `view` — replace its doc comment with one citing loop plans spec §4.3, then change `view` so that `allocations` is
```ts
  allocations: [
    { ownerKind: "task", ownerId: "a", bucket: "work", state: "draft-encumbered", amount: amount(3_000), fieldProvenance: provenance },
    { ownerKind: "task", ownerId: "a", bucket: "handoff", state: "draft-encumbered", amount: amount(300), fieldProvenance: provenance },
    { ownerKind: "task", ownerId: "c", bucket: "work", state: "draft-encumbered", amount: amount(3_000), fieldProvenance: provenance },
    { ownerKind: "task", ownerId: "c", bucket: "handoff", state: "draft-encumbered", amount: amount(300), fieldProvenance: provenance },
  ],
```
and `workItems` holds two items: `a` with `loopPlan` = the `PLAN` literal of `web/tests/loopPlanCard.test.tsx` (rename it `LOOP_PLAN` here to avoid the existing `PLAN` hash constant) and `c` with `loopPlan: null` (both otherwise as the existing item literal, `c` with `taskId: "c"`). Add the import `budgetFieldKey, editedOperations` from `../src/BudgetEditor.js`, then:

```tsx
describe("a loop task's work row is the plan card's (spec §4.3)", () => {
  it("shows the loop task's work row read-only, pointing at the card, and leaves every other row editable", () => {
    const { container } = render(<BudgetEditor view={view} config={config(DURABLE)} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.queryByRole("textbox", { name: /^a work tokens/ })).toBeNull();
    expect(container.textContent).toContain("在做法卡片里改");
    expect(screen.getByRole("textbox", { name: /^a handoff tokens/ })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: /^c work tokens/ })).toBeTruthy();
  });

  it("never turns a draft of the loop task's work row into a proposal-edit operation", () => {
    const key = budgetFieldKey("g", { scope: "task", taskId: "a", allocation: "work", dimension: "tokens" });
    expect(editedOperations(view, { [key]: "5" })).toEqual([]);
    const other = budgetFieldKey("g", { scope: "task", taskId: "c", allocation: "work", dimension: "tokens" });
    expect(editedOperations(view, { [other]: "5" })).toEqual([{ target: { scope: "task", taskId: "c", allocation: "work", dimension: "tokens" }, value: 5, provenance: "human" }]);
  });
});
```
(`screen` must be added to the `@testing-library/react` import.)

- [ ] **Step 2: Run, expect FAIL**

```bash
./node_modules/.bin/vitest run tests/control/loopBudgetOwner.test.ts > "$SCRATCH/b4-red.txt" 2>&1; echo rc=$?
(cd web && ../node_modules/.bin/vitest run tests/loopBudgetRows.test.tsx) > "$SCRATCH/b4-web-red.txt" 2>&1; echo rc=$?
```
Expected both `rc=1`: the loop work edit is accepted; the editor renders an input for `a work tokens`.

- [ ] **Step 3: Implement**
  - `src/control/errors.ts`, next to B2's 422 entries: `  // Loop plans spec §4.3 (C6): a loop task's work allocation is changed only by set-task-loop.\n  "budget-owned-by-loop-plan": 422,`.
  - `src/control/webService.ts` `editProposal`: after line 215 insert
    ```ts
            // Loop plans spec §4.3 (C6, Rule 7): a loop task's work allocation has one owner, set-task-loop.
            const loopTasks = new Set(readArchivedPlan(this.store, id).plan.tasks.filter(task => task.loop !== undefined).map(task => task.taskId));
    ```
    and inside the loop, before `const row = allocationFor(proposal, op.target);`, insert
    ```ts
              if (op.target.scope === "task" && op.target.allocation === "work" && loopTasks.has(op.target.taskId)) throw new ControlError("budget-owned-by-loop-plan");
    ```
  - `web/src/BudgetEditor.tsx`: add `WorkItemViewV1` to the type import; before `targetOf` add
    ```ts
    /** Loop plans spec §4.3 (C6): a loop task's work budget is changed only on its plan card (set-task-loop). */
    export const loopOwned = (item: WorkItemViewV1): boolean => item.loopPlan !== undefined && item.loopPlan !== null;
    ```
    In `targetOf`, replace `  const task = view.workItems.find((item) => item.taskId === ownerId);` with
    ```ts
      const task = view.workItems.find((item) => item.taskId === ownerId);
      // Read-only here, so no edit and no suggestion button ever sends proposal-edit for it (Drafter finding F14).
      if (task !== undefined && bucket === "work" && loopOwned(task)) return null;
    ```
    Replace `if (target === null) return <td key={dimension}>{allocation.amount[dimension]}</td>;` with
    ```tsx
                    if (target === null) {
                      const owned = allocation.ownerKind === "task" && allocation.bucket === "work" && view.workItems.some((item) => item.taskId === allocation.ownerId && loopOwned(item));
                      return <td key={dimension}>{allocation.amount[dimension]}{owned ? <small> 在做法卡片里改</small> : null}</td>;
                    }
    ```

- [ ] **Step 4: Run, expect PASS**

```bash
./node_modules/.bin/vitest run tests/control/loopBudgetOwner.test.ts tests/control/proposal.test.ts tests/control/confirmation.test.ts > "$SCRATCH/b4-green.txt" 2>&1; echo rc=$?
(cd web && ../node_modules/.bin/vitest run tests/loopBudgetRows.test.tsx tests/budgetSuggestions.test.tsx tests/budgetHandoffCapability.test.tsx tests/controlPanel.test.tsx) > "$SCRATCH/b4-web-green.txt" 2>&1; echo rc=$?
npm run typecheck > "$SCRATCH/b4-tsc.txt" 2>&1; echo rc=$?
(cd web && ../node_modules/.bin/tsc --noEmit -p tsconfig.json) > "$SCRATCH/b4-web-tsc.txt" 2>&1; echo rc=$?
```
Expected all `rc=0`.

- [ ] **Step 5: Mutations** (`$SCRATCH/mut-b4`; files: the three modified sources and two new tests)
  - MB4-1 server refusal deleted (the `if (op.target.scope === "task" && … ) throw …` line). Red (`tests/control/loopBudgetOwner.test.ts`): `… > refuses proposal-edit on a loop task's work row, and only there`.
  - MB4-2 refusal on every bucket: `op.target.allocation === "work" &&` removed. Red: same criterion (the handoff edit).
  - MB4-3 editor row editable again: delete the `if (task !== undefined && bucket === "work" && loopOwned(task)) return null;` line. Red (`web/tests/loopBudgetRows.test.tsx`): both criteria.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add src/control/errors.ts src/control/webService.ts web/src/BudgetEditor.tsx tests/control/loopBudgetOwner.test.ts web/tests/loopBudgetRows.test.tsx
/usr/bin/git commit -F - <<'EOF'
feat(control): give a loop task's work budget one owner, set-task-loop

proposal-edit refuses an operation on a loop task's work allocation as
budget-owned-by-loop-plan; the budget editor shows those rows read-only and
points at the plan card, so no edit or suggestion is sent for them.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GCbsgLfqFPgpeG3gTbBkbh
EOF
```

---

### Task B5: The HTTP route and the web mirror of the plan names

**Files:**
- Modify: `src/panel/controlApi.ts` — route table (after the `set-task-labels` entry, lines 296-303); dispatcher (after line 329 `case "set-task-labels": …`)
- Modify: `web/src/controlTypes.ts` (append `WEB_LOOP_PLANS`)
- Create: `tests/panel/taskLoopApi.test.ts`

**Interfaces:**
- Consumes: `WebControlService.setTaskLoop` (B2, B3); `loopPlanDefinition`, `currentLoopPlanVersion`, `LOOP_PLAN_IDS` (A1).
- Produces: `POST /api/control/groups/:groupId/tasks/:taskId/loop` (target `{ kind: "task", groupId, taskId }`, ledger key the group's); `export const WEB_LOOP_PLANS: ReadonlyArray<{ planId: LoopPlanIdV1; name: string }>` in `web/src/controlTypes.ts`.

- [ ] **Step 1: Write the failing criteria** — `tests/panel/taskLoopApi.test.ts`:

```ts
import { writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { LOOP_PLAN_IDS, currentLoopPlanVersion, loopPlanDefinition } from "../../src/control/loopPlans.js";
import { commandLookupSchema, commandSuccessSchema } from "../../src/control/webProtocol.js";
import { WEB_LOOP_PLANS } from "../../web/src/controlTypes.js";
import { GROUP, command, createHarness, get, json, view } from "./fixtures/controlPanel.js";

/**
 * Loop plans spec §5.2 over a real Panel: the one new POST route, a refusal that is ledgered and names its reason, a
 * wrong-shaped payload that never reaches the ledger, and the web mirror of the plans' names (spec §2.2).
 */
const h = createHarness();
afterAll(async () => { await h.dispose(); });

const LOOP_ROUTE = `/api/control/groups/${GROUP}/tasks/a/loop`;
const LOOP = { plan: "standard", goal: "ship a", successCondition: "a passes", targetPaths: ["a.ts"], checks: ["true"] };

async function importedLoopPanel(epoch: string) {
  const paths = await h.workspace();
  // The harness's plan names a contract file for task a; this criterion needs the same task as a loop task (spec §3.1).
  await writeFile(paths.planPath, JSON.stringify({
    targetRepo: paths.repo, ccloopBin: paths.binary, runsDir: dirname(paths.repo), workBranch: "orca/work", policy: "local-merge", ledgerMode: "out-of-repo",
    goal: "Ship a", successConditions: ["a passes"], tasks: [{ taskId: "a", loop: LOOP, dependsOn: [], targetVersion: 1 }],
  }));
  const panel = await h.boot(epoch, paths);
  const answer = await command(panel, "/api/control/groups/import-plan", { commandId: `${epoch}-import`, expectedRevision: 0, payload: { groupId: GROUP, repoId: "repo", planId: "plan" } });
  expect(answer.status).toBe(201);
  return panel;
}
type Panel = Awaited<ReturnType<typeof importedLoopPanel>>;
/** A set-task-loop body built from what the panel shows, with `over` applied to the inputs. */
async function body(panel: Panel, commandId: string, over: Record<string, unknown> = {}) {
  const current = await view(panel);
  const plan = current.workItems[0]!.loopPlan!;
  const work = current.allocations.find((row) => row.ownerKind === "task" && row.ownerId === "a" && row.bucket === "work")!.amount;
  return { commandId, expectedRevision: current.summary.commandRevision,
    payload: { baseLoopVersion: plan.loopVersion, plan: plan.planId, inputs: { ...plan.inputs, ...over }, work: { tokens: work.tokens, activeMs: work.activeMs, attempts: work.attempts } } };
}

describe("the set-task-loop route (spec §5.2)", () => {
  it("changes a loop task over POST /tasks/:taskId/loop, and the view shows it amended", async () => {
    const panel = await importedLoopPanel("epoch-loop-set");
    const answer = await command(panel, LOOP_ROUTE, await body(panel, "loop-1", { goal: "ship a, changed" }));
    expect(answer.status).toBe(200);
    expect(commandSuccessSchema.parse(answer.body)).toMatchObject({
      verb: "set-task-loop", target: { kind: "task", groupId: GROUP, taskId: "a" }, result: { kind: "task-loop-set", taskId: "a", loopVersion: 1 },
    });
    expect((await view(panel)).workItems[0]!.loopPlan).toMatchObject({ amended: true, loopVersion: 1, inputs: { goal: "ship a, changed" } });
    await panel.close();
  });

  it("ledgers a refused path shape as loop-plan-invalid naming the reason", async () => {
    const panel = await importedLoopPanel("epoch-loop-invalid");
    const answer = await command(panel, LOOP_ROUTE, await body(panel, "loop-bad", { targetPaths: ["src/*.ts"] }));
    expect(answer.status).toBe(422);
    expect(answer.body).toMatchObject({ error: { code: "loop-plan-invalid", message: "loop-plan-invalid:path-shape" } });
    const lookup = commandLookupSchema.parse(await json(await get(panel, `/api/control/groups/${GROUP}/commands/loop-bad`)));
    expect(lookup).toMatchObject({ originalStatus: 422, body: { error: { code: "loop-plan-invalid" } } });
    await panel.close();
  });

  it("refuses a payload of the wrong shape before the ledger, as control-non-json-payload", async () => {
    const panel = await importedLoopPanel("epoch-loop-shape");
    const answer = await command(panel, LOOP_ROUTE, { commandId: "loop-shape", expectedRevision: (await view(panel)).summary.commandRevision, payload: { baseLoopVersion: 0, plan: "standard" } });
    expect(answer.status).toBe(400);
    expect(answer.body).toMatchObject({ error: { code: "control-non-json-payload" } });
    await panel.close();
  });

  it("mirrors every plan's current panel name on the web side", () => {
    expect(WEB_LOOP_PLANS.map((plan) => [plan.planId, plan.name]))
      .toEqual(LOOP_PLAN_IDS.map((planId) => [planId, loopPlanDefinition(planId, currentLoopPlanVersion(planId)!)!.name]));
  });
});
```

(If `view(panel)`'s declared return type is not the server `GroupViewV1`, cast it: `(await view(panel)) as GroupViewV1` with `import type { GroupViewV1 } from "../../src/control/webProtocol.js"` — re-measure `tests/panel/fixtures/controlPanel.ts`.)

- [ ] **Step 2: Run, expect FAIL**

```bash
./node_modules/.bin/vitest run tests/panel/taskLoopApi.test.ts > "$SCRATCH/b5-red.txt" 2>&1; echo rc=$?
```
Expected `rc=1`: the route answers 404 (`route-not-found`); `WEB_LOOP_PLANS` is not exported (the typecheck would also fail).

- [ ] **Step 3: Implement**
  - `src/panel/controlApi.ts`, after the `set-task-labels` route entry's closing `},` (line 303):
    ```ts
        // Loop plans spec §5.2: the ledger key is the group's, as for set-task-labels.
        {
          path: "/api/control/groups/:groupId/tasks/:taskId/loop",
          verb: "set-task-loop",
          target: (params) => {
            const groupId = idSchema.parse(params.groupId);
            return { groupId, target: { kind: "task", groupId, taskId: idSchema.parse(params.taskId) } };
          },
        },
    ```
    and after line 329 add `        case "set-task-loop": service.setTaskLoop(command); break;`.
  - `web/src/controlTypes.ts`, append:
    ```ts
    /** Loop plans spec §2.2: the plans a person can pick and their panel names -- a mirror of src/control/loopPlans.ts, compared by tests/panel/taskLoopApi.test.ts. */
    export const WEB_LOOP_PLANS: ReadonlyArray<{ planId: LoopPlanIdV1; name: string }> = [
      { planId: "standard", name: "标准" },
      { planId: "bugfix", name: "修 bug（先红后绿）" },
      { planId: "refactor", name: "安全重构" },
      { planId: "design", name: "先写设计／文档" },
      { planId: "investigate", name: "只调研不改代码" },
    ];
    ```

- [ ] **Step 4: Run, expect PASS**

```bash
./node_modules/.bin/vitest run tests/panel/taskLoopApi.test.ts tests/panel/taskLabelsApi.test.ts tests/panel/controlApi.test.ts > "$SCRATCH/b5-green.txt" 2>&1; echo rc=$?
npm run typecheck > "$SCRATCH/b5-tsc.txt" 2>&1; echo rc=$?
(cd web && ../node_modules/.bin/tsc --noEmit -p tsconfig.json) > "$SCRATCH/b5-web-tsc.txt" 2>&1; echo rc=$?
```
Expected all `rc=0`.

- [ ] **Step 5: Mutations** (`$SCRATCH/mut-b5`; files `src/panel/controlApi.ts web/src/controlTypes.ts tests/panel/taskLoopApi.test.ts`; criterion file `tests/panel/taskLoopApi.test.ts`)
  - MB5-1 route entry deleted. Red: `… > changes a loop task over POST …` and `… > ledgers a refused path shape …`.
  - MB5-2 dispatcher case deleted (the route resolves, the switch falls to `route-not-found`). Red: same two.
  - MB5-3 a web name drifts: `name: "安全重构"` → `name: "重构"`. Red: `… > mirrors every plan's current panel name …`.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add src/panel/controlApi.ts web/src/controlTypes.ts tests/panel/taskLoopApi.test.ts
/usr/bin/git commit -F - <<'EOF'
feat(panel): serve set-task-loop at POST /tasks/:taskId/loop

The route is task-scoped under the group's ledger key, like set-task-labels.
The web side mirrors the plans' panel names, checked against the registry.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GCbsgLfqFPgpeG3gTbBkbh
EOF
```

---

### Task B6: The editable plan card

**Files:**
- Modify: `web/src/controlApi.ts` — type import (line ~37), `ControlAction` (206-218), `controlCommandPath` (after line 249)
- Modify: `web/src/LoopPlanCard.tsx` (A6's file, replaced whole below)
- Modify: `web/src/TaskDetail.tsx` (the A6 `<LoopPlanCard …/>` line)
- Modify: `web/src/App.tsx` — import (line 79 area), after line 290
- Create: `web/tests/loopPlanEdit.test.tsx`, `web/tests/loopPlanDraft.test.tsx`

**Interfaces:**
- Consumes: `SetTaskLoopPayloadV1`, `WEB_LOOP_PLANS`, `LoopPlanViewV1`, `LoopPlanIdV1` (B2, B5, A5).
- Produces:
  ```ts
  // web/src/controlApi.ts
  // ControlAction gains { verb: "set-task-loop"; groupId: string; taskId: string; expectedRevision: number; payload: SetTaskLoopPayloadV1 }
  // controlCommandPath → `/api/control/groups/<g>/tasks/<t>/loop`
  // web/src/LoopPlanCard.tsx
  export const loopDraftKey: (groupId: string, taskId: string) => string;   // `loop:<g>:<t>`
  export function consequenceOf(view: GroupViewV1, current: Amount, work: { tokens: number; activeMs: number; attempts: number }): { text: string; shortfall: string | null };
  export interface LoopPlanCardProps { view: GroupViewV1; item: WorkItemViewV1; drafts: Record<string, string>; onDraft: (key: string, text: string) => void; onCommand: (action: ControlAction) => void }
  export function LoopPlanCard(props: LoopPlanCardProps): JSX.Element | null;
  ```

- [ ] **Step 1: Write the failing criteria**

`web/tests/loopPlanEdit.test.tsx`: copy lines from `// @vitest-environment jsdom` through the `view` builder of `web/tests/loopPlanCard.test.tsx` (Task A6: `amount`, `human`, `provenance`, `capability`, `config`, `PLAN`, `item`, `view`) verbatim, change its doc comment to cite spec §4.2, replace its imports with the ones below, and add:

```tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { controlCommandPath, type ControlAction } from "../src/controlApi.js";
import { TaskDetail } from "../src/TaskDetail.js";
import type { Amount, ControlConfigV1, GroupViewV1, LoopPlanViewV1, WorkItemViewV1 } from "../src/controlTypes.js";

/** TaskDetail over the page's own draft store, so a criterion sees drafts the way App keeps them. */
function Stateful(props: { view: GroupViewV1; onCommand: (action: ControlAction) => void }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const onDraft = (key: string, text: string): void => setDrafts((current) => {
    const next = { ...current };
    if (text === "") delete next[key]; else next[key] = text;
    return next;
  });
  return <TaskDetail view={props.view} item={props.view.workItems[0]!} drafts={drafts} onDraft={onDraft} onCommand={props.onCommand} />;
}

afterEach(cleanup);

describe("changing a loop task's plan on its card (spec §4.2)", () => {
  it("sends the plan, the inputs and the work budget with the loopVersion the draft started from", () => {
    const onCommand = vi.fn();
    const { rerender } = render(<Stateful view={view([item()])} onCommand={onCommand} />);
    fireEvent.click(screen.getByRole("button", { name: "修改做法" }));
    fireEvent.change(screen.getByRole("textbox", { name: "目标" }), { target: { value: "fix login, changed" } });
    fireEvent.change(screen.getByRole("textbox", { name: "token 预算" }), { target: { value: "3500000" } });
    // Someone else changed the plan meanwhile: the draft keeps the version it started from, and says so.
    rerender(<Stateful view={view([item({ loopPlan: { ...PLAN, loopVersion: 1 } })])} onCommand={onCommand} />);
    expect(screen.getByRole("status").textContent).toContain("v0 → v1");
    fireEvent.click(screen.getByRole("button", { name: "预算 +500000 token，从组余量扣；余量剩 5500000" }));
    expect(onCommand).toHaveBeenLastCalledWith({ verb: "set-task-loop", groupId: "g", taskId: "a", expectedRevision: 6, payload: {
      baseLoopVersion: 0, plan: "bugfix", inputs: { ...PLAN.inputs, goal: "fix login, changed" }, work: { tokens: 3_500_000, activeMs: 14_400_000, attempts: 3 },
    } });
  });

  it("disables the submit and names the shortfall when the reserve cannot cover a raise", () => {
    const onCommand = vi.fn();
    render(<Stateful view={view([item()])} onCommand={onCommand} />);
    fireEvent.click(screen.getByRole("button", { name: "修改做法" }));
    fireEvent.change(screen.getByRole("textbox", { name: "token 预算" }), { target: { value: String(3_000_000 + 6_000_000 + 1) } });
    expect(screen.getByRole("alert").textContent).toBe("组余量不够：tokens 还差 1");
    const submit = screen.getByRole("button", { name: /^预算 / }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("freezes a task that has started, and offers no edit for a hand-written task", () => {
    render(<Stateful view={view([item({ status: "active", currentRunId: "run-a", lineageRunIds: ["run-a"] })])} onCommand={vi.fn()} />);
    expect(screen.getByText("已开始，做法已冻结")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "修改做法" })).toBeNull();
    cleanup();
    render(<Stateful view={view([item({ loopPlan: null, objective: { goal: "ship", successCondition: "passes" } })])} onCommand={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "修改做法" })).toBeNull();
  });

  it("sends set-task-loop to the task's loop route", () => {
    expect(controlCommandPath({ verb: "set-task-loop", groupId: "g", taskId: "a", expectedRevision: 1,
      payload: { baseLoopVersion: 0, plan: "bugfix", inputs: PLAN.inputs, work: { tokens: 1, activeMs: 1, attempts: 1 } } })).toBe("/api/control/groups/g/tasks/a/loop");
  });
});
```

`web/tests/loopPlanDraft.test.tsx`: copy `web/tests/taskLabelsDraft.test.tsx` from line 1 through its `afterEach(…)` line (≈ line 63; re-measure) verbatim, then: rename `LABELS` to `const LOOP_ROUTE = "/api/control/groups/g/tasks/a/loop";` (and its use in the fetch stub); in `groupView`, give work item `a` `status: "ready"`, `objective: { goal: "fix login", successCondition: "the login test passes" }` and `loopPlan:` the `PLAN` literal of `web/tests/loopPlanCard.test.tsx`, and set `allocations: [{ ownerKind: "task", ownerId: "a", bucket: "work", state: "confirmed", amount: { tokens: 3_000_000, activeMs: 14_400_000, attempts: 3, sessions: 3 }, fieldProvenance: { tokens: { provenance: "human", estimateId: null }, activeMs: { provenance: "human", estimateId: null }, attempts: { provenance: "human", estimateId: null }, sessions: { provenance: "human", estimateId: null } } }]`; replace the doc comment with one citing loop plans spec §4.2. Then:

```tsx
describe("the loop draft survives a refusal and is cleared by a success (spec §4.2)", () => {
  it("keeps the draft through a refusal, shows the refusal's code, and clears it once the command succeeded", async () => {
    answers = [
      { status: 422, body: { error: { code: "group-reserve-insufficient", message: "group-reserve-insufficient:tokens:1", commandRevision: 6, evidenceIds: [], retryable: false } } },
      { status: 200, body: { schema: "orca-command-success-v1", commandId: "x", actorId: "operator", verb: "set-task-loop", target: { kind: "task", groupId: "g", taskId: "a" }, commandRevision: 7, projectionSeq: 5, effectivePayloadHash: "1".repeat(64), authorityCommandHash: "2".repeat(64), result: { kind: "task-loop-set", taskId: "a", loopVersion: 1, proposalVersion: 2 } } },
    ];
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /^g · running/ }));
    fireEvent.click(await screen.findByRole("button", { name: "a" }));
    fireEvent.click(screen.getByRole("button", { name: "修改做法" }));
    fireEvent.change(screen.getByRole("textbox", { name: "目标" }), { target: { value: "fix login, changed" } });
    fireEvent.click(screen.getByRole("button", { name: /^预算/ }));
    await screen.findByText(/group-reserve-insufficient/);
    expect((screen.getByRole("textbox", { name: "目标" }) as HTMLInputElement).value).toBe("fix login, changed");
    fireEvent.click(screen.getByRole("button", { name: /^预算/ }));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "目标" })).toBeNull());
    expect(posted).toEqual([
      expect.objectContaining({ expectedRevision: 6, payload: expect.objectContaining({ baseLoopVersion: 0, inputs: expect.objectContaining({ goal: "fix login, changed" }) }) }),
      expect.objectContaining({ expectedRevision: 6, payload: expect.objectContaining({ baseLoopVersion: 0 }) }),
    ]);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
(cd web && ../node_modules/.bin/vitest run tests/loopPlanEdit.test.tsx tests/loopPlanDraft.test.tsx) > "$SCRATCH/b6-red.txt" 2>&1; echo rc=$?
```
Expected `rc=1`: there is no "修改做法" button; `controlCommandPath` has no `set-task-loop` case (returns `undefined`).

- [ ] **Step 3: Implement**
  - `web/src/controlApi.ts`: add `SetTaskLoopPayloadV1,` to the type import from `./controlTypes.js`; after line 218 add `  | { verb: "set-task-loop"; groupId: string; taskId: string; expectedRevision: number; payload: SetTaskLoopPayloadV1 }` (moving the union's `;` accordingly); after the `set-task-labels` case's `return` (line 249) add
    ```ts
        case "set-task-loop":
          return `${group}/tasks/${segment(action.taskId)}/loop`;
    ```
  - `web/src/LoopPlanCard.tsx` — replace the whole file with:
    ```tsx
    /**
     * Loop plans spec §4.1, §4.2 (D1, D4, D5, D9): a task's loop plan in plain words, and -- until the task starts -- a form
     * to change the plan, its inputs and its work budget (set-task-loop). The form keeps what the person typed as a draft
     * together with the loopVersion it started from, and sends that version, never the one the latest poll read, so a draft
     * begun before someone else's change is refused as task-loop-version-conflict instead of overwriting it (the label
     * editor's pattern, TaskDetail.tsx). The submit states its consequence for the group's reserve; that arithmetic is
     * display only -- the ledger decides and refuses by name.
     */
    import type { JSX } from "react";
    import type { ControlAction } from "./controlApi.js";
    import { WEB_LOOP_PLANS } from "./controlTypes.js";
    import type { Amount, GroupViewV1, LoopPlanIdV1, LoopPlanViewV1, SetTaskLoopPayloadV1, WorkItemViewV1 } from "./controlTypes.js";

    export const loopDraftKey = (groupId: string, taskId: string): string => `loop:${groupId}:${taskId}`;

    /** "修 bug（先红后绿） · v1 · 按标签 `bug` 选择 · 已修改" (spec §4.1). */
    export function loopPlanTitle(plan: LoopPlanViewV1): string {
      const how = plan.chosenBy === "explicit" ? "人指定" : plan.chosenByLabel === null ? "无标签，按默认" : `按标签 \`${plan.chosenByLabel}\` 选择`;
      return `${plan.planName} · v${plan.planVersion} · ${how}${plan.amended ? " · 已修改" : ""}`;
    }

    const FIELDS = ["goal", "successCondition", "targetPaths", "checks", "nonGoals", "relevantDocs", "protectedPaths", "maxFilesTouched", "tokens", "activeMs", "attempts"] as const;
    type Field = (typeof FIELDS)[number];
    const LIST_FIELDS = new Set<Field>(["targetPaths", "checks", "nonGoals", "relevantDocs", "protectedPaths"]);
    const FIELD_LABEL: Record<Field, string> = {
      goal: "目标", successCondition: "完成条件", targetPaths: "只改（每行一个路径）", checks: "检查命令（每行一条）",
      nonGoals: "不做的事（每行一条）", relevantDocs: "相关文档（每行一个）", protectedPaths: "不许改（每行一个路径）",
      maxFilesTouched: "最多改几个文件（留空按默认）", tokens: "token 预算", activeMs: "活跃时间（ms）", attempts: "最多尝试次数",
    };
    /** What the person typed, as text, and the loopVersion shown when they started. */
    interface LoopDraft { base: number; plan: LoopPlanIdV1; text: Record<Field, string> }

    function readLoopDraft(drafts: Record<string, string>, key: string): LoopDraft | null {
      const raw = drafts[key];
      if (raw === undefined) return null;
      try {
        const parsed = JSON.parse(raw) as Partial<LoopDraft>;
        if (!Number.isSafeInteger(parsed.base) || !WEB_LOOP_PLANS.some((plan) => plan.planId === parsed.plan)) return null;
        const text = parsed.text as Record<string, unknown> | undefined;
        if (typeof text !== "object" || text === null || !FIELDS.every((field) => typeof text[field] === "string")) return null;
        return parsed as LoopDraft;
      } catch {
        return null;
      }
    }

    function draftOf(plan: LoopPlanViewV1, work: Amount): LoopDraft {
      const i = plan.inputs;
      return { base: plan.loopVersion, plan: plan.planId, text: {
        goal: i.goal, successCondition: i.successCondition, targetPaths: i.targetPaths.join("\n"), checks: i.checks.join("\n"),
        nonGoals: i.nonGoals.join("\n"), relevantDocs: i.relevantDocs.join("\n"), protectedPaths: i.protectedPaths.join("\n"),
        maxFilesTouched: i.maxFilesTouched === null ? "" : String(i.maxFilesTouched),
        tokens: String(work.tokens), activeMs: String(work.activeMs), attempts: String(work.attempts),
      } };
    }

    const lines = (text: string): string[] => text.split("\n").map((line) => line.trim()).filter((line) => line !== "");
    const positive = (text: string): number | null => {
      const value = Number(text.trim());
      return text.trim() !== "" && Number.isSafeInteger(value) && value > 0 ? value : null;
    };

    /** The payload a draft sends, or null while a number is not a positive safe integer (the server re-checks everything). */
    function payloadOf(draft: LoopDraft): SetTaskLoopPayloadV1 | null {
      const tokens = positive(draft.text.tokens), activeMs = positive(draft.text.activeMs), attempts = positive(draft.text.attempts);
      const cap = draft.text.maxFilesTouched.trim() === "" ? null : positive(draft.text.maxFilesTouched);
      if (tokens === null || activeMs === null || attempts === null || (draft.text.maxFilesTouched.trim() !== "" && cap === null)) return null;
      return {
        baseLoopVersion: draft.base, plan: draft.plan,
        inputs: {
          goal: draft.text.goal.trim(), successCondition: draft.text.successCondition.trim(), targetPaths: lines(draft.text.targetPaths),
          checks: lines(draft.text.checks), nonGoals: lines(draft.text.nonGoals), relevantDocs: lines(draft.text.relevantDocs),
          protectedPaths: lines(draft.text.protectedPaths), maxFilesTouched: cap,
        },
        work: { tokens, activeMs, attempts },
      };
    }

    /** Spec §4.2: what the submit does to the group's reserve, and the shortfall that disables it (display only). */
    export function consequenceOf(view: GroupViewV1, current: Amount, work: { tokens: number; activeMs: number; attempts: number }): { text: string; shortfall: string | null } {
      const reserve = view.ledger.explicitUnallocatedReserve;
      const parts: string[] = [];
      let shortfall: string | null = null;
      for (const [dimension, unit] of [["tokens", "token"], ["activeMs", "ms 活跃时间"], ["attempts", "次尝试"]] as const) {
        const delta = work[dimension] - current[dimension];
        if (delta === 0) continue;
        parts.push(`预算 ${delta > 0 ? "+" : ""}${delta} ${unit}，${delta > 0 ? "从组余量扣" : "退回组余量"}；余量剩 ${reserve[dimension] - delta}`);
        if (delta > reserve[dimension] && shortfall === null) shortfall = `组余量不够：${dimension} 还差 ${delta - reserve[dimension]}`;
      }
      return { text: parts.length === 0 ? "预算不变" : parts.join("；"), shortfall };
    }

    export interface LoopPlanCardProps {
      view: GroupViewV1;
      item: WorkItemViewV1;
      drafts: Record<string, string>;
      onDraft: (key: string, text: string) => void;
      onCommand: (action: ControlAction) => void;
    }

    function LoopPlanEditor(props: LoopPlanCardProps & { plan: LoopPlanViewV1; current: Amount }): JSX.Element {
      const { view, item, drafts, onDraft, onCommand, plan, current } = props;
      const groupId = view.summary.groupId, key = loopDraftKey(groupId, item.taskId), draft = readLoopDraft(drafts, key);
      // Spec §4.2 (D4): only a task that has not started may change; a finished run counts (spec §5.2 step 2).
      const started = (item.status !== "draft" && item.status !== "ready") || item.lineageRunIds.length > 0;
      if (started) return <p>已开始，做法已冻结</p>;
      if (draft === null) return <button type="button" onClick={() => onDraft(key, JSON.stringify(draftOf(plan, current)))}>修改做法</button>;
      const set = (patch: Partial<LoopDraft>): void => onDraft(key, JSON.stringify({ ...draft, ...patch }));
      const payload = payloadOf(draft);
      const consequence = payload === null ? null : consequenceOf(view, current, payload.work);
      const blocked = payload === null ? "预算要填正整数" : consequence!.shortfall;
      return (
        <form aria-label={`修改做法 ${item.taskId}`} onSubmit={(event) => {
          event.preventDefault();
          if (payload !== null && blocked === null) onCommand({ verb: "set-task-loop", groupId, taskId: item.taskId, expectedRevision: view.summary.commandRevision, payload });
        }}>
          {draft.base !== plan.loopVersion && <p role="status">做法在你起草之后变了（v{draft.base} → v{plan.loopVersion}）</p>}
          <label>
            方案
            <select aria-label="方案" value={draft.plan} onChange={(event) => set({ plan: event.target.value as LoopPlanIdV1 })}>
              {WEB_LOOP_PLANS.map((option) => <option key={option.planId} value={option.planId}>{option.name}</option>)}
            </select>
          </label>
          {FIELDS.map((field) => (
            <label key={field}>
              {FIELD_LABEL[field]}
              {LIST_FIELDS.has(field)
                ? <textarea aria-label={FIELD_LABEL[field]} value={draft.text[field]} onChange={(event) => set({ text: { ...draft.text, [field]: event.target.value } })} />
                : <input aria-label={FIELD_LABEL[field]} value={draft.text[field]} onChange={(event) => set({ text: { ...draft.text, [field]: event.target.value } })} />}
            </label>
          ))}
          {blocked !== null && <p role="alert">{blocked}</p>}
          <button type="submit" disabled={blocked !== null}>{consequence?.text ?? "预算要填正整数"}</button>
          <button type="button" onClick={() => onDraft(key, "")}>放弃草稿</button>
        </form>
      );
    }

    export function LoopPlanCard(props: LoopPlanCardProps): JSX.Element | null {
      const { view, item } = props;
      // A view that says nothing about the plan (an older server, a literal fixture) gets no card rather than a wrong one.
      if (item.loopPlan === undefined) return null;
      if (item.loopPlan === null) {
        return (
          <section aria-label={`做法 ${item.taskId}`}>
            <h5>手写契约</h5>
            {item.objective !== undefined && (
              <ul>
                <li>目标：{item.objective.goal}</li>
                <li>完成条件：{item.objective.successCondition}</li>
              </ul>
            )}
          </section>
        );
      }
      const plan = item.loopPlan;
      const work = view.allocations.find((row) => row.ownerKind === "task" && row.ownerId === item.taskId && row.bucket === "work");
      return (
        <section aria-label={`做法 ${item.taskId}`}>
          <h5>{loopPlanTitle(plan)}</h5>
          <ul aria-label={`做法摘要 ${item.taskId}`}>
            {plan.summary.map((line, index) => <li key={index}>{line}</li>)}
          </ul>
          <details>
            <summary>检查命令（{plan.inputs.checks.length} 条）</summary>
            <ul>{plan.inputs.checks.map((check, index) => <li key={index}><code>{check}</code></li>)}</ul>
          </details>
          {work !== undefined && <p>预算：{work.amount.tokens} token · 活跃时间 {work.amount.activeMs} ms · 最多尝试次数 {work.amount.attempts}</p>}
          <p>git 工作区：独立 worktree，合回 <code>orca/{view.summary.groupId}</code> 分支，push 由人做</p>
          <p>skill 集：暂不支持</p>
          {work !== undefined && <LoopPlanEditor {...props} plan={plan} current={work.amount} />}
        </section>
      );
    }
    ```
    (A6's read-only half is unchanged; the "已开始" line is not `role="status"` so the draft-version status stays the only one in the card.)
  - `web/src/TaskDetail.tsx`: the A6 line becomes `      <LoopPlanCard view={view} item={item} drafts={drafts} onDraft={onDraft} onCommand={onCommand} />`.
  - `web/src/App.tsx`: add `import { loopDraftKey } from "./LoopPlanCard.js";` after line 79; after line 290 add
    ```ts
        // Loop plans spec §4.2: a loop draft is the person's own data, cleared only once set-task-loop succeeded.
        if (answer.status < 400 && action.verb === "set-task-loop") dispatchControl({ type: "draft", key: loopDraftKey(action.groupId, action.taskId), text: "" });
    ```

- [ ] **Step 4: Run, expect PASS**

```bash
(cd web && ../node_modules/.bin/vitest run tests/loopPlanEdit.test.tsx tests/loopPlanDraft.test.tsx tests/loopPlanCard.test.tsx tests/taskLabels.test.tsx tests/taskLabelsDraft.test.tsx tests/taskLabelsDraftBase.test.tsx tests/controlCommandRecovery.test.tsx) > "$SCRATCH/b6-green.txt" 2>&1; echo rc=$?
(cd web && ../node_modules/.bin/tsc --noEmit -p tsconfig.json) > "$SCRATCH/b6-web-tsc.txt" 2>&1; echo rc=$?
npm run typecheck > "$SCRATCH/b6-tsc.txt" 2>&1; echo rc=$?
```
Expected all `rc=0` (`controlCommandRecovery.test.tsx` has one registered load flake: rerun alone if it is the only red).

- [ ] **Step 5: Mutations** (`$SCRATCH/mut-b6`; files: the four modified web sources and two new tests; criterion: `(cd "$M/web" && ../node_modules/.bin/vitest run tests/loopPlanEdit.test.tsx tests/loopPlanDraft.test.tsx)`)
  - MB6-1 base from the latest poll: `const payload = payloadOf(draft);` → `const payload = payloadOf({ ...draft, base: plan.loopVersion });`. Red: `… > sends the plan, the inputs and the work budget with the loopVersion the draft started from`.
  - MB6-2 shortfall ignored: `disabled={blocked !== null}` → `disabled={false}` and the `onSubmit` guard `&& blocked === null` removed. Red: `… > disables the submit and names the shortfall …`.
  - MB6-3 started task editable: `const started = …` → `const started = false;`. Red: `… > freezes a task that has started …`.
  - MB6-4 route missing: delete the `case "set-task-loop":` in `controlCommandPath`. Red: `… > sends set-task-loop to the task's loop route` and the App criterion (the POST never reaches the stub).
  - MB6-5 draft never cleared: delete the App line. Red: `the loop draft survives a refusal and is cleared by a success …`.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add web/src/controlApi.ts web/src/LoopPlanCard.tsx web/src/TaskDetail.tsx web/src/App.tsx web/tests/loopPlanEdit.test.tsx web/tests/loopPlanDraft.test.tsx
/usr/bin/git commit -F - <<'EOF'
feat(web): change a loop task's plan, inputs and budget on its card

Until the task starts, the card's form edits the plan, its inputs and the
work budget as a draft that remembers the loopVersion it started from. The
submit states its effect on the group's reserve and is disabled, naming the
shortfall, when the reserve cannot cover a raise. A started task shows its
plan frozen; the draft is cleared only when the command succeeded.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GCbsgLfqFPgpeG3gTbBkbh
EOF
```

---

### Task B7: A confirmed change against the real ccloop build (criterion 10, E2E)

**Files:**
- Modify: `tests/control/fixtures/ccloopWorld.ts:57` (`Task`), `:115` (task loop) — additive
- Create: `tests/control/loopPlanE2E.test.ts`

**Interfaces:**
- Consumes: `ccloopWorlds`, `startGroup` (its `beforeStart` hook), `raw`, `realBinary`, `until`, `noBlocked`, `workRuns` (`tests/control/fixtures/ccloopWorld.ts`); `WebControlService.setTaskLoop` through `runtime.service`.
- Produces: `Task` gains `loop?: Record<string, unknown>` (written in place of a contract file).

- [ ] **Step 1: Write the criterion** — fixture: add `loop?: Record<string, unknown>` to `Task` (line 57, with the comment `// Loop plans spec §3.1: a task that names a loop plan instead of a contract file.`); at the top of the `for (const task of tasks) {` body (line 115) insert

```ts
      if (task.loop !== undefined) {
        // Loop plans spec §3.1: the plan file names a loop plan; import expands it (planFile.ts).
        planTasks.push({ taskId: task.taskId, loop: task.loop, dependsOn: task.dependsOn ?? [], targetVersion: 1, ...(task.agent === undefined ? {} : { agent: task.agent }) });
        continue;
      }
```

Then `tests/control/loopPlanE2E.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { canonicalBytes } from "../../src/control/canonicalJson.js";
import { readBudgetProposal } from "../../src/control/queries.js";
import { readCanonicalRecord } from "../../src/control/snapshot.js";
import type { ControlRuntime } from "../../src/panel/controlAssembly.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { ccloopWorlds, noBlocked, raw, realBinary, startGroup, until, workRuns } from "./fixtures/ccloopWorld.js";

/**
 * Loop plans spec §6 criterion 10 against the real ccloop build (ORCA_CCLOOP_BIN) and its scripted fake codex: a loop
 * task changed after confirmation passes A2, ccloop receives the newly expanded contract and the run settles and lands,
 * while the other task's snapshot entries and everything else in the snapshot stay byte-identical.
 */
const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-loop-e2e-", epochPrefix: "epoch-loop-e2e-" });
afterAll(removeRoots);
const workStatus = (runtime: ControlRuntime, taskId: string): string =>
  JSON.parse(String(runtime.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body)).status;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const snapshotOf = (runtime: ControlRuntime): any => JSON.parse(readCanonicalRecord(runtime.store, readBudgetProposal(runtime.store, "g").executionSnapshotHash!));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const without = (snapshot: any, taskId: string) => ({
  ...snapshot,
  derivedContracts: snapshot.derivedContracts.filter((entry: { taskId: string }) => entry.taskId !== taskId),
  allocations: snapshot.allocations.filter((row: { ownerKind: string; ownerId: string }) => !(row.ownerKind === "task" && row.ownerId === taskId)),
});
const loopFor = (goal: string, path: string) => ({ plan: "standard", goal, successCondition: `${path} holds the scripted text`, targetPaths: [path], checks: ["true"] });

describe("a loop task changed after confirmation, against real ccloop (spec §6 criterion 10)", { timeout: 420_000 }, () => {
  relocateHome("orca-loop-e2e-home-");
  // Gated at run time, never with describe.skipIf (tests/setup/scopeTmpdir.ts ERRATUM 2026-09-29).
  beforeEach((ctx) => { if (!realBinary) ctx.skip(); });

  it("runs the newly expanded contract to settle, and leaves the rest of the snapshot byte-identical", async () => {
    const w = await world([
      { taskId: "a", targetPaths: ["shared.txt"], loop: loopFor("write shared.txt", "shared.txt") },
      { taskId: "b", targetPaths: ["b.txt"], loop: loopFor("write b.txt", "b.txt") },
    ], { a: { files: { "shared.txt": "A\n" } }, b: { files: { "b.txt": "B\n" } } });
    const runtime = await w.boot();
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let before: any = null;
      await startGroup(runtime, w.repoId, 0, async () => {
        before = snapshotOf(runtime);
        const plan = readControlGroup(runtime.store, runtime.epoch, "g").workItems.find((entry) => entry.taskId === "a")!.loopPlan!;
        const work = readBudgetProposal(runtime.store, "g").allocations.find((row) => row.ownerKind === "task" && row.ownerId === "a" && row.bucket === "work")!.amount;
        const changed = runtime.service.setTaskLoop(raw(runtime, "loop-a", "set-task-loop", {
          baseLoopVersion: plan.loopVersion, plan: "standard", inputs: { ...plan.inputs, goal: "write shared.txt, changed after confirmation" },
          work: { tokens: work.tokens, activeMs: work.activeMs, attempts: work.attempts },
        }, { kind: "task", groupId: "g", taskId: "a" }));
        expect(changed).toMatchObject({ result: { kind: "task-loop-set", taskId: "a", loopVersion: 1 } });
      });
      runtime.startPump(50);
      await until(() => { noBlocked(runtime); return ["a", "b"].every((id) => workStatus(runtime, id) === "done") && workRuns(runtime).every((run) => run.body.drive?.cleanedUp === true); }, 360_000, "both tasks to settle");
      const runA = workRuns(runtime).find((run) => run.task === "a")!;
      const envelope = JSON.parse(readCanonicalRecord(runtime.store, runA.body.drive.envelopeHash));
      expect(envelope.work.contract.objective.goal).toBe("write shared.txt, changed after confirmation");
      expect(w.show("shared.txt")).toBe("A");
      expect(w.show("b.txt")).toBe("B");
      const after = snapshotOf(runtime);
      expect(after.proposalVersion).toBe(before.proposalVersion);
      expect(canonicalBytes(without(after, "a")).equals(canonicalBytes(without(before, "a")))).toBe(true);
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });
});
```

- [ ] **Step 2: Run** (the real ccloop build is needed; without `ORCA_CCLOOP_BIN` the criterion is skipped at run time)

```bash
./node_modules/.bin/vitest run tests/control/loopPlanE2E.test.ts > "$SCRATCH/b7-skip.txt" 2>&1; echo rc=$?
ORCA_CCLOOP_BIN=<the controller's built ccloop clone>/dist/cli.js ./node_modules/.bin/vitest run tests/control/loopPlanE2E.test.ts > "$SCRATCH/b7-e2e.txt" 2>&1; echo rc=$?
npm run typecheck > "$SCRATCH/b7-tsc.txt" 2>&1; echo rc=$?
```
Expected: first run `rc=0` with 1 skipped; second `rc=0` with 1 passed; typecheck `rc=0`. This criterion has no red-first step of its own: Tasks B1-B3 already built what it measures. Its red is seen through MB7-1.

- [ ] **Step 3: Mutations** (`$SCRATCH/mut-b7`; files `tests/control/fixtures/ccloopWorld.ts tests/control/loopPlanE2E.test.ts`; criterion run with `ORCA_CCLOOP_BIN` set; the clone given to `ORCA_CCLOOP_BIN` must not be one used for mutations)
  - MB7-1 bypass `effectivePlanTask` in A2 (as MB1-1, in `src/control/executionSnapshot.ts` of this clone). Red: `… > runs the newly expanded contract to settle …` (the change itself is refused by the self-check).
  - MB7-2 rebuild instead of copy (as MB3-1) together with a budget raise in the criterion's `work.tokens` (`work.tokens + 500_000`). Red: the byte-identity assertion.

- [ ] **Step 4: Commit**

```bash
/usr/bin/git add tests/control/fixtures/ccloopWorld.ts tests/control/loopPlanE2E.test.ts
/usr/bin/git commit -F - <<'EOF'
test(control): run a loop task changed after confirmation through real ccloop

With the real ccloop build and its scripted fake codex, a loop task changed
after confirmation starts with the newly expanded contract, settles and
lands, and the snapshot outside that task stays byte-identical.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GCbsgLfqFPgpeG3gTbBkbh
EOF
```

---

### Task B8 (controller): Part B gate

**Files:** none changed.

- [ ] **Step 1: Criteria of Parts A and B, in the main tree**

```bash
./node_modules/.bin/vitest run tests/control/loopPlans.test.ts tests/control/loopPlanSummary.test.ts tests/scheduler/planFileLoop.test.ts tests/scheduler/loopPlanCli.test.ts tests/control/loopPlanImport.test.ts tests/control/loopPlanView.test.ts tests/control/loopPlanDrift.test.ts tests/control/taskAmendments.test.ts tests/control/setTaskLoop.test.ts tests/control/setTaskLoopConfirmed.test.ts tests/control/loopBudgetOwner.test.ts tests/panel/taskLoopApi.test.ts > "$SCRATCH/b8-criteria.txt" 2>&1; echo rc=$?
(cd web && ../node_modules/.bin/vitest run tests/loopPlanCard.test.tsx tests/loopBudgetRows.test.tsx tests/loopPlanEdit.test.tsx tests/loopPlanDraft.test.tsx) > "$SCRATCH/b8-web.txt" 2>&1; echo rc=$?
npm run typecheck > "$SCRATCH/b8-tsc.txt" 2>&1; echo rc=$?
(cd web && ../node_modules/.bin/tsc --noEmit -p tsconfig.json) > "$SCRATCH/b8-web-tsc.txt" 2>&1; echo rc=$?
```
All `rc=0`.

- [ ] **Step 2: Full suite in a fresh clone** (as A7 Step 2), with `ORCA_CCLOOP_BIN` set so `tests/control/loopPlanE2E.test.ts` runs. Pass: `rc=0`, zero pending, failures only registered load flakes (single-file rerun green, `uptime` recorded), web `npm run check` and `npm run verify:panel` `rc=0`, `~/.orca` stat unchanged. Any other red existing criterion ⇒ stop and report it by name.
- [ ] **Step 3: Rerun the whole mutation table** (MA1-1 … MB7-2) on a clone of the gate commit, one row each: `mutation | file | predicted red | actual red (full name) | restore cmp rc`. A mismatch is recorded as measured, never "fixed" in the prediction.
- [ ] **Step 4:** list every `$SCRATCH/mut-*` and gate clone path for the human (deletion needs the human).

---

## Self-Review

1. **Spec coverage.**
   - §0 / §0.1 (not in v1): CLI refusal A3; the fixed git and skill lines A6; no user plans, no other loop shape (A1's registry has only the five).
   - §2.1-§2.3 (what is enforced, the five plans, shared defaults): A1 (expansion, criteria 1-2), A2 (strength wording).
   - §2.4 (labels): A1 (criterion 5); the label shown on the card A5.
   - §3.1 (`loop` form): A3. §3.2 (expansion, refusals): A1, and the import refusal A3. §3.3 (import, recipe under `planHash`, projection check): A3, A4, A5. §3.4 (CLI): A3.
   - §4.1 (display): A2, A5, A6. §4.2 (change form): B5 route, B6 form. §4.3 (budget owner): B4.
   - §5.1 (amendments, `effectivePlanTask`, every reader): B1 and the reader table in the Drafter findings. §5.2 steps 1-8: B2 (refusals, draft path, self-check), B3 (budget move and snapshot copy after confirmation).
   - §6 criteria: 1, 2, 3, 5 → A1; 4 → A3; 6 → A3, A4, A5; 7 → A2; 8 → B2 (+ `budget-owned-by-loop-plan` B4); 9 → B2 (draft), B3 (confirmed); 10 → B3 (synthetic), B7 (real ccloop); 11 → B3; 12 → B2 (claim first), B3 (both orders); 13 → B1.
   - §6 mutations: drop `protectedPaths` MA1-1; drop soft constraints MA1-2; hard-code `maxFilesTouched` MA1-3; swap priorities 3 and 4 MA1-4; accept `*.ts` MA1-5; count only active runs MB2-1; drop the reserve check MB2-2; update `reserved` but not the reserve row MB3-3 (draft analogue MB2-8); full rebuild instead of copy MB3-1, MB7-2; bump `proposalVersion` MB3-2; skip the self-check MB2-3; bypass `effectivePlanTask` in A2 MB1-1, MB3-6, MB7-1; command text in the summary MA2-1.
   - §7 (existing criteria unchanged): Global Constraints, and each Task's Step 4 reruns the existing files it touches. §8 (registered): nothing built. §9 (re-checks): the reader list (F7 table), the revision check (B2 `refuses a stale command revision …`).
2. **Every new branch has a named deletion mutation seen red:** A1 (MA1-1…8), A2 (MA2-1…4), A3 (MA3-1…6), A4 (MA4-1…2), A5 (MA5-1…3), A6 (MA6-1…4), B1 (MB1-1…12), B2 (MB2-1…9), B3 (MB3-1…6), B4 (MB4-1…3), B5 (MB5-1…3), B6 (MB6-1…5), B7 (MB7-1…2). Two guards have no red of their own and are left as defence, named here: `loopVersion === Number.MAX_SAFE_INTEGER` (B2, as in `setTaskLabels`) and the `recovery-blocked` throws in `replaceTaskInSnapshot` for an entry the schema already guarantees (B3).
3. **"An assertion placed before the tested call that reads back what the test itself just wrote"** — scanned. B1's `effectivePlanTask(…, null)` criteria read the function's answer, not a written value; B2's `expectUntouched` runs after the refused call; B3 reads `before` from the store before the change and compares after it.
4. **Placeholders left to the executor, each a measurement, not a decision:** the `Sandbox` type name (A3), the `planTasks` element type in `tests/control/fixtures/web.ts` (A4), the copy ranges of `web/tests/budgetHandoffCapability.test.tsx` (B4) and `web/tests/taskLabelsDraft.test.tsx` / `web/tests/loopPlanCard.test.tsx` (B6), the declared return type of `view()` in `tests/panel/fixtures/controlPanel.ts` (B5), and the controller's `ORCA_CCLOOP_BIN` path (B7). No step says "handle errors appropriately" or leaves code unwritten.
5. **Type consistency across Tasks:** `expandRecipe(taskId, repoPath, recipe)`, `expandLoopPlan(taskId, repoPath, planId, inputs, chosenBy?)`, `expandLoopTask(taskId, repoPath, input, labels)`, `describeLoopPlan(recipe)`, `choosePlanByLabels(labels)`, `loopPlanDefinition(planId, version)`, `currentLoopPlanVersion(planId)` (A1/A2) are used with those shapes in A3, A5, B1, B2, B5. `writeTaskAmendment(store, groupId, amendment)`, `workBodyOf(store, groupId, taskId)`, `effectivePlanTask(store, groupId, archived, work)` (B1) are used with those shapes in B1-B3. `deriveContract` is exported in B2 and used in B2; `replaceTaskInSnapshot` is added in B3 and used only there. The view field names `loopPlan` / `objective` and `LoopPlanViewV1` fields match between `webProtocol.ts` (A5), `web/src/controlTypes.ts` (A5) and the card (A6, B6); the payload `{ baseLoopVersion, plan, inputs, work }` matches between `webProtocol.ts`, `controlTypes.ts` (B2), the fixture's `change` (B2) and the form (B6).
6. **Predictions not verified by the drafter** — each is "unmeasured, stop if wrong":
   - U1 Every plan's expansion is a fixed point of `taskContractSchema.parse` (A1 measures it first; a red there stops the plan).
   - U2 `vi.mock("../../src/control/loopPlans.js")` with a spread of the real module replaces `expandRecipe` for `controlViews.ts`'s import, while `planFile.ts`'s `expandLoopTask` keeps calling the real one internally (A5).
   - U3 The new import edges (`planFile.ts` → `loopPlans.ts`; `webProtocol.ts` → `loopPlans.ts`; `queries.ts`/`executionSnapshot.ts`/`webService.ts`/`controlViews.ts` → `taskAmendments.ts` → `snapshot.ts`, `planFile.ts`) close no runtime ESM cycle.
   - U4 The zod refinement's issue renders as `tasks.0: exactly-one-of-contract-or-loop` through `loadPlan`'s `path.join(".")` (A3).
   - U5 The new view fields and the routed readers turn no existing criterion red (spec §7); the grep above found no exact `toEqual` on a whole work item view.
   - U6 Between B2 and B3, every confirmed change is rolled back by the self-check (B3's expected red depends on it).
   - U7 A refused command leaves the `groups` and `budget_proposals` bodies byte-identical (B2 self-check criterion; `applyWebCommand` persists only the outcome row).
   - U8 The R2 case with a re-amounted held/continuing/terminal allocation is not exercised (F12); the copy covers it by construction, the criterion does not.
   - U9 In `driverHarness`, the first claim takes task `a` (`nextClaimableTask` orders by id) and a synthetic loop run reaches `accepted` and then `settled` within the default 60 driver rounds.
   - U10 "A finished run returns a task to `ready`" (spec §5.2 step 2) — read, not measured (F16).
   - U11 The real ccloop accepts the expanded contracts (`rejectOn: ["REJECT:unused"]`, `perAttemptTimeoutMs` clamped by `deriveContract`), and the fake codex script is keyed by task id for loop tasks (B7).
   - U12 Rewriting the panel harness's plan file before boot passes the trusted-config descriptor check (B5).
   - U13 `claimEstimate` on a fresh `webFixture` returns a run (as in `tests/control/agentPlanImport.test.ts:136`), so the `estimate-in-flight` criterion has a running estimate (B2).
   - U14 jsdom renders `<details>` closed by default, and a `<button>`'s accessible name is exactly the consequence text (A6, B6).
