// Tester #321 part C: the brief an orchestrating agent polls names a task costing a multiple of its group, from the
// stored runs, and says nothing when none does (the key is absent, as the brief's other notes are).
import { createServer } from "node:http";
import express from "express";
import { describe, expect, it } from "vitest";
import { registerControlReadRoutes } from "../../src/panel/controlApi.js";
import { profileSnapshot, webFixture } from "../control/fixtures/web.js";

const MIN = 60_000;
const body = (taskId: string, tokens: number) => JSON.stringify({
  // Landed with known usage: a finished peer, which is what a median is taken over (review ruling 2026-11-18).
  taskId, phase: "work", state: "landed", failureCode: null, startedAt: 1, endedAt: 2, unknown: { work: false, handoff: false },
  cumulative: { work: { tokens, activeMs: 5 * MIN, attempts: 1, sessions: 1 }, handoff: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 } },
});

async function brief(xTokens: number): Promise<Record<string, unknown>> {
  const h = await webFixture(profileSnapshot(), ["a", "b", "c", "x"].map((taskId) => ({ taskId })));
  const server = createServer((() => { const app = express(); app.use(express.json());
    registerControlReadRoutes(app, { store: h.store, epoch: "epoch", config: { readView: async () => ({}) } as never }, "web"); return app; })());
  try {
    for (const [taskId, tokens] of [["a", 1_000_000], ["b", 1_000_000], ["c", 1_000_000], ["x", xTokens]] as const)
      h.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES (?,'g',?,1,0,?)").run(`run-${taskId}`, taskId, body(taskId, tokens));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("address");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/control/groups/g/brief`);
    expect(response.status).toBe(200);
    return await response.json() as Record<string, unknown>;
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); await h.dispose(); }
}

describe("group brief's costOutliers (#321 C)", () => {
  it("names the task at 3x the median tokens, and is absent below it", async () => {
    // mutation: drop `...(costOutliers === null ? {} : { costOutliers })` from the brief route -> red
    expect((await brief(3_000_000)).costOutliers).toMatchObject([{ taskId: "x", runs: 1, tokens: 3_000_000, comparable: 3, medianTokens: 1_000_000, reasons: ["tokens-multiple"] }]);
    expect(await brief(2_000_000)).not.toHaveProperty("costOutliers");
  });
});
