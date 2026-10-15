# Task A5 review (task reviewer, Orca session 026d10e3 subagent, 2026-10-15)

Reviewed: `373a3ed2..a72f3e22` (one commit, `a72f3e22 feat(control): carry a single call's errorCode into its estimate, call record and block reason`), 9 files.
Inputs: `task-A5-brief.md`, `task-A5-report.md`, `review-373a3ed2..a72f3e22.diff`, `common-preamble.md` (K3, K4), `reviewer-contract.md`.
Clone: `/private/tmp/oec/mut/a5` at `a72f3e22` (`/private/tmp/oec/logs/a5-clone.log` rc=0, `a5-head.log`).

## Spec compliance: ✅

Checked against the brief and the binding §4.5 constraints:

- **Normalisation.** `normalizeSingleCallErrorCode` (`src/control/executionDriver.ts:656-664`) takes the part before the first `:` with `split(":", 1)[0]` and accepts it only if it matches `^[a-z][a-z0-9-]{0,63}$`. Anything else becomes `unknown`, and null stays null. The test's K4 rows pin these results: `x:y\n<script>` gives `x`; `<b>x</b>:y\n`, `X-Y`, a 65-char code and `""` each give `unknown`.
- **Where `failure` is set.** In `stepCSingleCall` it is null for `outcome === "complete"` and is the normalised `record.errorCode` otherwise. `rawOutput` is computed before this point and is not changed, so receipts and the replay hash are unchanged: `identifyRawEstimateOutput(rawOutput)` and the receipt check are untouched.
- **Estimate reasonCode.** It is `estimate-call-failed:<code>` only when the classifier says `estimate-call-failed` and `callFailure !== null`. Otherwise it is the classifier's reason as before. The service method (`webService.ts:563`) passes no code and keeps the old behaviour. `EstimateOutputClass` is not widened, as the preamble's interpretation requires.
- **Clarify call.** It is recorded as `callOf(run, "failed", failure)`. `lastInvalidReason` is still `classified.reason`, which is `no-output`, so the text the prompt sees is unchanged. A test proves this: the second prompt contains `no-output`.
- **Split call.** It is recorded as `callOf(run, "failed", failure)`. The draft's `output`, `plan`, `reasons`, `layers` and state transitions use the same code paths as before.
- **Usage-unknown block reason.** It is `<usageUnknownReason>:<code>` when the code is non-null, and the bare reason otherwise.
- **Pre-spawn refusals.** `PRE_SPAWN_REFUSALS` = {`omp-single-call-cap-exceeded`, `omp-single-call-unavailable`}. For both clarify and split, these codes skip the re-queue and go straight to the failed branch. The failed reason codes are `clarify-output-invalid` / `split-output-invalid`, and `autoRetry`/`retries` stay 0.
- **Rewrites of existing assertions.**
  - `driverEstimate.test.ts` was rewritten at old `:86`, now `:88`. This is the usage-unknown block, which the brief names.
  - `driverEstimate.test.ts` was rewritten at old `:136`, now `:139`. This is the `it.each` "a call that failed" row.
  - `driverRequirementSplit.test.ts` was rewritten at old `:57`, now `:59`.
  - Each rewrite keeps its title and has the comment the brief gives.
  - No other existing assertion changed. Following K3, `driverEstimate.test.ts:27` is untouched.
  - The text of old `:86` also appears at `:71`, in the aborted-call test. It was correctly left alone. That case has `errorCode: null` and outcome `aborted`, so `failure` is null and the reason stays bare.
- **Fixtures keep their defaults.** In `estimateHarness.ts:63` and `requirementHarness.ts:67`, an omitted `errorCode` still gives `"single-call-output-invalid"` for a failed call. Non-failed outcomes still get `null`. An explicit `null` is passed through. The only interface changes are the new optional fields. Every caller that existed before builds byte-identical records.
- **Other call sites.** `grep` over `src` shows that `handler.complete`/`handler.evaluate` have only the driver as a caller. `completeEstimateInStore` has only `webService.ts:563` (the default applies) and `singleCallPurposes.ts:54`. `evaluateSplit` ignores the extra argument, which the interface allows.
- **No extras.** Nothing beyond the brief was added.

Verification in the clone:
- The 7 Step 5 files: `/private/tmp/oec/logs/a5-review-baseline.log`, rc=0, 7 files, 81 passed, 0 skipped.
- `npm run typecheck`: `/private/tmp/oec/logs/a5-review-typecheck.log`, rc=0.

## Findings

Critical: none. Important: none.

