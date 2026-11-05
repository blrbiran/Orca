// Session 3cfc2e73, issue #143: `requirement open --agent`, and the hint on the estimator:agent-unselected refusal.
import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { world } from "./fixtures/world.js";

useFakePanels();

const unselected = { status: 422, body: { error: { code: "agent-selection-rejected", message: "estimator:agent-unselected", retryable: false } } };

describe("requirement open --agent (#143)", () => {
  // The Web's picker sends payload.agent = {agent}; on a machine with no defaultAgent the CLI had no way to.
  it("sends payload.agent = {agent: <installation>} with --agent, and no agent key without it", async () => {
    const w = await world();
    expect((await cli(["requirement", "open", "--idea", "x", "--group", "g-a", "--agent", "claude-main", "--json"], w.dir)).code).toBe(0);
    expect((await cli(["requirement", "open", "--idea", "x", "--group", "g-b", "--json"], w.dir)).code).toBe(0);
    const [withAgent, without] = w.posts();
    expect(withAgent!.payload).toEqual({ groupId: "g-a", repoId: "repo-1", idea: "x", agent: { agent: "claude-main" } });
    expect(without!.payload).toEqual({ groupId: "g-b", repoId: "repo-1", idea: "x" });
  });

  it("the estimator:agent-unselected refusal names the fix; another estimator refusal does not get that hint", async () => {
    const w = await world({}, { "POST requirements": unselected });
    const out = await cli(["requirement", "open", "--idea", "x", "--group", "g-a"], w.dir);
    expect(out.code).toBe(2);
    expect(out.stderr).toContain("orca: agent-selection-rejected: estimator:agent-unselected\n");
    expect(out.stderr).toContain("pass --agent <installation> (see orca agent list), or set a defaultAgent with orca agent set-preferences");
    const other = await world({}, { "POST requirements": { status: 422, body: { error: { code: "agent-selection-rejected", message: "estimator:agent-installation-missing", retryable: false } } } });
    const plain = await cli(["requirement", "open", "--idea", "x", "--group", "g-a"], other.dir);
    expect([plain.code, plain.stderr.includes("pass --agent")]).toEqual([2, false]);
  });

  it("under --json stdout stays exactly one JSON line (the hint is for people)", async () => {
    const w = await world({}, { "POST requirements": unselected });
    const out = await cli(["requirement", "open", "--idea", "x", "--group", "g-a", "--json"], w.dir);
    expect(out.stdout.trim().split("\n")).toHaveLength(1);
    expect(out.json().body.error.code).toBe("agent-selection-rejected");
  });
});
