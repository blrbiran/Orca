/**
 * Shared utility-class strings (tester round 2026-10-28, Tailwind migration; web/TAILWIND-MIGRATION.md §3). A pattern
 * used in more than one component lives here once, so the look has one implementation; a one-off stays inline.
 */

/** DESIGN.md "Tabs": ONE component -- a row over a bottom rule that wraps when narrow. */
export const tabRow = "m-0 flex list-none flex-wrap gap-x-1 border-b border-line p-0";
/** A tab: quiet medium-weight, the open one (aria-current="page") bold over a 2px accent underline. */
export const tabItem = "-mb-px flex items-center border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted no-underline transition-colors"
  + " hover:border-line-strong hover:text-fg-strong focus-visible:rounded-t-inset focus-visible:outline-offset-[-2px]"
  + " aria-[current=page]:border-accent aria-[current=page]:font-semibold aria-[current=page]:text-fg-strong hover:aria-[current=page]:border-accent"
  // The group detail's region tabs (aria-selected) and the corrections tabs (aria-pressed) are buttons, open the same way.
  + " aria-[selected=true]:border-accent aria-[selected=true]:font-semibold aria-[selected=true]:text-fg-strong hover:aria-[selected=true]:border-accent"
  + " aria-[pressed=true]:border-accent aria-[pressed=true]:font-semibold aria-[pressed=true]:text-fg-strong hover:aria-[pressed=true]:border-accent";
/** A row of button tabs (the region and corrections tabs): the tab row with its air above and below. */
export const tabButtonRow = `${tabRow} mt-4 mb-3`;
/** A tab that is a button drops the button chrome -- fill, side and top edges, corners, shadow, the gap after a button. */
export const tabButton = `${tabItem} ms-0 rounded-none border-x-0 border-t-0 bg-transparent shadow-none`;

/** A label that sits beside its control on one row (the theme and language pickers), not above it. */
export const inlinePick = "mt-2 flex-row items-center gap-2";
/** Tester #68: a setting's one-line example, muted under its name. */
export const settingHint = "block text-xs text-muted";
/** Tester #67: where a setting's value was set -- a quiet aside, not a badge. */
export const settingSource = "text-xs text-muted";
/** A settings region: long words wrap, fields never widen it, a table scrolls inside it. */
export const settingsRegion = "min-w-0 wrap-anywhere [&_input]:min-w-0 [&_input]:max-w-full [&_select]:min-w-0 [&_select]:max-w-full"
  + " [&_[data-select-trigger]]:min-w-0 [&_[data-select-trigger]]:max-w-full"
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

/** Board (tester round 2026-10-28): a card is an inset box; its badges are boxed (not pills) so a second line stays inside the border (issue #58). */
export const boardCard = "cursor-grab rounded-control border border-line bg-well px-2.5 py-2 transition-colors hover:border-line-strong";
export const boardCardBadge = "max-w-full rounded-control wrap-anywhere";
/** The card's open control is a bare button (it was `all: unset`): no chrome, inherited type, no min height. */
export const boardCardOpen = "inline min-h-0 cursor-pointer rounded-none border-0 bg-transparent p-0 text-start text-base leading-[inherit] font-semibold text-inherit shadow-none transition-none hover:bg-hover";
/** Tester #54: a dragged card's refusing columns dim. Padding, edge and fill come from the legacy labelled-section card rule, which out-ranks the old
 *  `.board-column` rule -- and so also its `[data-drop="allowed"]` accent outline, which never painted. Kept as it was (the migration does not change the look). */
// Tester #54: while a card is dragged, a column that takes it shows a dashed accent edge (the legacy rule never painted:
// `.section-pane section[aria-label]` out-ranked it); one that refuses it dims.
export const boardColumnBox = "min-h-[120px] shrink-0 basis-[240px] data-[drop=allowed]:border-dashed data-[drop=allowed]:border-accent data-[drop=refused]:opacity-55";

/** Overview: buttons wrap and align left (a goal can be long); each column is bare, not a card inside the Overview card (it out-ranks the
 *  labelled-section card rule); a row is a rule-separated list item. */
export const overviewRowButton = "max-w-full justify-start text-left whitespace-normal";
export const overviewColumn = "m-0 min-w-0 border-0 bg-transparent p-0 shadow-none";
export const overviewRowList = "m-0 list-none p-0";
export const overviewRowItem = "border-b border-line py-4 wrap-anywhere";

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
