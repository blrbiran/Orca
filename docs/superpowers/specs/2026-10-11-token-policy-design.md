# Optional cumulative token ceilings and cap-backed run allowances

Owner: Codex controller, 2026-10-11 Asia/Shanghai. Human choice A: task/group default cumulative token ceiling is unlimited, explicit limits optional; global/project spend caps independent; timeout/attempt/session protections retain. Execution/review/integration authority is in `2026-10-11-feedback-followup-design.md`.

## 1. Types and semantics

Usage `Amount = {tokens:number, activeMs:number, attempts:number, sessions:number}` always uses finite nonnegative safe integers. New ceiling type `BudgetAmount = {tokens:number|null, activeMs:number, attempts:number, sessions:number}` uses null only for unlimited tokens. Zero is zero; never Infinity/MAX_SAFE_INTEGER/high numeric default as unlimited. Finite forecasts, charges, deficits, usage deltas and receipts remain Amount. Defaults preserve current other dimensions; original single-call estimator/requirement bounded grants retain finite tokens and request bounds.

Authored task/group ceilings and actual funded allocation are distinct. New task/group token ceilings default null. Existing records retain their exact finite policies, grants and immutable evidence. Explicit limit controls accept empty=unlimited or finite safe integer; show cumulative used and configured ceiling separately; hide meaningless token percentage/remaining when unlimited. Forecasts do not silently set token ceilings. Global/project spend caps still use their existing finite tokens (not invented dollar prices).

Centralize ceiling algebra: finite usage adds/subtracts finitely; remaining unlimited ceiling stays null; min(null,n)=n, min(null,null)=null; a finite usage fits null. Commitment bookkeeping is keyed funded allocation, not subtracting null from null. A finite group with unclaimed unlimited tasks reserves actual allocated leases, not infinite draft promises. Preserve non-token encumbrance rules.

## 2. Claims and spend caps

At claim, inside existing transaction, compute allowance from explicit task remaining, finite group free headroom, and all applicable current global/project cap headroom. No finite binder means true null work-token grant. Finite binders produce a real finite grant, record authored policy and binding causes (`task`, `group`, `spend-cap`); do not rewrite authored null to that grant.

Reserve finite handoff requirement first. Split remaining finite headroom across available worker slots deterministically when unconstrained demand would consume all cap headroom: divide by max(1, configured concurrency minus active claims), integer floor, no invented fixed token chunk; explicit task demand takes min. Admission refuses when headroom cannot fund required handoff and useful work, naming actual binder. This keeps concurrent unlimited tasks possible under a finite cap; release returns only real reserved allowance. Unknown usage holds allocation and blocks as before.

Unlimited task exhausted solely by group/cap-funded allowance enters a saved, waiting continuation, not task success or terminal authored-token exhaustion. Renewal uses normal claim/exclusion, rechecks current caps and authored remaining, carries consumed activeMs/attempts/sessions forward and requires valid snapshot/usage. Cap raise/removal/period rollover may wake eligible work; no bypass of exhausted other dimensions, ordinary dependency waits or stop intent. Explicit authored token exhaustion retains named exhausted/waiting-for-limit behavior. Do not endlessly replan on cap exhaustion.

Setting finite group/cap limits while an affected truly unbounded run is active refuses `active-unbounded-budget-conflict`, instructing stop/reconcile first. No pretending that the already-running provider is instantly bounded. After stop and known usage, install limit normally; subsequent claim becomes finite. Existing cap reduction below known commitments continues its current refusal/deficit semantics. Concurrent cap edits and claims serialize.

## 3. Controller and provider behavior

ccloop supports nullable contract work-token ceiling and control run grant with finite usage. Null removes only cumulative token exhaustion; active time, attempt/session counts, watchdogs, request output/context bounds, handoff and filesystem rules remain. Scope proof checks to actual finite bounded dimensions; an unlimited token policy does not make unknown-context or other capability checks disappear. Finite cap-derived allowance is still enforced at the current adapter's actual observation points.

