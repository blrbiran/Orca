# Task 7 report: orca-control skill

Status: DONE. Commit c7a50b5 `docs(skill): teach agents to operate Orca through orca control` (SKILL.md + tests/entry/skill.test.ts only).

Tests: `npx vitest run tests/entry/skill.test.ts` -> 5 passed (red first: SKILL.md absent -> suite failed; then a 32-char selectionsHash in my first draft turned the payload test red, fixed to 64 hex).

Deviations / concerns:
- Brief's test says `routes.size` is 23; controlApi.ts has 22 `path: "/api/control/..."` routes (the 23rd verb, `shutdown`, has no route). Test pins 22 with a comment.
- Beyond the brief the test also checks verb-per-route against controlApi.ts and safeParses every payload example against its raw payload schema (all 22 satisfiable statically; set-limit is valid but human-only). Footnote in the skill: live-state refinements (real ids/hashes, loop plan exists, provenance `model` needs estimateId) are not statically checkable.
- Commit trailer uses "Claude Sonnet 5.5" per the harness attribution reminder; common.md says Opus 5.5 (conflict, flagged).
- Command-result lookup scopes documented as `groups/@repository:<repoId>/commands/<id>` and `groups/@operator:<operatorId>/commands/<id>` (the spec's `groups/<scope>/commands/<id>` form with the scope from controlApi targets); not exercised against a live panel.

Mutations (clone $SCRATCH/mut-t7, restored with git checkout; `git diff | wc -c` = 0 and `git diff --cached | wc -c` = 0 afterwards):
1. Deleted the `recovery/retry` table row -> route-set, verb-map and payload-count tests red (m1.txt).
2. Renamed `workspaceMode` to `mode` in an example -> payload-schema test red naming the route (m2.txt).
