# Show ccloop's own error codes in the panel (feedback #58 Orca half, omp single-call spec §8)

Status: revised after an independent review (Orca session 026d10e3, 2026-10-15; drafted on `main` at
`Merge branch 'ui/panel-taste'`). Line numbers were read at that commit; re-measure before citing.

## 1. Why

When ccloop fails, the operator sees a code that names Orca's plumbing, not the cause:

- Every HTTP command or read that fails with `control-peer-exit` reaches the browser as **500
  `control-internal-error`** with the fixed message "The control read could not be completed."
  (`src/panel/controlErrors.ts:73-94` maps every non-durable code that way; `control-peer-exit` is `transient`,
  `src/control/errors.ts:251`). ccloop's code and detail are gone, and the web files the command as "uncertain"
  (`web/src/controlApi.ts:264` treats any status >= 500 that way). This is the shape #58 reported for OMP model
  resolution (`omp-model-catalog-unavailable`).
- Where Orca reduces a failure to a code it stores `"control-peer-exit"` (profile probe `probeFailureCode`,
  `src/control/profiles.ts:135-137`; agent-update `installationFailure` / `reconcileFailure`,
  `src/control/webService.ts:675,682`; selection preview `unavailable` slots, `src/control/agentFreeze.ts:112-136`,
  `src/panel/controlViews.ts:1184-1193`; saved-result eligibility, `src/control/savedResultRecovery.ts:95-105`). The
  estimator then shows `agent-selection-rejected:estimator:control-peer-exit`.
- ccloop's single-call record carries `errorCode` (`src/control/executionDriver.ts:649`); Orca parses it and never reads
  it. `omp-single-call-cap-exceeded` and `omp-single-call-unavailable` are invisible (omp single-call spec §8).
- Blocked-run reasons already store `control-peer-exit:<exit>:<stderr>` verbatim through `describeError`
  (`executionDriver.ts:124-126`, round catch `:1010`, `accept-refused` `:473`) — with the whole stderr (capped only by
  `MAX_OUTPUT`, 24 MiB, `ccloopPort.ts:18`) — and the web shows it raw (`web/src/RunReason.tsx:21-22`) with no
  explanation: there is no en or zh entry for `control-peer-exit`.

## 2. Human rulings this spec implements (2026-10-15, this session)

1. Scope: (A) ccloop process failures and (B) single-call `errorCode`. The OMP model drop-down and the spawn-time catalog
   probe residual are a separate round (new ccloop command plus a repin).
2. Presentation: always show ccloop's code and its (truncated) detail; known codes get en and zh explanations; an unknown
   code is shown as code + detail, never dropped.
3. A clarify / split call refused for its frozen output bound: shown by name with a hint, **not** retried automatically;
   a human retry recomputes that requirement's bound from the current catalog.

## 3. Non-goals

- Paths that turn a ccloop failure into "unknown" and retry (bare `catch` in inspect, handoff delivery, saved-result
  evidence, the model-assisted handoff probe, legacy `dispatch.ts`). Their control flow stays; they gain only a log
  line (§4.9).