Existing Claude/Codex adapters advertise soft enforcement. Keep honest phase-end overshoot behavior and unknown observations; do not claim hard money/token guarantee. Any future hard proof is separate. Unknown-usage `remaining-grant` settlement is illegal for a null remainder; keep blocked and require existing finite evidence-backed/manual finite settlement. Never book infinity, null or zero guessed usage.

## 4. Persistence/protocol compatibility

Orca schema 10 upgrades one-way to 11 with new policy/allowance records; preserve old body/hash/evidence bytes, derive old records as finite. Incompatible older build refuses upgraded store. Migration tests use isolated copies only.

Negotiate nullable ceilings through new `tokenPolicy:'optional-v1'` capability and protocol-4 start envelope; finite legacy protocol-3 remains readable/accepted and produces old shape. New producer snapshots identify nullable ceilings separately from numeric usage; Orca strict mirrors change together. Do not send protocol4 to old peer; finite existing work remains usable. New default-unlimited preparation states explain incompatible peer instead of becoming a misleading start button. Old hash/resume semantics remain for old inputs.

## 5. Acceptance

Add tests for >3M usage without token exhaustion, finite other-dimension exhaustion, actual explicit limits, algebra/no-null-usage, deterministic two concurrent cap-backed claims, handoff reservation, release/held unknown, raise/rollover renewal without resetting counts, retry/continuation/stop/crash fences, cap set under active unbounded work refusal, old store/envelope/snapshot/hash preservation and feature negotiation. Test real ccloop controller fake provider beyond former defaults and paired Orca runtime, not only UI null parsing. Required deletion mutations cover nullable exhaustion, cap admission/commitments, inherited count preservation, negotiation and finite usage validation.

## 6. Independent-review amendments — Codex controller, 2026-10-11

These supersede conflicting slot/concurrency wording above; both independent reviews are in this round's ledger.

No configured worker-count limit exists in the current dispatcher. For each finite binder, define its ready-demand domain from confirmed, unarchived, unstopped, non-recovery-blocked groups in scope, idle unclaimed work whose recorded dependencies are satisfied. Group ceiling domain is that group, project cap domain that repository, global cap domain all admitted repositories. Read this deterministic stored demand inside the claim transaction; no extra provider/capability probe. Sort by group/work identity. Active/start-unknown claims are occupied and their real commitments already deducted, never counted as idle demand. Single-call/reconcile/handoff claims retain their existing finite admission.

For each binder, choose the largest prefix of ready demand that can fund each candidate's actual finite handoff reserve plus at least one work token (or a higher finite request minimum if capability requires it). Reserve prospective handoff sum before evenly dividing residual work, capped by each finite authored remaining demand; redistribute unused share deterministically. Current candidate receives min of each binder's offered allowance. Only claimed allocation is committed. If current candidate is outside the funded prefix, defer with named cap/group reason and wake on release/change; never claim a zero allowance. This replaces the imaginary configured-concurrency denominator and covers unequal handoff, tiny headroom and cross-group caps.

Persist `inheritedUsage:Amount` for renewable lineage. New run observations remain run-local; next non-token grant equals authored dimensions minus inherited total minus actual prior run usage, booked exactly once by run observation identity. Starting a new verification/execution session or attempt consumes one unit, replay none. Renew only complete saved partial/continuation evidence; never synthesize checkpoints when capture fails.

Negotiate through independent read-only control `features` returning `{protocol:1,tokenPolicy:'optional-v1',savedResultRecovery:'v1',agentInstallationUpdate:'v1'}` with optional feature keys. Existing protocol3 capabilities/list/resolve response bytes remain unchanged; old command-invalid means unsupported. New port exposes optional readFeatures, caches by executable identity; only protocol4 nullable/recovery start uses features. Finite normal work keeps protocol3.
