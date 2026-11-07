# Verify-only recovery: an explicit work top-up for the verification run

Status: design, 2026-11-07 (Claude, session `2f5eef42`). Human ruling: 「资金路径建议 => 同意」.
It implements the funding half of `2026-11-07-exhausted-attempt-recovery-design.md`; it does **not**
reinterpret the source run's failure.

## 1. The problem

`applyVerifySavedResult` (`src/control/savedResultRecovery.ts`) funds a new `verify-saved-result` run
through `decideFundedAllowance`. That allowance is the task's authored grant plus every work top-up,
minus the usage already inherited from earlier runs. When an exhausted attempt has spent the authored
work allowance, every remaining dimension is zero and Orca refuses:

`saved-result-unavailable:saved-result-authored-budget-exhausted`

The refusal is correct: the source's work is real and verified, but there is no money left to pay a
verifier. Today's only exits are `task retry --work` (a fresh plan/execute run) and `close-run` (ending
accounting without accepting work). Neither gives a verifier a funded run over the **existing**
completed execute. The acceptance criterion in the exhausted-recovery design — zero plan/execute,
one verify — therefore cannot pass without an authorised, explicit top-up.

## 2. Design

**One optional field on the existing command.** `verify-saved-result` gains `work`, the same shape and
scope as `retry-task`'s (`src/control/webProtocol.ts` `retryTopUpWorkSchema`): each of `tokens`,
`activeMs`, `attempts`, `sessions` a non-negative safe integer or absent (absent = 0). Absent, the
command's bytes and behaviour are unchanged. CLI: `orca task verify-saved-result <g> <t> --work <json>`.

**One record, shared with the retry top-up.** Append one row to `work_grant_top_ups` with
`from_run_id` = the **source run** being verified. The existing ordering rule applies unchanged: a row
applies to run R iff `rowid(from_run_id) < rowid(R)`. The source run itself is excluded by the strict
`<`, so its own `readFundedAllowance` check is byte-for-byte unchanged. The new verification run is
inserted later, so `decideFundedAllowance(..., topUpSum(..., null))` sizes it from the authored grant
plus this top-up. No new table, no edit of `work.grant`, no rewrite of the source run.

**One transaction.** Inside `applyVerifySavedResult`'s `apply`, after every existing source check
(evidence, identity, closure rehash, setup refusal), and before `decideFundedAllowance`:

1. Refuse a top-up on a non-optional (`finite-legacy`) task: `saved-result-top-up-unsupported:finite-legacy`.
2. Refuse an all-zero/empty `work`: `saved-result-top-up-empty`.
3. Refuse a token top-up on a task whose authored tokens are `null`:
   `saved-result-top-up-no-effect:tokens` (nothing to raise).
4. Authorise it by the **same rule as `retry-task`** (`src/control/retryTask.ts` `authorizeTopUp`):
   a person principal always; an agent or a Web member only while the group's agent top-ups plus this
   one stay within the global `agentTopUpCap`; a run Orca dispatched never. Distinct booked codes:
   `saved-result-top-up-not-authorized`, `saved-result-top-up-cap-exceeded:<dimension>`,
   `saved-result-top-up-dispatched-run`.
5. Append the row; then run the existing funding gate unchanged.

Every refusal rolls the whole apply back (the command savepoint), so no row, no settlement, no run.
The row's `by` is the routed principal (else the actor); `personAuthority` is the authorisation answer.

**What still gates the run, unchanged.** `decideFundedAllowance` must still find the group's non-token
headroom and the spend caps; the existing `group-reserve-insufficient` and `spend-cap-reached` checks
still run; a probe still has to prove the capability; the source still has to answer the
`execution-complete-before-verification-v1` authority kind (or the legacy one) and pass every admission
check. A top-up is permission to spend, never permission to accept work.

**Activity.** One activity row on the new run's task: kind `saved-result-top-up`, body
`{sourceRunId, amount, by, commandId}`. A replay of the same command writes no second row.

