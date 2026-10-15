# Show ccloop's own error codes in the panel (feedback #58 Orca half, omp single-call spec §8)

Status: draft for human review (Orca session 026d10e3, 2026-10-15, on `main` at `Merge branch 'ui/panel-taste'`).
Line numbers below were read at that commit; re-measure before citing.

## 1. Why

When ccloop fails, the operator sees a code that names Orca's plumbing, not the cause:

- Every HTTP command or read that fails with `control-peer-exit` reaches the browser as
  **500 `control-internal-error`** with the fixed message "The control read could not be completed."
  (`src/panel/controlErrors.ts:73-94` maps every non-durable code that way; `control-peer-exit` is `transient`,
  `src/control/errors.ts:251`). Both ccloop's code and its detail are gone. This is the shape #58 reported for OMP
  model resolution (`omp-model-catalog-unavailable`).
- Where Orca reduces a failure to a code it stores `"control-peer-exit"` (profile probe `probeFailureCode`,
  `src/control/profiles.ts:135-137`; agent-update `installationFailure`, `src/control/webService.ts:675,682`;
  selection preview `unavailable` slots, `src/control/agentFreeze.ts:112-136`, `src/panel/controlViews.ts:1184-1193`;
  saved-result eligibility, `src/control/savedResultRecovery.ts:95-105`). The estimator then shows
  `agent-selection-rejected:estimator:control-peer-exit`.
- ccloop's single-call record carries `errorCode` (`src/control/executionDriver.ts:649`); Orca parses it and never reads
  it. A failed call becomes `estimate-call-failed`, clarify `no-output`, split a zod schema message — so
  `omp-single-call-cap-exceeded` and `omp-single-call-unavailable` are invisible (spec 2026-10-14 omp single-call §8).
- There is no en or zh entry for `control-peer-exit` at all.

## 2. Human rulings this spec implements (2026-10-15, this session)

1. Scope: this spec covers (A) ccloop process failures and (B) single-call `errorCode`. The OMP model drop-down and the
   spawn-time catalog probe residual are a separate round (needs a new ccloop command and a repin).
2. Presentation: always show ccloop's code and its (truncated) detail; known codes get en and zh explanations; an
   unknown code is shown as code + detail, never dropped.
3. A clarify / split call refused for its frozen output bound: shown by name with a hint, **not** retried automatically;
   a human retry recomputes that requirement's bound from the current catalog.

## 3. Non-goals

- Paths that turn a ccloop failure into "unknown" and retry (bare `catch` in inspect, handoff delivery, saved-result
  evidence, the model-assisted handoff probe, legacy `dispatch.ts`; survey rows 2, 4, 5, 8, 9, 12, 32, 33). Their
  control flow (count, then block by a named reason) stays; they gain only a stderr log line (§4.6).
