

# Scoped independent spec re-review

Owner: Codex `/root/spec_review`, 2026-10-11 Asia/Shanghai. Observed Orca commit `6b37d50bf9cf370ecf6ddbd12105796c1624580c`. Scope: append-only amendments addressing F1–F5 and contradictions introduced between those interfaces. Read-only specs; only this report written. No code, tests, subagents or production operations.

Verdict: **BLOCK for R1 and R2 below; otherwise original findings resolved.** These are concrete amendments within delegated controller authority, not requests for human approval.

Evidence: `rtk proxy git rev-parse HEAD`; `rtk proxy python3` read and numbered the amendment sections of all four design files at the observed commit. Examples below are illustrative arithmetic/scenarios, not measured test results.

## Original findings disposition

- F1 resolved: agent-preparation:33–37 defines shared lock, durable intent/receipt, before/after-hash recovery, private artifact ownership and Orca schema11 outbox. This supplies the missing cross-process receipt barrier.
- F2 resolved for initial recovery: saved-result-recovery:43 explicitly requires current terminal source, immutable semantic authority, no newer run, and pre-spawn revalidation. Target-tip reconciliation and fresh verifier/limit exceptions are explicit. R2 concerns the interaction with subsequent interrupted recovery.
- F3 resolved: saved-result-recovery:45 seals durable mode and entry, forbids automatic re-execution after uncertain verification, and distinguishes durable output reuse from parking.
- F4 substantially improved: token-policy:43–45 correctly replaces nonexistent configured concurrency with stored demand and funds every prospective handoff. Independent binder selection still creates R1.
- F5 resolved: agent-preparation:31 names concrete partial-layer behavior, Agent association, null behavior, examples and versioned hash compatibility.
- The original nonblocking normalization clarification is resolved by saved-result-recovery:43. Independent features negotiation at token-policy:49 preserves old strict protocol3 response shapes. Candidate immutability at saved-result-recovery:47 prevents verification edits from being silently harvested.

## R1 — P1: Independently chosen binder prefixes can permanently strand runnable work

Location: token-policy-design.md:43–45.

Consider two ready tasks A then B in different projects, each needing 10 handoff tokens and at least 1 work token. Global headroom is 11. A's project cap has zero headroom; B's project has sufficient headroom. The global binder's largest funded prefix is A only. A receives zero/no offer from its project binder, so cannot claim. B is outside the global funded prefix, so also cannot claim. No task starts, no allocation can release, and B remains deferred even though it could run within every cap applying to B. “Current candidate receives min of each binder's offered allowance” does not repair the inconsistent funded subsets.

Required correction: choose the funded candidate subset jointly across all applicable binders using the same transactional snapshot. In stable order, skip candidates whose real minimum handoff/work demand cannot fit every applicable residual binder; account virtual minimum commitments while selecting later candidates. Then distribute residual work among that jointly feasible set, respecting finite authored demand and every binder, with only actual claims persisted. Exclude candidates with exhausted authored dimensions or otherwise deterministic admission refusal from prospective funded demand. This is a deterministic allocator requirement, not provider probing or a new scheduler service.

Acceptance: the A/B example starts B without changing either cap; include overlapping global/project/group constraints and ensure infeasible early candidates do not block later jointly feasible work. Preserve positive minimum, finite usage, no overcommit and deterministic transaction ordering.

## R2 — P2: Latest-source fence conflicts with explicit re-verification after a parked recovery

Location: saved-result-recovery-design.md:43–45 (and original command contract :27–33).

Initial recovery of execution source E creates a fresh accepted recovery run V. If V crashes after verification entry, :45 requires parking and says new verification needs a new authorized command. But :43 now rejects E because V is a newer accepted/current run. V itself cannot qualify as the original execution source: it skipped execution, already entered verification, and has no independent eligible execute failure capsule. Thus the specified command cannot perform the newly authorized verification after the interrupted recovery.

Required correction: distinguish immutable execution-source identity from the current task/recovery-chain fence. For the first recovery require current failed execution E. For a subsequent explicit verification command, permit the same E capsule only when the current run is a settled/parked verify-only descendant of E, with exact immutable lineage/semantic hashes and no intervening ordinary execution, pending run, accepted result or landing. Bind the command to that current recovery predecessor as well as E, resolve usage/ownership first, and recheck the predecessor at admission/spawn. Fresh run/attempt/session usage and cap admission still apply. If repeated verification is intentionally unsupported, instead state that interrupted recovery permits only ordinary retry and remove the implied re-verification route; do not leave both incompatible promises.

Acceptance: E -> V interrupted after entry -> explicit new command V2 skips planner/executor, retains E source/failure, and cannot duplicate V; same request is rejected with unresolved V usage, an intervening ordinary retry, changed semantic authority or concurrent pending run.

## Conclusion

No further architecture blockers were identified within the scoped re-review. Amend R1/R2 append-only; preserve the already accepted durability, strict normalization, compatibility and immutable evidence decisions.
