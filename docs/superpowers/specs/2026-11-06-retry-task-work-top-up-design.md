# retry-task: a work top-up for the retried run, without rewriting the task's grant (design)

Who: Claude Code (Opus 5.5), session 86352010, 2026-11-06, on Orca `660b4bdf`.
Status: **revision 2** (2026-11-06, session 86352010): review round 1 (independent reviewer subagent, same session) folded
in; controller decisions recorded in §6. Revision 1 was the controller's draft at `2618eeb2`. Not yet implemented.
Every file:line below was read at Orca `660b4bdf` (worktree `2618eeb2`, `src/` unchanged).

## 0. Human rulings (verbatim)

- Session 3cfc2e73, on who may change a retried task's agent: 「想要增加被授权的 agent 的能力，可以不止是人才允许。」
- Session 86352010, on the controller's recommendation for the `retry-task` work grant ("never edit a started task's
  grant; append a top-up that only the new run reads; a person may always grant it; an authorized agent may, up to a cap
  a person set for the group; non-token dimensions use the same mechanism; write a short spec first"):
  「都同意按你的建议走」.

## 1. The problem (evidence, Orca `660b4bdf`)

- `readFundedAllowance` (`src/control/fundedAllowance.ts:114-148`) checks every run's stored allowance against the
  task's **current** authored grant: `authored = work.grant.work` (`:135`), `authoredTokenCeiling === authored.tokens`
  (`:136`, else `funded-authored-policy`), and for `activeMs`, `attempts`, `sessions` the run's grant must **equal**
  `remainingBudget(authored, inherited)` (`:143-144`, else `funded-grant-authority`). Inherited usage is the runs of the
  work item with a smaller `rowid` (`:138`).
- So raising `work.grant.work` for a retry makes every earlier run of the task fail its own check (observed in session
  3cfc2e73: `recovery-blocked`), and the read model reports the group blocked.
- The retried run's grant is **not** sized by `retry-task`. On the optional-policy path `retry-task` only checks that
  `remainingBudget(work.grant.work, inherited)` has no zero dimension (`src/control/retryTask.ts:172-176`, else
  `authored-budget-exhausted`) and sets the task `ready` (`:177-183`). The grant is computed at claim by
  `decideFundedAllowance` from `work.grant.work` (`fundedAllowance.ts:84`) and persisted with the new run
  (`src/control/webDispatch.ts:428`, `:460-466`), in a later transaction. Its non-token fit against the group's limit is
  checked there and skipped without a specific reason (`fundedAllowance.ts:86`). An "unlimited" group is unlimited in
  tokens only; `activeMs`, `attempts`, `sessions` stay finite (`src/control/tokenPolicy.ts:15-17`).
- `retry-task` has three branches: saved-result no-dispatch (`retryTask.ts:113-122`, refuses optional-policy tasks,
  `:116`), optional-policy (`:172-184`), and fixed (`finite-legacy`, `:185-213`), which re-grants the failed run's full
  grant, rewrites `work.grant` (`:200`) and is the only one with `group-reserve-insufficient` (`:187-192`).
- Today's exits: a limited group has `set-limit` plus a retry (D2). A task in an **unlimited** group that exhausted a
  non-token dimension (its attempts, active time or sessions) has none (D1–D4 spec criterion 13).

## 2. Design

**Scope (v1).** The optional-policy branch only (`hasOptionalTaskPolicy`, `fundedAllowance.ts:35-38`). A `retry-task`
with `work` on the fixed or the saved-result no-dispatch branch is refused, booked: `retry-top-up-unsupported:finite-legacy`
or `retry-top-up-unsupported:saved-result-no-dispatch`. (The fixed branch re-grants the full grant on every retry, so it
needs no top-up.)

**Record.** A top-up is an append-only row, never an edit of `work.grant`:

```
work_grant_top_ups(group_id, work_item_id, from_run_id, body)  -- body: { amount: Amount, commandId, by, personAuthority, at }
```

One row per applied `retry-task` that carries a `work` amount; `from_run_id` is the run the retry retried (the task's
`currentRunId`). A schema migration adds the table (no rewrite of rows).

**Ordering (the identity rule, kept exact).** A top-up *T* applies to a run *R* of the same work item iff
`rowid(T.from_run_id) < rowid(R)` in `runs`. For *R*, the authored grant is `work.grant.work` **plus every top-up that
applies to it** (tokens: `null + n = null`). Why this order is total and correct:

