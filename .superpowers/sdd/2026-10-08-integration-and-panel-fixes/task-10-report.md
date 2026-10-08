# Task 10 report: grouped token inputs

Branch `feat/integration-schemes`. Commits: ace2c15 (feature), d55aafc (confirm + plain-field tests), b2fe242 (refusal-path tests, explicit separator escapes, dropped an unreachable confirm guard). Not touched: progress.md (shows modified from before this task).

## Converted
- RequirementsPanel: new-requirement token limit; raise-limit form token limit.
- BudgetEditor: allocation grid cells for the `tokens` dimension only; group-limit `tokens` field; `handoffAtContextTokens`.
- UsagePanel: per-cap token field and the new-cap token field.

## Left alone (not token amounts)
BudgetEditor activeMs / attempts / sessions allocation cells and group-limit fields (still plain `inputMode="numeric"` text); ChainPanel maxSessions / maxCostUsd / sessionTimeoutMin (`type=number`); UsagePanel datetime-local pickers and week-start select.

## Design notes
- `web/src/TokenInput.tsx`: parseTokens / formatTokens / shortTokens / `<TokenInput>` per brief. Extensions beyond the brief: `value` may be `null` (empty field, no error: the new-cap field); `readOnly`; `onInvalid` callback.
- Why `onInvalid`: onChange is not called on invalid text (brief), so a parent still holds the last valid number and a Submit/Set/Save would send it while the field shows an error. Parents therefore hold their submit controls while invalid: RequirementsPanel (`limitBad`, button disabled and handler guard), UsagePanel (draft = null, Set/Add disabled), BudgetEditor (sentinel draft `"invalid"`; Save, Set limit, Confirm refuse/disabled). Typing a valid amount clears it; applying a suggestion clears it (draft deleted).
- Field-error style: `<small role="alert" style="color:red">` (same as AgentSelectionEditor). Hint `<small>` shows from 1000 up, `tokens.hint` (en `≈ {{short}}`, zh `约 {{short}}`); new `tokens.invalid` message in both locales. Language from `currentLanguage()` (= i18n.resolvedLanguage).
- Each input has an explicit `aria-label` so the hint/error text does not enter its accessible name.
- Behavior change: clearing a budget token field to empty now shows the field error instead of snapping back to the server value.

## Rewrite inventory (all at least as strict; none loosened)
- tests/memberControls.test.tsx:42 `queryByRole("spinbutton"...)` -> `"textbox"` (input is now text; a spinbutton query would pass vacuously).
- tests/projectScopeDrafts.test.tsx:81 role spinbutton -> textbox; :122 `"10000000"` -> `"10,000,000"`; :131 `"12000000"` -> `"12,000,000"` (display is grouped; typing "12000000" still used).
- tests/requirements.test.tsx:108 role spinbutton -> textbox.
- tests/budgetSuggestions.test.tsx:150 `"7777"` -> `"7,777"` (tokens draft is displayed grouped; activeMs line unchanged).
- tests/controlPanel.test.tsx:153 `value="2500000"` -> `value="2,500,000"`.
- tests/budgetI18n.test.tsx:82, :104 `td small` lists gain the new magnitude hint (`约 300 万`); :84 `fieldset label` first entry is `token约 900 万` (hint lives inside the label). The 1440 万 activeMs cell correctly has no hint.
Added (not rewrites): 2 tests in tests/usagePanel.test.tsx; new tests/tokenInput.test.tsx (31 rows).

## Evidence
- RED: new tests run against src of 4965147 (pre-task) with the new tests: 11 failed (`$S/t10-red.txt`), e.g. no textbox "Token limit", `'3000000'` vs `'3,000,000'`, missing hint. (Pure parse/format rows are green there only because TokenInput.tsx is an added file that checkout does not remove; they are red against any missing/mutated parse, see M1/M2.)
- `npm run --ws check` rc=0, 604 passed (`$S/t10-check6.txt`); `npm run typecheck` rc=0; `npm run build --workspace web` rc=0 (all at b2fe242).

