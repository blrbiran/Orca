import { describe, expect, it } from "vitest";
import { openTestStore } from "./fixtures/store.js";
import { webFixture } from "./fixtures/web.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { ACTIVITY_KINDS, ACTIVITY_RETENTION, latestGroupActivityAt, readGroupActivity, readRunActivity, recordActivity, type ActivityRow } from "../../src/control/activity.js";
import { createGroup } from "../../src/control/commands.js";
import { readProjectionState, recordProjectionChange } from "../../src/control/projectionJournal.js";
import type { ControlStore } from "../../src/control/store.js";
import { applyWebCommand, type WebCommandContext } from "../../src/control/commandLedger.js";
import { ControlError } from "../../src/control/errors.js";
import { activityKindSchema, type EffectiveAuthorityCommandV1, type RawAuthorityCommandV1 } from "../../src/control/webProtocol.js";

// Issue-fixes spec §5 (ruling H5): Orca's own wall-clock record. Every time it writes comes from the store's clock,
// which tests inject so a criterion can name the exact instant a row or a run time must carry.
describe("the control store's clock (issue-fixes spec §5.2)", () => {
  it("answers the injected clock, and Date.now when none is given", async () => {
    let clock = 1_234;
    const fixed = await openTestStore({ now: () => clock });
    const plain = await openTestStore();
    try {
      expect(fixed.store.now()).toBe(1_234);
      clock = 5_678;
      expect(fixed.store.now()).toBe(5_678);
      const before = Date.now();
      const read = plain.store.now();
      expect(read).toBeGreaterThanOrEqual(before);
      expect(read).toBeLessThanOrEqual(Date.now());
    } finally { await fixed.dispose(); await plain.dispose(); }
  });

  it("reaches the store through the Web fixture and the driver harness", async () => {
    const h = await webFixture(undefined, undefined, { storeNow: () => 42 });
    try { expect(h.store.now()).toBe(42); } finally { await h.dispose(); }
    const t = await driverHarness([{ taskId: "a" }], { storeNow: () => 7 });
    try { expect(t.h.store.now()).toBe(7); } finally { await t.h.dispose(); }
  });
});

function seedGroup(store: ControlStore, groupId: string): void {
  createGroup(store, { groupId, projectKey: "example/repo", goal: "Ship", successConditions: ["checks pass"], limit: { tokens: 100, activeMs: 10000, attempts: 10, sessions: 10 },
    reviewReserve: { tokens: 10, activeMs: 1000, attempts: 1, sessions: 1 }, deadlineAt: null }, { commandId: "create", expectedRevision: 0, by: "human" });
}
const projectionSeq = (store: ControlStore, groupId: string): number => Number(store.db.prepare("SELECT projection_seq FROM groups WHERE id=?").get(groupId)!.projection_seq);
const rowCount = (store: ControlStore): number => Number(store.db.prepare("SELECT COUNT(*) AS n FROM activity").get()!.n);
const phase = (groupId: string, i: number): ActivityRow => ({ groupId, taskId: "t1", runId: "r1", kind: "phase", body: { step: "planning", attempt: i } });

