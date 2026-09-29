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
- **Scratch:** `SCRATCH=/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/1d7d9aa0-4a2b-478b-b0ec-d970d3a51afe/scratchpad`; `REPO=/Users/biran/code/skills/loop/Orca`. Before running criteria: `export TMPDIR=$(mktemp -d /private/tmp/cl-XXXX) (do not set ECC_GATEGUARD / DISABLE_OMC: the harness refuses them; controller ruling)`.
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

