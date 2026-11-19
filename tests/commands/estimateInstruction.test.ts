// Tester follow-up B T3 (#224): an estimator profile pinned to an older estimate instruction kept estimating with it and
// nothing said so. #381 (session 3ba26002): Orca now always uses its newest; what stays is the group's own history fact.
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

// Ruling (session 3ba26002, human #381): Orca always estimates with the newest instruction it holds, whatever the profile
// names, so `group estimate` and `group confirm` no longer warn about an older one -- not in human output, not in --json.
// (Was: both warned under instruction 1, named a new profile beside the old one, and --json carried it in body.warnings.)
// Fed a config that still names instruction 1 (as an older panel would send), so the criterion is not empty.
describe("no older-instruction warning on estimate and confirm (#381)", () => {
  it.each([["group", "estimate", "g-alpha"], ["group", "confirm", "g-alpha"]])("orca %s %s says nothing of an older instruction", async (...argv) => {
    const w = await world({}, configWith("1"));
    const out = await cli(argv, w.dir);
    expect(out.code, out.stderr).toBe(0);
    // mutation: restore instructionLines on either verb -> red
    expect(out.stdout).not.toMatch(/warning: estimator profile/);
    const json = await cli([...argv, "--json"], w.dir);
    expect(json.code, json.stderr).toBe(0);
    expect(json.json().body).not.toHaveProperty("warnings");
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
