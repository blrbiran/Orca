import { describe, expect, it } from "vitest";
import { applyPanelShutdown } from "../../src/panel/controlLifecycle.js";
import { WebControlService } from "../../src/control/webService.js";
import type { AgentApplyRequest } from "../../src/control/agentInstallationProtocol.js";
import type { ExecutionPort } from "../../src/control/executionPort.js";
import { webFixture } from "./fixtures/web.js";

const hash = "a".repeat(64);
const preview = {
  schema: "orca-agent-detection-preview-v1" as const, previewId: "preview-1", baseTableHash: hash, observedAt: "2026-10-11T00:00:00.000Z", installed: [],
  changes: [{ changeId: "change-1", kind: "version" as const, installationId: "codex", command: ["/tmp/fake"], realpath: "/tmp/fake", version: "2" }],
};
const command = (id: string, expectedRevision: number) => ({
  schema: "orca-raw-command-v1" as const, commandId: id, expectedRevision, actorId: "human", verb: "apply-agent-update" as const,
  target: { kind: "operator" as const, operatorId: "human" }, payload: { previewId: preview.previewId, baseTableHash: preview.baseTableHash, acceptedChangeIds: ["change-1"] },
});

describe("installation update shutdown admission", () => {
  it("holds shutdown until the peer receipt is finalized and refuses new apply after drain", async () => {
    const f = await webFixture();
    let entered!: () => void, release!: () => void;
    const atPeer = new Promise<void>((resolve) => { entered = resolve; });
    const held = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    const port = f.deps.port as ExecutionPort;
    port.previewAgentInstallations = async () => preview;
    port.applyAgentInstallations = async (request: AgentApplyRequest) => {
      calls += 1; entered(); await held;
      return { schema: "orca-agent-detection-receipt-v1", opId: request.opId, requestDigest: request.requestDigest,
        previewId: request.previewId, acceptedChangeIds: request.acceptedChangeIds, beforeHash: request.baseTableHash, afterHash: "b".repeat(64),
        before: { schema: "ccloop-agents-table-v1", installations: {} }, after: { schema: "ccloop-agents-table-v1", installations: {} } };
    };
    const service = new WebControlService(f.deps);
    let updating: Promise<unknown> | null = null, shutting: Promise<unknown> | null = null;
    try {
      await service.previewAgentUpdates();
      updating = service.applyAgentUpdate(command("update-1", 0), { client: "web", principal: "user:owner" });
      await atPeer;
      let shutdownFinished = false;
      shutting = applyPanelShutdown({ store: f.store, profileRouter: f.deps.profileRouter, admissionGate: f.deps.admissionGate,
        epoch: "agent-update-shutdown", shutdownGraceMs: 1_000 }).then(() => { shutdownFinished = true; });
      await new Promise((resolve) => setTimeout(resolve, 15));
      expect(shutdownFinished).toBe(false);
      release();
      await expect(updating).resolves.toMatchObject({ result: { kind: "agent-installations-updated", revision: 1 } });
      await shutting;
      await expect(service.applyAgentUpdate(command("update-2", 1), { client: "web", principal: "user:owner" }))
        .rejects.toMatchObject({ code: "panel-draining" });
      expect(calls).toBe(1);
      expect(f.store.db.prepare("SELECT command_id FROM agent_update_outbox WHERE operator_id='human' ORDER BY command_id").all())
        .toEqual([{ command_id: "update-1" }]);
    } finally { release(); await updating?.catch(() => undefined); await shutting?.catch(() => undefined); await f.dispose(); }
  });
});
