import { describe, expect, it } from "vitest";
import {
  PLAN_LEVEL_CHECKS,
  RUNTIME_CHECKS,
  emptyRequiredChecksPairs,
  renderPlanReport,
  type PlanGraphExtras,
} from "../../src/scheduler/planReport.js";
import type { PlanFile, PlanRejection } from "../../src/scheduler/planFile.js";
import { normalizeClaim } from "../../src/scheduler/writeSet.js";
import type { TaskGraph } from "../../src/scheduler/graph.js";

// Shared plan fixture: three tasks so gWithStarStar (T1 root, T2, T3
// downstream) and the two-task fixtures can all reuse the same PlanFile
// without renderPlanReport crashing on a taskId it can't find a write set
// for (it just prints "(none declared)" for one it doesn't need).
const p: PlanFile = {
  targetRepo: "/abs/repo",
  ccloopBin: "/abs/ccloop/cli.js",
  runsDir: "/abs/runs",
  workBranch: "orca/w-fixture",
  policy: "local-merge",
  ledgerMode: "in-repo",
  tasks: [
    { taskId: "T1", contract: "/abs/runs/t1.json", dependsOn: [] },
    { taskId: "T2", contract: "/abs/runs/t2.json", dependsOn: [] },
    { taskId: "T3", contract: "/abs/runs/t3.json", dependsOn: [] },
  ],
};

const pf: { rejections: PlanRejection[] } = { rejections: [] };

function graph(overrides: Partial<TaskGraph & PlanGraphExtras>): TaskGraph & PlanGraphExtras {
  return {
    layers: [],
    explicit: [],
    implicit: [],
    writeSets: new Map(),
    ...overrides,
  };
}

// Two disjoint tasks, no conflicts at all — the plain "nothing interesting
// happened" graph reused by the tests that don't care about conflicts.
const g = graph({
  layers: [["T1", "T2"]],
  writeSets: new Map([
    ["T1", [normalizeClaim("a.txt")]],
    ["T2", [normalizeClaim("b.txt")]],
  ]),
});

// T1's write set normalizes to the repository root ("**"), so it conflicts
// with everyone and sits alone in layer 0 (graph.ts's own layering rule); T2
// and T3 are each only downstream of T1, not of each other, so they still
// share layer 1.
function gWithStarStar(): TaskGraph & PlanGraphExtras {
  return graph({
    layers: [["T1"], ["T2", "T3"]],
    implicit: [
      { from: "T1", to: "T2", conflicts: [{ kind: "new-contains-old", a: normalizeClaim("**"), b: normalizeClaim("a.txt") }] },
      { from: "T1", to: "T3", conflicts: [{ kind: "new-contains-old", a: normalizeClaim("**"), b: normalizeClaim("b.txt") }] },
    ],
    writeSets: new Map([
      ["T1", [normalizeClaim("**")]],
      ["T2", [normalizeClaim("a.txt")]],
      ["T3", [normalizeClaim("b.txt")]],
    ]),
  });
}

// One intersecting pair, pre-flagged as having an empty requiredChecks union
// — this is what `emptyRequiredChecksPairs()` (tested separately below)
// actually computes and cli.ts actually attaches; used here only to check
// renderPlanReport's *formatting* of that data in isolation, not whether
// production computes it (fix round 1 finding 2's production-path proof is
// tests/scheduler/scenarios/emptyRequiredChecksWarning.test.ts).
function gEmptyChecks(): TaskGraph & PlanGraphExtras {
  return graph({
    layers: [["T1"], ["T2"]],
    implicit: [{ from: "T1", to: "T2", conflicts: [{ kind: "equal", a: normalizeClaim("a.txt"), b: normalizeClaim("a.txt") }] }],
    writeSets: new Map([
      ["T1", [normalizeClaim("a.txt")]],
      ["T2", [normalizeClaim("a.txt")]],
    ]),
    emptyRequiredChecksPairs: [{ from: "T1", to: "T2" }],
  });
}

