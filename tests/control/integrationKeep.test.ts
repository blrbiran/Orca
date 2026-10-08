// Integration spec §1, §3.1 (ruling R5), review focus 1: a keep group -- every group of every existing user -- is not
// touched by the integration pass. Its body carries no `integration`, and the pass starts no git child for it.
import { afterEach, describe, expect, it } from "vitest";
import { __setRunChildForTests, spawnRunChild } from "../../src/control/integrationGit.js";
import { driverHarness } from "./fixtures/driverHarness.js";

afterEach(() => { __setRunChildForTests(null); });

describe("a keep group (integration spec §3.1, ruling R5)", () => {
  it("lands and settles through the driver with no integration child started, its body unchanged, and a quiet round after", async () => {
    const calls: string[][] = [];
    __setRunChildForTests((bin, args, opts) => { calls.push([bin, ...args]); return spawnRunChild(bin, args, opts); });
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "settled");
      const body = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;
      expect(Object.hasOwn(body, "integration")).toBe(false);
      expect(t.body(runId).drive.landedCommit).toMatch(/^[a-f0-9]{40}$/);
      // Nothing is left to move: the pass adds no progress of its own for a keep group.
      expect(await driver.round()).toBe(false);
      expect(calls).toEqual([]);
    } finally { await t.h.dispose(); }
  });
});
