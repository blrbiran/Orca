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

## As built (implementer subagent, session 86352010, 2026-11-06)

Commits on `feat/quota-probe` (base `fa593909`): `cd3c1c3f` R0, `912316ca` probe, `48fd500e` + `7052119e` criteria,
`be80db14` enum-count Ruling, and this note. ccloop: branch `feat/single-call-failure-cause` (`ae46036`, `095b55e`), built
clone at `<scratchpad>/ccloop-sc`. Orca's pin is unchanged (292ddb5).

### Decisions (reversible, with why)
- D1 `failureCause.cause` is a bounded string, not ccloop's enum (as `runFailureCauseSchema`): a cause a newer ccloop adds
  must not make a record `single-call-record-invalid`.
- D2 ccloop: the adapters attach a new `singleCallCause` property, not the existing `failureCause` (which the stalled
  paths already attach, omp included): so omp's record stays byte-identical (spec "omp unchanged") and
  `ompSingleCallStall.test.ts:129` needs no rewrite. Only `failed` records carry it (not aborted, not output-invalid).
- D3 ccloop claude: a single call now records its signals file (needed to classify); a completed call removes it, so
  `singleCall.test.ts` W5 (exact file list) holds unchanged.
- D4 Probe profile: the failed run's own `executionProfile` binding; slot: the task's frozen work agent.
- D5 Verdict stored on the probe run (`probeVerdict`, `endedAt`, and `drive.failureCause` when ccloop named a cause) by
  code, both on completion and when the run is blocked on unknown usage (`SingleCallHandler.blockedRunFields`); the
  driver passes `{outcome, failureCause}` to `evaluate` as `facts`.
- D6 The migrations' purpose list (`migrations.ts` 18->19 repair) is not changed: a probe exists only in a group with a
  task run, which that repair already leaves alone (its condition 5). Editing a historic migration is not needed.
- D7 One activity kind `quota-probe` with `body.reason` = `quota-probe-failed` (names `probeRunId`, `cause`, `errorCode`)
  or `quota-probe-unfunded:<dimension|spend-cap>`; added to the protocol, web kinds and both locales.
- D8 Spend cap is read with `claimCapBlocking` (read-only): an unfunded probe never writes a group-level cap block.

### Criteria and mutations (clone `<scratchpad>/mutQP`, restore proved by `git diff` / `--cached` = 0 / 0 bytes)
R0 red at singleCallFailureCause.test.ts:29 (schema without the field). P1 :93, P2 :106, P3 :117, P4 :181, P5 :131,
P6/P19 :148, P9 :136, P15 :168, P16 :170, P17 :193, P18 :205 -- each red on its named mutation.
P7: NOT red-able as written -- with the pass's pending check and the claim's active-run check both removed it stays
green, because the store's unique index `one_active_work` refuses a second active run on the work item (caught per
candidate). The guard exists three times; none of my mutations isolates one.
Not built as criteria (open): P8 (paused/stopped group), P11 (readFundedAllowance after the retry), P12 (unfunded
group), P13 (probe over grant does not block), P14 (person's retry races the probe). P10 is two tasks in ONE group
(the harness builds one group), not two groups. P15 uses an aborted record, not a real stop/resume.
ccloop: C1 record write, C2 codex attach, C3 claude signals, C4 vocabulary filter, C5 signals removal -- all red.

### Open items
- A codex quota rejection reports no usage, so a probe that hits quota in a group WITH a token limit is blocked at C
  `quota-probe-usage-unknown:<code>` (verdict still recorded, so the pass still decides). That block is not settleable
  by the existing single-call settlement (estimate/clarify/split/flow only) and may keep the group's usage unknown.
  Groups without a token limit book the approximate floor and complete. Needs a human decision.
- No criterion runs the probe through the real ccloop binary (`ORCA_CCLOOP_BIN=<scratchpad>/ccloop-sc/dist/cli.js`);
  all probe criteria use a fake port. The ccloop side is covered by ccloop's own criteria.

### Round 2 (controller decisions after the first report, session 86352010)
- Gap 5 (controller decision): a probe whose record says failed with typed cause `quota` and whose work usage is unknown
  books usage 0 and completes, in limited and unlimited groups alike (precedent: ccloop books a codex 429 before work as
  0). Built as the handler hook `rejectedBeforeWork` + `bookRejectedZeroInTransaction` (quotaProbeCall.ts), taken in
  stepCSingleCall before the approximate path. Any other unknown usage keeps the `quota-probe-usage-unknown` block.
  Criterion "gap 5" (both arms): red at :265 with the hook removed, red at :272 with the hook true for every verdict.
- P8 red at :212 (group check dropped from quotaProbeCandidates). P12 red at :229 (fit check dropped). P13 red at :241
  (probe exclusion dropped in usage.ts).
- P14: green under "drop the pass's re-check and the payload's runId". Not because the guard is absent: the person's
  retry is claimed in the same driver rounds, so the task's current run is no longer the failed one, and the candidate
  read (terminallyFailedRun) drops the task. The criterion pins what happens: no orca-auto retry, two runs for the task.
- P7: the guard is the store's unique index `one_active_work` (runs(group_id, work_item_id) WHERE active=1). The pass's
  pending check and the claim's active-run check are second and third layers. No further criterion (controller).
- P11 not built.
- ccloop: rebased onto 32163ed, merged `--ff-only` into ccloop main (now `1bfe3ce`), branch deleted, worktree removed
  without force. Not pushed. `<scratchpad>/ccloop-sc` rebuilt at `1bfe3ce`. No probe criterion can use the real binary:
  driverHarness drives with FAKE_CCLOOP_RUN and the single call is answered by the fake port. With ORCA_CCLOOP_BIN at
  ccloop-sc, quotaRestProbe + singleCallFailureCause: 17 passed.
- Orca: rebased onto a51a0058 (no migration on this branch). Gate `node scripts/test-affected.mjs --base main`:
  exit 0; 817 files selected; root 636 files, 5536 passed, 32 skipped; web 181 files, 1666 passed.
