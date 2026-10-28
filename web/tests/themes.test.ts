import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { THEME_PREFS } from "../src/theme.js";
import { en } from "../src/locales/en.js";
import { zh } from "../src/locales/zh.js";

/**
 * Session e236bbe4 (human, away: "add selectable themes ... each must still pass WCAG AA"): every theme the Settings
 * picker offers is a block of colour tokens in styles.css, and EVERY one -- the default pair included -- is held to the
 * same readability bar the default dark and light themes already meet (contrast.test.ts, lightTheme.test.ts keep their
 * own stricter, default-only checks). jsdom never paints the sheet, so the ratios come from the tokens (WCAG 2 formula),
 * paired the way styles.css stacks them: text on a card, a well, the page, a hovered row, a field, the selected row.
 */
const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8");
const blockAt = (opener: string): { at: number; body: string } => {
  const at = css.indexOf(opener);
  if (at === -1) throw new Error(`no block ${opener}`);
  return { at, body: css.slice(at + opener.length, css.indexOf("}", at)) };
};
const OPENER: Record<string, string> = { dark: ":root {", light: ':root[data-theme="light"] {' };
const openerOf = (theme: string): string => OPENER[theme] ?? `:root[data-theme="${theme}"] {`;
const PINNED = THEME_PREFS.filter((pref) => pref !== "system");
const NEW = PINNED.filter((pref) => pref !== "light" && pref !== "dark");

type Rgb = [number, number, number];
const tokens = (theme: string): Map<string, string> => {
  const map = new Map<string, string>();
  for (const m of blockAt(openerOf(theme)).body.matchAll(/(--[a-z0-9-]+|color-scheme):\s*([^;]+);/g)) map.set(m[1]!, m[2]!.trim());
  return map;
};
const hex = (v: string): Rgb => {
  const m = /^#([0-9a-f]{6})$/i.exec(v);
  if (!m) throw new Error(`not a #rrggbb colour: ${v}`);
  return [0, 2, 4].map((i) => parseInt(m[1]!.slice(i, i + 2), 16)) as Rgb;
};
const lum = (c: Rgb): number => {
  const [r, g, b] = c.map((x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: Rgb, b: Rgb): number => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number]; return (hi + 0.05) / (lo + 0.05); };

/** One theme's colours, `var(--x)` followed inside the block and rgba() painted over the surface it sits on. */
function palette(theme: string) {
  const t = tokens(theme);
  const raw = (name: string): string => {
    const v = t.get(`--${name}`);
    if (v === undefined) throw new Error(`${theme}: no --${name}`);
    const via = /^var\(--([a-z0-9-]+)\)$/.exec(v);
    return via ? raw(via[1]!) : v;
  };
  const c = (name: string): Rgb => hex(raw(name));
  const over = (name: string, under: Rgb): Rgb => {
    const m = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(raw(name));
    if (!m) return hex(raw(name));
    const a = Number(m[4]);
    return [1, 2, 3].map((i, k) => Math.round(a * Number(m[i]) + (1 - a) * under[k]!)) as Rgb;
  };
  return { t, raw, c, over };
}

