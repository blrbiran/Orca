import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  durableCommandErrorStatuses,
  nonDurableControlErrorClassifications,
  v1WebErrorCodes,
} from "../../src/control/errors.js";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : extname(path) === ".ts" ? [path] : [];
  });
}

describe("control error classification", () => {
  it("classifies every literal control error and every audited V1 Web error exactly once", () => {
    const root = fileURLToPath(new URL("../../src/control/", import.meta.url));
    const sourceCodes = new Set<string>();
    for (const path of sourceFiles(root)) {
      const source = readFileSync(path, "utf8");
      for (const match of source.matchAll(/new\s+ControlError\(\s*["']([^"']+)["']/g)) sourceCodes.add(match[1]!);
    }

    const durable = new Set<string>(Object.keys(durableCommandErrorStatuses));
    const nonDurable = new Set<string>(Object.keys(nonDurableControlErrorClassifications));
    expect([...durable].filter((code) => nonDurable.has(code))).toEqual([]);
    expect([...sourceCodes].filter((code) => !durable.has(code) && !nonDurable.has(code)).sort()).toEqual([]);
    expect(v1WebErrorCodes.filter((code) => !durable.has(code) && !nonDurable.has(code))).toEqual([]);
    expect(new Set(v1WebErrorCodes).size).toBe(v1WebErrorCodes.length);
    expect([...v1WebErrorCodes].sort()).toEqual(v1WebErrorCodes);
  });
});
