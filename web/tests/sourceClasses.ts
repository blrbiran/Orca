import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Tester round 2026-10-28 (Tailwind migration, batch 1): jsdom applies no sheet, so a layout promise that moved from
 * styles.css into utility classes is pinned on the class string that carries it. `carrying` returns the string literal
 * (a `+` continuation line included) that holds `hook` as a whole class token, so a test names the element, not a line.
 */
export const source = (file: string): string => readFileSync(fileURLToPath(new URL(`../src/${file}`, import.meta.url)), "utf8");

export function carrying(file: string, hook: string): string {
  // The shared strings live in ui/classes.ts (a component's own come first).
  for (const where of [file, "ui/classes.ts"]) {
    const found = carryingIn(where, hook);
    if (found !== undefined) return found;
  }
  throw new Error(`${file} and ui/classes.ts have no class string carrying ${hook}`);
}

function carryingIn(file: string, hook: string): string | undefined {
  const lines = source(file).split("\n");
  for (let at = 0; at < lines.length; at++) {
    for (const literal of lines[at]!.matchAll(/"([^"\n]*)"/g)) {
      if (!literal[1]!.split(/\s+/).includes(hook)) continue;
      let text = literal[1]!;
      for (let next = at + 1; next < lines.length && /^\s*\+\s*"/.test(lines[next]!); next++) text += ` ${/"([^"\n]*)"/.exec(lines[next]!)![1]!}`;
      return text;
    }
  }
  return undefined;
}
