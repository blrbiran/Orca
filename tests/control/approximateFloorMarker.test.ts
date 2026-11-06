// Spec 2026-11-06 soft-mode loop run settlement §3.2, criteria O4-O7, O15 (session 86352010): the `approximate-floor` marker
// is valid only backed by orca-auto's own `settle-approximate-usage` row and the booked arithmetic, and a person's row and
// Orca's row cannot stand in for each other.
import { describe, expect, it } from "vitest";
import { withCommandContext } from "../../src/control/commandClient.js";
import { hasValidUsageSettlement, lineageWorkUsage } from "../../src/control/usageSettlement.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { estimatorSized, loopUnknown, pass, since, type Harness } from "./fixtures/softLoop.js";
import { unknownFailure, settle } from "./fixtures/unknownFailure.js";

async function settled(options: Parameters<typeof loopUnknown>[0] = { tokenPolicy: "optional-v1", floor: 500 }) {
  const x = await loopUnknown(options);
  since(x.t);
  expect(pass(x.t)).toBe(true);
  return x;
}
const valid = (t: Harness, run: unknown) => hasValidUsageSettlement(t.h.store, run);
const forged = (t: Harness, runId: string, patch: (run: any) => void) => { const run = structuredClone(t.body(runId)); patch(run); return valid(t, run); };
/** Rewrite one column of the run's command row (and put it back), as a forged or swapped receipt. */
function withRow(t: Harness, id: string, set: string, value: string, fn: () => void) {
  const before = t.h.store.db.prepare(`SELECT ${set} AS v FROM commands WHERE id=?`).get(id)!.v;
  t.h.store.db.prepare(`UPDATE commands SET ${set}=? WHERE id=?`).run(value, id);
  try { fn(); } finally { t.h.store.db.prepare(`UPDATE commands SET ${set}=? WHERE id=?`).run(before as string, id); }
}

describe("approximate-floor marker", { timeout: 60_000 }, () => {
  it("O4: valid fresh; each forgery is refused", async () => {
    const { t, runId, driver } = await settled(); try {
      const id = t.body(runId).usageSettlement.commandId;
      expect(valid(t, t.body(runId))).toBe(true);
      // usageApproximate absent: the marker must match the run's own record of the floor.
      expect(forged(t, runId, r => { delete r.usageApproximate; })).toBe(false);
      // Floor tampered consistently on the marker and the run: the charge no longer is the floor.
      expect(forged(t, runId, r => { r.usageSettlement.floorTokens += 1; r.usageApproximate.floorTokens += 1; })).toBe(false);
      // A person's principal on Orca's method.
      expect(forged(t, runId, r => { r.usageSettlement.principal = "user:x"; })).toBe(false);
      // A handoff charge (with a receipt that agrees, so only the charge rule can refuse it).
      const receipt = JSON.parse(String(t.h.store.db.prepare("SELECT body_json FROM commands WHERE id=?").get(id)!.body_json));
      receipt.result.charged.handoff.tokens = 1;
      withRow(t, id, "body_json", JSON.stringify(receipt), () => expect(forged(t, runId, r => { r.usageSettlement.charged.handoff.tokens = 1; r.cumulative.handoff.tokens += 1; })).toBe(false));
      withRow(t, id, "principal", "user:x", () => expect(valid(t, t.body(runId))).toBe(false));
      withRow(t, id, "verb", "settle-unknown-usage", () => expect(valid(t, t.body(runId))).toBe(false));
      expect(valid(t, t.body(runId))).toBe(true);
    } finally { await driver.stop(); await t.h.dispose(); }
  });

  it("O4: a person's remaining-grant marker is not backed by an orca-auto row", async () => {
    const { t, runId } = await unknownFailure(); try {
      expect(await settle(t, runId)).not.toHaveProperty("error");
      const id = t.body(runId).usageSettlement.commandId;
      expect(valid(t, t.body(runId))).toBe(true);
      withRow(t, id, "verb", "settle-approximate-usage", () => withRow(t, id, "principal", "orca-auto", () => expect(valid(t, t.body(runId))).toBe(false)));
    } finally { await t.h.dispose(); }
  });

  it("O5: the group view reads it", async () => {
    const { t, runId, driver } = await settled(); try {
      const view = readControlGroup(t.h.store, "epoch", "g");
      expect(view.runs.find(r => r.runId === runId)!.unknownUsageSettlement!.settlement).toMatchObject({ method: "approximate-floor", principal: "orca-auto" });
    } finally { await driver.stop(); await t.h.dispose(); }
  });

  it("O6: the lineage keeps the floor, recovered or not", async () => {
    const { t, runId, driver } = await settled(); try {
      const run = t.body(runId);
      expect(lineageWorkUsage(run)).toEqual(run.cumulative.work);
      const recovered = structuredClone(run); recovered.usageSettlement.reservationDisposition = "recovered";
      expect(lineageWorkUsage(recovered)).toEqual(run.cumulative.work);
    } finally { await driver.stop(); await t.h.dispose(); }
  });

  it("O7: a person cannot settle it again", async () => {
    const { t, runId, driver } = await settled(); try {
      const c = t.h.command("settle-unknown-usage", { taskId: "a", runId, generation: 1, acknowledge: "release-unmetered" });
      const result = await withCommandContext(c.commandId, { client: "web", principal: "user:owner" }, () => (t.service as any).settleUnknownUsage(c));
      expect(result).toMatchObject({ error: { code: "run-usage-settled" } });
    } finally { await driver.stop(); await t.h.dispose(); }
  });

  it("O15: a finite limit set afterwards leaves the marker valid and the view readable", async () => {
    // An estimator-sized finite task grant, so a finite group limit is admissible while the run is active.
    const x = await loopUnknown({ tokenPolicy: "optional-v1", floor: 500, tasks: [{ taskId: "a", tokenBudget: 99_000 }, { taskId: "b", tokenBudget: 99_000 }] });
    const { t, runId, driver } = x; try {
      const restore = estimatorSized(t, "a"); since(t);
      expect(pass(t)).toBe(true);
      restore();
      const g = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
      const limit = { ...g.limit, tokens: g.used.tokens + g.reserved.tokens + 1_000_000 };
      expect(t.service.setLimit(t.h.command("set-limit", { limit }))).not.toHaveProperty("error");
      expect(valid(t, t.body(runId))).toBe(true);
      expect(readControlGroup(t.h.store, "epoch", "g").runs.find(r => r.runId === runId)!.unknownUsageSettlement!.settlement).toMatchObject({ method: "approximate-floor" });
    } finally { await driver.stop(); await t.h.dispose(); }
  });
});
