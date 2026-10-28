import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cardGoal, groupCard, inlinePick, tabItem, tabRow } from "../src/ui/classes.js";

const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8");
const src = (file: string): string => readFileSync(fileURLToPath(new URL(`../src/${file}`, import.meta.url)), "utf8");
const rule = (selector: string): string => {
  const at = css.indexOf(`${selector} {`);
  if (at === -1) throw new Error(`no rule for ${selector}`);
  return css.slice(at, css.indexOf("}", at));
};

/** jsdom never applies this sheet, so the two visual promises the spec makes are pinned on the sheet itself. */
describe("styles.css", () => {
  it("shares the viewport with variable-height account content and scrolls inside each pane", () => {
    expect(rule(".authenticated-shell")).toContain("height: 100dvh");
    expect(rule(".authenticated-shell > .shell")).toContain("min-height: 0");
    expect(rule(".authenticated-shell .sidebar")).toContain("height: 100%");
    expect(rule(".authenticated-shell .sidebar")).toContain("overflow-y: auto");
    expect(rule(".authenticated-shell .content")).toContain("overflow-y: auto");
  });

  it("wraps a question with no break opportunity and clamps it to two lines (Review Focus 1)", () => {
    const q = rule(".row-question");
    expect(q).toContain("overflow-wrap: anywhere");
    expect(q).toContain("-webkit-line-clamp: 2");
  });

  // Flow gaps Task 10a: a card's title or goal summary never runs past two lines (CardGoal.tsx, web/tests/cardGoal.test.tsx).
  it("clamps a card's goal to two lines with an ellipsis, wrapping unbroken text", () => {
    // Ruling: human 「这次批准改写所有必要的判据」 (tester round 2026-10-28, controller session a9f9d6de; Tailwind batch 3): the clamp is the utility string ui/classes.ts cardGoal (was the .card-goal rule), worn by CardGoal.tsx.
    // mutation: drop line-clamp-2 from cardGoal -> red; mutation: CardGoal stops wearing cardGoal -> red
    expect(cardGoal.split(" ")).toEqual(expect.arrayContaining(["line-clamp-2", "wrap-anywhere"]));
    expect(src("CardGoal.tsx")).toMatch(/\["card-goal", cardGoal, props\.className\]/);
  });

  it("hides inactive panes by class, the only thing allowed to hide one (spec §5.1)", () => {
    expect(rule('.section-pane:not([data-active="true"])')).toContain("display: none");
  });

  // Final review Important 2: the global label rule stacks its children, which put every radio and
  // checkbox above its own text (WorkspaceModeSelector, AgentFields) and "Theme" above its select.
  it("keeps a radio's or a checkbox's label, and the theme picker, on one row", () => {
    const r = rule('label:has(> input[type="radio"]), label:has(> input[type="checkbox"])');
    expect(r).toContain("flex-direction: row");
    // Ruling: human 「这次批准改写所有必要的判据」 (tester round 2026-10-28, controller session a9f9d6de; Tailwind migration of Settings): the theme picker's row is the utility string ui/classes.ts inlinePick (was the .theme-pick rule).
    // mutation: drop flex-row from inlinePick -> red
    expect(inlinePick.split(" ")).toEqual(expect.arrayContaining(["flex-row", "items-center"]));
    expect(src("GlobalSettings.tsx").match(/<label className=\{inlinePick\}>/g)?.length).toBe(3);
  });

  // Deferred final-review Minor (human go-ahead, session f8281a60): the open control group carries
  // aria-current like the open decision row does, and gets the same selected look.
  it("marks the open control group the way it marks the open decision", () => {
    // Ruling: human 「这次批准改写所有必要的判据」 (tester round 2026-10-28, controller session a9f9d6de; Tailwind batch 3): the selected look is on the card's own class string (was the nav[aria-label] button[aria-current] rule).
    // mutation: drop the aria-[current=true]:bg-accent-subtle class from groupCard -> red
    expect(groupCard.split(" ")).toEqual(expect.arrayContaining(["aria-[current=true]:bg-accent-subtle", "aria-[current=true]:border-accent"]));
    expect(src("GroupList.tsx")).toContain("aria-current={props.selected}");
  });

  // Human ruling (session f8281a60): each importance level paints the kind pill's dot its own colour.
  it("gives each kind importance level its own dot colour", () => {
    for (const level of [1, 2, 3]) {
      expect(rule(`.field-kind[data-level="${level}"]::before`)).toContain(`background: var(--kind-${level})`);
    }
  });

  // Task 11 acceptance (session ffec7b28): the menu's sr-only owner line showed and squeezed a group card.
  // Mutation "drop the .sr-only rule": rule() throws.
  it("hides sr-only text from sight but not from assistive technology", () => {
    // Ruling: human 「这次批准改写所有必要的判据」 (tester round 2026-10-28, controller session a9f9d6de; Tailwind batch 3): the hiding is Tailwind's own sr-only utility (was the .sr-only rule); the criterion pins that the menu's owner line wears it and that no sheet re-declares the class.
    // mutation: rename the menu's class to "sr" -> red; mutation: declare ".sr-only { display: none }" in styles.css -> red
    expect(src("GroupActionsMenu.tsx")).toMatch(/className="sr-only">\{t\("control\.groupMenu\.owner"/);
    expect(css).not.toMatch(/\.sr-only\s*\{/);
  });

  // Issue-fixes spec §6.4: the whole card is the button, with a border, a hover and a focus style of its own.
  it("gives a group card a border, a hover and a visible focus", () => {
    // Ruling: human 「这次批准改写所有必要的判据」 (tester round 2026-10-28, controller session a9f9d6de; Tailwind batch 3): the card's look is the utility string ui/classes.ts groupCard (was the .group-card rules).
    // mutation: drop hover:bg-hover, then focus-visible:outline-2, then border-line, each from groupCard -> red
    const parts = groupCard.split(" ");
    expect(parts).toEqual(expect.arrayContaining(["border", "border-line", "hover:bg-hover", "focus-visible:outline-2", "focus-visible:outline-accent"]));
  });

  // Issue-fixes spec §6.5, plan Review Focus 5: every category colour exists in the dark theme and in both light blocks.
  it("defines every work-item category colour for the dark theme and both light-theme blocks, and fills each node with its own", () => {
    const blockOf = (opener: string): string => {
      const at = css.indexOf(opener);
      if (at === -1) throw new Error(`no block ${opener}`);
      return css.slice(at, css.indexOf("}", at));
    };
    const blocks = [":root {", ':root[data-theme="light"] {', ':root:not([data-theme="dark"]) {'].map(blockOf);
    for (const category of ["idle", "running", "waiting", "blocked", "done"]) {
      for (const block of blocks) expect(block, category).toMatch(new RegExp(`--cat-${category}:\\s*[^;]+;`));
      expect(rule(`.dep-${category} rect`)).toContain(`fill: var(--cat-${category})`);
    }
  });

  it("pulses a running node slowly, and not at all under prefers-reduced-motion", () => {
    expect(rule(".dep-node.dep-running rect")).toContain("animation: dep-pulse");
    const at = css.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(at).toBeGreaterThan(-1);
    const media = css.slice(at, css.indexOf("}", at));
    expect(media).toContain(".dep-node.dep-running rect { animation: none;");
  });

  // Final fix wave W3 (E9 re-review): the stall text takes the per-theme token, whose light value passes contrast; --warn does not.
  it("paints the dependency graph's stall text with the per-theme --stall token", () => {
    expect(rule(".dep-node text.dep-stall")).toContain("fill: var(--stall)");
  });

  // Tester issue #57 (session 7753e97d): measured in headless Chromium on a rendered graph, a mouse click focused the node's
  // <g> and the browser drew its focus ring (outline auto) around the <g>'s box -- 667px wide, the unclipped goal text --
  // so one frame covered T1, T2, T3 and touched T10. The ring is off for every focus; selection and keyboard focus are
  // drawn on the node's own rect.
  it("draws the open task and keyboard focus on one node's rect, never a focus ring around the <g>", () => {
    // mutation: back to ":focus-visible { outline: none }" only -> a click's ring returns, red
    expect(rule(".dep-node:focus")).toContain("outline: none");
    const open = rule('.dep-node[aria-current="true"] rect');
    for (const part of ["fill: color-mix(in srgb, var(--accent)", "stroke: var(--accent)", "stroke-width: 3"]) expect(open).toContain(part);
    expect(rule(".dep-node:focus-visible rect")).toContain("stroke-dasharray");
  });

  // Tester #64 (spec §24, session 3cd8fb02): the settings category list read as a third navigation column beside the
  // sidebar. Revised by the human in this session: the categories are a row of tabs across the top -- links with
  // aria-current, not an ARIA tablist -- the open one underlined in the accent over the row's bottom rule, wrapping when
  // narrow, the content full width below. Only the sheet is pinned here; how it looks is visual.
  it("lays the settings categories out as a wrapping tab row above full-width content, the open one underlined", () => {
    // Ruling: human 「这次批准改写所有必要的判据」, Orca session 3cd8fb02, 2026-10-28 -- the left-column criterion this branch first added (fit-content(11rem) column, panel box, inset left edge) now pins the tab row.
    // Ruling: human 「这次批准改写所有必要的判据」 (tester round 2026-10-28, controller session a9f9d6de; Tailwind migration of Settings): the page and its tab row are utility classes now (SettingsPage.tsx, ui/classes.ts tabRow/tabItem); the
    // same promises are read off the class strings, each class one CSS declaration (index.css maps them to the tokens).
    const page = src("SettingsPage.tsx");
    // mutation: back to a two-column grid -> red
    expect(page).toContain('<div className="flex flex-col gap-4">');
    expect(page).not.toMatch(/grid-cols|sticky/);
    expect(page).toContain("<ul className={tabRow}>");
    expect(page).toContain("<a className={tabItem} href=");
    const row = tabRow.split(" ");
    // mutation: drop the wrap -> one row that overflows when narrow, red
    for (const part of ["flex", "flex-wrap", "border-b", "border-line"]) expect(row).toContain(part);
    expect(row).not.toContain("flex-col");
    const item = tabItem.split(" ");
    expect(item).toContain("text-muted");
    // mutation: drop the accent underline -> red
    for (const part of ["aria-[current=page]:border-accent", "aria-[current=page]:font-semibold", "border-b-2"]) expect(item).toContain(part);
    expect(item.some((c) => /^(bg-|shadow-)/.test(c))).toBe(false);
  });

  // Tester #65 (spec §24, session 3cd8fb02): selects wore each platform's own arrow and fields the browser's focus ring.
  // One rule set from the tokens, no UI library; the field colours themselves stay pinned by contrast.test.ts.
  it("styles every select, field and checkbox from the tokens, with a token chevron and an accent focus ring", () => {
    // mutation: drop the select rule -> the platform arrow returns, red
    const at = css.indexOf("\nselect {");
    expect(at).toBeGreaterThan(-1);
    const select = css.slice(at, css.indexOf("}", at));
    for (const part of ["appearance: none", "-webkit-appearance: none", "linear-gradient(45deg, transparent 50%, var(--muted) 50%)", "background-repeat: no-repeat"]) expect(select).toContain(part);
    // The chevron is a background-image layered over the field colour: it must come after the base rule's `background:` shorthand.
    expect(at).toBeGreaterThan(css.indexOf("input, select, textarea {"));
    expect(select).not.toMatch(/background:/);
    // mutation: drop the focus rule -> red
    expect(rule("input:focus-visible, select:focus-visible, textarea:focus-visible")).toContain("outline: 2px solid var(--accent)");
    expect(rule('input[type="checkbox"], input[type="radio"]')).toContain("accent-color: var(--accent)");
  });

  // Session e236bbe4: the group header's source-requirement link sat flush against the next button; the adjacent-control
  // gap now counts an inline link as the left neighbour. Mutation: drop `a` from the first list -> red.
  it("keeps the 8px gap after a button, or after an inline link, before the next button", () => {
    expect(rule(":where(button, .btn, a) + :where(button, .btn)")).toContain("margin-inline-start: var(--space-2)");
  });
});
