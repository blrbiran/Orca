# A single call whose usage is unknown: name the stall, keep the lower bound, let the person settle it (tester #62)

- Author: Orca session `3cd8fb02` (Claude Opus 5.5), 2026-10-27, on Orca main `9ebfc86f` and ccloop main `ae6fb71`.
- Human ruling (session `3cd8fb02`, verbatim answer to the proposed direction "ccloop returns a usage lower bound and
  classifies the stall as retryable; Orca gives the person a settlement exit; no silent zero"): 「同意」.
- Repos touched: ccloop (C1, C2) and Orca (O1–O4). Order in §7.

## 1. Problem

Tester #62 (`orca_archived_files/issue-20261023.md`, two cases on 2026-10-27): an omp requirement call ends with
`exit-error` (code 1) after omp's own provider watchdog fires ("OpenAI completions stream stalled while waiting for the
next event"). ccloop books the call's usage as null (omp single-call spec 2026-10-14 §3.3.7: a process that did not end
cleanly books null even after a complete message; the observed sum is only written to `usage-lower-bound.json` as a
diagnostic). Orca then cannot settle the call:

- `verifyStoppedSingleCall` (`src/control/singleCallLedger.ts`) refuses a run with `unknown.work` ⇒
  `run-stop-unconfirmed` ⇒ `stepCSingleCall` blocks the run at C with `requirement-usage-unknown:omp-exit-error`
  (`src/control/executionDriver.ts`, the catch after `handler.complete`).
- `groupUsageUnknown` (`src/control/budget.ts`) then marks the group ledger; `claimOrWait`
  (`src/control/requirementCalls.ts`) parks every later call with `requirement-usage-unknown`. The comment there says
  it outright: "version 1 has no command that clears unknown usage, so that wait is final."
- The only existing exit, `settle-unknown-usage` (`src/control/settleUnknownUsage.ts`), refuses clarifying groups
  (`group-state-invalid: clarifying`) and needs a task run.

So one network stall ends the requirement for good. The same block applies to every single-call purpose that goes
through `stepCSingleCall`: estimate (`estimate-usage-unknown`), clarify and split (`requirement-usage-unknown`) and
flow calls (`flow-call-usage-unknown`).

## 2. Decisions

- **D1 — No silent zero.** A call that may have spent tokens is never booked as 0 (the tester's suggestion "allow a
  settlement with usage 0" is not taken). 0 stays reserved for what ccloop proves never started (`neverStarted`,
  rate-limited before work).
