# Temp-root leak from an all-skipped test file — round ledger (session `2f65a729`, 2026-09-29)

> Append-only. Corrections go in a new section; the original text stays verbatim (Rule 13).
> Source: `docs/handoff/handoff.md` §4.0, "Orca `check-tmp-leak` leaves one empty directory in a run with a flaky red" (registered, not fixed, by session `2724716d`).

## §1 Authorisation

- The human, after pushing the previous round: "已推送，继续下一件。" The controller picked this item: every other open item needs a human to name a criterion or approve a design, and this one needed neither.
- Not authorised and not done: push, paid calls, deleting data, killing processes, rewriting an existing criterion.

## §2 Root cause

- Shape of the leftover, in both gate runs of session `2f65a729` and in session `2724716d`'s gate: one empty `orca-tmp-*/orca-test-control-*`. `tests/setup/scopeTmpdir.ts` creates the outer directory and `tests/setup/relocateUserData.ts` the inner one, both at module load; each removes its own in an `afterAll`. Both levels surviving means neither `afterAll` ran for that file.
- Ruled out along the way, each by a measurement:
  - A nested vitest re-running the setup files: no test spawns vitest or imports `tests/setup/*` (grep, exit 1, zero hits).
  - A child process recreating the path after cleanup: the panel creates `<control>/<repoKey>/…` and three subdirectories, so it cannot leave an *empty* control directory (`src/panel/controlAssembly.ts`).
  - A worker crash: `or.out` of the gate run holds no worker or unhandled error; the 8 failed suites in its JSON are the 4 failed files plus their describe blocks.
  - `tests/control/ccloopBin.test.ts` and `tests/control/store.test.ts`, which started 122 ms and 834 ms after the leftover's birth time: alone under `check-tmp-leak`, 0 entries left, 2 of 2 each.
- Cause: `@vitest/runner` `runSuite` (`node_modules/@vitest/runner/dist/index.js`, vitest 2.1.9) calls neither `beforeAll` nor `afterAll` when `suite.mode === "skip"`, and a file suite becomes `skip` when every test in it is skipped at collection. `tests/control/ccloopDefaultE2E.test.ts` gated its only describe with `describe.skipIf(!formal)`, so every full run without `ORCA_CCLOOP_DEFAULT_E2E=1` skipped the whole file after the setup files had already created their directories.
- Reproduced: `node scripts/check-tmp-leak.mjs tests/control/ccloopDefaultE2E.test.ts` in the gate clone, rc 1, "3 tests, 1 entries left", 2 of 2.
- ⇒ The leak is deterministic, one directory per full run, and unrelated to flaky reds. The earlier reading ("a worker torn down mid-file in a run with a flaky red") was wrong; corrections are appended to both ledgers that carried it.
- Why it started one round ago: `ccloopDefaultE2E.test.ts` arrived with the ccloop git-dependency plan (session `2724716d`); the runs that left 0 entries predate it.

## §3 Fix

Commit subject: `test(control): gate the default-ccloop E2E at run time so its temp root is removed`.

- `describe.skipIf(!formal)` → a plain `describe` with `beforeEach((ctx) => { if (!formal) ctx.skip(); })`. `it.skipIf` would not do: a suite whose children are all skipped at collection is itself marked `skip`. The three `it` blocks and every assertion are unchanged.
- A named ERRATUM appended to `tests/setup/scopeTmpdir.ts`: "the root is removed when the file is done" does not hold for an all-skipped file.
- Ruling (not yet reviewed by the human): this edit changes how an existing criterion file is skipped and not what it asserts, so it was treated as outside "rewriting an existing criterion" (which needs the human to name the test). Cost if wrong: revert this one commit; the leak comes back.
- Evidence (`git clone --local` copy; `cat` to sync, `cmp` for identity):
  - after the fix: the file alone under `check-tmp-leak` rc 0, "3 tests, 0 entries left", 2 of 2; a plain run reports `3 skipped (3)`.
  - mutation: the skip branch disabled (`if (false) ctx.skip()`), with `ORCA_CCLOOP_DEFAULT_E2E` and `ORCA_CCLOOP_BIN` unset → all 3 run and fail (`ccloop-not-installed` twice, `panel-dist-missing` once). The gate is what skips them; they are not empty. Restored, and `cmp` shows the copy is identical to the main tree.
  - red before the fix: the reproduction in §2.

## §4 Registered, not fixed

- Nine other files under `tests/control` gate with `describe.skipIf` / `it.skipIf`: `agentSelectionE2E`, `agentUpgradeE2E`, `ccloopPortMissingTable`, `ccloopProtocol.integration`, `estimateE2E`, `executionDriverE2E`, `handoffE2E`, `progressE2E`, `webCcloopSmoke`. With `ORCA_CCLOOP_BIN` and the agents table set, as in every gate, they run. In an environment without those variables, any of them that is skipped as a whole leaks the same way. Not measured, not changed.
- `tests/panel/noSkips.test.ts` scans only `tests/panel` and `web/tests`, so it does not see `tests/control`.

## §5 Gate (session `2f65a729`; script `gate3.sh`, raw output `gate3/` in the session scratchpad)

- Fresh `git clone --local` of Orca at subject `test(control): gate the default-ccloop E2E at run time …`; `ORCA_CCLOOP_BIN` = the ccloop build from the previous gate (ccloop unchanged); HOME and the four XDG roots redirected; TMPDIR a short real directory; fake codex `integration` agents table; JSON reporter.
- web build rc 0; typecheck rc 0.
- Full run with `TMPDIR=$T/or`: 2153 tests, 2149 passed, 1 failed, 3 pending (`ccloopDefaultE2E`, now skipped at run time). **`$T/or` held 0 entries afterwards.**
- `node scripts/check-tmp-leak.mjs` (a second full run): **rc 0**, "vitest exit 1, 2153 tests, 0 entries left".
- The one red: `driverRecovery` "drives a retried run on from where it was blocked, to settled", a 5 s timeout (registered load flake; the 5-minute load average reached 11.3 during the runs). Alone in the same clone, 3 of 3 passed (8/8 each). That run had a flaky red and still left 0 entries, which also contradicts the old "flaky red ⇒ leak" reading.
- The real `~/.orca`: `stat` identical before and after (`1790516258 128`).
