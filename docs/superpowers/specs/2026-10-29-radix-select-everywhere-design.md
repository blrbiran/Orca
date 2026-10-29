# Radix Select for every picker in the panel

Session b999cc81 (2026-10-29, controller). Human rulings, verbatim: after the trial on branch `ui/radix-select-trial`
(handoff_ui §七.八) 「(a) 全量换」; on the two project pickers 「同意你的建议，换radix selector。但是不要合并成一个。」;
「本轮允许改必要的判据」. Revised after an independent review (same session; findings 1–13 folded in below).

## 1. Scope

- Every native `<select>` in `web/src` becomes the shared `Select` (`web/src/ui/Select.tsx`, `@radix-ui/react-select`
  2.4.1 exact, already on the trial branch). Inventory on the trial tip `9c8c0b10`:
  `grep -c '<select' -r web/src` → 55 elements in 24 components (UsagePanel 5, RequirementsPanel 5, FlowRunPage 5,
  ScheduleSettings 4, ControlPanel 4, IntegrationScheme 3, FlowSettings 3, DecisionsView 3, ProjectControl 2,
  GroupGraph 2, FlowBoard 2, CoarseCorrection 2, ChecksSettings 2, BudgetEditor 2, AgentFields 2, and one each in
  TaskDetail, SettingsPage, MemoryView, LoopPlanCard, FolderImagePicker, DecisionDetail, ChainPanel, AuthGate,
  AgentSettings) plus the `Select.tsx` comment; GlobalSettings' two are already Radix on the branch. One multi-line tag
  (`DecisionsView.tsx:73`); no `multiple`, `<optgroup>`, `defaultValue` or `selectedIndex` anywhere.
- **Both project pickers** (sidebar `ProjectControl`, Settings › This project `ProjectPicker`) change control only.
  **Structure unchanged**: two pickers, one scope, Add/Rename stay in the sidebar (#69/#70 「先不改」; this session's
  「不要合并成一个」).
- Not in scope: layout, wording or behaviour changes (one exception for the human, §4); `<input>`/`<textarea>`; the Board.

## 2. The component

`Select` keeps the trial's look (field-height trigger, list floating in a portal like `Menu.tsx`, ✓ + weight on the
chosen item). Changes from the trial:

- **Props**: `value`, `options`, `onValueChange`, optional `name`, `disabled`, `placeholder`, `className`; every other
  prop (`aria-label`, `aria-invalid`, `id`, `autoFocus`, `data-testid`, …) is spread onto the trigger. Call sites with
  numeric values (`UsagePanel.tsx:316`) or handlers that read `event.target.value` (`AgentFields.tsx:165`) adapt at
  the call site.
- **Empty values.** Radix 2.4.1 accepts an item with `value=""` but then shows the placeholder instead of that item's
  label (`shouldShowPlaceholder`). The internal EMPTY mapping stays so "All"/"None" show their label. Consequence: inside
  a form the hidden native select posts the sentinel for an empty option ⇒ the type forbids `name` together with an
  option whose value is `""` (the only FormData reader, `ChainPanel.tsx:99/139`, has none).
- **Look rules the native select had**: invalid edge (`aria-[invalid=true]:border-danger`, needed by
  `AgentFields.tsx:242`); the field's 1px focus edge, not the button's 2px outline; 44px minimum height
  (`shellReflow.test.ts:49`). The trial's `min-w-[10rem]` becomes the default only; `className` appends.
- **Parent selectors that target `select`** are retargeted to the trigger (`[&_[data-select-trigger]]`):
  `ProjectControl.tsx:139` (`[&_select]:w-full`), `ui/classes.ts:27` (`settingsRegion`, min/max width).
- Long lists: Radix scroll buttons; max height stays `min(360px, available)`.
- Labelling via a wrapping `<label>` works (`getByRole("combobox", {name: "Project"})` checked in jsdom); no select
  sits in a Dialog; z-index needs no change.

## 3. Criteria