- **D2 — The person settles, by charging the call's remaining grant.** Same method and marker as the task path
  (`method: "remaining-grant"`, spec 2026-10-13-unmetered-usage-settlement §A): the grant is the bound Orca reserved
  for the call, so the charge never exceeds what was already set aside. The lower bound (D3) is shown, not charged.
  *Rejected:* charging the lower bound (undercounts by construction — the stalled message's own tokens are missing);
  an automatic settlement (the human chose a person exit; a later ruling can add an opt-in).
- **D3 — ccloop reports the lower bound in the record, never as usage.** It stays outside `cumulative`; Orca copies
  it into the settlement marker and the view ("at least N tokens observed").
- **D4 — Name the stall.** omp's own stream watchdog is the same event as ccloop's idle watchdog: classify it as
  failure cause `stalled` (an existing cause; no new name for Orca's panel to learn). The call is not retried inside
  ccloop (single-call callers own retries); Orca's normal retry follows once usage is settled (§5.2).
- **D5 — One verb for every single-call purpose.** The block is shared, so the exit is too.

## 3. Measurement first (M0, zero cost)

The tester's evidence (`events.jsonl` of `run-645bdef3…`) is not on this machine. Before C1/C2 are coded, record the
real shape with omp 18.10.1 against a local fake upstream (no provider, no cost): an OpenAI-compatible SSE endpoint that
sends a few deltas and then goes silent, with `PI_STREAM_IDLE_TIMEOUT_MS` small; omp's agent dir and config in a temp
directory (never the person's `~/.omp`); `HTTP_PROXY`/`HTTPS_PROXY` unset or `NO_PROXY=127.0.0.1` (omp sends
127.0.0.1 through the proxy otherwise). Record: exit code, the final `message_end`/`agent_end` lines, where the error
text sits (`errorMessage`, `stopReason`), and whether the errored message carries `usage`. Two scenarios: stall after
some deltas; stall before the first event ("timed out while waiting for the first event"). Store the transcripts as
ccloop fixtures. **If the shape differs from what C1 assumes, C1 follows the measurement and this section gets a
named correction.**

### 3.1 M0 result (2026-10-27, session `3cd8fb02`; write-up and raw transcripts `/private/tmp/orca-3cd8fb02/m0/RESULT.md`)

omp 18.10.1, openai-completions provider at a local fake upstream, `PI_STREAM_IDLE_TIMEOUT_MS=3000`,
`PI_STREAM_FIRST_EVENT_TIMEOUT_MS=3000`, ccloop's single-call argv and `OMP_SINGLE_CALL_OVERLAY`; `~/.omp/agent`
hashes identical before and after.
- A (deltas, then silence): exit 1, one request. B (headers, then silence): exit 1, **two requests even with the
  overlay** (the second ~3.5 s after the first; its source in omp was not found). Clean control C: exit 0, one request.
  stderr empty in all runs. No `error` event and no `auto_retry_*` line with the overlay.
- The error is on the (only) assistant `message_end`: `message.stopReason: "error"`, `message.errorMessage` =
  `"OpenAI completions stream stalled while waiting for the next event"` (A) or `"… timed out while waiting for the
  first event"` (B); repeated in `turn_end.message` and `agent_end.messages[-1]`. omp's `dist/cli.js` prefixes:
  Anthropic, OpenAI completions, OpenAI responses, Azure OpenAI responses, OpenAI Codex SSE, Provider, pi-native, plus
  "Cloud Code Assist … first event" — all match C1's pattern.
- The errored message's `usage` is **present and all zeros** when the provider sent no usage chunk (the usual case);
  it equals the provider's numbers when a usage chunk arrived before the stall. No earlier assistant `message_end`.
- Without the overlay omp retries (A: 4 requests; B: still retrying at 90 s) — the overlay matters.

Consequences (they replace the matching parts of §4): C1 reads the last assistant `message_end`'s `stopReason ===
"error"` and `errorMessage`; `workObserved` is false for "timed out while waiting for the first event", true for
"stalled while waiting for the next event". C2's sum includes the errored message's usage, and zeros are "nothing
observed", never "0 spent": the key is absent unless the sum is positive — so in the common case there is no lower
bound, and B's two requests are a further reason D1 never books 0.

## 4. ccloop

### C1 — classify omp's stream watchdog as `stalled`

In the omp single-call failure path (`src/runtime/omp/ompAdapter.ts` `singleCall`, `exit-error` branch) and the phase
fold's classification: an `exit-error` whose last assistant message's error text matches omp's watchdog wording
(`/stream (stalled|timed out) while waiting for the (next|first) event/`, wording from omp's `dist/cli.js`, both the
Anthropic and OpenAI providers) gets `failureCause: { cause: "stalled", workObserved: <first-event ⇒ false, else true>,
detail: <the matched provider prefix, ≤64 B>, retries: 0 }`. Anything else keeps today's classification. The phase
path's existing retry policy for `stalled` applies there unchanged.

### C2 — the lower bound in the single-call record

`ccloop-single-call-record-v1` gains an optional `usageLowerBound: { tokens: <safe integer > 0> }`, present only when
the outcome is not `complete` and the sum of completed assistant messages read from the stream is positive (the value
already written to `usage-lower-bound.json`). Absent otherwise ⇒ every existing record is byte-identical. It never
changes `observedTokens`, booking, or `unknown`.

## 5. Orca

### O1 — accept the record key

`singleCallRecordSchema` (`src/control/executionDriver.ts`) accepts the optional `usageLowerBound` (strict otherwise).
The blocked run keeps it (`run.usageLowerBound`) so the view and the marker can read it. **This lands before ccloop
emits the key** (the schema is strict).

### O2 — verb `settle-call-usage`

Web-only, authenticated owner (as `settle-unknown-usage`). Payload `{ groupId, runId, acknowledge: "charge-remaining-grant" }`.
Admissible only when: the run is a single-call run of that group, `active=1`, `state === "blocked"`, `drive.blockedAt
=== "C"`, its blocked reason starts with the purpose's `usageUnknownReason`, `unknown.work` is true, no usage event is
above `highWater`, no stop intent, group not archived. Otherwise `run-usage-not-settleable` with a detail naming the
failed condition.

Effect, in one transaction:
1. Charge `remaining.work` into `cumulative.work`; `remaining.work` = 0; `unknown.work` = false; group `used` +=
   charge, `reserved` -= charge; book the usage event (`bookSettledUsage`); write the marker
   `{ method: "remaining-grant", commandId, principal, at, groupId, runId, charged, usageLowerBound|null, blockedReason }`
   on the run.
2. Lift the block (`state` back to `accepted`, `drive.blockedAt`/`blockedReason` removed — the state `stepCSingleCall`
   left it in before `blockRun`), then run the purpose's `complete(…, failure)` with the same `commitTerminal` the
   driver passes (`accepted` ⇒ `settled-restartable`) and the failure code stored in the blocked reason (the part after
   `:`), so the call is recorded as `failed` and the purpose's own retry rule applies (clarify / split: up to
   `MAX_AUTO_RETRIES`, not after a pre-spawn refusal; estimate and flow: their existing rules). Shared with the driver
   as one function, not a copy.
3. Activity row `call-usage-settled`.

If (2) refuses (the round or draft moved meanwhile), the transaction rolls back and the verb returns that refusal;
nothing is charged.

### O3 — Web

Where the call is shown (requirement round / draft, estimate row, flow call): a blocked call with unknown usage says
what happened in one line ("The call to <agent> stopped without reporting its usage (stalled)."), the lower bound when
present ("at least N tokens observed"), and one button "Charge the call's grant (G tokens) and retry" with a confirm
naming G. The Overview queue item for `requirement-usage-unknown` links there. en / zh strings.

### O4 — next-step text

`requirement-usage-unknown` / `estimate-usage-unknown` / `flow-call-usage-unknown` gain the next-step text "settle
the call's usage, then it retries", replacing the current dead end.

## 6. Criteria (each named mutation must be seen red)

ccloop: C1 — the two M0 fixtures classify `stalled` with the right `workObserved`; an unrelated `exit-error` keeps
its class (mutation: drop the regex ⇒ red; widen it to any error ⇒ the unrelated case red). C2 — record carries the
bound on a failed call with completed messages, omits it on success and on a failure with none (mutations: always
emit; emit on success).
Orca: O1 — a record with the key parses, one with an extra unknown key still fails. O2 — happy path on a clarify
call: charge equals the grant remainder, group ledger clears, round gets a `failed` call and a queued retry (mutation:
skip the `complete` re-run ⇒ round stays drafting, red); each admission condition refused by name (one mutation per
guard, Rule 9 — a guard shadowed by another is registered as redundant, not given a fake criterion); not-owner refused;
rollback when the round moved (nothing charged). Estimate and flow purposes: one happy path each. O3 — the button
appears only for that state and sends the verb with the run id. No existing criterion is expected to change; if one
must, it is named in the commit (human blanket approval of this round does not exist yet — ask).

## 7. Order

1. M0 (free) → fixtures.
2. Orca O1 (accept the optional key) — can merge alone; nothing emits it yet.
3. ccloop C1 + C2 on a branch, gate, merge to ccloop main. **Push is the human's.**
4. Orca O2–O4 (independent of the ccloop push; works with unknown usage today, the lower bound line just stays empty).
5. After the human pushes ccloop: repin, so C1/C2 reach Orca.

## 8. Residuals accepted

- The charge is the grant, so a stalled call usually books more than it cost; the lower bound is on the record for
  anyone reconciling later.
- omp provider errors other than the stream watchdog stay `unknown` (no samples).
- A call blocked before this change ships is settled by the same verb (the state is the same); no migration.
