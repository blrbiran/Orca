// Tester #290 (follow-up J): the run body held `liveCeiling` (and, once ccloop stopped there, `liveCeilingStop`), but the
// group view's runs -- and so `run show` -- dropped them, so a person saw overExpectation and no ceiling at all. The run view
// now carries both as stored, and a run without them keeps its old shape (no key, not null).
import { describe, expect, it } from "vitest";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness } from "./fixtures/driverHarness.js";

describe("the run view carries the live ceiling (#290)", () => {
  it("as stored, and not at all on a run without one", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "accepted");
      const runView = () => readControlGroup(t.h.store, "epoch", "g").runs.find((run) => run.runId === runId)!;
      expect(runView()).not.toHaveProperty("liveCeiling");
      expect(runView()).not.toHaveProperty("liveCeilingStop");
      const ceiling = { revision: 1, tokens: 10_000_000, cause: "pause-line", deliveredRevision: 1 };
      const stop = { revision: 1, tokens: 10_000_000, cause: "pause-line", observedTokens: 62_998_085, phase: "execute", at: "boundary" };
      t.h.store.db.prepare("UPDATE runs SET body=json_set(body,'$.liveCeiling',json(?),'$.liveCeilingStop',json(?)) WHERE id=?").run(JSON.stringify(ceiling), JSON.stringify(stop), runId);
      // mutation (runView drops liveCeiling / liveCeilingStop) -> red here.
      expect(runView()).toMatchObject({ liveCeiling: ceiling, liveCeilingStop: stop });
    } finally { await t.h.dispose(); }
  });
});