describe("recordActivity (issue-fixes spec §5.2)", () => {
  it("writes one row stamped with the store's clock and moves the group's projection once, so the open view refreshes", async () => {
    let clock = 10;
    const h = await openTestStore({ now: () => clock });
    try {
      seedGroup(h.store, "g1");
      const before = projectionSeq(h.store, "g1"), change = readProjectionState(h.store).changeSeq;
      clock = 20;
      h.store.transaction(() => recordActivity(h.store, phase("g1", 1)));
      expect(readGroupActivity(h.store, "g1", 10)).toEqual([
        { seq: expect.any(Number), groupId: "g1", taskId: "t1", runId: "r1", at: 20, kind: "phase", body: { step: "planning", attempt: 1 } },
      ]);
      expect(projectionSeq(h.store, "g1")).toBe(before + 1);
      expect(readProjectionState(h.store).changeSeq).toBe(change + 1);
    } finally { await h.dispose(); }
  });

  // §5.2 "Change notification": a change that recorded its own projection change is not advanced a second time.
  it("never moves projection_seq twice in one transaction: not after the site's own change, not for a second row", async () => {
    const h = await openTestStore();
    try {
      seedGroup(h.store, "g1");
      const before = projectionSeq(h.store, "g1"), change = readProjectionState(h.store).changeSeq;
      h.store.transaction(() => { recordProjectionChange(h.store, ["g1"]); recordActivity(h.store, phase("g1", 1)); recordActivity(h.store, phase("g1", 2)); });
      expect(rowCount(h.store)).toBe(2);
      expect(projectionSeq(h.store, "g1")).toBe(before + 1);
      expect(readProjectionState(h.store).changeSeq).toBe(change + 1);
    } finally { await h.dispose(); }
  });

  // §5.3: a rolled-back change writes no row; no caller can write one outside its change's transaction.
  it("refuses to write outside a transaction, and a rolled-back transaction leaves no row and no projection move", async () => {
    const h = await openTestStore();
    try {
      seedGroup(h.store, "g1");
      const before = projectionSeq(h.store, "g1");
      expect(() => recordActivity(h.store, phase("g1", 1))).toThrow("control-projection-transaction-missing");
      expect(() => h.store.transaction(() => { recordActivity(h.store, phase("g1", 2)); throw new Error("rolled back"); })).toThrow("rolled back");
      expect(rowCount(h.store)).toBe(0);
      expect(projectionSeq(h.store, "g1")).toBe(before);
    } finally { await h.dispose(); }
  });

  // §5.2 Retention: the newest 500 of a group, and never another group's rows (g2's are the oldest in the table).
  it("keeps exactly a group's newest 500 rows and never touches another group's", async () => {
    const h = await openTestStore();
    try {
      seedGroup(h.store, "g1"); seedGroup(h.store, "g2");
      expect(ACTIVITY_RETENTION).toBe(500);
      h.store.transaction(() => {
        for (let i = 0; i < 3; i += 1) recordActivity(h.store, { groupId: "g2", kind: "stop", body: { i } });
        for (let i = 0; i < 505; i += 1) recordActivity(h.store, { groupId: "g1", kind: "stop", body: { i } });
      });
      expect(readGroupActivity(h.store, "g1", 1_000).map((entry) => entry.body.i)).toEqual(Array.from({ length: 500 }, (_, k) => 504 - k));
      expect(readGroupActivity(h.store, "g2", 1_000).map((entry) => entry.body.i)).toEqual([2, 1, 0]);
    } finally { await h.dispose(); }
  });

  // §5.2 Reads: newest first by seq; a run's rows only; the group's newest row is by seq, not by the largest time.
  it("reads newest first by seq, filters a run's rows, and answers the newest row's time even when the clock went back", async () => {
    let clock = 50;
    const h = await openTestStore({ now: () => clock });
    try {
      seedGroup(h.store, "g1"); seedGroup(h.store, "g2");
      h.store.transaction(() => recordActivity(h.store, { groupId: "g1", runId: "r1", kind: "run-claimed", body: { claimOrdinal: 1 } }));
      clock = 10;
      h.store.transaction(() => recordActivity(h.store, { groupId: "g1", runId: "r2", kind: "run-claimed", body: { claimOrdinal: 1 } }));
      clock = 30;
      h.store.transaction(() => recordActivity(h.store, { groupId: "g1", runId: "r1", kind: "run-started", body: { providerAttemptOrdinal: 1 } }));
      expect(readRunActivity(h.store, "r1", 10).map((entry) => [entry.kind, entry.at])).toEqual([["run-started", 30], ["run-claimed", 50]]);
      expect(readGroupActivity(h.store, "g1", 2).map((entry) => entry.at)).toEqual([30, 10]);
      expect(latestGroupActivityAt(h.store, "g1")).toBe(30);
      expect(latestGroupActivityAt(h.store, "g2")).toBeNull();
      expect(() => readGroupActivity(h.store, "g1", 0)).toThrow("query-invalid");
    } finally { await h.dispose(); }
  });
});

/** As schema8.test.ts: a handoff-stop on g1 whose apply only answers (or refuses with a durable domain error). */
function handoffStop(store: ControlStore, commandId: string, expectedRevision: number, refuse = false) {
  const command: RawAuthorityCommandV1 = { schema: "orca-raw-command-v1", commandId, expectedRevision, actorId: "panel-operator", verb: "handoff-stop", target: { kind: "group", groupId: "g1" }, payload: {} };
  return applyWebCommand(store, {
    rawCommand: command,
    expand: () => ({ ...command, schema: "orca-authority-command-v1", payload: { handoffDeadlineAt: "2026-09-20T10:00:00.000Z" } }) as EffectiveAuthorityCommandV1,
    apply: (context: WebCommandContext) => {
      if (refuse) throw new ControlError("stop-already-active");
      return { status: 202, body: {
        schema: "orca-command-success-v1", commandId, actorId: command.actorId, verb: command.verb, target: command.target,
        commandRevision: context.nextCommandRevision, projectionSeq: context.nextProjectionSeq,
        effectivePayloadHash: context.effectivePayloadHash, authorityCommandHash: context.authorityCommandHash,
        result: { kind: "handoff-stopped", stopRevision: context.nextCommandRevision, acceptedAt: "2026-09-20T10:00:00.000Z", handoffDeadlineAt: "2026-09-20T10:00:00.000Z", frozenRunIds: [], requestIds: [] },
      } } as never;
    },
  });
}

describe("command rows (issue-fixes spec §5.2)", () => {
  it("an accepted group command writes one row; its replay, a stale one and a refused one write none", async () => {
    let clock = 100;
    const h = await openTestStore({ now: () => clock }); try {
      seedGroup(h.store, "g1");
      clock = 200;
      const first = handoffStop(h.store, "c1", 1);
      const rows = () => readGroupActivity(h.store, "g1", 10).map((entry) => [entry.kind, entry.at, entry.taskId, entry.runId, entry.body]);
      expect(rows()).toEqual([["command", 200, null, null, { verb: "handoff-stop", actor: "panel-operator" }]]);
      // The row did not move the group past the projectionSeq the success body promised (assertFinalVersions).
      expect(projectionSeq(h.store, "g1")).toBe((first.body as { projectionSeq: number }).projectionSeq);
      clock = 300;
      expect(handoffStop(h.store, "c1", 1)).toEqual(first);
      expect(handoffStop(h.store, "c-stale", 1).status).toBe(409);
      expect(handoffStop(h.store, "c-refused", 2, true).status).toBe(409);
      expect(rows()).toHaveLength(1);
    } finally { await h.dispose(); }
  });
});

describe("the wire's activity kinds (issue-fixes spec §5.2)", () => {
  it("are exactly the kinds the writer knows", () => {
    expect([...activityKindSchema.options].sort()).toEqual([...ACTIVITY_KINDS].sort());
  });
});
