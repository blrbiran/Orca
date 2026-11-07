// Issue #199: an agent polling a long run needs the group's state, completion, counts and blockers, not the ~100 KB
// full view. `group brief` reads the summary route itself; `group show` keeps its bytes.
import { createServer } from "node:http";
import express from "express";
import { describe, expect, it } from "vitest";
import { registerControlReadRoutes } from "../../src/panel/controlApi.js";
import { requirementHarness } from "../control/fixtures/requirementHarness.js";
import { ROUND_ONE } from "../control/fixtures/requirementOutputs.js";
import { cli, fakePanel } from "./fixtures/fakePanel.js";

const VIEW = {
  schema: "orca-control-group-v1", epoch: "e", changeSeq: 11,
  summary: { groupId: "g-alpha", repoId: "repo-1", state: "running", commandRevision: 7, projectionSeq: 4, stopMode: null, stopState: null,
    claimBlocked: false, recoveryBlockerCount: 0, completion: { done: 2, total: 6 }, goal: "ship", branch: "orca/g-alpha",
    counts: { idle: 2, running: 1, waiting: 0, blocked: 1, done: 2 }, updatedAt: 5, archived: false, executionPending: true, overGrant: true },
  proposal: {}, allocations: [], ledger: {}, workItems: [], runs: [], checkpoints: [],
};

const routes = { "GET summary": { status: 200, body: { schema: "orca-control-summary-v1", epoch: "e", changeSeq: 11, resetRequired: false, groups: [{ groupId: "g-alpha", repoId: "repo-1", state: "running", commandRevision: 7 }] } }, "GET groups/g-alpha/brief": { status: 200, body: { schema: "orca-group-brief-v1", ...VIEW.summary } }, "GET groups/g-alpha": { status: 200, body: VIEW } };

describe("group brief (issue 199)", () => {
  it("returns only the group summary fields, not the full view", async () => {
    const p = await fakePanel(routes);
    const out = await cli(["group", "brief", "g-alpha", "--json"], p.dir);
    expect(out.code, out.stderr).toBe(0);
    const body = out.json().body as Record<string, any>;
    expect(body.schema).toBe("orca-group-brief-v1");
    expect(body).toMatchObject({ groupId: "g-alpha", state: "running", completion: { done: 2, total: 6 }, counts: { blocked: 1 }, overGrant: true });
    expect(body).not.toHaveProperty("proposal");
    expect(body).not.toHaveProperty("workItems");
    expect(body).not.toHaveProperty("runs");
  });

  it("keeps group show's full body unchanged", async () => {
    const p = await fakePanel(routes);
    const out = await cli(["group", "show", "g-alpha", "--json"], p.dir);
    expect(out.code, out.stderr).toBe(0);
    expect(out.json().body).toEqual(VIEW);
  });

  it("answers a clarifying group's brief while its full view is refused", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }] });
    const app = express();
    app.use(express.json());
    registerControlReadRoutes(app, { store: x.store, epoch: "epoch", config: { readView: async () => ({}) } as never }, "web");
    const server = createServer(app);
    try {
      await x.until(() => x.round(1).state === "awaiting-answers");
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("address");
      const get = async (path: string) => {
        const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
        return { status: response.status, body: await response.json() as Record<string, unknown> };
      };
      expect(await get("/api/control/groups/r/brief")).toMatchObject({ status: 200, body: { schema: "orca-group-brief-v1", groupId: "r", state: "clarifying", requirement: { roundNo: 1 } } });
      expect(await get("/api/control/groups/r")).toMatchObject({ status: 422, body: { error: { code: "requirement-not-split" } } });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await x.dispose();
    }
  });
});
