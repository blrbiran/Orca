# Task 5 re-review, fix round 1 (edf59e3..dc70658)

Reviewer: scoped re-reviewer subagent, 2026-10-03. Read-only; diff and report read, no tests re-run.

## Finding Verdicts

- I1 (H3): unchanged declaration keeps the frozen entry, nothing spawned -- ADDRESSED.
  src/control/webService.ts profileToLookUp (returns null when the payload profile equals the effective recipe's profile);
  transaction: `skillsUnchanged` -> `frozenSkills` copies `frozen.skills` entry exactly (diff lines ~291-300).
  A changed declaration is the only path to `profileMembers`. Unset ORCA_SYNCSKILL_BIN is only refused when a lookup is needed.
  Tests: tests/control/setTaskLoopSkills.test.ts "a budget-only edit sending the same profile keeps the frozen names and spawns nothing"
  (fake answers differently, calls() == []) and "accepted with ORCA_SYNCSKILL_BIN unset" (undefined and bin:null). Mutation F1 "always re-resolve" reported red on both; the report lists it.
- M2: draft never spawns; confirm race refused with a named code -- ADDRESSED.
  profileToLookUp returns null when `readBudgetProposal(...).state === "editable"`. In the confirmed branch, a changed profile with no lookup result
  throws `proposal-version-conflict`. Tests: the draft test asserts `missing.calls()` == [] and `fake.calls()` == []; the race test forces
  read-as-draft then confirmed and expects `proposal-version-conflict`, no spawn, no `skills` key. Mutations F2 (spawn for draft) and F3 (race check removed) reported red.
- M1: applyWebCommand body re-indented inside the try -- ADDRESSED. Body is uniformly +2 (rawCommand at 8 spaces, apply at 8, body at 10); `git diff -w` is the logic change only, per the report.

## New Breakage in the Fix Diff

None Critical/Important.
- Minor: in the confirmed branch a changed `{profile}` whose pre-read lookup was skipped throws only there; if a concurrent edit changes the recipe between pre-read and transaction, baseLoopVersion check fires first, so the conflict code is reachable only through the confirm race. Fine.
- Minor: an unchanged declaration with a missing frozen entry freezes null (no entry); readConfirmedTaskExecution at the end is the guard.

## Out-of-Scope Observations

None.

## Verdict

Fix round: All findings addressed, no new Critical/Important breakage.
