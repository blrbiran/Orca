# Agent group cap — design

## Intent

An attended CLI agent can set a finite token ceiling on an editable group without a person token. The person retains exclusive authority to raise any group limit or return it to unlimited. This implements the user's 2026-11-08 ruling on tester issue #167. The user's simultaneous rulings retain unestimated default confirmation (#145/#160) and the criteria judge's current soft 200k grant (#174).

## Behavior

- `orca group cap <group> --tokens <nonnegative safe integer>` uses the current proposal version and sends `proposal-edit` with an empty operations list, the current group limit with only `tokens` replaced, and a literal `capOnly: true`. It is available to an attended CLI agent without a person token. Existing `group set-limit` and `proposal replace` retain their human-only budget authority.
- The server handles `capOnly` inside the same proposal-edit transaction: exactly zero operations, a supplied full limit, a finite token value strictly below the current token limit (where null means unlimited), and every other limit dimension byte-for-byte unchanged. Otherwise it refuses with a named `agent-group-cap-invalid` error. It checks the current proposal version and all ordinary budget conservation and prestart guards, then reopens the proposal as the existing edit does.
- A forged `capOnly` cannot raise a bound, change other dimensions, change an allocation or remove a cap. The existing human-authorized proposal edit retains its behavior. A member Web session is not promised a new budget action; this is a CLI socket facility.
- An existing draft with unlimited task work may keep those task allocations while the group has a finite soft ceiling; the existing optional token policy and admission accounting determine when it stops. This is a finite *group budget authority*, not a provider-enforced hard per-call charge limit.

## Scope and checks

No migration and no change to prior command bytes when `capOnly` is absent. Pin the wire schema, permission check for an attended agent and a dispatched run, command ledger replay, lower-only transaction including competing proposal versions, and CLI route. Add only new tests for the new branch. No changes to ccloop or ccmem contracts.

## Follow-up boundary

A fresh requirement's `--limit` and a library import's `tokenLimit` still require a person. The agent can cap the draft group after import/accept and before confirm. If a requirement has no editable proposal yet, it cannot use this command until it reaches that stage.
