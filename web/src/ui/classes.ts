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

/** Board (tester round 2026-10-28): a card is an inset box; its badges are boxed (not pills) so a second line stays inside the border (issue #58). */
export const boardCard = "cursor-grab rounded-control border border-line bg-well px-2.5 py-2 transition-colors hover:border-line-strong";
export const boardCardBadge = "max-w-full rounded-control wrap-anywhere";
/** The card's open control is a bare button (it was `all: unset`): no chrome, inherited type, no min height. */
export const boardCardOpen = "inline min-h-0 cursor-pointer rounded-none border-0 bg-transparent p-0 text-start text-base leading-[inherit] font-semibold text-inherit shadow-none transition-none hover:bg-hover";
/** Tester #54: a dragged card's refusing columns dim. Padding, edge and fill come from the legacy labelled-section card rule, which out-ranks the old
 *  `.board-column` rule -- and so also its `[data-drop="allowed"]` accent outline, which never painted. Kept as it was (the migration does not change the look). */
export const boardColumnBox = "min-h-[120px] shrink-0 basis-[240px] data-[drop=refused]:opacity-55";

/** Overview: buttons wrap and align left (a goal can be long); each column is bare, not a card inside the Overview card (it out-ranks the
 *  labelled-section card rule); a row is a rule-separated list item. */
export const overviewRowButton = "max-w-full justify-start text-left whitespace-normal";
export const overviewColumn = "m-0 min-w-0 border-0 bg-transparent p-0 shadow-none";
export const overviewRowList = "m-0 list-none p-0";
export const overviewRowItem = "border-b border-line py-4 wrap-anywhere";
