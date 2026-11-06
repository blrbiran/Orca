# retry-task: a work top-up for the retried run, without rewriting the task's grant (design)

Who: Claude Code (Opus 5.5), session 86352010, 2026-11-06, on Orca `660b4bdf`.
Status: the human approved the direction (below); this text is the controller's design, not yet reviewed.

## 0. Human rulings (verbatim)

- Session 3cfc2e73, on who may change a retried task's agent: 「想要增加被授权的 agent 的能力，可以不止是人才允许。」
- Session 86352010, on the controller's recommendation for the `retry-task` work grant ("never edit a started task's
  grant; append a top-up that only the new run reads; a person may always grant it; an authorized agent may, up to a cap
  a person set for the group; non-token dimensions use the same mechanism; write a short spec first"):
  「都同意按你的建议走」.

## 1. The problem (evidence, Orca `660b4bdf`)

- `readFundedAllowance` (`src/control/fundedAllowance.ts:114-157`) checks every run's stored allowance against the
  task's **current** authored grant: `authored = work.grant.work` (`:146`), `authoredTokenCeiling === authored.tokens`
  (`:147`, else `funded-authored-policy`), and for `activeMs`, `attempts`, `sessions` the run's grant must **equal**
  `remainingBudget(authored, inherited)` (`:154`, else `funded-grant-authority`).
- So raising `work.grant.work` for a retry makes every earlier run of the task fail its own check (observed in session
  3cfc2e73: `recovery-blocked`), and the read model reports the group blocked.
- Today's exits: a limited group has `set-limit` plus a retry (D2). A task in an **unlimited** group that exhausted a
  non-token dimension (its attempts, active time or sessions) has none (D1–D4 spec criterion 13).

## 2. Design

**Record.** A top-up is an append-only row, never an edit of `work.grant`:

```
work_grant_top_ups(group_id, work_item_id, seq, body)   -- body: { amount: Amount (non-negative, each dimension),
                                                        --         commandId, by, at }
```

One row per applied `retry-task` that carries a `work` amount. A schema migration adds the table (no rewrite of rows).

**Reading it (the identity rule, kept exact).** For a run *R*, the authored grant is the task's `work.grant.work`
**plus every top-up whose command applied before *R* was created** (the top-up's `seq` is ordered with the run rows by
the command that created both; the plan names the exact ordering key and proves it total). `readFundedAllowance` uses
that sum where it uses `authored` today (`:146-154`). Then:

- an earlier run sees no later top-up, so its check is unchanged byte for byte;
- the retried run sees the top-up, so its larger grant equals `remainingBudget(authored + topUps, inherited)`.

Every other reader of `work.grant.work` as "the authored grant" is listed by the plan (`grep -rn "grant.work" src`) and
each is either switched to the same "as of run" sum or shown not to need it.

**The command.** `retry-task` gains an optional `work: Amount` (each dimension a non-negative safe integer, or omitted;
absent dimension = 0). Applied inside the retry's transaction: append the top-up row, then size the new run's grant as
today from the summed authored grant. A retry without `work` is unchanged byte for byte.

**Who may.** A person: always. An authorized agent (the actor kinds `retry-task` admits today): only up to the group's
`agentTopUpCap: Amount | null` (orchestration settings, set only by a person; default `null` = agents may not top up).
The cap bounds the **sum** of agent-made top-ups on the group, per dimension. A refusal is booked
(`retry-top-up-not-authorized`, `retry-top-up-cap-exceeded:<dimension>`).

**Limited groups.** A top-up does not raise the group's `limit`; the new run's reservation must still fit (today's
admission). A top-up that cannot be reserved is refused as today (`group-reserve-insufficient`), so a person raises the
limit first (`set-limit`), as D2 already offers.

## 3. What does not change

`work.grant` (never edited after confirm); every earlier run's allowance check; `set-limit`; the saved-result recovery
funding path (`:115-132`), which reads its own frozen authored work — **[the plan verifies whether a recovery run of a
topped-up task must see the top-up; if yes, it is a separate change and the top-up is refused for such tasks in v1]**.

## 4. Criteria (each seen red on its named mutation in a `git clone --local` copy)

`tests/control/retryTopUp.test.ts`:

| # | Case | Mutation |
|---|---|---|
| T1 | unlimited group, attempts exhausted; person `retry-task` with `work: {attempts: 2}` ⇒ new run's grant attempts 2; the earlier run's `readFundedAllowance` still passes; group not blocked | read the current sum (all top-ups) for every run |
| T2 | `retry-task` without `work` ⇒ grant, rows and command result byte-identical to today | always append a zero row |
| T3 | agent actor, cap null ⇒ `retry-top-up-not-authorized`, booked, no row | skip the actor check |
| T4 | agent actor, cap `{tokens: 100000}`, two top-ups 60000 + 60000 ⇒ second refused `retry-top-up-cap-exceeded:tokens` | check each top-up alone instead of the sum |
| T5 | limited group, top-up beyond the reserve ⇒ `group-reserve-insufficient`, no row | append the row before the reservation check |
| T6 | `agentTopUpCap` set by an agent ⇒ refused (person-only setting) | drop the person check on the setting |
| T7 | a later top-up never changes an earlier run's computed grant (read twice around it) | order top-ups by `at` instead of the plan's key |

## 5. Open questions (reviewer first)

1. The ordering key between a top-up and the runs (§2): rowid of the command, or the run's own creation command.
2. Recovery runs of a topped-up task (§3).
3. Whether the board shows top-ups (a line in the task's budget view) in v1.
