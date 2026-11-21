# Run/task outcomes back to ccmem (tester #418, the remaining half)

> Status: **design only** (2026-11-21, Orca session `cf2d6dfd`). The read path, the default correction export and the
> `dir:` refusal are implemented; this document covers the one remaining item: Orca never tells ccmem which memories a
> run actually carried, so ccmem cannot learn whether an injected memory was useful. Nothing here is implemented.
>
> Sequencing: this depends on `work.memory` (the bundle in `2026-11-20-memory-in-runs-and-read-api-design.md` §3).
> Without the bundle's ids there is nothing to attribute. **Implement the bundle first**; then this.
>
> Independent review (2026-11-21) corrected the first draft: the terminal-transition anchor, the exit-64 meaning, the
> project key source, the id type and the "dispatched" proof are different from what that draft said. The corrections
> are folded in below and marked where they matter.

## 1. What the signal is — and what it is not

Orca knows a run's terminal outcome and, once the bundle ships, the exact memory ids the run carried. It does **not**
know which of six injected memories changed the agent's answer. Any per-memory "useful/harmful" verdict from one run
would be a fabricated counterfactual.

So the writeback records a **fact**, not a verdict:

> run `run-…` (task `T3`, attempt 2, project `github.com/acme/x`) ended `succeeded`; the provider received memory ids
> `[1042, 1057]`.

