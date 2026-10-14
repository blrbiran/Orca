# OMP single-call: catalog cap checked at spawn, catalog context window

Orca session `7ea088aa`, 2026-10-14. Follows `2026-10-14-omp-single-call-options.md` (the research note; its text stays
as written). Touches ccloop (catalog reader, resolution, accept, the omp adapter) and Orca (the resolution schema and how
the estimate sizes its request). Revised after an independent review in the same session (findings B1-B2, M1-M6,
m1-m8 of that review are folded in below).

## 1. Rulings (human, 2026-10-14, this session)

1. omp serves single-call (estimate, clarify, split). The human first chose option B (loopback metering proxy), then,
   told that usage is already in omp's own events and that many operators' omp configurations reach providers directly
   over https (a forward proxy refusing `CONNECT` fails all of them), chose **option A with Orca booking the catalog
   cap**: the static bar claude meets today (argv and configuration, not the wire); usage from omp's events.
2. omp's `contextWindowTokens` and output cap come from the **catalog** (`omp models --json`, the selected row).
   Correction recorded: the question that obtained this ruling said the operator had configured the local row's 128000;
   that was wrong — `~/.omp/agent/models.yaml` declares neither number, and omp 18.10.1 fills defaults (128000 /
   16384) for every row, so the catalog cannot tell a declared value from omp's default. Re-asked with that fact, the
   human kept the ruling: trust the catalog, defaults included.
3. No proxy is built, so no provider wire-format scope applies.

## 2. Why omp needs a bound, not a meter

Orca's single-call contract (`2026-09-27-single-call-estimate-design.md` §4.4) asks a kind to cap output tokens and turn
tools off. The estimate checks `inputTokens + maxOutputTokens` against the context window and `ESTIMATE_GRANT.tokens`
(250 000) before it queues the call (`src/control/estimator.ts`, `buildBudgetEstimateRequest`), assuming one provider
request. Usage is already observed: omp's `--mode json` prints input/output/cache usage on every assistant `message_end`.

omp cannot set a per-call cap. pi-ai sends `options.maxTokens ?? model.maxTokens`, clamped for openai-* apis to
`min(requested, model.maxTokens, 64000)`, so the catalog `maxTokens` is the bound **when pi-ai sends a cap at all**.
It sends none when the model sets `omitMaxOutputTokens`, or for an OpenRouter host with no explicit cap; neither is
visible in `omp models --json` (keys: contextWindow, cost, id, input, kind, maxTokens, name, pricingStatus, provider,
reasoning, selector, thinking). Residual, see §6.

Retries: session auto-retry re-spends output and is switched off by the overlay (§3.3); provider-level retries
(`PROVIDER_MAX_RETRIES = 10`) cannot be switched off but run only before the first token (may re-bill input; inferred).

## 3. ccloop

### 3.1 One catalog read, rows not selectors
The catalog reader returns rows (`selector`, `contextWindow`, `maxTokens`, `provider`) from its one spawn; the existing
selector-list callers keep their behaviour. A number is used only when it is a positive safe integer.

### 3.2 The resolution decides; capabilities and accept use it (the worker re-checks at spawn, §3.3.1)
`resolveAgent` already reads the catalog for omp. From the selected row it now produces, in the resolution:
- `capabilities.contextWindowTokens`: the row's `contextWindow`, else null;
- `singleCallExecution`: `"v1"` only when the row has a `maxTokens` and its provider is not `openrouter`, else null;
- `singleCallOutputCap` (new, beside `singleCallExecution`, never in the seven-key view, never frozen): the row's
  `maxTokens` for omp; null for claude and codex, meaning "the call honours the request's `maxOutputTokens`".

The descriptor methods take the row (`undefined` for kinds without a catalog). The two places that recompute
`singleCallExecution` from the config alone — the capabilities answer (`src/control/command.ts`) and accept's refusal
(`src/control/accept.ts`) — use the resolution's value instead. ccloop's own strict capabilities answer schema gains
`singleCallOutputCap`.

### 3.3 The call
`OmpAdapter.singleCall`. `runOmpPhase`'s process handling (detached group, registration before the prompt is written,
abort, output limit, evidence directory) is parameterised so a single call uses the request's `cwd`, `runDir`, and a
timeout of `min(request.timeoutMs, installation.timeoutMs)`, and passes no `--tools` list.

