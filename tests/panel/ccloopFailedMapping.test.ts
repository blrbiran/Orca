import { describe, expect, it } from "vitest";
import { ControlError } from "../../src/control/errors.js";
import type { ExecutionPort } from "../../src/control/executionPort.js";
import { WebControlService } from "../../src/control/webService.js";
import { sendMappedControlError } from "../../src/panel/controlErrors.js";
import { webFixture } from "../control/fixtures/web.js";

// ccloop error codes spec (2026-10-15) §4.2, criterion 1: a peer exit is a definite failure -- the web files a status under
// 500 as a refusal and stops looking the command up -- so it must carry ccloop's code and detail and stay retryable.
// Plan correction K2: apply-agent-update is the one command whose ccloop call runs after it reserved durable state.
const recorder = () => {
  const r = { statusCode: 0, body: undefined as unknown, status(code: number) { r.statusCode = code; return r; }, json(body: unknown) { r.body = body; return r; } };
  return r;
};
const mapped = (error: unknown) => { const r = recorder(); sendMappedControlError(r as never, error); return { status: r.statusCode, body: r.body }; };

describe("a peer exit over HTTP (spec A §4.2)", () => {
  it("maps a peer exit to 424 ccloop-failed with ccloop's code and detail, and one with no code as unknown", () => {
    expect(mapped(new ControlError("control-peer-exit", "2:agent-config-invalid: bad table"))).toEqual({ status: 424,
      body: { error: { code: "ccloop-failed", message: "ccloop-failed:agent-config-invalid: bad table", commandRevision: null, evidenceIds: [], retryable: true } } });
    expect(mapped(new ControlError("control-peer-exit"))).toEqual({ status: 424,
      body: { error: { code: "ccloop-failed", message: "ccloop-failed:unknown", commandRevision: null, evidenceIds: [], retryable: true } } });
    // Unchanged (spec A §3): a peer timeout and anything that is not a ControlError stay retryable internal errors.
    expect([mapped(new ControlError("control-peer-timeout")).status, mapped(new Error("boom")).status]).toEqual([500, 500]);
  });

  it("keeps an apply-agent-update whose ccloop exited after the outbox reserved it an unknown outcome (500), its operation pending", async () => {
    const h = await webFixture(); try {
      const port = {
        ...(h.deps.port as unknown as Record<string, unknown>),
        previewAgentInstallations: async () => ({ schema: "orca-agent-detection-preview-v1", previewId: "preview-1", baseTableHash: "a".repeat(64),
          observedAt: "2026-10-15T00:00:00.000Z", installed: [], changes: [{ changeId: "change-1" }] }),
        applyAgentInstallations: async () => { throw new ControlError("control-peer-exit", "2:agent-installation-apply-failed: disk full"); },
      } as unknown as ExecutionPort;
      const service = new WebControlService({ ...h.deps, port });
      await service.previewAgentUpdates();
      const command = { schema: "orca-raw-command-v1", commandId: "update-1", expectedRevision: 0, actorId: "human", verb: "apply-agent-update",
        target: { kind: "operator", operatorId: "human" }, payload: { previewId: "preview-1", baseTableHash: "a".repeat(64), acceptedChangeIds: ["change-1"] } } as never;
      const failure = await service.applyAgentUpdate(command, { client: "web", principal: "user:owner" }).then(() => null, (error: unknown) => error);
      expect(mapped(failure).status).toBe(500);
      expect(h.store.db.prepare("SELECT state FROM agent_update_outbox WHERE operator_id='human'").get()).toEqual({ state: "pending" });
    } finally { await h.dispose(); }
  });
});
