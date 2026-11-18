// #351 addendum (spec docs/superpowers/specs/2026-11-18-split-feedback-conflicts-design.md "Where it shows"): the
// split's own report that a draft does not meet the requirement as written is one line per entry in
// `orca requirement show`; a draft without the key prints nothing new.
import { describe, expect, it } from "vitest";
import { findCommand } from "../../src/commands/registry.js";

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