// One pair, many conflicting path pairs — large enough that a truncating
// implementation would have something to truncate.
function gManyConflicts(): TaskGraph & PlanGraphExtras {
  const conflicts = Array.from({ length: 25 }, (_, i) => ({
    kind: "equal" as const,
    a: normalizeClaim(`shared/file${i}.txt`),
    b: normalizeClaim(`shared/file${i}.txt`),
  }));
  return graph({
    layers: [["T1"], ["T2"]],
    implicit: [{ from: "T1", to: "T2", conflicts }],
    writeSets: new Map([
      ["T1", conflicts.map((c) => c.a)],
      ["T2", conflicts.map((c) => c.b)],
    ]),
  });
}

describe("renderPlanReport (spec 9.1, 9.5)", () => {
  it("prints each task's normalized write set alongside its declared strings", () => {
    // Without the declared string, "src/**" and a literal directory named
    // "src" render identically once normalized — only `declared` tells a
    // reader which one a task's contract actually contains.
    const writeSetGraph = graph({
      layers: [["T1", "T2"]],
      writeSets: new Map([
        ["T1", [normalizeClaim("src/**")]],
        ["T2", [normalizeClaim("b.txt")]],
      ]),
    });
    const out = renderPlanReport(writeSetGraph, p, pf, { verbose: false });
    expect(out).toContain("src/** -> src/");
    expect(out).toContain("b.txt -> b.txt");
  });

  it("prints every intersecting pair with the conflict kind named", () => {
    // "These two tasks touch the same path" is not actionable on its own —
    // "equal" and a containment kind call for different fixes, so the kind
    // has to be named, not just the fact that a conflict exists.
    const onePair = graph({
      layers: [["T1"], ["T2"]],
      implicit: [{ from: "T1", to: "T2", conflicts: [{ kind: "equal", a: normalizeClaim("a.txt"), b: normalizeClaim("a.txt") }] }],
      writeSets: new Map([
        ["T1", [normalizeClaim("a.txt")]],
        ["T2", [normalizeClaim("a.txt")]],
      ]),
    });
    const out = renderPlanReport(onePair, p, pf, { verbose: true });
    expect(out).toContain("T1 x T2");
    expect(out).toContain("equal");
  });

  it("prints the layers and the parallelism of each", () => {
    // A person decides how much wall-clock a plan costs from this line; if a
    // layer's size isn't printed next to it, they have to count commas.
    const twoLayers = graph({
      layers: [["T1"], ["T2", "T3"]],
      writeSets: new Map([
        ["T1", [normalizeClaim("a.txt")]],
        ["T2", [normalizeClaim("b.txt")]],
        ["T3", [normalizeClaim("c.txt")]],
      ]),
    });
    const out = renderPlanReport(twoLayers, p, pf, { verbose: false });
    expect(out).toContain("layer 0: T1 (parallelism: 1)");
    expect(out).toContain("layer 1: T2, T3 (parallelism: 2)");
  });

  it("prints the landing policy, the work branch name, and all nine up-front checks", () => {
    const rejections: PlanRejection[] = [{ code: "cycle", message: "the task graph has a cycle" }];
    const out = renderPlanReport(g, p, { rejections }, { verbose: false });
    expect(out).toContain("policy=local-merge");
    expect(out).toContain("workBranch=orca/w-fixture");
    // All nine names must appear, whichever of pass/fail/not-evaluated they
    // resolved to — a check missing from the print entirely is a check a
    // human can no longer see was even considered.
    for (const code of [...PLAN_LEVEL_CHECKS, ...RUNTIME_CHECKS]) {
      expect(out).toContain(code);
    }
    // One of each outcome, exercised for real: a rejection present prints
    // fail, a plan-level check absent from rejections prints pass, a runtime
    // check absent from rejections prints "not evaluated" rather than a
    // fabricated pass (ruling R3).
    expect(out).toContain("[fail] cycle: the task graph has a cycle");
    expect(out).toContain("[pass] relative-path");
    expect(out).toContain("[not evaluated] work-branch-already-exists");
  });

  it("prints the degradation warning next to the parallelism, not as a footnote", () => {
    // A warning in the wrong place is a warning nobody reads. The place a
    // person decides from is the parallelism line, so the sentence has to be
    // there.
    const out = renderPlanReport(gWithStarStar(), p, pf, { verbose: false });
    const lines = out.split("\n");
    const par = lines.findIndex((l) => l.includes("parallelism"));
    const warn = lines.findIndex((l) => l.includes("no parallelism"));
    expect(warn).toBeGreaterThanOrEqual(0);
    expect(Math.abs(warn - par)).toBeLessThanOrEqual(2);
    // Ruling: it must name the task and must not claim the whole plan has no
    // parallelism — T2 and T3 still run together in layer 1.
    expect(out).toContain("T1 claims the whole repository");
    expect(out).not.toContain("this plan has no parallelism");
  });

  it("renders the escalation line for a pair emptyRequiredChecksPairs flagged (formatting only)", () => {
    // This checks the renderer's formatting given already-computed data, not
    // whether production computes that data — see
    // scenarios/emptyRequiredChecksWarning.test.ts for the proof that `orca
    // plan` actually flags a real pair through the real contracts it read.
    expect(renderPlanReport(gEmptyChecks(), p, pf, { verbose: false })).toContain("would escalate");
  });

  it("states that a disjoint write set does not guarantee no conflict, next to the parallelism", () => {
    const out = renderPlanReport(g, p, pf, { verbose: false });
    expect(out).toContain("Disjoint does not guarantee no conflict");
  });

  it("never truncates a list with a 'more' marker", () => {
    // rtk's filtering layer taught this repo that a truncated list is the
    // worst of the three options: it looks complete. Summary plus a count is
    // honest; a full list under --verbose is complete; "[+N more]" is
    // neither.
    const out = renderPlanReport(gManyConflicts(), p, pf, { verbose: true });
    expect(out).not.toMatch(/\+\d+ more/);
    // Not just "no marker" — every one of the 25 conflicting paths must
    // actually be present, or a silent cap could hide behind the same
    // assertion.
    expect(out).toContain("shared/file0.txt");
    expect(out).toContain("shared/file24.txt");
  });
});

