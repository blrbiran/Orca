# Plan: quota rest -- probe the installation, then retry on it

Who: Claude Code (Opus 5.5), implementer subagent of session 86352010, 2026-11-06, on Orca `fa593909` (branch
`feat/quota-probe`). Spec: `docs/superpowers/specs/2026-11-06-quota-rest-probe-retry-design.md` (revision 2).

## Tasks

1. **R0** (spec §4 step 1): `singleCallRecordSchema` (executionDriver.ts) accepts optional `failureCause: {cause, detail}`;
   `cause` a bounded string (as `runFailureCauseSchema.cause`), `detail` ≤ FAILURE_DETAIL_MAX, nullable; strict inside.
2. **ccloop** (spec §4 step 2, ccloop branch `feat/single-call-failure-cause`): codex and claude single-call failure paths
   attach `singleCallCause` (the classification their phase paths compute); `runSingleCall` writes it as the record's
   `failureCause` for a failed (not output-invalid, not aborted) call. Omp attaches none: its record is byte-identical.
3. **Orca probe** (spec §2, §4 step 4):
   - `quota-probe` purpose: `SINGLE_CALL_PURPOSES`, handler (`quotaProbeCall.ts`), protocol enums (dispatch envelope,
     run view), panel run view (persisted run schema, identity branch, output bound), web type.
   - handler: verdict by code from the record (`back` = complete or output-invalid, `quota` = typed cause quota,
     `failed` = anything else, `aborted` = not an outcome); stored on the probe run as `probeVerdict` (+ `drive.failureCause`
     for quota, `endedAt`), also when the run is blocked on unknown usage.
   - `installationRests` reads a `back` probe as a success; a reader of every installation's last streak (ended rests too).
   - `usage.ts` / `overGrantBlock.ts`: a `quota-probe` breach never blocks its group.
   - stop: `terminaliseRun` gives a stopped probe's grant back to its group.
   - pass (`quotaProbe.ts`, `webService.ts` after `failoverPass`): candidates, shortcut, probe claim (fit + spend cap,
     else activity `quota-probe` with reason `quota-probe-unfunded:<dim|spend-cap>`), retry with `runId` after re-check,
     activity `quota-probe` reason `quota-probe-failed` naming the probe run and its cause.

## Criteria -> mutation

| # | File | Mutation |
|---|---|---|
| R0 | tests/control/singleCallFailureCause.test.ts | drop `failureCause` from the schema |
| P1-P18, P19 | tests/control/quotaRestProbe.test.ts | as spec §5; P19 (old pin): treat a probe with no typed cause as quota |
| ccloop C1-C4 | ccloop tests (codexSingleCallWorker, claudeSingleCall, singleCallCause) | drop the attachment / the record write |

## Files

src/control/{executionDriver,singleCall,singleCallPurposes,quotaProbeCall,quotaProbe,quotaRest,usage,overGrantBlock,
stopIntent,webProtocol,webService}.ts, src/panel/controlViews.ts, web/src/controlTypes.ts, web/src/controlApi.ts, locales.
