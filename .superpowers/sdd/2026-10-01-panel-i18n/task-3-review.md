# Task 3 review — 545f881..bd6ccfc

Reviewer subagent of session e604b1ba (controller session_01GCbsgLfqFPgpeG3gTbBkbh), 2026-10-01, reviewing commit `bd6ccfc`.
Inputs: task-3-brief.md, task-3-report.md, review-545f881..bd6ccfc.diff, spec §3.1/§6.3/§6.8/§6.9, global.md, progress.md
(taskAmendments H18 ruling). Reviewer clone: `$SCRATCH/rev-t3` (kept, per P10).

### Spec Compliance

- ✅ Spec compliant.
  - §3.1 view shape: `src/control/webProtocol.ts` `loopPlanViewSchema` = the nine fields, `.strict()`, `planName`/`summary` gone; `maxFiles` from `contract.safetyPolicy.maxFilesTouched` and `hasDiscipline` from the registry (`src/panel/controlViews.ts` taskPlanView, diff l.231-242). The web mirror `web/src/controlTypes.ts` `LoopPlanViewV1` matches. `describeLoopPlan`/`countOf` are removed (diff l.99-126). The only remaining `planName` hits are the unrelated `agentSelection.ts:66,69` (checked with `git grep` over the repo, excluding docs and .superpowers).
  - Versioned keys `loopPlan.plan.<id>.v<n>.{name,discipline}`: `web/src/LoopPlanCard.tsx` `planText`. They are used by the title, the lines, the picker (`LoopPlanCard.tsx:167`) and the chip (`ControlGroupView.tsx:132`). `WEB_LOOP_PLANS[].name` is replaced by `version`.
  - §6.3: `web/tests/loopSummary.test.tsx` is **byte-identical to the brief**. I checked this myself by extracting brief lines 63-176 and diffing against `git show bd6ccfc:web/tests/loopSummary.test.tsx`: rc=0, empty. It covers 5 plans × v1/v2 × 4 cases = 40 rows, with 1 and 2 paths, protected and not, cap 1/25/none, and 1 and 2 checks. The implementer's capture cmp (`t3-rows-cmp.txt`) ties the rows to `describeLoopPlan` at 545f881.
  - §6.8: `tests/control/loopPlanViewFields.test.ts` is also byte-identical to the brief (same method, rc=0).
  - §6.9: `tests/panel/taskLoopApi.test.ts:77-95` walks every (planId, version) of the registry: English equals the registry and Chinese has the same keys. A count check stops extra English versions.
  - §2 plural rule: only `files`/`checks` take `_one`/`_other`, and zh carries both with the same text (`web/src/locales/zh.ts`).
  - H18 rewrites: all named files are there, each with the comment line. The extra `tests/control/taskAmendments.test.ts:60-61` rewrite is exactly the controller's ruling (progress.md).
  - Brief deviations: layout only (rewrapped doc comments, de-indent). P12's narrower leftovers grep and P1's `.mts` capture follow the controller's rulings.
- ⚠️ Cannot verify from the diff: none that matter. The ccloop-binary E2E (`loopPlanE2E`) was not run, per the brief. It references no removed field (git grep above).

### Strengths

- The builder is a faithful port. `loopSummaryLines` keeps `describeLoopPlan`'s branch order and conditions one for one. The file-cap test now reads the view's `maxFiles`, so the server no longer computes it twice (the old doc on `maxFilesOf`, "Shared with the summary", was correctly trimmed).
- The unknown-version fallback (`planText`, Review Focus 3) never renders an empty title or line, and it is pinned (MT3-7).
- Mutation discipline goes beyond the brief. MT3-1..12 as planned, plus MT3-13..23 under P16: one deletion per `t` site that criteria can see. The named test was red for each (`$SCRATCH/t3-mut-run.txt`, read whole; 24 rows; every restore rc=0). The implementer also probed and reported MT3-24, a site nothing sees, instead of hiding it.
- I checked the new English path with user text that contains i18next syntax (`$SCRATCH/rev3-probe.mts` → `rev3-probe.txt`, rc=0). Goals, paths and labels with `{{count}}`, `$t(common.none)` or `<b>&amp;` render verbatim, as `describeLoopPlan` did (i18next 26.4.2, `skipOnVariables` default).
- **I saw the taskAmendments rewrite go red** (Rule 9), in my clone `$SCRATCH/rev-t3`:
  - First try: passing the archived task to `taskPlanView` (`controlViews.ts:563`) short-circuited at `:59` (`amended`). That does not measure `:61`, so it doesn't count.
  - Second mutation: `inputs: { ...task.loop.inputs, goal: task.loop.inputs.goal.replace(", as amended", "") }`. Result rc=1, red at `tests/control/taskAmendments.test.ts:61:42`, `expected 'write a' to be 'write a, as amended'` (`rev3-mut2-amend.txt`).
  - Restore: `git diff` + `git diff --cached` = 0 bytes (`rev3-mut2-restore.txt`).
  - The rewrite keeps the criterion's intent: the view shows the amended recipe, not the archived one.

