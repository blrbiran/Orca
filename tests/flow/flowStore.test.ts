import { describe, expect, it } from "vitest";
import {
  appendExecution, appendFlowDecision, appendMessage, getExecutionState, getFlowRun, getHead, insertFlowRun, putEffect, putPlan, setEffectState,
  setExecutionState, setHead, upsertTemplateIndex, type ExecutionRow, type MessageInput,
} from "../../src/flow/store.js";
import { openTestStore } from "../control/fixtures/store.js";

/**
 * Flow engine spec §6.1 (plan Task 4): the journal's rules are the store's, not each caller's -- executions and
 * messages are never rewritten, states only move forward, a message is deduped by its request id, and the step head
 * (the one mutable pointer, the run's undo/rewind) moves only from the value the mover read. Temp stores only.
 */
async function world() {
  const h = await openTestStore();
  h.store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES ('g',0,1,'{}')").run();
  insertFlowRun(h.store, {
    id: "fr-1", groupId: "g", templateRef: "builtin/wechat-article@1", templateSha256: "a".repeat(64), workspace: { projectId: "articles", kind: "dir" },
    vaultId: "v-1", paramsSha256: "b".repeat(64), poolTokens: 2_000_000, poolDrawn: 0, state: "running", revision: 0, body: { note: "fixture" },
  });
  return h;
}

const execution = (seq: number, over: Partial<ExecutionRow> = {}): ExecutionRow => ({
  flowRunId: "fr-1", stepKey: "draft", seq, kind: "draft", kindVersion: 1, state: "queued", definitionHash: "d".repeat(64), baseCommit: null, ranOn: null,
  fingerprint: null, outputKind: null, outputRef: null, outputHash: null, readSetHash: null, reasons: ["first-run"], planNo: null, childGroupId: null,
  by: "orca-auto", via: "orca", createdAt: 1, updatedAt: 1, body: {}, ...over,
});

const message = (requestId: string, over: Partial<MessageInput> = {}): MessageInput => ({
  flowRunId: "fr-1", requestId, kind: "feedback", target: "step", body: { stepKey: "draft", text: "shorter" }, by: "ann", via: "web", state: "accepted", reason: null, at: 5, ...over,
});

