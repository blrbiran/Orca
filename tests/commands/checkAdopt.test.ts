// Full suite spec 2026-11-12 §3 (#279): `orca check adopt` sets the project's full-suite (integration-check) command to the
// one the panel detected -- read fresh, never guessed by the CLI -- through the same verb and route as `check set
// integration-check --command`, so it needs a person token as typing the command does. Nothing to adopt is refused
// before anything is sent: an adopt must never clear or replace a command a person set.
import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { accept, world } from "./fixtures/world.js";

useFakePanels();

const READ = "GET checks?repoId=repo-1";

describe("orca check adopt (spec §3)", () => {
  it("sends set-check-settings with the panel's suggestion, at the repository revision", async () => {
    const w = await world({}, { [READ]: { status: 200, body: { schema: "orca-checks-v1", suggestedCommand: "npm test" } }, "POST repositories/repo-1/checks/settings": accept(() => 7) });
    const out = await cli(["check", "adopt", "--json"], w.dir);
    expect(out.code, out.stdout + out.stderr).toBe(0);
    expect(w.posts().map((p) => ({ path: p.path, expectedRevision: p.expectedRevision, payload: p.payload }))).toEqual([
      { path: "repositories/repo-1/checks/settings", expectedRevision: 7, payload: { kind: "integration-check", set: { command: "npm test" }, clear: [] } },
    ]);
  });

  it("with no suggestion (a command set, or none detected) is refused and sends nothing", async () => {
    const w = await world({}, { [READ]: { status: 200, body: { schema: "orca-checks-v1", suggestedCommand: null } } });
    const out = await cli(["check", "adopt", "--json"], w.dir);
    expect(out.code).not.toBe(0);
    expect(out.stdout + out.stderr).toContain("nothing to adopt");
    expect(w.posts()).toEqual([]);
  });

  it("says in its help that it needs a person token", async () => {
    const w = await world();
    expect((await cli(["check", "adopt", "--help"], w.dir)).stdout).toContain("person token");
  });
});
