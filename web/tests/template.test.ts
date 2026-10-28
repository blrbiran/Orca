import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Taste refinement P2-6 (detector: flat-type-hierarchy 14/14/16; one primary per view). */
const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8");
const rule = (s: string): string => { const at = css.indexOf(`${s} {`); if (at === -1) throw new Error(`no rule ${s}`); return css.slice(at, css.indexOf("}", at)); };

describe("page template (P2-6)", () => {
  it("steps headings at least 1.2x apart: h3 14, h2 18, h1 22", () => {
    expect(css).toMatch(/h1 \{ font-size: 22px; \}/);
    expect(css).toMatch(/h2 \{ font-size: 18px; \}/);
    expect(css).toMatch(/h3 \{ font-size: var\(--text-md\); font-weight: 600; \}/);
  });
  it("sizes the Decisions page title like every other page title", () => {
// Ruling: human 「这次批准改写所有必要的判据」 (tester round 2026-10-28, controller session a9f9d6de; Tailwind migration of batch 2 (Decisions): the title is the utility text-xl (18px, index.css) on the h1 in DecisionsView.tsx.
    // mutation: a bare <h1> in DecisionsView -> 22px like the others, red
    const view = readFileSync(fileURLToPath(new URL("../src/DecisionsView.tsx", import.meta.url)), "utf8");
    expect(view).toContain('<h1 className="text-xl">{t(heading.title)}</h1>');
  });
  it("fills only .btn-primary with the accent; a bare submit is secondary", () => {
    expect(css).not.toMatch(/button\[type="submit"\][^{]*\{[^}]*var\(--accent\)/);
    expect(rule(".btn-primary")).toContain("background: var(--accent)");
  });
  it("hides a project action that this panel can never enable (its reason stays in the caption)", () => {
    expect(rule(".project-action:disabled")).toContain("display: none");
  });
  it("shows the control plane's session line as metadata", () => {
    const r = rule(".section-meta");
    expect(r).toContain("var(--muted)");
    expect(r).toContain("var(--text-xs)");
  });
  it("keeps one primary action on Requirements, Chains, the loop plan and plan import (spec §7)", () => {
    const read = (f: string): string => readFileSync(fileURLToPath(new URL(`../src/${f}`, import.meta.url)), "utf8");
    // ControlPanel's plan import has two mutually exclusive branches (can-import / confirm), each with its one primary.
    const expected: Record<string, number> = { "RequirementsPanel.tsx": 1, "ChainPanel.tsx": 1, "LoopPlanCard.tsx": 1, "ControlPanel.tsx": 2 };
    for (const [f, n] of Object.entries(expected)) {
      expect(read(f).match(/className="btn-primary"/g)?.length, f).toBe(n);
    }
  });
  it("does not recolour a disabled primary on hover (final review M1)", () => {
    expect(css).toContain(".btn-primary:hover:not(:disabled) {");
    expect(css).not.toMatch(/\.btn-primary:hover \{/);
  });
});
