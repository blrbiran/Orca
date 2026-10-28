# Tailwind migration — rules for the batches

Written by the UI implementer of the tester round 2026-10-28 (controller session a9f9d6de, stage C1), on branch
`ui/radix-tailwind` after the commit `feat(web): the Settings page in Tailwind utilities; its CSS rules deleted`.
Human rulings (ledger `.superpowers/sdd/2026-10-28-tester-feedback-round/progress.md`): Tailwind v4 through
`@tailwindcss/vite`, full migration; the CSS variables in `src/styles.css` stay the **only** theme source; the
controller migrates one page (Settings, done) and cheaper agents migrate the rest in file batches, each reviewed;
criteria that read `styles.css` may be rewritten, each with a `// Ruling: …` line and its own mutation seen red.

Read `web/DESIGN.md` first: it is the look. This file is only how to express that look in utilities.

## 1. Token mapping (`src/index.css`)

Every utility below resolves to a `var(--token)` of `styles.css`, so a theme switch repaints it. Tailwind's own
palette, radii, shadows, type scale and breakpoints are cleared: `bg-blue-500`, `rounded-lg`, `text-3xl`, `lg:` do
not exist (`web/tests/tailwind.test.ts` fails on a default-palette class anywhere in `src/`).

| Utility suffix | Token | Use |
|---|---|---|
| `page` | `--bg` | the page (never inside a box, DESIGN.md "Themes") |
| `card` | `--card` | cards, sections |
| `elevated` | `--bg-elevated` | buttons, menus, the sidebar |
| `well` | `--well` | inset boxes (tiles, notices, detail blocks, nested sections) |
| `field` | `--field` | form fields |
| `hover` | `--bg-hover` | hover fills |
| `line` / `line-strong` | `--border` / `--border-strong` | edges (`border-line`, `border-line-strong`) |
| `fg` / `fg-strong` / `muted` | `--text` / `--text-strong` / `--muted` | text (`text-fg`, `text-fg-strong`, `text-muted`) |
| `accent`, `accent-subtle`, `accent-hover`, `on-accent` | same names | links, the primary, selection |
| `ok` `warn` `danger` `info` (+ `-subtle`) | same names | see §3 "Colour" — not for states |
| `stall` | `--stall` | the graph's stall text |
| `scrim` | `rgb(0 0 0 / 0.45)` | the modal overlay (the one fixed colour) |

| Scale | Utilities | Value |
|---|---|---|
| spacing (`--spacing: var(--space-1)`) | `p-1 p-2 p-3 p-4 p-6`, `gap-*`, `m*-*`, `w-*`… | 4 8 12 16 24 px by default (a candidate theme rescales the step, DESIGN.md "Themes") — use only these steps (plus `0.5`, `px`, `-mb-px`) |
| control height | `h-control` / `min-h-control`, `h-control-sm` | 32 / 26 px |
| radius | `rounded-inset` `rounded-control` `rounded-card` `rounded-full` | 4 / 6 / 10 px / pill |
| shadow | `shadow-raise` `shadow-float` | `--shadow` / `--shadow-pop` |
| type | `text-xs` `text-sm` `text-base` `text-lg` `text-xl` `text-2xl` | 12 13 14 16 18 22 px (h3 = `text-base font-semibold`, h2 = `text-xl`, h1 = `text-2xl`) |
| breakpoint | `md:` (≥ 761 px), `max-md:` (≤ 760 px) | the sheet's one breakpoint; also `pointer-coarse:` |
| fonts | `font-sans` (Inter) `font-mono` (JetBrains Mono) | bundled woff2; the default look keeps `--font`, so do **not** add `font-sans` |
| motion | `transition-colors` etc. | duration `--dur`, easing `--ease` by default |

Arbitrary values (`max-w-[420px]`, `min-w-[170px]`) are allowed for widths and offsets only — never a colour, size
of type, radius or shadow.

## 2. Layers and what stays in CSS

> Sections 2 and 3 describe the batches' state (legacy layer, no preflight). The final pass changed it; see the note at the end of §7.