Minor:
1. **`A5g` went red earlier than the brief predicted, at the harness wait.** The brief expected `A5g` to fail on the `toMatchObject` assertion with `state: "invalid"`, draft 2 present. It actually failed at `tests/control/singleCallErrorCode.test.ts:61`, on `x.until(() => readDraft(...,1).state === "failed")`. The harness threw `requirementHarness: not there; runs [["draft-1",…],["draft-2",…],["draft-3",…]]`.
   - This is still a behavioural red, not a crash or load error. The predicate the test waits on never holds, and the run list shows drafts 2 and 3 were queued, which is exactly the re-queue the mutation brings back.
   - `A5h` (added below) fails the same way.
   - Optional hardening: wait on `x.until(() => readDraft(x.store, "r", 1).state !== "drafting")` so that the red falls on the `toMatchObject` line and shows `state: "invalid"`. No change is required.
2. **The split pre-spawn test does not assert that the draft's `reasons` are unchanged.** The test is verbatim from the brief, and `reasons: ev.reasons` is on an unchanged code path. This is noted only so the plan owner knows that this §4.5 clause rests on reading the code, not on a criterion.

## Mutations (clone `a5`; runner self-check with a bad spec: `.mutate` "found 0", restore bytes 0/0)

| Name | File | Test file | Red on | Restore bytes (diff / cached) |
|---|---|---|---|---|
| A5a | src/control/executionDriver.ts | singleCallErrorCode | normaliser `toEqual` (:16); estimate hostile row `reasonCode: estimate-call-failed:unknown` (:25); clarify other-failure `calls` (:51) | 0 / 0 |
| A5b | src/control/webService.ts | singleCallErrorCode | "estimate: …" `reasonCode` (:25), got `estimate-call-failed` | 0 / 0 |
| A5b2 | src/control/webService.ts | driverEstimate | only the rewritten row "a call that failed" (:145) | 0 / 0 |
| A5c | src/control/executionDriver.ts | singleCallErrorCode | "usage unknown…" `blockedReason` (:33) | 0 / 0 |
| A5c2 | src/control/executionDriver.ts | driverEstimate | only the rewritten test (`:88`, "blocks as estimate-usage-unknown…") | 0 / 0 |
| A5d | src/control/requirementCalls.ts | singleCallErrorCode | both clarify tests at the `calls` assertion (:42, :51), got `invalid`/`no-output` | 0 / 0 |
| A5e | src/control/requirementCalls.ts | singleCallErrorCode | "clarify: a pre-spawn refusal…" (:41), `retries` 2 | 0 / 0 |
| A5f | src/control/requirementCalls.ts | singleCallErrorCode | "split: …" `toMatchObject` (:62), call `invalid` | 0 / 0 |
| A5f2 | src/control/requirementCalls.ts | driverRequirementSplit | only the rewritten test (:59) | 0 / 0 |
| A5g | src/control/requirementCalls.ts | singleCallErrorCode | "split: …" at its `until` (:61); drafts 1-3 ran (see Minor 1) | 0 / 0 |
| A5h (added: drop `omp-single-call-unavailable` from the set) | src/control/requirementCalls.ts | singleCallErrorCode | "split: …" at its `until` (:61) | 0 / 0 |
| A5i (added: drop `omp-single-call-cap-exceeded` from the set) | src/control/requirementCalls.ts | singleCallErrorCode | "clarify: a pre-spawn refusal…" (:41), `retries` 2 | 0 / 0 |

12/12 mutations went red. Every `.mutate` says "applied 1 replacement spec(s)". In every case sha-after differs from sha-before, and sha-restored equals sha-before. Specs are in `/private/tmp/oec/mut/specs/a5/`, logs are `/private/tmp/oec/mut/logs/A5*`, and a collected copy of the red logs is in `/private/tmp/oec/logs/a5-review-reds.txt`.

`pgrep -fl "fake-ccloop|worker.js|vitest"` found nothing both before and after (rc=1; `/private/tmp/oec/logs/a5-pgrep-before.log`, `a5-pgrep-after.log`). No leftover processes.

## ⚠️ Items

- **The shared runner differs from the preamble's recipe.** `/private/tmp/oec/mut/mut.sh` is not the version written in common-preamble.md U3.
  - Its failure path is `|| { echo "mutate failed: $N" >> …; }`, without the `exit 2`. On a failed spec it goes on to run the tests, and the script exits 0.
  - The usage comment line is also missing.
  - I did not edit it, because it is shared and was written by an earlier agent. Instead I read every `.mutate` file and confirmed each says "applied".
  - Risk: a reviewer who looks only at red/green could take a mutation that never applied as one that "stayed green", or as a pass. Recommend that the controller restore `exit 2`.
- **Not checked against the spec text.** The §4.5 quotes were checked against the dispatch's binding constraints. I did not re-open the spec file itself.
