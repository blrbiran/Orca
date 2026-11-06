# Quota rest: probe the installation, then retry on it (design)

Who: Claude Code (Opus 5.5), session 86352010, 2026-11-06, on Orca `660b4bdf` (ccloop pin `292ddb5`).
Status: **revision 2** (2026-11-06, session 86352010): review round 1 (independent reviewer subagent, same session) folded
in; controller decisions recorded in §7. Revision 1 was the controller's draft at `2618eeb2`. Not yet implemented.
Every file:line below was read at Orca `660b4bdf` (worktree `2618eeb2`, `src/` unchanged) and ccloop `292ddb5`.

## 0. Human rulings (verbatim)

- On the 24-hour vendor cap (`REST_VENDOR_CAP_MS`, codex's weekly limit costs one failed run a day): 「可以先跑一个测试限额是否
  恢复的小探针run，再决定正式run是否跑」.
- On "a quota-failed task with no other installation: retry on the same installation when the rest ends? today only with
  `quotaWait`": the controller recommended "after the rest ends, one small probe call on that installation; on success
  retry the task once there; on quota, keep resting; at most one probe per rest end". Reply: 「都同意按你的建议走」.

## 1. Today (evidence, Orca `660b4bdf`, ccloop `292ddb5`)

- `installationRests` (`src/control/quotaRest.ts:77-106`) derives every resting installation from stored runs: the quota
  streak since the last success, `until` = the vendor's reset (capped 24 h) or 15 min doubling to 8 h. It reads only runs
  whose body has `drive.failureCause.cause = 'quota'` or `drive.outcome = 'succeeded'` (`:79`), and keeps only rests with
  `until > now` (`:103`).
- `failoverCandidates` (`src/control/systemDebug.ts:382-398`) moves a quota-failed task to another installation when its
  agent source is switchable and a target exists (`failoverTargets`, `quotaRest.ts:70-72`). `failoverPass`
  (`src/control/webService.ts:798-832`) skips a target `resolveAgentSwitch` cannot resolve without booking anything
  (`:813-816`); a booked failover command, applied or refused, is final (`systemDebug.ts:393`).
- `quotaWaitCandidates` (`systemDebug.ts:348-365`) retries a quota-failed task on the **same** installation every
  `QUOTA_REPROBE_MS` (30 min), only for installations a person listed in `quotaWait` (default empty). The retry is the
  probe: a whole loop run (worktree, setup commands, then the first request). Its retry sends no `runId`
  (`webService.ts:883-887`).
- Otherwise the task stays failed for a person. That is the gap this design closes.
- **A single call reports no typed cause today.** ccloop `src/control/singleCall.ts:110-134` records only
  `errorCode` (the error's `code`, else its message up to the first `:`); the record (`:171-182`) has no cause field.
  The codex adapter's single call throws `codex-<reason>: <dir>` with a cause only for `stalled`
  (`src/runtime/codex/codexAdapter.ts:226-235`), although the loop path classifies the same stream
  (`outcome.stream.call.value()`, `:79`; the quota rows, `src/runtime/failureCause.ts:44-55`). Claude's single call
  (`src/runtime/claude/claudeAgentAdapter.ts:482-490`) does the same; its classifier runs on the loop path only
  (`:353-366`). Omp classifies every failure `unknown` (`failureCause.ts:140-158`). Collect takes `failureCause` from the
  loop state only (`src/control/collect.ts:199-200`).
- In Orca the single-call record schema is strict (`src/control/executionDriver.ts:1092-1101`); a record that does not
  parse blocks the run `single-call-record-invalid` (`:1136-1139`). The purpose sees only the normalised code (`:1157`);
  the run ends `settled-restartable` with no `drive.outcome` and no `drive.failureCause`
  (`src/control/driverHandoff.ts:67-76`). So `installationRests` sees no single call as quota or as success.
- Every single call reserves its grant in its group: a requirement call checks `fits(used, reserved, limit)` and the
  spend caps (`gateClaim`) before it is claimed (`src/control/requirementCalls.ts:108-112`); a flow call draws from its
  pool and reserves on the parent (`src/flow/calls.ts:146-176`). A run's breach of its grant turns a limited Web group
  `blocked` (`src/control/usage.ts:41-51`); `overGrantBlockRuns` names those runs, excepting estimates and clarify/split
  calls (`src/control/overGrantBlock.ts:14-22`).

## 2. Behaviour

**Scope (the task the probe is for).** An orchestrated group's task (the groups `failoverCandidates` reads: run mode, not
a flow child, not archived, not stopped; `isFailoverGroup`, `systemDebug.ts:404-409`) whose current run ended with cause
`quota` on installation *I* (`terminallyFailedRun`, `systemDebug.ts:275-279`), where:

1. *I* is not in `quotaWait` (those keep today's behaviour, unchanged);
2. **failover did not move it**: after this pass's `failoverPass`, no *applied* failover command exists for that run --
   the source is not switchable, there was no target, every target failed to resolve, or the failover was refused;
3. *I* is not resting now (`installationRests(store, now)` has no entry for *I*): its rest has ended.

**Shortcut.** If a run on *I* (any group, any task) succeeded after the task's failed run, the quota is back: no probe,
the task gets its retry at once (below).

**Probe (one per installation per rest end).** One single call of a new purpose `quota-probe`, keyed by
`(I, R_q)` where `R_q` is the last quota run of *I*'s streak (the run `installationRests` would name as
`InstallationRest.runId`; a reader that also returns an *ended* rest's `runId` is added beside `installationRests`, which
itself stays as it is for every other caller).

- **Run identity.** The probe runs on its own synthetic work item `quota-probe-<sha256(I) first 16 hex>-<R_q>`, never on
  the task's work item. (On the task's work item it would break `retry-task`'s newest-run identity check,
  `src/control/retryTask.ts:97-100`, and enter the task's inherited usage, `src/control/fundedAllowance.ts:40-49`,
  `:138-142`.) Its run row is the record: every scoped task on *I* finds the probe by that work item id and reads its
  outcome. No new table.
