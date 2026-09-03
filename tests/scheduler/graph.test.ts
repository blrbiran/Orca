import { describe, expect, it } from "vitest";
import { buildGraph, detectCycle, implicitEdgeDecisions } from "../../src/scheduler/graph.js";
import type { PlanFile, PlanTask } from "../../src/scheduler/planFile.js";
import { validateLine } from "../../src/ledger/validateLine.js";

// Test-only builders. buildGraph takes a full PlanFile, but these tests only
// vary `tasks`; every other field is the same well-formed shape loadPlan
// would have produced (spec 2.3 already covers rejecting a malformed one).
function plan(tasks: Array<string | [string, string[]]>): PlanFile {
  return {
    targetRepo: "/abs/repo",
    ccloopBin: "/abs/cli.js",
    runsDir: "/abs/runs",
    workBranch: "orca/w/x",
    policy: "local-merge",
    ledgerMode: "in-repo",
    tasks: tasks.map((entry): PlanTask =>
      typeof entry === "string"
        ? { taskId: entry, contract: `/abs/${entry}.json`, dependsOn: [] }
        : { taskId: entry[0], contract: `/abs/${entry[0]}.json`, dependsOn: entry[1] },
    ),
  };
}

// contracts() keys by taskId, not by the contract file path — buildGraph's
// second argument is the already-loaded contract for each task, not a path
// to go read one (this layer is pure, zero I/O).
function contracts(byTask: Record<string, string[]>): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [taskId, targetPaths] of Object.entries(byTask)) {
    out.set(taskId, { context: { targetPaths }, safetyPolicy: { allowlistPaths: [] } });
  }
  return out;
}

describe("buildGraph (spec 2.4)", () => {
  it("puts two tasks with disjoint write sets in the same layer", () => {
    const g = buildGraph(plan(["T1", "T2"]), contracts({ T1: ["a.txt"], T2: ["b.txt"] }));
    expect(g.layers).toEqual([["T1", "T2"]]);
  });

  it("serialises two tasks whose write sets intersect", () => {
    const g = buildGraph(plan(["T1", "T2"]), contracts({ T1: ["src/**"], T2: ["src/a.ts"] }));
    expect(g.layers.length).toBe(2);
    expect(g.implicit.length).toBe(1);
  });

  it("honours an explicit dependsOn even when write sets are disjoint", () => {
    const g = buildGraph(plan([["T1", []], ["T2", ["T1"]]]), contracts({ T1: ["a.txt"], T2: ["b.txt"] }));
    expect(g.layers).toEqual([["T1"], ["T2"]]);
  });

  it("records every implicit edge as a scheduling decision with alternatives", () => {
    // An implicit edge has no natural direction — four build systems hit this
    // and all four hand it to a human. The scheduler is not allowed to pick
    // silently: the choice goes in the ledger with the other direction as its
    // alternative, so it can be overturned.
    const g = buildGraph(plan(["T1", "T2"]), contracts({ T1: ["src/**"], T2: ["src/a.ts"] }));
    const decisions = implicitEdgeDecisions(g, "orca-T1-abcd1234");
    expect(decisions.length).toBe(1);
    expect(decisions[0].kind).toBe("scheduling");
    expect(decisions[0].alternatives.length).toBeGreaterThanOrEqual(1);
    // The decision must survive the real validator, not a hand-made shape.
    expect(validateLine(JSON.stringify(decisions[0])).verdict).toBe("ok");
  });

  it("a task claiming ** shares a layer with no one, while tasks merely downstream of it may still run together", () => {
    // Fix round 1, finding 2 (controller ruling): the old version of this
    // criterion asserted the whole graph collapses to one task per layer,
    // which is not actually true — it over-read a warning in spec §9.1 as
    // the layering algorithm itself, when §2.4 (the definitional section)
    // says layers are parallel. What IS true: T1's write set normalises to
    // the repository root, so it conflicts with every other task and can
    // never reach zero in-degree in the same step as any of them — it is
    // always alone. T2 and T3, though, are each only downstream of T1, not
    // of each other, and their own write sets are disjoint — so once T1 is
    // done, they still batch into the same layer. A regression back to
    // per-component full serialisation would put T2 and T3 in separate
    // layers too, which the second assertion below catches.
    const g = buildGraph(plan(["T1", "T2", "T3"]), contracts({ T1: ["**"], T2: ["a.txt"], T3: ["b.txt"] }));
    expect(g.implicit.length).toBe(2);
    expect(g.layers[0]).toEqual(["T1"]);
    expect(g.layers[1]).toEqual(["T2", "T3"]);
  });

  it("batches independent tasks within a connected component (diamond: A→B, A→C, B→D, C→D)", () => {
    // The shape a per-component "one task per layer" bug gets wrong: B and C
    // are both only downstream of A, never of each other, and their write
    // sets are disjoint — so they belong in the same layer, not two.
    const g = buildGraph(
      plan([
        ["A", []],
        ["B", ["A"]],
        ["C", ["A"]],
        ["D", ["B", "C"]],
      ]),
      contracts({ A: ["a.txt"], B: ["b.txt"], C: ["c.txt"], D: ["d.txt"] }),
    );
    expect(g.layers).toEqual([["A"], ["B", "C"], ["D"]]);
  });
});

describe("detectCycle (ruling R2 — shared with planFile's loadPlan)", () => {
  it("says false for an acyclic dependsOn graph", () => {
    const tasks: PlanTask[] = [
      { taskId: "T1", contract: "/abs/t1.json", dependsOn: [] },
      { taskId: "T2", contract: "/abs/t2.json", dependsOn: ["T1"] },
    ];
    expect(detectCycle(tasks)).toBe(false);
  });

  it("says true for a direct two-node cycle", () => {
    const tasks: PlanTask[] = [
      { taskId: "T1", contract: "/abs/t1.json", dependsOn: ["T2"] },
      { taskId: "T2", contract: "/abs/t2.json", dependsOn: ["T1"] },
    ];
    expect(detectCycle(tasks)).toBe(true);
  });
});