- `control-peer-timeout` and `control-response-too-large` keep their current mapping.
- The CLI (`orca agents show` already prints ccloop's message verbatim). Translating ccloop's free-text detail.
- Any change to ccloop. Migrating reasons already stored.

## 4. Design

### 4.1 One parser for a peer failure

`src/control/ccloopPort.ts` gains `peerFailure(error)`. For a `ControlError("control-peer-exit", "<exit>:<stderr>")` it
returns `{ code, detail }`:

- `code`: ccloop's leading code, matched by `^[^:]*:([a-z][a-z0-9-]{0,63})(?=:|\s|$)` (the existing `peerErrorCode`
  regex, now anchored on the code's end so `1:file:///…` does not yield `file`), or `null`;
- `detail`: the stderr after `<code>:` (or all of it when there is no code), trimmed, every C0/C1 control character
  replaced by a space, cut to 512 UTF-16 code units with a trailing `…`.

`peerErrorCode` keeps its signature and is defined through `peerFailure`. `peerCode(error)` = `peerFailure(error).code ??
"control-peer-exit"` for a peer exit, else the `ControlError`'s own code.

### 4.2 HTTP: a peer exit is a definite, named failure

`sendMappedControlError` maps `control-peer-exit` to **424** with code `ccloop-failed` and message
`ccloop-failed:<ccloop code or "unknown">: <detail>`, `retryable: true`. Why 424: the web treats any status >= 500 as
"may not have committed" and recovers it by lookup (`web/src/controlApi.ts:264`, `App.tsx:464-468`), but a peer exit is
definite — every ccloop call that a command makes happens before its transaction or inside a savepoint that is rolled
back, and the code stays `transient`, so nothing is booked (`commandLedger.ts:198-205`). `ControlHttpStatus`
(`controlErrors.ts:7`) widens to include 424; `ccloop-failed` joins the panel-only catalog (`controlErrors.ts:10-22`) so
the web's catalog read lists it. The error body schema (`webProtocol.ts:1520-1523`) is unchanged.

### 4.3 Stored codes keep ccloop's code

Classification stays on `error.code`: `resolveGroupSelections` (`agentFreeze.ts:126-131`) and `rolePreview`
(`controlViews.ts:1186-1192`) still look up `error.code` in `nonDurableControlErrorClassifications` to choose
`unavailable` vs `rejected` and to rethrow in confirm mode. Only the **stored** code becomes `peerCode(error)`:

- profile probe `probeFailureCode` (`profiles.ts:135-137`) and everything derived from it — estimator slot
  `agent-selection-rejected:estimator:<code>`, requirement open, estimate claim, work claim;
- selection preview `unavailable` slots' `code`;
- agent-update `installationFailure` and `reconcileFailure` (`webService.ts:675,682`); a value that is not a
  `ControlError` there becomes `control-internal-error`, not a false `control-peer-exit`;
- saved-result `unavailable` reason (`savedResultRecovery.ts:95-105`).

Types widen accordingly: `ObservedProfile.probeFailureCode` and `probeFailureCode()` (`profiles.ts:25,135`),
`PreparedEstimatorSlot`'s rejected `code` and `rejectedEstimatorRequest` (`planImport.ts:41,147`) go from
`KnownControlErrorCode` to `string`. `service.ts:91-95` compares only against `control-port-unconfigured`, which ccloop
never prints, so it is unaffected.

Confirm-time rethrows (`webService.ts:756-763, 778, 793, 824`) need no change: they reach §4.2.

### 4.4 Stored run reasons are cut

`describeError` applies §4.1's cut to a peer exit: it stores `control-peer-exit:<exit>:<code>: <detail≤512>` instead of
the whole stderr. `accept-refused:${error.detail}` (`executionDriver.ts:473`) stores the same cut form. Reasons already
stored are not migrated (the web still renders them; see §4.6).

### 4.5 Single-call failures carry the record's `errorCode`

`stepCSingleCall` normalises the record's `errorCode`: the part before the first `:` (ccloop prints
`omp-single-call-stop:<reason>`), accepted only if it matches `^[a-z][a-z0-9-]{0,63}$`, else `unknown`; `null` stays
`null`. It passes the normalised code to the purpose handler (`handler.evaluate` and `handler.complete`,
`src/control/singleCallPurposes.ts:25-37`) as a new argument; `rawOutput` is unchanged, so receipts and the estimate
replay hash (`webService.ts:1115-1120`) are unchanged. "The call failed" means `record.outcome !== "complete"`.

- **Estimate**: a failed call's `reasonCode` is `estimate-call-failed:<code>` when the code is non-null, else
  `estimate-call-failed`. `classifyEstimateOutput` keeps its signature; the suffix is added by the caller
  (`completeEstimateInStore`). The literal union at `estimator.ts:143` gains the template form.
- **Clarify**: the call is recorded `outcome: "failed"` (already allowed, `requirementSchemas.ts:37-40`) with
  `reason: <code>`. `lastInvalidReason` stays `no-output`: it is quoted in the next automatic call's prompt
  (`requirementCalls.ts:254`, `requirementClarify.ts:130`) and the model gains nothing from ccloop's code.
