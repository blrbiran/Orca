# Consolidation Step 3 (retire `orca run --adapter-config`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete Orca's legacy `orca run` path (CLI, `runRound`, the `--adapter` form of `runTask`) while every criterion that ran the round engine end to end keeps doing so, through `ccloop run --agents` and a frames-mode fake codex.

**Architecture:** ccloop's `tests/fixtures/fake-codex.mjs` gains a stateless `frames` mode that plays ScriptedAdapter's per-attempt frames. Orca's test sandbox gains `runRoundForTest`, the old `runRound` body with an `--agents` executor; the sandbox's `runCli(["run", …])` routes to it, so most criteria keep their call sites byte-for-byte.

**Tech Stack:** TypeScript, vitest, git; Node child processes.

**Spec:** Orca `docs/superpowers/specs/2026-10-01-retire-legacy-orca-run-design.md`.

## Global Constraints

- English code/comments/commits; trailer `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. No push. `/usr/bin/git`, `/bin/rm`, `cat a > b`.
- Criteria: migrate, do not weaken. A migrated criterion may change only how it starts the round (and its frames file path); never what it asserts. Deleting a criterion is allowed only for those whose whole subject is the deleted CLI surface (unknown `--adapter`, missing `--adapter-config`, the `scripted` default) — list each deleted name in the report.
- Published comments keep their words; ERRATUM form `*** ERRATUM (consolidation step 3, 2026-10-01, Orca session be653b22, controller ruling C-n) -- … ***` at the end of the block.
- Orca tests reach ccloop through the checkout `ORCA_CCLOOP_BIN` / the sandbox's `ccloopBin` points at — the fixture path is `<that checkout>/tests/fixtures/fake-codex.mjs`. The pinned `node_modules/ccloop` is not used by these tests.
- Verification output to files, read whole. Known Orca load flakes: driverLanding, driverRecovery, controlShutdown, driverProgress R2, handoffE2E, ccloopPort (judge by single-file 3/3).

## Review Focus

1. A migrated multi-attempt criterion (e.g. harvest's two-frame one) must still see frame 2 on attempt 2.
2. A round whose task runs out of frames must still fail the way "no scripted frame remaining" did (ccloop run fails, Orca reports the task failed), not hang.
3. `runCli(["plan", …])` and every non-`run` command still reach `main` unchanged.
4. Orca's control path (`src/control/service.ts`, `schedulerBridge.ts`) is untouched in behaviour — its tests stay green.
5. README no longer documents a command that does not exist.

---

### Task 1: fake codex `frames` mode (ccloop repo, /Users/biran/code/skills/loop/ccloop)

**Files:** Modify `tests/fixtures/fake-codex.mjs`; Test: new `tests/runtime/codex/fakeCodexFrames.test.ts`.

- [ ] **Step 1: criteria (red first)** — drive `CodexAdapter` (as `tests/runtime/codex/*.test.ts` do with `codexFixture`) with `config.command = [node, fake-codex.mjs, "frames", marker, framesPath]` and a context whose `worktreePath` ends in `worktrees/attempt-<n>` (create that directory inside the fixture repo's parent and `git init`/copy as the other codex fixtures need — or set `context.worktreePath` to a directory named `attempt-2` that is a git worktree of the fixture repo; pick the cheapest that the existing fixture supports and say which):
  - "plays frame n on attempt n": frames `{ "codex-test": [ {changedFiles:["a.txt"], approved:true}, {changedFiles:["b.txt"], approved:false, safeToRetry:true, stopSignals:["s"]} ] }`; attempt 2's execute answers `changedFiles: ["b.txt"]`, verify answers `approved:false, safeToRetry:true, stopSignals:["s"]`.
  - "falls back to the * list": frames `{ "*": [ {} ] }`; attempt 1 execute `changedFiles: []`, verify `approved: true`.
  - "refuses an attempt with no frame": frames `{ "codex-test": [ {} ] }`, attempt 2 → the phase throws (codex exit 3) and the marker's stderr names `no frame for codex-test attempt 2`.
- [ ] **Step 2: implement** the mode exactly per the spec §3.4: task from the prompt with `script` mode's regexes (the plan prompt names the task too); frames file `process.argv[4]`; attempt from `/attempt-(\d+)$/` on `process.cwd()`; missing frame → `process.stderr.write(...)`, `process.exitCode = 3`, no answer. The answer bodies: plan `{summary:"frames", primaryTargetPaths:[]}`; execute `{changedFiles: frame.changedFiles ?? [], diffPatch:"", commandOutputs:[], stdoutStderrLog:""}` (wrapped as the existing code wraps execute answers); verify `{approved: frame.approved ?? true, rejectCategory:"", primaryTargetPaths:[], failingCommand:null, safeToRetry: frame.safeToRetry ?? false, evidence:[], pauseSignals:[], stopSignals: frame.stopSignals ?? []}`. Other modes byte-identical in behaviour; add a comment line describing `frames` after the existing header comments (do not edit existing comment lines).
- [ ] **Step 3: green**, typecheck RC 0, commit `test(fixtures): fake codex plays scripted frames per attempt, for callers leaving --adapter scripted`.

### Task 2: retire the legacy path, migrate the criteria (Orca repo)

**Files:**
- Modify: `src/cli.ts` (remove `run` command, `runRun`, its USAGE line), `src/scheduler/run.ts` (remove `runRound`, `RunOptions.adapter`/`adapterConfig`, the `"legacy"` mode value), `src/scheduler/ccloopRunner.ts` (remove `AdapterRunTaskOptions` and the `--adapter` branch; `runTask` options become the agents form only), `README.md`.
- Modify: `tests/scheduler/sandbox.ts` (`runRoundForTest`, `runCli` routing, `writeScriptedConfig` writes a frames file, agents table + selection helper), the legacy test files that call `runRound(`/`runTask(` directly.

- [ ] **Step 1: inventory** — re-count the legacy-dependent criteria (method of spec §2) into the report: file, criterion name, how it starts the round (`runCli(["run"…])` / `runRound(` / `runTask(` / `spawnOne`). Identify the ones whose whole subject is the deleted CLI surface.
- [ ] **Step 2: harness.** In `sandbox.ts`:
  - `agentsFor(s, framesPath)`: writes `<s.runsDir>/agents.json` with one codex installation `{ kind:"codex", command:[process.execPath, <ccloop checkout>/tests/fixtures/fake-codex.mjs, "frames", <marker>, framesPath], version: <versionOf(command)>, … }` (copy the installation shape and the version probe from `tests/control/fixtures/ccloopWorld.ts`), and returns `{ agentsTable, agentSelection: { selection, configHash } }` with the configHash ccloop answers for that selection (the way `ccloopWorld.ts` obtains it — reuse its function if exported, else call the same ccloop command it calls).
  - `runRoundForTest(planPath, options: { framesPath: string; verbose?: boolean; keepWorkdirs?: boolean; serial?: boolean; log?; logError? })`: the old `runRound` body (load + rejection printing + `runPreparedRound`) with an execution whose `execute` allocates the run id as before and calls `runTask(plan, task, base, runId, agentsFor(...))`; `mode: "controlled"` is NOT used — keep the remaining legacy-shaped no-op preflight/reconcileBudget/land exactly as `runRound` had them (if `RoundExecution.mode` loses `"legacy"`, give the test execution whichever value keeps `runPreparedRound`'s legacy-equivalent branches; if no such value exists after the deletion, keep `"legacy"` in the union and record the ruling).
  - `runCli(argv)`: if `argv[0] === "run"`, parse `[planPath, --adapter-config <framesPath>, --verbose, --keep-workdirs, --serial]` the way `runRun` did (unknown `--adapter` values → return 1 with the old message, so call sites that never passed one are unaffected) and call `runRoundForTest`; everything else → `main(argv)`. Comment that `orca run` no longer exists and this routing keeps the round criteria's call sites as they were.
  - `writeScriptedConfig(s, name, frames)` writes `{ "*": frames-as-given }` (the frame spec fields map 1:1) and returns its path; keep the name and signature.
- [ ] **Step 3: delete the legacy source** (Files above). Fix compile errors only where the deletion causes them. Append ERRATA to published comments that describe the deleted path as live (e.g. `ccloopRunner.ts` header of `AdapterRunTaskOptions` goes away with the type — comments elsewhere naming `orca run` as current).
- [ ] **Step 4: migrate direct callers**: `runRound(` → `runRoundForTest(` with the frames path; `runTask(… {adapter, adapterConfig})` / `spawnOne` → the agents form via `agentsFor`. Delete only the criteria found in Step 1 whose whole subject is the removed surface.
- [ ] **Step 5: README**: remove the `orca run` usage line, the "missing --adapter-config" exit reason and the `orca run` paragraphs; add one sentence: rounds run through the panel (`orca panel`) and the control path; `orca plan` previews a round.
- [ ] **Step 6: green**: `npm run typecheck`; `./node_modules/.bin/vitest run tests/scheduler > s.txt 2>&1` (with `ORCA_CCLOOP_BIN` pointing at a freshly built ccloop clone that contains Task 1's commit — build it in the scratchpad: `git clone --local`, symlink node_modules, `npm run build`); then `tests/control tests/panel` once. Commit `refactor(scheduler): retire orca run --adapter-config; the round criteria run through ccloop --agents`.

### Task 3: mutations

- [ ] L1–L3 (spec §5) in clones (ccloop clone for L1, Orca clone for L2/L3); record the red criterion for each; restore with `cat`, prove 0-byte `git diff`/`--cached`.
