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

// Metrics (MetricsView): the three rate tiles and the data-health row under them.
/** The small muted heading over a figure (a tile's, and the data-health row's by descendant selector below). */
export const metricLabel = "m-0 mb-1 text-xs font-semibold text-muted";
export const metricTile = "metric-tile rounded-card border border-line bg-well px-[14px] py-3";
export const metricValue = "m-0 text-figure font-bold tracking-[-0.02em] text-fg-strong tabular-nums";
export const metricNotes = "mt-[6px] text-xs text-muted";
export const metricCaveats = "m-0 pl-4 text-xs text-muted";
export const metricHealth = "metric-health flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-3 [&>div]:flex [&>div]:flex-col"
  + " [&_h2]:m-0 [&_h2]:mb-1 [&_h2]:text-xs [&_h2]:font-semibold [&_h2]:text-muted [&_p]:m-0 [&_p]:text-sm [&_p]:tabular-nums";

// Usage (UsagePanel).
/** A row of labelled controls (the pickers, the new-cap form, the calendar form), bottoms aligned. */
export const controlRow = "my-3 flex flex-wrap items-end gap-3";
/** DESIGN.md "Tables": a table that may be wider than the page scrolls inside its own box. From 761px a headed table keeps
 * 520px; below it the sheet's own `.section-pane table:has(> thead)` rule keeps 40rem (a utility here would override it). */
export const tableScroll = "max-w-full overflow-x-auto md:[&_table]:min-w-[520px]";
/** The two-column groups table has no width to defend: no minimum at any width, so it never scrolls on its own. */
export const tableScrollNarrow = "max-w-full overflow-x-auto [&_table]:min-w-0";
