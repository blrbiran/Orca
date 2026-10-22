import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * scripts/assert-selected.mjs (checks plan 2026-10-22 Task 11): the final gate's `npm test` runs only what the change
 * selects, so a criterion file the selection missed would never run and the gate would still be green. The script reads
 * the `npm test` log and exits 1 naming each expected path that test-affected.mjs did not print as selected.
 */
const script = resolve("scripts/assert-selected.mjs");
const dir = mkdtempSync(join(tmpdir(), "assert-selected-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// The selection lines exactly as scripts/test-affected.mjs prints them (`  <suite> <file> <- <why>`).
const LOG = [
  "test-affected: 3 changed paths against main (committed since the merge base, staged, unstaged, untracked)",
  "  root tests/control/checkCron.test.ts <- src/control/checks/cron.ts (related)",
  "  root tests/control/checkTriggers.test.ts <- tests/control/checkTriggers.test.ts (changed test)",
  "  web web/tests/checksSettings.test.tsx <- web/src/ChecksSettings.tsx (related)",
  "test-affected: 3 test files selected (2 root, 1 web)",
  // A path that only appears in a vitest line is not a selection.
  " ✓ tests/control/checkWatermark.test.ts (12 tests) 900ms",
].join("\n");

function run(...paths: string[]) {
  const log = join(dir, "npm-test.log");
  writeFileSync(log, LOG);
  return spawnSync(process.execPath, [script, log, ...paths], { encoding: "utf8" });
}

describe("assert-selected", () => {
  it("exits 0 when every named path was selected, root and web", () => {
    const r = run("tests/control/checkCron.test.ts", "tests/control/checkTriggers.test.ts", "web/tests/checksSettings.test.tsx");
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: "" });
  });

  it("exits 1 naming each path the selection missed, a vitest line not counting as selected", () => {
    // mutation: match the path anywhere in the log -> checkWatermark counted as selected, status 0, red
    const r = run("tests/control/checkCron.test.ts", "tests/control/checkWatermark.test.ts", "web/tests/removed.test.tsx");
    expect(r.status).toBe(1);
    expect(r.stderr).toBe("assert-selected: not selected: tests/control/checkWatermark.test.ts\nassert-selected: not selected: web/tests/removed.test.tsx\n");
  });

  it("exits 2 when it is not given a log and at least one path", () => {
    expect(run().status).toBe(2);
  });
});