## Mutations (clone `$S/mut-t10-a` at b2fe242, node_modules symlinked; each restore `git diff | wc -c` = 0, `git diff --cached | wc -c` = 0)
| mutation | red test |
|---|---|
| M1 drop U+202F from SEPARATORS | parseTokens > reads "10<U+202F>000<U+202F>000" |
| M2 drop MAX_SAFE_INTEGER bound | parseTokens > refuses "9007199254740992" |
| M3 drop `onInvalid` notification | BudgetEditor confirm/save rows; RequirementsPanel raise row |
| M4 drop min check | TokenInput > refuses an amount under min |
| M5 drop external-value sync | TokenInput > takes a value changed from outside... |
| M6 drop blur reformat | TokenInput > shows grouped, re-formats on blur |
| M7 hint below 1000 | TokenInput > hints the magnitude... none below a thousand |
| M8 / M8b new-requirement handler guard / disabled | RequirementsPanel > sends nothing while the limit text is not an amount |
| M9 raise-limit guard | RequirementsPanel > raises ... not with invalid text |
| M10 Budget set-limit guard | BudgetEditor > saves a typed grouped allocation ... refuses invalid text |
| M11 Budget Save not held by bad draft | same row (valid activeMs edit pending + bad tokens text) |
| M12b Confirm not disabled by bad draft | BudgetEditor > confirms with the typed grouped handoff amount... |
| M13 group-limit tokens plain input | BudgetEditor > groups ...; > sends a typed grouped group limit |
| M14 allocation tokens plain input | BudgetEditor > groups ...; > saves a typed grouped allocation |
| M15 allocation `onInvalid` | BudgetEditor > saves ... refuses invalid text |
| M16 Usage Set not held while invalid | UsagePanel > shows a cap grouped ... holds Set |
| M17 Usage new-cap `onInvalid` | UsagePanel > adds a cap from a grouped amount and not from invalid text |
| M18 Usage row `onInvalid` | UsagePanel > shows a cap grouped ... holds Set |
First pass found M11, M12(guard-only), M17 not red: M17 and M11 got stronger rows; the redundant confirm handler guard was deleted (unreachable behind the disabled button).

## Concerns
- Group-limit `<label>` text now includes the hint inline ("token约 900 万"); cosmetic, pinned in budgetI18n.
- No load flakes observed in the final runs; `uptime` not recorded.

# Fix round 1 (review I1, I2, minor)
Commits: ff5e133 (fix), 079f1e2 (allowEmpty row). Final: `npm run --ws check` rc=0, 609 passed (`$S/t10-check8.txt`); typecheck rc=0; web build rc=0.

- I1 Requirements: `TokenInput` gains `onReset`, called when it replaces its text because the value changed from outside; NewRequirement and RaiseLimit clear `limitBad` with it. Tests: repository switch frees the Start button and shows the new text without an alert; selecting another requirement frees Raise the limit.
- I1 Budget: a stored `"invalid"` draft is dropped on mount (effect), so a fresh editor shows no hold; test starts a stateful editor with stored sentinels: no alert, Confirm enabled, handoff shows 0. A BAD draft keeps value null so its text and error stay together while mounted; a value changing under it is not visible then, so no reset hook is needed there (an earlier `dropBad` was dead and was removed).
- I2: `allowEmpty` + `onClear` on TokenInput; blank handoff text is no error, writes a one-space draft (`BLANK_DRAFT`, since "" means no draft) and `submitConfirm` maps it to `handoffAtContextTokens: null`. Label unchanged. Test: type 150,000, clear: no alert, Confirm enabled and sends null. TokenInput row: with allowEmpty blank is not an error, without it it is.
- Minor: doc comment moved to `tokenValueFor`; `BAD_DRAFT` has its own comment.

Mutations (clone at 079f1e2 lineage; restore bytes 0/0 each):
| mutation | red |
|---|---|
| F1 TokenInput never calls onReset | both I1 Requirements rows |
| F2 new-requirement onReset dropped | new requirement repo-switch row |
| F3 raise-limit onReset dropped | raise-limit selection row |
| F4 budget mount cleanup dropped | budget remount row |
| F5 allowEmpty ignored | TokenInput allowEmpty row (first pass was NOT red through the Budget row; added the direct row, then red) |
| F6 allowEmpty clear not reported | blank handoff row (I2) |
| F7 handoff onClear dropped | blank handoff row (I2) |