- The CLI (`orca agents show` already prints ccloop's message verbatim).
- Translating ccloop's free-text detail. Detail is shown as sent.
- Any change to ccloop.

## 4. Design

### 4.1 One parser for a peer failure

`src/control/ccloopPort.ts` gains `peerFailure(error)`: for a `ControlError("control-peer-exit", "<exit>:<stderr>")` it
returns `{ code, detail }` where `code` is ccloop's leading code (the existing `peerErrorCode` regex) or `null`, and
`detail` is the stderr after `<code>:` (or the whole stderr when there is no code), trimmed, control characters
replaced, and cut to 512 UTF-16 code units with a trailing `…`. `peerErrorCode` stays and is defined through it.
`control-peer-timeout` and `control-response-too-large` are not peer exits and are unchanged.

`peerCode(error)` = `peerFailure(error).code ?? "control-peer-exit"` for a peer exit, else the `ControlError`'s own code.
Every site in §4.3 that today writes the literal `"control-peer-exit"` or `error.code` of a peer exit uses `peerCode`.

### 4.2 HTTP: a peer exit is a named refusal, not an internal error

`sendMappedControlError` maps `control-peer-exit` to **502** with code `ccloop-failed` and message
`ccloop-failed:<ccloop code or "unknown">: <detail>`; `retryable: true`; nothing booked (it is still transient, so
`domainErrorOutcome` still books nothing — `src/control/commandLedger.ts:198-205`). `control-peer-timeout` maps to 504
`ccloop-timeout`. Both codes join the panel-only catalog (`src/panel/controlErrors.ts:34-39`) so the web's catalog read
lists them. The error body schema (`src/control/webProtocol.ts:1520-1523`) is unchanged.

Security note: the detail is ccloop's stderr tail (ccloop already truncates OMP stderr). The panel requires login; members
see it too. ccloop does not print credentials there today; the 512-unit cut bounds what any future print could leak.

### 4.3 Stored codes keep ccloop's code

Sites that store a code (no detail slot) store `peerCode(error)` instead of `"control-peer-exit"`:
profile probe `probeFailureCode` (`profiles.ts:135-137`) and everything derived from it (estimator slot
`agent-selection-rejected:estimator:<code>`, requirement open, estimate claim, work claim — survey rows 13-18);
selection preview `unavailable` slots (`agentFreeze.ts:126-131`, `controlViews.ts:1184-1193`); agent-update
`installationFailure` and `reconcileFailure` (`webService.ts:675,682`; a non-`ControlError` there becomes
`control-internal-error`, not a false `control-peer-exit`); saved-result `unavailable` reason (`savedResultRecovery.ts:95-105`).
Code that compares a stored value against `"control-peer-exit"` or the named refusals is re-checked in the plan
(`service.ts:91-95` compares against `control-port-unconfigured` only — measure, do not assume).

Confirm-time rethrows (`webService.ts:756-763, 778, 793, 824`) need no change: they reach §4.2 and become `ccloop-failed`.

### 4.4 Blocked-run reasons explain ccloop's code

Reasons already stored verbatim as `control-peer-exit:<exit>:<stderr>` (round catch, survey rows 3, 6, 10, 11) and
`accept-refused:<exit>:<code>…` keep their stored form (no migration). The web's `explainRunReason`
(`web/src/refusalExplain.ts:39-43`) gains one rule: for prefix `control-peer-exit` or `accept-refused`, parse
`<exit>:<code>[: detail]`; if the ccloop code has an entry (§4.7) show it, else show the generic peer text with code
and detail. `control-peer-exit` joins `VIEW_REASONS`.

### 4.5 Single-call failures carry the record's `errorCode`

`stepCSingleCall` passes `record.errorCode` to the purpose handler (`handler.evaluate` and `handler.complete`,
`src/control/singleCallPurposes.ts:25-37`); `rawOutput` is unchanged, so receipts and the estimate replay hash
(`webService.ts:1115-1120`) are unchanged.

- Estimate: a failed call's `reasonCode` is `estimate-call-failed:<errorCode>` when `errorCode` is non-null, else
  `estimate-call-failed` (`reasonCode` is a free string for `failed`, `src/control/queries.ts:311-314`).
- Clarify: the call is recorded `outcome: "failed"` (already allowed, `src/control/requirementSchemas.ts:37-40`) with
  reason `<errorCode>`; `lastInvalidReason` becomes `no-output:<errorCode>`.
- Split: the draft's reasons are `call-failed:<errorCode>` instead of the zod message for `null`.
- Usage unknown (null tokens; `executionDriver.ts:706`): the blocked reason becomes
  `<usageUnknownReason>:<errorCode>` when `errorCode` is non-null, so §4.4 explains it.
- **No automatic retry for a pre-spawn refusal**: when `errorCode` is `omp-single-call-cap-exceeded` or
  `omp-single-call-unavailable`, clarify and split skip the automatic re-queue (`requirementCalls.ts:202`, `:303`) and
  fail the requirement at once with `reasonCode` `clarify-output-invalid` / `split-output-invalid` and the call's reason
  naming the code (the same envelope would be refused again; each refusal books 0). Ruling 3.
- The web shows the latest failed call's reason on a failed requirement (today `lastInvalidReason` and `calls[].reason`
  are typed but not rendered, `web/src/controlTypes.ts:111`, `RequirementsPanel.tsx:259,296`), explained by §4.7.

