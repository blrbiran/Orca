// Tester follow-up B T3 (#224): an estimator profile pinned to an older estimate instruction kept estimating with it and
// nothing said so. `group estimate` and `group confirm` warn in their human output; --json is unchanged.
import { describe, expect, it } from "vitest";
import { ESTIMATE_INSTRUCTIONS } from "../../src/control/estimatePrompt.js";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { READS, groupView, world } from "./fixtures/world.js";

useFakePanels();

const NEWEST = String(Math.max(...Object.keys(ESTIMATE_INSTRUCTIONS).map(Number)));
const configWith = (version: string | null | undefined) => {
  const config = READS.config as { profiles: Array<Record<string, unknown>> };
  return { "GET config": { status: 200, body: { ...config, profiles: config.profiles.map((p) => (p.profileId === "est-1" && version !== undefined ? { ...p, estimatorInstructionVersion: version } : p)) } } };
};
const WARNING = new RegExp(`warning: estimator profile est-1 uses estimate instruction 1; the newest is ${NEWEST}`);

describe("an older estimate instruction is named (#224)", () => {
  it.each([["group", "estimate", "g-alpha"], ["group", "confirm", "g-alpha"]])("orca %s %s warns under instruction 1", async (...argv) => {
    const w = await world({}, configWith("1"));
    const out = await cli(argv, w.dir);
    expect(out.code, out.stderr).toBe(0);
    // Mutation "no warning" -> red.
    expect(out.stdout).toMatch(WARNING);
    // Ruling (2026-11-19 #379-381 review): I3 -- the warning advised editing the profile's instructionVersion in place, which
    // changes its hash so every group bound to it is refused profile-changed; it now names a new profile beside the old one.
    // mutation: restore the in-place advice -> red
    expect(out.stdout).toContain(`load a copy with a new profileId and instructionVersion "${NEWEST}" beside it (--profile <old> --profile <new> --estimator-profile <new id>); never edit this profile in place`);
    expect(out.stdout).not.toContain("update the profile's estimatorPreflight.instructionVersion");
  });

  it.each([["newest", NEWEST], ["no preflight", null], ["an older panel", undefined]] as const)("says nothing under %s", async (_label, version) => {
    const w = await world({}, configWith(version));
    for (const argv of [["group", "estimate", "g-alpha"], ["group", "confirm", "g-alpha"]]) {
      const out = await cli(argv, w.dir);
      expect(out.code, out.stderr).toBe(0);
      expect(out.stdout).not.toMatch(/warning: estimator profile/);
    }
  });

  // Ruling (2026-11-12, tester follow-up F): #173 asks for the warning in --json too, so "--json carries no warning" is
  // replaced: the answer's body gains `warnings` (only-add) under an older instruction, and stays as answered otherwise.
  it.each([["group", "estimate", "g-alpha"], ["group", "confirm", "g-alpha"]])("orca %s %s --json carries the warning in body.warnings (#173)", async (...argv) => {
    const w = await world({}, configWith("1"));
    const out = await cli([...argv, "--json"], w.dir);
    expect(out.code, out.stderr).toBe(0);
    const body = out.json().body as { warnings?: string[] };
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings![0]).toMatch(WARNING);
    expect(body.warnings![0]).toContain("never edit this profile in place");
  });

  it("--json under the newest instruction has no warnings field", async () => {
    const w = await world({}, configWith(NEWEST));
    for (const argv of [["group", "estimate", "g-alpha"], ["group", "confirm", "g-alpha"]]) {
      const out = await cli([...argv, "--json"], w.dir);
      expect(out.code, out.stderr).toBe(0);
      expect(out.json().body).not.toHaveProperty("warnings");
    }
  });
});

// Tester #381: the warning confirm printed once is kept -- group brief and group show print it from the read's own
// `estimatorInstruction` fact (the group's newest estimate request), and say nothing without it.
describe("group brief and group show keep the older-instruction warning (#381)", () => {
  const BRIEF = { schema: "orca-group-brief-v1", groupId: "g-alpha", state: "draft" };
  // Ruling (2026-11-19 #379-381 review): M6 -- the fact is the group's newest estimate request's instruction, so the line says
  // so. (Was: "this group's estimates used estimate instruction 1; the newest is N".)
  const LINE = `warning: this group's newest estimate request used estimate instruction 1 (newest is ${NEWEST})`;
  it("brief prints one line from the fact, and none without it", async () => {
    const w = await world({}, { "GET groups/g-alpha/brief": { status: 200, body: { ...BRIEF, estimatorInstruction: { used: 1, newest: Number(NEWEST) } } } });
    const out = await cli(["group", "brief", "g-alpha"], w.dir);
    expect(out.code, out.stderr).toBe(0);
    // mutation: drop the line from the brief format -> red
    expect(out.stdout.split("\n").filter((line) => line.startsWith("warning: this group's newest estimate request"))).toEqual([expect.stringContaining(LINE)]);
    const none = await world({}, { "GET groups/g-alpha/brief": { status: 200, body: BRIEF } });
    expect((await cli(["group", "brief", "g-alpha"], none.dir)).stdout).not.toContain("warning: this group's newest estimate request");
  });

  it("show prints the same line", async () => {
    const w = await world({}, { "GET groups/g-alpha": { status: 200, body: { ...groupView(), estimatorInstruction: { used: 1, newest: Number(NEWEST) } } } });
    const out = await cli(["group", "show", "g-alpha"], w.dir);
    expect(out.code, out.stderr).toBe(0);
    // mutation: drop the line from formatWithUnestimated -> red
    expect(out.stdout).toContain(LINE);
    expect((await cli(["group", "show", "g-alpha"], (await world()).dir)).stdout).not.toContain("warning: this group's newest estimate request");
  });
});
