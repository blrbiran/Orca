# Task B2 report (implementer B2)

Commit 0ed9d2f "feat(control): schema 9 adds the activity table, one-way from 8" (pathspec commit; base 775374a).

Implemented: schemaVersion "9"; schema8To9 (IF NOT EXISTS table + two indexes, AUTOINCREMENT kept per Part B ruling); initialSchema + migrateSchema chain (older versions go through migrate7To8, 8 only gains the table); open allowlist accepts "8"; README note; six assertions rewritten 8->9 with the rewrite comment, two test names renamed; new tests/control/schema9.test.ts (verbatim from brief).

TDD: RED before implementing: 2 of 3 failed ("expected '8' to be '9'", "no such table: activity"); third passes already as the brief predicted. GREEN after: schema9, schema8, commandClient, requirementRecords, store, agentPreferences, workspaceSettings = 7 files, 40 tests, rc=0. npm run typecheck rc=0.

Mutations (clone --local, worktree diff 0 bytes before, clone diff 0 after): (a) drop && version !== "8" -> populated v8 test RED (control-schema-unsupported); (b) drop store.exec(schema8To9) in migrateSchema -> same test RED (hasActivity false); (c) drop + schema8To9 from initialSchema -> fresh-store test RED (and the v8 test via DROP TABLE). All seen red.

Wider run (tests/control + tests/panel, load ~22): 51 failed / 1930 passed. 50 failures are environmental: web/dist does not exist in the worktree (PanelRejection panel-dist-missing; controlSocket, controlSocketGate, controlMount, projectsFileMode, usageRoute, integrationApi, controlShutdown, readyHint) - unrelated to B2, needs "npm run build --workspace web" (not run by me: web/ is the other implementer's area). 1 load flake: driverRecovery "drives a retried run on from where it was blocked" timed out at 5s; passes alone (rc=0). No tests/control failure attributable to B2.

Deviations: README current text said "from schema version 7 to 8"; replaced those two lines with the brief's text. Nothing else.
Concerns: the panel suite cannot be confirmed green until web/dist is built; the controller should run it once after building.
