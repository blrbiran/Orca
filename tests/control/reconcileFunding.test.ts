// Tester follow-up H (Part B gap; spec G §2.1, §13): in a finite expectation-model group the running runs' live ceilings
// hold the group's whole remainder (claims split it, raises hand out the rest). A run Orca dispatches for the group
// itself -- a reconciliation of a conflicting landing -- must still be funded, and without the group cap going soft:
// a run whose execution ended holds no ceiling (its work usage is final), no ceiling is raised while such a run may yet
// need a reconciliation, and a reconciliation in flight is held in the group's reserve until its spend is booked.
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { ExecutionDriver } from "../../src/control/executionDriver.js";
import { decideFundedAllowance } from "../../src/control/fundedAllowance.js";
import { planCeilingRaises } from "../../src/control/liveCeilingRaise.js";
import { readGroup } from "../../src/control/queries.js";
import { readWebGroup } from "../../src/control/webService.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";
import { answerSingleCalls } from "./fixtures/singleCallAnswers.js";

const M = 1_000_000;
const conflicting = [{ taskId: "a", targetPaths: ["shared.txt"] }, { taskId: "b", targetPaths: ["shared.txt"] }];
const files = (id: string) => ({ "shared.txt": id === "a" ? "A\n" : "B\n" });
const LANDED = ["landed", "settled"];

async function untilDeadline(driver: ExecutionDriver, predicate: () => boolean, deadlineMs = 20_000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await driver.round();
  }
  if (!predicate()) throw new Error("the driver did not reach the expected state before the deadline");
}

async function twoConflicting(limit: number, reconcile: { holdMs?: number; spent?: number } = {}, workTokens?: (id: string) => number) {
  const t = await driverHarness(conflicting, { files, tokenPolicy: "optional-v1", modelVersion: "followup-g", ...(workTokens ? { workTokens } : {}) });
  await writeFile(t.deps.agentsTablePath, JSON.stringify({ status: "succeeded", spent: 7, holdMs: 0, files: { "shared.txt": "A\nB\n" }, ...reconcile }));
  const current = readWebGroup(t.h.store, "g").ledger.groupLimit;
  const set = t.service.setLimit(t.h.command("set-limit", { limit: { ...current, tokens: limit } }));
  if ("error" in set) throw new Error(`set-limit refused: ${JSON.stringify(set)}`);
  const ids = [await t.claim(), await t.claim()];
  const spawns = () => existsSync(`${t.deps.agentsTablePath}.runs`) ? readFileSync(`${t.deps.agentsTablePath}.runs`, "utf8").trim().split("\n") : [];
  return { ...t, ids, spawns };
}