describe("emptyRequiredChecksPairs (fix round 1 finding 2 — the real wiring)", () => {
  it("flags an intersecting pair whose contracts both declare no requiredChecks", () => {
    const twoTaskGraph = graph({
      layers: [["T1"], ["T2"]],
      implicit: [{ from: "T1", to: "T2", conflicts: [{ kind: "equal", a: normalizeClaim("a.txt"), b: normalizeClaim("a.txt") }] }],
      writeSets: new Map([
        ["T1", [normalizeClaim("a.txt")]],
        ["T2", [normalizeClaim("a.txt")]],
      ]),
    });
    const contracts = new Map<string, unknown>([
      ["T1", { verification: { requiredChecks: [] } }],
      ["T2", { verification: { requiredChecks: [] } }],
    ]);
    expect(emptyRequiredChecksPairs(twoTaskGraph, contracts)).toEqual([{ from: "T1", to: "T2" }]);
  });

  it("does not flag a pair where at least one side declares a check", () => {
    const twoTaskGraph = graph({
      layers: [["T1"], ["T2"]],
      implicit: [{ from: "T1", to: "T2", conflicts: [{ kind: "equal", a: normalizeClaim("a.txt"), b: normalizeClaim("a.txt") }] }],
      writeSets: new Map([
        ["T1", [normalizeClaim("a.txt")]],
        ["T2", [normalizeClaim("a.txt")]],
      ]),
    });
    const contracts = new Map<string, unknown>([
      ["T1", { verification: { requiredChecks: ["npm test"] } }],
      ["T2", { verification: { requiredChecks: [] } }],
    ]);
    expect(emptyRequiredChecksPairs(twoTaskGraph, contracts)).toEqual([]);
  });
});