`index.css`: `@layer theme, legacy, utilities`. `styles.css` is imported **into `legacy`**, so any utility beats any
legacy rule regardless of selector specificity. There is no preflight yet: `styles.css`'s element rules (`button`,
`input/select/textarea`, `label`, `table`, `h1–h3`, `p`, `a`, `fieldset`, `kbd`, `hr`, `[role=…]`, `[data-tone]`) are
the base every page still stands on. Consequences:

- A migrated component **keeps** its native elements' base look for free (a `<button>` is still the secondary
  button). Write utilities only for what the element base does not give, or to override it (the utility wins).
- Stays in `styles.css` until the final pass (do not move, do not delete in a batch):
  - the theme blocks (`:root`, `:root[data-theme=…]`, the system-light `@media` block) — `contrast.test.ts`,
    `lightTheme.test.ts`, `themes.test.ts`, `tone.test.tsx`, `styles.test.ts` read them as text;
  - `.section-pane:not([data-active="true"])` and `.settings-category:not([data-active="true"]),
    .settings[data-active="false"]` — `display: none !important`. Never conditionally render or `hidden` a pane
    (handoff §5.2 item 6), never put a `display` utility on a `.section-pane` / `.settings-category` element;
  - the element base above, `role`/`data-tone` rules, and the shared component classes listed in §3.
- `className` hooks that tests query (`check-field`, `group-card-row`, `settings`, `settings-category`,
  `section-pane`, `nav-item` in the sidebar, `metric-health`, …) stay on the element even when their CSS rule is gone.
  Find them with `grep -rn "<class>" web/tests` before removing a class name.

## 3. Recipes

- **Shared strings live once** in `src/ui/classes.ts` (exported constants). A pattern used by two components goes
  there; a one-off stays inline. Existing: `tabRow`, `tabItem`, `inlinePick`, `settingHint`, `settingSource`,
  `settingsRegion`.
