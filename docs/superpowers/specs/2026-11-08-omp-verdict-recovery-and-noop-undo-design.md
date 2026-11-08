# OMP verdict recovery and no-op undo: the two remaining test blockers

**Status:** design note, not implemented. Both items are recorded in the tester feedback as blockers that survive
today's code. Neither can be closed by relaxing a decoder or by editing a ledger line after the fact.

## 1. #158 — an OMP execute whose final message is malformed

### What happens today

1. OMP's execute phase returns a complete process outcome, but `normalizeExecutionFinal` refuses the final message
   (`execution-format-invalid` or `execution-format-ambiguous-or-hidden`).
2. `ompAdapter.ts` writes `execute-format-failure.json` (attempt refs, base, normalizer diagnostic) and throws.
3. The attempt commit exists under `refs/ccloop/.../attempts/<n>`; the run has no saved-result capsule and is not
   recoverable. Orca may show the diff, but `task verify-saved-result` refuses (`saved-result-source-stale` or no source).

The existing exhausted producer (`execution-complete-before-verification-v1`) cannot be reused: its first condition is a
unique, strict decode of the execute answer. A malformed answer has no `ExecutionResult` to reproduce, and
`savedResultRecovery.ts` deliberately fails `execution-format-failure-v1` with
`saved-result-normalizer-provenance-unavailable` rather than reinterpret a failure as success.

### The boundary that makes a safe design possible

A verifier proves code satisfies the task; it does not manufacture the agent's missing answer. A malformed-final
recovery therefore must be *verification-only*: it may land an attempt whose work is proved by re-running the task's
required checks, but it must not write a fabricated `taskResult`, decisions, or usage.

### Proposed direction (for the person to rule on)

- **New authority kind** `ccloop-execution-complete-without-final-v1` (name illustrative), produced only when:
  process ended cleanly, the attempt commit was published, the post-execute worktree is clean, the normalizer refused
  the final, and the run never entered verify.
- **Consumer:** a verify-only run from the published attempt. It gets the same admission/funding/verify gates as the
  exhausted source. Its result carries `verificationOnly: true` and **no** reconstructed answer; decisions are empty,
  and any task whose contract requires reported decisions is explicitly ineligible.
- **Rejected alternatives:** accepting a flattened `taskResult`, synthesising a normalized hash, or treating an
  attempt ref as proof of completion. Each either weakens the decoder or makes an unverifiable claim.

## 2. #138 — a truthful “nothing changed” decision cannot land

### What happens today

`normalizeAgentEntry` downgrades a decision whose `undo.how` fails `executableUndo` to tier 0; approving a pending
decision rechecks the same predicate and refuses (`decision-undo-not-executable`). A no-op task that correctly reports
“nothing changed; nothing to undo” has no command-shaped undo, so its decision can remain pending and a criteria-review
verdict may not settle.

### Proposed direction

Admit one structured, machine-checkable form: `undo: { kind: "no-change", evidence: <the empty diff / base tree
comparison the landing already holds> }`, accepted only when the landing's own Git observation confirms the attempt
changed nothing. The existing free-text command form stays unchanged. The tier stays whatever it was; this is not an
escape from the gate, it is the gate recognizing the only honest undo for a no-op.

**Open question:** whether the ledger schema should carry a structured `kind` (a format change for every reader of
`.decisions/`) or whether the existing `undo.how` string may use a reserved literal such as `no change (proved by
<attempt sha>)`. The former is cleaner and touchier; the latter is smaller and easier for third-party directories.
