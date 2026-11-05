// Session 3cfc2e73, issue #144: group confirm names each agent slot that does not resolve and the command that sets it.
import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { READS, world } from "./fixtures/world.js";

useFakePanels();

describe("group confirm with unresolved agent slots (#144)", () => {
  it("names each slot that does not resolve, with its code and the proposal set-agent command that sets it", async () => {
    const preview = {
      ...(READS["groups/g-alpha/agent-preview"] as object), selectionsHash: null,
      slots: [
        { key: "reconcile", slot: "reconcile", taskId: null, outcome: { kind: "rejected", code: "agent-installation-missing" } },
        { key: "task:t1", slot: "worker", taskId: "t1", outcome: { kind: "rejected", code: "agent-unselected" } },
        { key: "task:t2", slot: "worker", taskId: "t2", outcome: { kind: "resolved", frozen: {} } },
      ],
    };
    const w = await world({}, { "GET groups/g-alpha/agent-preview": { status: 200, body: preview } });
    const out = await cli(["group", "confirm", "g-alpha"], w.dir);
    expect(out.code).toBe(1);
    expect(out.stderr).toContain("orca: agent-selection-unresolved: 2 agent slot(s) do not resolve:");
    expect(out.stderr).toContain("reconcile: rejected agent-installation-missing; set it with orca proposal set-agent g-alpha --slot reconcile --agent <installation>");
    expect(out.stderr).toContain("task:t1: rejected agent-unselected; set it with orca proposal set-agent g-alpha --task t1 --agent <installation>");
    expect(out.stderr).not.toContain("task:t2");
    expect(out.stderr).not.toContain("orca agent list");
    expect(w.posts()).toEqual([]);
  });

  it("an unavailable slot (ccloop could not be asked) says retry, not set-agent", async () => {
    const preview = { ...(READS["groups/g-alpha/agent-preview"] as object), selectionsHash: null,
      slots: [{ key: "task:t1", slot: "worker", taskId: "t1", outcome: { kind: "unavailable", code: "ccloop-timeout" } }] };
    const w = await world({}, { "GET groups/g-alpha/agent-preview": { status: 200, body: preview } });
    const out = await cli(["group", "confirm", "g-alpha"], w.dir);
    expect(out.stderr).toContain("task:t1: unavailable ccloop-timeout; ccloop could not be asked just now; retry");
    expect(out.stderr).not.toContain("set-agent");
  });
});
