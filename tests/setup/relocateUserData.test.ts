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
});
