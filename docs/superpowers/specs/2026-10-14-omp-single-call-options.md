# OMP single-call: options (research note, not yet a design)

Orca session `b39a5527`, 2026-10-14. The human asked for a workaround so omp can serve single-call (estimate, clarify,
split). This note records a read-only investigation (one subagent; no paid call; measurements against a local fake
Anthropic server with a scratch HOME). The raw logs lived in the session scratchpad and are gone; the conclusions are here.
Read at: Orca `3251607c`-era main, ccloop `3069dbf`, omp 18.10.1, LiteLLM 1.92.0.

## The contract (Orca, not ccloop)

- `docs/superpowers/specs/2026-09-27-single-call-estimate-design.md` §4.4 (line ~81): a kind answers `"v1"` only if it can
  cap output tokens and turn tools off / read-only; Task 0 checks both statically (`--help` plus a fake that reads argv).
- ccloop `src/agents/registry.ts` (`singleCallExecution` doc) says the same. "No retry" is not in that contract; it was an
  extra argument in `2026-10-13-omp-skill-injection-design.md` §4.
- Orca books `inputTokens + maxOutputTokens` (`src/control/estimator.ts`), which assumes one provider request.
- claude meets it with `--tools ""` and `CLAUDE_CODE_MAX_OUTPUT_TOKENS` (ccloop `scripts/claude-phase-runner.mjs`), proven
  statically only. Claude Code itself retries by default (`CLAUDE_CODE_MAX_RETRIES`, seen in 2.0.19; 2.1.x not checked).
- **Second blocker for omp:** `src/control/estimatorCompatibility.ts` also needs a non-null `contextWindowTokens`; omp
  answers `null` (ccloop `src/agents/omp.ts`). Flipping `singleCallExecution` alone would still refuse
  `context-unavailable` (also for clarify/split, `requirementCommands.ts`).

## What was measured

- Reason 1 of the omp spec §4 ("no per-call output cap") is wrong for `api: anthropic-messages` models (the operator's
  `local-litellm/...` model): pi-ai always sends `max_tokens = min(model.maxTokens ?? 64000, …)`; a model with
  `maxTokens: 1234` sent 1234, one without sent 16384 (custom-model default). The cap is the operator's catalog value, not
  per call. For `openai-*` apis it is still conditional.
- Reason 2 (retries) holds in two layers. Session auto-retry (529 storm: 20 requests in 90 s; mid-stream close after text:
  4 requests, i.e. re-spent output) is switched off by a `--config` overlay with `retry.enabled: false` (then 1 request).
  Provider-level retries (`PROVIDER_MAX_RETRIES = 10`, 11 requests on 529) cannot be switched off, but run only before the
  first token, so they cannot re-spend output (they may re-bill input; inferred).
- `--no-tools` sends `tools: []`. Hitting the cap ends the call (`stopReason: "length"`, no continuation).
- LiteLLM `litellm_params.max_tokens` is a default the request overrides, not a cap; router `num_retries` defaults to 2.

## Options

- **A. omp's own cap + a ccloop config overlay.** Single-call argv `omp -p --mode json --no-tools --no-session … --config
  <overlay: retry off, model fallback off, loop guard off>`; before spawning, `omp models --json` must report
  `maxTokens <= request.maxOutputTokens` and a `contextWindow`. ccloop proves the argv and the declared cap, not the wire
  (`omp models` does not expose `api`). ~200-350 lines in ccloop.
- **B. A + a ccloop loopback metering proxy (recommended by the research).** The worker spawns omp with `HTTP_PROXY` at a
  loopback proxy that clamps `max_tokens`, forwards at most one model POST, refuses `CONNECT` (https fails closed), and
  reads usage from the SSE; zero POSTs seen = unproven = fail. Bun/omp was measured honouring `HTTP_PROXY` for
  `127.0.0.1`. Proves both properties on the wire for plain-http providers; cannot see LiteLLM's own upstream retries.
  ~400-600 lines in ccloop.
- **C. Hard cap at LiteLLM.** Needs a custom callback plus `num_retries: 0`; ccloop could only trust an operator flag.
- **D. Today, no code:** the estimator slot can pick a different profile from the worker (claude estimates, omp works).

## Open (needs the human)

Which option, and whether the §4.4 contract may rest on run-time proof by a proxy (B) or on declared configuration (A).
Prerequisite for any of them: omp must report `contextWindowTokens` per selection. Not determined: Claude Code 2.1.x retry
defaults; whether Bun bypasses the proxy for the name `localhost`; whether LiteLLM's translation keeps `max_tokens`.
