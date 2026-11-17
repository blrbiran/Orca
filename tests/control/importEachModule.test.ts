import { readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { expect, it, vi } from "vitest";

/**
 * #328 ① and session 3cfc2e73 (docs/handoff/known-load-flakes.md): src/control holds a 52-module import cycle, and a
 * module on it can see an import as `undefined` at evaluation time depending on which module the cycle was entered
 * from -- 90 test files failed to load (`TypeError ... 'attempts'`) after one added static import. Which entry point a
 * test happens to use decides whether that shows, so this enters through every module of src/ in turn, each in a fresh
 * module registry: the import must succeed, and no export may be `undefined` (a value captured before its source ran).
 */
const src = resolve("src");
// Programs, not modules: importing one runs it. validateFindings is the reviewer's findings check
// (modelReview/plan.ts runs dist/control/validateFindings.js); it reads argv and exits at the top level.
const PROGRAMS = new Set(["src/control/validateFindings.ts"]);
const modules = readdirSync(src, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts"))
  .map((entry) => relative(process.cwd(), join(entry.parentPath, entry.name)))
  .filter((file) => !PROGRAMS.has(file))
  .sort();

it("every module under src/ imports on its own, with every export defined", async () => {
  expect(modules.length).toBeGreaterThan(100); // the walk found the tree, not an empty directory
  const failures: string[] = [];
  for (const file of modules) {
    vi.resetModules();
    try {
      const namespace = (await import(/* @vite-ignore */ resolve(file))) as Record<string, unknown>;
      const undefinedExports = Object.keys(namespace).filter((key) => namespace[key] === undefined);
      if (undefinedExports.length) failures.push(`${file}: undefined at import: ${undefinedExports.join(", ")}`);
    } catch (error) {
      failures.push(`${file}: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
    }
  }
  expect(failures).toEqual([]);
}, 900_000);
