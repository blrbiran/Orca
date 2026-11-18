/**
 * Off-plan writes spec W3 (#346, fix round 2): the off-plan record is information only. When it cannot be read at an
 * acceptance (here: the record's reader throws, as an unreadable frozen contract would), the acceptance still lands and
 * no row is written; the failure goes to stderr. Its own file, because the reader is replaced for the whole module.
 */
import { describe, expect, it, vi } from "vitest";
import { withCommandContext } from "../../src/control/commandClient.js";
import { driverHarness } from "./fixtures/driverHarness.js";

vi.mock("../../src/control/offPlanWrites.js", async (original) => ({
  ...(await original<typeof import("../../src/control/offPlanWrites.js")>()),
  landingOffPlanWrite: vi.fn(async () => { throw new Error("frozen contract unreadable"); }),
}));

describe("an acceptance whose off-plan record cannot be read", { timeout: 120_000 }, () => {
  it("lands, writes no row, and says why on stderr", async () => {
    const t = await driverHarness([{ taskId: "a", targetPaths: ["a"] }], { behaviour: () => "failed", sealedOwnerProof: true, files: () => ({ a: "a\n", "notes.md": "n\n" }) });
    const stderr = vi.spyOn(process.stderr, "write");
    try {
      const runId = await t.claim(), driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "blocked");
      const closed = t.service.closeRun(t.h.command("close-run", { runId }));
      if ("error" in closed) throw new Error(JSON.stringify(closed));
      await t.until(driver, () => t.body(runId).drive.cleanedUp === true);
      const command = t.h.command("accept-attempt", { taskId: "a", runId, note: "read the diff" }, "acc-1");
      await withCommandContext(command.commandId, { client: "web", principal: "user:owner" }, () => t.service.acceptAttempt(command));
      const deadline = Date.now() + 60_000;
      while (!["landed", "refused"].includes(t.body(runId).operatorAcceptance?.state) && Date.now() < deadline) {
        await driver.round(); await new Promise((resolve) => setTimeout(resolve, 50));
      }
      // mutation: no catch in acceptedOffPlan -> the acceptance is refused, red
      expect(t.body(runId).operatorAcceptance).toMatchObject({ state: "landed", reason: null });
      expect(t.h.store.db.prepare("SELECT 1 FROM activity WHERE group_id='g' AND kind='off-plan-write'").all()).toEqual([]);
      expect(stderr.mock.calls.map(([chunk]) => String(chunk)).join("")).toContain("frozen contract unreadable");
    } finally { stderr.mockRestore(); await t.h.dispose(); }
  });
});
