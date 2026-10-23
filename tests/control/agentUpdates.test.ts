import { describe, expect, it } from "vitest";
import { rawAuthorityCommandSchema } from "../../src/control/webProtocol.js";
import { openTestStore, seedBudgetCase } from "./fixtures/store.js";
import { readAgentPreferences } from "../../src/control/agentPreferences.js";
import { applySetAgentPreferences } from "../../src/control/agentPreferences.js";
import { applyAgentUpdate, hasPendingAgentUpdate, pendingAgentUpdateCommand, reconcilePendingAgentUpdates } from "../../src/control/agentUpdates.js";
import { lookupCommandResult } from "../../src/control/commandLedger.js";
import type { AgentApplyRequest, AgentReceipt } from "../../src/control/agentInstallationProtocol.js";
import type { ExecutionPort } from "../../src/control/executionPort.js";
import { ControlError } from "../../src/control/errors.js";
import { withCommandContext } from "../../src/control/commandClient.js";
import { sha256Canonical } from "../../src/control/canonicalJson.js";
import { openControlStore } from "../../src/control/store.js";
import { join } from "node:path";
import { rm } from "node:fs/promises";

const hash = "a".repeat(64);
const command = (commandId = "update-1", expectedRevision = 0) => ({
  schema: "orca-raw-command-v1", commandId, expectedRevision, actorId: "human",
  verb: "apply-agent-update", target: { kind: "operator", operatorId: "human" },
  payload: { previewId: "preview-1", baseTableHash: hash, acceptedChangeIds: ["change-1"] },
});

