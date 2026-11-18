// #351 addendum (spec docs/superpowers/specs/2026-11-18-split-feedback-conflicts-design.md "Where it shows"): the
// split's own report that a draft does not meet the requirement as written is one line per entry in
// `orca requirement show`; a draft without the key prints nothing new.
import { describe, expect, it } from "vitest";
import { findCommand } from "../../src/commands/registry.js";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { world } from "./fixtures/world.js";

useFakePanels();

const CONFLICTS = [
  { criterion: "AC4", feedback: "make sla-breach depend on sla-clock", why: "sla-breach and sla-clock no longer run concurrently in Layer 2" },
  { criterion: "\"a cli/ module\"", why: "no task writes cli/" },
];

describe("orca requirement show lists the split's requirement conflicts", () => {
  it("prints one line per entry, with the feedback quote only when the entry has one, and none for a draft without the key", () => {
    const found = findCommand(["requirement", "show"]);
    if (!("def" in found)) throw new Error("no requirement show row");
    const body = { schema: "orca-requirement-view-v1", drafts: [
      { draftNo: 2, layers: null, output: { tasks: [], notes: "", requirementConflicts: CONFLICTS } },
      { draftNo: 1, layers: null, output: { tasks: [], notes: "" } },
    ] };
    // mutation: drop the line builder -> no such line, red
    const lines = found.def.format(body).split("\n").filter((line) => line.includes("requirement-conflict:"));
    expect(lines).toEqual([
      "draft 2 requirement-conflict: AC4 -- sla-breach and sla-clock no longer run concurrently in Layer 2 (feedback: \"make sla-breach depend on sla-clock\")",
      "draft 2 requirement-conflict: \"a cli/ module\" -- no task writes cli/",
    ]);
  });
});

// Spec D2: accepting a draft with conflicts is refused locally unless --despite-conflicts says the person means it, as
// consensus refuses an open round without --unanswered; the payload does not change either way.
describe("orca requirement accept on a draft with requirement conflicts", () => {
  const view = (output: Record<string, unknown>) => ({
    "GET groups/g-alpha/requirement": { status: 200, body: {
      schema: "orca-requirement-view-v1", summary: { groupId: "g-alpha", commandRevision: 5, requirement: { roundNo: 1, draftNo: 2 } },
      rounds: [{ roundNo: 1, state: "answered" }],
      drafts: [{ draftNo: 1, draftHash: "a".repeat(64), output: { tasks: [], notes: "" } }, { draftNo: 2, draftHash: "b".repeat(64), output: { tasks: [], notes: "", ...output } }],
    } },
  });

  it("refuses without --despite-conflicts, naming the draft and the count, and sends nothing", async () => {
    const w = await world({}, view({ requirementConflicts: CONFLICTS }));
    const out = await cli(["requirement", "accept", "g-alpha", "--json"], w.dir);
    // mutation: invert the flag test -> exit 0 and one POST, red
    expect(out.code).toBe(1);
    expect(out.json().body.error).toMatchObject({ code: "requirement-draft-conflicts",
      message: "draft 2 reports 2 conflict(s) with the requirement as written (orca requirement show g-alpha); send feedback, or pass --despite-conflicts to accept it as it stands" });
    expect(w.posts()).toEqual([]);
  });

  it("with --despite-conflicts it sends exactly {draftNo, draftHash}", async () => {
    const w = await world({}, view({ requirementConflicts: CONFLICTS }));
    const out = await cli(["requirement", "accept", "g-alpha", "--despite-conflicts", "--json"], w.dir);
    expect(out.code, out.stdout + out.stderr).toBe(0);
    expect(w.posts().map((post) => [post.path, post.payload])).toEqual([["groups/g-alpha/requirement/accept", { draftNo: 2, draftHash: "b".repeat(64) }]]);
  });

  it("a draft without conflicts is accepted with no flag", async () => {
    const w = await world({}, view({}));
    const out = await cli(["requirement", "accept", "g-alpha", "--json"], w.dir);
    // mutation: always refuse -> red
    expect(out.code, out.stdout + out.stderr).toBe(0);
    expect(w.posts().map((post) => [post.path, post.payload])).toEqual([["groups/g-alpha/requirement/accept", { draftNo: 2, draftHash: "b".repeat(64) }]]);
  });
});
