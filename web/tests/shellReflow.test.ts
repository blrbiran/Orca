import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { carrying, utility } from "./sourceClasses.js";

/**
 * Taste refinement P1-2 (audit C, measured): at 390x844 the content area was 278px, at 320x256 32px, because the
 * shell locks 100dvh and the sidebar takes up to 45dvh. On narrow screens the page must scroll as a whole.
 * Rewritten with the shell's Tailwind migration (batch 1): the shell's rules left styles.css for the class strings of
 * Shell.tsx and AuthGate.tsx, so these read those strings. Ruling: human 「这次批准改写所有必要的判据」 (tester round 2026-10-28, controller session a9f9d6de; the narrow-shell, coarse-pointer, skip-link, notices and grid-track rules are now utility classes)
 */
const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8");
const entry = readFileSync(fileURLToPath(new URL("../src/index.css", import.meta.url)), "utf8");
const has = (classes: string, ...wanted: string[]): void => {
  const tokens = classes.split(/\s+/);
  for (const w of wanted) expect(tokens, `${w} in ${classes}`).toContain(w);
};

describe("narrow shell (P1-2)", () => {
  it("names the narrow screen once: narrow OR short, so the sidebar cannot take the viewport on either", () => {
    // Ruling: human 「这次批准改写所有必要的判据」 (tester round 2026-10-28, controller session a9f9d6de, final pass): the shorthand this
    // pinned compiled its max-height half to a broken selector; the block form is pinned here and compiled in tailwind.test.ts.
    // mutation: drop the max-height half of the variant -> a short, wide screen keeps the locked shell, red
    expect(entry).toContain("@custom-variant narrow {\n  @media (max-width: 760px), (max-height: 560px) { @slot; }\n}");
  });
  it("unlocks the viewport height and lets the page scroll, on narrow AND on short screens", () => {
    // mutation: delete narrow:overflow-visible from the content -> the pane stays a scroller, red
    has(carrying("AuthGate.tsx", "authenticated-shell"), "h-dvh", "narrow:h-auto", "narrow:overflow-visible");
    has(carrying("Shell.tsx", "shell"), "min-h-0", "flex-1", "overflow-hidden", "narrow:overflow-visible");
    has(carrying("Shell.tsx", "sidebar"), "overflow-y-auto", "narrow:max-h-none", "narrow:overflow-visible");
    has(carrying("Shell.tsx", "content"), "overflow-y-auto", "narrow:overflow-visible");
  });
  it("keeps navigation to one scrolling row and hides what only the desktop needs", () => {
    // mutation: delete narrow:flex-nowrap from the nav -> its items wrap into a tall block, red
    has(carrying("Shell.tsx", "nav"), "narrow:flex-nowrap", "narrow:overflow-x-auto");
    // overflow-x: auto makes overflow-y auto too, which would clip the 2px focus ring + offset of a nav item.
    has(carrying("Shell.tsx", "nav"), "narrow:p-1");
    has(carrying("Shell.tsx", "sidebar-foot"), "narrow:hidden");
    // Review Focus 5: once Task 7 hides the never-enabled Add/Rename, the caption is the only explanation left.
    expect(css).not.toContain(".project-control .caveat");
  });
  it("gives touch screens 44px targets (audit C P2)", () => {
    // mutation: delete pointer-coarse:min-h-[44px] from the nav item -> a thumb target of 30px, red
    has(carrying("Shell.tsx", "nav-item"), "pointer-coarse:min-h-[44px]");
    has(carrying("ProjectControl.tsx", "project-action"), "pointer-coarse:min-h-[44px]");
    const at = css.indexOf("@media (pointer: coarse) {");
    expect(at).toBeGreaterThan(-1);
    expect(css.slice(at, css.indexOf("}", at))).toMatch(/button, select, input \{ min-height: 44px;/);
  });
  it("hides the skip link until it is focused", () => {
    // mutation: delete focus:left-2 -> the skip link never comes into view, red
    has(carrying("Shell.tsx", "skip-link"), "absolute", "-left-[9999px]", "focus:left-2");
  });
  it("shows owners' notices as a quiet warning, not an alarm band", () => {
    const classes = carrying("AuthGate.tsx", "notices");
    has(classes, "bg-warn-subtle");
    expect(classes).not.toContain("danger");
  });
  it("keeps the one-row nav from widening the page past the viewport (final verification, 390px measured 548)", () => {
    // A bare `1fr` track has an `auto` minimum, so it grows to the nowrap nav's min-content and the whole column
    // (project control, caveat) overflows the viewport. `minmax(0, 1fr)` caps the track; the nav then scrolls inside it.
    // mutation: write max-md:grid-cols-1 -> a bare 1fr track, red
    has(carrying("Shell.tsx", "shell"), "max-md:grid-cols-[minmax(0,1fr)]", "grid-cols-[var(--nav-width)_minmax(0,1fr)]");
  });
  it("keeps checkboxes and radios at their own size on touch, and hides the key hint there", () => {
    const first = css.indexOf("@media (pointer: coarse) {");
    const second = css.lastIndexOf("@media (pointer: coarse) {");
    expect(second).toBeGreaterThan(first); // a second block, after the pinned first one
    const block = css.slice(second, css.indexOf("\n}", second));
    expect(block).toMatch(/input\[type="checkbox"\], input\[type="radio"\] \{ min-height: 0;/);
    // Ruling: human 「这次批准改写所有必要的判据」 (tester round 2026-10-28, controller session a9f9d6de; final pass: the key hint is the kbd-hint @utility in index.css, its touch rule nested in it).
    // mutation: drop the nested pointer: coarse rule from kbd-hint -> red
    expect(utility("kbd-hint")).toMatch(/@media \(pointer: coarse\) \{ display: none; \}/);
  });
});
