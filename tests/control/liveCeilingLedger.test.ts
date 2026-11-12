// Tester follow-up G spec §2.1 (plan Part B, O2): a task run of a finite expectation-model group is claimed with no token
// grant and a live ceiling -- its slice of the group's remainder, or the task's pause line or a person's hard cap when
// lower -- and the ceiling's unused part is held in the group's reserve, so the sum of the running ceilings never passes
// what the group has left. Booked usage releases what it used; a run that ends releases the rest. A group created before
// the release claims exactly as before.
import { describe, expect, it } from "vitest";
import { readStartEnvelope } from "../../src/control/executionDriver.js";
import { runCeiling } from "../../src/control/liveCeiling.js";
import { readGroup } from "../../src/control/queries.js";
import { recordUsage } from "../../src/control/usage.js";
import { readWebGroup } from "../../src/control/webService.js";
import { driverHarness } from "./fixtures/driverHarness.js";

type Harness = Awaited<ReturnType<typeof driverHarness>>;
const M = 1_000_000;

async function finiteGroup(options: { expectation: boolean; limit?: number; tokenBudget?: number | null }): Promise<Harness> {
  const t = await driverHarness([{ taskId: "a", ...(options.tokenBudget === undefined ? {} : { tokenBudget: options.tokenBudget }) }], { tokenPolicy: "optional-v1", ...(options.expectation ? { modelVersion: "followup-g" as const } : {}) });
  if (options.limit !== undefined) {
    const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
    const set = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, tokens: options.limit } }));
    if ("error" in set) throw new Error(`set-limit refused: ${JSON.stringify(set)}`);
  }
  return t;
}
const reservedTokens = (t: Harness) => readGroup(t.h.store, "g").reserved.tokens;
async function prepared(t: Harness, driver: ReturnType<Harness["driver"]>, runId: string): Promise<void> {
  for (let i = 0; i < 400 && t.body(runId).drive?.prepared !== true; i++) await driver.round();
}

describe("runCeiling picks the binding bound (plan O2)", () => {
  it("the smallest bound, each less the task's earlier usage; ties go task-cap, pause-line, group", () => {
    expect(runCeiling({ groupSliceTokens: 4 * M, pauseLineTokens: 10 * M, hardCapTokens: null, inheritedTaskTokens: 0 })).toEqual({ tokens: 4 * M, cause: "group" });
    expect(runCeiling({ groupSliceTokens: 4 * M, pauseLineTokens: 3 * M, hardCapTokens: null, inheritedTaskTokens: M })).toEqual({ tokens: 2 * M, cause: "pause-line" });
    expect(runCeiling({ groupSliceTokens: null, pauseLineTokens: null, hardCapTokens: 2 * M, inheritedTaskTokens: M / 2 })).toEqual({ tokens: 1_500_000, cause: "task-cap" });
    expect(runCeiling({ groupSliceTokens: 2 * M, pauseLineTokens: 2 * M, hardCapTokens: null, inheritedTaskTokens: 0 })).toEqual({ tokens: 2 * M, cause: "pause-line" });
    expect(runCeiling({ groupSliceTokens: 2 * M, pauseLineTokens: 3 * M, hardCapTokens: 3 * M, inheritedTaskTokens: M })).toEqual({ tokens: 2 * M, cause: "task-cap" });
    expect(runCeiling({ groupSliceTokens: null, pauseLineTokens: null, hardCapTokens: null, inheritedTaskTokens: 0 })).toBeNull();
  });
});

