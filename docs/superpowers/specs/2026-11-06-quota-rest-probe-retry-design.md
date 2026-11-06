# Quota rest: probe the installation, then retry on it (design)

Who: Claude Code (Opus 5.5), session 86352010, 2026-11-06, on Orca `660b4bdf` (ccloop pin `292ddb5`).
Status: the human approved the direction (below); this text is the controller's design, not yet reviewed.

## 0. Human rulings (verbatim)

- On the 24-hour vendor cap (`REST_VENDOR_CAP_MS`, codex's weekly limit costs one failed run a day): 「可以先跑一个测试限额是否
  恢复的小探针run，再决定正式run是否跑」.
- On "a quota-failed task with no other installation: retry on the same installation when the rest ends? today only with
  `quotaWait`": the controller recommended "after the rest ends, one small probe call on that installation; on success
  retry the task once there; on quota, keep resting; at most one probe per rest end". Reply: 「都同意按你的建议走」.

## 1. Today (evidence, Orca `660b4bdf`)

- `installationRests` (`src/control/quotaRest.ts:77-106`) derives every resting installation from stored runs: the quota
  streak since the last success, `until` = the vendor's reset (capped 24 h) or 15 min doubling to 8 h.
- `failoverCandidates` (`src/control/systemDebug.ts:382-398`) moves a quota-failed task to another installation when its
  agent source is switchable and a target exists (`failoverTargets`, `quotaRest.ts:70-72`).
- `quotaWaitCandidates` (`systemDebug.ts:348-365`) retries a quota-failed task on the **same** installation every
  `QUOTA_REPROBE_MS` (30 min), only for installations a person listed in `quotaWait` (default empty). The retry is the
  probe: a whole loop run (worktree, setup commands, then the first request).
- Otherwise the task stays failed for a person. That is the gap this design closes.

## 2. Behaviour

**Scope (the task the probe is for).** An orchestrated group's task (the groups `failoverCandidates` reads: run mode, not
a flow child, not archived, not stopped) whose current run ended with cause `quota` on installation *I*, where:

1. *I* is not in `quotaWait` (those keep today's behaviour, unchanged);
2. failover does not apply: the task's agent source is not switchable, or `failoverTargets(...)` is empty at the pass;
3. *I* is not resting now (`installationRests(store, now)` has no entry for *I*): its rest has ended.

**Probe.** One single call on *I*, purpose `quota-probe`: a fixed prompt asking for `{"ok": true}`, response schema
`{ok: boolean}` (closed, required), the smallest `maxOutputTokens` the kinds accept **[the plan measures it per kind]**.
Booked like any single call of the task's group (usage ledger, grant). It changes nothing in any repository.

**Outcome.**
- Probe completed (any valid output) ⇒ orca-auto issues one `retry-task` for the task on *I*
  (command id `orca-auto-quota-probe-retry-<taskId>-<runId>`; its row, applied or refused, is the record).
- Probe failed with cause `quota` ⇒ nothing more; the probe run is a quota failure on *I*, so `installationRests` starts
  the next rest from it (vendor reset or the doubled default). **[unverified: whether ccloop's single call reports a
  typed `quota` cause the way a loop run does (`drive.failureCause`); if it does not, the probe run must be read by
  `installationRests` from wherever the single call records the CLI's error, or the design changes. The reviewer
  checks this first.]**
- Probe failed otherwise (auth, executable-missing, output invalid, …) ⇒ no retry; the task stays for a person; the run
  diagnosis names the probe run and its error.

**Once.** At most one probe per (task, failed run, rest end): the probe's deterministic id includes the rest's `until`
(`orca-auto-quota-probe-<taskId>-<runId>-<until>`). A later rest end (after a probe that hit quota again) may probe
again; the cap on how often is the rest itself (≥ 15 min, doubling, or the vendor's reset).

**Several tasks on one installation.** One probe per installation per rest end, not per task: the first scoped task (in
the pass's group/task order) carries it; the others wait for its answer and then all get their `retry-task`.
**[open: the plan decides whether to hold the others or let each probe; holding needs a per-installation record of the
probe outcome, which the rest derivation does not have today.]**

**Cost (stated, not estimated).** A completed codex probe costs the framework overhead of a one-line prompt; the ccloop
handoff records 10109–11590 input tokens for that shape (Orca session `a852f96a`, gpt-6-luna, 0.160.0). A probe that
hits quota fails at the first request. Compared with today's "a whole loop run as the probe" (`quotaWait`), the probe
avoids the worktree and setup commands on every failed try, and pays the framework overhead once on the try that works.

## 3. What does not change

`quotaWait` (still the person's choice, still the 30-minute whole-run retry); failover (it runs first; the probe only
covers tasks it cannot move); the rest derivation's numbers; the ladder's exemption of `quota`; flow-call and
single-call failovers (separate item, quota failover spec §4).

## 4. Criteria (each a command exiting 0/non-0, each seen red on its named mutation in a `git clone --local` copy)

`tests/control/quotaRestProbe.test.ts` (fake agents; temp stores):

| # | Case | Mutation |
|---|---|---|
| P1 | rest ended, no failover target ⇒ one `quota-probe` run on *I*; probe completes ⇒ one `retry-task` row on *I* | skip the probe and retry at once |
| P2 | still resting ⇒ no probe | drop the "not resting" check |
| P3 | a failover target exists and the source is switchable ⇒ failover, no probe | drop the failover-first check |
| P4 | *I* in `quotaWait` ⇒ no probe (quota-wait retry as today) | drop the `quotaWait` exclusion |
| P5 | probe fails `quota` ⇒ no retry, a new rest from the probe run | treat any failed probe as completed |
| P6 | probe fails `auth` ⇒ no retry, no further probe at the next pass | retry on any failure |
| P7 | the pass twice at one rest end ⇒ one probe, one retry row | drop the `until` in the id |
| P8 | paused or stopped group ⇒ no probe | drop the group check |

## 5. Open questions (for the reviewer first, then the human only if evidence cannot settle them)

1. The `[unverified]` single-call quota cause in §2.
2. One probe per installation or per task (§2).
3. Whether a probe counts against a limited group's grant like an estimate, or is booked outside any grant.
