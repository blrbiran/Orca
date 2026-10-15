# OMP single-call real-provider acceptance (plan 2026-10-14-omp-single-call, Task 13)

Who: Orca session 026d10e3 (controller) with one implementation subagent for the harness. When: 2026-10-15.
Human authorization: "Task 13 付费验收 => 同意" and "Task 13 放在两轮代码前面，先做" (this session).
Orca: main at `chore(deps): repin ccloop to dc51022 for the omp single-call and catalog diagnostics` plus this branch's
harness commit `test(acceptance): omp single-call estimate and requirement scenarios, --fake-omp`.
ccloop: build clone of the pinned commit dc51022 (`/private/tmp/orp-gate/ccl/dist/cli.js`). omp 18.10.1.

## Isolation

Disposable root `/private/tmp/omp13-CMmR` (0700): private HOME, XDG dirs, TMPDIR, control store, run dirs; omp
configuration copied from `~/.omp/agent/{config.yml,models.yaml}` as 0600 files in a 0700 dir (`PI_CODING_AGENT_DIR`).
The harness writes its own profile (declared `contextWindowTokens` 1000000, intersected by min with the catalog's
128000; `framingTokenOverhead` 2047). The operator's `~/.orca` was snapshotted before and after: unchanged
(`orcaHomeUntouched` true in both runs). Catalog in that world: one row, `local-litellm/ep-20261012204110-nvhqw`,
window 128000, maxTokens 16384 (LiteLLM alias to the operator's deepseek deployment; acceptance data, not a default).
LiteLLM `/health/liveliness` answered 200 before the runs.

## Runs (raw outputs kept in `evidence/`; secret scan of evidence: no hits)

1. `--scenario estimate` (09:49:08–09:50:23): exit 1, every check true except `estimateReady`.
   - The single call: 1 assistant `message_end`, `stopReason` `stop`, usage input 2359 / output 867 / total 3226;
     argv carries `--no-tools --no-rules --no-lsp --no-extensions --no-skills` and `--config <call dir>/config-overlay.yml`;
     ccloop usage.json 3226 = Orca booked 3226 = last usage event 3226; `unknown.work` false.
   - The estimate became `failed`, `reasonCode` `estimate-output-invalid`: the model's answer listed task `a` twice
     (the second copy with `rationale: "placeholder"`). Orca refused it as designed. Model quality, not transport.
   - The rest of the scenario (confirm, start, plan/execute/verify) landed `answer.txt` = `42\n`; group ledger 36298
     tokens = ccloop's reported total.
2. `--scenario requirement` (09:50:49–09:51:35): exit 0, all 14 checks true.
   - clarify: 1 message, `stop`, 3327 tokens, booked 3327; split: 1 message, `stop`, 3431 tokens, booked 3431; tools
     off and overlay present in both; consensus reached; draft 1 produced; requirement ledger matches.

## Ruling (controller)

- Not re-running the estimate: a retry is a new paid call and needs the human's own yes (global rule). Recorded as the
  open item "one more real omp estimate to see a ready estimate".
- Task 13's acceptance claim is limited to: the omp single-call transport works end to end for estimate, clarify and
  split against a real provider (n=1 each); the estimator's answer quality on this model is not accepted.