1. **Spawn-time check.** Re-read the catalog row immediately before spawning. Run only when the row exists,
   `singleCallExecution` would still be `"v1"`, and `0 < row.maxTokens <= request.maxOutputTokens`. Otherwise refuse
   with `omp-single-call-cap-exceeded` (or `-unavailable`), `neverStarted` (books 0 — nothing was sent).
2. **argv**: `--profile <p> --no-extensions --no-skills --no-rules --no-lsp --no-tools --no-session --no-title
   --no-prewalk --model <m> --mode json -p --system-prompt <file> --cwd <request.cwd> --config <overlay>`.
3. **Overlay** switches off session auto-retry, model fallback, the loop guard, the advisor and auto-compaction. Exact
   keys are confirmed in plan Task 0 against a local fake server (zero cost), applied **on top of the operator's real
   `config.yml`**, showing exactly one model POST. If any cannot be confirmed, omp answers `singleCallExecution: null`.
4. **System prompt**: answer with one JSON object satisfying the embedded `responseSchema`, nothing else. Task 0
   measures the request body the fake server receives against Orca's prompt bytes; the operator's
   `framingTokenOverhead` must cover the difference (recorded in the plan with the measured number).
5. **Decode** (fail closed; observed usage still booked):
   - exactly one assistant `message_end`; more is `omp-single-call-multiple-requests`;
   - no `tool_execution_*`, `extension_ui_request` or `*subagent*` event (`omp-phase-tool-forbidden`, as the phase
     decoder refuses them);
   - the message's `provider/model` equals the selection (`omp-model-mismatch`, as `decodeOmpPhase` does);
   - `stopReason`: `"stop"` decodes; `"length"` is a truncated answer → `SingleCallOutputInvalid`; any other
     (`"error"`, `"toolUse"`, `"aborted"`, …) is `omp-single-call-stop:<reason>`.
6. **Output rule** (not the codex scanner, whose whole-JSON path returns any JSON value and whose key-based path cannot
   express "any object"): the final text, trimmed, with at most one surrounding fenced block removed, must
   `JSON.parse` to a plain non-array object; anything else is `SingleCallOutputInvalid`. Orca validates the object's
   shape per purpose as it already does.
7. **Usage**: the assistant message's `usage`, with the per-model breakdown; output-invalid and decode failures book
   that observed total. A process that exits non-zero or is aborted or times out books null (unknown → existing
   settlement path), even after a complete `message_end` — conservative, intended. `ompUsageLowerBound` stays diagnostic.

## 4. Orca

- `ccloopPort`'s strict resolution schema and the `AgentResolution` type accept `singleCallOutputCap` (optional,
  nullable, positive safe integer); it is kept out of the frozen slot like `singleCallExecution`.
- **Sizing**: Orca uses `bound = max(preflight.maxOutputTokens, singleCallOutputCap ?? 0)` as the `maxOutputTokens`
  it writes into the estimate execution contract and the single-call envelope (the value changes; no schema changes),
  and `requiredRequestTokens = inputTokens + bound`. The `input-too-large` rule is unchanged, so a row whose cap alone
  exceeds 250 000 is refused for the estimate (the local catalog has 22 such rows; largest 524 288 — measured with
  `omp models --json`, omp 18.10.1, 2026-10-14).
- Because ccloop re-checks `row.maxTokens <= request.maxOutputTokens` at spawn (§3.3.1), a cap raised between queueing
  and spawn is refused there; Orca needs no claim-time recompute.
- clarify / split send the same `bound` as their `maxOutputTokens`. They run under `REQUIREMENT_CALL_GRANT.tokens`
  (1 000 000) and size no request today for any kind; with the largest local cap a call exceeds the grant only when its
  input is above ~475 000 tokens. Not handled here; residual.
- omp's `budgetEnforcement` is `"soft"` and its `requestBoundProof` null, so omp serves **soft** estimate mode only;
  strict stays blocked (`estimatorCompatibility`).

## 5. Criteria (each seen red under its named mutation, in a `git clone --local` copy)

