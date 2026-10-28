import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Session e236bbe4: singleCallPurposes.ts imported the estimate settlement from webService.ts, which imports
// singleCallPurposes.ts back (m4, session 3cd8fb02). It only worked because both sides used the other inside function
// bodies; a module-level use on either side would read an uninitialised binding. The settlement now lives in
// estimateSettlement.ts. This walks the value imports (`import type` is erased) reachable from singleCallPurposes.ts.
const root = resolve(import.meta.dirname, "../../src");

function valueImports(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const specs = [...text.matchAll(/^import\s+(?!type\s)[^;]*?from\s+"(\.[^"]+)";/gms)].map(m => m[1]);
  return specs.map(spec => resolve(dirname(file), spec.replace(/\.js$/, ".ts")));
}

function reachable(start: string): Set<string> {
  const seen = new Set<string>(), queue = [start];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    queue.push(...valueImports(file));
  }
  return seen;
}

describe("single-call purposes import graph", () => {
  it("does not reach webService.ts, which imports singleCallPurposes.ts", () => {
    const closure = reachable(resolve(root, "control/singleCallPurposes.ts"));
    // Positive control: the walk does follow imports (the settlement module is reached).
    expect(closure.has(resolve(root, "control/estimateSettlement.ts"))).toBe(true);
    expect(closure.has(resolve(root, "control/webService.ts"))).toBe(false);
  });
});
