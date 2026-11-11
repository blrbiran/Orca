import { describe, expect, it } from "vitest";
import { withCommandContext } from "../../src/control/commandClient.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness } from "./fixtures/driverHarness.js";

/**
 * Reviewed acceptance (spec 2026-11-11 §7, #227), the read side: once an owner's acceptance is recorded on a run, the
 * group view still answers (the persisted run schema is strict, so an unknown `operatorAcceptance` key refused the whole
 * view), and the run carries the acceptance's state for the Web -- pending, landed or refused, with the person's note.
 * Named mutations (each seen red, Rule 9): drop `operatorAcceptance` from persistedRunSchema -> the view refuses
 * (run-invalid); drop the view field from runViews -> the run carries no `operatorAcceptance`.
 */
const OWNER = { client: "web", principal: "user:owner" };
const NOTE = "read the diff; the checks are what matter";

describe("the run view after an owner accepts an attempt (#227)", { timeout: 60_000 }, () => {
  it("still answers, and names the pending acceptance with its note; a run with none carries no field", async () => {
    const t = await driverHarness([{ taskId: "a", targetPaths: ["a"] }], { behaviour: () => "failed", sealedOwnerProof: true });
    try {
      const runId = await t.claim(), driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "blocked");
      const closed = t.service.closeRun(t.h.command("close-run", { runId }));
      if ("error" in closed) throw new Error(JSON.stringify(closed));
      await t.until(driver, () => t.body(runId).drive.cleanedUp === true);
      expect(readControlGroup(t.h.store, "epoch-test", "g").runs.find((r) => r.runId === runId)).not.toHaveProperty("operatorAcceptance");
      const command = t.h.command("accept-attempt", { taskId: "a", runId, note: NOTE }, "acc-view");
      const answer = await withCommandContext(command.commandId, OWNER, () => t.service.acceptAttempt(command as never));
      expect(answer).toMatchObject({ result: { kind: "attempt-accept-requested" } });
      const at = t.body(runId).operatorAcceptance.at;
      expect(readControlGroup(t.h.store, "epoch-test", "g").runs.find((r) => r.runId === runId)?.operatorAcceptance)
        .toEqual({ state: "pending", note: NOTE, principal: "user:owner", at, reason: null, landedCommit: null });
    } finally { await t.h.dispose(); }
  });
});
