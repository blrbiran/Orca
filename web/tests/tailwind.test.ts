import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";

/**
 * Tester round 2026-10-28 (human rulings, controller session a9f9d6de): Tailwind v4 through @tailwindcss/vite, with the
 * CSS variables of styles.css the ONLY theme source. jsdom applies no sheet, so the promises are pinned on the entry.
 */
const read = (file: string): string => readFileSync(fileURLToPath(new URL(`../src/${file}`, import.meta.url)), "utf8");
const entry = read("index.css");
const at = (needle: string): number => {
  const i = entry.indexOf(needle);
  if (i === -1) throw new Error(`index.css has no ${needle}`);
  return i;
};

describe("the Tailwind entry (index.css)", () => {
  it("keeps both halves of the narrow variant: a narrow OR a short screen", async () => {
    // Final pass (session a9f9d6de): the shorthand `@custom-variant narrow (@media a, b);` compiled to one media rule plus a
    // broken `.narrow\:x (max-height: 560px)` selector, so a short wide screen kept the desktop shell. Compiled here for real.
    // mutation: back to the shorthand form -> the short-screen half is no media query, red
    const variant = entry.slice(at("@custom-variant narrow"), entry.indexOf("\n}\n", at("@custom-variant narrow")) + 2);
    const built = (await compile(`@layer utilities { @tailwind utilities; }\n${variant}`)).build(["narrow:hidden"]);
    expect(built).toMatch(/@media \(max-width: 760px\), \(max-height: 560px\) \{\s*\.narrow\\:hidden \{/);
    expect(built).not.toMatch(/\.narrow\\:hidden \(/);
  });

  it("layers preflight and the hand-written sheet as the base under the utilities, so a utility class beats any base selector", () => {
    // Ruling: human 「这次批准改写所有必要的判据」 (tester round 2026-10-28, controller session a9f9d6de; final pass: preflight is on and styles.css is the base layer, so the order pins theme, base, utilities and preflight before the sheet).
    // mutation: import styles.css unlayered -> its element rules (button, label) beat every utility, red
    // mutation: drop the preflight import -> the browser defaults come back unreset, red
    // mutation: import preflight after styles.css -> its resets (margin, list-style, heading sizes) beat the sheet's own rules, red
    expect(entry).toContain('@layer theme, base, utilities;');
    expect(at('@import "./styles.css" layer(base);')).toBeLessThan(at('@import "tailwindcss/utilities.css" layer(utilities);'));
    expect(at('@import "tailwindcss/theme.css" layer(theme);')).toBeLessThan(at('@import "tailwindcss/preflight.css" layer(base);'));
    expect(at('@import "tailwindcss/preflight.css" layer(base);')).toBeLessThan(at('@import "./styles.css" layer(base);'));
    expect(read("main.tsx")).toContain('import "./index.css";');
  });

  it("maps every colour utility to a theme token and clears Tailwind's own palette", () => {
    const inline = entry.slice(at("@theme inline {"), entry.indexOf("\n}\n", at("@theme inline {")));
    // mutation: drop the palette reset -> bg-blue-500 and friends exist beside the tokens, red
    expect(inline).toContain("--color-*: initial;");
    const colours = [...inline.matchAll(/^\s*(--color-[a-z0-9-]+): ([^;]+);/gm)].map((m) => [m[1]!, m[2]!] as const);
    expect(colours.length).toBeGreaterThan(20);
    // Every colour but the scrim (a fixed dimming over any theme) is a var() of a styles.css token.
    for (const [name, value] of colours) if (name !== "--color-scrim") expect(value, name).toMatch(/^var\(--[a-z0-9-]+\)$/);
    const sheet = read("styles.css");
    for (const [name, value] of colours) {
      const token = /^var\((--[a-z0-9-]+)\)$/.exec(value)?.[1];
      if (token !== undefined) expect(sheet, `${name} -> ${token}`).toContain(`${token}:`);
    }
    // The scale: one spacing step is --space-1, radii and shadows are the sheet's.
    expect(inline).toContain("--spacing: var(--space-1);");
    for (const pair of ["--radius-control: var(--radius-sm);", "--radius-card: var(--radius);", "--shadow-float: var(--shadow-pop);"]) expect(inline).toContain(pair);
  });

  it("uses no class from Tailwind's default palette, which index.css clears (the class would paint nothing)", () => {
    const palette = /\b(?:bg|text|border|ring|outline|fill|stroke|from|to|via|accent|caret|decoration|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)(?:-\d{2,3})?\b/;
    const files = [...readdirSync(fileURLToPath(new URL("../src", import.meta.url))).filter((f) => f.endsWith(".tsx")),
      ...readdirSync(fileURLToPath(new URL("../src/ui", import.meta.url))).map((f) => `ui/${f}`)];
    expect(files.length).toBeGreaterThan(50);
    for (const file of files) expect(read(file), file).not.toMatch(palette);
  });

  it("keeps a hidden pane and a hidden settings category hidden whatever utility an element carries", () => {
    const sheet = read("styles.css");
    // mutation: drop !important -> a display utility on a pane (later layer) shows every section at once, red
    expect(sheet).toContain('.section-pane:not([data-active="true"]) { display: none !important; }');
    expect(sheet).toContain('.settings-category:not([data-active="true"]), .settings[data-active="false"] { display: none !important; }');
  });

  it("bundles the two fonts as woff2 only, exposed as --font-sans and --font-mono", () => {
    const fonts = read("fonts.css");
    const urls = [...fonts.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1]!);
    expect(urls).toHaveLength(6);
    // mutation: point one face at a .woff -> the panel's static server types it application/octet-stream, red
    for (const url of urls) expect(url).toMatch(/^@fontsource\/(inter|jetbrains-mono)\/files\/[a-z-]+-latin-[0-9]{3}-normal\.woff2$/);
    expect(entry).toMatch(/--font-sans: "Inter", /);
    expect(entry).toMatch(/--font-mono: "JetBrains Mono", /);
    // The default look keeps the system stack until a theme chooses the bundled faces (web/DESIGN.md "Type").
    expect(read("styles.css")).toMatch(/body \{[^}]*var\(--font\)/);
  });
});
