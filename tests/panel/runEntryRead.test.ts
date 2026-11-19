// Tester #374 (c): `orca run show` refused a run of a group still clarifying (requirement-not-split), because it read the
// run's entry from the group view, which a clarifying group does not have (N1 DR25). GET runs/:runId reads one run's
// entry by its id: for a split group the entry the group view lists, for a clarifying one the requirement call's entry.
// The group view itself keeps refusing a clarifying group (that guard is not loosened).
import { createServer } from "node:http";
import express from "express";
import { describe, expect, it } from "vitest";
import { ControlError } from "../../src/control/errors.js";
import { registerControlReadRoutes } from "../../src/panel/controlApi.js";
import { readControlGroup, readRunEntry } from "../../src/panel/controlViews.js";
import { requirementHarness } from "../control/fixtures/requirementHarness.js";
import { ROUND_ONE } from "../control/fixtures/requirementOutputs.js";
import { driverHarness } from "../control/fixtures/driverHarness.js";

async function serve(store: Parameters<typeof registerControlReadRoutes>[1]["store"], fn: (get: (path: string) => Promise<{ status: number; body: any }>) => Promise<void>) {
  const app = express();
  registerControlReadRoutes(app, { store, epoch: "e", config: { readView: async () => ({}) } as never }, "web");
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as { port: number }).port;
    await fn(async (path) => { const res = await fetch(`http://127.0.0.1:${port}/api/control/${path}`); return { status: res.status, body: await res.json() }; });
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
}

describe("one run's entry, read by its id (#374 c)", () => {
  it("a clarifying group's requirement call: its entry (phase single-call, purpose clarify); the group view still refuses", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }] });
    try {
      await x.until(() => x.round(1).state === "awaiting-answers");
      const runId = x.runs()[0]!.runId;
      expect(x.group().status).toBe("clarifying");
      const entry = readRunEntry(x.store, "e", runId);
      // mutation: route a clarifying group through readControlGroup -> requirement-not-split, red
      expect(entry).toMatchObject({ schema: "orca-run-entry-v1", groupId: "r", run: { runId, taskId: null, phase: "single-call", purpose: "clarify" } });
      // Not loosened: the full group view of a clarifying group is still refused by name.
      expect(() => readControlGroup(x.store, "e", "r")).toThrow(expect.objectContaining({ code: "requirement-not-split" }));
      await serve(x.store, async (get) => {
        // mutation: drop the route -> 404 route-not-found, red
        expect(await get(`runs/${runId}`)).toMatchObject({ status: 200, body: { groupId: "r", run: { runId, phase: "single-call", purpose: "clarify" } } });
        expect(await get("runs/run-none")).toMatchObject({ status: 404, body: { error: { code: "run-not-found" } } });
      });
    } finally { await x.dispose(); }
  }, 30_000);

  it("a split group's run: the very entry the group view lists", async () => {
    const t = await driverHarness([{ taskId: "a" }]);
    try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "accepted");
      const view = readControlGroup(t.h.store, "e", "g");
      const listed = view.runs.find((run) => run.runId === runId);
      expect(listed).toBeDefined();
      // A split group's entry is the group view's, byte for byte (its validation included).
      expect(readRunEntry(t.h.store, "e", runId)).toEqual({ schema: "orca-run-entry-v1", groupId: "g", run: listed });
    } finally { await t.h.dispose(); }
  }, 30_000);

  it("an unknown run is run-not-found", async () => {
    const x = await requirementHarness({ answers: [] });
    try { expect(() => readRunEntry(x.store, "e", "run-none")).toThrow(new ControlError("run-not-found")); }
    finally { await x.dispose(); }
  });
});