### 4.6 Human retry recomputes the bound

`recovery-retry` with `scope: "group"` on a requirement in `failed` or `interrupted` (`stopIntent.ts:440-466`,
`retryRequirementInTransaction` `:525-560`) gets a pre-transaction step in `WebControlService` (the shape
`applyRequirementOpen` already uses, `requirementCommands.ts:63-76`): resolve the estimator slot, compute
`singleCallOutputBound(preflight.maxOutputTokens, resolution)` (`estimator.ts:61-63`), and pass it into the transaction,
which stores it as the requirement's `maxOutputTokens` before re-queueing. A probe failure refuses the retry with the
code from §4.1 (via §4.2 for a peer exit) and changes nothing. `scope: "run"` retries reuse the stored envelope
byte-for-byte (unchanged). Automatic retries keep the frozen bound.

### 4.8 Log line for the paths left as "unknown"

Every peer failure that §3 leaves as "unknown" writes one stderr line `orca-driver: <runId>: ccloop <code>: <detail>`
(code and detail from §4.1), so `orca panel logs` names it. Control flow on those paths is unchanged.

### 4.7 Locale tables

`web/src/locales/{en,zh}.ts` gain entries for `ccloop-failed`, `ccloop-timeout`, `control-peer-exit` (run reason), and a
`ccloopErrors` table keyed by ccloop code for the codes an operator can act on: `omp-model-catalog-unavailable`,
`omp-model-catalog-invalid`, `omp-single-call-cap-exceeded`, `omp-single-call-unavailable`, `agent-config-invalid`,
`single-call-unsupported`, `single-call-output-invalid`, and the existing named refusals reused by key. Each entry may
interpolate only `{{detail}}`. An unknown code renders as `<code>: <detail>` under the generic text.
`tests/panel/refusalCoverage.test.ts` gets a `CCLOOP_CODES` list held to both languages, like `VIEW_REASONS`.

## 5. Criteria (each must be seen red by a named mutation before it counts)

1. HTTP: a command whose ccloop exits `2:omp-model-catalog-unavailable: spawn ENOENT` answers 502 `ccloop-failed`
   with that code and detail; a ccloop exit with no parseable code answers `ccloop-failed:unknown`. Mutation: drop the
   new branch in `sendMappedControlError` → 500.
2. `peerFailure` cuts detail at 512 units and strips control characters (literal expected strings).
3. Each §4.3 site stores the ccloop code (one criterion per site family; mutation: restore the literal).
4. `explainRunReason` explains `control-peer-exit:1:omp-model-catalog-unavailable: …` by the ccloop entry and an
   unknown code verbatim, in both languages.
5. Single call: a failed record with `errorCode: "omp-single-call-cap-exceeded"` yields
   `estimate-call-failed:omp-single-call-cap-exceeded`; clarify fails at once with the call reason naming it and no
   re-queue; split likewise; usage-unknown appends the code. Mutation per purpose.
6. Human retry after a cap refusal stores the recomputed bound; a probe failure refuses and leaves the requirement
   byte-identical.
7. Coverage: every `CCLOOP_CODES` code has en and zh entries.

**Existing criteria this rewrites (named for the human):** `tests/panel/agentSelectionApi.test.ts:240-265` and
`tests/panel/controlChannel.test.ts:11-26` (pin 500 `control-internal-error` for a peer exit);
`tests/control/estimateOutcome.test.ts:14-24` and `tests/control/driverEstimate.test.ts:16-31, 135-145` only if their
fixtures carry a non-null `errorCode` (the harnesses set `single-call-output-invalid`,
`tests/control/fixtures/estimateHarness.ts:60`, `requirementHarness.ts:68`) — re-measure;
`tests/control/driverRequirementSplit.test.ts:53-60` (expects `outcome: "invalid"` for a failed call).

## 6. Test running

Targeted files while implementing; one full gate before merge (`npm run verify`, `ORCA_CCLOOP_BIN` set to a ccloop build
clone — the scheduler suites require it).
