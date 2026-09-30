# Task 8 review: the budget editor, the rest of the loop plan card, the width proxy

Reviewer: task-reviewer subagent of controller session e604b1ba, 2026-10-01. Range c9d30ab..f1ec75b (one commit, f1ec75b), read from `review-c9d30ab..f1ec75b.diff`.
SCRATCH = `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/e604b1ba-577a-4ce7-8f12-db0a3ee0d5b1/scratchpad`. Reviewer clone: `$SCRATCH/rev-t8` (kept; `git status` shows only the two node_modules symlinks).

## Spec Compliance

- ✅ Spec compliant. Every row of the brief's BudgetEditor render table, every LoopPlanCard site, the 11 enum families, and the `budget.*` / `loopPlan.*` keys (en and zh) are present verbatim. The diff is BudgetEditor.tsx:31-33, 57-58, 80, 102-107, 131-278; LoopPlanCard.tsx:298-301, 330-335, 358-392, 404-453, 460-501; en.ts:520, 542-559, 582-612, 634-668, 686; zh.ts:704-734, 756-790, 812-822. The two new test files are created. No existing criterion was edited (the diff touches no other test file).
- Carried items:
  - **P3.** Done: `texts("thead th")` is asserted exactly at budgetI18n.test.tsx (diff 911).
  - **P17.** Done: `summaryRegion` is used at LoopPlanCard.tsx (diff 488) and asserted in Chinese (diff 974). Seen red by the reviewer: `$SCRATCH/rev8-summary.txt`. Mutation: the aria-label back to the literal `` `Plan summary ${item.taskId}` `` gives rc=1, with "Unable to find … list … 做法摘要 a". Restore: `rev8-summary-restore.txt` is 0 bytes.
  - **Picker options pinned in en and zh.** Done (diff 1006-1016). The English half really runs in English because `tests/setup.ts` resets to `en` after each test. Seen red by the reviewer: `$SCRATCH/rev8-idswap.txt`. Mutation: the option text set to `{option.planId}` gives rc=1, received `standard, bugfix, refactor, design, investigate`. Restore: `rev8-idswap-restore.txt` is 0 bytes.
- **English byte-identity.** Each removed literal was checked against its en value plus React's JSX whitespace rule:
  - `modeLine` + `softNote`: the newline between two expressions collapses to nothing, as before.
  - `ledger` + `deficit` + `usageUnknown`, `changeInCard` (leading space), `useFor` / `applyRowFor` aria-labels, `rationaleLine`, `budgetLine`, `draftBehind`, and `consequenceOf`'s taken/returned/shortfall/unchanged/`"; "`.
  - The `handoffAt` and `Plan` label text: the trailing newline before `<input>`/`<select>` is dropped, as before.
  - `provenanceText`: `model` with a null or empty estimateId gives "model" (old `.trim()`); a non-empty one gives "model est-1"; `complex-1m-default` gives "complex-1m default".
  - `observedEnforcement`: `common.unknown` = "unknown", `common.none` = "none" (en.ts:103).
  - The enum families' English values equal the raw values.
  - The Git line through `<Trans>` renders `…into <code>orca/g</code>; pushing…`, and the existing `loopPlanCard` D1 criterion pins it (MT8-6 was red there per the report).
  - No difference found.
- **Chinese against spec §5.** 做法 (Plan), 目标 / 完成条件 / 只改 / 不许改, 预算 / 组余量 / 估算 / 建议, 确认预算, 交接, and 活跃时间 / token / 尝试 all follow the §5 term table. The picker names equal §5's plan-name row exactly.
- **This round's features on main**, reviewer run `$SCRATCH/rev8-focus.txt`, rc=0, 8 files, 75 tests. The files were budgetI18n, i18nWidth, loopSuggestionApply (W5), estimateStale (W6), loopSuggestionDraft (draft kept after a suggestion), loopSummary ("No file limit"), loopPlanCard, and budgetSuggestions.
  - In the code, `applySuggestions`, `suggestedLoopActions` and `suggestionActions` are unchanged (diff 85-100, 167, 199, 208).
  - The stale notice is kept (diff 219).
  - `noFileLimit` is untouched (diff 314).
- **Width proxy key count, measured by the reviewer.** The command was a throwaway vitest file in the clone that flattened `en` with the test's own prefixes, output in `$SCRATCH/rev8-count.txt`: NARROW 62 + 23 buttons = **85**, exactly the floor. The report's concern "exact count not measured" is now answered. Dropping any one key family would turn the floor red.
- ⚠️ Cannot verify from the diff: the implementer's 92 per-site mutation runs. I spot-checked 2 of them myself (above) and did not re-run the other 90.

## Strengths

- The implementer went well past the brief's criterion, and every addition is exact:
  - the exact `thead th`, row-b cells, every `td small`, the `span.sr-only` labels and the fieldset labels (diff 911-917);
  - a second budget test for the states the brief's fixture never reached: confirmed, frozen, not-chosen, deficit, usage-unknown, complex-1m / system provenance, no profiles ("未知"), stale, and the loop-row "采用 N" with its name (diff 920-946);
  - all 12 form labels and 12 control aria-labels checked by `toEqual`, not `toContain` (diff 983-990);
  - the returned, unchanged and multi-part consequences, including the "；" separator (diff 993-1001), and the shortfall text (diff 1003).
- `consequenceOf` and `provenanceText` keep their signatures and translate at call time, so their non-React callers see the current language.
- `FIELD_KEY … as const satisfies Record<Field, string>` keeps the per-field compile check the old `Record<Field, string>` gave.
- The report is honest about the one site that can't be observed (complexity) and about the runner incident, and it documents the restore.

## Issues

### Critical
None.

### Important
None.

### Minor
1. **The `complexity` site can't be observed** (BudgetEditor.tsx, diff 230). The zh values equal the en values (S/M/L/XL, as the brief mandates), so no criterion can tell whether `enumText("complexity", …)` is there. This is inherent to the brief's wording, and the report names it. No fix unless the human wants different Chinese labels.
2. **Weak substring assertions in the brief-mandated list** (diff 903, 955): `"桶"`, `"做法"` and `"目标"` would also match other text. They are plan-mandated but harmless: each is backed by an exact assertion (`thead th` at 911; the form labels at 983-986).
3. **Evidence-format deviation** (report §Deviations 1). 82 of the 92 mutation runs were read through a compact first-error-line reporter, not the full default output. The implementer cites the Rule 6 budget. States and test names are preserved and the full logs of the first pass stay on disk. The controller should record this as a deliberate, disclosed deviation from Rule 14's "read whole".

## Assessment

**Task quality:** Approved.

**Reasoning:** Every brief site is converted, and the English values reproduce the old rendered text byte for byte. The Chinese follows spec §5. All three carried items (P3, P17, picker en+zh) are met, and the reviewer saw two of them red by mutation. This round's W5, W6, draft-kept and "No file limit" criteria stay green.