describe("the theme list (session e236bbe4)", () => {
  // Ruling: human 「这次批准改写所有必要的判据」 (tester round 2026-10-28, controller session a9f9d6de; the human asked for the
  // candidates to be reworked and 4-6 new themes added: rose, ink, violet, lagoon join, light candidates before dark ones,
  // and no earlier id is dropped, so a stored choice of any of them still applies).
  it("offers system, the default pair, then the light candidates and the dark candidates, in that order", () => {
    expect(THEME_PREFS).toEqual(["system", "light", "dark", "frost", "rose", "ink", "contrast", "violet", "navy", "lagoon", "dusk", "ember", "terminal"]);
  });

  it("keeps every id an earlier panel could have stored, so nobody's choice silently falls back to system", () => {
    for (const earlier of ["system", "light", "dark", "frost", "contrast", "navy", "ember", "dusk", "terminal"]) expect(THEME_PREFS, earlier).toContain(earlier);
  });

  it("has a stylesheet block for every pinned theme and no block the picker cannot reach", () => {
    for (const theme of PINNED) expect(css.indexOf(openerOf(theme)), theme).toBeGreaterThan(-1);
    const blocks = [...css.matchAll(/:root\[data-theme="([a-z]+)"\] \{/g)].map((m) => m[1]!);
    expect(new Set(blocks)).toEqual(new Set(PINNED.filter((p) => p !== "dark")));
  });

  it("names every theme in both languages, the Chinese name never the raw id", () => {
    for (const pref of THEME_PREFS) {
      expect(en.enums.theme[pref], pref).toBeTruthy();
      expect(zh.enums.theme[pref], pref).toBeTruthy();
      expect(zh.enums.theme[pref], pref).not.toBe(pref);
    }
  });

  // A candidate block that comes before the system-light block, or misses a token, lets the browser's light preference
  // leak through (equal specificity, so the later block wins): a navy page with light-theme fields.
  it("defines every colour token the default light theme does, after the system-light block", () => {
    const reference = [...tokens("light").keys()];
    const systemLight = css.indexOf(':root:not([data-theme="dark"]) {');
    for (const theme of PINNED) {
      const t = tokens(theme);
      for (const name of reference) expect(t.has(name), `${theme} ${name}`).toBe(true);
    }
    for (const theme of NEW) expect(css.indexOf(openerOf(theme)), theme).toBeGreaterThan(systemLight);
  });

  it("declares the colour scheme its page actually is, so native controls and scrollbars match", () => {
    for (const theme of PINNED) {
      const { t, c } = palette(theme);
      const dark = lum(c("bg")) < 0.2;
      expect(t.get("color-scheme"), theme).toBe(dark ? "dark" : "light");
    }
  });
});

/**
 * Tester round 2026-10-28 (controller session a9f9d6de; human: 「之前的主题都不好看，你可以都整体再优化一遍」, 4-6 new themes
 * that vary palette, typography, radius and density together, not just colour). A theme changes the look only through
 * the scale tokens, which index.css hands to the Tailwind utilities (--spacing is --space-1, rounded-* are the radii,
 * h-control is --control-h) and the legacy rules read directly -- so both follow one switch.
 */
const SPACE = ["--space-1", "--space-2", "--space-3", "--space-4", "--space-5"];
const RADII = ["--radius-xs", "--radius-sm", "--radius"];
const SCALE = [...SPACE, ...RADII, "--control-h", "--control-h-sm", "--font", "--mono"];
const px = (v: string): number => {
  const m = /^(\d+(?:\.\d+)?)(px)?$/.exec(v);
  if (!m || (m[2] === undefined && m[1] !== "0")) throw new Error(`not a px length: ${v}`);
  return Number(m[1]);
};
describe("each candidate theme is more than a palette", () => {
  it("leaves the default look's scale alone: the light block sets no scale token, only :root does", () => {
    for (const name of SCALE) expect(tokens("light").has(name), name).toBe(false);
    for (const name of SCALE) expect(tokens("dark").has(name), name).toBe(true);
  });

  it("sets its own corners (all three radii, small <= control <= card) and at least its type or its density", () => {
    for (const theme of NEW) {
      const t = tokens(theme);
      for (const name of RADII) expect(t.has(name), `${theme} ${name}`).toBe(true);
      const [xs, sm, card] = RADII.map((name) => px(t.get(name)!));
      expect(xs, theme).toBeLessThanOrEqual(sm!);
      expect(sm, theme).toBeLessThanOrEqual(card!);
      expect(t.has("--font") || t.has("--control-h"), `${theme} type or density`).toBe(true);
    }
  });

  // The Tailwind scale is N x --space-1 (p-6 is 6 steps); the legacy sheet reads --space-2..5 by name. A theme that set
  // only some steps, or steps off the 1-2-3-4-6 ratio, would space a migrated component unlike its legacy neighbour.
  it("sets density as a whole scale: all five steps on the 1-2-3-4-6 ratio, both control heights, the small one smaller", () => {
    for (const theme of NEW) {
      const t = tokens(theme);
      if (SPACE.some((name) => t.has(name))) {
        const unit = px(t.get("--space-1")!);
        SPACE.forEach((name, i) => expect(px(t.get(name) ?? "NaN"), `${theme} ${name}`).toBe(unit * [1, 2, 3, 4, 6][i]!));
        expect(t.has("--control-h"), `${theme} control height`).toBe(true);
      }
      if (t.has("--control-h") || t.has("--control-h-sm")) {
        expect(px(t.get("--control-h-sm") ?? "NaN"), theme).toBeLessThan(px(t.get("--control-h") ?? "NaN"));
        // the 1-step comfortable-to-compact band the 390 px layout was measured in (no horizontal overflow)
        expect(px(t.get("--control-h")!), theme).toBeGreaterThanOrEqual(28);
        expect(px(t.get("--control-h")!), theme).toBeLessThanOrEqual(36);
      }
    }
  });

  // Only the bundled faces (fonts.css, woff2) or the system stack: a family named here that the panel does not ship
  // would fall back silently on every machine without it.
  it("chooses its type only from the bundled fonts", () => {
    for (const theme of NEW) {
      const t = tokens(theme);
      for (const name of ["--font", "--mono"]) if (t.has(name)) expect(t.get(name), `${theme} ${name}`).toMatch(/^var\(--font-(sans|mono)\)$/);
    }
  });
});

describe.each(PINNED)("theme %s stays readable (WCAG AA)", (theme) => {
  const { c, over } = palette(theme);
  const card = c("card"), bg = c("bg"), well = c("well"), field = c("field"), hover = c("bg-hover"), elevated = c("bg-elevated");
  const selected = over("accent-subtle", card);

  it("keeps body text at 7:1 and secondary text at 4.5:1 on every surface", () => {
    for (const [name, under] of Object.entries({ card, bg, well, field, hover, elevated, selected })) {
      expect(ratio(c("text"), under), `text on ${name}`).toBeGreaterThanOrEqual(7);
      expect(ratio(c("text-strong"), under), `text-strong on ${name}`).toBeGreaterThanOrEqual(7);
      expect(ratio(c("muted"), under), `muted on ${name}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps links, a primary button's label (resting and hovered) and the focus ring legible", () => {
    for (const [name, under] of Object.entries({ card, bg, well, hover })) expect(ratio(c("accent"), under), `accent on ${name}`).toBeGreaterThanOrEqual(4.5);
    expect(ratio(c("on-accent"), c("accent"))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(c("on-accent"), c("accent-hover"))).toBeGreaterThanOrEqual(4.5);
    // WCAG 1.4.11: the 2px accent outline against the page and a card.
    expect(ratio(c("accent"), bg)).toBeGreaterThanOrEqual(3);
  });

  // Seen on the first contrast-theme screenshot: the sidebar's count (text-strong on --border-strong) read 115 as black on black.
  it("keeps the sidebar count readable on its chip", () => {
    if (theme === "contrast") {
      // that theme inverts the chip (styles.css): its card colour on its strongest text
      expect(css).toMatch(/:root\[data-theme="contrast"\] \.nav-count \{ background: var\(--text-strong\); color: var\(--card\); \}/);
      expect(ratio(c("card"), c("text-strong"))).toBeGreaterThanOrEqual(4.5);
    } else {
      expect(ratio(c("text-strong"), c("border-strong"))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps every tone readable: strong text on its fill, the tone colour itself as text on a card", () => {
    for (const tone of ["info", "ok", "warn", "danger"]) {
      const fill = over(`${tone}-subtle`, card);
      expect(ratio(c("text-strong"), fill), `text-strong on ${tone}`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(c(tone), card), `${tone} on card`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps node and stall text readable on every work-item category fill", () => {
    for (const category of ["idle", "running", "waiting", "blocked", "done"]) {
      const fill = over(`cat-${category}`, card);
      for (const ink of ["text", "text-strong", "stall"]) expect(ratio(c(ink), fill), `${ink} on ${category}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  // DESIGN.md: in a dark theme layers step LIGHTER (page < card < well < field) and no box wears the page colour; the
  // human's dark-mode reviews (sessions f8281a60, fb98aa31, 9b012714) are the reason. A light theme separates by edges.
  it("separates its layers in the direction the theme is", () => {
    if (lum(bg) < 0.2) {
      expect(lum(card), "card above page").toBeGreaterThan(lum(bg));
      expect(ratio(card, bg), "card/page").toBeGreaterThanOrEqual(1.12);
      expect(lum(well), "well above card").toBeGreaterThan(lum(card));
      expect(lum(field), "field above well").toBeGreaterThan(lum(well));
      expect(ratio(c("border"), card), "border/card").toBeGreaterThanOrEqual(1.4);
      expect(ratio(selected, card), "selected/card").toBeGreaterThanOrEqual(1.4);
    } else {
      expect(lum(card), "card no darker than page").toBeGreaterThanOrEqual(lum(bg));
      expect(ratio(c("border-strong"), card), "control edge/card").toBeGreaterThanOrEqual(1.5);
      expect(ratio(selected, card), "selected/card").toBeGreaterThanOrEqual(1.1);
    }
  });
});

describe("the high-contrast theme", () => {
  it("holds every text pair at 7:1 and its edges at 3:1", () => {
    const { c } = palette("contrast");
    for (const ink of ["text", "text-strong", "muted", "accent", "ok", "warn", "danger", "info"]) {
      for (const under of ["card", "bg", "well", "bg-hover"]) expect(ratio(c(ink), c(under)), `${ink} on ${under}`).toBeGreaterThanOrEqual(7);
    }
    expect(ratio(c("border"), c("card"))).toBeGreaterThanOrEqual(3);
  });
});
