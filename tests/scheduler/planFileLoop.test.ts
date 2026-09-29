import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { expandLoopTask } from "../../src/control/loopPlans.js";
import { loadPlan, readSchedulerControlPlanSource, type PlanRejection } from "../../src/scheduler/planFile.js";

/**
 * Loop plans spec §3.1, §3.3 (D3; criterion 4, criterion 6's import half): a plan-file task names a loop plan instead
 * of a contract file -- exactly one of the two -- and Web import stores the loop's expansion, from the plan file's own
 * labels and targetRepo, as the task's original contract.
 */
const LOOP = { plan: "bugfix", goal: "fix login", successCondition: "the login test passes", targetPaths: ["src/auth/**", "tests/auth/**"], checks: ["npm test"] };
const OK = { targetRepo: "/abs/repo", ccloopBin: "/abs/cli.js", runsDir: "/abs/runs", workBranch: "orca/w/x", policy: "local-merge", ledgerMode: "in-repo" };
const reported = (r: { plan: unknown } | { rejections: PlanRejection[] }): string[] =>
  "rejections" in r ? r.rejections.map((x) => `${x.code} ${x.message}`) : [];

describe("the plan file's loop form (spec §3.1, criterion 4)", () => {
  it("loads a task that names a loop plan, keeping the loop and naming no contract", () => {
    const r = loadPlan({ ...OK, tasks: [{ taskId: "T1", loop: LOOP, dependsOn: [] }] }, "main");
    if (!("plan" in r)) throw new Error(JSON.stringify(r.rejections));
    expect(r.plan.tasks).toEqual([{ taskId: "T1", loop: LOOP, dependsOn: [] }]);
  });

  it.each([["both", { contract: "/abs/t1.json", loop: LOOP }], ["neither", {}]])("refuses a task with %s of contract and loop as malformed", (_case, fields) => {
    expect(reported(loadPlan({ ...OK, tasks: [{ taskId: "T1", dependsOn: [], ...fields }] }, "main"))).toEqual(["malformed tasks.0: exactly-one-of-contract-or-loop"]);
  });

  it("refuses an unknown field inside loop (the object is strict)", () => {
    const r = loadPlan({ ...OK, tasks: [{ taskId: "T1", dependsOn: [], loop: { ...LOOP, budget: 5 } }] }, "main");
    expect("rejections" in r && r.rejections.map((x) => x.code)).toEqual(["malformed"]);
  });

  it("still loads the contract form unchanged", () => {
    const task = { taskId: "T1", contract: "/abs/t1.json", dependsOn: [] };
    expect(loadPlan({ ...OK, tasks: [task] }, "main")).toEqual({ plan: { ...OK, tasks: [task] } });
  });

  it("runs the contract path checks on contract tasks only", () => {
    // A loop task has no file: neither relative-path nor contract-inside-target-repo may fire for it...
    expect(reported(loadPlan({ ...OK, tasks: [{ taskId: "T1", loop: LOOP, dependsOn: [] }] }, "main"))).toEqual([]);
    // ...while a contract task beside it is still checked.
    const mixed = loadPlan({ ...OK, tasks: [{ taskId: "T1", loop: LOOP, dependsOn: [] }, { taskId: "T2", contract: "/abs/repo/t2.json", dependsOn: [] }] }, "main");
    expect("rejections" in mixed && mixed.rejections.map((x) => x.code)).toEqual(["contract-inside-target-repo"]);
  });
});

async function planSource(tasks: unknown[]) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-loop-source-")));
  const planPath = join(root, "plan.json");
  await writeFile(planPath, JSON.stringify({ targetRepo: root, ccloopBin: "/abs/cli.js", runsDir: root, workBranch: "orca/w/x", policy: "local-merge", ledgerMode: "out-of-repo", goal: "ship", successConditions: ["passes"], tasks }));
  return { root, read: () => readSchedulerControlPlanSource({ repositoryPath: root, planPath, validatePlanDescriptor() {} }) };
}

describe("Web import's source expands a loop task (spec §3.3)", () => {
  it("stores the expansion of the task's loop, chosen by the plan file's labels, as its original contract", async () => {
    const { plan: _named, ...unnamed } = LOOP;
    const { root, read } = await planSource([{ taskId: "fix-login", dependsOn: [], targetVersion: 1, labels: ["bug"], loop: unnamed }]);
    const want = expandLoopTask("fix-login", root, unnamed, ["bug"]);
    if (!want.ok) throw new Error(want.reason);
    expect(want.recipe).toMatchObject({ planId: "bugfix", chosenBy: "labels" });
    expect(read().tasks[0]).toMatchObject({ originalContractCanonicalJson: want.canonicalJson, originalContractHash: want.hash, loop: want.recipe });
  });

  it("refuses a loop the expansion refuses, naming the task and the reason", async () => {
    const { read } = await planSource([{ taskId: "fix-login", dependsOn: [], targetVersion: 1, loop: { ...LOOP, targetPaths: ["src/*.ts"] } }]);
    expect(read).toThrow("control-plan-rejected:loop-plan-invalid:fix-login:path-shape");
  });

  it("refuses an investigate loop whose file cap is not 1, rather than silently overriding it (ruling R-F15)", async () => {
    const investigate = { plan: "investigate", goal: "find the leak", successCondition: "the report names the cause", targetPaths: ["docs/leak.md"], checks: ["true"], maxFilesTouched: 2 };
    const { read } = await planSource([{ taskId: "fix-login", dependsOn: [], targetVersion: 1, loop: investigate }]);
    expect(read).toThrow("control-plan-rejected:loop-plan-invalid:fix-login:investigate-max-files");
  });
});