- **Tests drive the control the way a person does, never the hidden native select.** Radix renders a hidden native
  `<select>` (with real options, whose `onChange` sets the value) whenever the trigger sits in a `<form>`, `name` or
  not — old test shapes would stay green without touching the new control. Helpers in `web/tests/`:
  `pickOption(trigger, name)` (focus, open by keyboard, choose by accessible name) and `optionsOf(trigger)` (open,
  return `[name, disabled]` for every `role=option` in order, close) for criteria about the offered list (order,
  disabled placeholder, zh text). The trial's jsdom shims (`scrollIntoView`, pointer capture) move to
  `web/tests/setup.ts` with `??=` (two files replace and restore `scrollIntoView`).
- Rewritten test files: those matched by
  `grep -rlE 'HTMLSelectElement|HTMLOptionElement|selectedOptions|select\[name|fireEvent\.change\([^)]*([Ss]elect|combobox)' web/tests`
  (count reported as printed at batch 0). Each keeps what it protects (which value reaches the command, which scope is
  chosen, which options are offered); a `Ruling:` line names 「本轮允许改必要的判据」.
- New criteria for `Select`, each with its mutation seen red in a `git clone --local` copy:
  empty option shows its label and round-trips as `""` (mutation: EMPTY mapping removed → trigger shows the
  placeholder); disabled option cannot be chosen (drop the `disabled` passthrough); `name` posts a non-empty value
  through `FormData` (drop `name`); trigger named by its wrapping label (wrap the trigger in an `aria-hidden` span);
  invalid edge present (drop the class). Project pickers: one wired to page-local state instead of the scope → the
  scope criterion red.
- Updated with the native CSS: `styles.test.ts` (select chevron), `shellReflow.test.ts:49`. In `styles.css`
  (`:269,275,277,278,283,348`, shared `input, select, textarea` rules) only the `select` selector is removed.
- **Done** (on the branch), each exit 0:
  `test -z "$(grep -rln '<select' web/src | grep -v 'ui/Select.tsx')"`;
  `! grep -rnE 'HTMLSelectElement|HTMLOptionElement|selectedOptions|select\[name|fireEvent\.change\([^)]*[Ss]elect' web/tests`;
  `npm test` + typecheck (counts copied as printed); `npm run build --workspace web` (bundle delta reported).
  Screenshots at 1280 and 390 px, light and dark: sidebar, Settings › This project, Requirements, Usage (no horizontal
  overflow, no pageerror).

## 4. Accepted costs and one open choice

- Accepted (the human chose (a) knowing them): touch devices lose the native wheel picker; ~+19.5 kB (+7 kB gzip).
- `web/TAILWIND-MIGRATION.md` ("do not replace a native `<select>` … project pickers are frozen") and `DESIGN.md`'s
  field text get a dated correction appended.
- **Open, for the human**: a value not among the options (`FlowRunPage.tsx:236`, a flow's ask form before the person
  picks) — the native select shows the first option although nothing is chosen (submitting sends no value); Radix shows
  the trigger empty. Recommendation: empty trigger with a "Choose…" placeholder (what is shown is what is sent).
  **Human: 「(a)，按你的建议走」** — empty trigger with the placeholder; a criterion pins that nothing is shown chosen
  and nothing is sent until the person picks.

## 5. Plan (serial, one batch at a time, branch `ui/radix-select-trial` rebased on main)

0. Rebase; finish `Select` (§2) with its criteria and mutations; helpers and setup shims.
1. Project pickers (`ProjectControl`, `SettingsPage`) **plus** the RequirementsPanel and ControlPanel selects that the
   same tests (`projectFiltering`, `projectScopeDrafts`) drive.
2. Settings: AgentSettings, AgentFields, ChecksSettings, FlowSettings, ScheduleSettings, IntegrationScheme, BudgetEditor.
3. Work views: TaskDetail, LoopPlanCard, GroupGraph, FlowBoard, FlowRunPage, ChainPanel.
4. The rest: UsagePanel, DecisionsView, DecisionDetail, MemoryView, CoarseCorrection, FolderImagePicker, AuthGate.
5. Native select CSS and its criteria; doc corrections; the §3 done checks (the test-side grep only here); screenshots;
   the human looks before `--ff-only` merge and install.

Each batch ends with `npm test` (selected files, read whole) and a commit; a batch that turns an unrelated criterion
red stops the line.
