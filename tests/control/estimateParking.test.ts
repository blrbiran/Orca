import { describe, expect, it } from "vitest";
import { canonicalBytes } from "../../src/control/canonicalJson.js";
import { readEstimateRecord } from "../../src/control/queries.js";
import { recoverControl } from "../../src/control/recovery.js";
import { rearmParkedEstimates } from "../../src/control/estimateParking.js";
import { readWebGroup } from "../../src/control/webService.js";
import { queuedEstimateHarness } from "./fixtures/estimateHarness.js";

// Estimate parking spec 2026-10-21 (ruling "同意按你的建议，走挂起逻辑", session 308b874c): a queued estimate of a stopped
// pre-start group used to throw `group-stopped` inside its claim, so the wake was re-posted -- and the estimator probed
// again -- on every pump pass. It is now parked: still queued, grant still reserved, its wake acknowledged in the claim's
// own transaction; every un-stop path that can reach such a group puts the wake back.
type X = Awaited<ReturnType<typeof queuedEstimateHarness>>;
const wakeId = (x: X) => `scheduler-wake:g:estimate:${x.h.estimateId}`;
const delivered = (x: X) => Number(x.h.store.db.prepare("SELECT delivered FROM scheduler_wakes WHERE id=?").get(wakeId(x))!.delivered);
const state = (x: X) => readEstimateRecord(x.h.store, "g", x.h.estimateId).state;
const runs = (x: X) => Number(x.h.store.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE group_id='g' AND work_item_id=?").get(x.h.estimateId)!.n);
const launched = (x: X) => x.fake.calls.accept.map(envelope => envelope.claim.workItemId);
const reserved = (x: X) => readWebGroup(x.h.store, "g").ledger.committedRemaining.tokens;
const ok = (result: unknown) => { if (typeof result === "object" && result !== null && "error" in result) throw new Error(JSON.stringify(result)); return result as { result: Record<string, unknown> }; };

/** The parked shape: queued, grant still reserved, no run, nothing launched, wake acknowledged, and a later pump does not see it. */
async function expectParked(x: X, reservedBefore: number): Promise<void> {
  expect(state(x)).toBe("queued");
  expect(reserved(x)).toBe(reservedBefore);
  expect(runs(x)).toBe(0);
  expect(delivered(x)).toBe(1);
  const again = await x.pump();
  expect(again.delivered).not.toContain(wakeId(x));
  expect(again.deferred).not.toContain(wakeId(x));
  await x.rounds(3);
  expect(launched(x)).toEqual([]);
  expect(state(x)).toBe("queued");
}

describe("a queued estimate of a stopped pre-start group is parked, and un-stopping puts it back (estimate parking spec)", () => {
  it("pause: the claim parks the estimate instead of throwing, so the wake is not re-posted every pass", async () => {
    const x = await queuedEstimateHarness(); try {
      ok(await x.service.pauseDispatch(x.h.command("pause-dispatch", {})));
      const before = reserved(x);
      const first = await x.pump();
      expect(first.delivered).toEqual([]);
      await expectParked(x, before);
    } finally { await x.h.dispose(); }
  });

  it("resume-dispatch of a paused group whose proposal is not confirmed lifts the pause and re-arms the parked wake; the estimate then runs", async () => {
    const x = await queuedEstimateHarness(); try {
      ok(await x.service.pauseDispatch(x.h.command("pause-dispatch", {})));
      await x.pump();
      expect(delivered(x)).toBe(1);
      const resumed = ok(await x.service.resumeDispatch(x.h.command("resume-dispatch", {})));
      expect(resumed.result).toEqual({ kind: "resumed", operation: "resume-dispatch" });
      expect(readWebGroup(x.h.store, "g").stopped).toBe(false);
      expect(x.h.store.db.prepare("SELECT 1 FROM stop_intents WHERE group_id='g'").get()).toBeUndefined();
      expect(x.h.store.db.prepare("SELECT 1 FROM scheduler_wakes WHERE group_id='g' AND kind='start'").get()).toBeUndefined();
      expect(delivered(x)).toBe(0);
      await x.pump();
      expect(state(x)).toBe("running");
      await x.rounds();
      expect(launched(x)).toEqual([x.h.estimateId]);
      expect(state(x)).toBe("ready");
    } finally { await x.h.dispose(); }
  });

  it("resume-from-handoff re-arms the parked wake in the command's own transaction", async () => {
    const x = await queuedEstimateHarness(); try {
      ok(await x.service.handoffStop(x.h.command("handoff-stop", {})));
      const before = reserved(x);
      await x.pump();
      await expectParked(x, before);
      ok(await x.service.resumeFromHandoff(x.h.command("resume-from-handoff", { selections: [] })));
      expect(delivered(x)).toBe(0);
      await x.pump();
      expect(state(x)).not.toBe("queued");
    } finally { await x.h.dispose(); }
  });

  it("startup healing of an empty shutdown intent (an older Orca's) re-arms the parked wake", async () => {
    const x = await queuedEstimateHarness(); try {
      const revision = Number(x.h.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision);
      const body = canonicalBytes({ mode: "shutdown", state: "handoff-complete", frozenRunIds: [], acceptedAt: "2026-10-07T10:00:00.000Z", deadlineAt: "2026-10-07T10:02:00.000Z" }).toString("utf8");
      x.h.store.db.prepare("INSERT INTO stop_intents(group_id,mode,revision,body) VALUES ('g','shutdown',?,?)").run(revision, body);
      const group = JSON.parse(String(x.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
      x.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...group, stopped: true }));
      await x.pump();
      expect(delivered(x)).toBe(1);
      expect(state(x)).toBe("queued");
      await recoverControl(x.h.store, x.h.deps.port);
      expect(readWebGroup(x.h.store, "g").stopped).toBe(false);
      expect(delivered(x)).toBe(0);
    } finally { await x.h.dispose(); }
  });

  it("re-arming touches only wakes whose estimate is still queued: a delivered wake of an estimate that left the queue stays delivered", async () => {
    const x = await queuedEstimateHarness(); try {
      x.h.store.db.prepare("UPDATE scheduler_wakes SET delivered=1 WHERE id=?").run(wakeId(x));
      x.h.store.db.prepare("UPDATE estimates SET state='withdrawn' WHERE group_id='g' AND id=?").run(x.h.estimateId);
      rearmParkedEstimates(x.h.store, "g");
      expect(delivered(x)).toBe(1);
      x.h.store.db.prepare("UPDATE estimates SET state='queued' WHERE group_id='g' AND id=?").run(x.h.estimateId);
      rearmParkedEstimates(x.h.store, "g");
      expect(delivered(x)).toBe(0);
    } finally { await x.h.dispose(); }
  });
});
