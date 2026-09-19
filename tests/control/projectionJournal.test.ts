import { describe, expect, it } from "vitest";
import { createGroup, hashPayload } from "../../src/control/commands.js";
import { claimWork } from "../../src/control/budget.js";
import { startClaim } from "../../src/control/dispatch.js";
import {
  projectionJournalRetention,
  readProjectionChanges,
  readProjectionState,
  recordProjectionChange,
} from "../../src/control/projectionJournal.js";
import { getRun, readGroup, readVersions, saveGroup } from "../../src/control/queries.js";
import type { GroupInput } from "../../src/control/types.js";
import { openTestStore, seedBudgetCase } from "./fixtures/store.js";
import { fakePeer } from "./fixtures/peer.js";

const group: GroupInput = {groupId:"g1",projectKey:"example/repo",goal:"Ship",successConditions:["checks pass"],limit:{tokens:100,activeMs:10000,attempts:10,sessions:10},reviewReserve:{tokens:10,activeMs:1000,attempts:1,sessions:1},deadlineAt:null};

describe("projection journal", () => {
  it("increments authority and projection independently and only once per transaction", async () => {
    const h = await openTestStore();
    try {
      createGroup(h.store, group, { commandId: "create", expectedRevision: 0, by: "human" });
      expect(readVersions(h.store, "g1")).toEqual({ commandRevision: 1, projectionSeq: 1 });
      expect(readProjectionState(h.store)).toEqual({ changeSeq: 1, oldestRetainedSeq: 1 });

      h.store.transaction(() => {
        const record = readGroup(h.store, "g1");
        record.status = "blocked";
        saveGroup(h.store, record);
        saveGroup(h.store, record);
        recordProjectionChange(h.store, ["g1", "g1"]);
      });

      expect(readVersions(h.store, "g1")).toEqual({ commandRevision: 1, projectionSeq: 2 });
      expect(readProjectionState(h.store).changeSeq).toBe(2);
      expect(readProjectionChanges(h.store, 1)).toEqual({
        changeSeq: 2,
        resetRequired: false,
        groups: [{ groupId: "g1", projectionSeq: 2 }],
      });
    } finally {
      await h.dispose();
    }
  });

  it("increments global change once for a multi-group transaction", async () => {
    const h = await openTestStore();
    try {
      createGroup(h.store, group, { commandId: "create", expectedRevision: 0, by: "human" });
      createGroup(h.store, { ...group, groupId: "g2" }, { commandId: "create", expectedRevision: 0, by: "human" });
      const before = readProjectionState(h.store).changeSeq;
      h.store.transaction(() => recordProjectionChange(h.store, ["g2", "g1", "g2"]));
      expect(readProjectionState(h.store).changeSeq).toBe(before + 1);
      expect(readProjectionChanges(h.store, before).groups).toEqual([
        { groupId: "g1", projectionSeq: 2 },
        { groupId: "g2", projectionSeq: 2 },
      ]);
    } finally {
      await h.dispose();
    }
  });

  it("retains a bounded invalidation window and reports old sequence gaps", async () => {
    const h = await openTestStore();
    try {
      createGroup(h.store, group, { commandId: "create", expectedRevision: 0, by: "human" });
      for (let index = 0; index <= projectionJournalRetention; index += 1) recordProjectionChange(h.store, ["g1"]);
      const state = readProjectionState(h.store);
      expect(state.oldestRetainedSeq).toBeGreaterThan(1);
      expect(readProjectionChanges(h.store, 0).resetRequired).toBe(true);
      expect(readProjectionChanges(h.store, state.oldestRetainedSeq - 1).resetRequired).toBe(false);
      expect(readProjectionChanges(h.store, state.changeSeq + 1).resetRequired).toBe(true);
    } finally {
      await h.dispose();
    }
  });

  it("rolls back global and group sequence overflow", async () => {
    const h = await openTestStore();
    try {
      createGroup(h.store, group, { commandId: "create", expectedRevision: 0, by: "human" });
      h.store.db.prepare("UPDATE projection_state SET change_seq=? WHERE singleton=1").run(Number.MAX_SAFE_INTEGER);
      expect(() => recordProjectionChange(h.store, ["g1"])).toThrow("control-sequence-overflow");
      expect(readVersions(h.store, "g1").projectionSeq).toBe(1);
      expect(readProjectionState(h.store).changeSeq).toBe(Number.MAX_SAFE_INTEGER);

      h.store.db.prepare("UPDATE projection_state SET change_seq=1 WHERE singleton=1").run();
      h.store.db.prepare("UPDATE groups SET projection_seq=? WHERE id='g1'").run(Number.MAX_SAFE_INTEGER);
      expect(() => recordProjectionChange(h.store, ["g1"])).toThrow("control-sequence-overflow");
      expect(readProjectionState(h.store).changeSeq).toBe(1);
    } finally {
      await h.dispose();
    }
  });

  it("projects claim, starting, and accepted run/work transitions once per transaction", async () => {
    const h = await openTestStore();
    try {
      const seeded = seedBudgetCase(h.store);
      const beforeClaim = readVersions(h.store, "g1");
      const claim = claimWork(h.store, seeded.t1Claim);
      expect(readVersions(h.store, "g1")).toEqual({ commandRevision: beforeClaim.commandRevision, projectionSeq: beforeClaim.projectionSeq + 1 });

      const beforeStart = readVersions(h.store, "g1");
      await startClaim(h.store, fakePeer(`${h.root}/accepted-peer`), {
        protocol: 1,
        claim,
        contractHash: hashPayload(seeded.w1.contract),
        inputCheckpoint: null,
        work: { contract: seeded.w1.contract, targetRepo: h.root, base: "HEAD", sourceDir: h.root },
      });
      expect(getRun(h.store, claim.runId).state).toBe("accepted");
      expect(readVersions(h.store, "g1")).toEqual({ commandRevision: beforeStart.commandRevision, projectionSeq: beforeStart.projectionSeq + 2 });
    } finally {
      await h.dispose();
    }
  });

  it("projects starting and unknown run transitions without changing authority", async () => {
    const h = await openTestStore();
    try {
      const seeded = seedBudgetCase(h.store);
      const claim = claimWork(h.store, seeded.t1Claim);
      const before = readVersions(h.store, "g1");
      await expect(startClaim(h.store, fakePeer(`${h.root}/unknown-peer`, "drop"), {
        protocol: 1,
        claim,
        contractHash: hashPayload(seeded.w1.contract),
        inputCheckpoint: null,
        work: { contract: seeded.w1.contract, targetRepo: h.root, base: "HEAD", sourceDir: h.root },
      })).rejects.toThrow("start-outcome-unknown");
      expect(getRun(h.store, claim.runId).state).toBe("unknown");
      expect(readVersions(h.store, "g1")).toEqual({ commandRevision: before.commandRevision, projectionSeq: before.projectionSeq + 2 });
    } finally {
      await h.dispose();
    }
  });
});
