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
  it("wraps a question with no break opportunity and clamps it to two lines (Review Focus 1)", () => {
    const q = rule(".row-question");
    expect(q).toContain("overflow-wrap: anywhere");
    expect(q).toContain("-webkit-line-clamp: 2");
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
});