ccloop (fake omp extended; `tests/fixtures/fake-omp.mjs`):
1. resolution takes `contextWindowTokens`, `singleCallOutputCap`, `singleCallExecution` from the row; no `maxTokens` or
   provider `openrouter` → null — mutations: ignore the row; drop the openrouter rule.
2. accept refuses an omp single call whose resolution says null — mutation: accept recomputes from the config.
3. spawn-time: `row.maxTokens > request.maxOutputTokens` refuses before spawning, books 0 — mutation: skip the check.
4. argv carries `--no-tools`, `--no-rules`, `--no-lsp`, the overlay, and no `--tools` — mutation: drop each.
5. two assistant messages refused; a tool event refused; a model mismatch refused — one mutation each.
6. `"length"` → output-invalid booking the observed usage; another stop reason → named failure — mutations: treat as
   complete; book null.
7. output rule: a whole-JSON array, a number, and prose around two objects are output-invalid; a fenced single object
   decodes — mutation: return the raw parse.

Orca:
8. a cap above the preflight value is written as the contract/envelope `maxOutputTokens` and sizes the request; null or
   a smaller cap leaves today's numbers — mutation: drop the `max`.
9. a cap of 250 001 with a tiny input is `input-too-large` — mutation: compare the input alone.
10. the resolution schema accepts the field, refuses 0 / negative / non-integer, still refuses unknown keys — mutation:
    remove the field.

## 6. Not done / residuals

- No proxy, no wire proof. Provider-level pre-first-token retries remain (§2).
- No cap is sent for `omitMaxOutputTokens` models or OpenRouter hosts; the first is invisible in the catalog, so such a
  model would run uncapped while Orca sized it by the catalog value. Only `openrouter` is refused by name.
- The catalog values for operator-added models are omp's defaults unless the operator declares them (§1.2).
- With the operator's preflight `maxOutputTokens` 64000 and the local row's 16384, the bound is 64000 and the spawn
  check passes; large estimates may still end `"length"` (the model stops at 16384) and be refused as output-invalid.
