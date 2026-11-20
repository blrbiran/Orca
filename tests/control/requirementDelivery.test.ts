import { describe, expect, it } from "vitest";
import { deliveryProblems } from "../../src/control/requirementDelivery.js";
import { VALID_SPLIT } from "./fixtures/requirementOutputs.js";

// Tester #385 (links-dogfood-20261120-1): the requirement asked for the full suite and the accepted draft had no task
// running it, so acceptance never proved the requirement's own AC. This is a warn-only hint (never refuses a draft).
const base = VALID_SPLIT.tasks[0]!;
const task = (taskId: string, checks: string[], successCondition = "done") =>
  ({ ...base, taskId, title: taskId, targetPaths: ["src/a.js"], successCondition, checks, dependsOn: [], traces: ["AC1"] });
const DOC = "The implementation is complete when the full suite (`npm test`) passes.";

describe("a requirement that asks for the full suite (#385)", () => {
  it("flags a draft in which no task runs it", () => {
    // mutation: return [] -> red
    expect(deliveryProblems(DOC, { tasks: [task("a", ["node src/check.js"])], notes: "" })).toEqual([{ problem: "missing-full-suite", command: "npm test" }]);
  });

  it("stays quiet when a task's checks run it, or its success condition names it", () => {
    // mutation: check only checks (drop successCondition) -> red
    expect(deliveryProblems(DOC, { tasks: [task("a", ["node src/check.js"]), task("final", ["npm test"])], notes: "" })).toEqual([]);
    expect(deliveryProblems(DOC, { tasks: [task("a", ["node src/check.js"], "npm test passes")], notes: "" })).toEqual([]);
  });

  it("says nothing when the requirement asks for no full suite, or the draft is multi-directory", () => {
    // mutation: flag every draft -> red
    expect(deliveryProblems("Implement the feature.", { tasks: [task("a", ["node src/check.js"])], notes: "" })).toEqual([]);
    const multi = { primary: "m", tasks: [{ ...task("a", ["node src/check.js"]), writes: [{ dir: "m", targetPaths: ["src/a.js"] }] }], notes: "" };
    expect(deliveryProblems(DOC, multi as never)).toEqual([]);
  });
});