describe("a reconciliation in an expectation-model group is funded under the hard group cap (follow-up H)", { timeout: 60_000 }, () => {
  it("H1: the two claims hold the whole remainder, and the conflicting landing is still reconciled and lands", async () => {
    const t = await twoConflicting(20 * M);
    try {
      const group = readGroup(t.h.store, "g");
      // The precondition the gap needs: the two running ceilings hold everything the group has left.
      expect(group.limit.tokens! - group.used.tokens - group.reserved.tokens).toBe(0);
      const driver = t.driver();
      await untilDeadline(driver, () => t.ids.every((id) => [...LANDED, "blocked"].includes(t.body(id).state)));
      expect(t.ids.map((id) => t.body(id).drive?.blockedReason ?? null)).toEqual([null, null]);
      expect(t.ids.every((id) => LANDED.includes(t.body(id).state))).toBe(true);
      expect(t.spawns()).toHaveLength(1);
      expect(git(t.repo, "show", "refs/heads/orca/g:shared.txt")).toBe("A\nB");
      const after = readGroup(t.h.store, "g");
      expect(after.used.tokens + after.reserved.tokens).toBeLessThanOrEqual(after.limit.tokens!);
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  it("H2: the run that conflicts funds its reconciliation partly from its own unused ceiling once its execution ended", async () => {
    // Each claim's ceiling holds about half the group; each run leaves 1.6M of it unused. The reconciliation's budget (3M:
    // the sides name none) is more than the landed run gave back, and fits only with what the conflicting run left --
    // which that run holds until it lands.
    const usage = new Map<string, number>();
    const t = await twoConflicting(20 * M, {}, (id) => usage.get(id) ?? 10);
    try {
      for (const id of t.ids) usage.set(t.body(id).taskId, t.body(id).liveCeiling.tokens - 1_600_000);
      const driver = t.driver();
      await untilDeadline(driver, () => t.ids.every((id) => [...LANDED, "blocked"].includes(t.body(id).state)));
      expect(t.ids.map((id) => t.body(id).drive?.blockedReason ?? null)).toEqual([null, null]);
      const reconciled = t.ids.filter((id) => t.body(id).drive.reconcile !== null);
      expect(reconciled).toHaveLength(1);
      expect(t.body(reconciled[0]!).drive.reconcile).toMatchObject({ outcome: "succeeded", tokenBudget: 3 * M });
      expect(t.ids.every((id) => LANDED.includes(t.body(id).state))).toBe(true);
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  it("H3: a reconciliation in flight is held in the group's reserve until its spend is booked", async () => {
    const t = await twoConflicting(20 * M, { holdMs: 2_000 });
    try {
      const driver = t.driver();
      await untilDeadline(driver, () => t.spawns().length === 1);
      const reconciling = t.ids.find((id) => t.body(id).state === "reconciling")!;
      const budget = t.body(reconciling).drive.reconcile.tokenBudget as number;
      // The only active ceiling-type hold left: the landed run settled, the conflicting run's execution ended.
      expect((readGroup(t.h.store, "g") as unknown as { liveCeilingReserved?: number }).liveCeilingReserved).toBe(budget);
      await untilDeadline(driver, () => t.ids.every((id) => [...LANDED, "blocked"].includes(t.body(id).state)));
      expect(t.ids.every((id) => LANDED.includes(t.body(id).state))).toBe(true);
      await untilDeadline(driver, () => (readGroup(t.h.store, "g") as unknown as { liveCeilingReserved?: number }).liveCeilingReserved === 0);
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  it("H4: a reconciliation the running ceilings hold the funds for waits (no block), claims leave its budget aside, and a top-up funds it", async () => {
    // a and b conflict on shared.txt and use all but 1000 of their ceilings (a third of the group each); c keeps running on
    // its own file with its third; d waits for a and e for b. The reconciliation (3M) cannot be paid from what a and b
    // left, but could from c's ceiling.
    const usage = new Map<string, number>();
    const tasks = [...conflicting, { taskId: "c" }, { taskId: "d", dependsOn: ["a"] }, { taskId: "e", dependsOn: ["b"] }];
    const t = await driverHarness(tasks, {
      tokenPolicy: "optional-v1", modelVersion: "followup-g",
      files: (id) => id === "a" || id === "b" ? files(id) : { [`${id}.txt`]: `${id}\n` },
      behaviour: (id) => id === "c" ? "stoppable" : "succeed",
      workTokens: (id) => usage.get(id) ?? 10,
    });
    try {
      await writeFile(t.deps.agentsTablePath, JSON.stringify({ status: "succeeded", spent: 7, holdMs: 0, files: { "shared.txt": "A\nB\n" } }));
      const spawns = () => existsSync(`${t.deps.agentsTablePath}.runs`) ? readFileSync(`${t.deps.agentsTablePath}.runs`, "utf8").trim().split("\n") : [];
      const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
      const set = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, tokens: 30 * M } }));
      if ("error" in set) throw new Error(`set-limit refused: ${JSON.stringify(set)}`);
      const ids = [await t.claim(), await t.claim(), await t.claim()];
      for (const id of ids) if (t.body(id).taskId !== "c") usage.set(t.body(id).taskId, t.body(id).liveCeiling.tokens - 1000);
      const driver = t.driver();
      const waiting = () => ids.find((id) => t.body(id).drive?.reconcile?.fundingWait !== undefined);
      await untilDeadline(driver, () => waiting() !== undefined || ids.some((id) => t.body(id).state === "blocked"));
      const run = waiting();
      expect(ids.map((id) => t.body(id).drive?.blockedReason ?? null)).toEqual([null, null, null]);
      expect(t.body(run!).state).toBe("reconciling");
      expect(t.body(run!).drive.reconcile.fundingWait).toBe(3 * M);
      expect(spawns()).toHaveLength(0);
      // The landed task's dependent is ready, and its claim does not take what the waiting reconciliation needs.
      const dependent = t.body(run!).taskId === "a" ? "e" : "d";
      expect(decideFundedAllowance(t.h.store, "g", dependent, Date.now()).reason).toBe("group-budget-unavailable");
      const now = readWebGroup(t.h.store, "g").ledger.groupLimit;
      const topUp = t.service.setLimit(t.h.command("set-limit", { limit: { ...now, tokens: now.tokens! + 3 * M } }));
      if ("error" in topUp) throw new Error(`set-limit refused: ${JSON.stringify(topUp)}`);
      await untilDeadline(driver, () => LANDED.includes(t.body(run!).state) || t.body(run!).state === "blocked");
      expect(t.body(run!).drive.reconcile).toMatchObject({ outcome: "succeeded" });
      expect(t.body(run!).drive.reconcile.fundingWait).toBeUndefined();
      expect(spawns()).toHaveLength(1);
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  it("H5: no running ceiling is raised while a run whose execution ended is still active", async () => {
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }], { tokenPolicy: "optional-v1", modelVersion: "followup-g", behaviour: () => "stoppable" });
    try {
      const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
      const set = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, tokens: 20 * M } }));
      if ("error" in set) throw new Error(`set-limit refused: ${JSON.stringify(set)}`);
      const [, second] = [await t.claim(), await t.claim()];
      const more = t.service.setLimit(t.h.command("set-limit", { limit: { ...readWebGroup(t.h.store, "g").ledger.groupLimit, tokens: 30 * M } }));
      if ("error" in more) throw new Error(`set-limit refused: ${JSON.stringify(more)}`);
      // Both running: the free 10M is raised into them.
      expect(planCeilingRaises(t.h.store, "g", Date.now())).toHaveLength(2);
      const body = t.body(second!);
      t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...body, state: "collected" }), second!);
      expect(planCeilingRaises(t.h.store, "g", Date.now())).toEqual([]);
    } finally { await t.h.dispose(); }
  });

  it("H6: the goal judge of a no-change run is funded from the share that run gave back when its execution ended", async () => {
    const t = await driverHarness([{ taskId: "a" }], { files: () => ({}), tokenPolicy: "optional-v1", modelVersion: "followup-g" });
    try {
      const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
      const set = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, tokens: 10 * M, activeMs: limit.activeMs * 4, attempts: limit.attempts + 20, sessions: limit.sessions + 20 } }));
      if ("error" in set) throw new Error(`set-limit refused: ${JSON.stringify(set)}`);
      const seen = answerSingleCalls(t, () => ({ outcome: "complete", output: { verdict: "met", finding: "already there" } }));
      const first = await t.claim();
      const group = readGroup(t.h.store, "g");
      // The lone run's ceiling holds the whole remainder.
      expect(group.limit.tokens! - group.used.tokens - group.reserved.tokens).toBe(0);
      const driver = t.driver();
      await t.until(driver, () => t.body(first).drive?.noChangeJudge !== undefined && t.body(first).drive.noChangeJudge.state !== "pending");
      expect(String(t.body(first).drive.blockedReason)).not.toMatch(/unfunded/);
      expect(seen.calls.map((c) => c.purpose)).toEqual(["no-change-judge"]);
      expect(t.body(first).drive.noChangeJudge).toMatchObject({ state: "met" });
    } finally { await t.h.dispose(); }
  });

  it("H7: a reconciliation nothing running can fund any more blocks reconcile-budget instead of waiting", async () => {
    // Both runs use all but 1000 of their ceilings and nothing else runs: the 3M reconciliation cannot be funded.
    const usage = new Map<string, number>();
    const t = await twoConflicting(20 * M, {}, (id) => usage.get(id) ?? 10);
    try {
      for (const id of t.ids) usage.set(t.body(id).taskId, t.body(id).liveCeiling.tokens - 1000);
      const driver = t.driver();
      await untilDeadline(driver, () => t.ids.every((id) => [...LANDED, "blocked"].includes(t.body(id).state)));
      expect(t.ids.map((id) => t.body(id).drive?.blockedReason ?? null).sort()).toEqual([null, "reconcile-budget"].sort());
      expect(t.spawns()).toHaveLength(0);
      await driver.stop();
    } finally { await t.h.dispose(); }
  });
});
