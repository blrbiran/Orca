import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BANNER_TONE, ChainBanners } from "../src/ChainPanel.js";
import { Refusal } from "../src/Refusal.js";
import { utility } from "./sourceClasses.js";

/** Taste refinement spec §3 P1-1: role is semantics; colour comes only from data-tone. */
const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8");
const rule = (selector: string): string => {
  const at = css.indexOf(`${selector} {`);
  if (at === -1) throw new Error(`no rule for ${selector}`);
  return css.slice(at, css.indexOf("}", at));
};

describe("tone, not role (P1-1)", () => {
  it("paints status and note boxes neutral: no status colour in the shared rule, no green for role=status", () => {
    // Ruling: human 「这次批准改写所有必要的判据」 (tester round 2026-10-28, controller session a9f9d6de; final pass: the callout left the shared role rule for an @utility in index.css, whose neutral edge and fill apply only
    // without a tone; a chain banner always carries a role, so the class left the selector).
    // mutation: give the role rule border-color var(--info) -> red; mutation: drop :not([data-tone]) from the callout -> a toned callout loses its tone, red
    const r = rule('[role="alert"], [role="note"], [role="status"]');
    for (const t of ["--danger", "--ok", "--info", "--warn"]) expect(r).not.toContain(t);
    const callout = utility("callout");
    for (const t of ["--danger", "--ok", "--info", "--warn"]) expect(callout).not.toContain(t);
    expect(callout).toMatch(/&:not\(\[data-tone\]\) \{ border-color: var\(--border\); background: var\(--well\); \}/);
    expect(css).not.toMatch(/\[role="status"\]\s*\{[^}]*--ok/);
    expect(css).not.toMatch(/\[role="note"\][^{]*\{[^}]*--info/);
  });

  it("keeps an alert with no stated tone red: real errors stay red (spec §7, Review Focus 3)", () => {
    expect(rule('[role="alert"]:not([data-tone])')).toContain("var(--danger-subtle)");
  });

  it("gives each tone its own colour", () => {
    for (const t of ["info", "ok", "warn", "danger"]) {
      expect(rule(`[data-tone="${t}"]`)).toContain(`var(--${t}-subtle)`);
    }
  });

  it("marks a refusal as danger", () => {
    const html = renderToStaticMarkup(<Refusal refusal={{ status: 409, code: "x", message: "m" }} />);
    expect(html).toMatch(/role="alert"[^>]*data-tone="danger"|data-tone="danger"[^>]*role="alert"/);
  });

  it("tones a chain banner by what happened, not as an alarm", () => {
    expect(BANNER_TONE).toEqual({ done: "ok", blocked: "warn", limit: "warn", anomaly: "danger" });
    const html = renderToStaticMarkup(
      <ChainBanners banners={[{ chainId: "c1", category: "done", text: "done", repoKey: "r", reason: "ok", awaitingHuman: [] }]} />,
    );
    expect(html).toContain('data-tone="ok"');
    // Ruling: human 「这次批准改写所有必要的判据」 (tester round 2026-10-28, controller session a9f9d6de; final pass: the banner's neutral box comes from its role now, the chain-banner class left the role rule).
    // mutation: drop role="alert" from ChainBanners -> red
    expect(html).toMatch(/role="alert"[^>]*class="chain-banner/);
  });
});

describe("dark tone boxes stay readable (Review Focus 1)", () => {
  const dark = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
  const tok = (n: string): string => new RegExp(`--${n}:\\s*([^;]+);`).exec(dark)![1]!.trim();
  const hex = (v: string): number[] => [0, 2, 4].map((i) => parseInt(v.slice(1).slice(i, i + 2), 16));
  const paint = (v: string, under: number[]): number[] => {
    const m = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(v)!;
    const a = Number(m[4]);
    return [1, 2, 3].map((i, k) => Math.round(a * Number(m[i]) + (1 - a) * under[k]!));
  };
  const lum = (c: number[]): number => {
    const [r, g, b] = c.map((x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  it("keeps text-strong ≥ 4.5 on every tone fill over a card", () => {
    for (const t of ["info", "ok", "warn", "danger"]) {
      const fill = paint(tok(`${t}-subtle`), hex(tok("card")));
      const [hi, lo] = [lum(hex(tok("text-strong"))), lum(fill)].sort((x, y) => y - x);
      expect((hi! + 0.05) / (lo! + 0.05), t).toBeGreaterThanOrEqual(4.5);
    }
  });
});
