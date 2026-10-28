import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
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

/**
 * Final pass of the Tailwind migration (controller session a9f9d6de): the shared component classes are `@utility` blocks in
 * index.css. `utility` returns one block's body (its nested rules included), so a test pins the declarations a class carries.
 */
export function utility(name: string): string {
  // A path, not a URL: under jsdom vite rewrites `new URL("…css", import.meta.url)` into an asset URL.
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/index.css"), "utf8");
  const at = css.indexOf(`@utility ${name} {`);
  if (at === -1) throw new Error(`index.css has no @utility ${name}`);
  let depth = 0;
  for (let i = css.indexOf("{", at); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(at, i + 1);
  }
  throw new Error(`@utility ${name} is not closed`);
}
