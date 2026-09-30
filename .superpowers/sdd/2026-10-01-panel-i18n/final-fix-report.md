# Final-review fix wave — report

Implementer: fix-wave subagent of session `e604b1ba`, 2026-10-01. Base `2bcd2b0` (local `main`). Contract:
`implementer-dispatch.md`; requirements: `final-review.md` (C1, Minors 2, 3, 4, 9) and progress.md line "Final review".
Scratch: `$S` = `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/e604b1ba-577a-4ce7-8f12-db0a3ee0d5b1/scratchpad/fixwave`.
Mutation clone: `$S/clone` (`git clone --local` at `2bcd2b0` + this wave's four files copied in, `node_modules` symlinked; kept).

Status: **DONE_WITH_CONCERNS** (concerns at the end; none blocks).

## Commits

- `0698645` fix(control): keep a label-chosen loop task's chosenBy on a budget-only change — item 1 (C1).
- `c73b220` fix(web): show an unknown label source as sent; correct stale criterion text — item 2 (Minors 2, 3, 9).
Both messages read back with `git log -1 --format=%B` (`$S/body1.txt`, `$S/body2.txt`): trailer lines exact.

## Item 1 — C1

- Fix: `src/control/webService.ts:630` kept path is now `keptExpansion(taskId, repoPath, { ...current.loop!, inputs: structuredClone(payload.inputs) })`
  (override `chosenBy: "explicit"` dropped), plus two comment lines at :626-627 naming why. The non-kept path
  (`expandLoopPlan`) still records `explicit`.
- New criteria, new file `tests/control/setTaskLoopLabels.test.ts` (no existing criterion edited). Fixture: plan-file task
  `a` with `labels: ["bug"]` and no `plan` (→ `bugfix`, `chosenBy: "labels"`), estimate driven to `ready` as in the
  reviewer's probe (`$SCRATCHPAD/final-review/clone/tests/control/zzProbeLabelsSuggestion.test.ts`, read):
  1. one-click suggestion (`workProvenance.tokens` = model) is accepted; view stays `chosenBy "labels"`, `chosenByLabel "bug"`,
     `amended false`; estimate `stale false`.
  2. budget-only change (no provenance): estimate `stale false`; `chosenBy "labels"`, `chosenByLabel "bug"` (the web title
     reads these two fields, so "not chosen by hand" is pinned at the server field it is built from).
  3. input change: `chosenBy "explicit"`, `chosenByLabel null`, `amended true`, estimate `stale true` (reviewer's (c)).
- Red before, on HEAD sources (main tree, before the edit): `$S/red-head.txt` rc=1 — test 1 red `estimate-stale`, test 2
  red `stale` true; test 3 green (guards the non-kept path, which HEAD already had right).
- Green with fix: `$S/green-fix.txt` rc=0, 3/3.
- Mutations (clone; each restored by `cat orig > file` then `cmp` rc=0; outputs read whole):
  - M1 restore the `chosenBy: "explicit"` override → `$S/m1.txt` rc=1: tests 1 (`estimate-stale`) and 2 (`stale` true) red.
  - M1b same mutation with the earlier short-circuiting assertions removed (clone-only test edit, diff in
    `$S/m1b-testdiff.txt`) → `$S/m1b.txt` rc=1: test 2's `chosenBy`/`chosenByLabel` assertion seen red on its own
    (`explicit`/`null`). Test 1's post-change `chosenBy` assertion cannot go red by itself: the refused command rolls back.
  - M2 non-kept path passes `current.loop?.chosenBy` → `$S/m2.txt` rc=1: test 3 red on `chosenBy`.

## Item 2 — Minors

(a) Stale doc text (Minor 2):
- `tests/control/loopPlanView.test.ts:10-12` doc comment now says the view carries the recipe's fields and the panel builds
  the words. The test title at :17 said "its summary lines", which is false now; the test carries the "Rewritten under
  human ruling H18" and "H19" comments, so it is named by H18/H19 and I **renamed** it:
  "shows the plan, how it was chosen and its summary lines for a loop task" →
  "shows the plan, how it was chosen and the fields its lines are built from for a loop task". No assertion changed.
- `tests/panel/taskLoopApi.test.ts:13-14` doc comment: "web mirror of the plans' names" → versions plus the English plan
  texts pinned to the registry. Comment-only.

(b) `labelSource` raw fallback (Minor 3): `web/src/TaskDetail.tsx` gains `labelSourceText(source)` (`i18n.exists(key) ? t : source`,
enumText's shape; `labelSource` is under `control.task`, not `enums`, so enumText itself cannot be used). New criterion
`web/tests/labelSourceFallback.test.tsx`, one `it` per language: an unknown source `imported` shows as sent, `operator`
shows its words (exact line text, en and zh).
- Red before (HEAD `TaskDetail.tsx`): `$S/web-red-head.txt` rc=1, 2/2 red (`labels from control.task.labelSource.imported …`,
  `标签来自control.task.labelSource.imported …`). Green: `$S/web-green.txt` rc=0.
- M3 drop the fallback (`return i18n.t(key)`) → `$S/m3.txt` rc=1, en and zh red. M4 bypass t (raw value always) →
  `$S/m4.txt` rc=1, zh red on `标签来自operator` vs `标签来自操作者` (en is identical by construction: en's word is "operator").

(c) zh-enum completeness (Minor 4): **already covered, nothing done.** `web/tests/i18nPseudo.test.tsx:274-308` (Task 11)
reads every value of every `en.enums` family (30 families / 146 values pinned at :286-287) through `enumText` under zh,
requires it to equal zh.ts and to differ from en unless listed (`complexity.S/M/L/XL`), and under en to equal en.ts. It
ran green in the web check below. (`control.task.labelSource` is outside `enums`; its two values are pinned in zh by
`controlI18n.test.tsx` (计划) and the new criterion (操作者).)

(d) `web/vite.config.ts` comment (Minor 9) now ends with
"(`npm run check --workspace web` at 4ff8d23, the full web suite; Task 7 report, …/task-7-report.md)".
See deviation 1 for the commit.

## Runs (main tree, final state, each redirected and read whole)

- Root: `npx vitest run tests/control/setTaskLoop tests/control/estimate tests/control/driverEstimate tests/control/estimator.test.ts tests/control/loop tests/control/taskAmendments.test.ts tests/panel/taskLoopApi.test.ts`
  → `$S/root-run.txt` rc=0: 23 files passed, 1 skipped; 253 passed, 4 skipped. The 4 skips are the real-ccloop gates
  (`estimateE2E.test.ts:59` `describe.skipIf(!realBinary)`, 3; `loopPlanE2E.test.ts:35` runtime `ctx.skip()`, 1) — no
  real binary in this environment; pre-existing gating, not this wave's.
- `npm run typecheck` → `$S/typecheck.txt` rc=0.
- `npm run check --workspace web` (tsc + the whole web suite, which contains every web loop/estimate criterion file:
  `estimateStale`, `loopBudgetRows`, `loopPlanCard`, `loopPlanDraft`, `loopPlanEdit`, `loopSuggestionApply`,
  `loopSuggestionDraft`, `loopSummary`) → `$S/web-check.txt` rc=0: 54 files, 318/318.
- No existing criterion went red at any point.

## Deviations

1. Provenance commit for the 4968 ms: the dispatch said "c9d30ab's parent" (= `c1b77d0`, the timeout commit itself); the
   Task 7 report (line 3, 15) and the final review (Minor 9) both say the measurement was on the Task 7 BASE `4ff8d23`
   (`c1b77d0`'s parent; `c1b77d0` changes only the timeout). I wrote `4ff8d23`, the commit the number was observed at.
2. Minor 2's test-title rename (above) — allowed by the dispatch's rule because the test is named by H18/H19; reported here.
3. Reviewer's (c) (input change still `explicit`) added as a third criterion beyond the two the dispatch named; it is green
   on HEAD by design and has its own mutation (M2).

## Concerns

- The gate agent's clones are at `2bcd2b0`; this wave adds `0698645`, `c73b220` on top — the gate should re-run on them.
- Test 1's post-refusal `chosenBy` assertion cannot be seen red alone (a refused command rolls back); the stale/refusal
  assertions carry it, and test 2's `chosenBy` assertion was seen red alone (M1b).
