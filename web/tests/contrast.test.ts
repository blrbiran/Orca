import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Human visual review (session f8281a60, 2026-09-27): dark mode reads poorly, worst on #decisions.
 * Measured on the sheet, the text was never the problem (9.29:1 on a card); the LAYERS were:
 * border on card 1.08, card on page 1.08, selected row on card 1.21 -- the edges melt together.
 * md2publish's theme-design-lessons rules 7/10 name the same failure: on a dark theme, layers
 * separate by stepping LIGHTER. jsdom never renders this sheet, so the ratios are computed from
 * the dark tokens themselves (WCAG 2 relative luminance), pairing them the way styles.css stacks
 * them on the Decisions pane: list and detail on --card, detail blocks on --bg, sidebar on
 * --bg-elevated, the selected row = --accent-subtle over --card.
 */

const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8");
const darkBlock = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
const token = (name: string): string => {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(darkBlock);
  if (!m) throw new Error(`no dark token --${name}`);
  return m[1]!.trim();
};

type Rgb = [number, number, number];
const hex = (v: string): Rgb => {
  const m = /^#([0-9a-f]{6})$/i.exec(v);
  if (!m) throw new Error(`not a #rrggbb colour: ${v}`);
  return [0, 2, 4].map((i) => parseInt(m[1]!.slice(i, i + 2), 16)) as Rgb;
};
/** A token that is rgba(...) is painted over `under`; a hex token is opaque. */
const paint = (v: string, under: Rgb): Rgb => {
  const m = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(v);
  if (!m) return hex(v);
  const a = Number(m[4]);
  return [1, 2, 3].map((i, k) => Math.round(a * Number(m[i]) + (1 - a) * under[k]!)) as Rgb;
};
const luminance = (c: Rgb): number => {
  const [r, g, b] = c.map((x) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: Rgb, b: Rgb): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

describe("dark theme contrast (human visual review, session f8281a60)", () => {
  const bg = hex(token("bg"));
  const card = hex(token("card"));
  const elevated = hex(token("bg-elevated"));
  const selected = paint(token("accent-subtle"), card);

  it("keeps body and secondary text readable on every surface of the Decisions pane", () => {
    expect(ratio(hex(token("text")), card)).toBeGreaterThanOrEqual(7);
    expect(ratio(hex(token("text")), bg)).toBeGreaterThanOrEqual(7);
    expect(ratio(hex(token("muted")), card)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(hex(token("muted")), elevated)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(hex(token("muted")), selected)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(hex(token("text-strong")), selected)).toBeGreaterThanOrEqual(7);
  });

  // Seen on the screenshot after the first fix: Agree was white on the light accent blue.
  it("keeps a primary button's label readable on the accent (Agree, submit)", () => {
    expect(ratio(hex(token("on-accent")), hex(token("accent")))).toBeGreaterThanOrEqual(4.5);
  });

  it("separates the layers: a card from the page, an edge from its card, the open row from the rest", () => {
    expect(ratio(card, bg)).toBeGreaterThanOrEqual(1.12);
    expect(ratio(hex(token("border")), card)).toBeGreaterThanOrEqual(1.4);
    expect(ratio(hex(token("border")), bg)).toBeGreaterThanOrEqual(1.4);
    expect(ratio(selected, card)).toBeGreaterThanOrEqual(1.4);
  });

  // Human visual acceptance (session fb98aa31): "in dark mode the inputs are too dark". Fields used --bg, the darkest
  // layer, so every input sank below the card it sits on. A field steps LIGHTER than its card, like every other layer.
  it("raises inputs, selects and textareas above the card and the page they sit on", () => {
    const rule = css.slice(css.indexOf("input, select, textarea {"), css.indexOf("}", css.indexOf("input, select, textarea {")));
    expect(rule).toMatch(/background:\s*var\(--field\);/);
    const raw = token("field");
    const via = /^var\(--([a-z-]+)\)$/.exec(raw);
    const field = hex(via ? token(via[1]!) : raw);
    expect(luminance(field)).toBeGreaterThan(luminance(card));
    expect(luminance(field)).toBeGreaterThan(luminance(bg));
    expect(ratio(hex(token("text-strong")), field)).toBeGreaterThanOrEqual(7);
  });

  // Human visual acceptance (session 9b012714): "the Correction rate box, the Project box, the 'Agent defaults have not
  // been read.' box are too dark". Every inset box (metric tile, project control, notice, detail block, nested section)
  // painted --bg, the page itself, so it sank below the card around it. In dark NO box may wear the page colour: a well
  // steps lighter than its card, keeps a visible edge, and a field inside it steps lighter again.
  it("lifts every inset box above its card and leaves --bg to the page alone", () => {
    const wellRule = (selector: string): string => {
      const at = css.indexOf(`${selector} {`);
      if (at === -1) throw new Error(`no rule ${selector}`);
      return css.slice(at, css.indexOf("}", at));
    };
    for (const selector of [".project-control", ".section-pane section section", ".detail-block", '[role="alert"], [role="note"], [role="status"], .callout, .chain-banner']) {
      expect(wellRule(selector), selector).toMatch(/background:\s*var\(--well\);/);
    }
    // Ruling: human 「这次批准改写所有必要的判据」 (tester round 2026-10-28, controller session a9f9d6de; the metric tile's rule became a
    // utility string in ui/classes.ts: `bg-well` is `var(--well)` through index.css, so the tile is read there).
    const tile = /const metricTile = "([^"]*)"/.exec(readFileSync(fileURLToPath(new URL("../src/ui/classes.ts", import.meta.url)), "utf8"))?.[1];
    expect(tile, "metric tile classes").toMatch(/(^| )bg-well( |$)/);
    const bgUsers = [...css.matchAll(/([^{}]+)\{[^}]*background(?:-color)?:\s*var\(--bg\)/g)].map((m) => m[1]!.trim());
    expect(bgUsers).toEqual(["body"]);
    const resolve = (name: string): Rgb => {
      const raw = token(name);
      const via = /^var\(--([a-z-]+)\)$/.exec(raw);
      return hex(via ? token(via[1]!) : raw);
    };
    const well = resolve("well");
    expect(luminance(well)).toBeGreaterThan(luminance(card));
    expect(ratio(well, card)).toBeGreaterThanOrEqual(1.05);
    expect(ratio(hex(token("border")), well)).toBeGreaterThanOrEqual(1.4);
    expect(luminance(resolve("field"))).toBeGreaterThan(luminance(well));
    expect(ratio(hex(token("text")), well)).toBeGreaterThanOrEqual(7);
    expect(ratio(hex(token("muted")), well)).toBeGreaterThanOrEqual(4.5);
  });

  // Issue-fixes spec §6.5 (review E9): in EVERY theme block, node text and the amber "no progress" text stay readable on every
  // category fill (painted over that block's own card); the stall text is checked on every fill, running being the one it appears on.
  it("keeps node text and stall text readable on every work-item category fill in the dark and both light blocks", () => {
    const blockOf = (opener: string): string => {
      const at = css.indexOf(opener);
      if (at === -1) throw new Error(`no block ${opener}`);
      return css.slice(at, css.indexOf("}", at));
    };
    for (const opener of [":root {", ':root[data-theme="light"] {', ':root:not([data-theme="dark"]) {']) {
      const block = blockOf(opener);
      const tok = (name: string): string => {
        const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(block);
        if (!m) throw new Error(`no token --${name} in ${opener}`);
        return m[1]!.trim();
      };
      const cardOf = hex(tok("card"));
      for (const category of ["idle", "running", "waiting", "blocked", "done"]) {
        const fill = paint(tok(`cat-${category}`), cardOf);
        expect(ratio(hex(tok("text")), fill), `${opener} text on ${category}`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(hex(tok("text-strong")), fill), `${opener} text-strong on ${category}`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(hex(tok("stall")), fill), `${opener} stall on ${category}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
