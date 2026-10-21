import { describe, expect, it } from "vitest";
import { boot, overSocket, useSocketPanels, workspace } from "./fixtures/socketPanel.js";
import { login, seedUser, sessionFor } from "./fixtures/auth.js";
import { controlRoot } from "../../src/panel/controlOptions.js";
import { createHarness, command, get, json } from "./fixtures/controlPanel.js";

useSocketPanels();

describe("installation update native boundaries", () => {
  it("owner reviews a server preview and applies only the accepted change through the ledger", async () => {
    const h = createHarness();
    const observed = { schema: "orca-agent-detection-observation-v1" as const, baseTableHash: "a".repeat(64), observedAt: "2026-10-11T00:00:00.000Z",
      installed: [{ id: "custom", kind: "claude", command: ["/tmp/fake"], recordedVersion: "1", observedVersion: "2", realpath: "/tmp/fake", status: "changed" as const }] };
    const preview = { ...observed, schema: "orca-agent-detection-preview-v1" as const, previewId: "preview-1",
      changes: [{ changeId: "change-1", kind: "version" as const, installationId: "custom", command: ["/tmp/fake"], realpath: "/tmp/fake", version: "2" }] };
    const requests: Array<{ opId: string; acceptedChangeIds: string[] }> = [];
    const panel = await h.boot("update-owner", await h.workspace(), { agentUpdatePort: {
      observeAgentInstallations: async () => observed,
      previewAgentInstallations: async () => preview,
      applyAgentInstallations: async (request) => { requests.push(request); return { schema: "orca-agent-detection-receipt-v1", opId: request.opId, requestDigest: request.requestDigest,
        previewId: request.previewId, acceptedChangeIds: request.acceptedChangeIds, beforeHash: request.baseTableHash, afterHash: "b".repeat(64),
        before: { schema: "ccloop-agents-table-v1", installations: {} }, after: { schema: "ccloop-agents-table-v1", installations: {} } }; },
    } });
    try {
      const initial = await json(await get(panel, "/api/control/operator/agent-installations"));
      const preferencesBefore = await json(await get(panel, "/api/control/operator/agent-preferences"));
      const operatorId = String(preferencesBefore.operatorId);
      expect(initial).toMatchObject({ revision: 0, pending: false });
      const detection = await panel.session.fetch("/api/control/operator/agent-update-preview", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      expect(await detection.json()).toMatchObject({ previewId: "preview-1" });
      const refused = await command(panel, "/api/control/operator/apply-agent-update", { commandId: "wrong-preview", expectedRevision: 0,
        payload: { previewId: "wrong", baseTableHash: observed.baseTableHash, acceptedChangeIds: ["change-1"] } });
      expect([refused.status, (refused.body.error as { code: string }).code]).toEqual([409, "agent-installation-update-conflict"]);
      expect(requests).toHaveLength(0);
      const staleBase = await command(panel, "/api/control/operator/apply-agent-update", { commandId: "wrong-base", expectedRevision: 0,
        payload: { previewId: preview.previewId, baseTableHash: "c".repeat(64), acceptedChangeIds: ["change-1"] } });
      expect([staleBase.status, (staleBase.body.error as { code: string }).code]).toEqual([409, "agent-installation-update-conflict"]);
      expect(requests).toHaveLength(0);
      const applied = await command(panel, "/api/control/operator/apply-agent-update", { commandId: "apply-1", expectedRevision: 0,
        payload: { previewId: preview.previewId, baseTableHash: preview.baseTableHash, acceptedChangeIds: ["change-1"] } });
      expect(applied).toMatchObject({ status: 200, body: { commandRevision: 1, result: { kind: "agent-installations-updated", operatorId } } });
      expect(requests).toMatchObject([{ opId: "apply-1", acceptedChangeIds: ["change-1"] }]);
      expect(await json(await get(panel, "/api/control/operator/agent-preferences"))).toEqual(preferencesBefore);
      const replay = await command(panel, "/api/control/operator/apply-agent-update", { commandId: "apply-1", expectedRevision: 0,
        payload: { previewId: preview.previewId, baseTableHash: preview.baseTableHash, acceptedChangeIds: ["change-1"] } });
      expect(replay).toEqual(applied);
      expect(requests).toHaveLength(1);
    } finally { await panel.close(); await h.dispose(); }
  });
  it("owner reads observation; member and socket Agent cannot read, preview, or apply", async () => {
    const w = await workspace(); const panel = await boot(w);
    const owner = await sessionFor(panel, w.env);
    seedUser(controlRoot(w.env), "member", "member");
    const member = await login(panel.url, "member");
    expect((await owner.fetch("/api/control/operator/agent-installations")).status).toBe(200);
    for (const session of [member]) {
      expect((await session.fetch("/api/control/operator/agent-installations")).status).toBe(403);
      expect((await session.fetch("/api/control/operator/agent-update-preview", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(403);
      const apply = await session.fetch("/api/control/operator/apply-agent-update", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId: "member-update", expectedRevision: 0, payload: {} }) });
      expect([apply.status, ((await apply.json()) as { error: { code: string } }).error.code]).toEqual([403, "control-verb-human-only"]);
    }
    expect((await overSocket(panel.socketPath!, "GET", "/api/control/operator/agent-installations")).status).toBe(403);
    expect((await overSocket(panel.socketPath!, "POST", "/api/control/operator/agent-update-preview", undefined, {})).status).toBe(403);
    const socket = await overSocket(panel.socketPath!, "POST", "/api/control/operator/apply-agent-update", undefined, { commandId: "socket-update", expectedRevision: 0, payload: {} });
    // CLI v2 spec §15.1 (plan Task 10; Ruling: 这次批准改写所有必要的判据 (b37f7ce9); 允许改必要的test (8b1469ea)): apply-agent-update is the token tier on the socket.
    expect([socket.status, JSON.parse(socket.text).error.code]).toEqual([403, "control-person-token-required"]);
  });

  it("CSRF and request shape block preview before the producer is touched", async () => {
    const w = await workspace(); const panel = await boot(w);
    const owner = await sessionFor(panel, w.env);
    const noCsrf = await fetch(`${panel.url}/api/control/operator/agent-update-preview`, { method: "POST", headers: { "content-type": "application/json", cookie: owner.cookie }, body: "{}" });
    expect(noCsrf.status).toBe(403);
    const arbitrary = await owner.fetch("/api/control/operator/agent-update-preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tablePath: "/tmp/other" }) });
    expect(arbitrary.status).toBe(400);
  });
});