- **Buttons**: the `<button>` element base is the secondary button. Variants stay the component classes `.btn-primary`
  (one per view — `template.test.ts` counts them), `.btn-quiet`, `.btn-danger` until the final pass. Layout-only
  utilities on a button are fine (`ms-0`, `w-full`, `justify-start`). Two adjacent buttons get 8 px from the legacy
  `:where(button, .btn, a) + :where(button, .btn)` rule; a row that spaces itself with `gap-*` adds `ms-0` to its
  buttons (or keeps its class in that rule's reset list until the final pass).
- **Fields**: native `<input>`, `<select>`, `<textarea>` with the element base (one field look, native pickers on
  touch). Do not replace a native `<select>` with a custom one in a batch; the project pickers are frozen by the
  #69/#70 ruling. A label beside its control: `inlinePick`; above it: the bare `<label>`.
- **Tabs**: `tabRow` on the list, `tabItem` on each link/button; the open one carries `aria-current="page"` (links)
  — for the region tabs (`aria-selected` / `aria-pressed`) add the matching `aria-[selected=true]:` /
  `aria-[pressed=true]:` variants to `tabItem` in `classes.ts` (one tab component, DESIGN.md), then delete the
  `.detail-region-tabs` rules.
- **Pills and badges**: keep `.pill` / `.badge` with `data-tone` (the colour comes from the tone, DESIGN.md "Tone,
  not role"); they are shared by four batches.
- **Tables**: the element base (uppercase 12 px headers, 8×10 cells, hover tint); a table that may be wide sits in a
  box with `overflow-x-auto max-w-full`.
- **Cards and wells**: a card is `rounded-card border border-line bg-card shadow-raise p-4`; an inset box is
  `rounded-card border border-line bg-well p-3` (`shadow-none` over a legacy section rule). Note the legacy
  `.section-pane section[aria-label]` rule already paints every labelled section as a card — leave it until the final
  pass and only override where the old CSS overrode it.
- **Menus and dialogs**: only `src/ui/Menu.tsx` (`Menu`, `MenuItem`) and `src/ui/Dialog.tsx`. Inline confirmations
  stay inline `role="dialog"` boxes / `.confirm-inline` (DESIGN.md "Confirmations").
- **Colour**: state colour only through `data-tone` (`info|ok|warn|danger`) on the element; never `bg-danger-subtle`
  or `text-ok` to mean a state. Tone utilities are for the few decorative marks the old CSS already painted that way
  (the status light, legend swatches, the stall text).
- **Numbers that change**: `tabular-nums` (or keep `.num`, which board/flow criteria pin).
- **Reduced motion**: the legacy `@media (prefers-reduced-motion)` block stops every transition; add `motion-safe:`
  only for a new animation.

## 4. Per-file procedure

1. Read the component and every `styles.css` rule whose selector names one of its classes.
2. Replace each class with utilities that reproduce the rule's declarations (same tokens, same breakpoints — a rule
   inside `@media (max-width: 760px)` becomes `max-md:…`; `:hover` → `hover:`; `[aria-current="page"]` →
   `aria-[current=page]:`; a descendant rule `.x td` → `[&_td]:…` on the parent, or utilities on the child).
3. Keep test-queried class names as bare hooks (§2).
4. Delete a CSS rule only when **no file outside your batch** uses any class in its selector list. Check each class
   with a word-boundary search over the className strings, not a substring search (`count`, `label`, `split`,
   `empty`, `content`, `nav` also occur as words in code):
   `grep -rnE "className=[^>]*\\b<class>\\b" web/src` — if it hits a file in another batch, the rule stays and the
   final pass removes it. In a selector list (`a, .b, .c { … }`) remove only your own selector.
5. If a criterion reads the rule you delete (§6), rewrite it to read what now carries the promise (the class string
   in `classes.ts` or the component source), add `// Ruling: human 「这次批准改写所有必要的判据」 (tester round
   2026-10-28, controller session a9f9d6de; <what changed>)`, and run the mutation it names to red.

## 5. Verifying a batch

All of these, on the batch's branch:

- Tests: the serialized gate only — `/private/tmp/orca-a9f9d6de/gate.sh <worktree> <logfile>` (builds web, then
  `npm test`). Read the whole log; report the selected-file count and every skipped file as printed.
- Mutations: in a `git clone --local` copy only; run them through the same gate with `--base HEAD` so only the
  mutated file's tests run; restore and prove `git diff | wc -c` = 0 with `/usr/bin/git`.
- Detector: `/Users/biran/code/skills/UI/impeccable/skill/scripts/impeccable detect --json web/src` — only the
  findings listed in the C1 report may remain (the two `overused-font` lines in `fonts.css`).
- Screenshots: before (build of the batch's base) and after, at 390 and 1280 px in `light`, `dark` and `navy`, of
  every page the batch touches, with the isolated panel and scripts under `/private/tmp/orca-a9f9d6de/ui/scripts/`
  (`panel.sh <distDir> <log>` on port 7811 with a temp HOME and control dir — never the real panel or `~/.orca`;
  `shots.py <outdir> <themes>`, extend its page list; `diff.py <before> <after>` prints changed pixels per shot).
  Expected: 0 changed pixels except data that moves by itself (the epoch line in the sidebar foot, session lists,
  timers). Every non-zero diff is looked at and explained.
- Overflow: `shots.py` records `scrollWidth - clientWidth` per page; every 390 px value must be 0.

## 6. Criteria that read `styles.css` as text

| Criterion | Pins | Batch that must handle it |
|---|---|---|
| `contrast.test.ts`, `lightTheme.test.ts`, `themes.test.ts` | theme token blocks | final (only if the blocks move file) |
| `tone.test.tsx` | `[role=…]`, `[data-tone]` rules, dark block | final |
| `styles.test.ts` | `.authenticated-shell*`, `.sr-only` | 1 (shell), 3 (`.sr-only` → Tailwind's `sr-only` utility) |
| `styles.test.ts` | `.row-question`, `.field-kind[data-level]` | 2 |
| `styles.test.ts` | `.card-goal`, `.group-card*`, `nav[aria-label="Control groups"] button[aria-current]`, `.dep-*`, reduced-motion `.dep-node` | 3 |
| `styles.test.ts` | `.section-pane` hide, `select` chevron, field focus, checkbox accent, label row, adjacent-button gap | final (element base) |
| `shellReflow.test.ts` | narrow-shell `@media` block, `.shell` grid, coarse-pointer block, `.skip-link`, `.notices` | 1 |
| `template.test.ts` | `h1/h2/h3` sizes, `.decisions .section-head h1`, `.btn-primary`, `.project-action:disabled`, `.section-meta` | 1 (`.project-action`), 2 (`.decisions …`), final (rest) |
| `detailRegions.test.tsx` | `.section-pane section.task-detail` after `.section-pane section section` | 3 |
| `taskLabels.test.tsx` | `.label-system`, `.label-custom` | 3 |
| `board.test.tsx` | `.board-card .badge`, `.led*`, `.num` | 4 (`.led` is also used by `GroupList`, batch 3: whoever goes second deletes) |
| `overviewQueueCap.test.tsx` | `.overview-layout`, `.section-pane .overview-layout > section[aria-label]` | 4 |
| `metricsLayout.test.tsx` | `.table-scroll`, `.table-scroll .table-narrow` | 5 |
| `shell.test.tsx` | static markup `class="nav-item"` on sidebar links | 1 (keep `nav-item` as a hook or rewrite) |
| `reviewApp.test.tsx`, `App.tsx` key handler | `.nav-item[href="#decisions"]` | 1 (keep the hook) |
| `web/tests/tailwind.test.ts` (new) | `index.css` layers and colour map, palette ban, important hide rules, fonts | stays; extend if a token is added |

## 7. Batch plan

Disjoint file sets; each batch is independent of the others (only rules whose classes are used by its own files
are deleted). Already done in C1 (Settings): `SettingsPage`, `GlobalSettings`, `ProjectSettings`,
`ChecksSettings`, `FlowSettings`, `AgentSettings`, `AgentFields`, `AgentSelectionEditor`, `OrchestrationSettings`,
`WorkspaceModeSelector`, `IntegrationScheme`, `GitScheme`, `ScheduleSettings`, `PlanLibraryView` (these keep only
shared classes: `.badge`, `.detail-note`, `.section-meta`, hooks), plus `src/ui/*` (new).

| Batch | Files (`web/src/*.tsx`) | Its CSS (delete when done) | Shared — leave for the final pass |
|---|---|---|---|
| 1 Shell and account chrome | `App`, `Shell`, `ProjectControl`, `AuthGate` (the login, account bar, notices, shell wrapper), `ErrorPage`, `BackLine`, `UncertainOperations`, `MultiDirLanding`, `RecoveryView` | `.shell`, `.sidebar*`, `.brand*`, `.nav`, `.nav-item`, `.nav-band-start`, `.dot*`, `.project-*`, `.content`, `.chain-banners`, `.uncertain-operations*`, `.auth-*`, `.account-bar/-name/-role`, `.notices*`, `.authenticated-shell*`, `.skip-link`, the narrow-shell and coarse-pointer blocks' shell parts | `.nav-count` (Board), `.caveat` (Metrics), `.chain-banner` (Chains), `.detail-region-tabs` (App's corrections tabs → move to `tabRow/tabItem` here only if batch 3 already did; else leave) |
| 2 Decisions and corrections | `DecisionsView`, `DecisionList`, `DecisionDetail`, `DecisionOperations`, `MinorToggle`, `ReviewDetail`, `CorrectionsView`, `CoarseCorrection`, `ShortcutsHelp`, `EvidenceLink` | `.filters*`, `.decision-*`, `.row-*`, `.alternatives*`, `.reviewers`, `.corrections*`, `.correction-*`, `.actions`, `.detail-help`, `.minor-toggle`, `.field-kind*`, `.pill-warn`, `.icon-button`, `.section-head*`, `.section-lede`, `.decisions .section-head h1` | `.split*` (Memory), `.detail-block`, `.kbd-hint` (Tasks), `.detail-note`, `.pill`, `.badge` |
| 3 Tasks and the group detail | `ControlPanel`, `GroupList`, `GroupActionsMenu`, `CardGoal`, `ControlGroupView`, `GroupDetailRegions`, `GroupGraph`, `GroupResults`, `DependencyGraph`, `TaskDetail`, `TaskResults`, `AgentTranscript`, `LoopPlanCard`, `BudgetEditor`, `TokenInput`, `ChargeRetry`, `UsageSettlement`, `RunDecisions`, `RunReason`, `RunOutputBound`, `ResultOutput`, `SkillsGiven`, `FolderPlacement` | `.group-*` (card, list, filter, chip, badge, more, row), `.card-goal`, `.task-detail`, `.task-goal`, `.dep-*`, `.label*`, `.budget-allocations`, `.confirm-inline`, `.run-state`, `.token-field*`, `.group-view-keys`, `.sr-only` (→ `sr-only` utility), `nav[aria-label="Control groups"] …`, `.detail-region-tabs` (→ `tabRow/tabItem`, if App's corrections tabs move with it in batch 1, coordinate) | `.led`, `.num` (Board), `.detail-block`, `.kbd-hint`, `.detail-note`, `.section-meta`, `.badge` |
| 4 Requirements, Board, Flows, Overview | `RequirementsPanel`, `RequirementMarkdown`, `SafeMarkdown`, `BoardView`, `FlowBoard`, `FlowRunPage`, `FolderImagePicker`, `Overview`, `ScheduleDetail` | `.requirement-*`, `.split-draft*`, `.board-*`, `.flow-*`, `.overview-*`, `.overview button/progress`, `[data-overview-region]` | `.led`, `.num`, `.nav-count`, `.detail-note`, `.badge`, `.btn-primary` |
| 5 Metrics, Memory, Usage, Chains | `MetricsView`, `MemoryView`, `UsagePanel`, `ChainPanel`, `Refusal`, `RefusalNotice` | `.metric-*`, `.table-scroll*`, `.caveats`, `.stale-bias`, `.memory-*`, `.usage-*`, `.refusal-code` | `.split*`, `.caveat`, `.chain-banner` |
| Final pass (one agent, after 1–5) | — | every rule left whose classes no file uses; the shared classes above become utilities or `@utility` blocks in `index.css`; `.btn-*`, `.pill`, `.badge` become `@utility` (or `ui/` components); the element base moves to `@layer base` with Tailwind's preflight turned on (`@import "tailwindcss/preflight.css" layer(base)`) and re-checked by screenshots; the theme blocks may move to `src/themes.css` (then rewrite the six criteria that read them, path only) | — |

Order: 1–5 in any order or in parallel (disjoint files), each its own commit series and review; the final pass last.
Two cross-batch couplings to coordinate rather than race: the tab component (`.detail-region-tabs` is used by
`App` in batch 1 and `GroupDetailRegions` in batch 3 — migrate both to `tabRow/tabItem` in batch 3 and touch
`App`'s tab markup there only if batch 1 has not started, else leave the rule to the final pass) and `.led` (batches
3 and 4 — the second one deletes it).

**Final pass done** (branch `ui/final-pass`, controller session a9f9d6de, 2026-10-29). Layers are now `theme, base,
utilities`: Tailwind's preflight, then `styles.css`, both in `base` (no `legacy` layer is left: the rules still in
`styles.css` keep their mutual cascade, so no specificity battle changed). `styles.css` holds the theme blocks, the
browser defaults the look keeps after preflight (`revert` on lists, h4–h6, `a` decoration, `small`, `pre`, media
display, `progress`), the element base, the `role` / `data-tone` rules, and the rules on hooks (`.section-pane`,
`.settings-category`, the 760px table rules, `.dep-*`, the pane and category hides). The shared classes are `@utility`
blocks in `index.css` with their old declarations: `section-meta`, `count`, `empty`, `caveat`, `kbd-hint`, `num`,
`nav-count`, `btn-primary`, `btn-quiet`, `pill`, `badge`, `callout`, `split`, `split-list`, `split-detail`,
`detail-block`, `detail-note`, `led` (a neutral edge or fill applies only without a `data-tone`, as the old source order
did). The region and corrections tabs wear `tabButtonRow` / `tabButton` (`ui/classes.ts`); `.detail-region-tabs` is gone.
Deleted as unused: `.btn`, `.btn-danger`, `[role="tabpanel"][hidden]` (preflight's `[hidden]` rule covers it), and
`.callout` / `.chain-banner` left the role rule (every chain banner has a role). Read a class's declarations in
`index.css`; a criterion reads them with `utility()` in `web/tests/sourceClasses.ts`.