- **Split**: the call is recorded `outcome: "failed"` with `reason: <code>`. The draft's state and `reasons` stay as today
  (the reasons are quoted in later split prompts, `requirementSplit.ts:24`, `requirementCalls.ts:315-318`).
- **Usage unknown** (null tokens; `executionDriver.ts:706`): the blocked reason becomes `<usageUnknownReason>:<code>` when
  the code is non-null. The existing prefix rule explains it (`refusalExplain.ts:39-43`); §4.6 adds the code's own text.
- **No automatic retry for a pre-spawn refusal**: when the code is `omp-single-call-cap-exceeded` or
  `omp-single-call-unavailable`, clarify and split skip the automatic re-queue (`requirementCalls.ts:202`, `:303`) and
  fail the requirement at once with `reasonCode` `clarify-output-invalid` / `split-output-invalid` (the same envelope
  would be refused again; ccloop books such a refusal as 0 tokens, `neverStarted`, so it does reach classification).
- The web shows the latest failed call's reason on a failed requirement (`RequirementsPanel.tsx:259,296`; today
  `calls[].reason` is typed but not rendered).

### 4.6 The web explains ccloop codes everywhere they are shown

A new `web/src/ccloopCodes.ts` exposes `explainCcloopCode(code, detail)`: the `ccloopErrors` entry for `code` with
`{{detail}}` filled, or the generic text "ccloop failed with `<code>`: `<detail>`". Every surface that shows a ccloop code
calls it:

| Surface | What it parses |
|---|---|
| `refusalText` / `explainRefusal` (`web/src/i18n.ts:136-141`, `refusalExplain.ts:32-36`) | `ccloop-failed:<code>: <detail>` |
| `explainRunReason` (`refusalExplain.ts:39-43`) | prefixes `control-peer-exit`, `accept-refused`: `<exit>:<code>[: detail]`; and `<usageUnknownReason>:<code>` |
| `AgentSelectionEditor.tsx:73` | the slot's `code` |
| `AgentSettings.tsx:118` | `failureCode` |
| `ControlGroupView.tsx:488` | estimate `reasonCode`: `agent-selection-rejected:estimator:<code>`, `estimate-call-failed:<code>` |
| `TaskDetail.tsx:307` | saved-result `reason` |
| `RequirementsPanel.tsx:259,296` | the failed call's `reason` |

Lookup order: a position that is known to hold a ccloop code looks in `ccloopErrors` first, then in the Orca error table
(so the named refusals shared by both, e.g. `agent-version-drift`, keep their existing Orca text); an unknown code uses
the generic text.

### 4.7 Locale tables

`web/src/locales/{en,zh}.ts` gain `ccloop-failed` and `control-peer-exit` (run reason) in the error table, and a
`ccloopErrors` table for the codes an operator can act on: `omp-model-catalog-unavailable`, `omp-model-catalog-invalid`,
`omp-single-call-cap-exceeded` (hint: the catalog's output cap changed since the requirement opened; retry recomputes it),
`omp-single-call-unavailable`, `agent-config-invalid`, `single-call-unsupported`, `single-call-output-invalid`. Each
entry may interpolate only `{{detail}}`. `tests/panel/refusalCoverage.test.ts` gets a `CCLOOP_CODES` list held to both
languages, as `VIEW_REASONS` is.

### 4.8 Human retry recomputes the bound

`recovery-retry` with `scope: "group"` on a requirement whose round or draft is `failed` or `interrupted`
(`stopIntent.ts:440-466`, `retryRequirementInTransaction` `:525-560`) gets a pre-transaction step in `WebControlService`:

- resolve the requirement's **frozen** `agentSlot` partial through the port (the selection its calls run, not today's
  preferences), and the preflight from `profileRouter.resolve("budget-estimate", <the requirement's profile id and
  hash>)`;
- compute `singleCallOutputBound(preflight.maxOutputTokens, resolution)` (`estimator.ts:61-63`);
- pass it into the transaction, which — after its existing state checks still find the round or draft `failed` /
  `interrupted` — stores it as the requirement's `maxOutputTokens` before re-queueing.

