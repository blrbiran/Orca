import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8");
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
    const r = rule(".card-goal");
    for (const part of ["-webkit-line-clamp: 2", "line-clamp: 2", "-webkit-box-orient: vertical", "overflow: hidden", "overflow-wrap: anywhere"]) expect(r).toContain(part);
  });

  it("hides inactive panes by class, the only thing allowed to hide one (spec §5.1)", () => {
    expect(rule('.section-pane:not([data-active="true"])')).toContain("display: none");
  });

  // Final review Important 2: the global label rule stacks its children, which put every radio and
  // checkbox above its own text (WorkspaceModeSelector, AgentFields) and "Theme" above its select.
  it("keeps a radio's or a checkbox's label, and the theme picker, on one row", () => {
    const r = rule('label:has(> input[type="radio"]), label:has(> input[type="checkbox"]), .theme-pick');
    expect(r).toContain("flex-direction: row");
  });

  // Deferred final-review Minor (human go-ahead, session f8281a60): the open control group carries
  // aria-current like the open decision row does, and gets the same selected look.
  it("marks the open control group the way it marks the open decision", () => {
    expect(rule('nav[aria-label="Control groups"] button[aria-current="true"]')).toContain("background: var(--accent-subtle)");
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
    const r = rule(".sr-only");
    for (const part of ["position: absolute", "width: 1px", "height: 1px", "overflow: hidden", "clip: rect(0, 0, 0, 0)"]) expect(r).toContain(part);
    expect(r).not.toContain("display: none");
  });

  // Issue-fixes spec §6.4: the whole card is the button, with a border, a hover and a focus style of its own.
  it("gives a group card a border, a hover and a visible focus", () => {
    expect(rule(".group-card")).toContain("border: 1px solid var(--border)");
    expect(rule(".group-card:hover")).toContain("background: var(--bg-hover)");
    expect(rule(".group-card:focus-visible")).toContain("outline: 2px solid var(--accent)");
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

  // Tester #64 (spec §24, session 3cd8fb02): the settings category list read as a third, 180px-wide navigation column with
  // no edge of its own. It is a panel of its own, as wide as its labels up to ~11rem, the open item marked like a tab;
  // narrow, it is one wrapping row whose open item is underlined. Only the sheet is pinned; how it looks is visual.
  it("draws the settings categories as their own narrow panel with a tab-like open item", () => {
    // mutation: back to "180px minmax(0, 1fr)" -> red
    expect(rule(".settings-page")).toContain("grid-template-columns: fit-content(11rem) minmax(0, 1fr)");
    const nav = rule(".settings-nav");
    // mutation: drop the panel's background/border/radius -> red
    for (const part of ["background: var(--bg-elevated)", "border: 1px solid var(--border)", "border-radius: var(--radius)"]) expect(nav).toContain(part);
    const open = rule('.settings-nav .nav-item[aria-current="page"]');
    for (const part of ["background: transparent", "font-weight: 600", "box-shadow: inset 3px 0 0 var(--accent)"]) expect(open).toContain(part);
    const at = css.indexOf("@media (max-width: 760px) {", css.indexOf(".settings-page {"));
    expect(at).toBeGreaterThan(-1);
    const narrow = css.slice(at, css.indexOf("\n}\n", at));
    expect(narrow).toMatch(/\.settings-nav ul \{[^}]*flex-direction: row;[^}]*flex-wrap: wrap;/);
    expect(narrow).toMatch(/\.settings-nav \.nav-item\[aria-current="page"\] \{[^}]*box-shadow: inset 0 -2px 0 var\(--accent\);/);
  });
});