ccmem aggregates these facts. Phase 1 (this design) **records only**; it does not move `trust_score` and does not change
retrieval. A later, separately reviewed phase may derive a weak signal from many runs (a memory whose runs succeed at the
project's base rate is not evidence; one carried by many failed runs may be), and must state its threshold and its
counterfactual before touching trust.

Rejected alternatives:

- **Send the memory text back.** Redundant (ccmem wrote it), larger, and invites the outcome to be read as a judgement
  on the text. Ids are enough.
- **Send prompts/transcripts/diffs.** Privacy and size; ccmem's existing feedback heuristics already see the harness
  transcript when ccmem is installed there. Orca phases deliberately do not load that hook.
- **Mark "harmful" when the run failed.** A run can fail for a provider, quota, merge or check reason that has nothing
  to do with the injected memory. Only the fact goes back.

## 2. Transport

New ccmem CLI verb, shaped like the existing `orca-correction` (spec `2026-10-21-orca-correction-import-design.md`):

```
ccmem orca-outcome upsert          # cwd = the registered target repository; stdin = one JSON document
```

Request (`orca-run-outcome-v1`):

```jsonc
{
  "version": 1,
  "runId": "run-5c248541-…",
  "taskId": "T3",                  // null for a run with no task
  "attempt": 2,                    // null when the ccloop report did not name one
  "outcome": "succeeded",          // the ccloop terminal outcome, verbatim (see below)
  "abandoned": false,              // true when the run was abandoned, not a ccloop outcome value
  "memoryIds": [1042, 1057],       // positive integers (ccmem rowids), 1-64 of them
  "observedAt": 1795194943994      // when Orca first froze this payload, ms since the epoch
}
```

`outcome` is an **open string** carrying ccloop's own terminal value, as `failureCause.cause` does: today
`succeeded | blocked_waiting_human | exhausted | cancelled | failed`, plus `not-started` from a retry record. It is not a
closed enum here; ccmem stores the text. `abandoned` is the one Orca-only fact: abandonment lives in the run's
`blockedReason`, not in ccloop's outcome.

Response:

```jsonc
{ "version": 1, "state": "recorded", "projectKey": "github.com/acme/x" }
```

`state` is `recorded | unchanged | refused`. `projectKey` is the key ccmem derived from `cwd`, echoed for the run
evidence.

- **Project key comes from `cwd`, not the payload** (review I1). ccmem's `resolveProjectKey` is the one rule, and Orca's
  copied `normalizeRemoteUrl` deliberately differs on a local-path origin; passing Orca's key would split the data.
  Orca runs the verb with `cwd` = the registered target repository (multi-directory: the primary), exactly as
  `callCcmemCorrection` does. A key in the payload is refused as an unknown key.
- **Ids are numbers** (review I2). ccmem's ids are SQLite rowids; `m123` is display decoration. The bundle's `ids` must
  therefore be numbers too (correction to the bundle spec, see §7).
- **Idempotency key**: `(project_key, run_id)`, with a **UNIQUE** constraint. One terminal outcome per run. The same
  frozen body returns `unchanged`; a different body returns `refused` and never overwrites (a run's terminal outcome is
  immutable).
- **Exit codes**: `0` recorded/unchanged; `64` this input is refused and must not be retried; `1` retry later. **A 64 is
  per run, never a global switch** (review C3): a malformed payload on one run must not stop the feature for the rest.
  "Unsupported verb" is a distinct, separate probe (see §3).
- **Storage**: a new ccmem table `orca_run_outcomes` (schema migration; no export change). Columns: `project_key`,
  `run_id`, `task_id`, `attempt`, `outcome`, `abandoned`, `memory_ids` (JSON array), `observed_at`, `recorded_at`,
  `UNIQUE(project_key, run_id)`, index on `recorded_at`. It is not a `memories` row: `export`, retrieval, the stable
  section and the memory count are untouched.
- **No daemon requirement**: a one-shot CLI write, with the same busy timeout and `BEGIN IMMEDIATE` as
  `orca-correction`.

## 3. Orca producer

The first draft anchored on `drive.endedAt`; that field does not exist, and the terminal outcomes that matter most
(ccloop `failed`/`exhausted`) stop at `blocked-at-C` and never enter the driver's `DRIVEN` set (review C1/C2). The
producer is therefore an **outbox drain**, not a call inside one terminal transition.

### 3.1 Queue

- `drive.memoryFeedback` (optional, on the existing drive record) is the outbox row:
  `{ state, payload?, detail?, at, attempts }`. `state` is `pending | sent | refused | failed | unsupported | skipped`.
- The row is written once, by a **drain pass**, not by every terminal path: the pass scans the store (not
  `driverRunIds`) for runs that are terminal **or blocked with a recorded outcome**, that carry memory evidence, and
  that have no `memoryFeedback` yet. This covers `blocked-at-C`, `settled`, `settled-*`, `failed-before-provider`,
  abandoned runs and a run settled by a person's retry, without enumerating call sites.
- **Dispatched proof** (review I4): queue only when the **collect/terminal report echoed `memory`** for this run (the
  bundle spec's collect key) — i.e. the envelope actually reached the provider. A bundle frozen at A2 but blocked at B
  before any call, or a handoff stop that never dispatched it, has no echo and sends nothing. `drive.memory` alone is
  not enough.
- **Freeze on first sight**: the first pass writes the whole payload (including `observedAt`) into
  `drive.memoryFeedback.payload`; every retry resends those bytes. A later clock tick or a changed attempt cannot make
  the body differ and turn a transient exit 1 into a permanent `refused` (review I5).
- `observedAt` is the Orca time of that first freeze; ccloop has no terminal timestamp. `attempt` is the report's
  `currentAttempt` when present, else `null`; never recomputed on retry.
- A `dir:` project (or any project ccmem cannot key) is `state: "skipped"`, reason
  `dir-project-memory-unsupported` — one spelling everywhere (review M1); no process is spawned.
- A run whose bundle was dropped for size has no ids and queues nothing.

### 3.2 Drain

- The pass runs from the driver's periodic maintenance (a panel timer is equivalent) and is **not** tied to a run being
  in `DRIVEN`. At most one in-flight send per panel process; a bounded number of rows per tick.
- `pending`/`failed` with `attempts < 2` → spawn `ccmem orca-outcome upsert` with the frozen stdin, `cwd` = target repo,
  timeout as corrections; on `0` → `sent`; on `64` → `refused` (this run only); on other/non-JSON → `failed`,
  `attempts+1`, retried on a later tick.
- **Unsupported is a probe, not a 64** (review C3): at panel start (and lazily if the binary changes), run
  `ccmem orca-outcome --help`; a binary that does not know the verb is `unsupported` and the pass is a no-op. The probe
  is cached by binary path + mtime + reported version, so an in-place ccmem upgrade re-probes. A payload 64 never
  disables the feature.
- **Failure is a notice, never a run failure**: a spawn error, non-zero exit or unparseable answer only moves the
  outbox row; the run's state, activity and cleanup/publish are unchanged.
- **Default and switch**: outcomes are exported by default when `ORCA_CCMEM_BIN` is an absolute path and the control
  plane is on; `--no-ccmem-outcomes` disables and `--ccmem-outcomes` forces (same conflict code as corrections). A panel
  without ccmem writes `skipped`/`no-ccmem` once.

## 4. What ccmem may read

Phase 1 adds one read-only command for the operator:

```
ccmem orca-outcome list [--project <key>] [--since <date>] [--json]
```

It returns the recorded rows and a per-memory count (`carried`, `succeeded`, `failed`, `exhausted`, `cancelled`,
`blocked_waiting_human`) for inspection. **It does not change `trust_score`, retrieval, injection or the stable
section.** A later phase that does must be a separate spec with:

- a minimum sample (e.g. ≥20 runs per memory per project) and the project's base rate;
- a counterfactual statement (what "without this memory" means);
- a human-approved migration and an off switch.

## 5. Boundaries

- A continuation is a new run with its own bundle and its own outcome; it is not folded into its predecessor.
- Multi-directory groups use the primary directory's registered checkout as `cwd`.
- Single-call runs (clarify/split/estimate) never carry a bundle and never send an outcome.
- No second outcome after `state: "sent"`, even if the task is later accepted or reviewed: those are different facts,
  and a review result is not a memory-use signal.
- A corrupt `drive.memory` (no readable ids) queues nothing; the run view already names it.

## 6. Criteria (each must be seen red first)

1. **Blocked-at-C failure is sent**: a ccloop `failed`/`exhausted` run that stops at `blocked-at-C` (no driver pass
   after it) is drained and sent. Mutation: scan only `DRIVEN`/`settled` runs → the row never appears, red.
2. **One send per run under replay**: replaying the terminal transition (the `C-after-terminal` replay point) and
   visiting a settled-but-uncleaned run again both leave one `memoryFeedback` row and one `sent` state. Mutations: queue
   in each terminal transition instead of the drain → two rows; send without checking the outbox row → two calls. Both
   red.
3. **No dispatched proof, no call**: a run whose bundle froze at A2 but whose collect report has no `memory` echo spawns
   no process. Mutation: queue on `drive.memory.ids` alone → a call appears, red.
4. **No bundle, no call**: a run with no ids queues nothing. Mutation: send `memoryIds: []` → a call appears, red.
5. **Payload shape**: exactly the keys in §2; ids are positive integers; a mutation that sends `"m1042"` or adds
   `text`/`prompt`/`projectKey` is red on an exact-key/type assertion.
6. **Freeze**: a transient exit 1 followed by a clock tick and a different `attempt` resends the **same bytes** and
   returns `recorded`; mutation: recompute `observedAt`/`attempt` per retry → ccmem returns `refused`, red.
7. **A ccmem failure does not fail the run**: spawn error/exit 1 leaves the run's terminal state, activity and
   cleanup/publish unchanged and writes `state: "failed"`; the feedback write is awaited so the assertion cannot pass on
   an unhandled promise. Mutation: `throw` from the drain → the pass dies, red on the state/activity assertions.
8. **64 is per run**: a malformed payload gets `refused` for that run, while a well-formed row in the same tick still
   gets `sent`. Mutation: a 64 disables the feature → the second row never sends, red.
9. **Unsupported is probed**: an old ccmem without the verb yields `unsupported` and no retry loop; replacing the binary
   (mtime changes) re-probes and sends. Mutation: a payload 64 sets `unsupported` → red.
10. **`dir:` is skipped by name**: no process, reason `dir-project-memory-unsupported`.
11. **Idempotency and immutability in ccmem**: replaying the same body returns `unchanged`; a changed body returns
    `refused` and the stored row is byte-identical. Mutation: upsert overwrites → red.
12. **Export is untouched**: `ccmem export --json` bytes and the memory count are the same before and after an outcome
    row exists.
13. **Phase 1 does not move trust**: after recording outcomes, `trust_score`, `recent_injections` and retrieval answers
    are unchanged. Mutation: call the real trust writer (`lib/trust.mjs` / `lib/feedback.mjs`, not a name from this
    spec) from the new verb → red.

## 7. Correction to the bundle spec

The bundle spec's §3 shows `"ids": ["m1042", "m1057"]`. ccmem's ids are positive integers (the `m` is display
decoration), and Orca's own export reader validates a positive integer. Corrected: `"ids": [1042, 1057]`, positive
integers, same order as the text's rows. This is a correction appended to
`2026-11-20-memory-in-runs-and-read-api-design.md`; its original text stays for the record.
