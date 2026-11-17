import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { userDataSnapshot } from "./relocateUserData.js";

/**
 * #338 (tester): the Rule 17 guard snapshots the real ~/.orca in setup and afterAll; on a 4.6 GB / 410k-file ~/.orca one
 * snapshot took ~12 s and every file failed the 10 s hook default. Nearly all of those files are run state under
 * `<key>.runs/` and `<key>.workspaces/`. The guard's home here is a temp directory (Rule 17: never the real one).
 */
const home = mkdtempSync(join(tmpdir(), "orca-userdata-bound-"));
const RUN_FILES = 100_000;
beforeAll(() => {
  // 100 workspaces x 1,000 files under one run-state directory, plus a durable store beside it.
  for (let d = 0; d < 100; d += 1) {
    const dir = join(home, "control", "panel.workspaces", `run-${d}`, "repo", "src");
    mkdirSync(dir, { recursive: true });
    for (let f = 0; f < RUN_FILES / 100; f += 1) writeFileSync(join(dir, `f${f}.ts`), "");
  }
  mkdirSync(join(home, "control", "panel", "groups"), { recursive: true });
  writeFileSync(join(home, "control", "panel", "control.sqlite"), "db");
  writeFileSync(join(home, "control", "panel", "groups", "g1.json"), "{}");
}, 600_000);
afterAll(() => rmSync(home, { recursive: true, force: true }), 600_000);

describe("the Rule 17 snapshot is bounded by run state, not by its file count (#338)", () => {
  it(`records a run-state directory of ${RUN_FILES} files by its top-level entries, within a bound`, () => {
    const started = performance.now();
    const snapshot = userDataSnapshot(home);
    const elapsed = performance.now() - started;
    // mutation: walk run-state directories file by file -> 100,000 workspace lines, and the walk takes seconds.
    expect(snapshot.filter((line) => line.startsWith("control/panel.workspaces/")).length).toBe(100);
    expect(elapsed).toBeLessThan(2_000);
  });

  it("still names a write to a durable path: a changed store, a new record", () => {
    const before = userDataSnapshot(home);
    expect(before).toContain("control/panel/control.sqlite:2");
    writeFileSync(join(home, "control", "panel", "control.sqlite"), "db-grown");
    expect(userDataSnapshot(home)).not.toEqual(before);
    const grown = userDataSnapshot(home);
    // mutation: treat control/<key>/ as run state too -> a new group record is invisible.
    writeFileSync(join(home, "control", "panel", "groups", "g2.json"), "{}");
    expect(userDataSnapshot(home)).toContain("control/panel/groups/g2.json:2");
    expect(userDataSnapshot(home)).not.toEqual(grown);
  });
});
