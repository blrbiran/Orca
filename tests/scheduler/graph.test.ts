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

// Issue 88 (external tester, 2026-10-08; human ruling: fix it): every implicit edge used to point from the
// lexicographically smaller taskId to the larger one. taskId order says nothing about dependsOn, so with "t10" < "t2"
// an implicit t11 -> t2 closed a cycle with the explicit chain t2 -> ... -> t11 and buildGraph threw "a cycle slipped
// through" on a draft whose dependsOn graph was a valid DAG. The tester's split, exactly: fifteen tasks, one shared
// target path, the dependsOn edges the issue lists.
const ISSUE_88_DEPENDS_ON: Record<string, string[]> = {
  "t1-preflight": [],
  "t2-env-introspection": ["t1-preflight"],
  "t3-test-baseline-1": ["t2-env-introspection"],
  "t4-dim-cli": ["t2-env-introspection"],
  "t5-dim-sync": ["t2-env-introspection"],
  "t6-dim-err": ["t2-env-introspection"],
  "t7-dim-rcv": ["t2-env-introspection"],
  "t8-findings-consolidation": ["t4-dim-cli", "t5-dim-sync", "t6-dim-err", "t7-dim-rcv"],
  "t9-rev-section": ["t4-dim-cli", "t5-dim-sync", "t6-dim-err", "t7-dim-rcv"],
  "t10-doc-drift": ["t1-preflight"],
  "t11-dimension-tables": ["t8-findings-consolidation", "t9-rev-section", "t10-doc-drift"],
  "t12-unverified-index": ["t8-findings-consolidation"],
  "t13-impl-section": ["t3-test-baseline-1", "t8-findings-consolidation", "t10-doc-drift"],
  "t14-overview-appendix": ["t11-dimension-tables", "t12-unverified-index", "t13-impl-section"],
  "t15-final-verify": ["t14-overview-appendix"],
};

describe("implicit edges never close a cycle with dependsOn (issue 88)", () => {
  const ids = Object.keys(ISSUE_88_DEPENDS_ON);
  const shared = () => contracts(Object.fromEntries(ids.map((id) => [id, ["docs/gap-analysis-vs-orca-syncskill.md"]])));
  const issuePlan = () => plan(ids.map((id): [string, string[]] => [id, ISSUE_88_DEPENDS_ON[id]!]));

  it("schedules the tester's fifteen-task split, every edge pointing forward in the layer order", () => {
    // The direct regression: on the lexicographic rule this throws before any assertion below runs.
    const g = buildGraph(issuePlan(), shared());
    // Every pair intersects, so the layers are one total order: dependsOn's topological order, smallest taskId first
    // among the tasks free at the same time (t10 before t2, and t12, t13 before t9, as lexicographic order would also say).
    expect(g.layers).toEqual([
      "t1-preflight", "t10-doc-drift", "t2-env-introspection", "t3-test-baseline-1", "t4-dim-cli", "t5-dim-sync", "t6-dim-err", "t7-dim-rcv",
      "t8-findings-consolidation", "t12-unverified-index", "t13-impl-section", "t9-rev-section", "t11-dimension-tables", "t14-overview-appendix", "t15-final-verify",
    ].map((id) => [id]));
    // 105 intersecting pairs, 26 of them already ordered by a dependsOn edge: those carry no implicit edge.
    expect(g.implicit).toHaveLength(105 - 26);
    const position = new Map(g.layers.flat().map((id, index) => [id, index]));
    for (const edge of g.implicit) expect(position.get(edge.from)!).toBeLessThan(position.get(edge.to)!);
    // The edge the lexicographic rule pointed backwards: t11 is downstream of t2 through dependsOn, though "t11" < "t2".
    expect(g.implicit.find((e) => [e.from, e.to].sort().join() === ["t11-dimension-tables", "t2-env-introspection"].sort().join()))
      .toMatchObject({ from: "t2-env-introspection", to: "t11-dimension-tables" });
  });

  it("orders a pair dependsOn does not relate by the same total order, not pairwise, so implicit edges cannot form a cycle among themselves and dependsOn", () => {
    // c -> a explicitly; b relates to neither. Orienting each implicit pair on its own (lexicographic, or by dependsOn
    // reachability where there is one) gives a -> b and b -> c, which with c -> a is a cycle. One total order cannot:
    // b and c are free first and b is the smaller, then c, then a -- so b runs before a although "a" < "b".
    const g = buildGraph(plan([["a", ["c"]], ["b", []], ["c", []]]), contracts({ a: ["x.txt"], b: ["x.txt"], c: ["x.txt"] }));
    expect(g.layers).toEqual([["b"], ["c"], ["a"]]);
    expect(g.implicit.map((e) => [e.from, e.to])).toEqual([["b", "a"], ["b", "c"]]);
  });

  it("keeps taskId lexicographic order when there is no dependsOn edge at all", () => {
    const g = buildGraph(plan(["t2", "t10", "t1"]), contracts({ t1: ["x.txt"], t2: ["x.txt"], t10: ["x.txt"] }));
    expect(g.layers).toEqual([["t1"], ["t10"], ["t2"]]);
  });

  it("says in the decision what fixed the direction, which is no longer always the smaller taskId", () => {
    const g = buildGraph(issuePlan(), shared());
    const decisions = implicitEdgeDecisions(g, "orca-r-abcd1234");
    const backwards = decisions.find((d) => d.chose === "t2-env-introspection runs before t11-dimension-tables")!;
    expect(backwards).toBeDefined();
    expect(validateLine(JSON.stringify(backwards)).verdict).toBe("ok");
    // The old wording claimed "(t2-env-introspection < t11-dimension-tables)" in lexicographic order, which is false.
    expect(JSON.stringify(backwards)).not.toContain("t2-env-introspection < t11-dimension-tables");
    expect(backwards.because).toContain("topological order of the dependsOn edges");
    expect(backwards.alternatives[0]!.why_not).toContain("topological order of the dependsOn edges");
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