describe("flow journal store (spec §6.1)", () => {
  it("round-trips a flow run", async () => {
    const h = await world(); try {
      expect(getFlowRun(h.store, "fr-1")).toMatchObject({ groupId: "g", workspace: { projectId: "articles", kind: "dir" }, poolTokens: 2_000_000, body: { note: "fixture" } });
      expect(getFlowRun(h.store, "nope")).toBeNull();
    } finally { await h.dispose(); }
  });

  it("executions are append-only and their state moves forward only, from the state the mover read", async () => {
    const h = await world(); try {
      appendExecution(h.store, execution(1));
      expect(() => appendExecution(h.store, execution(1, { kind: "check" }))).toThrow(/UNIQUE|PRIMARY/);
      const key = { flowRunId: "fr-1", stepKey: "draft", seq: 1 };
      setExecutionState(h.store, key, "queued", "running", 2);
      // Backwards: running -> queued, and out of a final state.
      expect(() => setExecutionState(h.store, key, "running", "queued", 3)).toThrow("flow-execution-backwards");
      setExecutionState(h.store, key, "running", "done", 4);
      expect(() => setExecutionState(h.store, key, "done", "running", 5)).toThrow("flow-execution-backwards");
      // Stale: the mover read `running`, the row is `done` now.
      expect(() => setExecutionState(h.store, key, "running", "failed", 6)).toThrow("flow-execution-stale");
      expect(getExecutionState(h.store, key)).toBe("done");
      // The schema refuses a state outside §6.1's list and a seq of 0.
      expect(() => appendExecution(h.store, execution(2, { state: "paused" as never }))).toThrow(/CHECK/);
      expect(() => appendExecution(h.store, execution(0))).toThrow(/CHECK/);
    } finally { await h.dispose(); }
  });

  it("a message sent twice with one request id is stored once, and the second send answers the first row", async () => {
    const h = await world(); try {
      const first = appendMessage(h.store, message("req-1"));
      const again = appendMessage(h.store, message("req-1", { body: { stepKey: "draft", text: "different text" }, at: 9 }));
      expect(first).toMatchObject({ deduped: false, row: { seq: 1 } });
      expect(again).toEqual({ deduped: true, row: first.row });
      expect(appendMessage(h.store, message("req-2")).row.seq).toBe(2);
      expect(h.store.db.prepare("SELECT COUNT(*) AS n FROM flow_messages").get()!.n).toBe(2);
    } finally { await h.dispose(); }
  });

  it("the step head moves only by compare-and-swap on active_seq", async () => {
    const h = await world(); try {
      setHead(h.store, "fr-1", "draft", null, 1);
      expect(() => setHead(h.store, "fr-1", "draft", null, 2)).toThrow("flow-head-stale");
      setHead(h.store, "fr-1", "draft", 1, 2);
      // A mover that read 1 lost the race: refused, and the head stays where the winner put it.
      expect(() => setHead(h.store, "fr-1", "draft", 1, 3)).toThrow("flow-head-stale");
      expect(getHead(h.store, "fr-1", "draft")).toBe(2);
      expect(getHead(h.store, "fr-1", "other")).toBeNull();
    } finally { await h.dispose(); }
  });

  it("an effect record changes only its state, forward", async () => {
    const h = await world(); try {
      putEffect(h.store, { id: "e-1", flowRunId: "fr-1", stepKey: "publish", seq: 1, effectKind: "wechat-draft", class: "external-reversible", level: "confirm-before",
        policy: { value: "confirm-before", source: "builtin", lockedBy: null }, state: "staged", payloadHash: "c".repeat(64), remoteRef: null, by: "orca-auto", via: "orca", createdAt: 1, updatedAt: 1 });
      expect(() => setEffectState(h.store, "e-1", "staged", "applied", 2)).toThrow("flow-effect-backwards");
      setEffectState(h.store, "e-1", "staged", "confirmed", 2);
      setEffectState(h.store, "e-1", "confirmed", "applied", 3, "media-123");
      expect(() => setEffectState(h.store, "e-1", "applied", "discarded", 4)).toThrow("flow-effect-backwards");
      expect(() => setEffectState(h.store, "e-1", "confirmed", "failed", 4)).toThrow("flow-effect-stale");
      expect(h.store.db.prepare("SELECT state, remote_ref FROM effect_records WHERE id='e-1'").get()).toEqual({ state: "applied", remote_ref: "media-123" });
    } finally { await h.dispose(); }
  });

  it("plans upsert by number; decisions number per run; the template index upserts by (layer, id, version)", async () => {
    const h = await world(); try {
      putPlan(h.store, { flowRunId: "fr-1", planNo: 1, state: "proposed", candidates: [{ stepKey: "draft" }], proposal: null, chosen: null, by: "orca-auto", via: "orca" });
      putPlan(h.store, { flowRunId: "fr-1", planNo: 1, state: "chosen", candidates: [{ stepKey: "draft" }], proposal: null, chosen: ["draft"], by: "ann", via: "web" });
      expect(h.store.db.prepare("SELECT state, chosen, \"by\" FROM rerun_plans").all()).toEqual([{ state: "chosen", chosen: '["draft"]', by: "ann" }]);
      expect(appendFlowDecision(h.store, { flowRunId: "fr-1", grade: "major", stepKey: "draft", body: { question: "q" }, by: "orca-auto" })).toBe(1);
      expect(appendFlowDecision(h.store, { flowRunId: "fr-1", grade: "minor", stepKey: "draft", body: { question: "r" }, by: "orca-auto" })).toBe(2);
      upsertTemplateIndex(h.store, { layer: "builtin", id: "wechat-article", version: 1, sha256: "1".repeat(64), path: "flows/builtin/wechat-article", publishedBy: "orca", publishedAt: 1 });
      upsertTemplateIndex(h.store, { layer: "builtin", id: "wechat-article", version: 1, sha256: "2".repeat(64), path: "flows/builtin/wechat-article", publishedBy: "orca", publishedAt: 2 });
      expect(h.store.db.prepare("SELECT sha256 FROM flow_templates").all()).toEqual([{ sha256: "2".repeat(64) }]);
    } finally { await h.dispose(); }
  });
});