1. `runs` has an implicit rowid (`id TEXT PRIMARY KEY`, `src/control/migrations.ts:11`) and no code deletes a run (no
   `DELETE FROM runs` in `src/`), so rowids grow in insertion order. It is the order `readFundedAllowance` already uses
   for inherited usage (`fundedAllowance.ts:138`), so the two sums cannot disagree.
2. In the transaction that appends *T*, `retry-task` asserts `from_run_id` is the newest run of the work item
   (`retryTask.ts:97-100`).
3. Every later run of the work item (the retried run, its continuations, a saved-result recovery, later retries) is
   inserted after that commit, so it has a larger rowid and sees *T*.
4. *T*'s own `from_run_id` is excluded by the strict `<`, so the retried-from run's check is byte for byte unchanged, as
   is every earlier run's.
5. A second retry against the same failed run is refused (`run-state:settled-failed`, `retryTask.ts:126-129`) and its
   writes roll back with the apply's savepoint (`src/control/commandLedger.ts:389-395`), so no second row appears.

A top-up therefore raises the task's authored ceiling **for the retried run and every later run of the task**; it never
changes an earlier run.

**Readers switched to the "as of run" sum** (one function, used at each):

| Site | Sum used |
|---|---|
| `fundedAllowance.ts:84` (`decideFundedAllowance`, the claim's sizing) | all top-ups (the new run is the newest) |
| `fundedAllowance.ts:135-144` (`readFundedAllowance`'s check) | top-ups before *R* |
| `retryTask.ts:175-176` (`authored-budget-exhausted`) | all top-ups **plus the incoming one** |
| `src/control/continuation.ts:185` (an allowance continuation's `available`) | all top-ups |
| `src/control/savedResultRecovery.ts:164` (`tokenPolicy.authoredTokenCeiling`) | all top-ups |

`savedResultRecovery.ts:152` and `webDispatch.ts:428` follow `decideFundedAllowance` unchanged. Shown not to need it:
`webDispatch.ts:127` (whether tokens are finite; a top-up never changes that); `src/control/commands.ts:68-69`,
`migrations.ts:116`, `fundedAllowance.ts:181`, `src/control/schema.ts:44` (confirm or migration, before any run); the
fixed-branch comparisons `retryTask.ts:125`, `:127`, `:186`, `:200`, `src/control/retryGrant.ts:46`,
`src/control/savedResultNoDispatch.ts:22`, `src/control/settleUnknownUsage.ts:70`, `src/control/budget.ts:146`,
`src/panel/controlViews.ts:1126` (`funded===null`) — out of scope by v1's branch rule. The snapshot allocation and
derived contract (`src/control/executionSnapshot.ts:344-349`) and the optional allocation check
(`savedResultRecovery.ts:162`) compare with the unedited base, which is why `work.grant` is never edited.

**Saved-result recovery.** A recovery of a topped-up task is funded from the sum like any later run: its fresh grant
comes from `decideFundedAllowance` (`savedResultRecovery.ts:151-152`), and the saved-recovery check
(`fundedAllowance.ts:115-128`) does not compare the fresh grant with the authored grant. Its policy artifact keeps
`authoredWork` = the confirmed base (`savedResultRecovery.ts:160`, `:166`) and the run's `tokenPolicy` names the sum
(`:164`, switched above). No refusal; criterion T11.

**The command.** `retry-task` gains an optional `work: Amount` (each dimension a non-negative safe integer, or omitted;
absent dimension = 0) in the raw and effective payload schemas (`src/control/webProtocol.ts:805`) and the CLI
(`src/commands/domains/work.ts:254-256`). A `work` that is all zero (or `{}`) is refused `retry-top-up-empty`; a token
top-up on a task whose authored tokens are `null` is refused `retry-top-up-no-effect:tokens`. Inside the apply, after
every eligibility check of the branch and before any write: authorise (below), check the group's non-token headroom
(below), append the row. A retry without `work` is unchanged byte for byte (no row).

**Who may** (checked inside the apply, so every refusal is booked):
- **A person** — the command's routed principal has person authority (`routedPersonAuthorityFor`,
  `src/control/commandClient.ts:67-68`: an owner on the Web, or an owner's person token on the socket, never a run Orca
  dispatched) — always, within the headroom rule. A member without person authority is treated as an agent.
- **An authorized agent** (retry-task is open to every principal, `src/panel/humanOnly.ts:22`) — only up to
  `agentTopUpCap`, below. Refused `retry-top-up-not-authorized` when the cap is `null`, `retry-top-up-cap-exceeded:<dimension>`
  when the group's sum would pass it.
- **A run Orca dispatched** — refused `retry-top-up-dispatched-run`, as it is refused `agent` (`src/panel/permissions.ts:76-79`).
- **orca-auto** never sends `work` (its retries: `webService.ts:820-823`, `:883-887`, and the quota probe's).
- The row's `by` is the routed principal (else the actor) and `personAuthority` the boolean above.

**The cap.** `agentTopUpCap: Amount | null` is a **global** orchestration setting (orchestration settings have no group
key: `src/control/orchestration.ts:47-53`, `readOrchestrationSettings`, `:95`), set by `set-orchestration-settings`,
which only a person may send (`humanOnly.ts:64`). Default `null` = agents may not top up. Its bound is applied **per
group**: for each dimension, the sum of the amounts of the group's top-up rows with `personAuthority = false`, plus the
incoming one, must not pass the cap. (§0 says "a cap a person set for the group"; one global value bounding each group
is the controller's reading, §6.)

**Headroom (non-token limits).** The topped-up remaining must fit the group's non-token limit as the claim will check it
(`fundedAllowance.ts:86`): for `activeMs`, `attempts`, `sessions`, `used + reserved + remaining + handoff ≤ limit`.
Otherwise the retry is refused `group-budget-unavailable:<dimension>`, booked, and a person raises the limit first
(`set-limit`, human-only). Tokens need no retry-time check: the claim's joint allocation already gives what the group and
the spend caps have.

**The board.** The task's budget view shows each top-up in v1: one line `+<amount>, by <by>, at <at>`, so a run's grant
above the confirmed allocation is never unexplained.

## 3. What does not change

`work.grant` on the optional-policy path after the task's first run (it is still edited before the first run by
`setTaskLoop`, `src/control/webService.ts:2112`, `:2204`, and on the fixed branch by `retryTask.ts:200` and
`src/control/stopIntent.ts:1011`, both untouched); every earlier run's allowance check; `set-limit`; the fixed and
saved-result no-dispatch branches; a retry without `work`.

## 4. Criteria (each seen red on its named mutation in a `git clone --local` copy)

`tests/control/retryTopUp.test.ts`:

| # | Case | Mutation |
|---|---|---|
| T1 | unlimited group, attempts exhausted; person `retry-task` with `work: {attempts: 2}` ⇒ applied; the claim persists a `funded_allowances` grant with attempts 2; the earlier run's `readFundedAllowance` still passes; group not blocked | read all top-ups for every run (no `rowid` rule) |
| T1b | as T1 | `retryTask.ts:175` reads the base only (refused `authored-budget-exhausted`) |
| T1c | as T1 | `fundedAllowance.ts:84` sizes from the base (the new run fails `funded-grant-authority`) |
| T2 | `retry-task` without `work` ⇒ grant, rows, command result byte-identical to today and `SELECT count(*) FROM work_grant_top_ups` = 0 | always append a zero row |
| T3 | agent, cap `null` ⇒ booked `retry-top-up-not-authorized` (exact code), no row; a person with cap `null` ⇒ applied | skip the actor check |
| T4 | agent, cap `{tokens: 100000}`, two top-ups 60000 + 60000 on two tasks of one group ⇒ first applied, second booked `retry-top-up-cap-exceeded:tokens`; the same on another group ⇒ applied | check each top-up alone instead of the group's sum |
| T5 | optional-policy group whose `attempts` headroom is below the topped-up remaining ⇒ booked `group-budget-unavailable:attempts`, no row | drop the retry-time headroom check (the task goes `ready` and is never claimed) |
| T6 | `agentTopUpCap` sent by an agent through `permissionRefusal` ⇒ `control-verb-human-only` | classify `set-orchestration-settings` as `any` |
| T7 | after a later top-up, the run it was retried from still computes the same grant, and its `readFundedAllowance` passes | `≤` instead of `<` in the `rowid` rule |
| T8 | the retried run's allowance continuation is admitted and its `readFundedAllowance` passes | `continuation.ts:185` reads the base only |
| T9 | a member (no person authority), cap `null` ⇒ booked `retry-top-up-not-authorized` | treat any Web user as a person |
| T10 | a run Orca dispatched sends `work` ⇒ booked `retry-top-up-dispatched-run` | drop the dispatched-run check |
| T11 | a saved-result recovery after a top-up is funded from the sum and its `readFundedAllowance` passes; `tokenPolicy.authoredTokenCeiling` names the sum | `savedResultRecovery.ts:164` writes the base |
| T12 | `work` on a fixed-branch task ⇒ booked `retry-top-up-unsupported:finite-legacy`, the grant unchanged | drop the branch rule |
| T13 | `work: {}` ⇒ booked `retry-top-up-empty`; tokens top-up on a `null`-token task ⇒ booked `retry-top-up-no-effect:tokens` | accept them |
| T14 | the task's budget view lists the top-up line | drop the line |

## 5. Open questions

None left for the reviewer. For the human, only if the controller's reading in §6 is wrong: whether "a cap a person set
for the group" (§0) must be a per-group value rather than one global value applied per group.

## 6. Controller decisions (reversible; session 86352010, after review round 1)

- v1 covers the optional-policy branch only; the other two branches refuse `work`, booked.
- Ordering by the retried run's `rowid` (`from_run_id`); no `seq` column.
- The five readers in §2 switch; recovery gets a criterion, not a refusal.
- "Person" = person authority via `routedPersonAuthorityFor`, checked inside the apply; dispatched runs refused;
  orca-auto never sends `work`.
- `agentTopUpCap` is a global orchestration setting whose bound is summed per group.
- A retry-time headroom refusal for non-token limits.
- The board shows top-ups in v1.

## Review round 1 — resolutions

Review: `scratchpad/review-specs-probe-topup.md` (reviewer subagent, session 86352010, 2026-11-06, on `2618eeb2`).

| Finding | Resolution |
|---|---|
| B-C1 sizing is at claim, not in `retry-task` | §1 states it; §2 readers table switches `fundedAllowance.ts:84` and `retryTask.ts:175`; T1, T1b, T1c. |
| B-I1 ordering key undefined | §2 Ordering: `from_run_id` + `rowid`, with the proof; `seq` dropped. |
| B-I2 three branches; T5 on the wrong branch; silent claim skip | §2 Scope (v1 optional-policy only, others refused, booked); §2 Headroom; T5 replaced; T12. |
| B-I3 who may | §2 Who may (person authority inside the apply, member = agent, dispatched run refused, orca-auto never); T9, T10. |
| B-I4 cap is "the group's" but settings are global | §2 The cap: global value, summed per group, stated plainly; T6 rewritten at the route layer; §5 names the remaining human question. |
| B-I5 criteria not red-able (T2, T3, T5, T7) | T2 asserts the row count; T3 exact code plus a person case; T5 replaced; T7's mutation is `≤` vs `<`. |
| B-I6 missing criteria | T8 (continuation), T11 (recovery), T9/T10 (member, dispatched run), T12 (fixed branch), T1 claims the run. |
| B-I7 §0 vs §2 on who reads a top-up | §2 states the ceiling semantics; §0 kept verbatim (its "only the new run reads" is read as "no earlier run reads"). |
| B-M1 line citations drifted | Re-read at `660b4bdf`: `:114-148`, `:135`, `:136`, `:143-144`, `:115-128`. |
| B-M2 "never edited after confirm" false | §3 says "on the optional-policy path after the task's first run" and names the other writers. |
| B-M3 `null` tokens | `null + n = null`; refused `retry-top-up-no-effect:tokens`; T13. |
| B-M4 empty or zero `work` | Refused `retry-top-up-empty`; T13. |
| B-M5 payload schema and CLI | §2 The command names both. |
| B-M6 how the cap sum is read | §2 The cap: rows with `personAuthority = false` plus the incoming one (refusals leave no row). |

## Correction (owner ruling, 2026-11-06) — an attended agent may set the global cap

The owner chose one global `agentTopUpCap`, summed separately for each group, and asked to let authorized agents set
it. This replaces §2's person-only setter and T6's old expectation; the old text remains as history. The socket tier
of `set-orchestration-settings.agentTopUpCap` is `open`, as for the rest of that verb. An Orca-dispatched run remains
refused by the verb's existing dispatched-run rule. Web members remain refused by the human-only verb. Every accepted
change has a command ledger row identifying its actor. The cap is therefore an adjustable operating limit, not an
immutable ceiling on the agent that may change it. A top-up still cannot raise a run above its confirmed contract.
| Simpler alternative (frozen ceiling per run) | Not taken: it drops the authority check and the record of who raised it. |
