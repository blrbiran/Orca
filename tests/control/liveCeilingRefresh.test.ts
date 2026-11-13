// Tester follow-up G spec §2.1 (plan Part B, O3, review focus 1 and 3): while a finite expectation-model group has free
// headroom and no task waiting to be claimed, its running runs' ceilings grow by an equal share of it -- written (and so
// reserved) before ccloop is told, so a failed or interrupted delivery holds the reservation and the next pass delivers
// it. While a task is claimable the headroom is left for its claim. A pause line or hard cap still caps a raise. Over any
// interleaving of claims, bookings, raises, top-ups and ends, the group never holds more than its remainder.
import { describe, expect, it } from "vitest";
import { ceilingOutstanding } from "../../src/control/liveCeiling.js";
import { planCeilingRaises, raiseCeilings } from "../../src/control/liveCeilingRaise.js";
import { readGroup } from "../../src/control/queries.js";
import { recordUsage } from "../../src/control/usage.js";
import { readWebGroup } from "../../src/control/webService.js";
import type { ExecutionPort } from "../../src/control/executionPort.js";
import { ControlError } from "../../src/control/errors.js";
import { driverHarness } from "./fixtures/driverHarness.js";

type Harness = Awaited<ReturnType<typeof driverHarness>>;
const M = 1_000_000;

async function harness(tasks: string[], limit: number, setLiveCeiling?: ExecutionPort["setLiveCeiling"]): Promise<Harness> {
  const t = await driverHarness(tasks.map(taskId => ({ taskId })), { tokenPolicy: "optional-v1", modelVersion: "followup-g", behaviour: () => "stoppable", ...(setLiveCeiling ? { setLiveCeiling } : {}) });
  setLimit(t, limit);
  return t;
}
function setLimit(t: Harness, tokens: number): void {
  const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
  const set = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, tokens } }));
  if ("error" in set) throw new Error(`set-limit refused: ${JSON.stringify(set)}`);
}
function headroom(t: Harness): number {
  const g = readGroup(t.h.store, "g");
  return g.limit.tokens! - g.used.tokens - g.reserved.tokens;
}
async function accepted(t: Harness, driver: ReturnType<Harness["driver"]>, runId: string): Promise<void> {
  for (let i = 0; i < 400 && t.body(runId).state !== "accepted"; i++) await driver.round();
  expect(t.body(runId).state).toBe("accepted");
}
const setIntent = (t: Harness, taskId: string, intent: unknown) => {
  const work = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body));
  work.tokenIntent = intent;
  t.h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id=?").run(JSON.stringify(work), taskId);
};

