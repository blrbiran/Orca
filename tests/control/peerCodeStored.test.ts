import { describe, expect, it } from "vitest";
import { applyAgentUpdate } from "../../src/control/agentUpdates.js";
import { resolveGroupSelections } from "../../src/control/agentFreeze.js";
import { ControlError } from "../../src/control/errors.js";
import type { ExecutionPort } from "../../src/control/executionPort.js";
import { estimatorSlotFor } from "../../src/control/planImport.js";
import { WebControlService } from "../../src/control/webService.js";
import { readSelectionPreview } from "../../src/panel/controlViews.js";
import { webFixture } from "./fixtures/web.js";

// ccloop error codes spec (2026-10-15) §4.3, criteria 3 and 4: where Orca reduces a ccloop failure to a code it keeps
// ccloop's code, so the estimator, the preview and the installation panel say why -- while the choice between "refused"
// and "try again" still reads Orca's own classification of the error, so a transient exit is never frozen as a refusal.
const CATALOG = () => new ControlError("control-peer-exit", "2:omp-model-catalog-unavailable: spawn ENOENT");
const open = { schema: "orca-raw-command-v1", commandId: "open-r", actorId: "human", expectedRevision: 0, verb: "requirement-open", target: { kind: "group", groupId: "r" },
  payload: { groupId: "r", repoId: "repo", idea: "Let people export their notes as Markdown." } } as never;
const apply = { schema: "orca-raw-command-v1", commandId: "update-1", expectedRevision: 0, actorId: "human", verb: "apply-agent-update",
  target: { kind: "operator", operatorId: "human" }, payload: { previewId: "preview-1", baseTableHash: "a".repeat(64), acceptedChangeIds: ["change-1"] } } as never;
const observation = { schema: "orca-agent-detection-observation-v1", baseTableHash: "a".repeat(64), observedAt: "2026-10-15T00:00:00.000Z", installed: [] };

describe("stored codes keep ccloop's code (spec A §4.3)", () => {
  it("F1: the profile probe, every estimator slot built on it and requirement-open name ccloop's code", async () => {
    const h = await webFixture(); try {
      h.resolveAgent.mockImplementation(async () => { throw CATALOG(); });
      expect((await h.deps.profileRouter.probe(h.frozen, { agent: "codex" })).probeFailureCode).toBe("omp-model-catalog-unavailable");
      expect((await estimatorSlotFor({ store: h.store, profileRouter: h.deps.profileRouter }, "human", {}, h.frozen)).outcome)
        .toMatchObject({ kind: "rejected", code: "omp-model-catalog-unavailable" });
      const service = new WebControlService({ ...h.deps, knownRepository: (id: string) => id === "repo" });
      expect(await service.openRequirement(open)).toMatchObject({ error: { code: "agent-selection-rejected", message: "agent-selection-rejected:estimator:omp-model-catalog-unavailable" } });
      h.resolveAgent.mockImplementation(async () => { throw new ControlError("control-peer-exit", "1:Error: lost"); });
      expect((await h.deps.profileRouter.probe(h.frozen, { agent: "codex" })).probeFailureCode).toBe("control-peer-exit");
    } finally { await h.dispose(); }
  });

  it("F2: a transient peer exit in a preview is still unavailable and carries ccloop's code; confirm still rethrows it", async () => {
    const h = await webFixture(); try {
      h.resolveAgent.mockImplementation(async () => { throw CATALOG(); });
      const preview = await resolveGroupSelections({ store: h.store, port: h.deps.port }, "g", "human", "preview");
      expect(preview.slots.map((slot) => [slot.key, slot.outcome])).toEqual([
        ["reconcile", { kind: "unavailable", code: "omp-model-catalog-unavailable" }],
        ["task:a", { kind: "unavailable", code: "omp-model-catalog-unavailable" }],
      ]);
      await expect(resolveGroupSelections({ store: h.store, port: h.deps.port }, "g", "human", "confirm")).rejects.toMatchObject({ code: "control-peer-exit" });
      expect((await readSelectionPreview(h.store, h.deps.port, "human", "g")).rolePreviews).toEqual({
        worker: { kind: "unavailable", code: "omp-model-catalog-unavailable" }, estimator: { kind: "unavailable", code: "omp-model-catalog-unavailable" },
      });
    } finally { await h.dispose(); }
  });

  it("F3: an installation observation and a reconciliation that fail name ccloop's code; a non-ControlError is control-internal-error", async () => {
    const h = await webFixture(); try {
      const base = h.deps.port as unknown as Record<string, unknown>;
      const observing = new WebControlService({ ...h.deps, port: { ...base, observeAgentInstallations: async () => { throw new ControlError("control-peer-exit", "2:agent-config-invalid: bad table"); } } as unknown as ExecutionPort });
      await observing.observeAgentUpdates();
      expect(observing.agentUpdateView("human").failureCode).toBe("agent-config-invalid");
      const crashing = new WebControlService({ ...h.deps, port: { ...base, observeAgentInstallations: async () => { throw new Error("socket hang up"); } } as unknown as ExecutionPort });
      await crashing.observeAgentUpdates();
      expect(crashing.agentUpdateView("human").failureCode).toBe("control-internal-error");
      // A pending operation (ccloop died during apply), reconciled at startup against a ccloop that fails again.
      const dying = { applyAgentInstallations: async () => { throw new ControlError("control-peer-exit", "2:agent-installation-apply-failed: disk full"); } } as unknown as ExecutionPort;
      await expect(applyAgentUpdate({ store: h.store, port: dying }, apply, { client: "web", principal: "user:owner" })).rejects.toMatchObject({ code: "control-peer-exit" });
      const reconciling = new WebControlService({ ...h.deps, port: { ...base, applyAgentInstallations: dying.applyAgentInstallations, observeAgentInstallations: async () => observation } as unknown as ExecutionPort });
      await reconciling.recoverAgentUpdates();
      expect(reconciling.agentUpdateView("human").failureCode).toBe("agent-installation-apply-failed");
    } finally { await h.dispose(); }
  });
});