- **Where.** In the group of the first scoped task on *I*, in pass order; a group that cannot fund the probe (below) is
  skipped and the next scoped task's group is tried. The slot is that task's frozen work agent on *I*; the plan names the
  profile binding (candidate: the group's confirmed estimator profile).
- **Request.** A fixed prompt asking for `{"ok": true}`, response schema `{ok: boolean}` (closed, required),
  `maxOutputTokens: 64` (claude passes it to the runner, `claudeAgentAdapter.ts:478`; codex cannot cap output and Orca
  checks the bound afterwards, `codexAdapter.ts:178`).
- **Grant (controller decision).** `{tokens: 50000, activeMs: 120000, attempts: 1, sessions: 1}`. Tokens: the only
  measurement of the shape is 10109–11590 input tokens for a one-line codex single call (ccloop handoff, Orca session
  `a852f96a`, gpt-6-luna, codex 0.160.0); 50 000 is about four times the high end, so a framework that grows does not
  breach. activeMs: the single call's timeout is `grant.activeMs - 10 000` (ccloop `singleCall.ts:53`, `:100`), so
  110 s.
- **Booking.** Reserved like a requirement call: the grant must fit the group's limit and pass the spend caps
  (`requirementCalls.ts:108-112`); usage is booked to the group as any single call's. A group that cannot fund it is not
  probed, and the pass records an activity row `quota-probe-unfunded:<dimension or spend-cap>` on the task (once per key),
  so the task page says why it stays with the person.
- **No over-grant block.** A `quota-probe` run's breach is recorded on the run only and never blocks its group: excluded
  at the writer (`usage.ts:51`) and in `overGrantBlockRuns` (`overGrantBlock.ts:19`), as clarify and split calls are.
- It changes nothing in any repository (a single call stands in an empty private directory, ccloop `singleCall.ts:79-82`).

**Outcome** (read by code from the probe's run row; requires §4's ccloop change):
- Probe **completed**, or ran to its end with invalid output (ccloop `SingleCallOutputInvalid`, `singleCall.ts:113-119`:
  the provider answered, so the quota is back) ⇒ every scoped task on *I* whose failed run predates the probe gets one
  `retry-task` (below). `installationRests` counts the probe as a success on *I*, so the streak ends.
- Probe failed with `failureCause.cause = quota` ⇒ no retry; `installationRests` counts the probe as a quota failure on
  *I*, so the next rest starts from it (vendor reset or the doubled default) and `R_q` becomes the probe run (a new key
  for the next rest end).
- Probe **aborted** (a stop reached it) ⇒ not an outcome: the key stays free and a later pass probes again.
- Probe failed otherwise (auth, executable-missing, unknown, …) ⇒ no retry, no further probe for this key; the task
  stays for a person, and its run diagnosis names the probe run and its `failureCause` (or `errorCode` when none).

**The retry.** Command id `orca-auto-quota-probe-retry-<taskId>-<runId>`, actor `orca-auto`, payload
`{taskId, runId: <the failed run>}` (no `agent`, no `work`). Before sending, the pass re-checks that the group is still a
failover group (`isFailoverGroup`: not stopped, not archived, run mode) and that the task's current run is still the
failed run; otherwise nothing is sent this pass, so a refusal never uses up the id (the issue #61 shape,
`systemDebug.ts:344-347`). The `runId` guard (`retryTask.ts:90`) refuses, booked, a retry that a person's action
overtook (`task-run-moved`).

## 3. What does not change

`quotaWait` (still the person's choice, still the 30-minute whole-run retry); failover (it runs first; the probe only
covers tasks it did not move); the rest derivation's numbers; the ladder's exemption of `quota`; flow-call and
single-call failovers (separate item, quota failover spec §4); every existing single-call record without `failureCause`.

## 4. Order of work (controller decision)

1. **Orca, accept the field.** `singleCallRecordSchema` accepts an optional `failureCause: {cause, detail}` (cause from
   ccloop's vocabulary, detail bounded as ccloop's `causeDetail`, 512 bytes). Nothing reads it yet. A criterion shows a
   record without it parses exactly as today, and one with it is not `single-call-record-invalid`.
2. **ccloop change** (under ccloop's own rules, Rule 16; the human pushes it). Each adapter's single-call failure path
   attaches the classification its loop path computes (codex `outcome.stream.call.value()`, claude `this.classify`,
   omp unchanged); `runSingleCall` writes it as `failureCause` on the record of a call that did not complete. A complete
   record is byte-identical to today.
3. **Repin** ccloop in Orca.
4. **Orca probe**: the `quota-probe` purpose (registered in `SINGLE_CALL_PURPOSES`, `src/control/singleCall.ts:12`, the
   handlers record, `src/control/singleCallPurposes.ts:95-99`, the protocol's purpose enums, `src/control/webProtocol.ts`,
   and the migrations' purpose list, `src/control/migrations.ts:303-307`), its handler storing the outcome and
   `failureCause` on the probe run, `installationRests` reading `quota-probe` runs (completed or output-invalid =
   success, cause `quota` = quota), and the pass in `systemDebugPass` after `failoverPass` (`webService.ts:878`).

Step 4 before step 1 would make every failed estimate, clarify, split and flow call `single-call-record-invalid`.

## 5. Criteria (each a command exiting 0/non-0, each seen red on its named mutation in a `git clone --local` copy)

`tests/control/quotaRestProbe.test.ts` (fake agents; temp stores), plus R0 in the single-call record tests:

| # | Case | Mutation |
|---|---|---|
| R0 | a single-call record with `failureCause` parses; one without parses byte-identically | keep the schema strict |
| P1 | rest ended, failover did not move the task ⇒ one `quota-probe` run on *I* on its own work item; probe completes ⇒ one `retry-task` row on *I*, which applies | skip the probe and retry at once |
| P2 | still resting ⇒ no probe | drop the "not resting" check |
| P3 | the candidate read is called with a switchable source and a target, **before** any failover command exists ⇒ not a probe candidate; and with a failover booked *refused* ⇒ a candidate | treat "a target exists" as "moved" (drop the applied-command test) |
| P4 | *I* in `quotaWait` ⇒ no probe (quota-wait retry as today) | drop the `quotaWait` exclusion |
| P5 | probe fails `quota` ⇒ no retry, `installationRests` names a new rest from the probe run | treat any failed probe as completed |
| P6 | probe fails `auth` ⇒ no retry, no second probe at the next pass, the task's diagnosis names the probe run and `auth` | retry on any failure; drop the diagnosis line |
| P7 | the pass twice at one rest end ⇒ one probe run, one retry row | drop the existence check of the probe's work item |
| P8 | paused or stopped group ⇒ no probe and no retry sent | drop the group check |
| P9 | probe fails `quota`; at the next rest end a second probe runs | key on the task's failed run instead of `R_q` |
| P10 | two scoped tasks (two groups) on *I* ⇒ one probe run, two retry rows | key per task |
| P11 | after a completed probe, the retried run's `retry-task` applies and `readFundedAllowance` of the failed run still passes | put the probe on the task's work item (refused `retry-identity`) |
| P12 | limited group without room for the grant ⇒ no probe there, activity `quota-probe-unfunded:…` on the task | reserve without the fit check |
| P13 | probe usage over its grant in a limited group ⇒ the group's status is unchanged | drop the `quota-probe` exclusion in `usage.ts` |
| P14 | a person retries the task while the probe runs ⇒ orca-auto's retry booked `task-run-moved`, one run claimed | drop `runId` from the payload |
| P15 | probe aborted by a stop ⇒ after resume a new probe runs for the same key | treat aborted as failed |
| P16 | probe output invalid ⇒ retry sent | treat output-invalid as failed |
| P17 | a run on *I* succeeded after the failed run ⇒ retry sent, no probe | drop the shortcut |
| P18 | a completed probe ends the streak: a later quota failure on *I* rests 15 min | do not read probe runs as success |

## 6. Cost (stated, not estimated)

A completed codex probe costs the framework overhead of a one-line prompt: 10109–11590 input tokens recorded for that
shape (Orca session `a852f96a`; not re-measured here). A probe that hits quota fails at the first request. Against
today's "a whole loop run as the probe" (`quotaWait`), the probe avoids the worktree and setup commands on every failed
try, and books no quota-failed run into the task's lineage (whose attempts and sessions count against the task's grant).

## 7. Controller decisions (reversible; session 86352010, after review round 1)

- The ccloop route for the cause (§4), in the stated order.
- One probe per installation, keyed on the streak's last quota run; the probe's run row on a synthetic work item is the
  record.
- The probe's grant `{50000, 120000, 1, 1}`, reserved like a requirement call; an unfundable group is skipped with an
  activity row; a probe never blocks its group.
- The retry carries `runId` and is sent only after re-checking the group and the task.
- Scope condition 2 is "failover did not move it".
- Invalid probe output counts as "quota is back"; a later success on the installation replaces the probe.

## Review round 1 — resolutions

Review: `scratchpad/review-specs-probe-topup.md` (reviewer subagent, session 86352010, 2026-11-06, on `2618eeb2`).

| Finding | Resolution |
|---|---|
| A-C1 single calls report no typed cause | §1 states the evidence; §4 adds the ccloop change and the Orca read; §2 Outcome reads `failureCause` from the probe run. |
| A-I1 strict record schema, order of changes | §4 step 1 before step 2; criterion R0. |
| A-I2 probe run identity | §2 Run identity (synthetic work item, slot, profile named by the plan); P11. |
| A-I3 budgeting, over-grant block | §2 Grant/Booking/No over-grant block; P12, P13. The exclusion is at the writer `usage.ts:51` as well as `overGrantBlock.ts:19` (the review named only the latter). |
| A-I4 once-key on `until`; P7 not red-able | Key `(I, R_q)`; P7's mutation changed; P9 added. |
| A-I5 retry `runId`, stop/pause, aborted probe | §2 The retry; aborted is not an outcome; P8, P14, P15. |
| A-I6 scope condition 2; P3 not red-able | Condition 2 = "failover did not move it"; P3 calls the candidate read directly. |
| A-I7 missing criteria | P6 (diagnosis), P10, P12, P13, P18. |
| A-M1 `maxOutputTokens` | Fixed at 64; no per-kind measuring. |
| A-M2 invalid output | Counts as quota back; P16. |
| A-M3 later success on *I* | Shortcut; P17. |
| A-M4 purpose registration sites | Listed in §4 step 4. |
| A-M5 cost figure unverified | §6 says it is cited, not re-measured. |
| Simpler alternative (retry without probe) | Not taken: §6 states why (setup cost per try; quota-failed runs book attempts and sessions into the task's lineage). |
