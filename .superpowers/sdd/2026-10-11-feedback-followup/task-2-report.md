# Task 2 — deterministic preview-backoff clock

Owner: Codex `/root/timer_impl`, 2026-10-11 Asia/Shanghai. Controller-delegated Task 2 authority; final audit reserved for human. Base `115830d424f87063eb835d1f3f911ba1d3dfb0b2`; implementation `d2a8ec05850e7baa408ac3b6ca01b976500b6759`.

Only `web/tests/agentPreviewRefresh.test.tsx` changed: async retry advancement is inside React `act`; settled stopped/resolved 600000 ms horizons use synchronous advancement inside async `act`, which flushes promise answers/effects together. Every timer still fires; no preview timeout stub, polling/reducer edit, timeout increase, run-all-timers, skip or assertion relaxation. Genuine 10/20/40/80/160-second retry boundaries retain async advancement. Five retries, no early read, stopped state, single failure report, manual read and renewed round remain asserted.

## Historical authority and exact affected criteria

The two baseline timeouts and R17 contract remain recorded verbatim in [baseline raw log](/private/tmp/orca-followup-runs/baseline-web/output.log) and [diagnosis](web-timeout-diagnosis.md). Baseline was 837 passed / 2 timed out at 15000 ms; isolated baseline was 13 passed. Those facts are not converted into historical acceptance by this new gate.

Names and expected behavior are unchanged. Harness-only rewrites under Task 2 authority:

- `re-reads a preview whose slot was unavailable five times on the backoff, then waits for the operator's Re-read`: two settled long horizons now synchronous; R17/T15 five-retry bound and operator recovery retained.
- `retries a preview read that did not conclude five times on the backoff, reports the failure once, and then waits for the operator's Re-read`: stopped long horizon now synchronous; R17 five retries, one report and successful-read renewed round retained.
- `retries a failed installation table read five times on the backoff, then re-reads it and the preview when the operator presses Re-read`: same settled long horizon changed consistently; R17 installation-table/manual recovery retained.

Other uses of `pass`, including hidden-page/backoff criteria, gain `act` but remain asynchronous with their assertions unchanged. No old business expectation was superseded.

## Mechanism RED / GREEN

Independent local clone `/private/tmp/orca-task2-witness` counted real fetch requests for chains/summary/recovery and App commits via React Profiler around the exact 600000 ms horizon. Before fix, the unavailable-slot criterion observed 1027 unrelated requests / 776 commits and failed the <=3 batching witness (RC1). After fix, both its stopped and successful horizons still fired 1020 requests each, but only 2 commits each (RC0). This directly measures actual App timer work, not a mock timer witness. Passing console output was suppressed by Vitest, so a named raw-stdout follow-up preserved the numeric observations; the earlier green run is also retained.

The installed Vitest code maps async advancement to `clock.tickAsync`; it captures native `setImmediate || setTimeout` and invokes that captured callback after each fired timer. [Measured dependency excerpt](/private/tmp/orca-followup-runs/task2-restore/native-yield.txt) supports the native-yield mechanism; native yield count itself was not instrumented. No wall-time threshold was made an acceptance criterion.

## Clone deletion mutations and restoration

`/private/tmp/orca-task2-mutants` used the corrected real App test; product changes occurred only in that clone:

- Remove `schedulePreviewRetry` five-retry guard: criterion observes 7 reads where exactly 6 are allowed (RC1).
- Change actual first `AGENT_RETRY_DELAYS_MS` entry from 10000 to 1000: no-early-read criterion observes 2 where 1 is allowed (RC1).
- Delete manual `rereadPreview(groupId, 0)` call: Confirm remains disabled after Re-read (RC1).

An initial delay trial changed the first matching delay assignment, which belongs to installation-table retries rather than preview retries; the preview criterion passed RC0. This was an incorrectly scoped trial, not a valid witness, and the corrected actual delay mutation above failed as intended.

[Restoration proof](/private/tmp/orca-followup-runs/task2-restore/proof.json): both clone tracked `git diff` and `git diff --cached` are 0 bytes; restored product SHA256 matches original; main App is byte-identical to original. Corrected test and instrumented green source archived in the same evidence directory. All diagnostic/mutation `-t` runs intentionally select one criterion (12 unselected); focused/full acceptance runs have no skips. Dependencies were symlinked locally; no node_modules/shared ledger staged.

## Fresh gates and complete evidence

Every run used `/private/tmp/orca-followup-run.py`, isolated HOME/XDG/TMPDIR/CCMEM_DATA_ROOT, absent CCMEM_CONFIG_PATH. Full log files were read without filtering. SourceTreeSHA256 is measured by that runner over source/config files before each command; all runs observed base commit 115830d with their exact edited source tree.

Focused 13/13 passed; ACTUAL `npm run --ws check` with default worker configuration passed TypeScript and 104 files / 902 tests, no skips, unchanged 15000 ms deadline. Root `npm run typecheck` passed. Acceptance source tree SHA256 `58a505c7524e0952cd6a85645e1fc2bc559452ea35d0b070a8d26cd6ef4f90b8` matches the committed source change. One default full-web gate is evidence of this run, not a claim of permanent flake elimination; independent review/controller final gates remain separate.

