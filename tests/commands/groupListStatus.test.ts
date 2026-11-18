import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { world } from "./fixtures/world.js";

useFakePanels();

describe("orca group list shows what the state word hides (tester #166)", () => {
  it("names paused, over-grant, blocked and completion on the row", async () => {
    const w = await world({}, {
      "GET summary": { status: 200, body: { schema: "orca-control-summary-v1", epoch: "e", changeSeq: 9, resetRequired: true, groups: [
        { groupId: "g-alpha", repoId: "repo-1", state: "review", commandRevision: 9, goal: "ship",
          stopState: "paused", overGrant: true, completion: { done: 0, total: 1 }, counts: { running: 0, blocked: 1, done: 0, idle: 0, waiting: 0 } },
        { groupId: "g-beta", repoId: "repo-1", state: "ready", commandRevision: 2, goal: "other", counts: { running: 1, blocked: 0, done: 0, idle: 0, waiting: 0 } },
      ] } },
    });
    const out = await cli(["group", "list"], w.dir);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("g-alpha  repo-1  review · paused, over grant, blocked 1  done 0/1  rev 9  ship");
    expect(out.stdout).toContain("g-beta  repo-1  ready · running 1 task  rev 2  other");
  });

  // #361 review (M1): the panel derives `running` (storedState beside it) and counts a landed task waiting for its settle
  // as settling (groupStateDerived.test.ts); the row says how many tasks are under way and how many of them settle.
  it("a derived running group: running · N tasks (M settling)", async () => {
    const w = await world({}, {
      "GET summary": { status: 200, body: { schema: "orca-control-summary-v1", epoch: "e", changeSeq: 9, resetRequired: true, groups: [
        { groupId: "g-run", repoId: "repo-1", state: "running", storedState: "ready", commandRevision: 3, goal: "go", counts: { running: 2, blocked: 0, done: 0, idle: 1, waiting: 0, settling: 1 } },
        { groupId: "g-one", repoId: "repo-1", state: "running", storedState: "review", commandRevision: 4, goal: "one", counts: { running: 1, blocked: 0, done: 1, idle: 0, waiting: 0 } },
      ] } },
    });
    const out = await cli(["group", "list"], w.dir);
    expect(out.code, out.stderr).toBe(0);
    // mutation: drop the derived-running branch of groupList -> the bare state word "running", red here
    expect(out.stdout).toContain("g-run  repo-1  running · 3 tasks (1 settling)  rev 3  go");
    expect(out.stdout).toContain("g-one  repo-1  running · 1 task  rev 4  one");
  });
});
