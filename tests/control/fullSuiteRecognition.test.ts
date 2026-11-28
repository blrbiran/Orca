import { describe, expect, it } from "vitest";
import { deliveryProblems } from "../../src/control/requirementDelivery.js";
import { deliveryGraphProblems } from "../../src/control/requirementSplit.js";
import type { SplitOutput } from "../../src/control/requirementSchemas.js";
import { VALID_SPLIT } from "./fixtures/requirementOutputs.js";

const commandOutput = (check: string): SplitOutput => ({
  tasks: [{ ...VALID_SPLIT.tasks[0]!, taskId: "final", checks: [check], dependsOn: [] }],
  notes: "",
  deliveryGraph: { units: [{ unit: "T1", taskIds: ["final"], dependsOn: [] }], independent: [], finalVerification: "final" },
});

const DOC = "The implementation is complete when the full suite (npm test) passes.";
const GENERIC_DOC = "The implementation is complete when the full suite passes.";

describe("shared full-suite recognition (#580)", () => {
  it.each([
    "npm test",
    "npm run test",
    "npm run test:full",
    "npm run test:unit",
    "pnpm test",
    "yarn test",
    "node --test",
    "npx vitest run",
    "pytest",
    "pytest -q",
    "go test ./...",
    "cargo test",
    "make test",
    "npm test -- --reporter=dot",
    "npm test --silent",
    "npm test && true",
  ])("accepts the full-suite form %s consistently in the graph gate and requirement hint", (command) => {
    expect(deliveryGraphProblems(commandOutput(command))).toEqual([]);
    expect(deliveryProblems(GENERIC_DOC, { tasks: [{ ...VALID_SPLIT.tasks[0]!, taskId: "final", checks: [command], dependsOn: [] }], notes: "" })).toEqual([]);
  });

  it.each([
    "npm test -- --testNamePattern=one",
    "node --test test/a.test.js",
    "pytest -k one",
    "npm test || true",
    "npm test || npm test",
    "npm test; exit 0",
    "npm test | tee out.txt",
    "npm test && npm run lint",
    "bash -c \"npm test\"",
    "echo 'npm test'",
  ])("does not accept a narrowed, failure-masking, or indirect suite form: %s", (command) => {
    const reasons = deliveryGraphProblems(commandOutput(command));
    expect(reasons.some((reason) => reason.startsWith("delivery-graph-final-verification:final"))).toBe(true);
    expect(deliveryProblems(DOC, { tasks: [{ ...VALID_SPLIT.tasks[0]!, taskId: "final", checks: [command], dependsOn: [] }], notes: "" })).toMatchObject([{ problem: "missing-full-suite" }]);
  });

  it("recognizes only an exact same-suite retry for runtime identity comparison", async () => {
    const module = await import("../../src/control/fullSuiteRecognition.js");
    const parse = (module as unknown as { sameSuiteRetryBranches?: (command: string) => [string, string] | null }).sameSuiteRetryBranches;
    expect(typeof parse).toBe("function");
    if (parse === undefined) return;
    expect(parse("npm test || npm test")).toEqual(["npm test", "npm test"]);
    expect(parse(" npm test -- --reporter=dot || npm test -- --reporter=dot ")).toEqual([
      "npm test -- --reporter=dot", "npm test -- --reporter=dot",
    ]);
    expect(parse("npm test || npm run test:full")).toBeNull();
    expect(parse("npm test || true")).toBeNull();
    expect(parse("npx vitest run || npx vitest run")).toEqual(["npx vitest run", "npx vitest run"]);
  });

  it("requires an executable check, not a success-condition mention", () => {
    expect(deliveryProblems(DOC, { tasks: [{ ...VALID_SPLIT.tasks[0]!, taskId: "final", checks: ["node src/check.js"], successCondition: "npm test passes" }], notes: "" }))
      .toEqual([{ problem: "missing-full-suite", command: "npm test" }]);
  });
});
