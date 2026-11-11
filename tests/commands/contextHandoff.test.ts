// Tester follow-up F §1 (#195, human ruling 「要改」): no installed agent reports context usage, so the context hand-off
// threshold does nothing and confirm no longer requires one. `group confirm` and `proposal show` say so in their human
// output -- nobody is told to set it -- and their JSON is unchanged.
import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { world } from "./fixtures/world.js";

useFakePanels();

const NOT_ACTIVE = "context hand-off: not active (no installed agent reports context usage)";
const NONE_NEEDED = `${NOT_ACTIVE}; no threshold is set, and none is needed (--handoff-at-context-tokens is optional)`;

describe("the CLI says the context hand-off is not active (#195)", () => {
  it("proposal show says no threshold is needed, and its JSON is unchanged", async () => {
    const w = await world();
    const shown = await cli(["proposal", "show", "g-alpha"], w.dir);
    expect(shown.code).toBe(0);
    expect(shown.stdout).toContain(NONE_NEEDED);
    const json = await cli(["proposal", "show", "g-alpha", "--json"], w.dir);
    expect(JSON.parse(json.stdout)).toMatchObject({ status: 200, body: { schema: "orca-proposal-view-v1", proposal: { contextPolicy: { handoffAtContextTokens: null } } } });
    expect(json.stdout).not.toContain("context hand-off");
  });

  it("group confirm with no threshold sends null and says none is needed", async () => {
    const w = await world();
    const confirmed = await cli(["group", "confirm", "g-alpha"], w.dir);
    expect(confirmed.code).toBe(0);
    expect(confirmed.stdout).toContain(NONE_NEEDED);
    expect(w.posts().at(-1)!.payload).toMatchObject({ contextPolicy: { handoffAtContextTokens: null } });
  });

  it("group confirm with a threshold says it is recorded but nothing acts on it", async () => {
    const w = await world();
    const confirmed = await cli(["group", "confirm", "g-alpha", "--handoff-at-context-tokens", "90000"], w.dir);
    expect(confirmed.code).toBe(0);
    expect(confirmed.stdout).toContain(`${NOT_ACTIVE}; the threshold 90000 is recorded, but nothing acts on it`);
    expect(confirmed.stdout).not.toContain("none is needed");
  });

  it("the flag's help calls it optional and not active", async () => {
    const help = await cli(["group", "confirm", "--help"], (await world()).dir);
    expect(help.stdout).toContain("--handoff-at-context-tokens");
    expect(help.stdout).toContain("optional: hand off at this many context tokens (not active: no installed agent reports context usage)");
  });
});
