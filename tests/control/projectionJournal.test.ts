import { describe, expect, it } from "vitest";
import { createGroup } from "../../src/control/commands.js";
import {
  projectionJournalRetention,
  readProjectionChanges,
  readProjectionState,
  recordProjectionChange,
} from "../../src/control/projectionJournal.js";
import { readGroup, readVersions, saveGroup } from "../../src/control/queries.js";
import type { GroupInput } from "../../src/control/types.js";
import { openTestStore } from "./fixtures/store.js";

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
});
