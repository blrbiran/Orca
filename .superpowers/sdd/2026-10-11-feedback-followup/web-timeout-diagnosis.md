# Web preview backoff timeout diagnosis

Owner: subagent `/root/web_timeout_diagnosis`, feedback follow-up run. Written 2026-10-11. Observed source commit: `35199d533a101bdf4cccd1656d820c7c10db2d4d`. Scope: read-only product/test investigation plus this new evidence document; no product or test edits, no full-suite rerun.

## Evidence and commands

Baseline evidence supplied by the parent: `/private/tmp/orca-followup-runs/baseline-web/output.log`, read in full with `rtk proxy cat /private/tmp/orca-followup-run.py /private/tmp/orca-followup-runs/baseline-web/output.log`. Its command is `npm run check --workspace web`: TypeScript completed, Vitest reported 837 passed and 2 failed, with the unavailable-slot and did-not-conclude bounded-preview-backoff criteria each timing out at 15000 ms. The trace identifies the test declarations, not the particular awaited step. The source commit was measured with `rtk git rev-parse HEAD`.

One authorized controlled diagnostic run:

```sh
rtk proxy python3 /private/tmp/orca-followup-run.py /private/tmp/orca-feedback-followup-20261011 baseline-preview-focused npm exec --workspace web -- vitest run tests/agentPreviewRefresh.test.tsx --maxWorkers=1 --no-cache
```

Evidence read back in full with `rtk proxy cat /private/tmp/orca-followup-runs/baseline-preview-focused/output.log /private/tmp/orca-followup-runs/baseline-preview-focused/result.json`. Exit code 0; 13 passed out of 13; Vitest duration 33.40 s; wrapper elapsedSeconds 34.28567409515381; source `35199d533a101bdf4cccd1656d820c7c10db2d4d`. No per-test timings were emitted by this passing run. This establishes that the two criteria complete under isolated execution without code changes. It does not establish a reliable full-suite pass.

## Mechanism

The costly operation is the timer harness advancing the whole App clock, not an actual 10-minute sleep. `web/tests/agentPreviewRefresh.test.tsx` uses fake timers with `shouldAdvanceTime: true`; its `pass` helper calls `vi.advanceTimersByTimeAsync`. The bounded retry loop advances 10, 20, 40, 80 and 160 seconds with a 1000 ms margin for each step. After retries stop, the tests additionally advance 600000 ms to prove no more previews happen. The unavailable-slot criterion does this again after manual recovery.

App retains a 2000 ms control interval and a 5000 ms chains interval even while these criteria inspect agent selection. `readControlTick` dispatches summary and recovery after every successful poll. `reduceSummary` constructs a fresh object for an unchanged equal change sequence, and `reduceRecovery` also constructs a fresh object. `loadChains` sets the newly parsed repos array on each read. Consequently every unrelated poll can produce React work; stable fake server data does not turn these operations into no-ops.

The installed Vitest implementation maps `advanceTimersByTimeAsync` to `clock.tickAsync`. Its bundled fake-timer implementation explicitly yields through the original native immediate/timer after each timer fires, allowing native promises to run before advancing to the next callback. Long clock advances therefore execute polling callbacks individually and repeatedly render the full panel, including translations. They do not merely change the clock once. Timer advancement is outside React `act`, unlike neighboring shorter polling criteria such as `overviewFreshness.test.tsx` and `projectFiltering.test.tsx`, so batching/flush boundaries are not made explicit by this harness.

The source is consistent with the existing `web/vite.config.ts` comment explaining that these criteria rerender the full panel many times and translation work previously motivated raising the timeout from 5 seconds to 15 seconds. The controlled isolated pass and repeat baseline declaration-level timeouts support a load-sensitive deadline failure caused by unnecessarily broad fake-clock work. There is no evidence here that the specified five-retry logic hangs, and no assertion failed in the isolated run.

Source excerpts and current line locations were measured with `rtk proxy python3` reads of the relevant source files and `rtk rg -n`:

- `web/tests/agentPreviewRefresh.test.tsx`: pass at 138; unavailable criterion at 190 with long advances at 204 and 208; failed-read criterion at 214 with long advance at 227; installation-table comparison criterion at 329 with its long advance at 342.
- `web/src/App.tsx`: backoff constants at 155; chains interval at 316; summary/recovery polling at 335-341 and 630; preview scheduling at 521-532; retry handling on resolved/unavailable and refused reads at 921-933.
- `web/src/controlState.ts`: fresh equal-sequence summary result at 117-130 and recovery result at 145.
- `node_modules/vitest/dist/chunks/index.C4tKZ0yW.js`: asynchronous timer native yield at 5853-5858; timer advancement mapping at 6804-6805.

## Limits and strongest contrary explanation

The installation-table criterion also advances a large clock horizon and passed at baseline, so elapsed fake time alone cannot explain which criteria cross the deadline. Its rendered failure/preview state differs, and the unavailable criterion has an extra long horizon. The failed-preview and table criteria have similar horizons, so comparative CPU profiling would be needed to assign their relative render costs. There was no per-await instrumentation, callback count measurement, or timing-harness change in this authorized read-only stage. Thus the exact await that exceeded the baseline deadline and the relative cost of React versus native yields remain unmeasured.

A genuine retry scheduling race could still be load dependent. The focused pass cannot exclude every race. However the current evidence supports unnecessary timer/poll/render workload as the first mechanism to address and test, not an arbitrary timeout increase, skipped test, or flake waiver.

## Recommended explicit plan task

Add a separately scoped task: **Make agent-preview backoff criteria deterministic without advancing unrelated polling work through native yields**. Treat this as a test-harness correction first; do not bundle product reducer optimization or change the operator's 10/20/40/80/160-second contract.

1. Establish a red performance/determinism witness for the current harness in an isolated local clone, with per-advance phase and unrelated polling callback observations. Keep logs as evidence and do not raise the configured deadline. The baseline red evidence already exists, but a mechanism-specific witness is needed for attribution.
2. Make React clock/flush boundaries explicit using `act`. Preserve asynchronous advancement at retry boundaries, where an effect schedules the next retry. For the long stopped/successful quiescence intervals, evaluate synchronous fake-clock advancement within `act` followed by controlled promise/effect flushing: this removes the real native yield for every unrelated interval while still firing any erroneously scheduled preview callback. If that is insufficient, introduce narrowly scoped background-interval isolation for these preview criteria while retaining real preview `setTimeout` callbacks, with separate polling criteria left intact. Do not blindly use a global run-all-timers operation against perpetual intervals.
3. Preserve assertions for no early read, exactly five backoff retries, stopped state, one failure report, manual recovery, and a new round after successful resolution. Explicitly prove red mutation witnesses for removing the five-retry bound (an additional scheduled read must be observed), removing manual reread, and changing a retry delay; these guard against a fast but vacuous timer harness.
4. Verify the focused file without timeout changes, then run the authorized web check once the implementation task reaches verification. Required success commands are the focused command above and `npm run check --workspace web`, both exit 0 with no skipped criteria. Capture complete logs and source commit. Additional repeats should be justified by unresolved load sensitivity rather than used to hunt for a lucky pass.

This task must appear explicitly in the implementation plan and its tests/spec review. The diagnostic run is a passing focused investigation, not permission to describe the current baseline web gate as green.
