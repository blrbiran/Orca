// Tester #381: `group confirm` warned once that the group's estimator profile used an older estimate instruction; nothing
// kept it. The brief and the full group view now carry the fact from the group's own newest estimate request (the
// instruction its estimates were made with): `estimatorInstruction: { used, newest }`, absent under the newest.
import { createServer } from "node:http";
import express from "express";
import { describe, expect, it } from "vitest";
import { NEWEST_ESTIMATE_INSTRUCTION } from "../../src/control/estimateInstructionAge.js";
import { registerControlReadRoutes } from "../../src/panel/controlApi.js";
import { profileSnapshot, webFixture } from "../control/fixtures/web.js";

async function reads(instructionVersion: string): Promise<{ brief: Record<string, unknown>; show: Record<string, unknown> }> {
  const snapshot = profileSnapshot();
  snapshot.profile.estimatorPreflight!.instructionVersion = instructionVersion;
  const h = await webFixture(snapshot);
  const server = createServer((() => { const app = express(); app.use(express.json());
    registerControlReadRoutes(app, { store: h.store, epoch: "epoch", config: { readView: async () => ({}) } as never }, "web"); return app; })());
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("address");
    const get = async (path: string) => { const response = await fetch(`http://127.0.0.1:${address.port}/api/control/groups/g${path}`); expect(response.status).toBe(200); return await response.json() as Record<string, unknown>; };
    return { brief: await get("/brief"), show: await get("") };
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); await h.dispose(); }
}

describe("the group's estimate instruction stays on its brief and view (#381)", () => {
  it("names instruction 1 against the newest on both reads, and nothing under the newest", async () => {
    const old = await reads("1");
    // mutation: drop the key from the brief route -> red
    expect(old.brief.estimatorInstruction).toEqual({ used: 1, newest: NEWEST_ESTIMATE_INSTRUCTION });
    // mutation: drop the key from the group view route -> red
    expect(old.show.estimatorInstruction).toEqual({ used: 1, newest: NEWEST_ESTIMATE_INSTRUCTION });
    // mutation: report every instruction (not only an older one) -> present here, red
    const newest = await reads(String(NEWEST_ESTIMATE_INSTRUCTION));
    expect(newest.brief).not.toHaveProperty("estimatorInstruction");
    expect(newest.show).not.toHaveProperty("estimatorInstruction");
  });
});
