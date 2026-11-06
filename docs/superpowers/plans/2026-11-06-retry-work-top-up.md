# Plan: retry-task work top-up (implementation of spec 2026-11-06 revision 2)

Who: Claude Code (Opus 5.5), implementer subagent, session 86352010, 2026-11-06, branch `feat/retry-work-top-up` off
Orca `fa593909`. Spec: `docs/superpowers/specs/2026-11-06-retry-task-work-top-up-design.md` (revision 2, with §6 and
"Review round 1 — resolutions").

## Tasks

1. **Record + migration.** `src/control/workTopUp.ts` (leaf: imports `schema.ts` only, off the import cycle): the
   `work_grant_top_ups` row schema, `topUpSum(store, group, task, runId|null)` (the rowid rule), `agentTopUpSum`,
   `withTopUp` (`null + n = null`), `appendTopUp`, `readAgentTopUpCap`. Schema 22 → 23 (`schema22To23WorkTopUps`,
   `CREATE TABLE IF NOT EXISTS`), every `migrateSchema` branch, `store.ts` accepts "22". Move every schema pin "22" → "23".
2. **Readers.** `fundedAllowance.ts` `decideFundedAllowance` (all top-ups; optional tasks only) and `readFundedAllowance`
   (top-ups before the run); `continuation.ts` `available` (all); `savedResultRecovery.ts` run `tokenPolicy` (all).
3. **Command.** `retry-task` payload `work` (partial amount, strict); in the apply: saved-result and fixed branches refuse
   `retry-top-up-unsupported:<branch>`; optional branch: `retry-top-up-empty`, `retry-top-up-no-effect:tokens`,
   exhausted check with all top-ups + incoming, authorise (dispatched run → `retry-top-up-dispatched-run`; person
   authority → yes; else cap null → `retry-top-up-not-authorized`, group agent sum + incoming > cap →
   `retry-top-up-cap-exceeded:<d>`), release, headroom (`group-budget-unavailable:<d>`), append. Activity body gains
   `topUp` only when sent. Codes registered (errors.ts) with en/zh texts.
4. **Authority plumbing.** `CommandContext.dispatchedRun` (commandClient.ts) set by `routedCommandContext`.
5. **Cap setting.** `agentTopUpCap: Amount | null` in the orchestration settings schema and the
   `set-orchestration-settings` payload (null clears; omitted keeps). `humanOnly.ts`: field
   `set-orchestration-settings.agentTopUpCap`, socket tier `token`.
6. **CLI.** `orca task retry --work <json>`; `orca orchestration set --agent-top-up-cap <json> | --agent-top-up-cap-off`
   (human-only flags). `npm run gen:cli-docs`, idempotent.
7. **Board.** Work item view `topUps` (absent when none; one group read); web `BudgetEditor` lists
   `+<amount>, by <by>, at <at>` per task; en/zh.
8. **Criteria** `tests/control/retryTopUp.test.ts` T1–T13, `web/tests/budgetTopUps.test.tsx` T14 (web half).

## Criteria → mutation (each seen red in a `git clone --local` copy; results in "As built")

| # | Mutation |
|---|---|
| T1 | `topUpSum` ignores `runId` (no rowid rule) |
| T1b | retryTask exhausted check reads the base only |
| T1c | `decideFundedAllowance` sizes from the base |
| T2 | always append a row (zero when no `work`) |
| T3 | `authorizeTopUp` returns true for everyone |
| T4a | cap check per top-up alone |
| T4b | cap sum over every group (no group filter) |
| T5 | drop the retry-time headroom check |
| T6a | `set-orchestration-settings` classified `any` |
| T6b | drop the `agentTopUpCap` human-only field |
| T7 | `<=` instead of `<` in the rowid rule |
| T8 | continuation `available` reads the base only |
| T9 | `hasPersonAuthority` treats any Web user as a person |
| T10 | drop the dispatched-run check |
| T11 | savedResultRecovery run `tokenPolicy` writes the base |
| T12 | drop the fixed-branch rule |
| T13a/b | accept an empty `work` / a token top-up on a null-token task |
| T14a/b | the view drops `topUps` / the editor drops the line |

## As built (implementer subagent, session 86352010, 2026-11-06)

