import { describe, expect, it } from "vitest";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness } from "./fixtures/driverHarness.js";

/**
 * Tester D19: `agent list` shows an installation's default model and the run view carried only its profile, so nothing
 * said which agent and model a run actually ran on. The run view now carries the selection the run was frozen with.
 */
describe("the run view names the agent and model the run was frozen with (D19)", { timeout: 60_000 }, () => {
  it("carries the run's frozen installation and model", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      const frozen = (t.body(runId) as { agent: { agent: string; model: string } }).agent;
      expect(frozen.agent).toBe("codex");
      const view = readControlGroup(t.h.store, "epoch-test", "g").runs.find((run) => run.runId === runId)!;
      expect(view.agent).toEqual({ installation: frozen.agent, model: frozen.model });
    } finally { await t.h.dispose(); }
  });
});
