// Tester follow-up K, item 2 (human ruling ①: 「还是觉得 ① 就好，这是人不设测试命令的结果，不应该替人决定必须跑pass」): the CLI
// runs nothing by default and changes no split rule; it says when an acceptance passed without a full suite (group show
// and group brief), and at `group confirm` names the command Orca detected with the command that adopts it. --json only
// gains keys.
import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { groupView, world } from "./fixtures/world.js";

useFakePanels();

const PASSED_WITHOUT = { tip: "a".repeat(40), result: "passed", commands: [{ command: "node check.js", exit: "0", ms: 1200 }], at: 1,
  warning: "full-suite-not-set", passedWithoutFullSuite: true, fullSuite: { command: null, suggestion: "npm test", exits: [], flaky: false } };
const LABEL = "acceptance: passed without a full suite on aaaaaaaaaaaa (1 command, 1 s)";
const WARNING = "warning: full-suite-not-set: this project has no full-suite command, so only the tasks' own checks ran";
const ADOPT = "  Orca detected npm test; it runs only once adopted: orca check adopt --as-person";

describe("an acceptance that passed without a full suite, in the CLI (item 2)", () => {
  it("group show labels it and names the adopt command", async () => {
    const view = groupView();
    const w = await world({}, { "GET groups/g-alpha": { status: 200, body: { ...view, summary: { ...view.summary, acceptance: PASSED_WITHOUT } } } });
    const shown = await cli(["group", "show", "g-alpha"], w.dir);
    expect(shown.code).toBe(0);
    expect(shown.stdout).toContain(LABEL);
    expect(shown.stdout).toContain(WARNING);
    expect(shown.stdout).toContain(ADOPT);
  });

  it("group brief says it too (an old record with no suggestion names no command)", async () => {
    const { fullSuite: _none, ...old } = PASSED_WITHOUT;
    const w = await world({}, { "GET groups/g-alpha/brief": { status: 200, body: { schema: "orca-group-brief-v1", groupId: "g-alpha", acceptance: old, warnings: ["full-suite-not-set"] } } });
    const brief = await cli(["group", "brief", "g-alpha"], w.dir);
    expect(brief.code).toBe(0);
    expect(brief.stdout).toContain(LABEL);
    expect(brief.stdout).toContain(WARNING);
    expect(brief.stdout).not.toContain("Orca detected");
  });

  it("group confirm names the detected command and how to adopt it; --json gains it under warnings", async () => {
    const routes = { "GET checks?repoId=repo-1": { status: 200, body: { schema: "orca-checks-v1", repoId: "repo-1", suggestedCommand: "npm test" } } };
    const w = await world({}, routes);
    const confirmed = await cli(["group", "confirm", "g-alpha"], w.dir);
    expect(confirmed.code).toBe(0);
    expect(confirmed.stdout).toContain("full suite: this project has no full-suite command, so group acceptance will run only the tasks' own checks");
    expect(confirmed.stdout).toContain(ADOPT);
    const json = await cli(["group", "confirm", "g-alpha", "--json"], (await world({}, routes)).dir);
    expect(JSON.parse(json.stdout).body.warnings).toEqual(expect.arrayContaining([expect.stringContaining("no full-suite command")]));
  });

  it("group confirm says nothing about it when Orca detected nothing, or the read is not there", async () => {
    const none = await world({}, { "GET checks?repoId=repo-1": { status: 200, body: { schema: "orca-checks-v1", repoId: "repo-1", suggestedCommand: null } } });
    expect((await cli(["group", "confirm", "g-alpha"], none.dir)).stdout).not.toContain("full suite:");
    const missing = await world();
    const confirmed = await cli(["group", "confirm", "g-alpha"], missing.dir);
    expect(confirmed.code).toBe(0);
    expect(confirmed.stdout).not.toContain("full suite:");
  });
});
