# Tester follow-up G — implementation plan index

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Each part plan below is a full
> plan in the writing-plans format; this index fixes the order, the shared names and the merge rules between them.

**Spec:** `docs/superpowers/specs/2026-11-12-tester-followup-g-design.md` (§10 and §11 override earlier sections).

## Parts

| Part | Plan | Repos | Merge rule |
|---|---|---|---|
| D — #192, #269, #189 | `2026-11-12-tester-followup-g-part-d-small.md` | Orca | after the small-fix seats (#230, #267, #268, #245) are on main |
| A — no-change completion, requirement review | `2026-11-12-tester-followup-g-part-a-nochange-review.md` | Orca | after D |
| C — task handoffs, Live notes | `2026-11-12-tester-followup-g-part-c-handoff-notes.md` | ccloop C1–C4, then Orca O1–O7 | ccloop to ccloop main; Orca side **not merged to main until the human pushes ccloop and Orca repins** |
| B — budget model | `2026-11-12-tester-followup-g-part-b-budget.md` | ccloop K1–K2, then Orca O1–O8 | same as C |

## Shared names (override the part plans where they differ)

- One model marker: group body `modelVersion: "followup-g"`, stamped at group creation (spec §11). Part A's
  `confirmedUnder`/`confirmedUnderG` and Part B's `budgetModel: "expectation-v1"` both become this field and a single
  reader `isFollowupG(body): boolean` in `src/control/modelVersion.ts`, created by whichever part lands first.
- `web/tests/i18nPseudo.test.tsx` enum count: every part bumps it; recount after each rebase; each bump its own commit
  with `Ruling (2026-11-12, tester follow-up G)`.
- Existing Orca criteria: the human approved rewriting all necessary criteria (「这次批准改写所有必要的判据」); each
  rewrite in its own commit with the ruling comment. Existing ccloop criteria: never rewritten this round (ccloop
  Rule 15 needs per-criterion naming); a ccloop task that would need it stops and is listed for the human.
- `executionDriver.ts` is touched by #230, #267, D, A: land in that order, rebase each on the previous.

## Gates

Each Orca task: `TMPDIR=/tmp ORCA_CCLOOP_BIN=<ccloop build> node scripts/test-affected.mjs --base=<task base>` to a log
read back whole, named mutations in a `git clone --local`. Each ccloop task: `npx tsc --noEmit -p .` and the affected
vitest files. Full gate only at release (Rule 18). Load on this machine reached 150–230 with seven seats; run at most
three seats at once.
