# Budget Confidence Proposal

Status: proposal for review, 2026-11-16. Orca tester feedback #225/#297, #224/#266 and #196. This text does not change current budgets or claim a strict cap.

## User problem

A person can read a finite group token limit as a maximum spend, while one Codex response may exceed the remaining live ceiling before ccloop learns its usage. The same person sees a model estimate much lower than the task's eventual ledger spend. A finished execute can then stop before verify, making the work look lost until a supported acceptance or recovery path is used. The measured old cases in the tester ledger are evidence for those cases, not universal multipliers or a new cost prediction.

## Facts in the current implementation

- ccloop now tails this call's private Codex rollout by `thread_id` and publishes `token_count` after completed responses. The observation is provisional; final work usage still comes from `turn.completed`. It may arrive after the next request starts. No request-bound preflight observation or provider-enforced maximum input exists on this path.
- Claude/OMP can stop a phase while it runs based on their own observations; neither can refund work already spent before its first observation. Codex cannot guarantee a hard ceiling for a response in flight. A promised strict group cap is therefore false whenever a Codex phase is allowed to start with finite headroom.
- Orca's estimator instruction v4 includes a framing measurement from one small repository. It does not consume the target repository's measured plan-call cost or size. `repoTaskHistory` provides a median of completed tasks in the same repository when at least three known exact task spends exist; current confirmation uses it to raise an estimate-derived *expectation*, leaving the raw estimate and its rationale unchanged.
- Each new task still starts its own plan phase. The plan is charged to the same group limit and may itself be costly; changing the expectation floor does not make planning cheaper.

## Options

1. **Keep a soft limit and say so at commitment time.** In preflight and the run view, show whether the chosen agent provides a request-bound enforcement proof. For Codex, state that a response in flight may exceed the remaining group limit; show its provisional usage separately from booked spend. Preserve unattended execution, and never call the finite number a guaranteed maximum. This is the safe incremental default.
2. **Require strict enforcement for finite groups.** Refuse Codex and every other adapter without a pre-request bound until an enforcement-capable provider is selected. This protects a promise but interrupts existing automatic work and offers no Codex route today. Treat as an explicit operator policy, not a silent default.
3. **Build a request-bound broker.** Intercept each provider request, count input and reserve bounded output before forwarding; reject a request whose complete worst case exceeds the remaining group authorization. This can make a real cap only after the provider/tokenizer, hidden framing, tool continuations, retries and concurrency are measured and fenced. It crosses the agent/provider trust boundary and needs a separate research and security design.

Recommendation: ship option 1's truthful status now; offer option 2 as a later explicit strict mode only after the product can express it consistently in CLI and Web. Do not implement a numeric 1.2×/10× claim as a hard limit for Codex. The earlier acceptance of soft limits remains consistent with this recommendation; any new strict promise would require a new rule.

## Estimate calibration work before changing numbers

1. Use a fixed snapshot of the repository's exact completed-task ledger, grouped by agent/model/phase and including failed attempts. Record the sample size, command and observed commit with every measured number. Skip approximate or unknown usage. Keep per-task plan and execute separate.
2. Run the current estimate prompt against that snapshot offline: compare each raw estimate with both final successful-work spend and all-attempt spend. Test whether repository-level median, task-level source/test footprint and measured phase framing each add predictive value. Do not use one dogfood group's 12–92× range as a global constant.
3. Introduce a new opt-in instruction version if the data helps. Feed only deterministic, compact observations into the prompt, keep original uncalibrated output visible, and provide the measured history range beside it. A calibrated estimate remains an expectation, never an entitlement or a strict budget.
4. Paid validation, when needed, is one small isolated estimate→run pair under the same profile with raw receipts preserved. No historical group is rerun for this measurement. Stop if a paired run would consume an unbounded grant or if exact usage cannot be obtained.

## Acceptance questions for implementation

- Does a new finite group selecting Codex see a plain warning before confirming, and does its run view distinguish an observed response from settled spend?
- Can a run exceed the displayed finite ceiling without any screen promising it could not? Is an operator's explicit strict policy respected by admission rather than only by copy?
- For a historical exact-usage sample, are phase costs and all-attempt costs shown with sample counts, and do estimates continue to show their original source and uncertainty?
- Can a completed execute stopped before verify reach the supported verify-only or owner acceptance path without repaying the execute? #316's array-log compatibility is a separate result-decoding fix.

This proposal adds no budget policy change to the current patch. The next implementation unit is the preflight/run-copy correction with regression tests, followed by a separate measured calibration iteration.
