# Task 1 report: ccmem data-root guard

Files: tests/setup/ccmemRoot.ts, tests/setup/relocateCcmem.ts, tests/memory/ccmemGuard.test.ts, vitest.config.ts (code transcribed verbatim from the brief).

## TDD
- Red (`$OUT/t1-red.txt`, exit 1): `Failed to load url ../setup/ccmemRoot.js ... Does the file exist?`, no tests.
- Green (`$OUT/t1-green.txt`, exit 0): 1 file, 4 tests passed. `npm run typecheck` exit 0.

## Mutations (in a `git clone --local` copy with the working-tree files copied in; clone deleted afterwards)
| M | Edit | Expected red | Seen |
|---|---|---|---|
| G1 | ccmemRootDiff body -> `return [];` | both "flags" tests | "flags a new migration backup...": expected [] to deeply equal [ "new migration backup: global.db.bak.1" ]; "flags the database disappearing...": expected [] to deeply equal [ 'global.db disappeared' ]. 2 failed, 2 passed |
| G2 | delete the `if (had.has("global.db") ...) out.push(...)` line | "flags the database disappearing" | that test: expected [] to deeply equal [ 'global.db disappeared' ] (1 failed) |
| G3 | remove `BACKUP.test(name) && ` | "ignores what ccmem's own daemon..." | that test: expected [ Array(1) ] to deeply equal [] (received "new migration backup: metrics.jsonl") |
| G4 | relocateCcmem.ts: REAL_ROOT = fresh temp dir containing global.db; afterAll first writes global.db.bak.9 there, before the compare | file fails in the hook | "FAIL tests/memory/ccmemGuard.test.ts" suite failure: AssertionError: this test file changed the real ~/.claude/ccmem (Rule 17): expected [ "new migration backup: global.db.bak.9" ] to deeply equal [] at tests/setup/relocateCcmem.ts:23; the 4 tests themselves passed |

Outputs: `$OUT/mut-G1..G4.txt`.

## Full root suite (`$OUT/full.txt`, exit 1, load average ~26 at start)
Test Files 1 failed | 271 passed | 9 skipped (281); Tests 1 failed | 2497 passed | 46 skipped (2544). The one failure: tests/control/driverRequirementSplit.test.ts "Test timed out in 5000ms" (known load flake). Rerun alone (`$OUT/rerun.txt`, load ~21): exit 0, 8 passed.
