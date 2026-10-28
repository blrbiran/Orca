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

/* Shell chrome (batch 1 of the Tailwind migration): the sidebar, its nav and the status dots. */
// Layout (web/TAILWIND-MIGRATION.md): `narrow` is the one short-OR-narrow screen variant (index.css); `max-md` is the sheet's
// narrow breakpoint. The shell always stands inside AuthGate's `.authenticated-shell` frame, so its viewport-sharing
// rules (the sidebar and the content scroll inside their own panes) are on the elements themselves.
export const shellBox = "shell grid min-h-0 flex-1 grid-cols-[var(--nav-width)_minmax(0,1fr)] overflow-hidden max-md:grid-cols-[minmax(0,1fr)] narrow:grid-rows-[auto_auto] narrow:overflow-visible";
export const sidebarBox = "sidebar static flex h-full min-h-0 flex-col gap-4 overflow-y-auto border-r border-line bg-elevated px-3 py-4"
  + " max-md:h-auto max-md:flex-row max-md:flex-wrap max-md:items-center narrow:h-auto narrow:max-h-none narrow:gap-2 narrow:overflow-visible narrow:py-2";
export const navList = "nav m-0 flex flex-[1_0_auto] list-none flex-col gap-0.5 p-0 max-md:w-full max-md:flex-row max-md:flex-wrap max-md:border-b max-md:border-line narrow:flex-nowrap narrow:overflow-x-auto narrow:p-1";
// Ruling H6: a section tab is navigation -- a selected row with an accent bar (an underline in the narrow row). Touch gets 44px.
export const navItem = "nav-item flex items-center justify-between gap-2 rounded-control px-[10px] py-[7px] text-sm font-medium text-fg no-underline transition-colors"
  + " hover:bg-hover hover:text-fg-strong aria-[current=page]:bg-accent-subtle aria-[current=page]:font-semibold aria-[current=page]:text-fg-strong aria-[current=page]:shadow-nav-bar"
  + " hover:aria-[current=page]:bg-accent-subtle hover:aria-[current=page]:text-fg-strong max-md:rounded-b-none max-md:aria-[current=page]:shadow-nav-bar-narrow narrow:whitespace-nowrap pointer-coarse:min-h-[44px]";
// A band's first item draws the rule above it; Settings (band 2) is pushed to the bottom. In the narrow row the rule turns into a left edge.
export const bandStart = "border-t border-line pt-1.5 max-md:ml-1 max-md:border-t-0 max-md:border-l max-md:pl-1 max-md:pt-0";
// Tester #79: the "More" toggle is a button that looks like a nav item.
export const moreToggle = "nav-more ms-0 flex w-full min-h-0 items-center justify-between gap-2 rounded-control border-transparent bg-transparent px-[10px] py-[7px] text-left text-sm font-medium text-fg shadow-none"
  + " hover:enabled:border-transparent hover:enabled:bg-hover hover:enabled:text-fg-strong max-md:w-auto max-md:rounded-b-none narrow:whitespace-nowrap pointer-coarse:min-h-[44px]";
export const statusDot = "h-2 w-2 rounded-full";

/** Band 2 (Settings) sits at the bottom of the sidebar; band 1's toggle keeps the 6px gap above its rule. */
export const settingsBand = `nav-band-start ${bandStart} mt-auto`;
export const moreBand = `nav-band-start ${bandStart} mt-1.5 max-md:mt-0`;
/** An entry folded under "More": indented in the column, flat in the narrow row; the closed group hides all but the open page. */
export const moreEntry = (hidden: boolean): string => `ps-2 max-md:ps-0${hidden ? " hidden" : ""}`;

/** The login, the forced change-password and the loading/failed pages: one column, 420px at most. */
export const authPage = "auth-page mx-auto my-[10vh] max-w-[420px] p-6";
/** A notice's dismiss buttons are compact. */
export const noticeButton = "min-h-control-sm px-[10px] py-0.5 text-xs pointer-coarse:min-h-[44px]";

/**
 * Compact secondary buttons of the project control. One a panel can never enable is hidden (its reason stays in the caption).
 * The glyph is decoration with empty alt text (`content: "+" / ""`), so the button's accessible name stays its label.
 */
export const projectAction = "project-action ms-0 inline-flex min-h-control-sm flex-[1_1_auto] items-center justify-center gap-1 rounded-control border border-line-strong bg-transparent px-2 py-0.5 text-xs leading-normal text-fg shadow-none"
  + " hover:enabled:border-muted hover:enabled:bg-hover hover:enabled:text-fg-strong disabled:hidden pointer-coarse:min-h-[44px] before:text-sm before:leading-none before:text-muted"
  + " data-[icon=add]:before:content-['+'_/_''] data-[icon=rename]:before:content-['✎'_/_'']";

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
