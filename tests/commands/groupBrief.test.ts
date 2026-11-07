// Issue #199: an agent polling a long run needs the group's state, completion, counts and blockers, not the ~100 KB
// full view. `group brief` composes that compact body from the same group GET; `group show` keeps its bytes.
import { describe, expect, it } from "vitest";
import { cli, fakePanel } from "./fixtures/fakePanel.js";

const VIEW = {
  schema: "orca-control-group-v1", epoch: "e", changeSeq: 11,
  summary: { groupId: "g-alpha", repoId: "repo-1", state: "running", commandRevision: 7, projectionSeq: 4, stopMode: null, stopState: null,
    claimBlocked: false, recoveryBlockerCount: 0, completion: { done: 2, total: 6 }, goal: "ship", branch: "orca/g-alpha",
    counts: { idle: 2, running: 1, waiting: 0, blocked: 1, done: 2 }, updatedAt: 5, archived: false, executionPending: true, overGrant: true },
  proposal: {}, allocations: [], ledger: {}, workItems: [], runs: [], checkpoints: [],
};

const routes = { "GET summary": { status: 200, body: { schema: "orca-control-summary-v1", epoch: "e", changeSeq: 11, resetRequired: false, groups: [{ groupId: "g-alpha", repoId: "repo-1", state: "running", commandRevision: 7 }] } }, "GET groups/g-alpha": { status: 200, body: VIEW } };

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
});
