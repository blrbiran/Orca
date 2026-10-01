# Consolidation step 3: retire the legacy `orca run <plan> --adapter-config` path — design

Status: decided by the controller under the human's standing instruction; for the human's review after the fact.
Author: Orca controller session `be653b22`, 2026-10-01.
Companions: ccloop `docs/superpowers/specs/2026-10-01-claude-adapter-consolidation-step1-design.md` (step 1),
ccloop `docs/superpowers/specs/2026-10-01-agents-resume-sweep-design.md` (step 2),
ccloop `docs/superpowers/specs/2026-10-01-retire-old-cli-entry-design.md` (step 4).

## 1. Rulings

- The human, 2026-10-01 (session `ceca1c47`): order ① → ② → ③ → ④; for ③ "选方案二：把 Orca 旧的 orca run
  --adapter-config 路径一起退役"; the criteria on that path are "迁走或删".
- The human, 2026-10-01 (this session): "这一轮执行过程中如果有问题，先按你的建议执行（不要再找我）。执行完在最后阶段报给我审核。"
  Decisions marked **C-n** are the controller's under that instruction.

## 2. Today (measured by a read-only survey in this session)

- `orca run <plan> --adapter-config <file> [--adapter scripted|claude]` (`src/cli.ts`, `runRun`) → `runRound`
  (`src/scheduler/run.ts`) → a `RoundExecution` with `mode: "legacy"` whose `execute` calls `runTask(…, { adapter,
  adapterConfig })` → `ccloopRunner.ts` spawns `ccloop run … --adapter <a> --adapter-config <file>`.
- Everything else it uses is shared with the control path: `runPreparedRound` (also called by
  `src/control/service.ts`), `loadRound`, layering, harvest, land, ledger wiring, preflight, repo lock, reconcile.
- 56 criteria in 28 test files depend on it (survey method: per-`it` body match on
  `adapter-config|adapterConfig|runRound\(|runTask\(|writeScriptedConfig`, hand-corrected for `beforeAll` and
  `it.each`). The handoff's "about 76 in 29" was an estimate; re-count before deleting or migrating anything.
  They are the only criteria that run the round engine end to end against a real ccloop with a scripted agent.
- Their agent is ccloop's `ScriptedAdapter`, fed per-attempt frames (`changedFiles`, `approved`, `safeToRetry`,
  `stopSignals`) by `tests/scheduler/sandbox.ts` (`writeScriptedConfig`); the real file changes come from the
  contracts' required checks.

## 3. Design

### 3.1 Deleted (C-1)

- `orca run` from `src/cli.ts` (the command, its usage line, `runRun`), `runRound`, `RunOptions.adapter` and
  `RunOptions.adapterConfig`, `AdapterRunTaskOptions` and the `--adapter` branch of `runTask` in `ccloopRunner.ts`.
- `RoundExecution.mode`'s `"legacy"` value. Code that branches on `mode === "controlled"` keeps working; a branch that
  becomes unreachable is removed only where the compiler or a criterion shows it (no speculative cleanup).
- README lines that document `orca run` (usage, the exit-1 reason "missing --adapter-config"), replaced by a short note
  that rounds run through the panel/control path.
- `orca plan` stays.

### 3.2 The criteria keep their end-to-end shape (C-2)

The 56 criteria are migrated, not deleted, except those that pin only the deleted CLI surface (§3.3):

- `tests/scheduler/sandbox.ts` gains `runRoundForTest(s, planPath, frames)`: it loads the plan the way `runRound` did
  and calls `runPreparedRound` with a test `RoundExecution` whose `execute` calls `runTask` in its existing `--agents`
  form, against an agents table whose one codex installation is ccloop's `tests/fixtures/fake-codex.mjs` in the new
  `frames` mode (ccloop side, §3.4), with the configHash ccloop itself answers for that selection (the way
  `tests/control/fixtures/ccloopWorld.ts` already obtains it). It returns what `runRound` returned (the exit code and
  printed output the criteria assert).
- `writeScriptedConfig` keeps its signature and frame spec and writes the `frames` file instead of a ScriptedAdapter
  config; `seedRunnablePlan`'s `adapterConfig` becomes the frames file path.
- Each migrated criterion changes only how it starts the round (`runCli(["run", plan, "--adapter-config", cfg])` →
  `runRoundForTest(…)`), never what it asserts about the round. Where a criterion asserts CLI stdout that only `orca run`
  printed, the harness reproduces that printing from `runPreparedRound`'s result (the same function `runRun` called).

### 3.3 Deleted criteria (C-3)

Only criteria whose whole subject is the deleted surface: refusing an unknown `--adapter`, refusing a missing
`--adapter-config`, and the `adapter ?? "scripted"` default. The plan lists them by name from a fresh read.

### 3.4 ccloop side: fake codex `frames` mode (C-4)

`tests/fixtures/fake-codex.mjs` gains mode `frames`: argv `frames <marker> <framesFile>`. The frames file is
`{ "<taskId>" | "*": [frame, …] }`, frame = `{ changedFiles?, approved?, safeToRetry?, stopSignals? }`. The task comes
from the prompt (the same regexes `script` mode uses), `"*"` is the fallback list. The frame index is the attempt
number, read from the working directory's last path segment `attempt-<n>` (ccloop's `worktreeManager`), minus one —
stateless, so a fresh ccloop run starts at frame 1 exactly as a fresh `ScriptedAdapter` did. Plan answers a fixed plan;
execute answers `{ changedFiles: frame.changedFiles ?? [], diffPatch: "", commandOutputs: [], stdoutStderrLog: "" }` and
writes nothing; verify answers `approved: frame.approved ?? true`, `safeToRetry: frame.safeToRetry ?? false`,
`stopSignals: frame.stopSignals ?? []`, the rest as `script` mode. No frame for the attempt → stderr
`fake-codex frames: no frame for <task> attempt <n>` and exit 3 (the analogue of "no scripted frame remaining").
Existing modes are unchanged.

## 4. Order and dependency

ccloop's `frames` mode lands first (it is a test fixture; Orca's tests reach it through the ccloop checkout
`ORCA_CCLOOP_BIN`/sibling points at, not through the pinned package). Orca's migration follows. No repin is needed
for this step; the repin after step 4 picks everything up.

## 5. Mutations

| # | Mutation | Expected red |
|---|---|---|
| L1 | `frames` mode ignores the attempt number (always frame 1) | a migrated criterion whose second attempt differs (e.g. the harvest multi-frame one) |
| L2 | `runRoundForTest` drops the agents selection's configHash (passes a wrong one) | every migrated criterion (refused run) — prove with one |
| L3 | revert one migrated criterion's frame to `approved: false` | that criterion |

## 6. Registered

- With `orca run` gone, the only way to run a round is the panel/control path; the `--serial` / `--keep-workdirs` /
  `--verbose` options of `orca run` go with it (control has its own equivalents where it needs them).
