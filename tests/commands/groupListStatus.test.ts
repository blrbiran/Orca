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
});
