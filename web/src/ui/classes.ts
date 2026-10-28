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

// Tester round 2026-10-28, Tailwind batch 3 (Tasks and the group detail). The *-hook names a test queries stay on the
// element beside these strings (group-card, group-chip, card-goal, ...); the look lives here.

/** Issue-fixes spec §6.4: a group in the Tasks list is a card; the whole card is the button (or the requirement link). Open: tinted with an accent edge. */
export const groupCard = "flex min-w-0 flex-1 flex-col items-stretch gap-[6px] rounded-card border border-line bg-card py-3 pr-12 pl-[14px] text-left text-fg no-underline cursor-pointer"
  + " hover:border-line-strong hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
  + " aria-[current=true]:border-accent aria-[current=true]:bg-accent-subtle";
/** The card and its menu button side by side; the menu button sits over the card's top-right corner. */
export const groupCardRow = "relative flex min-w-0 flex-wrap [&>.refusal]:basis-full";
export const groupMore = "absolute top-2 right-2 z-[1] ms-0 min-h-control min-w-control";
/** Tester #17: what the group is for leads the card; its id and state follow as the smaller line. */
export const groupCardLead = "empty:hidden";
export const groupCardGoal = "basis-full text-sm font-semibold text-fg-strong wrap-anywhere";
export const groupCardName = "text-xs text-muted wrap-anywhere";
export const groupCardDetail = "flex flex-wrap items-center gap-x-[10px] gap-y-[6px] text-xs text-muted [&>progress]:h-[6px] [&>progress]:basis-full [&>progress]:accent-ok";
/** The category chip: quiet by default, tinted by the category (needs attention / running / done). */
export const groupChip = "rounded-full bg-hover px-2 font-medium text-fg-strong data-[category=attention]:bg-danger-subtle data-[category=attention]:text-danger"
  + " data-[category=running]:bg-ok-subtle data-[category=running]:text-ok data-[category=done]:bg-info-subtle data-[category=done]:text-info";
export const groupBadge = "rounded-full bg-danger px-1.5 font-semibold text-on-accent";
export const groupFilter = "my-2 flex flex-wrap gap-[6px] [&>button]:ms-0 [&>button[aria-pressed=true]]:border-accent [&>button[aria-pressed=true]]:bg-accent-subtle [&>button[aria-pressed=true]]:text-fg-strong";
export const groupList = "mt-2 mb-4 grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3 [&>p]:col-span-full";
/** Task 10a: a card's title or goal summary never runs past two lines; the whole goal is in its tooltip. */
export const cardGoal = "line-clamp-2 wrap-anywhere";
/** The status light (Ruling H8). The `led` hook keeps its colour rules in styles.css until the final pass (Board uses it too). */

/** Spec §4.2: a task's label chip; the system kind is tinted, the custom kind has a dashed edge, so the two read apart. */
export const labelChip = "mr-1 inline-block rounded-control px-1.5 text-xs";
export const labelSystem = "bg-accent-subtle text-fg-strong";
export const labelCustom = "border border-dashed border-line-strong text-fg";
/** The whole class lists (hook + look), kept here so no multi-word literal sits in a component (scripts/scan-panel-text.mjs). */
export const labelSystemClass = `label label-system ${labelChip} ${labelSystem}`;
export const labelCustomClass = `label label-custom ${labelChip} ${labelCustom}`;
/** Tester #21: an open task's detail is lifted as a whole card -- the elevated colour, a firm edge and the pop shadow. */
export const taskDetail = "border border-line-strong bg-elevated shadow-float";
/** Tester round 2 §8.2 (H5): a task's goal summary beside its id in the task table, one line. */
export const taskGoal = "inline-block max-w-[40ch] truncate align-bottom";
/** A labelled token field: the hint and the field error sit under the label, outside it (final review M-T10). */
export const tokenField = "mb-[10px] flex flex-col gap-1 text-xs text-muted [&>label]:mb-0";
/** The dependency graph legend's swatch: a small outlined square filled with the category colour (the node rects stay in styles.css). */
export const depSwatch = "mr-1 inline-block size-3 rounded-[3px] border border-line-strong align-middle";
/** An inline confirm (a confirm group): an inset well with a firm edge, inline. Tone comes from data-tone. */
export const confirmInline = "inline-flex flex-wrap items-center gap-2 rounded-control border px-[10px] py-[6px] [&>button]:ms-0";
