// Issue #215 (human ruling 2026-11-09, option A): a failed run whose terminal carries ccloop's positive proof that nothing
// was spent settles at zero and releases its reservation; without that proof the acknowledgement is refused by name.
import { describe, expect, it } from "vitest";
import { withCommandContext } from "../../src/control/commandClient.js";
import { readGroup } from "../../src/control/queries.js";
import { driverHarness } from "./fixtures/driverHarness.js";

const known = { failure: () => ({ failureCause: { cause: "rate-limited" as const, phase: "plan" as const, retries: 0, detail: null, usageKnownZero: true as const } }) };
const unknown = { failure: () => ({ failureCause: { cause: "rate-limited" as const, phase: "plan" as const, retries: 0, detail: null } }) };

async function blockedRun(options: Parameters<typeof driverHarness>[1]) {
  const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "failed-usage-unknown", sealedOwnerProof: true, tokenPolicy: "optional-v1", ...options });
  const runId = await t.claim(), driver = t.driver();
  await t.until(driver, () => t.body(runId).state === "blocked");
  const settle = (acknowledge: string) => {
    const run = t.body(runId);
    return withCommandContext(`settle-known-${runId}`, { client: "web", principal: "user:owner" }, () => (t.service as any).settleUnknownUsage({
      schema: "orca-raw-command-v1", commandId: `settle-known-${runId}`, actorId: "human", expectedRevision: Number(t.h.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision),
      verb: "settle-unknown-usage", target: { kind: "group", groupId: "g" },
      payload: { taskId: "a", runId, generation: run.generation, acknowledge },
    }));
  };
  return { t, runId, settle };
}

describe("a proved-zero failure settles without charging (#215)", () => {
  it("books nothing, releases the reservation, and lets the run close", async () => {
    const { t, runId, settle } = await blockedRun(known);
    try {
      const before = t.body(runId), ledger = readGroup(t.h.store, "g");
      expect(before.unknown.work).toBe(true);
      const result = await settle("release-known-zero");
      if ("error" in result) throw new Error(JSON.stringify(result.error));
      const after = t.body(runId), group = readGroup(t.h.store, "g");
      expect(after).toMatchObject({ unknown: { work: false, handoff: false }, cumulative: { work: { tokens: 0 }, handoff: { tokens: 0 } } });
      expect(after.usageSettlement).toMatchObject({ method: "known-zero", charged: { work: { tokens: 0 }, handoff: { tokens: 0 } }, reservationDisposition: "committed" });
      expect(group.used).toEqual(ledger.used);
      expect(group.reserved.tokens).toBe(ledger.reserved.tokens - before.remaining.work.tokens - before.remaining.handoff.tokens);
      expect(t.service.closeRun(t.h.command("close-run", { runId }))).toMatchObject({ result: { kind: "run-closed" } });
      await t.service.pauseDispatch(t.h.command("pause-dispatch", {}));
      expect(t.service.archiveGroup(t.h.command("archive-group", {}))).toMatchObject({ result: { kind: "archived" } });
    } finally { await t.h.dispose(); }
  });

  it("refuses the zero acknowledgement when the terminal carries no proof", async () => {
    const { t, runId, settle } = await blockedRun(unknown);
    try {
      const before = t.body(runId), group = readGroup(t.h.store, "g");
      expect(await settle("release-known-zero")).toMatchObject({ error: { code: "run-usage-not-settleable", message: "run-usage-not-settleable:known-zero-not-proved" } });
      expect(t.body(runId)).toEqual(before);
      expect(readGroup(t.h.store, "g")).toEqual(group);
    } finally { await t.h.dispose(); }
  });
});
