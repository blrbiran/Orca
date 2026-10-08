import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ControlError } from "../../src/control/errors.js";
import { schedulerControlPlanSourceOf } from "../../src/scheduler/planFile.js";

/**
 * Spec 2026-10-08 §2.2(b), (c): Web import names every problem it can see in ONE refusal, one item per line. Stage 1 is
 * loadPlan's schema check (its issues are the whole list); otherwise stage 2 collects the plan-level items, then each
 * task's in plan order -- so a person fixes a plan in one round instead of one import per problem.
 */
const LOOP = { plan: "bugfix", goal: "fix login", successCondition: "the login test passes", targetPaths: ["src/auth/**", "tests/auth/**"], checks: ["npm test"] };
const BASE = { targetRepo: "/abs/repo", ccloopBin: "/abs/cli.js", runsDir: "/abs/runs", workBranch: "orca/w/x", policy: "local-merge", ledgerMode: "out-of-repo" };
const GOOD = { ...BASE, goal: "ship", successConditions: ["passes"] };
const task = (taskId: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({ taskId, loop: LOOP, dependsOn: [], targetVersion: 1, ...over });

/** The refused plan's items, read back from the one ControlError the import throws. */
function itemsOf(read: () => unknown): string[] {
  try {
    read();
  } catch (error) {
    if (error instanceof ControlError && error.code === "control-plan-rejected") return (error.detail ?? "").split("\n");
    throw error;
  }
  throw new Error("the plan was not refused");
}

describe("Web import names every problem of a plan at once (spec 2026-10-08 §2.2(c))", () => {
  it("names five problems of one plan in one refusal, in the spec's order", () => {
    const { targetVersion: _none, ...withoutVersion } = task("a");
    const plan = { ...BASE, tasks: [withoutVersion, task("b", { dependsOn: ["ghost"] })] };
    expect(itemsOf(() => schedulerControlPlanSourceOf(plan, "/abs/other"))).toEqual([
      "target-repo-mismatch", "missing-goal", "missing-success-conditions", "missing-target-version:a", "dangling-dependency:b",
    ]);
  });

  it("gives a plan with one problem exactly one item", () => {
    const plan = { ...GOOD, tasks: [task("a"), task("b", { dependsOn: ["a", "a"] })] };
    expect(itemsOf(() => schedulerControlPlanSourceOf(plan, "/abs/repo"))).toEqual(["duplicate-dependency:b"]);
  });

  it("orders one task's items: repeated dependency, dangling dependency, missing targetVersion, then its contract", () => {
    const { targetVersion: _none, ...withoutVersion } = task("b", { dependsOn: ["a", "a", "ghost"], loop: { ...LOOP, targetPaths: ["src/*.ts"] } });
    const plan = { ...GOOD, successConditions: ["same", "same"], tasks: [task("a"), withoutVersion] };
    expect(itemsOf(() => schedulerControlPlanSourceOf(plan, "/abs/repo"))).toEqual([
      "duplicate-success-condition", "duplicate-dependency:b", "dangling-dependency:b", "missing-target-version:b", "loop-plan-invalid:b:path-shape",
    ]);
  });

  it("names every task's broken contract file, not only the first", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "orca-plan-items-")));
    await mkdir(join(root, "contracts"));
    const a = join(root, "contracts", "a.json"), b = join(root, "contracts", "b.json");
    await writeFile(a, "not json");
    await writeFile(b, "{}");
    const plan = { ...GOOD, tasks: [{ taskId: "a", contract: a, dependsOn: [], targetVersion: 1 }, { taskId: "b", contract: b, dependsOn: [], targetVersion: 1 }] };
    expect(itemsOf(() => schedulerControlPlanSourceOf(plan, "/abs/repo"))).toEqual(["contract-json:a", "contract-shape:b"]);
  });

  it("keeps a schema issue whose message holds commas as one item (stage 1)", () => {
    const items = itemsOf(() => schedulerControlPlanSourceOf({ ...GOOD, workBranch: "", foo: 1, bar: 2, tasks: [] }, "/abs/repo"));
    expect([...items].sort()).toEqual([
      "malformed:<root>: Unrecognized key(s) in object: 'foo', 'bar'",
      "malformed:workBranch: String must contain at least 1 character(s)",
    ]);
  });

  it("writes a newline inside an item as \\n, so the separator stays unambiguous", () => {
    expect(itemsOf(() => schedulerControlPlanSourceOf({ ...GOOD, "a\nb": 1, tasks: [] }, "/abs/repo"))).toEqual([
      "malformed:<root>: Unrecognized key(s) in object: 'a\\nb'",
    ]);
  });

  // Controller amendment (Part A preamble): non-ASCII text must survive an item. A taskId cannot carry it -- stage 1 refuses
  // any id outside RUN_ID -- so the non-ASCII text here is a contract path, which stage 2 puts into the item verbatim.
  it("carries non-ASCII text and commas in an item verbatim, beside a task's other items", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "orca-plan-items-")));
    const missing = join(root, "合约,目录", "a.json");
    const { targetVersion: _none, ...withoutVersion } = { taskId: "a", contract: missing, dependsOn: [], targetVersion: 1 };
    expect(itemsOf(() => schedulerControlPlanSourceOf({ ...GOOD, tasks: [withoutVersion] }, "/abs/repo"))).toEqual([
      "missing-target-version:a", `unreadable-source:${missing}`,
    ]);
  });

  it("still imports a plan with no problem", () => {
    const source = schedulerControlPlanSourceOf({ ...GOOD, tasks: [task("a"), task("b", { dependsOn: ["a"] })] }, "/abs/repo");
    expect(source.tasks.map((entry) => [entry.taskId, entry.dependencyTaskIds, entry.targetVersion])).toEqual([["a", [], 1], ["b", ["a"], 1]]);
  });
});
