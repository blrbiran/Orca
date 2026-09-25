import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { readDriverRun, type ExecutionDriver } from "../../src/control/executionDriver.js";
import { otherSideOfWeb, stepD } from "../../src/control/driverLanding.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { readWebGroup } from "../../src/control/webService.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";
import type { WebFixtureTask } from "./fixtures/web.js";

// Handoff delivery spec §5.2 (human ruling "parallel is not only two"; controller decisions N1, N2) and
// §11 I7 / §13.2 I-6: a landing that conflicts with several landed tasks is reconciled against all of them
// at once, a group has at most one landing reconciling at a time, and every reconciliation spawn is booked
// on the group, a second spawn after a moved tip included.
const LANDED = ["landed", "settled"];
// The reconciliation is a background process: its progress is wall-clock time, not rounds (execution
// driver deviation, Task 6 fix round 1, m3). Rounds 50 ms apart for at most 20 s.
async function untilDeadline(driver: ExecutionDriver, predicate: () => boolean, deadlineMs = 20_000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await driver.round();
  }
  if (!predicate()) throw new Error("the driver did not reach the expected state before the deadline");
}

async function harness(tasks: readonly WebFixtureTask[], files: (id: string) => Record<string, string>, reconcile: { files: Record<string, string>; holdMs?: number }) {
  const t = await driverHarness(tasks, { files });
  await writeFile(t.deps.adapterConfigPath, JSON.stringify({ status: "succeeded", spent: 7, holdMs: 0, ...reconcile }));
  // Deviation D12: by default the group's reserve (20% of base) is smaller than one task's token budget,
  // so a reconciliation is refused until another run settles. Raise the ceiling explicitly.
  const limit = readControlGroup(t.h.store, "epoch-test", "g").ledger.groupLimit;
  const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, tokens: limit.tokens + 10_000_000 } }));
  if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
  const spawns = () => existsSync(`${t.deps.adapterConfigPath}.runs`) ? readFileSync(`${t.deps.adapterConfigPath}.runs`, "utf8").trim().split("\n") : [];
  const bookings = () => (t.h.store.db.prepare("SELECT id FROM outbox WHERE kind='reconcile-usage' ORDER BY id").all() as Array<{ id: string }>).map((row) => row.id);
  const taskOf = (runId: string): string => t.body(runId).taskId;
  return { ...t, spawns, bookings, taskOf };
}

const shared = (id: string) => ({ "shared.txt": `${id}\n` });
const threeShared = [{ taskId: "a", targetPaths: ["shared.txt"] }, { taskId: "b", targetPaths: ["shared.txt"] }, { taskId: "d", targetPaths: ["shared.txt"] }];

describe("N1u: the other side of a conflict is every landed task it touches (spec §5.2 N1)", { timeout: 60_000 }, () => {
  it("answers both landed tasks, sorted by task id, where the two-sided rule escalated \"2\"; none still escalates \"0\"", async () => {
    // Runs are visited by run id (a random UUID). The answer must be sorted by task id, so the fixture is
    // retried until b's run id sorts before a's -- the one order in which an unsorted answer shows.
    for (let tries = 0; ; tries += 1) {
      const t = await harness([{ taskId: "a" }, { taskId: "b" }, { taskId: "d" }], (id) => ({ [id]: `${id}\n` }), { files: {} });
      try {
        const ids = [await t.claim(), await t.claim(), await t.claim()];
        const byTask = new Map(ids.map((id) => [t.taskOf(id), id]));
        if (!(byTask.get("b")! < byTask.get("a")!)) { if (tries < 15) continue; throw new Error("run ids never sorted b before a"); }
        await t.until(t.driver(), () => ids.every((id) => ["collected", ...LANDED].includes(t.body(id).state)));
        for (const id of [byTask.get("a")!, byTask.get("b")!]) if (t.body(id).state === "collected") await stepD(t.deps, id);
        expect([t.body(byTask.get("a")!).state, t.body(byTask.get("b")!).state].every((state) => LANDED.includes(state))).toBe(true);
        const d = readDriverRun(t.h.store, byTask.get("d")!);
        expect(await otherSideOfWeb(t.h.store, t.repo, d, ["a", "b"])).toEqual({ taskIds: ["a", "b"] });
        expect(await otherSideOfWeb(t.h.store, t.repo, d, ["b"])).toEqual({ taskIds: ["b"] });
        expect(await otherSideOfWeb(t.h.store, t.repo, d, ["base.txt"])).toEqual({ escalate: "0" });
        return;
      } finally { await t.h.dispose(); }
    }
  });
});

