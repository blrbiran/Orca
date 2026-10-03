# Task 6 report — inject at A2, carry `skillPluginDir`, clean up by runId

Author: implementer subagent of session 08b1007d, 2026-10-03. Commit `01b74bc` on Orca `main` (parent `5f2639c`). Not pushed.
Scratch: `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/08b1007d-4dc6-44c3-9772-c05f71d2ae7c/scratchpad/t6/` (all logs cited below are there).

## Environment
- Orca clone: `t6/orca` (`git clone --local`, node_modules + web/node_modules symlinked, `npm run build --workspace web` rc 0, `core.hooksPath scripts/githooks`). Uncommitted files copied in with `cat` (`t6/sync.sh`).
- Every vitest run used `t6/run.sh`: HOME and the four XDG roots under `/private/tmp/oc-Iv6Q`, TMPDIR `/private/tmp/oc-cPLV`, `ORCA_CCLOOP_BIN=t6/ccloop/dist/cli.js`.
- ccloop build: `git clone --local` of the ccloop repo, detached at **`af26a2206cc96039c9fd1757eed1e9fd3e803094`** (af26a22), node_modules symlinked, `npm run build` rc 0 (`t6/ccloop-build.log`). Not the ccloop main working tree.

## Golden capture (before any code change)
At `5f2639c`, a throwaway test in the clone ran `sha256Canonical(toStartEnvelope(ledgerEnvelope(), runRow(), {sourceDir:"/tmp/src",targetRepo:"/tmp/repo",base:"v1"}, {objective:"ship"}))` with exactly the fixtures of `tests/control/startEnvelope.test.ts` → `46bdd07561c78f4999041188f9b98f17d0c476ad6858cf4a6649f349cf2ab0bb` (`t6/golden.txt`, `t6/golden.log`). It is pinned in `startEnvelope.test.ts` and stays green after the change.

## TDD
- RED (`t6/red.log`, rc 1): startEnvelope 1 failed (no skillPluginDir key in output), workspace 1 failed (`skillsPathOf is not a function`), driverSkills 8/8 failed (no directory / no `skills` key / leftover not replaced / no block), skillsE2E failed (`drive.skills` undefined: the run settled without skills). syncskill.test.ts 24/24 green with the fixture change.
- GREEN (`t6/green.log`, `t6/green2.log`, rc 0): 5 files, 58 tests, then driverSkills + syncskill 33/33 after adding the lock-name test.

## Tests added
- `tests/control/driverSkills.test.ts` (new, 9 tests): C5 layout/modes/read-only/lock/argv; C6 skillPluginDir present / absent with no spawn; leftover replaced not reused; C10 `E_SKILL_NOT_FOUND`, unconfigured, lock-name mismatch (`syncskill-output-invalid`); C11 step E removal, restartRun of a run blocked at A2 with `skills: null`; C17 continuation removes the predecessor's snapshot and injects its own.
- `tests/control/startEnvelope.test.ts` (+2): golden hash without skills; field carried and accepted by Orca's strict schema; `""` refused.
- `tests/control/workspace.test.ts` (+2): cleanupRunWorkspace removes a read-only `skills-<runId>` and not another run's; cleaning a run with no snapshot.
- `tests/control/skillsE2E.test.ts` (new): C9 smoke against the real ccloop.

## Mutations (each on its own in the clone, then restored with sync.sh)
Runs: driverSkills + startEnvelope + workspace. Logs `t6/mut/<M>.log`. Baseline `git diff` = 30941 bytes, `git diff --cached` = 0. After **every** restore: diff 30941 bytes, cached 0, `cmp` with the baseline identical.

| # | Mutation | Red (tests failing) |
|---|---|---|
| M1 | skip plugin.json | C5 main test (ENOENT plugin.json) |
| M2 | lock from frozen names | C5 main test (lock deep-equal) |
| M3 | skip chmod (makeReadOnly) | C5 main test (mode & 0o222 = 128) |
| M4 | always set skillPluginDir | run-without-skills test (extra key) |
| M5 | swallow inject error | 4: E_SKILL_NOT_FOUND, lock mismatch, unconfigured, restartRun |
| M6 | cleanup keyed on drive.skills (dropped from cleanupRunWorkspace, done in step E only if `drive.skills`) | 3: workspace read-only removal, restartRun, continuation |
| M7 | Orca schema without the field | 5 incl. startEnvelope schema test (`start-envelope-conflict:built:work`) |
| M8 | no owner-write restore | 4 incl. leftover, step E, continuation, workspace test (EACCES) |
| M9 | no leftover removal at A2 | leftover test |
| M10 | unconditional copy in toStartEnvelope | golden test + driver no-skills test (`control-non-canonical-json`) |
| M11 | skills not written in the final A2 write | 3 (C5, step E, continuation) |
| M12 | lock-name check removed | lock-mismatch test |