describe("raising running ceilings from free headroom (spec §2.1, plan O3)", { timeout: 300_000 }, () => {
  it("a lone running task gets the whole free headroom, reserved before it is delivered", async () => {
    const calls: Array<{ revision: number; tokens: number }> = [];
    let fail = true;
    const t = await harness(["a"], 20 * M, async (_input, ceiling) => {
      calls.push({ revision: ceiling.revision, tokens: ceiling.tokens });
      if (fail) throw new Error("ccloop down");
      return { revision: ceiling.revision, tokens: ceiling.tokens };
    });
    try {
      const driver = t.driver();
      const runId = await t.claim();
      await accepted(t, driver, runId);
      const first = t.body(runId).liveCeiling.tokens as number;
      setLimit(t, 30 * M);
      expect(headroom(t)).toBe(10 * M);
      await driver.round();
      // Written and reserved although ccloop refused the delivery: the group holds it, the run keeps the older one at ccloop.
      expect(t.body(runId).liveCeiling).toMatchObject({ revision: 2, tokens: first + 10 * M, cause: "group", deliveredRevision: 1 });
      expect(headroom(t)).toBe(0);
      expect(calls).toEqual([{ revision: 2, tokens: first + 10 * M }]);
      fail = false;
      await driver.round();
      expect(t.body(runId).liveCeiling.deliveredRevision).toBe(2);
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  it("headroom is left for a claimable task", async () => {
    const t = await harness(["a", "b"], 20 * M);
    try {
      await t.claim();
      expect(headroom(t)).toBeGreaterThan(0);
      expect(planCeilingRaises(t.h.store, "g", Date.now())).toEqual([]);
    } finally { await t.h.dispose(); }
  });

  it("an undelivered raise is redelivered after a restart and the ledger is unchanged", async () => {
    let fail = true;
    const t = await harness(["a"], 20 * M, async (_input, ceiling) => { if (fail) throw new Error("crashed before the call"); return { revision: ceiling.revision, tokens: ceiling.tokens }; });
    try {
      const driver = t.driver();
      const runId = await t.claim();
      await accepted(t, driver, runId);
      setLimit(t, 25 * M);
      await driver.round();
      await driver.stop();
      expect(t.body(runId).liveCeiling).toMatchObject({ revision: 2, deliveredRevision: 1 });
      const ledger = JSON.stringify(readGroup(t.h.store, "g").reserved);
      fail = false;
      const restarted = t.driver();
      await restarted.round();
      await restarted.stop();
      expect(t.body(runId).liveCeiling).toMatchObject({ revision: 2, deliveredRevision: 2 });
      expect(JSON.stringify(readGroup(t.h.store, "g").reserved)).toBe(ledger);
    } finally { await t.h.dispose(); }
  });

  it("a stale refusal counts as delivered: ccloop already holds that revision", async () => {
    const t = await harness(["a"], 20 * M, async () => { throw new ControlError("control-peer-exit", "2:control-live-ceiling-stale"); });
    try {
      const driver = t.driver();
      const runId = await t.claim();
      await accepted(t, driver, runId);
      setLimit(t, 25 * M);
      await driver.round();
      expect(t.body(runId).liveCeiling).toMatchObject({ revision: 2, deliveredRevision: 2 });
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  it("a blocked run takes no raise and no share: the running one gets all the headroom (tester follow-up K)", async () => {
    // blockRun leaves the run active=1 with its group ceiling; it is waiting on a person, not working, so a share given
    // to it would sit reserved and unused while the run that is working is starved of it.
    const t = await harness(["a", "b"], 20 * M);
    try {
      const first = await t.claim(), second = await t.claim();
      const blocked = t.body(second);
      blocked.state = "blocked";
      blocked.drive = { ...blocked.drive, blockedAt: "C", blockedReason: "test: waiting on a person" };
      t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(blocked), second);
      expect(t.h.store.db.prepare("SELECT active FROM runs WHERE id=?").get(second)!.active).toBe(1);
      const running = t.body(first).liveCeiling;
      expect(running.cause).toBe("group");
      setLimit(t, readGroup(t.h.store, "g").limit.tokens! + 8 * M);
      const free = headroom(t);
      expect(free).toBeGreaterThan(0);
      const raises = planCeilingRaises(t.h.store, "g", Date.now());
      expect(raises.map(raise => raise.runId)).toEqual([first]);
      expect(raises[0]).toMatchObject({ tokens: running.tokens + free, cause: "group", revision: running.revision + 1 });
    } finally { await t.h.dispose(); }
  });

  it("a pause line caps a raise and only what is given is reserved", async () => {
    const t = await harness(["a", "b"], 20 * M);
    try {
      setIntent(t, "a", { tokens: M, hard: false, provenance: "human", estimateId: null });
      const first = await t.claim(), second = await t.claim();
      const [ra, rb] = [first, second].map(id => t.body(id)).sort((x, y) => (x.taskId < y.taskId ? -1 : 1));
      expect(ra.liveCeiling.cause).toBe("group");
      expect(ra.liveCeiling.tokens).toBeLessThan(10 * M);
      setLimit(t, 28 * M);
      const before = readGroup(t.h.store, "g").reserved.tokens;
      t.h.store.transaction(() => raiseCeilings(t.h.store, Date.now()));
      const a = t.body(ra.runId), b = t.body(rb.runId);
      // 8M of headroom, 4M each: a's line (10 x 1M) caps it below that; b takes its 4M.
      expect(a.liveCeiling).toMatchObject({ tokens: 10 * M, cause: "pause-line", revision: 2 });
      expect(b.liveCeiling).toMatchObject({ tokens: rb.liveCeiling.tokens + 4 * M, cause: "group", revision: 2 });
      expect(readGroup(t.h.store, "g").reserved.tokens - before).toBe((10 * M - ra.liveCeiling.tokens) + 4 * M);
    } finally { await t.h.dispose(); }
  });

  it("three parallel runs never hold more ceiling than the group's remainder", async () => {
    for (const seed of [1, 7, 42, 99, 1234, 2024]) {
      // mulberry32: an LCG's low bits cycle with a short period, which would replay one fixed order of operations.
      let state = seed >>> 0;
      const random = (n: number): number => {
        state = (state + 0x6d2b79f5) >>> 0;
        let x = Math.imul(state ^ (state >>> 15), 1 | state);
        x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
        return ((x ^ (x >>> 14)) >>> 0) % n;
      };
      const t = await harness(["a", "b", "c"], 12 * M);
      try {
        const runs = [await t.claim(), await t.claim(), await t.claim()];
        const seq = new Map(runs.map(id => [id, 0]));
        const check = (step: string) => {
          const g = readGroup(t.h.store, "g");
          let outstanding = 0;
          for (const id of runs) if (t.h.store.db.prepare("SELECT active FROM runs WHERE id=?").get(id)!.active === 1) outstanding += ceilingOutstanding(t.body(id));
          expect(g.used.tokens + g.reserved.tokens, `seed ${seed} ${step}`).toBeLessThanOrEqual(g.limit.tokens!);
          expect(g.used.tokens + outstanding, `seed ${seed} ${step}`).toBeLessThanOrEqual(g.limit.tokens!);
        };
        check("claimed");
        for (let step = 0; step < 24; step++) {
          const op = random(4), id = runs[random(3)]!;
          const active = t.h.store.db.prepare("SELECT active FROM runs WHERE id=?").get(id)!.active === 1;
          if (op === 0 && active) {
            // ccloop books at most its ceiling (the per-run overshoot is ccloop's bound, outside this ledger property).
            const run = t.body(id), used = run.cumulative.work.tokens as number, room = Math.max(0, run.liveCeiling.tokens - used);
            const next = used + random(room + 1);
            seq.set(id, seq.get(id)! + 1);
            recordUsage(t.h.store, { runId: id, generation: 1, eventSeq: seq.get(id)!, bucket: "work", cumulative: { tokens: next, activeMs: 1, attempts: 1, sessions: 1 }, source: { artifactId: `u-${id}-${seq.get(id)}`, hash: "a".repeat(64) } });
          } else if (op === 1) t.h.store.transaction(() => raiseCeilings(t.h.store, Date.now()));
          else if (op === 2 && active) t.h.store.transaction(() => { t.h.store.db.prepare("UPDATE runs SET active=0 WHERE id=?").run(id); });
          else if (op === 3) setLimit(t, readGroup(t.h.store, "g").limit.tokens! + random(3) * M + 1);
          check(`step ${step} op ${op}`);
        }
      } finally { await t.h.dispose(); }
    }
  });
});
