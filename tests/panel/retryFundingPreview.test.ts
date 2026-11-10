import express from "express";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { withCommandContext } from "../../src/control/commandClient.js";
import { replenishStartWakes } from "../../src/control/executionDriver.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { registerControlReadRoutes, routedCommandContext } from "../../src/panel/controlApi.js";
import type { Principal } from "../../src/panel/permissions.js";
import { driverHarness } from "../control/fixtures/driverHarness.js";

/**
 * Tester follow-up B T2 (#202): the authored work allocation is lifetime, so a retry with a top-up is funded authored +
 * top-ups - what the lineage already used. The operator could not see that before acting: 540,097 used of 300,000 and a
 * 300,000 top-up gives a run of 59,903. The funding preview, asked about that retry, answers it -- the same number the
 * claim then funds -- and the per-attempt cost the lineage has shown. Asked nothing, its answer is what it was.
 */
describe("the funding preview of a retry with a top-up (#202)", { timeout: 120_000 }, () => {
  it("answers the fresh grant the next claim funds and the lineage's cost per attempt", async () => {
    const t = await driverHarness([{ taskId: "a", targetPaths: ["a"], tokenBudget: 300_000 }], {
      tokenPolicy: "optional-v1", behaviour: () => "failed", stopReason: () => "Error: check failed: node check.js", workTokens: () => 540_097,
    });
    const app = express(); app.use(express.json());
    registerControlReadRoutes(app, { store: t.h.store, epoch: "epoch", config: { readView: async () => ({}) } as never }, "web");
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      const get = async (query: string) => {
        const r = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/api/control/groups/g/funding-preview${query}`);
        return { status: r.status, body: await r.json() as Record<string, unknown> };
      };
      const asked = await get("?retry=a&tokens=300000");
      expect(asked.status).toBe(200);
      expect(asked.body.retry).toEqual({ taskId: "a", runId, authoredTokens: 600_000, lineageTokens: 540_097, lineageAttempts: 1, freshTokens: 59_903, perAttemptTokens: 540_097 });
      // Not asked: the #212 answer, unchanged (no retry key).
      const plain = await get("");
      expect([plain.status, Object.keys(plain.body).sort()]).toEqual([200, ["groupId", "rows", "schema"]]);
      expect((await get("?retry=a&tokens=-1")).status).toBe(400);
      // The preview is the claim's number: retry with that top-up as a person, and the new run is funded 59,903.
      const command = t.h.command("retry-task", { taskId: "a", runId, work: { tokens: 300_000 } } as never);
      const owner: Principal = { kind: "user", userId: "u-owner", name: "ana", roles: ["owner"] };
      const retried = withCommandContext(command.commandId, routedCommandContext("web", owner, { by: "ana", via: "web" }), () => t.service.retryTask(command));
      expect(retried).not.toHaveProperty("error");
      replenishStartWakes({ store: t.h.store, admissionGate: t.h.deps.admissionGate });
      const next = await deliverScheduledStart(t.dispatch, "g");
      if (next.kind !== "claimed") throw new Error(`claim refused: ${JSON.stringify(next)}`);
      expect(t.body(next.runId).grant.work.tokens).toBe(59_903);
    } finally { server.close(); await t.h.dispose(); }
  });
});
