/**
 * Shared utility-class strings (tester round 2026-10-28, Tailwind migration; web/TAILWIND-MIGRATION.md §3). A pattern
 * used in more than one component lives here once, so the look has one implementation; a one-off stays inline.
 */

/** DESIGN.md "Tabs": ONE component -- a row over a bottom rule that wraps when narrow. */
export const tabRow = "m-0 flex list-none flex-wrap gap-x-1 border-b border-line p-0";
/** A tab: quiet medium-weight, the open one (aria-current="page") bold over a 2px accent underline. */
export const tabItem = "-mb-px flex items-center border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted no-underline transition-colors"
  + " hover:border-line-strong hover:text-fg-strong focus-visible:rounded-t-inset focus-visible:outline-offset-[-2px]"
  + " aria-[current=page]:border-accent aria-[current=page]:font-semibold aria-[current=page]:text-fg-strong hover:aria-[current=page]:border-accent";

/** A label that sits beside its control on one row (the theme and language pickers), not above it. */
export const inlinePick = "mt-2 flex-row items-center gap-2";
/** Tester #68: a setting's one-line example, muted under its name. */
export const settingHint = "block text-xs text-muted";
/** Tester #67: where a setting's value was set -- a quiet aside, not a badge. */
export const settingSource = "text-xs text-muted";
/** A settings region: long words wrap, fields never widen it, a table scrolls inside it. */
export const settingsRegion = "min-w-0 wrap-anywhere [&_input]:min-w-0 [&_input]:max-w-full [&_select]:min-w-0 [&_select]:max-w-full"
  + " [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto";
/** The change-password form inside Settings (AuthGate): one column, 420px at most. */
export const passwordInSettings = "mb-6 max-w-[420px]";

/** A page's head row: the title (and its counts) on one baseline. */
export const sectionHead = "flex items-baseline gap-3 mb-1";
/** The muted one-line lede under a page title. */
export const sectionLede = "mb-3 text-sm text-muted";
/** A set-apart action area under a detail or a row: a rule above, 16px of air on each side of it. */
export const actionsBox = "mt-4 border-t border-line pt-4";
/** The muted help line under a button or a form (12px). */
export const detailHelp = "mt-1.5 mb-3.5 text-xs text-muted";

/**
 * A decision row is one button that is the whole row: flat, full width, a column of its lines. The open one (aria-current)
 * is tinted with an accent bar on its start edge; hover tints it too, the open one included.
 */
export const decisionRow = "decision-row flex w-full flex-col items-stretch gap-1.5 rounded-none border-0 bg-transparent px-3.5 py-3 text-left font-normal text-fg shadow-none"
  + " hover:bg-hover active:transform-none aria-[current=true]:bg-accent-subtle aria-[current=true]:shadow-bar-start hover:aria-[current=true]:bg-hover";
/** The kind pill's dot, coloured by the kind's importance level (data-level, from kindRank); no level, no dot. */
export const kindDot = "data-[level]:before:mr-1.5 data-[level]:before:size-1.75 data-[level]:before:rounded-full data-[level]:before:content-['']"
  + " data-[level=1]:before:bg-kind-1 data-[level=2]:before:bg-kind-2 data-[level=3]:before:bg-kind-3";

/** A correction that was withdrawn stays listed, struck through (its tone stays none). */
export const withdrawnItem = "correction-withdrawn line-through";
