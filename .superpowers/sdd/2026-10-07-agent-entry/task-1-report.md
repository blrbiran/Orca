# Task 1 report: command client attribution in the store

Commit: 3997564 feat(control): record which client delivered each command (on main, not pushed)

## Implemented
- src/control/commandClient.ts (new): CLIENT_HEADER, CLIENT_PATTERN, withCommandClient, commandClientFor, verbatim from the brief.
- src/control/migrations.ts: schemaVersion "7"; schema6To7 (ALTER TABLE commands ADD COLUMN client TEXT); appended to initialSchema and every migrateSchema branch; new fromVersion "6" branch.
- src/control/store.ts: accepted-versions condition also allows "6".
- src/control/commandLedger.ts persistCommandOutcome: client column + extra "?" + commandClientFor(rawCommand.commandId). commands.ts legacy insert untouched.
- tests/control/commandClient.test.ts (new, 4 tests).

## Existing tests changed (beyond requirementRecords.test.ts:25 "6" -> "7")
Three tests simulate an older store by downgrading a CURRENT store (drop tables, set version). A current store now already has commands.client, so the ALTER in the 6-to-7 step failed with "duplicate column name: client". Each now also runs `ALTER TABLE commands DROP COLUMN client` in its downgrade (same technique as the brief's new upgrade test), with a one-line comment:
- tests/control/requirementRecords.test.ts (v5 migration test, also the "7" change)
- tests/control/agentPreferences.test.ts (v4 migration test)
- tests/control/workspaceSettings.test.ts (v3 migration test)
No assertion was weakened. store.test.ts (v1 legacy-schema migration) needed no change.

## Deviation from brief
The test imports node:sqlite via `createRequire(import.meta.url)("node:sqlite")` (as store.ts / store.test.ts do) instead of `import { DatabaseSync } from "node:sqlite"`: Vite failed with "Failed to load url sqlite". DB file name control.sqlite verified in store.ts:79.

## TDD
- RED: `npx vitest run tests/control/commandClient.test.ts` -> rc=1, "Failed to load url ../../src/control/commandClient.js" (after fixing the sqlite import; the first red was the sqlite resolution error). Output: scratch n2/t1.txt.
- GREEN: same command after implementation -> 4 passed (n2/t1b.txt first run; t1c.txt after test fixes, rc=0, includes requirementRecords, agentPreferences, workspaceSettings, store, commandLedger*).
- `npm run typecheck` rc=0 (n2/t1tc.txt).
- `npx vitest run tests/control` (n2/t1ctl.txt): 1271 passed, 1 failed = driverRequirementSplit timeout (5000ms, known load flake); re-run alone: 8 passed rc=0 (n2/t1drs.txt).

## Mutations (clone $SCRATCH/mut-t1, node_modules symlinked; main tree untouched)
| # | Change | Result | Restore |
|---|---|---|---|
| a | commandClientFor ignores commandId match (`context !== undefined ? context.client : null`) | RED: "answers the client only for the commandId..." expected 'cli:claude' to be null | git checkout -- .; git diff bytes 0 |
| b | drop `+ schema6To7` from initialSchema | RED: fresh-store test (no 'client' column) and upgrade test (no such column) | bytes 0 |
| c | delete `fromVersion === "6"` branch | RED: upgrade test, control-schema-unsupported | bytes 0 |
(Mutation outputs: n2/mut-a.txt, mut-b.txt, mut-c.txt.)

## Concerns
1. Step 5 (the INSERT in persistCommandOutcome writing the client) has no test in this task: nothing asserts a row written inside withCommandClient gets the client value, so deleting `commandClientFor(...)` from the .run() args is not caught by any test I have (it would also be a placeholder-count error, so an INSERT mutation would fail loudly in all ledger tests, but a mutation passing null instead would stay green). Later route tasks (cli/mcp) should include an end-to-end attribution assertion; or add a ledger-level test if the controller wants it here.
2. Commit trailer: common.md says "Claude Opus 5.5 (1M context)", the harness attribution reminder says "Claude Sonnet 5.5 <noreply@anthropic.com>"; I used the latter (the actual model). Amend if the controller wants the former.
3. Migration non-idempotency: ALTER ADD COLUMN fails if a store at version <7 already has the column (only reachable by test-style downgrades, handled above).

## Fix round 1 (commit 8244e17 test(control): cover the ledger write of commands.client and its hash exclusion)
Closes concern 1 (the ledger INSERT had no test).
- New tests/control/commandClientLedger.test.ts: drives the real applyWebCommand. (1) a command persisted inside withCommandClient("c-in","cli:x") has client "cli:x"; one outside has null. (2) the same raw command persisted into two fresh stores, with and without a client: raw_request_hash, effective_payload_hash, authority_command_hash and body_json are equal (client excluded from hashes and body); only `client` differs.
- tests/control/commandClient.test.ts: the background test now starts an unawaited timer inside withCommandClient and checks from inside it: same commandId -> "cli:claude", other commandId -> null.
- Command: `npx vitest run tests/control/commandClient.test.ts tests/control/commandClientLedger.test.ts` -> rc=0, 6 passed (n2/t1f.txt); `npm run typecheck` rc=0.
- Mutation 4 (clone mut-t1): `commandClientFor(rawCommand.commandId),` -> `null,` in commandLedger.ts: RED, both ledger tests fail ("expected { client: null ...} to match { client: 'cli:x' }") (n2/mut-d.txt); git checkout -- .; git diff bytes 0.
