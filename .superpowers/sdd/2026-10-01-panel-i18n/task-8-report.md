# Task 8 report: the budget editor, the rest of the loop plan card, the width proxy

Implementer: subagent of controller session e604b1ba, 2026-10-01. BASE c9d30ab, branch `main` (local only; nothing pushed).
SCRATCH = `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/e604b1ba-577a-4ce7-8f12-db0a3ee0d5b1/scratchpad`.

Status: DONE_WITH_CONCERNS. The concerns are an evidence-format deviation and one site that can't be observed; see the end of this report.

## Commit

- `f1ec75b` feat(web): translate the budget editor and the loop plan card. The message was read back with `/usr/bin/git log -1 --format=%B > $SCRATCH/t8-msg.txt`, and the two trailer lines are exact.

## What was built

- `web/src/locales/en.ts`: 11 enum families (`proposalState`, `ownerKind`, `bucket`, `allocationState`, `dimension`, `complexity`, `confidence`, `handoffControl`, `handoffExecution`, `budgetEnforcement`, `fieldProvenance`), `budget.*`, and the `loopPlan.*` additions. The values were inserted verbatim from the brief's code blocks by a script, not retyped.
- `web/src/locales/zh.ts`: the same keys, with the brief's Chinese values verbatim.
- `web/src/BudgetEditor.tsx`: `provenanceText` now translates at call time and keeps its signature. `observedEnforcement` and every row of the brief's render table were converted.
- `web/src/LoopPlanCard.tsx`: `FIELD_LABEL`, `BAD_BUDGET` and `BAD_FILE_CAP` became `FIELD_KEY` key lookups. `payloadOf`, `consequenceOf` (signature kept), `LoopPlanEditor` and `LoopPlanCard` were converted, including "Plan summary" (P17). The Git line uses `<Trans>` with `<code>`.
- `web/tests/budgetI18n.test.tsx`: the brief's two tests verbatim, plus these additions:
  - Test 1 asserts the `thead th` texts exactly (P3). It also asserts the first three cells of row b, every `td small` (the change-in-card and provenance notes), every `span.sr-only` label, the group-limit label texts, and the region name "预算提案".
  - The brief's loop-card test also asserts the hand-written region "做法 b".
  - New test "shows the budget editor's other states in Chinese…" covers the confirmed state, frozen-at-confirmation, not-chosen mode, the handoff-execution enum, deficit, usage-unknown, the complex-1m-default and system provenance, the unknown observed enforcement (no profiles), the stale-estimate notice, and the loop-row "采用 N" button with its accessible name.
  - New test "names every field of the change form, the plan summary and each frozen state in Chinese" covers:
    - the summary list name
    - the Change plan button
    - the started and not-open freezes
    - all 12 label texts and all 12 control aria-labels, each checked exactly
    - the bad file-cap alert
    - the returned, unchanged, and multi-part (ms and attempt units, "；" separator) consequences
    - the shortfall alert
  - New test "names each plan in the plan picker in the chosen language (Task 3 review)": the option texts are pinned exactly in English and Chinese (carried item 3).
- `web/tests/i18nWidth.test.ts`: the brief's test verbatim.

No existing criterion was edited (H18: none named for this Task).

## Runs (each redirected to a file and read back)

| Step | Command | Output | Result |
|---|---|---|---|
| Red | `(cd web && ../node_modules/.bin/vitest run tests/budgetI18n.test.tsx tests/i18nWidth.test.ts)` | `$SCRATCH/t8-red.txt` | rc=1. Four budgetI18n tests red (English text or names). i18nWidth red: "expected 62 to be greater than or equal to 85". The picker test was already green before the change (Task 3 converted it); it is proven by OPT-idswap below. |
| Green | the brief's Step 4 vitest list (11 files) | `$SCRATCH/t8-green.txt` | rc=0, 11 files, 49 tests |
| Web check | `npm run check --workspace web` | `$SCRATCH/t8-web-check.txt` | rc=0: tsc clean, 50 files, 286 tests passed, none skipped |

The W5, W6, draft-kept and "No file limit" criteria stayed green with unchanged English: `loopSuggestionApply`, `estimateStale`, `loopSuggestionDraft` and `loopSummary` all pass in the web check.

## Mutations (clone `$SCRATCH/mut-t8`, kept)

Setup:
- Clone: `$SCRATCH/t8-clone.txt`, rc=0.
- Copy check: `$SCRATCH/t8-copy.txt`, 0 bytes.
- Runner: `$SCRATCH/t8-mutate.py`. It applies one exact edit, runs the named criterion from the clone, then restores with `cat` and checks with `cmp`.

Restores: all 92 restore files are 0 bytes (`t8-<name>-restore.txt` and `t8-<name>-compact-restore.txt`), and every `cmp` returned rc=0.

Summaries: `$SCRATCH/t8-mutations.txt`, `t8-mutations-2.txt`, `t8-mutations-compact.txt`.