## C9 smoke (no mutation) — `t6/green.log`
`skillsE2E.test.ts` passed against ccloop af26a22: loop task with `skills: {names:["alpha"]}`, agent `claude` (ccloop's CLI-level fake claude), fake syncskill `inject-ok` via `ORCA_SYNCSKILL_BIN` in the runtime env. The run settled and landed; every recorded claude argv had `--plugin-dir <drive.skills.dir>`; codex argv empty; one syncskill call; snapshot gone and workspaces root empty after settle. Printed tree:
```
C9 landed tree of cb51b072abf13acfaaa9f04889575602c0ba583d:
100644 blob f70f10e4db19068f79bc43844b49f3eece45c4e8	shared.txt
```
No `.claude/` path, no `syncskill-lock.json`. Honest claim: fake claude + fake syncskill only.

## Gate (clone, at the content of 01b74bc)
- `npm run typecheck` rc 0 (`t6/typecheck.log`).
- Listed set (`t6/gate.log`): executionDriver*, driver*, startEnvelope*, workspace*, handoffE2E, skillsE2E, driveRecord, tests/skills, confirmSkills, setTaskLoopSkills, loopPlanE2E — 28 files, 304 passed, 1 skipped (syncskillReal, needs a real syncskill), 1 failed: driverRecovery "drives a retried run on…" (5 s timeout; uptime load 6.60 at start). Rerun alone 3/3 green (load 3.00–3.36; `t6/recovery-{1,2,3}.log`).
- Full suite (`t6/full.log`): 296 files, 2717 tests, 2707 passed, 8 skipped, 2 failed: driverRequirementSplit (registered flake) and controlShutdown "real SIGTERM" (registered 143). Load 3.07 at start, 9.87 (5-min) at end. Each rerun alone 3/3 green (`t6/flake-*.log`, load 5.9–10.0).
- Clone tree compared with the main tree before commit: `git diff` byte-identical (cmp), new files cmp-identical.

## Files changed
src: `control/workspace.ts` (`skillsPathOf`, `makeReadOnly`, `removeSkillsSnapshot` with owner-write restore; `cleanupRunWorkspace` removes the snapshot by runId), `control/driveRecord.ts` (`skills`, default null), `control/executionDriver.ts` (`ExecutionDriverDeps.syncskill`, `newDrive skills: null`, A2 injection `injectRunSkills`, record + envelope), `control/schema.ts` (loopWork `skillPluginDir`), `control/startEnvelope.ts` (conditional spread), `control/executionPort.ts` (`LoopWork.skillPluginDir?`), `panel/controlAssembly.ts` (driver gets `syncskillOptionsFromEnv(env)`), `skills/syncskill.ts` (export `lockSkillSchema`).
Existing test files modified (all additive): `fixtures/driverHarness.ts` (optional `syncskill` for confirm and deps), `fixtures/ccloopWorld.ts` (optional `env` in WorldOptions), `tests/skills/fixtures/fake-syncskill.mjs` (inject modes write `syncskill-lock.json` beside the skills; new `inject-not-found`, `inject-renamed`), `startEnvelope.test.ts` and `workspace.test.ts` (appended tests only). No existing assertion changed.

## Decisions
1. Recorded/sent `dir` is `realpath(skills-<runId>)`: ccloop's accept requires a canonical directory, and a symlinked control dir (e.g. macOS `/tmp`) would otherwise refuse deterministically at B. Removal still goes by `skillsPathOf`.
2. Lock check compares names in order with the frozen (sorted) list, as the brief's code does; mismatch ⇒ `SyncskillError("syncskill-output-invalid")` ⇒ `skills-inject-failed:syncskill-output-invalid` (added a test + M12).
3. Non-syncskill failures (mkdir, chmod) block as `skills-inject-failed:<describeError>`, per the brief.
4. Injection sits after the continuation's predecessor cleanup and `readConfirmedTaskExecution`, before the contract/envelope (the brief's place). Estimate and reconcile runs never reach it (no taskId at A2 / spawned in R).
5. `makeReadOnly`/restore skip symbolic links (chmod would follow them out of the snapshot). Restore gives dirs u+wx.
6. Unconfigured driver = `deps.syncskill` absent ⇒ `{bin:null}` ⇒ `syncskill-unconfigured`.
7. Fake syncskill now writes a lock file; its shape `{profile:null, skills}` is a guess at the real file's shape, only used so C5 compares against "the lock file's skills[]".