**The board.** The task's budget view lists the row through the existing `groupTopUps` lines (the
`retry-task` top-up already renders there), so a verification grant above the confirmed allocation is
never unexplained.

## 3. What does not change

- The legacy `failed`-source branch, the OMP bad-final refusal, the `setup-unsupported-here` refusal,
  the source's `exhausted` outcome, and every existing eligibility reason.
- `retry-task`, its top-up rows, and its authorisation rules.
- A `verify-saved-result` without `work` (byte-identical payload, funding and refusals).
- `close-run` (it still ends accounting and accepts nothing).

## 4. Criteria (each new branch has one named mutation, seen red)

`tests/control/verifyTopUp.test.ts` (fixture: the exhausted source world already used by
`savedResultRecovery`):

| # | Case | Mutation |
|---|---|---|
| V1 | Person, cap null, exhausted source: `work {tokens: N}` ⇒ verification run starts; its grant includes N; the source run's `readFundedAllowance` still passes; source outcome stays `exhausted` | skip the append |
| V2 | Same without `work` ⇒ `saved-result-authored-budget-exhausted`, no run, no row (byte-identical to today) | append a zero row |
| V3 | Agent, cap null ⇒ booked `saved-result-top-up-not-authorized`, no row; a person with cap null ⇒ applied | treat any principal as a person |
| V4 | Agent, cap `{tokens: C}`, two top-ups summing over C in one group ⇒ second booked `saved-result-top-up-cap-exceeded:tokens`; the same on another group ⇒ applied | check each row alone, not the group's sum |
| V5 | A run Orca dispatched sends `work` ⇒ booked `saved-result-top-up-dispatched-run`, no row | drop the dispatched-run check |
| V6 | `work {}` ⇒ `saved-result-top-up-empty`; token top-up on a `null` token task ⇒ `saved-result-top-up-no-effect:tokens` | accept both |
| V7 | `finite-legacy` task ⇒ `saved-result-top-up-unsupported:finite-legacy`, grant unchanged | drop the branch rule |
| V8 | Group reserve too small for the funded grant ⇒ `group-reserve-insufficient`, no top-up row, no run (the append and funding share one rollback) | append outside the apply transaction |
| V9 | The same command id replayed ⇒ the stored result, exactly one row and one activity row | append on replay |
| V10 | Paired, real ccloop: exhausted source + person top-up ⇒ zero plan/execute calls, one verify call, the source's original failure still visible | (integration gate; no mutation) |

Ordering mutation: change the strict `<` to `<=` in `topUpSum`'s rowid comparison and V1's source check
must fail.

## 5. Honest boundaries

- The top-up pays a **verification** only. It does not make an unverified execute true, and it grants
  no authority over a source the reader already refuses.
- A soft provider may report usage at phase end; the grant is a budget, not a hard provider stop
  (`tokenPolicy`: soft mode). The cap bounds Orca's accounting, not necessarily one provider call.
- Existing runs without the completion source remain unrecoverable (`saved-result-exhausted`).
- Orca's strict readers must accept the new refusal codes and the optional `work` payload before this
  ships; the two repositories change their mirrors together.

## Correction 1 — V8 refusal ordering (2026-11-07, implementation session `79d7713b`)

V8's promise of `group-reserve-insufficient` for an optional-policy task with too little group headroom is too specific. `decideFundedAllowance` checks that the prospective funded work and handoff fit the group's non-token limit *before* the explicit reserve check. In a valid optional-policy fixture with insufficient attempts, it returns no allowance, and the existing recovery command answers `saved-result-unavailable:saved-result-authored-budget-exhausted`. Both checks remain intact: the command savepoint rolls the tentative top-up row and any source release back. V8 must assert that the source and accounting are unchanged, the answer is booked, and no row or verification run exists; it cannot require the later reserve code for this input. Evidence: `TMPDIR=/tmp ./node_modules/.bin/vitest run tests/control/retryTopUpSavedResult.test.ts -t 'V8:'` on branch `feat/verify-only-work-top-up` based on `34d6d058` (red at the old expected code; after correcting the assertion, green). This correction does not alter the original design's funding checks.
