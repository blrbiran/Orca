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

## 3. What this note does not change

- `normalizeExecutionFinal` stays strict. No flat `taskResult`, candidate array, or hidden final is accepted.
- `execution-format-failure-v1` stays non-recoverable. Reinterpreting a recorded failure as a success remains
  `saved-result-normalizer-provenance-unavailable`.
- A successful empty result still records `empty-result` and leaves ordinary work blocked (D14); only a criteria-review
  judge treats that as a justified verdict (webService.ts, groupDone.ts). The archive's claim that every such group
  clogs a slot is obsolete: blocked tasks without runnable work hold no orchestration slot.

## Correction 1 (2026-11-08, independent review of the branch above `docs(handoff): this round's four fixes`)

**#158:** The proposed authority kind alone cannot enter the existing saved-result verifier. Both ccloop's recovery
reader and its verification path require a strictly decoded `ExecutionResult` and `normalizedExecutionHash`; Orca's
consumer also assumes a decoded result for non-exhausted sources. A verification-only source needs a distinct,
discriminated recovery object and path through both repositories: derive changed paths from the verified published Git
candidate, leave the absent answer/hash absent, and never manufacture decisions, usage or `taskResult`. Admission must
prove the final format is the *only* execute failure after a complete stream, clean process exit, no tool-rule violation,
known usage and unchanged pre/post-execute HEAD. Capture the worktree and evidence under the worker lease, then bind
them to the real published ref, commit, tree and parent before cleanup; the diagnostic JSON and a predicted ref are
insufficient. The existing recovery refusals for setup and multiple repositories still apply unless separately designed.
The product decision is whether independent checks suffice to call a task complete and which verifier contracts qualify;
a small first scope would require a single repository, no setup and nonempty command checks that fully decide the goal.

**#138:** The sentence above saying a pending decision may keep a criteria-review verdict from settling is not an
established causal path: `recordEmptyResultDecisions` can stage a pending entry and settle the run, while
`criteriaReviewVerdict` reads the settled run and its null landed commit. Add a crossing test before claiming that
particular failure. Git's empty `base..attempt` diff proves only no *net tracked change*, not that the agent never edited
files or touched ignored/external state; any no-change allowance must state that scope and bind the original base and
attempt trees *before* the ledger-only commit changes `.decisions/`. A reserved `undo.how` string cannot pass the
standalone ledger validator merely on its own wording: that would accept forged third-party ledger rows. A structured
form also needs a verifier that can check its immutable evidence. The product decision is which decisions may use a
no-change undo and whether net Git tree equality is enough evidence; the representation follows that decision.

## Correction 2 (2026-11-08, person approved the limited product direction)

**#158:** Independently rerun checks may establish task completion only when the contract explicitly declares that
its nonempty command checks fully decide the goal. The first implementation covers one repository, no setup, a complete
clean execute with known usage, and no required agent judgment or reported decisions. A normal command verifier alone
is insufficient evidence of that declaration: current `rejectOn` is mandatory in the contract but is judged only by an
agent verifier. Preserve all admission and funding checks, bind the actual published Git evidence during the worker
lease, and label the resulting acceptance as verification-only. Never synthesize the absent execute answer or its hash;
ordinary contracts and historical runs without complete evidence stay ineligible.

**#138 and ordinary empty results (#127):** A no-change decision may assert only that this run made no *net tracked
repository change*. Prove equality of the original base and attempt trees before the ledger-only commit. This does not
prove absence of intermediate edits, ignored files, external effects or decision-specific changes in a run that changed
other tracked files. Record a structured, verifiable proof in the ledger; a bare literal `undo.how` is never authority.
Ordinary work with a proved empty result and passing decisive checks may be accepted only through an explicit no-change
completion path, not by accepting every empty result. Test pending decision and criteria-review settlement separately.