describe("three runs conflicting on one file (spec §5.2 N1, N2)", { timeout: 60_000 }, () => {
  it("lands all three with exactly two reconciliations, the second against both landed tasks", async () => {
    const t = await harness(threeShared, shared, { files: { "shared.txt": "a\nb\nd\n" } }); try {
      const ids = [await t.claim(), await t.claim(), await t.claim()];
      await untilDeadline(t.driver(), () => ids.every((id) => [...LANDED, "blocked"].includes(t.body(id).state)));
      expect(ids.map((id) => t.body(id).state).every((state) => LANDED.includes(state))).toBe(true);
      expect(t.spawns()).toHaveLength(2);
      const reconciled = ids.filter((id) => t.body(id).drive.reconcile !== null)
        .sort((x, y) => t.body(x).drive.reconcile.otherTaskIds.length - t.body(y).drive.reconcile.otherTaskIds.length);
      expect(reconciled).toHaveLength(2);
      const [once, twice] = reconciled.map((id) => ({ id, record: t.body(id).drive.reconcile, landed: t.body(id).drive.landedCommit }));
      const first = ids.find((id) => t.body(id).drive.reconcile === null)!;
      expect(once!.record).toMatchObject({ otherTaskIds: [t.taskOf(first)], otherTaskId: t.taskOf(first), spawnSeq: 1, outcome: "succeeded" });
      const both = [t.taskOf(first), t.taskOf(once!.id)].sort();
      expect(twice!.record).toMatchObject({ otherTaskIds: both, otherTaskId: both[0], spawnSeq: 1, outcome: "succeeded" });
      expect(git(t.repo, "log", "-1", "--format=%s", once!.landed)).toBe(`orca: land ${once!.id} (reconciled with ${t.taskOf(first)})`);
      expect(git(t.repo, "log", "-1", "--format=%s", twice!.landed)).toBe(`orca: land ${twice!.id} (reconciled with ${both.join(", ")})`);
      // Each task landed exactly once: no moved-tip reset re-landed anything (N2).
      expect(git(t.repo, "rev-list", "--first-parent", "--count", "main..refs/heads/orca/g")).toBe("3");
      expect(git(t.repo, "show", "refs/heads/orca/g:shared.txt")).toBe("a\nb\nd");
      // 10 tokens of work per task, 7 per reconciliation.
      expect(t.bookings()).toHaveLength(2);
      expect(readWebGroup(t.h.store, "g").used.tokens).toBe(44);
    } finally { await t.h.dispose(); }
  });

  it("N2: while one run of the group is reconciling, a sibling collected run does not land until the reconciliation has", async () => {
    const t = await harness([...threeShared.slice(0, 2), { taskId: "d" }], (id) => id === "d" ? { d: "d\n" } : shared(id), { files: { "shared.txt": "a\nb\n" }, holdMs: 5_000 }); try {
      const pair = [await t.claim(), await t.claim()];
      expect(pair.map(t.taskOf).sort()).toEqual(["a", "b"]);
      const driver = t.driver();
      await untilDeadline(driver, () => pair.some((id) => t.body(id).drive?.reconcile?.pid != null));
      const reconciling = pair.find((id) => t.body(id).state === "reconciling")!;
      // The driver armed the next start wake itself (replenishStartWakes); delivering it claims d.
      const delivered = await deliverScheduledStart(t.dispatch, "g");
      if (delivered.kind !== "claimed") throw new Error(`claim refused: ${JSON.stringify(delivered)}`);
      const sibling = delivered.runId;
      expect(t.taskOf(sibling)).toBe("d");
      await t.until(driver, () => t.body(sibling).state === "collected");
      const tip = git(t.repo, "rev-parse", "refs/heads/orca/g");
      for (let i = 0; i < 3; i += 1) await driver.round();
      expect(t.body(reconciling).state).toBe("reconciling");
      expect(t.body(sibling).state).toBe("collected");
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(tip);
      await untilDeadline(driver, () => [...pair, sibling].every((id) => LANDED.includes(t.body(id).state)));
      expect(t.spawns()).toHaveLength(1);
      expect(t.body(reconciling).drive.reconcile.spawnSeq).toBe(1);
      expect(git(t.repo, "rev-parse", `${t.body(sibling).drive.landedCommit}^1`)).toBe(t.body(reconciling).drive.landedCommit);
    } finally { await t.h.dispose(); }
  });
});

