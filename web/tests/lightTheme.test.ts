import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Taste refinement spec §4 (session 62660548): the light theme had no contrast criterion, and its two blocks
 * (manual choice, system preference) were pasted twice and could drift. Same WCAG formula as contrast.test.ts.
 */
const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8");
const blockOf = (opener: string): string => {
  const at = css.indexOf(opener);
  if (at === -1) throw new Error(`no block ${opener}`);
  return css.slice(at + opener.length, css.indexOf("}", at));
};
const manual = blockOf(':root[data-theme="light"] {');
const system = blockOf(':root:not([data-theme="dark"]) {');
const tok = (block: string, name: string): string => {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(block);
  if (!m) throw new Error(`no light token --${name}`);
  return m[1]!.trim();
};
type Rgb = [number, number, number];
const hex = (v: string): Rgb => {
  const m = /^#([0-9a-f]{6})$/i.exec(v);
  if (!m) throw new Error(`not #rrggbb: ${v}`);
  return [0, 2, 4].map((i) => parseInt(m[1]!.slice(i, i + 2), 16)) as Rgb;
};
const paint = (v: string, under: Rgb): Rgb => {
  const m = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(v);
  if (!m) return hex(v);
  const a = Number(m[4]);
  return [1, 2, 3].map((i, k) => Math.round(a * Number(m[i]) + (1 - a) * under[k]!)) as Rgb;
};
const lum = (c: Rgb): number => {
  const [r, g, b] = c.map((x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: Rgb, b: Rgb): number => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number]; return (hi + 0.05) / (lo + 0.05); };
const norm = (block: string): string[] => block.split(";").map((d) => d.trim()).filter(Boolean).sort();

describe("light theme (taste refinement spec §4)", () => {
  it("defines the manual and the system light theme with exactly the same declarations", () => {
    expect(norm(manual)).toEqual(norm(system));
  });

  it("is a warm paper: the page is warmer than neutral (red channel above blue)", () => {
    const [r, , b] = hex(tok(manual, "bg"));
    expect(r - b).toBeGreaterThanOrEqual(5);
  });

  it("keeps body, secondary and accent text readable on every light surface", () => {
    const card = hex(tok(manual, "card")), bg = hex(tok(manual, "bg")), hover = hex(tok(manual, "bg-hover"));
    const selected = paint(tok(manual, "accent-subtle"), card);
    expect(ratio(hex(tok(manual, "text")), card)).toBeGreaterThanOrEqual(7);
    expect(ratio(hex(tok(manual, "text")), bg)).toBeGreaterThanOrEqual(7);
    for (const under of [card, bg, hover, selected]) expect(ratio(hex(tok(manual, "muted")), under)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(hex(tok(manual, "on-accent")), hex(tok(manual, "accent")))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(hex(tok(manual, "accent")), card)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps a link readable on a hovered row (independent review: #2563eb measured 4.31 there)", () => {
    expect(ratio(hex(tok(manual, "accent")), hex(tok(manual, "bg-hover")))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("dark theme is a neutral graphite (human ruling R3: not warm)", () => {
  const dark = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
  it("keeps every dark surface near-neutral: no channel more than 10 apart, blue never below red", () => {
    for (const name of ["bg", "card", "bg-elevated", "bg-hover", "border", "border-strong"]) {
      const m = new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`, "i").exec(dark);
      const [r, g, b] = hex(m![1]!);
      expect(Math.max(r, g, b) - Math.min(r, g, b), name).toBeLessThanOrEqual(10);
      expect(b, name).toBeGreaterThanOrEqual(r);
    }
  });
});

const rgbOf = (v: string): string => {
  const m = /^rgba\((\d+),\s*(\d+),\s*(\d+),/.exec(v);
  if (m) return `${m[1]},${m[2]},${m[3]}`;
  return hex(v).join(",");
};
// blockOf(":root {") matches the first ":root {" in styles.css, which is the dark block (line 5);
// the light selectors are ":root[data-theme=..." and ":root:not(...)", which do not contain ":root {".
const darkBlock = blockOf(":root {");
describe("category tints follow the palette (final review M7)", () => {
  it("tints idle with --muted and done with --accent, in dark and both light blocks", () => {
    for (const block of [darkBlock, manual, system]) {
      expect(rgbOf(tok(block, "cat-idle"))).toBe(rgbOf(tok(block, "muted")));
      expect(rgbOf(tok(block, "cat-done"))).toBe(rgbOf(tok(block, "accent")));
    }
  });
});

// Human visual acceptance (session fb98aa31) asked only for lighter DARK fields; a light field stays the paper well (--bg).
describe("form fields in the light theme", () => {
  it("keeps --field on --bg in both light blocks", () => {
    for (const block of [manual, system]) expect(tok(block, "field")).toBe("var(--bg)");
  });
});

// Human visual acceptance (session 9b012714) asked for lighter DARK wells only; a light well stays the paper (--bg).
describe("inset wells in the light theme", () => {
  it("keeps --well on --bg in both light blocks", () => {
    for (const block of [manual, system]) expect(tok(block, "well")).toBe("var(--bg)");
  });
});
