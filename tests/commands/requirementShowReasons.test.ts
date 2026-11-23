// Tester #440: `requirement show` printed each draft with the generic 160-character `compact()`, so an invalid
// draft's `reasons` (which sit after `output` in the JSON) always fell outside the cut and the person could only
// learn why the draft came back through `--json`. Each draft with reasons now gets its own line, naming the reason
// code and the explanation the Web UI already shows (`explainSplitReason`).
import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { world } from "./fixtures/world.js";

useFakePanels();

const draftWith = (over: Record<string, unknown>) => ({
  schema: "orca-requirement-view-v1",
  summary: { groupId: "g-alpha", commandRevision: 5, requirement: { roundNo: 2, draftNo: 3 } },
  rounds: [{ roundNo: 1 }],
  drafts: [{
    draftNo: 3, state: "invalid", autoRetry: 1, waiting: null, feedback: null, draftHash: "h",
    reasons: ["check-docs-only-suite:policy-readme"], layers: null, implicitEdges: null, impliedPathsAdded: null,
    output: { tasks: [{ taskId: "policy-readme", title: "Write the policy README", targetPaths: ["README.md"] }] },
    ...over
  }]
});

describe("orca requirement show names why a draft came back (#440)", () => {
  it("prints the reason code and its explanation for an invalid draft", async () => {
    const w = await world({}, { "GET groups/g-alpha/requirement": { status: 200, body: draftWith({}) } });
    const out = await cli(["requirement", "show", "g-alpha"], w.dir);
    expect(out.code).toBe(0);
    const text = out.stdout;
    // mutation: drop the reasons lines -> this one is green while the two below are red
    expect(text).toContain("draft 3 invalid: check-docs-only-suite:policy-readme");
    // the explanation the Web UI shows comes from explainSplitReason, not the raw code alone
    expect(text).toMatch(/repository-wide test suite|required check runs/i);
    // and it says Orca re-drafts on its own, so a person is not left waiting
    expect(text).toMatch(/draft 4|re-?draft/i);
  });

  it("prints nothing extra for a draft with no reasons", async () => {
    const w = await world({}, { "GET groups/g-alpha/requirement": { status: 200, body: draftWith({ state: "accepted", autoRetry: 0, reasons: [] }) } });
    const out = await cli(["requirement", "show", "g-alpha"], w.dir);
    expect(out.code).toBe(0);
    expect(out.stdout).not.toContain("invalid:");
  });
});