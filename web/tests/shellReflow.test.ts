import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Taste refinement P1-2 (audit C, measured): at 390x844 the content area was 278px, at 320x256 32px, because the
 * shell locks 100dvh and the sidebar takes up to 45dvh. On narrow screens the page must scroll as a whole.
 */
const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8");
const narrow = (): string => {
  const marker = "/* Narrow screens: the page scrolls as a whole (taste refinement P1-2). */";
  const at = css.indexOf(marker);
  if (at === -1) throw new Error("no narrow-shell block");
  return css.slice(at, css.indexOf("\n}\n", at));
};

describe("narrow shell (P1-2)", () => {
  it("unlocks the viewport height and lets the page scroll, on narrow AND on short screens", () => {
    const b = narrow();
    expect(b).toContain("@media (max-width: 760px), (max-height: 560px)");
    expect(b).toMatch(/\.authenticated-shell \{[^}]*height: auto;[^}]*overflow: visible;/);
    expect(b).toMatch(/\.authenticated-shell \.sidebar \{[^}]*max-height: none;/);
    expect(b).toMatch(/\.authenticated-shell \.content \{[^}]*overflow: visible;/);
  });
  it("keeps navigation to one scrolling row and hides what only the desktop needs", () => {
    const b = narrow();
    expect(b).toMatch(/\.nav \{[^}]*flex-wrap: nowrap;[^}]*overflow-x: auto;/);
    // overflow-x: auto makes overflow-y auto too, which would clip the 2px focus ring + offset of a nav item.
    expect(b).toMatch(/\.nav \{[^}]*padding: 4px;/);
    expect(b).toMatch(/\.sidebar-foot \{[^}]*display: none;/);
    // Review Focus 5: once Task 7 hides the never-enabled Add/Rename, the caption is the only explanation left.
    expect(b).not.toContain(".project-control .caveat");
  });
  it("gives touch screens 44px targets (audit C P2)", () => {
    const at = css.indexOf("@media (pointer: coarse) {");
    expect(at).toBeGreaterThan(-1);
    expect(css.slice(at, css.indexOf("}", at))).toMatch(/button, select, input, \.nav-item \{ min-height: 44px;/);
  });
  it("hides the skip link until it is focused", () => {
    const at = css.indexOf(".skip-link:focus {");
    expect(at).toBeGreaterThan(-1);
    const base = css.slice(css.indexOf(".skip-link {"), css.indexOf("}", css.indexOf(".skip-link {")));
    expect(base).toContain("left: -9999px");
    expect(css.slice(at, css.indexOf("}", at))).toMatch(/\.skip-link:focus \{[^}]*left: 8px/);
  });
  it("shows owners' notices as a quiet warning, not an alarm band", () => {
    const at = css.indexOf(".notices {");
    const r = css.slice(at, css.indexOf("}", at));
    expect(r).toContain("var(--warn-subtle)");
    expect(r).not.toContain("--danger");
  });
  it("keeps the one-row nav from widening the page past the viewport (final verification, 390px measured 548)", () => {
    // A bare `1fr` track has an `auto` minimum, so it grows to the nowrap nav's min-content and the whole column
    // (project control, caveat) overflows the viewport. `minmax(0, 1fr)` caps the track; the nav then scrolls inside it.
    const at = css.indexOf("@media (max-width: 760px) {");
    expect(at).toBeGreaterThan(-1);
    const block = css.slice(at, css.indexOf("\n}\n", at));
    expect(block).toMatch(/\n {2}\.shell \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  });
  it("keeps checkboxes and radios at their own size on touch, and hides the key hint there", () => {
    const first = css.indexOf("@media (pointer: coarse) {");
    const second = css.lastIndexOf("@media (pointer: coarse) {");
    expect(second).toBeGreaterThan(first); // a second block, after the pinned first one
    const block = css.slice(second, css.indexOf("\n}", second));
    expect(block).toMatch(/input\[type="checkbox"\], input\[type="radio"\] \{ min-height: 0;/);
    expect(block).toMatch(/\.kbd-hint \{ display: none;/);
  });
});