Branch `feat/retry-work-top-up`, rebased on Orca main `a5d892f2`. Commits:
`bcae06af` feat (record, migration 22 -> 23, readers, command, authority, cap, CLI, board, pins), `b5b9bcc0` criteria,
`8ceef60b` perf (controller's added scope: poll bench bound), and this As built.

**Migration number.** `schemaVersion` "23"; the step is `schema22To23WorkTopUps` (`CREATE TABLE IF NOT EXISTS
work_grant_top_ups ...` + index), run from every `migrateSchema` branch and `finishMigration`; `store.ts` accepts "22".
A rebase over another migration renumbers it: rename the step, move the pins (list in `bcae06af`'s message).

### Decisions (reversible; each with why)

1. **Cap read in the leaf.** `workTopUp.ts readAgentTopUpCap` reads the `orchestration_settings` row itself (inside the
   retry's transaction) rather than importing `orchestration.ts` into `retryTask.ts` (that module is on the import cycle
   the brief names). `orchestration.ts`'s schema validates the same field on every write.
2. **`agentTopUpCap` is a human-only field with socket tier `token`.** The spec says `set-orchestration-settings` is
   person-only (`humanOnly.ts:64`); on the socket that verb is `open` (SOCKET_TIER), so a socket agent could have set
   the cap. Added `HUMAN_ONLY_FIELDS["set-orchestration-settings"] = ["agentTopUpCap"]` and
   `"set-orchestration-settings.agentTopUpCap": "token"` (and the access-matrix row its build-time check needs).
3. **Headroom checked after the failed run's release, before the row.** The spec says "before any write"; reading the
   group after `releaseCommitment` is exactly what the claim will see, and a refusal rolls the release back with the
   command's savepoint, so the two orders are equivalent.
4. **Order inside the optional branch:** empty -> no-effect:tokens -> exhausted (all top-ups + incoming) -> authorise ->
   release -> headroom -> append. Fixed and saved-result branches refuse `retry-top-up-unsupported:<branch>` after their
   own eligibility checks, before their first write.
5. **Codes:** six new durable codes (`retry-top-up-unsupported` 422, `-empty` 400, `-no-effect` 422, `-not-authorized`
   422, `-cap-exceeded` 422, `-dispatched-run` 422), detail after `:`; the headroom refusal reuses
   `group-budget-unavailable` with the dimension as detail. en/zh texts.
6. **Dispatched run** is known inside the apply via a new `CommandContext.dispatchedRun` (set by
   `routedCommandContext`), so its refusal is booked, as the spec asks (the route layer refuses `--agent`, unbooked).
7. **Row `by`** is the routed principal label (`user:<id>`, `agent:<client>`), else the actor, as the spec says.
8. **Activity** `task-retried` gains `topUp` only when one was sent; the command result is unchanged.
9. **Cap payload:** `agentTopUpCap: Amount | null`; null clears (stored as absent), omitted keeps. CLI
   `--agent-top-up-cap <json>` / `--agent-top-up-cap-off` (human-only flags); `orca task retry --work <json>`.
10. **Board:** work item view `topUps` (absent when none; one `groupTopUps` read per view); the budget editor lists
    `+<dims>, by <by>, at <ISO time>` per task under the allocation table.
11. **Cap scope (spec §5 open question):** kept the controller reading -- one global value bounding each group's sum of
    agent rows. For the human.
12. **Bench (controller's added scope):** `readFundedAllowance(store, run, preRead?)`, `preRead = {work, earlierRuns}`;
    `runViews` passes the decoded work body and the work item's earlier run bodies from its read snapshot. Fixing only
    the work `get` (as asked) left a second bound red (see below), so the lineage read is passed too.

### Criteria and mutations (clone `scratchpad/mutTU` at `33b365c7`, the criteria commit before the rebase -- same tree as `b5b9bcc0` less main's two new commits; restore proof: `git diff` 0 bytes, `git diff --cached` 0 bytes)

Command per mutation: `npx vitest run tests/control/retryTopUp.test.ts -t "<Tn>:"` (T11: the saved-result file; T14b:
`web/` `npx vitest run tests/budgetTopUps.test.tsx`); script `scratchpad/tu-mutate.py`, outputs `scratchpad/tu-mut/<n>.txt`.
Baseline in the clone: 14/14 green.

| # | Mutation | Red at |
|---|---|---|
| T1 | `topUpSum` ignores `runId` | retryTopUp.test.ts:84 `allowance(t, first)` throws `funded-grant-authority` |
| T1b | exhausted check reads the base | :77 retry with work answered `authored-budget-exhausted` |
| T1c | claim sizes from the base | :79 `claimAgain` -> `task-budget-unavailable` |
| T2 | always append a zero row | :101 `rows(t)` 1, expected 0 |
| T3 | everyone is a person | :113 agent's answer null |
| T4a | cap per top-up alone | :149 second answer null |
| T4b | cap summed over all groups | :147 first answer `retry-top-up-cap-exceeded` |
| T5 | no headroom check | :164 answer null |
| T6a | verb classified `any` | :175 member gets `control-field-human-only` (the field entry still refuses) |
| T6b | no `agentTopUpCap` field entry | :176 socket agent refused nothing |
| T7 | `<=` in the rowid rule | :190 second run's check throws `funded-grant-authority` |
| T8 | continuation reads the base | continuation.ts:188 `budget-overrun:a` (resume refused) |
| T9 | any Web user is a person | :121 member's answer null |
| T10 | no dispatched-run check | :130 `retry-top-up-not-authorized` instead |
| T11 | recovery policy writes the base | retryTopUpSavedResult.test.ts:144 99000, expected 100000 |
| T12 | no fixed-branch rule | :225 answer null |
| T13a | accept `work: {}` | :234 falls through to `task-not-retryable` (exhausted fixture) |
| T13b | accept a token top-up on null tokens | :236 answer null |
| T14a | view drops `topUps` | :248 `item.topUps` undefined |
| T14b | editor drops the line | web/tests/budgetTopUps.test.tsx:43 |

### Bench (controller's criterion)

`ORCA_PERFORMANCE_ROOT=<fresh dir> npx tsx tests/bench/controlPollPerformance.ts --seed --expect-optimized --output <dir>`,
in clone `mutTU` (this branch + the bench fixture commit, then `a5d892f2` on main):
- before the change: rc 1, `assertOptimizedBounds` (bench :81) `1 !== 0` -- the work_items body `get` (`scratchpad/tu-bench-red.txt`);
- work `get` only: rc 1, `2 !== 1` -- the per-run lineage `all ... WHERE group_id=?` on runs bodies, masked before;
- both passed: rc 0, every workload (`scratchpad/tu-bench-green.txt`, `tu-bench-green-out/result.json`).

### Gate

- `npx tsc --noEmit -p tsconfig.json` and `-p web`: exit 0 (at `33b365c7`; root again in the clone with the bench change).
- `npm run gen:cli-docs`: regenerated `docs/cli.md`, `skills/orca-control/references/{error-codes,orchestration,task}.md`;
  a second run changed nothing.
- `node scripts/test-affected.mjs --base main` at `33b365c7` (`scratchpad/tu-gate.txt`): 828 files selected (647 root,
  181 web). Root: 32 files / 41 tests red, 5655 passed, 32 skipped. Web: 9 files / 15 tests red, 1651 passed. Nearly all
  are timeouts (test 20-30 s, hooks 10 s) and the Rule-17 `relocateUserData` afterAll seeing the live panel's own
  `~/.orca/control/panel/control.sqlite` and `panel/logs/*` grow during the window (the running panel, not a test).
- The 41 red files alone on the rebased tip with the bench change (`8ceef60b`; `tu-rerun-branch-{root,web}.txt`): web 9/9
  green; root 31/34 green (with the two new criteria files) and 3 red: `startForm` (ECONNRESET + hook timeout),
  `driverReconcileN` (driver deadline), `taskResultPaired` (`revision` 3 vs 2) -- all registered shapes in
  `docs/handoff/known-load-flakes.md`.
- Those 3 alone, alternately main clone (`a5d892f2`) / branch / main / branch (`tu-rr3-{main,branch}.txt`, load 9-31):
  16/16 green on each of the four runs. Classified load; none is this change.
- The full gate was not re-run after the rebase and the bench commit; the rerun above covers every red file plus the
  two new criteria files at the final code.

### Open items (for the controller / the human)

1. **Spec §5 (human):** whether "a cap a person set for the group" must be a per-group value. Built: one global
   `agentTopUpCap`, summed per group.
2. **Spec error, corrected in code:** `set-orchestration-settings` is `open` on the socket, not person-only there
   (decision 2).
3. **A top-up does not raise one run's ccloop budget above the confirmed contract.** `executionDriver.ts withinGrant`
   sends ccloop `min(confirmed contract, run grant)` per dimension (the derived contract is frozen at confirm). A top-up
   re-opens the task's lineage ceiling, so another run is funded; it cannot make a single run larger than the confirmed
   allocation. Not changed (the spec keeps the derived contract unedited); the human may want it named in the UI/help.
4. **Test fixture limit:** `exhausted()` pokes `work.grant.work.attempts` as overGrantExit.test.ts does; that puts the
   work item out of step with the proposal allocation, so `set-limit` answers `recovery-blocked` there. T5 therefore
   uses a top-up of the whole attempts limit rather than lowering the limit.
5. **Bench diagnosis was incomplete:** besides the work_items `get`, the per-run lineage `all` on runs bodies broke the
   next bound; both are passed from the snapshot now (decision 12). The saved-recovery path's single-row source-run get
   (`SELECT body FROM runs WHERE id=?`) remains for saved-recovery runs only; the bench has none.
6. Web has no input for `work` on a retry (the CLI does); the spec asked only for the board line.
