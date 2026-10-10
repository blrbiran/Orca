# Second scoped spec re-review — R1/R2 closure

Owner: Codex `/root/spec_review`, 2026-10-11 Asia/Shanghai. Observed Orca commit `82f484bbc2af5aee092a3ea44432f41df8840cf3`. Scope limited to closure of R1/R2 from scoped-spec-re-review.md. No code changes, tests, subagents or other review expansion. Only this report written.

Evidence: `rtk proxy git rev-parse HEAD` and `rtk proxy python3` reading/numbering the two new §6.1 amendment paragraphs at the observed commit.

Verdict: **APPROVE the amended specifications for implementation planning.** Both remaining architecture findings are closed. This is a design-review verdict, not a claim that implementation or runtime behavior has passed tests.

- **R1 closed — token-policy-design.md:51–53.** One jointly feasible candidate set replaces independent binder prefixes. Prospective minima are checked and deducted against every applicable residual binder; blocked candidates are skipped, allowing healthy later demand. Residual division uses the jointly admitted set and scoped remaining counts, with only real claims persisted. The explicit zero-project-headroom A / healthy B acceptance case directly covers the original no-progress failure.
- **R2 closed — saved-result-recovery-design.md:51–53.** The narrowly defined interrupted-recovery successor preserves the original capsule owner while separately binding the latest recovery predecessor/currentRunId. Immutable lineage, unchanged semantic authority, process reaping and resolved usage are required before a fresh explicit command/run. Rejection, candidate modification and intervening ordinary execution do not gain the exception, and no automatic verifier restart is authorized. This resolves the source/current-predecessor contradiction without weakening the first-recovery fence.

Earlier resolved findings and the immutable evidence, usage, protocol compatibility and durability requirements remain in force. No remaining must-fix findings within this scoped review.
