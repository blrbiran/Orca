import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { orchestrationRevision, readOrchestrationSettings, writeOrchestrationSettings } from "../../src/control/orchestration.js";
import { applySetOrchestrationSettings } from "../../src/control/orchestrationCommands.js";
import { openControlStore } from "../../src/control/store.js";

// Found in session e2ad4802 (2026-11-05): the global flow settings (flow engine spec §11.2) and their admin locks live in
// the same orchestration settings row, and they are not set-orchestration-settings' to change. Changing the running-group
// cap must not silently drop a person's flow locks, as checks are already kept (checks spec 2026-10-22 §4.1).
describe("set-orchestration-settings", () => {
  it("keeps the stored global flow settings and the check settings it does not set", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orca-orch-flows-"));
    const store = await openControlStore({ stateDir: dir });
    try {
      const flows = { effects: { cost: "confirm" as const }, locks: ["effects.cost" as const] };
      const checks = {};
      writeOrchestrationSettings(store, { maxRunningGroups: 3, flows, checks } as never, 1);
      const answer = applySetOrchestrationSettings({ store }, {
        schema: "orca-raw-command-v1", commandId: "cap", actorId: "person", expectedRevision: orchestrationRevision(store),
        verb: "set-orchestration-settings", target: { kind: "orchestration" }, payload: { maxRunningGroups: 4 },
      } as never);
      expect("error" in (answer as object)).toBe(false);
      expect(readOrchestrationSettings(store)).toEqual({ maxRunningGroups: 4, flows, checks });
    } finally {
      store.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
