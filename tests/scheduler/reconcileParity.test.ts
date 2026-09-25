import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  planReconciliation, planReconciliationOf, synthesizeReconcileContract, synthesizeReconcileContractOf,
  type MaterialisedConflict,
} from "../../src/scheduler/reconcile.js";
import type { PlanTask } from "../../src/scheduler/planFile.js";

// Handoff delivery spec §5.2 N1 and §11 M5 (controller decision; human ruling "parallel is not only two"):
// the N-ary reconciler is added beside the two-sided one, which `orca run` keeps using unchanged. With one
// other side it must write the very same bytes under the very same name, or the driver's two-way landing
// (every existing reconciliation criterion) would silently change what it hands the reconciler.
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
const runsDir = async (): Promise<string> => { const dir = await mkdtemp(join(tmpdir(), "orca-reconcile-parity-")); dirs.push(dir); return dir; };

const side = (taskId: string): PlanTask => ({ taskId, contract: "", dependsOn: [] });
const contract = (taskId: string, checks: string[] | undefined, tokenBudget: number) => ({
  objective: { taskId, goal: `do ${taskId}`, successCondition: `${taskId} passes` },
  executionPolicy: { perAttemptTimeoutMs: 1_000 * tokenBudget, totalRuntimeBudgetMs: 2_000 * tokenBudget, tokenBudget },
  ...(checks === undefined ? {} : { verification: { requiredChecks: checks } }),
});
// Only the fields the synthesizer reads; the conflict itself is never touched here.
const conflict: MaterialisedConflict = {
  copyPath: "/copy", wTip: "1".repeat(40), incomingRef: "refs/orca/incoming/run", conflictedPaths: ["shared.txt"],
  conflictCommit: "2".repeat(40), blocks: [],
};

describe("the N-ary reconciler (handoff delivery spec §5.2 N1, §11 M5)", () => {
  it("N-parity: with one other side it writes byte-for-byte what the two-sided synthesizer writes, under the same file name", async () => {
    const contracts = new Map<string, unknown>([["a", contract("a", ["x", "y"], 5)], ["b", contract("b", ["y", "z"], 3)]]);
    const [two, many] = [await runsDir(), await runsDir()];
    const byTwo = await synthesizeReconcileContract(side("a"), side("b"), contracts, two, conflict);
    const byMany = await synthesizeReconcileContractOf(side("a"), [side("b")], contracts, many, conflict);
    if (!("path" in byTwo) || !("path" in byMany)) throw new Error(`escalated: ${JSON.stringify([byTwo, byMany])}`);
    expect(basename(byMany.path)).toBe(basename(byTwo.path));
    expect((await readFile(byMany.path)).equals(await readFile(byTwo.path))).toBe(true);
    expect(await readdir(many)).toEqual([basename(byTwo.path)]);
    expect(planReconciliationOf([contracts.get("a"), contracts.get("b")])).toEqual(planReconciliation(contracts.get("a"), contracts.get("b")));
  });

  it("three sides: every side's checks in first-seen order, the largest budget, and a task id naming all three", async () => {
    const contracts = new Map<string, unknown>([
      ["a", contract("a", ["x", "y"], 5)], ["b", contract("b", ["y", "z"], 3)], ["d", contract("d", ["w", "x"], 7)],
    ]);
    const made = await synthesizeReconcileContractOf(side("a"), [side("b"), side("d")], contracts, await runsDir(), conflict);
    if (!("path" in made)) throw new Error(`escalated: ${made.escalate}`);
    const written = JSON.parse(await readFile(made.path, "utf8"));
    expect(basename(made.path)).toBe("contract-reconcile-a-b-d.json");
    expect(written.objective.taskId).toBe("reconcile-a-b-d");
    expect(written.verification.requiredChecks).toEqual(["x", "y", "z", "w"]);
    expect(written.context.buildTestCommands).toEqual(["x", "y", "z", "w"]);
    expect(written.executionPolicy).toMatchObject({ tokenBudget: 7, perAttemptTimeoutMs: 7_000, totalRuntimeBudgetMs: 14_000, maxAttempts: 1 });
    // Every side's intent is carried: the reconciler is none of the parties (spec §5.2).
    for (const id of ["a", "b", "d"]) expect(written.objective.goal).toContain(`${id} was trying to: do ${id}`);
    expect(written.objective.goal).toContain("between task a and tasks b, d.");
    expect(written.objective.goal).toContain("Every intent must survive.");
  });

  it("escalates an empty union of checks over three sides with the two-sided function's own words", async () => {
    const contracts = new Map<string, unknown>([["a", contract("a", undefined, 5)], ["b", contract("b", [], 3)], ["d", contract("d", undefined, 7)]]);
    const expected = planReconciliation(undefined, undefined);
    expect(expected.escalate).toBe(true);
    expect(planReconciliationOf([contracts.get("a"), contracts.get("b"), contracts.get("d")])).toEqual(expected);
    const dir = await runsDir();
    const made = await synthesizeReconcileContractOf(side("a"), [side("b"), side("d")], contracts, dir, conflict);
    expect(made).toEqual({ escalate: (expected as { why: string }).why });
    expect(await readdir(dir)).toEqual([]);
  });

  it("escalates a three-sided reconciliation one side of which contributed no intent, naming every side", async () => {
    const contracts = new Map<string, unknown>([["a", contract("a", ["x"], 5)], ["b", { verification: { requiredChecks: ["y"] } }], ["d", contract("d", ["z"], 7)]]);
    const dir = await runsDir();
    const made = await synthesizeReconcileContractOf(side("a"), [side("b"), side("d")], contracts, dir, conflict);
    expect(made).toEqual({
      escalate: "cannot synthesize a reconciliation contract for a x b x d: b contributed no goal, successCondition or " +
        "execution budget, so the contract would carry only the other side's intent and the reconciler would be the " +
        "conflicting party (spec §5.2)",
    });
    expect(await readdir(dir)).toEqual([]);
  });

  it("names a reconciliation whose ids would pass the 200-character id ceiling by a hash stem, at most 200 characters (spec §13.2 Minor c)", async () => {
    const [long1, long2] = ["p".repeat(120), "q".repeat(120)];
    const contracts = new Map<string, unknown>([["a", contract("a", ["x"], 5)], [long1, contract(long1, ["y"], 3)], [long2, contract(long2, ["z"], 7)]]);
    const made = await synthesizeReconcileContractOf(side("a"), [side(long1), side(long2)], contracts, await runsDir(), conflict);
    if (!("path" in made)) throw new Error(`escalated: ${made.escalate}`);
    const taskId: string = JSON.parse(await readFile(made.path, "utf8")).objective.taskId;
    expect(taskId).toMatch(/^reconcile-a-[0-9a-f]{16}$/);
    expect(taskId.length).toBeLessThanOrEqual(200);
    expect(basename(made.path)).toBe(`contract-${taskId}.json`);
    // A different set of other sides gets a different name: the hash is over the other sides' ids.
    const other = await synthesizeReconcileContractOf(side("a"), [side(long2), side(long1)], contracts, await runsDir(), conflict);
    if (!("path" in other)) throw new Error(`escalated: ${other.escalate}`);
    expect(JSON.parse(await readFile(other.path, "utf8")).objective.taskId).not.toBe(taskId);
  });
});
