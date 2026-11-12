import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checksRead } from "../../src/control/checks/settings.js";
import { fullSuiteCommand } from "../../src/control/fullSuite.js";
import { readOrchestrationSettings, writeOrchestrationSettings } from "../../src/control/orchestration.js";
import { openControlStore, type ControlStore } from "../../src/control/store.js";
import { writeRepositorySettingsBody } from "../../src/control/workspaceSettings.js";

// Full suite spec 2026-11-12 §2-§3 (#279): the project's full-suite command is its integration-check command, read as every
// check setting is (project > global > none, under the global lock), whatever `enabled` says -- that switch is the
// integration check's trigger, and a person who set a command but left the trigger off still means "these are our tests".
// The read names the detected suggestion only while no command is in force, so Adopt is offered exactly then.

async function withStore(fn: (store: ControlStore) => void): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "suite-setting-"));
  const store = await openControlStore({ stateDir: join(root, "s") });
  try { fn(store); } finally { store.close(); await rm(root, { recursive: true, force: true }); }
}
const project = (store: ControlStore, integrationCheck: { enabled?: boolean; command?: string | null }) =>
  writeRepositorySettingsBody(store, "repo", { workspaceMode: "worktree", revision: 1, checks: { integrationCheck } });
const global = (store: ControlStore, checks: Record<string, unknown>) =>
  writeOrchestrationSettings(store, { ...readOrchestrationSettings(store), checks } as never, 1);

describe("the project's full-suite command (spec §2)", () => {
  it("none set: null", () => withStore((store) => {
    expect(fullSuiteCommand(store, "repo")).toBeNull();
  }));

  it("the project's integration-check command, with its trigger off", () => withStore((store) => {
    project(store, { enabled: false, command: "npm test" });
    expect(fullSuiteCommand(store, "repo")).toBe("npm test");
  }));

  it("the global one when the project has none; under a lock, a looser project command is ignored", () => withStore((store) => {
    global(store, { integrationCheck: { command: "make check" } });
    expect(fullSuiteCommand(store, "repo")).toBe("make check");
    project(store, { command: "npm test" });
    expect(fullSuiteCommand(store, "repo")).toBe("npm test");
    global(store, { integrationCheck: { command: "make check" }, locks: ["integrationCheck.command"] });
    expect(fullSuiteCommand(store, "repo")).toBe("make check");
  }));
});

describe("the read's suggestedCommand (spec §3)", () => {
  it("is the suggestion while no command is in force, null once one is, and null for the global read", () => withStore((store) => {
    const asked: string[] = [];
    const suggest = () => { asked.push("asked"); return "npm test"; };
    expect(checksRead(store, "repo", 0, suggest).suggestedCommand).toBe("npm test");
    expect(checksRead(store, null, 0, suggest).suggestedCommand).toBeNull();
    project(store, { command: "pytest" });
    expect(checksRead(store, "repo", 0, suggest).suggestedCommand).toBeNull();
    // Detection reads files; it is not asked when its answer would not be shown.
    expect(asked).toEqual(["asked"]);
  }));
});
