# Task 2 report: Human-only constants

Status: DONE. Commit 91d63cb `feat(panel): name the human-only command surface` (src/panel/humanOnly.ts, tests/panel/humanOnly.test.ts only).

## Implementation
src/panel/humanOnly.ts verbatim from brief (HUMAN_ONLY_VERBS=["set-limit"], HUMAN_ONLY_FIELDS for requirement-open.limit and proposal-edit.proposedGroupLimit, empty AGENT_AMOUNT_FIELDS, humanOnlyRefusal).

## Tests (2)
1. C19 schema walk: every amount field is covered or listed with a reason. 2. Refuses verb and two fields only (incl. non-object payload, inherited property).
Schema walk result (probed once, probe removed): exactly ["proposal-edit:proposedGroupLimit","requirement-open:limit","set-limit:limit"]. No extra amount fields; AGENT_AMOUNT_FIELDS stays empty.

## Deviation
Brief's cast `z.ZodObject<z.ZodRawShape>[]` failed typecheck (TS2344: needs `verb`). Changed to `z.ZodObject<{ verb: z.ZodTypeAny } & z.ZodRawShape>[]`. Walker logic unchanged; ZodEffects.innerType() works as in brief.

## TDD evidence (outputs in scratchpad/n2)
- RED: `npx vitest run tests/panel/humanOnly.test.ts` -> t2-red.txt: "Failed to load url ../../src/panel/humanOnly.js", rc=1.
- GREEN: t2-green.txt 2 passed rc=0. `npm run typecheck` rc=0 (after cast fix; first run rc=2 on the cast).

## Mutations (clone scratchpad/n2/mut-t2, node_modules symlinked; each restored with git checkout, `git diff | wc -c` = 0)
| Mutation | Result |
|---|---|
| (a) HUMAN_ONLY_VERBS = [] | both tests red: walk "expected ['set-limit:limit'] to equal []"; refusal "expected undefined to be control-verb-human-only" |
| (b) delete "proposal-edit" entry | both red: walk lists proposal-edit:proposedGroupLimit; refusal undefined vs control-field-human-only |
| (c) `name in payload` | refusal test red ("expected {...} to be null"), walk test stays green as intended |

## Concerns
None. Full suite not run (only this task's test + typecheck).