If the profile no longer resolves or the agent probe fails, the retry proceeds exactly as today with the frozen bound
(no new refusal, so retry's other effects — lifting a `handoff-complete` stop, re-arming an export conflict,
`stopIntent.ts:531-541` — are unchanged), and one log line names why. `recovery-retry` is allowed for any principal
(`humanOnly.ts:21`); "human retry" means any `recovery-retry`. `scope: "run"` retries reuse the stored envelope
(unchanged). Automatic retries keep the frozen bound.

### 4.9 Log line for the paths left as "unknown"

Every peer failure that §3 leaves as "unknown" writes one stderr line `orca-driver: <runId>: ccloop <code>: <detail>`
(§4.1), so `orca panel logs` names it. Control flow on those paths is unchanged.

## 5. Criteria (each must be seen red by a named mutation before it counts)

1. HTTP: a command whose ccloop exits `2:omp-model-catalog-unavailable: spawn ENOENT` answers 424 `ccloop-failed` with
   that code and detail; an exit with no parseable code answers `ccloop-failed:unknown: <stderr>`; the web files it as a
   refusal, not uncertain. Mutation: drop the branch → 500.
2. `peerFailure`: literal expected strings for the 512 cut, control-character replacement, and `1:file:///x` → code null.
3. Preview: a peer exit in a selection preview stays `kind: "unavailable"` and carries the ccloop code; confirm still
   rethrows it. Mutation: classify on `peerCode` → `rejected`.
4. Each §4.3 site family stores the ccloop code. Mutation per family: store `error.code` again.
5. `describeError` stores the cut form (a 2 KiB stderr → stored reason ≤ the cut). Mutation: drop the cut.
6. Single call: `errorCode: "omp-single-call-cap-exceeded"` → `estimate-call-failed:omp-single-call-cap-exceeded`;
   clarify / split call `outcome: "failed"`, `reason` the code, no re-queue, requirement failed; `lastInvalidReason`
   still `no-output`; usage-unknown appends the code; a hostile `errorCode` (`"x:y\n<script>"`) becomes `unknown`
   wherever it is stored. Mutation per purpose, and one for the normaliser.
7. Retry: after a cap refusal, a group retry stores the recomputed bound; with a failing probe the retry behaves exactly
   as before (requirement re-queued with the frozen bound). Mutation: skip the store; make the probe failure refuse.
8. Web: each §4.6 surface renders the ccloop entry for a known code and the generic text for an unknown one, in both
   languages. Coverage: every `CCLOOP_CODES` code has en and zh entries.

**Existing criteria this rewrites (named for the human):** `tests/panel/agentSelectionApi.test.ts:240-265` (500
`control-internal-error` for a peer exit → 424 `ccloop-failed`); `tests/control/driverEstimate.test.ts:27`, `:83-86`
(blocked as `estimate-usage-unknown` → `…:single-call-output-invalid`) and `:136`; `tests/control/
driverRequirementSplit.test.ts:57` (call `outcome: "invalid"` → `"failed"` with the code). The harnesses
(`tests/control/fixtures/estimateHarness.ts:60`, `requirementHarness.ts:68`) always set `errorCode:
"single-call-output-invalid"` for a failed call, so these are certain. `tests/control/estimateOutcome.test.ts` is
unaffected (the classifier's signature is unchanged). Stale but green (they model a shape the server no longer sends;
update to the new shape): `web/tests/agentPreviewRefresh.test.tsx:184,224,317,339`,
`web/tests/agentSelectionEditor.test.tsx:55,143`.

## 6. Test running

Targeted files while implementing; one full gate before merge (`npm run verify` with `ORCA_CCLOOP_BIN` set to a ccloop
build clone and `ORCA_AGENTS_TABLE` to a fake-only table — the scheduler suites need the former).

## Corrections found while planning (Orca session 026d10e3, 2026-10-15)

The implementation plan `docs/superpowers/plans/2026-10-15-error-codes-and-start-guard.md` lists, in its section "Spec corrections found while planning" (K1-K8), where this text disagrees with the code and what is built instead; its "Controller rulings before execution" (R1-R5) settle the open points. Where they differ, the plan's corrected behaviour is what ships; the text above is kept as drafted.