### The brief's mutations

All were seen red (full default output in `$SCRATCH/t8-<name>.txt`, read whole):

| Mutation | Red in |
|---|---|
| MT8-1 (dimension header raw) | test 1. The `thead th` array showed `tokens`/`activeMs`/`attempts`/`sessions` (P3). |
| MT8-2 (field button aria-label English) | test 1. `getByRole` could not find "对 b 工作 token 采用 2000000". |
| MT8-3 (provenance raw) | test 1 (`模型 est-1`) and the other-states test (`human`, `complex-1m-default`, …). |
| MT8-4 (bad-budget literal) | loop card test (`预算要填正整数`). |
| MT8-5 (unit = dimension) | loop card test ("预算 +500 tokens…") and the change-form test. |
| MT8-6 (Git line without Trans) | loop card test (`<code>` in the text) and `loopPlanCard … > shows the work budget and the two dimensions the contract cannot express (D1)`. |
| MT8-7 (zh `budget.applyAll` widened) | `i18nWidth` ("expected 30 to be less than or equal to 23"). |
| OPT-idswap (option text becomes `option.planId`) | the picker test (received `standard`, `bugfix`, …). |

### Per-site mutations

Each put raw English back at one site. Every `t` site became `i18n.getFixedT("en")(sameKey…)`, and every `enumText` site became the raw value. Repeated sites were mutated one occurrence at a time.

All of these were seen red:

- BudgetEditor `t` sites: provModel, unknown, frozen, region, heading, modeLine, notChosen, softNote, contextUnavailable, handoffBlocked, none, th owner, th bucket, th state, th suggestion, changeInCard, useFor (loop, field), use (loop, field), applyRowFor, applyRow, staleEstimate, applyAll, rationale, rationaleLine, groupLimit, setLimit, handoffAt, ledger, deficit, usageUnknown, save, reestimate, confirmWaits, confirm.
- BudgetEditor `enumText` sites: fieldProvenance, budgetEnforcement, proposalState, budgetMode, handoffControl, handoffExecution, ownerKind, allocationState, bucket (td, loop useFor, sr-only, field useFor, applyRowFor), dimension (loop useFor, sr-only, field useFor, limit label), confidence.
- LoopPlanCard sites: badFileCap, unit, budgetTaken, budgetReturned, shortfall, the shortfall dimension enum, unchanged, partSeparator, started, notOpen, changePlan, changePlanFor, draftBehind, planLabel (text, aria), field label (text, textarea aria, input aria), discard, region (hand-written, loop), handWritten, summary.goal, summary.doneWhen, summaryRegion, checkCommands, budgetLine, git (English literal), skills.

### Site that can't be observed

- `enumText("complexity", task.complexity)` (mutation BE-e-complexity: rc=0, green). The Chinese values equal the English ones (S, M, L, XL, as the brief specifies), so no rendered text can tell the two apart.

## Deviations and why

1. **Evidence format for 82 of the 92 mutation runs.** The first 10 (MT8-1..7, OPT-idswap, BE-provModel, BE-unknown) were read whole from the default reporter's output. The default output of all 92 runs totals 368 KB and 12,247 lines, because each testing-library `getByRole` miss prints the full role list. Reading all of it would have overrun the Rule 6 per-task context budget.
   - The remaining 82 (BE-frozen onward) were rerun with a compact custom reporter (`$SCRATCH/t8-compact-reporter.mjs`). It prints every test's state and full name plus the first line of its first error.
   - That combined output (`$SCRATCH/t8-mut-compact-all.txt`, 667 lines) was read whole.
   - The full default outputs of the first pass stay on disk at `$SCRATCH/t8-<name>.txt` for anyone who wants every line.
   - This trims error messages to their first line (the line vitest itself shows next to a failed test). It removes no test and no state.
2. **Test additions beyond the brief's criterion.** These are the extra assertions and the three extra `it` blocks listed above. They were added under the contract's lesson (every new `t` or `enumText` site seen in Chinese with its exact text) and carried items 1 and 3. The brief's own assertions are unchanged.
3. **Runner incident (no effect on any result).** The first pass aborted on an ambiguous pattern at LC-summary-goal. It had opened the clone's `LoopPlanCard.tsx` for writing before the replacement raised, which left that file empty.
   - Every mutation before it had already been restored, and each `cmp` returned rc=0.
   - I restored the file from the repo, re-checked all six copies with `cmp` (`$SCRATCH/t8-recopy.txt`, 0 bytes), fixed the runner to compute the edit before opening the file, and re-ran the last seven mutations.
   - The clone's `git status` shows only the six Task files, which are expected to differ from the clone's HEAD.

## Concerns

- The width test's key count is only checked against its floor of 85 (it passes). The exact count was not measured.
- Mutation clone `$SCRATCH/mut-t8` is kept, as the rules require. Deleting it needs the human.
