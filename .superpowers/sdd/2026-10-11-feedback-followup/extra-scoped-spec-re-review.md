# Extra independent scoped specification re-review

Owner: `/root/extra_spec_review`, dispatched by Codex controller for scoped follow-up to the human-requested independent review. Date: 2026-10-11 Asia/Shanghai. Append-only new artifact; scope is exclusively F1–F5 in `extra-spec-review.md` against token/recovery §6 and Agent §4. No code, tests, specifications or other historical review artifacts were edited. No subagents or provider calls.

Reviewed specification commit: `6b37d50bf9cf370ecf6ddbd12105796c1624580c`, topic `docs(spec): resolve independent review fences before planning`. Identity measured with `rtk git -C /private/tmp/orca-feedback-followup-20261011 log -1 --format=fuller`; specification line references measured with `rtk proxy bash -c '... nl -ba "$f" ...'` for the three relevant specification files.

Verdict: **approved for planning and implementation; F1–F5 resolved.** No residual must-fix in this scoped review. Approval is of the amended specifications, not an assertion that runtime behavior or tests already pass.

## F1 — Current task authority: resolved

Saved-result-recovery §6 line 43 now requires the current terminal failed run/current terminal attempt, excludes newer pending/accepted/current work, compares all named semantic versions and frozen contract authority, and checks both admission and pre-spawn. It confines permitted differences to funded limits and explicitly frozen verifier selection/provenance. Original base/snapshot remains authoritative; current target-tip drift reaches normal reconciliation only after verification. This closes the stale-evidence route without removing ordinary harmless target-tip movement from scope.

## F2 — Saved candidate and verify-only entry: resolved

Recovery lines 45–47 persist the mode/package in accepted input, state and resume/adoption; add a durable entry marker before any validation/provider call; forbid automatic repeat after entered-but-unobservable work; and require candidate tree/index/protected-input equality before publication/harvest. Declared scratch outputs are excluded from harvest. Modification checks, crash windows and semantic races are explicitly accepted test criteria. This prevents code repair by verification tools and normal-loop entry after crash while retaining real verification and honest unknown-usage handling.

## F3 — Table mutation authority and publication: resolved

Agent §4 lines 33–37 now specify a shared cross-process table lock, exact accepted argv/realpath/version re-probe, immediate pre-publication byte recheck, process-tree reaping, durable intent/receipt with before/after hashes, replay-before-CAS ordering, and a durable Orca outbox reserved before dispatch. The named crash windows cover table rename, ccloop receipt and Orca ledger finalization separately. Implementation must preserve this single operation identity through all helper/CLI/Orca entry points and recover the corresponding intent under the shared lock; no independent unlocked read/probe/write path satisfies the amended specification.

## F4 — Funded demand and non-token counts: resolved

Token §6 lines 43–47 explicitly supersede the nonexistent configured-concurrency denominator. The selected alternative uses deterministic recorded idle ready demand in each finite binder's actual group/project/global domain, with all active/start-unknown commitments deducted. The prospective-handoff-funded prefix, strictly positive work minimum, finite demand capping/redistribution and min of binder offers determine admission. This is a concrete rule rather than a request for another runtime scheduler policy. Line 47 separates finite inherited usage from run-local observations and names the remaining-budget equation and exactly-once observation booking, including new session/attempt consumption versus replay. The implementation criteria remain responsible for cross-domain claims, small headroom and renewal exhaustion; no hard token guarantee is implied for soft adapters.

## F5 — Partial roles and freeze compatibility: resolved

Agent §4 line 31 fixes operator field-only overrides to their established operator installation association, defines absent-role/group-only overlays on full group primary, preserves same-agent field switching and existing null behavior, and includes concrete A/B/C examples. Compatibility is tested on the final resolved role without substitution. The new `group-primary` provenance source and versioned v2 hash domain apply only to new records; old frozen verification remains v1. This closes both cross-installation field contamination and retroactive hash reinterpretation.

## Compatibility observation

Token line 49, recovery line 49 and Agent line 37 consistently use independent read-only `features` negotiation without widening legacy protocol3 capabilities/list/resolve response shapes. Nullable/recovery starts use negotiated protocol4; finite ordinary work retains protocol3. This is consistent with the original old-peer boundary and does not leave a feature-scope exception in F1–F5.
