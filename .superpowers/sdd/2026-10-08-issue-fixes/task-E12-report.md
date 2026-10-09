# Task E12 report (evidence only; no commit, no source or test edit). HEAD 5bc96ab, worktree Orca-issues2, 2026-10-09
Scratch: /private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/3156185d-8cf1-4260-9808-1f8a45883555/scratchpad/orca/E12/
(e12-tc.txt, e12-build.txt, e12-ws.txt, e12-server.txt, e12-rerun{1,2,3}.txt). Env ECC_GATEGUARD=off DISABLE_OMC=1.

## Results
- Step 1 `npm run typecheck`: rc=0.
- Step 2 `npm run build --workspace web`: rc=0.
- Step 3 `npm run --ws check`: rc=0.
- Step 4 `vitest run tests/control tests/panel tests/entry`: rc=1; Test Files 1 failed | 213 passed | 8 skipped (222);
  Tests 1 failed | 2120 passed | 55 skipped (2176); 203.99 s; load 8.74 at the end (uptime 09:12, load 3-9 during the run).
  Red: tests/control/activityRuns.test.ts "run-settled and endedAt > a driver run gets endedAt when it lands, kept through
  settle, and a run-settled row for each of landed and settled" -- "Test timed out in 5000ms" (the full run).
  Single-file reruns at load 6.7 / 7.0 / 6.6 (9:13): rc=0, rc=0, rc=0 (e12-rerun1..3.txt). Passes alone three times.
  Not on the handoff §3 / brief flake list by name; the ledger already records this test as a load-flake candidate
  (B8/B9 minor: "B4's 'driver run gets endedAt…' … time out at 5 s under load 9-11, green alone and with --testTimeout=30000").
  Suggestion for the final fix wave: a 30 s timeout like driverSettle's (D7 precedent).

## Ledger text to add (do not edit progress.md from this task)
Task E12: closing check at 5bc96ab. typecheck rc=0; web build rc=0; `npm run --ws check` rc=0; tests/control+panel+entry
rc=1 with exactly one red, activityRuns "a driver run gets endedAt when it lands…" 5 s timeout (uptime 09:12, load 8.74),
green alone x3 (rc=0, 0, 0 at load 6.3-7.0). 2120 passed, 55 skipped (8 files skipped, e.g. handoffE2E / real-ccloop
environment). Same test already recorded as a load-flake candidate under B8/B9; not a regression.

### Rewritten existing tests (part-E table), cross-checked against `git log c786e84..HEAD` (whole round)
| Test | Rewriting commit | Check |
|---|---|---|
| web/tests/dependencyGraph.test.tsx "draws nothing for a group without dependencies…" -> "draws every task even when no task depends on another"; "draws one button per task…" gets category | f7e61b4 (E9) | only commit touching the file in the round; diff +48/-? |
| web/tests/taskLabels.test.tsx "lists the manifest's entries and downloads one with the session alone" (activity request first) | 2d3e401 (E11) | only commit touching the file |
| tests/entry/skill.test.ts three count tests 29 -> 32 (routes/verbs/rows) | 6a90702 (D3 retry-task, 29 -> 30), bcf5584 (E3, 30 -> 32; E6's route-table half moved into E3 by amendment 6); 0b33417, 670bd4e (E6) add prose tests | `git diff c786e84 HEAD` shows toBe(29) -> toBe(32) x3; the table's "30 before E" is the post-D value; c57493f touches the file for a D5 test |
Beyond the table (all named rulings in the ledger, not table rows): i18nPseudo.test.tsx enum-family count (ebe9882 D2 164->165; 2d3e401 E11 33/165 -> 34/178), controlI18n.test.tsx (b9cf916 C3; 2d3e401 E11 heading query narrowed to "a 的运行"), activityRuns run-resumed test (c57493f D5). E9/E10 added web/tests/{contrast,styles}.test.ts cases and archiveGroup.test.tsx, taskActivity.test.tsx (new files, A status).
Part E rewrite commits since 92da0e6: f7e61b4, bc2db85, a089391, 58825bc, 2d3e401, 5bc96ab (7 lines of `git log 92da0e6^..HEAD`); E1-E8 commits are inside the merged 92da0e6 ancestry.

### Mutations seen red (clone made after the commit named; paths as the reports give them)
- E1 (9f137ff): drop currentRunBlocked; ready always idle; drop held -- 3 red. Clone removed (no path recorded in the report).
- E2 (f6db4fd): clone removed; report records worktree diff --cached 0/0.
- E3 (bcf5584): m1..m10 in a clone of bcf5584; outputs m*.txt in e34dc963 scratchpad .../e34dc963-cc97-4bb3-b662-27fd62c9d359/scratchpad/orca/E3/.
- E4 (87c16c3): clone at 87c16c3, discarded; outputs scratchpad orca/E4/.
- E5 (f66998b via clone HEAD 7d9aaeb; fix 04d2876): two clones, both deleted; wt-proof.txt in scratchpad orca/E5/ (0/0 bytes).
- E6 (0b33417, 670bd4e): local clone; delete archive-group row -> 3 red; delete Notes sentence -> "teaches the rules" red.
- E7 (dd06449, 7d9aaeb): swap archived/attention lines; drop review; readGroupFilter without guard -- 3 red.
- E8 (80043fc): clone of 80043fc under scratchpad orca/E8/, discarded; worktree 0/0.
- E9 (f7e61b4, bc2db85): m1-m7 plus stall-colour mutations in clone at session-e34dc963 scratchpad orca/E9/clone and clone2 (left behind, rm -rf was denied; to be removed by the human or with permission); outputs mut-m*.txt. Not mutated: the prefers-color-scheme block alone.
- E10 (a089391, 58825bc): clone made after the commit, outputs m2-*.txt in scratchpad orca/E10/; 22 mutations red per fix round.
- E11 (2d3e401, 5bc96ab): six mutations in a discarded clone (delete RunActivity line, true&&, remove phase branch, drop explainRunReason, drop CCLOOP_STEP map, drop changeSeq dep) all red.
Reports for E1-E8 do not print absolute clone paths; E9's two clones remain on disk under the e34dc963 scratchpad.

### Flags carried by the part (controller rulings already in the ledger): archive guard codes (Ruling flag 1), claimEstimate/requirement-export skip (flag 2, E5), no duplicate checks (flag 3), Running for never-started group with edges (flag 4), legacy applyCommand ungated (flag 5), names assumed from B/D (flag 6), archivedMark.ts leaf module (flag 7, no ruling needed).
