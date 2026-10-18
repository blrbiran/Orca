import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openControlStore, type ControlStore } from "../../src/control/store.js";
import { insertPendingDecisions, listPendingDecisions, readPendingDecision, settlePendingDecision } from "../../src/control/pendingDecisions.js";
import { pendingIdOf, type PendingEntry } from "../../src/control/runLedger.js";

const entry = (ledgerRun: string, entryIndex: number, reason = "first"): PendingEntry => ({
  pendingId: pendingIdOf(ledgerRun, entryIndex), ledgerRun, entryIndex, entry: { kind: "x", n: entryIndex }, reason, at: "2026-10-18T00:00:00.000Z", evidence: ["run r1"],
});

describe("pending decisions store", () => {
  let root: string, store: ControlStore;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "pd-"));
    store = await openControlStore({ stateDir: join(root, "s") });
    store.transaction(() => {
      store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES ('g',1,1,'{}')").run();
      store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES ('r1','g','a',1,0,'{}'),('r2','g','b',1,0,'{}')").run();
    });
  });
  afterEach(async () => { store.close(); await rm(root, { recursive: true, force: true }); });

  it("keeps the first body when the same ids are inserted again", () => {
    store.transaction(() => insertPendingDecisions(store, "g", "r1", [entry("r1", 0), entry("r1", 1)]));
    store.transaction(() => insertPendingDecisions(store, "g", "r1", [entry("r1", 0, "second"), entry("r1", 1, "second")]));
    const rows = listPendingDecisions(store, "g");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.entry.reason)).toEqual(["first", "first"]);
    expect(rows[0]).toMatchObject({ pendingId: "pending-r1-0", groupId: "g", runId: "r1", state: "pending", approvedId: null, correctionId: null });
  });

  it("orders by run, ledger run, then entry index", () => {
    store.transaction(() => insertPendingDecisions(store, "g", "r2", [entry("r2", 0)]));
    store.transaction(() => insertPendingDecisions(store, "g", "r1", [entry("reconcile-r1", 0), entry("r1", 10), entry("r1", 2)]));
    expect(listPendingDecisions(store, "g").map((r) => r.pendingId)).toEqual(["pending-r1-2", "pending-r1-10", "pending-reconcile-r1-0", "pending-r2-0"]);
  });

  it("settles to approved or rejected and reads the outcome back", () => {
    store.transaction(() => insertPendingDecisions(store, "g", "r1", [entry("r1", 0), entry("r1", 1)]));
    settlePendingDecision(store, "pending-r1-0", { state: "approved", approvedId: "r1/agent-0" });
    settlePendingDecision(store, "pending-r1-1", { state: "rejected", correctionId: "c-1" });
    expect(readPendingDecision(store, "pending-r1-0")).toMatchObject({ state: "approved", approvedId: "r1/agent-0", correctionId: null });
    expect(readPendingDecision(store, "pending-r1-1")).toMatchObject({ state: "rejected", approvedId: null, correctionId: "c-1" });
    expect(readPendingDecision(store, "pending-r1-0")!.entry.reason).toBe("first");
  });

  it("returns null for an unknown id and refuses to settle one", () => {
    expect(readPendingDecision(store, "nope")).toBeNull();
    expect(() => settlePendingDecision(store, "nope", { state: "approved", approvedId: "x" })).toThrow();
  });

  it("refuses a duplicate (ledger_run, entry_index) under a different id", () => {
    store.transaction(() => insertPendingDecisions(store, "g", "r1", [entry("r1", 0)]));
    expect(() => store.db.prepare("INSERT INTO pending_decisions(id,group_id,run_id,ledger_run,entry_index,state,body) VALUES ('other','g','r1','r1',0,'pending','{}')").run()).toThrow();
  });
});