- **task2-mechanism-red** RC1; `npm exec --workspace web -- vitest run tests/agentPreviewRefresh.test.tsx -t slot was unavailable --maxWorkers=1 --no-cache`; measured elapsed 9.578006744384766 s; tree `4053ef170adc7abb4f1d2680e56aed4dd9b82999e929c2fcf5c8a740ce4e295e`. [Complete log](/private/tmp/orca-followup-runs/task2-mechanism-red/output.log), [command/RC/source metadata](/private/tmp/orca-followup-runs/task2-mechanism-red/result.json).
- **task2-mechanism-green** RC0; `npm exec --workspace web -- vitest run tests/agentPreviewRefresh.test.tsx -t slot was unavailable --maxWorkers=1 --no-cache`; measured elapsed 2.7337429523468018 s; tree `141c23f887de2ab305497efb142c52e6548bd2b449f791908b59528b8a3d9f26`. [Complete log](/private/tmp/orca-followup-runs/task2-mechanism-green/output.log), [command/RC/source metadata](/private/tmp/orca-followup-runs/task2-mechanism-green/result.json).
- **task2-mechanism-green-raw** RC0; `npm exec --workspace web -- vitest run tests/agentPreviewRefresh.test.tsx -t slot was unavailable --maxWorkers=1 --no-cache`; measured elapsed 2.6398630142211914 s; tree `dad394d71f7a145ce6d4437fdefac714e0833ae69a758d56c55f09fccf37a390`. [Complete log](/private/tmp/orca-followup-runs/task2-mechanism-green-raw/output.log), [command/RC/source metadata](/private/tmp/orca-followup-runs/task2-mechanism-green-raw/result.json).
- **task2-focused-green** RC0; `npm exec --workspace web -- vitest run tests/agentPreviewRefresh.test.tsx --maxWorkers=1 --no-cache`; measured elapsed 6.642683982849121 s; tree `58a505c7524e0952cd6a85645e1fc2bc559452ea35d0b070a8d26cd6ef4f90b8`. [Complete log](/private/tmp/orca-followup-runs/task2-focused-green/output.log), [command/RC/source metadata](/private/tmp/orca-followup-runs/task2-focused-green/result.json).
- **task2-web-default** RC0; `npm run --ws check`; measured elapsed 30.847259044647217 s; tree `58a505c7524e0952cd6a85645e1fc2bc559452ea35d0b070a8d26cd6ef4f90b8`. [Complete log](/private/tmp/orca-followup-runs/task2-web-default/output.log), [command/RC/source metadata](/private/tmp/orca-followup-runs/task2-web-default/result.json).
- **task2-type** RC0; `npm run typecheck`; measured elapsed 9.756208181381226 s; tree `58a505c7524e0952cd6a85645e1fc2bc559452ea35d0b070a8d26cd6ef4f90b8`. [Complete log](/private/tmp/orca-followup-runs/task2-type/output.log), [command/RC/source metadata](/private/tmp/orca-followup-runs/task2-type/result.json).
- **task2-mutant-bound** RC1; `npm exec --workspace web -- vitest run tests/agentPreviewRefresh.test.tsx -t slot was unavailable --maxWorkers=1 --no-cache`; measured elapsed 4.909087896347046 s; tree `cac91ce4751ed523d6b63a96580a013e93ee157e8ed8a4bd271bf0bc4537ad2f`. [Complete log](/private/tmp/orca-followup-runs/task2-mutant-bound/output.log), [command/RC/source metadata](/private/tmp/orca-followup-runs/task2-mutant-bound/result.json).
- **task2-mutant-delay** RC0; `npm exec --workspace web -- vitest run tests/agentPreviewRefresh.test.tsx -t slot was unavailable --maxWorkers=1 --no-cache`; measured elapsed 2.5695009231567383 s; tree `dce9d6b2cd1746e1a6b6653473e96498d6cee5bdb0ddb09c0bf9c1832b6588ab`. [Complete log](/private/tmp/orca-followup-runs/task2-mutant-delay/output.log), [command/RC/source metadata](/private/tmp/orca-followup-runs/task2-mutant-delay/result.json).
- **task2-mutant-preview-delay** RC1; `npm exec --workspace web -- vitest run tests/agentPreviewRefresh.test.tsx -t slot was unavailable --maxWorkers=1 --no-cache`; measured elapsed 2.0972609519958496 s; tree `f339e4aade1626370a7e2a880c3ee7aa88faa78a88fb85b6279fd51df38af751`. [Complete log](/private/tmp/orca-followup-runs/task2-mutant-preview-delay/output.log), [command/RC/source metadata](/private/tmp/orca-followup-runs/task2-mutant-preview-delay/result.json).
- **task2-mutant-manual** RC1; `npm exec --workspace web -- vitest run tests/agentPreviewRefresh.test.tsx -t slot was unavailable --maxWorkers=1 --no-cache`; measured elapsed 3.6731860637664795 s; tree `f4813e8dc465031df40af53d49768ff1b3c8549a9645efbbbe5d1cf62695008b`. [Complete log](/private/tmp/orca-followup-runs/task2-mutant-manual/output.log), [command/RC/source metadata](/private/tmp/orca-followup-runs/task2-mutant-manual/result.json).