- clarify / split grant residual (§4).
- Real-provider acceptance (one omp estimate through the operator's LiteLLM endpoint) is paid and asked for separately.
- Not code: the operator's `~/.orca/profile.json` declares `contextWindowTokens: null`, and `intersectCapabilities`
  turns that into null, so every estimator of any kind is blocked `context-unavailable` until the profile declares a
  window. That file is the operator's to change.

## 7. Task 0 measurements (session 02f047f6, 2026-10-14; Orca commit 5bb51869, omp 18.10.1; raw logs were in /private/tmp/osc/t0, gone)

- Overlay (confirmed; `config get` under the real config.yml, by `PI_CONFIG_FILES` — `config get` ignores `--config`, it answered the
  same as no overlay for every key; the run itself honours `--config`, see the POST counts):
  `{"retry":{"enabled":false,"modelFallback":false},"model":{"loopGuard":{"enabled":false}},"advisor":{"enabled":false},"compaction":{"enabled":false}}`.
  Per key, none → overlay: retry.enabled true → false; retry.modelFallback true → false; model.loopGuard.enabled true → false;
  advisor.enabled false → false (already off in the operator's config); compaction.enabled true → false.
- Model POSTs (fake Anthropic server, ccloop's argv, `--config` overlay): ok+overlay 1 (rc 0, one assistant `message_end`,
  `stopReason` `stop`, provider `fake`, model `fake-model`, usage input 11 / output 5); drop-after-text+overlay 1 (rc 1, the
  assistant `message_end` has `stopReason` `error`); drop-after-text, no overlay 4. `max_tokens` sent: 1234 (catalog 1234).
  `tools`: `[]`.
- Request body 3098 B, prompt 28 B, overhead 3070 B (system 2652 B, of which ccloop's system prompt file is 1645 B with
  BUDGET_ESTIMATE_JSON_SCHEMA embedded) ⇒ ≤ 2047 tokens at 2/3; operator framingTokenOverhead 17 ⇒ does not cover.
  Orca's input count (`src/control/estimator.ts`, `buildBudgetEstimateRequest`) is the prompt bytes plus
  `framingTokenOverhead`; the system prompt is not in it. Finding for the operator (their `~/.orca/profile.json`), not code.
- contextPromotion.enabled under the real config: false.
- Commands: plan `docs/superpowers/plans/2026-10-14-omp-single-call.md` Task 0 Steps 4-7.

## 8. Residuals found during implementation (Orca session 02f047f6, 2026-10-14)

Appended after the final whole-branch review. Evidence is cited at Orca `f00d6910` (worktree `Orca-wt/omp-single-call`)
and ccloop `bd1ddc3` (branch `codex/omp-single-call`); sections 1-7 above are unchanged.

- **Release order.** ccloop from `c3d2759` on prints `singleCallOutputCap` in every resolution, for every kind
  (ccloop `src/agents/materialize.ts:140`, printed whole by `src/control/command.ts:258`; claude and codex answer null,
  `src/agents/claude.ts:78-80`, `src/agents/codex.ts:58-60`). Orca's resolution schema is `.strict()`, and before
  `d6bdc9b3` it had no such key (`git show d6bdc9b3^:src/control/ccloopPort.ts`, line 45), so such an Orca refuses every
  resolution from that ccloop. Orca `d6bdc9b3` (`src/control/ccloopPort.ts:47`) must therefore merge before, or together
  with, the ccloop repin, and no Orca checkout without it may point `ORCA_CCLOOP_BIN` at a ccloop that contains `c3d2759`.
- **The spawn-time catalog probe is outside the call's time limit and abort.** ccloop `src/runtime/omp/ompSingleCall.ts:38`
  reads the catalog (`readOmpCatalog`, bounded only by `PROBE_TIMEOUT_MS = 10_000`, `src/agents/ompModels.ts:5`, `:32`)
  before `runOmpProcess` gets `timeoutMs: min(request.timeoutMs, installation.timeoutMs)` and the abort signal
  (`ompSingleCall.ts:58-59`); the probe takes neither. The worker sets `request.timeoutMs` to
  `activeMs - SINGLE_CALL_ACTIVE_MARGIN_MS` (10 000; `src/control/singleCall.ts:47`, `:87`), so a probe that uses its whole
  10 s consumes the margin, and the call's elapsed time can exceed the run's `activeMs` grant by about `killGraceMs` plus
  reap latency (the final review's estimate: ~1 s). An abort during the probe waits for the probe; the call then never
  starts and books 0.
- **Clarify / split freeze the bound at requirement open.** Orca `src/control/requirementCommands.ts:98` stores
  `singleCallOutputBound(...)` as the requirement's `maxOutputTokens`, and every later clarify / split call sends that
  stored value (`src/control/requirementCalls.ts:246`). If the catalog cap rises later, ccloop refuses each later call of
  that requirement at spawn (`omp-single-call-cap-exceeded`, booked 0; ccloop `ompSingleCall.ts:42`) and nothing
  recomputes the stored bound. §4's "Orca needs no claim-time recompute" holds only for the estimate: each new estimate
  recomputes the bound from the current resolution (`src/control/estimator.ts:116`).
- **Cap refusals are not visible in Orca** (pre-existing behaviour, not introduced here). Orca parses ccloop's single-call
  record including `errorCode` (`src/control/executionDriver.ts:649`) but never reads it; a failed record leaves
  `rawOutput` null (`executionDriver.ts:688`), which the estimate classifies as `estimate-call-failed`
  (`src/control/estimator.ts:146`), clarify as invalid `no-output` (`src/control/requirementClarify.ts:80`), and split as
  schema-invalid (`src/control/requirementCalls.ts:270-276`). The operator does not see `omp-single-call-cap-exceeded` or
  `omp-single-call-unavailable` by name.
- **Environment, not this feature:** ccloop `tests/cli/cli.test.ts:77` "returns 0 for the example contract run" is slow
  (and can time out) when run from a git worktree of the main ccloop checkout: the attempt commit
  (ccloop `src/workspace/worktreeManager.ts:111-115`, `ATTEMPT_IDENTITY` at `:38`) runs that repository's
  `.git/hooks/post-commit`, which a `git clone --local` does not have. See
  `.superpowers/sdd/2026-10-14-omp-single-call/debug-cli-slowdown.md`.
