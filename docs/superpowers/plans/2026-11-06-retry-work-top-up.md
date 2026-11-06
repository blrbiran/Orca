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