describe("reviewed installation updates", () => {
  it("accepts only an explicit preview and accepted changes in the command wire", () => {
    expect(rawAuthorityCommandSchema.safeParse(command()).success).toBe(true);
    expect(rawAuthorityCommandSchema.safeParse({ ...command(), payload: { ...command().payload, tablePath: "/tmp/other" } }).success).toBe(false);
    expect(rawAuthorityCommandSchema.safeParse({ ...command(), payload: { ...command().payload, acceptedChangeIds: [] } }).success).toBe(false);
  });

  it("keeps installation revision independent of frozen operator preferences", async () => {
    const h = await openTestStore();
    try {
      expect(readAgentPreferences(h.store, "human")).toEqual({ preferences: { perAgent: {} }, revision: 0 });
      expect(h.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_update_state'").get()).toBeDefined();
    } finally { await h.dispose(); }
  });

  it("reserves identity before dispatch and finalizes only a matching receipt", async () => {
    const h = await openTestStore();
    const requests: AgentApplyRequest[] = [];
    const receipt = (request: AgentApplyRequest): AgentReceipt => ({
      schema: "orca-agent-detection-receipt-v1", opId: request.opId, requestDigest: request.requestDigest,
      previewId: request.previewId, acceptedChangeIds: request.acceptedChangeIds,
      beforeHash: hash, afterHash: "b".repeat(64),
      before: { schema: "ccloop-agents-table-v1", installations: {} },
      after: { schema: "ccloop-agents-table-v1", installations: { codex: { version: "new" } } },
    });
    const port = { applyAgentInstallations: async (request: AgentApplyRequest) => { requests.push(request); return receipt(request); } } as ExecutionPort;
    try {
      await expect(applyAgentUpdate({ store: h.store, port }, command() as never, { client: "web", principal: "user:owner" }, () => { throw new Error("simulated process death"); }))
        .rejects.toThrow("simulated process death");
      expect(h.store.db.prepare("SELECT state FROM agent_update_outbox WHERE operator_id='human'").get()).toEqual({ state: "pending" });
      expect(lookupCommandResult(h.store, "@operator:human", "update-1")).toBeNull();
      await reconcilePendingAgentUpdates(h.store, port);
      expect(requests).toHaveLength(2);
      expect(requests[1]).toEqual(requests[0]);
      expect(lookupCommandResult(h.store, "@operator:human", "update-1")).toMatchObject({ originalStatus: 200, body: { commandRevision: 1, result: { kind: "agent-installations-updated", beforeHash: hash, afterHash: "b".repeat(64) } } });
      expect(readAgentPreferences(h.store, "human")).toEqual({ preferences: { perAgent: {} }, revision: 0 });
    } finally { await h.dispose(); }
  });
  it("books a stale peer refusal and releases the pending operator slot without moving preferences", async () => {
    const h = await openTestStore();
    const port = { applyAgentInstallations: async () => { throw new ControlError("agent-installation-update-stale"); } } as unknown as ExecutionPort;
    try {
      const answer = await applyAgentUpdate({ store: h.store, port }, command() as never, { client: "web", principal: "user:owner" });
      expect(answer).toMatchObject({ status: 409, body: { error: { code: "agent-installation-update-stale", commandRevision: 0, retryable: false } } });
      expect(h.store.db.prepare("SELECT state FROM agent_update_outbox WHERE operator_id='human'").get()).toEqual({ state: "complete" });
      expect(readAgentPreferences(h.store, "human").revision).toBe(0);
    } finally { await h.dispose(); }
  });
  it("retains the exact command for an owner to retry after an unknown peer outcome", async () => {
    const h = await openTestStore();
    let calls = 0;
    const port = { applyAgentInstallations: async () => { calls += 1; throw new ControlError("control-peer-timeout"); } } as unknown as ExecutionPort;
    try {
      await expect(applyAgentUpdate({ store: h.store, port }, command() as never, { client: "web", principal: "user:owner" }))
        .rejects.toMatchObject({ code: "control-peer-timeout" });
      expect(pendingAgentUpdateCommand(h.store, "human")).toEqual(command());
      await expect(applyAgentUpdate({ store: h.store, port }, command("second") as never, { client: "web", principal: "user:owner" }))
        .rejects.toMatchObject({ code: "agent-installation-update-pending" });
      expect(calls).toBe(1);
    } finally { await h.dispose(); }
  });
  it("keeps original client and principal on a direct same-ID success retry without ambient context", async () => {
    const h = await openTestStore();
    const unknown = { applyAgentInstallations: async () => { throw new ControlError("control-peer-timeout"); } } as unknown as ExecutionPort;
    const seen: AgentApplyRequest[] = [];
    const receipt = { applyAgentInstallations: async (request: AgentApplyRequest) => {
      seen.push(request);
      return { schema: "orca-agent-detection-receipt-v1", opId: request.opId, requestDigest: request.requestDigest,
        previewId: request.previewId, acceptedChangeIds: request.acceptedChangeIds, beforeHash: request.baseTableHash, afterHash: "b".repeat(64),
        before: { schema: "ccloop-agents-table-v1", installations: {} }, after: { schema: "ccloop-agents-table-v1", installations: {} } };
    } } as ExecutionPort;
    try {
      await expect(applyAgentUpdate({ store: h.store, port: unknown }, command() as never, { client: "web", principal: "user:first-owner" }))
        .rejects.toMatchObject({ code: "control-peer-timeout" });
      const result = await applyAgentUpdate({ store: h.store, port: receipt }, command() as never, { client: "web", principal: "user:second-owner" });
      expect(result.status).toBe(200);
      expect(seen).toMatchObject([{ opId: "update-1" }]);
      expect(h.store.db.prepare("SELECT client,principal FROM commands WHERE group_id='@operator:human' AND id='update-1'").get())
        .toEqual({ client: "web", principal: "user:first-owner" });
    } finally { await h.dispose(); }
  });

  it("keeps original client and principal on a manual stale refusal retried by another owner", async () => {
    const h = await openTestStore();
    const unknown = { applyAgentInstallations: async () => { throw new ControlError("control-peer-timeout"); } } as unknown as ExecutionPort;
    const stale = { applyAgentInstallations: async () => { throw new ControlError("agent-installation-update-stale"); } } as unknown as ExecutionPort;
    try {
      await expect(applyAgentUpdate({ store: h.store, port: unknown }, command() as never, { client: "web", principal: "user:first-owner" }))
        .rejects.toMatchObject({ code: "control-peer-timeout" });
      const result = await withCommandContext("update-1", { client: "web", principal: "user:second-owner" }, () =>
        applyAgentUpdate({ store: h.store, port: stale }, command() as never, { client: "web", principal: "user:second-owner" }));
      expect(result).toMatchObject({ status: 409, body: { error: { code: "agent-installation-update-stale" } } });
      expect(h.store.db.prepare("SELECT client,principal FROM commands WHERE group_id='@operator:human' AND id='update-1'").get())
        .toEqual({ client: "web", principal: "user:first-owner" });
    } finally { await h.dispose(); }
  });
  it("holds a pending operator command ID against a different verb until its receipt is reconciled", async () => {
    const h = await openTestStore();
    const port = { applyAgentInstallations: async () => { throw new ControlError("control-peer-timeout"); } } as unknown as ExecutionPort;
    try {
      await expect(applyAgentUpdate({ store: h.store, port }, command() as never, { client: "web", principal: "user:owner" }))
        .rejects.toMatchObject({ code: "control-peer-timeout" });
      await expect(applyAgentUpdate({ store: h.store, port }, { ...command(), payload: { ...command().payload, acceptedChangeIds: ["change-2"] } } as never,
        { client: "web", principal: "user:owner" })).rejects.toMatchObject({ code: "command-id-conflict" });
      expect(() => applySetAgentPreferences({ store: h.store }, { schema: "orca-raw-command-v1", commandId: "update-1", expectedRevision: 0,
        actorId: "human", verb: "set-agent-preferences", target: { kind: "operator", operatorId: "human" },
        payload: { preferences: { defaultAgent: "codex", perAgent: {} } } })).toThrow("command-id-conflict");
      expect(readAgentPreferences(h.store, "human")).toEqual({ preferences: { perAgent: {} }, revision: 0 });
      expect(lookupCommandResult(h.store, "@operator:human", "update-1")).toBeNull();
      expect(pendingAgentUpdateCommand(h.store, "human")?.commandId).toBe("update-1");
    } finally { await h.dispose(); }
  });
  it("does not close an outbox against a completed ledger row with a different raw identity", async () => {
    const h = await openTestStore();
    const port = { applyAgentInstallations: async () => { throw new ControlError("control-peer-timeout"); } } as unknown as ExecutionPort;
    try {
      await expect(applyAgentUpdate({ store: h.store, port }, command() as never, { client: "web", principal: "user:owner" }))
        .rejects.toMatchObject({ code: "control-peer-timeout" });
      h.store.db.prepare("INSERT INTO commands(group_id,id,payload_hash,result,raw_request_hash,verb,original_status,body_json) VALUES (?,?,?,?,?,?,?,?)")
        .run("@operator:human", "update-1", "foreign", "{}", "b".repeat(64), "set-agent-preferences", 200, "{}");
      await expect(reconcilePendingAgentUpdates(h.store, port)).rejects.toMatchObject({ code: "recovery-blocked", detail: "agent-update-ledger-identity-mismatch" });
      expect(h.store.db.prepare("SELECT state FROM agent_update_outbox WHERE operator_id='human'").get()).toEqual({ state: "pending" });
    } finally { await h.dispose(); }
  });
  it("does not close an outbox against a malformed completed ledger outcome", async () => {
    const h = await openTestStore();
    const port = { applyAgentInstallations: async () => { throw new ControlError("control-peer-timeout"); } } as unknown as ExecutionPort;
    try {
      await expect(applyAgentUpdate({ store: h.store, port }, command() as never, { client: "web", principal: "user:owner" }))
        .rejects.toMatchObject({ code: "control-peer-timeout" });
      h.store.db.prepare("INSERT INTO commands(group_id,id,payload_hash,result,raw_request_hash,verb,original_status,body_json) VALUES (?,?,?,?,?,?,?,?)")
        .run("@operator:human", "update-1", "bad-body", "{}", sha256Canonical(command()), "apply-agent-update", 200, "{}");
      await expect(reconcilePendingAgentUpdates(h.store, port)).rejects.toMatchObject({ code: "control-command-result-invalid" });
      expect(h.store.db.prepare("SELECT state FROM agent_update_outbox WHERE operator_id='human'").get()).toEqual({ state: "pending" });
    } finally { await h.dispose(); }
  });
  it("refuses an old peer before reserving an update operation", async () => {
    const h = await openTestStore();
    const port = { readFeatures: async () => ({ protocol: 1 as const }), applyAgentInstallations: async () => { throw new ControlError("control-agent-update-unsupported"); } } as unknown as ExecutionPort;
    try {
      await expect(applyAgentUpdate({ store: h.store, port }, command() as never, { client: "web", principal: "user:owner" }))
        .resolves.toMatchObject({ status: 422, body: { error: { code: "control-agent-update-unsupported", commandRevision: 0 } } });
      expect(hasPendingAgentUpdate(h.store, "human")).toBe(false);
      expect(readAgentPreferences(h.store, "human").revision).toBe(0);
    } finally { await h.dispose(); }
  });
  it("reloads a receipt-before-SQLite crash without minting a new operation", async () => {
    const h = await openTestStore();
    const seen: AgentApplyRequest[] = [];
    const port = { applyAgentInstallations: async (request: AgentApplyRequest) => {
      seen.push(request);
      return { schema: "orca-agent-detection-receipt-v1", opId: request.opId, requestDigest: request.requestDigest,
        previewId: request.previewId, acceptedChangeIds: request.acceptedChangeIds, beforeHash: request.baseTableHash, afterHash: "b".repeat(64),
        before: { schema: "ccloop-agents-table-v1", installations: {} }, after: { schema: "ccloop-agents-table-v1", installations: {} } };
    } } as ExecutionPort;
    try {
      await expect(applyAgentUpdate({ store: h.store, port }, command() as never, { client: "web", principal: "user:owner" }, () => { throw new Error("crash-after-receipt"); }))
        .rejects.toThrow("crash-after-receipt");
      h.store.close();
      const reopened = await openControlStore({ stateDir: join(h.root, "state") });
      try {
        expect(pendingAgentUpdateCommand(reopened, "human")?.commandId).toBe("update-1");
        await reconcilePendingAgentUpdates(reopened, port);
        expect(seen).toHaveLength(2);
        expect(seen[1]).toEqual(seen[0]);
        expect(reopened.db.prepare("SELECT revision FROM agent_update_state WHERE operator_id='human'").get()).toEqual({ revision: 1 });
        expect(lookupCommandResult(reopened, "@operator:human", "update-1")?.originalStatus).toBe(200);
        expect(reopened.db.prepare("SELECT client,principal FROM commands WHERE group_id='@operator:human' AND id='update-1'").get())
          .toEqual({ client: "web", principal: "user:owner" });
      } finally { reopened.close(); }
    } finally { await rm(h.root, { recursive: true, force: true }); }
  });
  it("retains the original client and owner on a stale refusal finalized after restart", async () => {
    const h = await openTestStore();
    const timeoutPort = { applyAgentInstallations: async () => { throw new ControlError("control-peer-timeout"); } } as unknown as ExecutionPort;
    try {
      await expect(applyAgentUpdate({ store: h.store, port: timeoutPort }, command() as never, { client: "web", principal: "user:owner" }))
        .rejects.toMatchObject({ code: "control-peer-timeout" });
      h.store.close();
      const reopened = await openControlStore({ stateDir: join(h.root, "state") });
      try {
        const stalePort = { applyAgentInstallations: async () => { throw new ControlError("agent-installation-update-stale"); } } as unknown as ExecutionPort;
        await reconcilePendingAgentUpdates(reopened, stalePort);
        expect(lookupCommandResult(reopened, "@operator:human", "update-1")).toMatchObject({ originalStatus: 409, body: { error: { code: "agent-installation-update-stale" } } });
        expect(reopened.db.prepare("SELECT client,principal FROM commands WHERE group_id='@operator:human' AND id='update-1'").get())
          .toEqual({ client: "web", principal: "user:owner" });
      } finally { reopened.close(); }
    } finally { await rm(h.root, { recursive: true, force: true }); }
  });
  it("refuses a receipt with a different operation digest and keeps the outbox pending", async () => {
    const h = await openTestStore();
    const port = { applyAgentInstallations: async (request: AgentApplyRequest) => ({
      schema: "orca-agent-detection-receipt-v1", opId: request.opId, requestDigest: "b".repeat(64),
      previewId: request.previewId, acceptedChangeIds: request.acceptedChangeIds, beforeHash: request.baseTableHash, afterHash: "c".repeat(64),
      before: { schema: "ccloop-agents-table-v1", installations: {} }, after: { schema: "ccloop-agents-table-v1", installations: {} },
    }) } as ExecutionPort;
    try {
      await expect(applyAgentUpdate({ store: h.store, port }, command() as never, { client: "web", principal: "user:owner" }))
        .rejects.toMatchObject({ code: "control-response-invalid" });
      expect(pendingAgentUpdateCommand(h.store, "human")?.commandId).toBe("update-1");
      expect(lookupCommandResult(h.store, "@operator:human", "update-1")).toBeNull();
    } finally { await h.dispose(); }
  });
  it("does not rewrite a group's frozen work items or preference document after a table receipt", async () => {
    const h = await openTestStore();
    seedBudgetCase(h.store);
    const beforeGroups = h.store.db.prepare("SELECT id,body FROM groups ORDER BY id").all();
    const beforeWork = h.store.db.prepare("SELECT group_id,id,body FROM work_items ORDER BY group_id,id").all();
    const prefs = readAgentPreferences(h.store, "human");
    const port = { applyAgentInstallations: async (request: AgentApplyRequest) => ({
      schema: "orca-agent-detection-receipt-v1", opId: request.opId, requestDigest: request.requestDigest,
      previewId: request.previewId, acceptedChangeIds: request.acceptedChangeIds, beforeHash: request.baseTableHash, afterHash: "b".repeat(64),
      before: { schema: "ccloop-agents-table-v1", installations: {} }, after: { schema: "ccloop-agents-table-v1", installations: {} },
    }) } as ExecutionPort;
    try {
      expect((await applyAgentUpdate({ store: h.store, port }, command() as never, { client: "web", principal: "user:owner" })).status).toBe(200);
      expect(h.store.db.prepare("SELECT id,body FROM groups ORDER BY id").all()).toEqual(beforeGroups);
      expect(h.store.db.prepare("SELECT group_id,id,body FROM work_items ORDER BY group_id,id").all()).toEqual(beforeWork);
      expect(readAgentPreferences(h.store, "human")).toEqual(prefs);
    } finally { await h.dispose(); }
  });
  it.each(["11", "12"])("migrates schema %s to 13 without changing old command or preference bytes", async (from) => {
    const h = await openTestStore();
    const root = h.root;
    const stateDir = join(root, "state");
    h.store.db.prepare("INSERT INTO agent_preferences(operator_id,revision,doc_json) VALUES ('human',1,'{\"perAgent\":{}}')").run();
    h.store.db.prepare("INSERT INTO commands(group_id,id,payload_hash,result) VALUES ('@operator:human','older','a','{\"old\":true}')").run();
    const prefs = h.store.db.prepare("SELECT revision,doc_json FROM agent_preferences WHERE operator_id='human'").get();
    const old = h.store.db.prepare("SELECT payload_hash,result FROM commands WHERE id='older'").get();
    h.store.db.exec("DROP TABLE agent_update_outbox; DROP TABLE agent_update_state");
    h.store.db.prepare("UPDATE meta SET value=? WHERE key='schemaVersion'").run(from);
    h.store.close();
    const reopened = await openControlStore({ stateDir });
    try {
      expect(reopened.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()).toEqual({ value: "19" });
      expect(reopened.db.prepare("SELECT revision,doc_json FROM agent_preferences WHERE operator_id='human'").get()).toEqual(prefs);
      expect(reopened.db.prepare("SELECT payload_hash,result FROM commands WHERE id='older'").get()).toEqual(old);
      expect(reopened.db.prepare("SELECT name FROM sqlite_master WHERE name='agent_update_outbox'").get()).toBeDefined();
    } finally { reopened.close(); await rm(root, { recursive: true, force: true }); }
  });
});
