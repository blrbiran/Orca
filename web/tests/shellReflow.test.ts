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
    expect(b).toMatch(/\.nav \{[^}]*padding: 4px 2px;/);
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
});
