# OMP single-call: declared-cap execution and catalog context window

Orca session `7ea088aa`, 2026-10-14. Follows `2026-10-14-omp-single-call-options.md` (the research note; its text stays
as written). Touches ccloop (the omp descriptor, catalog reader, adapter and the resolution answer) and Orca (the
resolution schema and the estimate's request-size check).

## 1. Rulings (human, 2026-10-14, this session)

1. omp serves single-call (estimate, clarify, split). The human first chose option B (loopback metering proxy), then,
   asked why omp must be metered on the wire and told that many operators' omp configurations reach providers directly
   over https (a forward proxy that refuses `CONNECT` fails all of them), chose **option A with Orca booking the
   catalog cap**: the same static bar claude meets today (argv and configuration, not the wire), with usage taken from
   omp's own events.
2. omp's `contextWindowTokens` is the **catalog's declared `contextWindow`** for the selected model (`omp models
   --json`). This is a declared value, not a verified mapping; it is a different bar from claude's (claude reports
   1 000 000 only for the `[1m]` selection Task 0 verified, and null for `agent-default`).
3. Provider wire formats: no proxy is built, so no wire-format scope applies. (The human's earlier answer "add
   openai-completions" was for the proxy and lapses with it.)

## 2. Why omp needs a bound, not a meter

Orca's single-call contract (`2026-09-27-single-call-estimate-design.md` §4.4) asks a kind to cap output tokens and turn
tools off. The estimate checks `inputTokens + maxOutputTokens` against the context window and `ESTIMATE_GRANT.tokens`
before it queues the call (`src/control/estimator.ts`, `buildBudgetEstimateRequest`), assuming one provider request.
Usage itself is already observed: omp's `--mode json` prints input/output/cache usage on every assistant `message_end`,
which worker phases already book (ccloop `decodeOmpPhase`).

omp cannot set a per-call output cap: pi-ai sends `max_tokens = min(model.maxTokens ?? 64000, …)` for
`anthropic-messages` models (research note, measured against a fake server), i.e. the catalog's `maxTokens`. So the
bound omp can honour is the catalog's, and Orca must check the request size with that bound when it is the larger one.

Retries (research note): session auto-retry re-spends output and is switched off by a `--config` overlay;
provider-level retries (`PROVIDER_MAX_RETRIES = 10`) cannot be switched off but run only before the first token, so they
cannot re-spend output (they may re-bill input; inferred, not measured). This residual is accepted and recorded here.

## 3. ccloop

### 3.1 Catalog row
`readOmpModels` keeps its contract (exact selectors). A sibling reads the selected row's `contextWindow` and
`maxTokens`; each is used only when it is a positive safe integer, else treated as absent. `resolveAgent` already
probes the catalog for omp; it now also takes these two numbers from the selected row. No second probe is added.

### 3.2 Resolution answer
- `capabilities.contextWindowTokens` for omp = the row's `contextWindow`, or null when absent.
- New resolution field `singleCallOutputCap: number | null`, beside `singleCallExecution` (never in the seven-key
  view, never frozen): for omp the row's `maxTokens` (null when absent); for claude and codex null, meaning "the call
  honours the request's `maxOutputTokens`".
- omp's `singleCallExecution` answers `"v1"` only when the row has a `maxTokens`; with no declared cap it stays null
  (§4.4 needs a cap).

### 3.3 The call
`OmpAdapter.singleCall` reuses `runOmpPhase`'s process handling (detached group, registration before the prompt is
written, timeout and abort, output limit, evidence directory) with a single-call argv:

`--profile <p> --no-extensions --no-skills --no-tools --no-session --no-title --no-prewalk --model <m> --mode json -p
--system-prompt <file> --cwd <the run's empty private cwd> --config <overlay>`

- The system prompt says: answer with one JSON object that satisfies the given JSON schema, nothing else; it embeds
  `responseSchema`.
- The overlay switches off session auto-retry and model fallback. Its exact keys are confirmed in Task 0 of the plan
  against a local fake server with a scratch HOME (zero cost). If they cannot be confirmed, omp keeps answering null.
- Decode (fail closed, usage still booked from what was observed): exactly one assistant `message_end`; no
  `tool_execution_*` event; `stopReason` is `"stop"`. A `"length"` stop is a truncated answer:
  `SingleCallOutputInvalid` with its usage. More than one assistant message is `omp-single-call-multiple-requests`.
- Output: the JSON object extracted from the final message (the existing final-message scanner). ccloop guarantees only
  "an object"; Orca validates the shape for each purpose as it already does (`classifyEstimateOutput`, the requirement
  output schemas). Unlike claude, there is no `--json-schema` enforcement inside the agent.
- Usage: from the assistant `message_end.usage`, with the per-model breakdown. An aborted or timed-out call books null
  (unknown) and goes through the existing settlement path; `ompUsageLowerBound` stays diagnostic only.

## 4. Orca

- `ccloopPort`'s strict resolution schema accepts `singleCallOutputCap` (optional, nullable, positive safe integer).
  Orca must accept it before a pinned ccloop sends it; both land together through the repin.
- Estimate request size: `requiredRequestTokens = inputTokens + max(preflight.maxOutputTokens, singleCallOutputCap ??
  0)`. The `input-too-large` rule (context window, `ESTIMATE_GRANT.tokens`) is unchanged. The execution contract still
  records the requested `maxOutputTokens`; no persisted schema changes.
- If the selection's cap rises between queueing and the claim so that the request no longer fits, the claim refuses it
  as a capability degradation (`single-call-output-cap-raised`), like the other degradation reasons.
- A model whose catalog cap alone exceeds `ESTIMATE_GRANT.tokens` (250 000) is refused `input-too-large` for the
  estimate. The local catalog has such rows (largest `maxTokens` 524 288, measured with `omp models --json` on omp
  18.10.1, 2026-10-14); that refusal is the intended fail-closed answer.
- clarify / split: they run under `REQUIREMENT_CALL_GRANT.tokens` (1 000 000) and, today, size no request for any kind.
  With omp the output can reach the catalog cap (at most 524 288 in the local catalog), so a call exceeds the grant
  only when its input is above ~475 000 tokens. Not handled in this change; recorded as a residual.

## 5. Criteria (each must be seen red under its named mutation, in a `git clone --local` copy)

ccloop (extending `tests/fixtures/fake-omp.mjs`):
- single-call argv carries `--no-tools` and the overlay, and no `--tools` list — mutation: drop either;
- two assistant messages are refused — mutation: accept the last message;
- a tool event is refused — mutation: skip the tool check;
- a `"length"` stop is output-invalid with usage — mutation: treat it as complete;
- `contextWindowTokens` and `singleCallOutputCap` come from the selected row, and a row without `maxTokens` answers
  `singleCallExecution: null` — mutations: hard-code null, ignore the row.

Orca:
- a cap above the preflight value sizes the request by the cap; null or a smaller cap leaves today's numbers —
  mutation: drop the `max`;
- the resolution schema accepts the field and still refuses unknown keys — mutation: remove the field from the schema.

## 6. Not done / later

- No proxy and no wire proof; the provider-level pre-first-token retries remain (§2).
- A real-provider acceptance (one omp estimate through the operator's LiteLLM endpoint) is paid; it is asked for
  separately.
- Found while reading, not code: the operator's real `~/.orca/profile.json` declares `contextWindowTokens: null`, and
  Orca intersects the profile's declared window with the observed one (`intersectCapabilities`), so every estimator —
  any kind — is blocked `context-unavailable` until the profile declares a window. That is the operator's file to change.
