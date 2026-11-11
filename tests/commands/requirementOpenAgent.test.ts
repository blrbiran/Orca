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

  // Tester follow-up E §7 (#246): with no defaultAgent and exactly one perAgent entry the preferences already name the
  // only installation a person configured; the hint names it instead of a placeholder. Any other shape keeps the
  // generic hint, and resolution itself is unchanged (no layer names an agent => agent-unselected).
  it("names the single perAgent installation when there is no defaultAgent (#246)", async () => {
    const prefs = (preferences: unknown) => ({ status: 200, body: { schema: "orca-agent-preferences-v1", operatorId: "operator-1", revision: 2, preferences } });
    const one = await world({}, { "POST requirements": unselected, "GET operator/agent-preferences": prefs({ perAgent: { "codex-main": { model: "gpt-x" } } }) });
    const named = await cli(["requirement", "open", "--idea", "x", "--group", "g-a"], one.dir);
    expect(named.code).toBe(2);
    expect(named.stderr).toContain("orca: no agent is selected: pass --agent codex-main (the one installation your agent preferences configure), or set a defaultAgent with orca agent set-preferences\n");
    const two = await world({}, { "POST requirements": unselected, "GET operator/agent-preferences": prefs({ perAgent: { "codex-main": {}, "claude-main": {} } }) });
    expect((await cli(["requirement", "open", "--idea", "x", "--group", "g-a"], two.dir)).stderr).toContain("pass --agent <installation> (see orca agent list)");
    const withDefault = await world({}, { "POST requirements": unselected, "GET operator/agent-preferences": prefs({ defaultAgent: "claude-main", perAgent: { "codex-main": {} } }) });
    expect((await cli(["requirement", "open", "--idea", "x", "--group", "g-a"], withDefault.dir)).stderr).toContain("pass --agent <installation> (see orca agent list)");
    const unreadable = await world({}, { "POST requirements": unselected, "GET operator/agent-preferences": { status: 500, body: { error: { code: "boom", message: "x", retryable: false } } } });
    expect((await cli(["requirement", "open", "--idea", "x", "--group", "g-a"], unreadable.dir)).stderr).toContain("pass --agent <installation> (see orca agent list)");
  });

  it("under --json stdout stays exactly one JSON line (the hint is for people)", async () => {
    const w = await world({}, { "POST requirements": unselected });
    const out = await cli(["requirement", "open", "--idea", "x", "--group", "g-a", "--json"], w.dir);
    expect(out.stdout.trim().split("\n")).toHaveLength(1);
    expect(out.json().body.error.code).toBe("agent-selection-rejected");
  });
});