### Issues

#### Critical (Must Fix)
None.

#### Important (Should Fix)
None.

#### Minor (Nice to Have)

1. **The Plan picker's option text can be observed, and no criterion sees it.** `web/src/LoopPlanCard.tsx:167` renders `planText(option.planId, option.version, "name")` as visible `<option>` labels. They change with the language ("Bug fix (red first)" becomes "修 bug（先红后绿）").
   - No web test reads the options: `grep option` over `web/tests/loop*.tsx` has no hits.
   - So swapping the text for `option.planId`, or reading the wrong `version`, would stay green. Only the version *value* is pinned, by the taskLoopApi parity check (MT3-9); how the picker uses it is not.
   - Task 11's pseudo-locale criterion would catch a hard-coded English name if its fixture renders the editor. It would not catch the id-substitution mutation, because "bugfix"/"standard" are not English resource values.
   - Cheap fix: in `loopPlanEdit.test.tsx`, assert `getAllByRole("option").map((o) => o.textContent)` equals the five names in en, and one Chinese name after `changeLanguage("zh")`, with the id-substitution deletion mutation seen red.
   - Severity is Minor because P16 lets the implementer list unseen sites instead of adding criteria.
2. **The card's `useTranslation()` (`LoopPlanCard.tsx:186`) cannot be observed in the shipped panel. That is expected, not a criterion gap.**
   - `App` subscribes at `web/src/App.tsx:141` and renders `ControlPanel` (`App.tsx:671`). No component in `web/src` is memoized (`git grep "memo("` found no hits).
   - So a language change re-renders the whole tree down to `LoopPlanCard`, with or without the card's own subscription. That is why MT3-24 stays green over the whole web suite.
   - The only place it shows is a harness that renders `TaskDetail` alone and switches language inside `act`. A criterion there would pin the spec §2 convention ("Components use `useTranslation()`"), not user-visible behavior.
   - Recommendation: keep the call, since it is the spec's convention and it protects a future memo boundary. Add no criterion.
3. **Stale doc text in rewritten criteria files** (not in the brief's rewrite list, so left as written):
   - `tests/control/loopPlanView.test.ts:10` still says "names its loop plan in plain words, built server-side from the recipe".
   - The test title at `:16` still says "its summary lines".
   - `tests/panel/taskLoopApi.test.ts:13` still says "the web mirror of the plans' names".
   - All three now describe removed behavior. Fix them in a later docs pass, not by changing criterion titles now.
4. **Nothing pins the verbatim handling of user text shown above.** The byte-identical-English guarantee for goals and paths depends on i18next's `skipOnVariables` default. A future init option or major upgrade could change it silently. Possible fix: one row in `loopSummary.test.tsx` with a goal containing `{{x}}` and `$t(common.none)`.

Observations (not findings):
- The implementer's first zsh copy left a single junk file in their own clone and removed it with non-recursive `rm -f`. That is inside their scratch clone, so it does not conflict with P10.
- The SQLite `ExperimentalWarning` in the root test output is pre-existing noise, not from this task.

### Assessment

**Task quality:** Approved

**Reasoning:** The view, schema, mirror, resources and builder match spec §3.1. The §6.3/§6.8 criteria are verbatim from the brief, and every `t` site the criteria can see has a deletion mutation seen red. I also saw the extra H18 rewrite go red myself. What remains is one observable but unpinned site (the picker options) and doc drift, both Minor.