describe("a reconciliation reset by a moved tip and spawned again (spec §11 I7, §13.2 I-6)", { timeout: 60_000 }, () => {
  it("books both spawns on the group under two distinct keys", async () => {
    const t = await harness(threeShared.slice(0, 2), shared, { files: { "shared.txt": "a\nb\n" }, holdMs: 1_500 }); try {
      const ids = [await t.claim(), await t.claim()];
      const driver = t.driver();
      await untilDeadline(driver, () => ids.some((id) => t.body(id).drive?.reconcile?.pid != null));
      const runId = ids.find((id) => t.body(id).state === "reconciling")!;
      // A person moves orca/g while the reconciliation runs: its merge now has a stale first parent.
      git(t.repo, "checkout", "-q", "orca/g");
      await writeFile(`${t.repo}/person.txt`, "a person's own\n");
      git(t.repo, "add", "person.txt");
      git(t.repo, "commit", "-qm", "by hand");
      const moved = git(t.repo, "rev-parse", "HEAD");
      await untilDeadline(driver, () => ids.every((id) => [...LANDED, "blocked"].includes(t.body(id).state)));
      expect(ids.every((id) => LANDED.includes(t.body(id).state))).toBe(true);
      expect(t.spawns()).toHaveLength(2);
      expect(t.body(runId).drive.reconcile).toMatchObject({ spawnSeq: 2, outcome: "succeeded" });
      expect(git(t.repo, "rev-parse", `${t.body(runId).drive.landedCommit}^1`)).toBe(moved);
      // The second reconciliation ran on the moved tip: the person's commit survives the landing.
      expect(git(t.repo, "show", "refs/heads/orca/g:person.txt")).toBe("a person's own");
      await driver.round(); await driver.round();
      expect(t.bookings()).toEqual([`reconcile-usage:${runId}:spawn-1`, `reconcile-usage:${runId}:spawn-2`]);
      // 10 + 10 for the two tasks, 7 for each of the two reconciliation spawns.
      expect(readWebGroup(t.h.store, "g").used.tokens).toBe(34);
    } finally { await t.h.dispose(); }
  });
});

describe("the spawn key after a spawn that died unbooked (controller ruling D-SPAWNKEY, 2026-09-25)", { timeout: 60_000 }, () => {
  it("resumes above the largest booked spawn number, not the number of booked spawns", async () => {
    const t = await harness(threeShared.slice(0, 2), shared, { files: { "shared.txt": "a\nb\n" } }); try {
      const ids = [await t.claim(), await t.claim()];
      // Spawn 1 died without a terminal loop state, so it was never booked; spawn 2 was. A count of booked
      // spawns (1) would reuse the key spawn-2, and the booking dedup would swallow the new spawn's tokens.
      for (const id of ids) {
        t.h.store.db.prepare("INSERT INTO outbox(id,kind,body,delivered) VALUES (?,'reconcile-usage',?,1)")
          .run(`reconcile-usage:${id}:spawn-2`, JSON.stringify({ groupId: "g", runId: id, spawnKey: "spawn-2", tokens: 7 }));
      }
      await untilDeadline(t.driver(), () => ids.every((id) => [...LANDED, "blocked"].includes(t.body(id).state)));
      expect(ids.every((id) => LANDED.includes(t.body(id).state))).toBe(true);
      const runId = ids.find((id) => t.body(id).drive.reconcile !== null)!;
      expect(t.body(runId).drive.reconcile).toMatchObject({ spawnSeq: 3, outcome: "succeeded" });
      expect(t.bookings()).toContain(`reconcile-usage:${runId}:spawn-3`);
      // 10 + 10 for the two tasks, 7 for the one reconciliation spawn this driver made (the seeded rows book nothing).
      expect(readWebGroup(t.h.store, "g").used.tokens).toBe(27);
    } finally { await t.h.dispose(); }
  });
});