## Concerns
- A C5 run with the **real** syncskill (spec's C5 wording) is not done here; only the fake. `syncskillReal.test.ts` stays skipped without a real binary.
- Under failure, `workspace.test.ts`'s new test can leave read-only residue in TMPDIR (seen under M6/M8 only); a passing run leaves none.
- ccloop af26a22 is not pushed; Orca's gate needs that build until it is.

---

## Fix round 1 (review I1, I2) — implementer subagent, session 08b1007d, 2026-10-03, commit `2ea3271` (parent `01b74bc`)

Logs are under the same `t6/` scratch directory. Only tests changed. No src change was needed.

### I1: C5 with a real syncskill
- syncskill was built from a `git clone --local` of `/Users/biran/code/skills/syncskill` at **`3157563e58585e1feb5327a24a56e04efe7a4291`**. `npm run build` returned rc 0 (`t6/ss-build.log`). The gate is `ORCA_SYNCSKILL_REAL_BIN=t6/ss/dist/index.js`. The global syncskill was not used.
- New test `tests/control/driverSkillsReal.test.ts`. It is gated with `ctx.skip()` on `ORCA_SYNCSKILL_REAL_BIN`, the same pattern as syncskillReal. It reuses that test's seed: `sync/skills/alpha/SKILL.md` plus `config.json`. HOME and SYNCSKILL_DIR are temp dirs, and the driver gets `syncskill = { bin: wrapper, env: { ...process.env, HOME, SYNCSKILL_DIR } }`. It runs A1 and A2 for a task frozen as `["alpha"]` and asserts:
  - `SKILL.md` exists;
  - `plugin.json` is present with exact bytes;
  - the dir and `.claude-plugin` are 0700;
  - `skills/alpha` has no write bit;
  - the lock file's `schema` is `syncskill-lock-v1`;
  - `drive.skills` deep-equals `{dir, profile:null, lock: lockFile.skills}`;
  - the real `~/.syncskill` snapshot is unchanged.
- With the gate (`t6/r1-gate.log`): 2 files, 2 passed, rc 0. These are driverSkillsReal and syncskillReal. The real lock printed was `{"schema":"syncskill-lock-v1","created_at":"2026-10-03T09:59:30.088Z","profile":null,"skills":[{"name":"alpha","source":null,"resolved_commit":null,"content_md5":"c09d307b4834eb4a01…"}]}`.
- Without the gate (`t6/r1-nogate.log`): 7 files, 61 passed, 2 skipped (driverSkillsReal and syncskillReal), rc 0. The run covered driverSkills, workspace, startEnvelope, skillsE2E (real ccloop af26a22) and tests/skills.
- Real shape compared with the fake:
  - The lock **entries** have the same shape. Real local skills have `source: null` and `resolved_commit: null`, which the fake already produces for its second entry.
  - The lock **file** differs. The real file carries `schema: "syncskill-lock-v1"` and `created_at`, which the fake did not write. The fake now writes `{schema, created_at, profile: null, skills}`.
  - This was measured with a manual `inject` against the same build before the test was written.

### I2: the three uncovered branches
- (a) and (b): new test in `workspace.test.ts`. A symlink `skills/alpha/link.md` points at `outside.txt`, which sits outside the snapshot.
  - After `makeReadOnly`, the outside file stays 0644 while `skills/alpha` loses its write bits.
  - With the outside file set to 0400, `removeSkillsSnapshot` removes the dir and the outside file stays 0400.
- (c): new test in `driverSkills.test.ts`. The `A2-after-workspace` crash seam is used without throwing: it chmods the workspaces root to 0500, so the snapshot's `mkdir` fails with a plain EACCES. The run blocks with `skills-inject-failed:EACCES: permission denied, mkdir '<skills-<runId>>'`, and the syncskill fake records no spawn.
- Mutations were run in the clone, each applied alone.

| # | Mutation | Red |
|---|---|---|
| M13 | delete the symlink skip in `makeReadOnly` | link test: `expected 365 to be 420` (the outside file became 0555) |
| M14 | delete the symlink skip in `restoreOwnerWrite` | link test: `expected 493 to be 256` (the outside file became 0755) |
| M15 | `describeError(error)` → `"unknown"` | plain-error test: the blockedReason did not match |

- Restore bytes. Baseline `git diff` was 32058 bytes, cached 0.
  - M13's first restore went through `sync.sh`. That did not restore it, because src was already committed in the main tree and `sync.sh` copies only uncommitted files: 32020 bytes, DIFFERENT. M14 and M15 from that pass were therefore stacked on M13 and are discarded.
  - Restore then copied `src/control/workspace.ts` and `executionDriver.ts` from the main tree. The diff came back to 32058 bytes, `cmp` same.
  - M14 and M15 were then each rerun alone. During the mutation the diff was 32020 and 32047 bytes respectively. After each restore it was 32058 bytes, cached 0, `cmp` identical to the baseline.
  - M13's red is valid because it ran first, on a clean base.
- After restore (`t6/r1-final.log`): driverSkills, workspace, startEnvelope, skillsE2E and driverSkillsReal (not gated) gave 37 passed, 1 skipped, rc 0. `npm run typecheck` returned rc 0 (`t6/r1-typecheck.log`). The changed test files are `cmp`-identical between the clone and the main tree. Load average was 2.54 at the start.

### Note
The round-0 mutation restores (M1–M12) were valid. At that point src was still uncommitted in the main tree, so `sync.sh` copied it back, and the bytes were checked against the 30941 baseline each time.
