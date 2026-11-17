import { describe, expect, it } from "vitest";
import { parallelClaimsOf, type ParallelClaimsInput } from "../../src/control/parallelClaims.js";
import { taskContractSchema } from "../../src/scheduler/planFile.js";

/**
 * Off-plan writes spec W1/W2: a v4 task's denylist is frozen at confirm from the claims of the tasks that may run at
 * the same time as it. Too few siblings lets two tasks race on one file; too many forbids a task a path that its own
 * ancestor or descendant owns in sequence, which is not a race at all.
 */
type Extra = { key: string; targetPaths: string[]; allowlistPaths?: string[]; repoPath?: string };
type Primary = { repoPath: string; repoKey: string };

function contract(targetPaths: string[], allowlistPaths: string[] = [], additionalRepos?: Extra[], primaryRepo?: Primary) {
  return taskContractSchema.parse({
    objective: { taskId: "t", goal: "g", successCondition: "s" },
    context: {
      repoPath: primaryRepo?.repoPath ?? "/repo", targetPaths, buildTestCommands: ["npm test"],
      ...(additionalRepos === undefined ? {} : { repoKey: primaryRepo?.repoKey ?? "app",
        additionalRepos: additionalRepos.map((r) => ({ repoPath: `/${r.key}`, allowlistPaths: [], ...r })) }),
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

/**
 * A multi-directory group's task, as expandMultiSplitDraft builds it: the primary repository is the first directory it
 * writes, keyed by that directory's name, and a task that writes one directory has an ordinary contract rooted there.
 */
function dirTask(taskId: string, primaryDir: string, targetPaths: string[], extras: Array<{ dir: string; targetPaths: string[] }> = []): ParallelClaimsInput {
  const extra = extras.length === 0 ? undefined : extras.map((e) => ({ key: e.dir, repoPath: `/group/${e.dir}`, targetPaths: e.targetPaths }));
  return { taskId, dependencyTaskIds: [], contract: contract(targetPaths, [], extra, { repoPath: `/group/${primaryDir}`, repoKey: primaryDir }) };
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

  // Multi-directory groups (ruling 2026-11-18, fix round 1): a repository is a directory, not a role. A task's primary
  // is the first directory it writes, so two tasks' primaries can differ and one task's primary can be another's extra.

  it("primaries in different directories are compared per directory, not as one primary", () => {
    // C's api src/** and B's web src/ui.ts are different files: C and B may run together.
    const out = parallelClaimsOf([
      dirTask("C", "api", ["src/**"], [{ dir: "web", targetPaths: ["src/c-web.ts"] }]),
      dirTask("B", "web", ["src/ui.ts"]),
    ]);
    expect(out.get("C")).toEqual([{ siblingId: "B", claims: [{ repoKey: "web", path: "src/ui.ts" }] }]);
    expect(out.get("B")).toEqual([{ siblingId: "C", claims: [primary("src/c-web.ts")] }]);
  });

  it("a claim is keyed by the receiver's own key for that directory", () => {
    // B's primary directory is C's extra "web": C must deny it under "web", and B must deny C's web claim as primary.
    const out = parallelClaimsOf([
      dirTask("C", "api", ["src/c.ts"], [{ dir: "web", targetPaths: ["src/other.ts"] }]),
      dirTask("B", "web", ["src/ui.ts"]),
    ]);
    expect(out.get("C")).toEqual([{ siblingId: "B", claims: [{ repoKey: "web", path: "src/ui.ts" }] }]);
    expect(out.get("B")).toEqual([{ siblingId: "C", claims: [primary("src/other.ts")] }]);
  });

  it("the same directory under different roles intersects", () => {
    // S writes web/src/** as an extra; T writes web/src/ui.ts as its primary: the same file, so they are ordered.
    const out = parallelClaimsOf([
      dirTask("S", "api", ["src/s.ts"], [{ dir: "web", targetPaths: ["src/**"] }]),
      dirTask("T", "web", ["src/ui.ts"]),
    ]);
    expect(out.get("S")).toEqual([]);
    expect(out.get("T")).toEqual([]);
  });

  it("a claim in a directory the receiver lacks is dropped", () => {
    // T cannot write /group/docs at all, so S's claim there has no place in T's denylist. T's repoPath is written
    // un-normalized: it names the same directory as S's primary.
    const out = parallelClaimsOf([
      { taskId: "T", dependencyTaskIds: [], contract: contract(["src/t.ts"], [], undefined, { repoPath: "/group/api/./", repoKey: "api" }) },
      dirTask("S", "api", ["src/s.ts"], [{ dir: "docs", targetPaths: ["guide.md"] }]),
    ]);
    expect(out.get("T")).toEqual([{ siblingId: "S", claims: [primary("src/s.ts")] }]);
    expect(out.get("S")).toEqual([{ siblingId: "T", claims: [primary("src/t.ts")] }]);
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
