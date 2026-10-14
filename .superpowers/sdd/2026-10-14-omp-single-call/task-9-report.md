# Task 9 report (Orca): clarify and split send the same bound

Author: Orca session 02f047f6 (Task 9 implementer), 2026-10-14. BASE 39f994c9, commit f00d6910.

## Status
DONE. Commit f00d6910 `feat(control): send clarify and split with the same single-call output bound` (trailers present).

## Changes (applied by quoted anchor text)
- src/control/requirementCommands.ts: `import { singleCallOutputBound } from "./estimator.js";` added after the `estimatorCompatibility` import;
  `maxOutputTokens: preflight.maxOutputTokens,` -> `maxOutputTokens: singleCallOutputBound(preflight.maxOutputTokens, slot.observation.resolution),` (Task 8's helper reused, no re-derived max).
- src/control/requirementRecords.ts: DR8 doc comment kept verbatim; one line appended:
  `OMP single call (spec 2026-10-14 §4; Orca session 02f047f6, 2026-10-14): since then the larger of that and the agent's singleCallOutputCap.`
  (The brief text said "session 7ea088aa"; the dispatch instruction to attribute "Orca session 02f047f6, 2026-10-14" was followed.)
- tests/control/requirementOutputBound.test.ts: new, verbatim from the brief.
- Send path unchanged: src/control/requirementCalls.ts already sends `group.requirement.maxOutputTokens` (verified by grep at BASE).

## Evidence (logs under /private/tmp/osc/logs/, each read whole)
- RED t9-red.log rc=1: `expected [ 'cap-high', 64000 ] to deeply equal [ 'cap-high', 100000 ]` (as the brief expected). This pre-implementation run doubles as the seen-red for the new branch (bound -> preflight value).
- GREEN t9-green.log rc=0: requirementOutputBound, requirementCommands, driverRequirementClarify, driverRequirementSplit, singleCallOutputCap: 5 files, 59 tests passed, 0 skipped/failed. No load-flake reruns needed.
- TYPECHECK t9-tc.log rc=0.
- Staged diff t9-diff.log: 5621 bytes; 3 files, +34 -2.

## Concerns
- No existing test edited. No separate clone-mutation run done for this task (the RED run covers the cap-high branch; cap-low / cap-null branches are guarded by the `?? 0` floor, which Task 10's Mfloor mutation targets).
