import { describe, expect, it } from "vitest";
import { WebControlService } from "../../src/control/webService.js";
import { deliverScheduledStart, scheduleStart } from "../../src/control/webDispatch.js";
import { canonicalBytes } from "../../src/control/canonicalJson.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";

/**
 * Tester round 2, web part: the estimate banners name the grant an over-grant run went past, and the run view's
 * `remaining` is clamped at 0, so the view carries the run's grant in its bucket. Compared with the stored run row the
 * claim wrote, never with a value this test seeded.
 */
describe("run view grant", () => {
  it("gives an estimate run's work grant as stored on the run", async () => {
    const h = await webFixture(undefined, [{ taskId: "a" }]);
    try {
      const run = await new WebControlService(h.deps).claimEstimate("g", h.estimateId);
      if (run === null) throw new Error("estimate not claimed");
      const stored = JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(run.runId)!.body)).grant.work;
      const view = readControlGroup(h.store, "epoch", "g").runs.find((candidate) => candidate.runId === run.runId)!;
      expect(stored.tokens).toBeGreaterThan(0);
      expect(view.grant).toEqual(stored);
    } finally { await h.dispose(); }
  });

  it("gives a handoff-phase run its handoff grant, not its predecessor's work grant", async () => {
    const h = await webFixture(profileSnapshot());
    try {
      await new WebControlService(h.deps).confirm(h.command("confirm", await h.confirmPayload()));
      await scheduleStart({ store: h.store, profileRouter: h.deps.profileRouter }, h.command("start", {}));
      const claimed = await deliverScheduledStart({ store: h.store, profileRouter: h.deps.profileRouter }, "g");
      if (claimed.kind !== "claimed") throw new Error(`claim did not start a run: ${claimed.kind === "blocked" ? claimed.reason : claimed.kind}`);
      const source = JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(claimed.runId)!.body)) as
        { runId: string; workItemId: string; generation: number; grant: { work: unknown; handoff: unknown } };
      // readControlGroup only accepts a consistent run lineage, so the handoff row is cloned from the claim and the work item follows it.
      const handoff = { ...structuredClone(source), runId: "handoff-run", phase: "handoff", providerAttemptOrdinal: 1, state: "start-pending" };
      const predecessor = { ...structuredClone(source), state: "settled-recoverable" };
      h.store.db.prepare("UPDATE runs SET active=0, body=? WHERE id=?").run(JSON.stringify(predecessor), claimed.runId);
      h.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES (?,?,?,?,1,?)")
        .run("handoff-run", "g", source.workItemId, source.generation, JSON.stringify(handoff));
      const request = {
        requestId: "handoff-request-1", runId: "handoff-run", state: "request-pending",
        deadlineAt: "2026-10-26T00:00:00.000Z", phaseAttemptOrdinal: 1, failureCode: null, evidenceIds: [],
      };
      h.store.db.prepare("INSERT INTO handoff_requests(id,group_id,run_id,state,body) VALUES (?,?,?,?,?)")
        .run(request.requestId, "g", request.runId, request.state, canonicalBytes(request).toString("utf8"));
      const work = JSON.parse(String(h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(source.workItemId)!.body)) as
        { currentRunId: string; lineageRunIds: string[] };
      work.currentRunId = "handoff-run";
      work.lineageRunIds = [...work.lineageRunIds, "handoff-run"].sort();
      h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id=?").run(JSON.stringify(work), source.workItemId);

      expect(source.grant.handoff).not.toEqual(source.grant.work);
      const view = readControlGroup(h.store, "epoch", "g").runs.find((candidate) => candidate.runId === "handoff-run");
      if (view === undefined) throw new Error("handoff run view missing");
      expect(view.grant).toEqual(source.grant.handoff);
      expect(view.grant).not.toEqual(source.grant.work);
    } finally { await h.dispose(); }
  });
});
