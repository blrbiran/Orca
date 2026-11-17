import { describe, expect, it } from "vitest";
import { parallelClaimsOf, type ParallelClaimsInput } from "../../src/control/parallelClaims.js";
import { taskContractSchema } from "../../src/scheduler/planFile.js";

/**
 * Off-plan writes spec W1/W2: a v4 task's denylist is frozen at confirm from the claims of the tasks that may run at
 * the same time as it. Too few siblings lets two tasks race on one file; too many forbids a task a path that its own
 * ancestor or descendant owns in sequence, which is not a race at all.
 */
type Extra = { key: string; targetPaths: string[]; allowlistPaths?: string[] };

function contract(targetPaths: string[], allowlistPaths: string[] = [], additionalRepos?: Extra[]) {
  return taskContractSchema.parse({
    objective: { taskId: "t", goal: "g", successCondition: "s" },
    context: {
      repoPath: "/repo", targetPaths, buildTestCommands: ["npm test"],
      ...(additionalRepos === undefined ? {} : { repoKey: "app", additionalRepos: additionalRepos.map((r) => ({ repoPath: `/${r.key}`, ...r })) }),
    },
    executionPolicy: { autonomyLevel: "L2", maxAttempts: 1, perAttemptTimeoutMs: 1_000, totalRuntimeBudgetMs: 1_000,
      worktreeRequired: true, partialOutcomeRecoveryWindowMs: 0 },
    safetyPolicy: { allowlistPaths, maxFilesTouched: 5 },
    verification: { verifierType: "command", requiredChecks: ["npm test"], rejectOn: ["failure"] },
    escalationAndExit: {},
  });
}

function task(taskId: string, dependencyTaskIds: string[], targetPaths: string[], allowlistPaths: string[] = [], extra?: Extra[]): ParallelClaimsInput {
  return { taskId, dependencyTaskIds, contract: contract(targetPaths, allowlistPaths, extra) };
}

const primary = (path: string) => ({ repoKey: null, path });

describe("the parallel siblings' claims of a v4 task", () => {
  it("a diamond gives B's claims to C and C's to B, nothing to A or D", () => {
    // A is D's ancestor only through B or C: excluding it needs the transitive closure, not the direct edge.
    // "gone" names no task in the plan and is ignored.
    const out = parallelClaimsOf([
      task("D", ["B", "C"], ["src/d.ts"]),
      task("C", ["A"], ["src/c.ts"]),
      task("B", ["A", "gone"], ["src/b/**"]),
      task("A", [], ["src/a.ts"]),
    ]);
    expect(out.get("A")).toEqual([]);
    expect(out.get("B")).toEqual([{ siblingId: "C", claims: [primary("src/c.ts")] }]);
    expect(out.get("C")).toEqual([{ siblingId: "B", claims: [primary("src/b/**")] }]);
    expect(out.get("D")).toEqual([]);
    expect([...out.keys()].sort()).toEqual(["A", "B", "C", "D"]);
  });

  it("a task claiming ** has no siblings and is no one's sibling", () => {
    const out = parallelClaimsOf([task("all", [], ["**"]), task("one", [], ["src/one.ts"])]);
    expect(out.get("all")).toEqual([]);
    expect(out.get("one")).toEqual([]);
  });

  it("an unordered pair whose write sets intersect are not siblings", () => {
    // R is disjoint from both, so P and Q do have a sibling: what is missing is each other. Input order is not
    // sibling order: R's siblings come out sorted by id.
    const out = parallelClaimsOf([
      task("Q", [], ["src/lib/q.ts"]),
      task("R", [], ["docs/r.md"]),
      task("P", [], ["src/lib/**"]),
    ]);
    expect(out.get("P")).toEqual([{ siblingId: "R", claims: [primary("docs/r.md")] }]);
    expect(out.get("Q")).toEqual([{ siblingId: "R", claims: [primary("docs/r.md")] }]);
    expect(out.get("R")).toEqual([
      { siblingId: "P", claims: [primary("src/lib/**")] },
      { siblingId: "Q", claims: [primary("src/lib/q.ts")] },
    ]);
  });

  it("claims in another repository keep their repository key", () => {
    // T's lib claims the same path S claims in the primary repository: different repositories, so no intersection.
    const out = parallelClaimsOf([
      task("T", [], ["src/t.ts"], [], [{ key: "lib", targetPaths: ["src/shared.ts"], allowlistPaths: [] }]),
      task("S", [], ["src/shared.ts"], [], [{ key: "lib", targetPaths: ["pkg/**"], allowlistPaths: [] }]),
    ]);
    expect(out.get("T")).toEqual([{ siblingId: "S", claims: [primary("src/shared.ts"), { repoKey: "lib", path: "pkg/**" }] }]);
    expect(out.get("S")).toEqual([{ siblingId: "T", claims: [primary("src/t.ts"), { repoKey: "lib", path: "src/shared.ts" }] }]);
  });

  it("the same path in the same extra repository makes the pair not siblings", () => {
    const out = parallelClaimsOf([
      task("T", [], ["src/t.ts"], [], [{ key: "lib", targetPaths: ["pkg/a.ts"], allowlistPaths: [] }]),
      task("S", [], ["src/s.ts"], [], [{ key: "lib", targetPaths: ["pkg/**"], allowlistPaths: [] }]),
    ]);
    expect(out.get("T")).toEqual([]);
    expect(out.get("S")).toEqual([]);
  });

  it("a v3 task (non-empty allowlist) gets no siblings", () => {
    // It is still a sibling of a v4 task, with its allowlist counted as claims (sorted, de-duplicated).
    const out = parallelClaimsOf([
      task("v3", [], ["src/v3.ts"], ["src/v3.ts", "src/v3-extra.ts"]),
      task("v4", [], ["src/v4.ts"]),
    ]);
    expect(out.get("v3")).toEqual([]);
    expect(out.get("v4")).toEqual([{ siblingId: "v3", claims: [primary("src/v3-extra.ts"), primary("src/v3.ts")] }]);
  });

  it("a dependency cycle ends instead of looping", () => {
    const out = parallelClaimsOf([task("X", ["Y"], ["src/x.ts"]), task("Y", ["X"], ["src/y.ts"]), task("Z", [], ["src/z.ts"])]);
    expect(out.get("X")).toEqual([{ siblingId: "Z", claims: [primary("src/z.ts")] }]);
    expect(out.get("Z")).toEqual([
      { siblingId: "X", claims: [primary("src/x.ts")] },
      { siblingId: "Y", claims: [primary("src/y.ts")] },
    ]);
  });
});