describe("the ceiling a claim holds (spec §2.1)", { timeout: 120_000 }, () => {
  it("a claim in a finite expectation-model group reserves its ceiling and sends a null grant", async () => {
    const t = await finiteGroup({ expectation: true, limit: 20 * M });
    try {
      const before = reservedTokens(t);
      const runId = await t.claim();
      const run = t.body(runId);
      expect(run.grant.work.tokens).toBeNull();
      expect(run.liveCeiling).toMatchObject({ revision: 1, cause: "group", deliveredRevision: 0 });
      const ceiling = run.liveCeiling.tokens as number;
      expect(ceiling).toBeGreaterThan(0);
      // Exactly the ceiling (and the handoff grant, as before) moved into the reserve.
      expect(reservedTokens(t) - before).toBe(ceiling + run.grant.handoff.tokens);
      expect(readGroup(t.h.store, "g")).toMatchObject({ liveCeilingReserved: ceiling });
      // Nothing more than the group has left is held.
      const g = readGroup(t.h.store, "g");
      expect(g.used.tokens + g.reserved.tokens).toBeLessThanOrEqual(20 * M);
      // The start envelope carries it, so the run is bounded from its first token.
      const driver = t.driver();
      await prepared(t, driver, runId);
      const envelope = readStartEnvelope(t.h.store, t.body(runId));
      expect(envelope.protocol).toBe(4);
      expect(envelope.claim.grant.work.tokens).toBeNull();
      expect(envelope.liveCeiling).toEqual({ protocol: 1, revision: 1, tokens: ceiling, cause: "group" });
      expect(t.body(runId).liveCeiling.deliveredRevision).toBe(1);
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  it("booked usage releases the ceiling's reservation and the end of the run releases the rest", async () => {
    const t = await finiteGroup({ expectation: true, limit: 20 * M });
    try {
      const before = reservedTokens(t);
      const runId = await t.claim();
      const run = t.body(runId), ceiling = run.liveCeiling.tokens as number, handoff = run.grant.handoff.tokens as number;
      recordUsage(t.h.store, { runId, generation: 1, eventSeq: 1, bucket: "work", cumulative: { tokens: 300_000, activeMs: 1, attempts: 1, sessions: 1 }, source: { artifactId: "usage-1", hash: "a".repeat(64) } });
      expect(reservedTokens(t)).toBe(before + handoff + ceiling - 300_000);
      expect(readGroup(t.h.store, "g").used.tokens).toBe(300_000);
      expect(readGroup(t.h.store, "g")).toMatchObject({ liveCeilingReserved: ceiling - 300_000 });
      // A run that ends holds nothing of its ceiling.
      t.h.store.db.prepare("UPDATE runs SET active=0 WHERE id=?").run(runId);
      const driver = t.driver();
      await driver.round();
      await driver.stop();
      expect(readGroup(t.h.store, "g")).toMatchObject({ liveCeilingReserved: 0 });
      expect(reservedTokens(t)).toBe(before + handoff);
    } finally { await t.h.dispose(); }
  });

  it("a person's hard cap binds the ceiling, and a pause line binds when it is below the slice", async () => {
    const t = await finiteGroup({ expectation: true, limit: 20 * M });
    try {
      const work = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body));
      work.tokenIntent = { tokens: 400_000, hard: true, provenance: "human", estimateId: null };
      t.h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='a'").run(JSON.stringify(work));
      const runId = await t.claim();
      expect(t.body(runId).liveCeiling).toMatchObject({ tokens: 400_000, cause: "task-cap" });
    } finally { await t.h.dispose(); }
    const p = await finiteGroup({ expectation: true, limit: 100 * M });
    try {
      const work = JSON.parse(String(p.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body));
      work.tokenIntent = { tokens: 1_000_000, hard: false, provenance: "human", estimateId: null };
      p.h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='a'").run(JSON.stringify(work));
      const runId = await p.claim();
      // 10x the expectation is below both the slice and half the group limit.
      expect(p.body(runId).liveCeiling).toMatchObject({ tokens: 10 * M, cause: "pause-line" });
    } finally { await p.h.dispose(); }
  });

  it("a legacy finite group's claim is unchanged: a finite grant and no ceiling", async () => {
    const t = await finiteGroup({ expectation: false, limit: 20 * M });
    try {
      const runId = await t.claim();
      const run = t.body(runId);
      expect(run).not.toHaveProperty("liveCeiling");
      expect(run.grant.work.tokens).toBe(99_000);
      expect(readGroup(t.h.store, "g")).not.toHaveProperty("liveCeilingReserved");
      const driver = t.driver();
      await prepared(t, driver, runId);
      expect(readStartEnvelope(t.h.store, t.body(runId))).not.toHaveProperty("liveCeiling");
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  it("set-limit is not refused while ceiling-bounded runs are active; a legacy null-grant run still refuses it", async () => {
    const t = await finiteGroup({ expectation: true, limit: 20 * M });
    try {
      await t.claim();
      const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
      expect(t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, tokens: 30 * M } }))).toMatchObject({ result: { kind: "limit-set" } });
    } finally { await t.h.dispose(); }
    const legacy = await finiteGroup({ expectation: false, tokenBudget: null });
    try {
      await legacy.claim();
      const limit = readWebGroup(legacy.h.store, "g").ledger.groupLimit;
      expect(legacy.service.setLimit(legacy.h.command("set-limit", { limit: { ...limit, tokens: 30 * M } }))).toMatchObject({ error: { code: "active-unbounded-budget-conflict" } });
    } finally { await legacy.h.dispose(); }
  });
});
