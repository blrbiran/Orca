// Tester #368 (b): `orca task retry --model <model>` sends the model with the retry (with or without --agent), and a
// model the installation's catalog does not list is answered with the command that lists the ones it does.
import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { groupView, world } from "./fixtures/world.js";

useFakePanels();

const posted = (w: Awaited<ReturnType<typeof world>>) =>
  w.requests.filter((r) => r.method === "POST" && r.path === "groups/g-alpha/retry-task").map((r) => JSON.parse(r.text).payload);

describe("orca task retry --model (#368 b)", () => {
  it("sends the model, alone or beside --agent", async () => {
    const w = await world();
    // mutation: drop --model from the payload -> no model sent, red
    expect((await cli(["task", "retry", "g-alpha", "t1", "--model", "gpt-new"], w.dir)).code).toBe(0);
    expect((await cli(["task", "retry", "g-alpha", "t1", "--agent", "claude", "--model", "claude-big"], w.dir)).code).toBe(0);
    expect(posted(w)).toEqual([
      { taskId: "t1", runId: "run-1", model: "gpt-new" },
      { taskId: "t1", runId: "run-1", agent: "claude", model: "claude-big" },
    ]);
  });

  it("--agent auto with --model is refused before anything is sent, naming which flag to drop (review M2)", async () => {
    const w = await world();
    const out = await cli(["task", "retry", "g-alpha", "t1", "--agent", "auto", "--model", "gpt-new"], w.dir);
    // mutation: drop the CLI check -> sent, exit 0 against this fake panel, red
    expect(out.code).toBe(1);
    expect(out.stderr).toContain("control-cli-argument-invalid");
    expect(out.stderr).toContain("drop --model to hand the choice back, or drop --agent auto");
    expect(posted(w)).toEqual([]);
  });

  it("a model the catalog does not list: the next step lists the installation's models", async () => {
    const view = groupView();
    const refused = { status: 422, body: { error: { code: "agent-selection-invalid", message: "agent-selection-invalid:gpt-gone (listed: gpt-5)", commandRevision: 5, evidenceIds: [], retryable: false } } };
    const withAgent = { ...view, workItems: view.workItems.map((item) => ({ ...item, agent: { agent: "codex", model: "gpt-old", contextWindow: "agent-default" } })) };
    const w = await world({}, { "GET groups/g-alpha": { status: 200, body: withAgent }, "POST groups/g-alpha/retry-task": refused });
    const out = await cli(["task", "retry", "g-alpha", "t1", "--model", "gpt-gone", "--json"], w.dir);
    expect(out.code).toBe(2);
    // mutation: no next for agent-selection-invalid -> undefined, red
    expect(out.json().body.next).toEqual(["orca agent models codex"]);
    const named = await cli(["task", "retry", "g-alpha", "t1", "--agent", "claude", "--model", "gpt-gone", "--json"], w.dir);
    expect(named.json().body.next).toEqual(["orca agent models claude"]);
  });
});
