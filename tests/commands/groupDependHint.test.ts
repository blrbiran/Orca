import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { world } from "./fixtures/world.js";

useFakePanels();

const started = { status: 409, body: { error: { code: "group-edge-dependent-started", message: "group-edge-dependent-started", retryable: false } } };

describe("group depend explains a started dependent (#186)", () => {
  it("names the immutable dependency boundary and a next step without changing the refusal", async () => {
    const w = await world({}, { "POST groups/g-alpha/dependencies/add": started });
    const out = await cli(["group", "depend", "g-alpha", "--on", "g-beta"], w.dir);
    expect(out.code).toBe(2);
    expect(out.stderr).toContain("orca: group-edge-dependent-started: group-edge-dependent-started\n");
    expect(out.stderr).toContain("the dependent group already started; dependencies must be set before it starts");
    expect(out.stderr).toContain("orca group show <group>");
    expect(w.posts()).toHaveLength(1);
  });

  it("keeps the structured refusal unchanged for --json", async () => {
    const w = await world({}, { "POST groups/g-alpha/dependencies/add": started });
    const out = await cli(["group", "depend", "g-alpha", "--on", "g-beta", "--json"], w.dir);
    expect(out.code).toBe(2);
    expect(out.json().body.error.code).toBe("group-edge-dependent-started");
    expect(out.stdout.trim().split("\n")).toHaveLength(1);
  });
});
