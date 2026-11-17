import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { userDataSnapshot } from "./relocateUserData.js";

// #315: a running panel writes its own logs and pid/lock files under ~/.orca/panel every driver round, which used to make
// every test file red while the tests themselves passed. The guard excludes those runtime files and nothing else.
const root = mkdtempSync(join(tmpdir(), "orca-userdata-guard-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("the Rule 17 user-data snapshot (#315)", () => {
  it("ignores the panel's runtime files but still names a test write", () => {
    mkdirSync(join(root, "panel", "logs"), { recursive: true });
    mkdirSync(join(root, "control"), { recursive: true });
    writeFileSync(join(root, "panel", "logs", "panel.err.log"), "grown");
    writeFileSync(join(root, "panel", "panel.json"), "{}");
    writeFileSync(join(root, "panel", "panel.lock"), "{}");
    writeFileSync(join(root, "panel", "service.env"), "A=1\n");
    writeFileSync(join(root, "control", "control.sqlite"), "db");
    const before = userDataSnapshot(root);
    expect(before).toContain("control/control.sqlite:2");
    // A file the panel writes only at install stays guarded.
    expect(before).toContain("panel/service.env:4");
    expect(before.join("\n")).not.toContain("panel/logs");
    expect(before.join("\n")).not.toContain("panel/panel.json");
    expect(before.join("\n")).not.toContain("panel/panel.lock");
    // mutation: stop walking control/ -> the next assertion has nothing to find.
    writeFileSync(join(root, "control", "written-by-test"), "x");
    expect(userDataSnapshot(root)).not.toEqual(before);
  });

  // #338 replaced this criterion (it pinned files deep inside control/panel.runs/<run>/control/): run directories are now
  // recorded by their top-level entries only, which also hides #315's accept-claim file. What stays pinned: a run that a
  // test creates still shows, and a write inside an existing run (the panel's own run state) does not.
  it("a run directory is compared by its top-level entries: a new run shows, the panel's writes inside a run do not", () => {
    const runId = "run-11111111-2222-4333-8444-555555555555";
    const claimId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const control = join(root, "control", "panel.runs", runId, "control");
    mkdirSync(control, { recursive: true });
    const before = userDataSnapshot(root);
    expect(before.some((line) => line.startsWith(`control/panel.runs/${runId}:dir:`))).toBe(true);
    for (const file of [`accepted.lock.${claimId}`, "accepted.json"]) writeFileSync(join(control, file), "x");
    expect(userDataSnapshot(root)).toEqual(before);
    mkdirSync(join(root, "control", "panel.runs", "run-from-a-test"));
    expect(userDataSnapshot(root)).not.toEqual(before);
  });
});
