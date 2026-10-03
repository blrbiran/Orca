import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { logLines } from "./fixtures/ccloopWorld.js";

// A fake CLI's log, polled while the fake runs (estimateE2E E2 polls `argv` until one call is there): the file
// exists empty between the fake's open and its write, and that state must read as "no call yet".
describe("logLines", () => {
  let dir = "";
  afterEach(() => { if (dir !== "") rmSync(dir, { recursive: true, force: true }); dir = ""; });
  const log = (content: string): string => {
    dir = mkdtempSync(join(tmpdir(), "ll-"));
    const path = join(dir, "x.argv");
    writeFileSync(path, content);
    return path;
  };

  it("reads a log created but not yet written as no lines, so a poll waits instead of parsing an empty line", () => {
    expect(logLines(log(""))).toEqual([]);
  });

  it("reads one line per call", () => {
    expect(logLines(log('["exec","a"]\n["exec","b"]\n'))).toEqual(['["exec","a"]', '["exec","b"]']);
  });
});
