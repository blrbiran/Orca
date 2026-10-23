import { describe, expect, it } from "vitest";
import { WebControlService } from "../../src/control/webService.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { webFixture } from "./fixtures/web.js";

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
});
