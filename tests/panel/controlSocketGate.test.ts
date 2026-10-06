// Agent entry spec §4.2, §5, §6: the socket gate (client header, human-only surface) and per-row attribution.
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { controlRepoKey } from "../../src/panel/controlOptions.js";
import type { StartedPanel } from "../../src/panel/server.js";
import { boot, overSocket, useSocketPanels, workspace } from "./fixtures/socketPanel.js";

useSocketPanels();

const send = (panel: StartedPanel, route: string, envelope: unknown, client = "cli:test") =>
  overSocket(panel.socketPath!, "POST", `/api/control/${route}`, { "x-orca-client": client }, envelope);
const webPost = (panel: StartedPanel, route: string, envelope: unknown) =>
  fetch(`${panel.url}/api/control/${route}`, { method: "POST", headers: { "x-orca-token": panel.token, "content-type": "application/json" }, body: JSON.stringify(envelope) });
// The panel exposes no store handle, so read the ledger rows with a read-only connection on the sqlite file.
const ledger = async (state: string) => {
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
  const db = new DatabaseSync(join(state, "control.sqlite"), { readOnly: true });
  try { return db.prepare("SELECT id, client FROM commands ORDER BY id").all() as Array<{ id: string; client: string | null }>; } finally { db.close(); }
};
const amount = { tokens: 1, activeMs: 1, attempts: 1, sessions: 1 };

describe("the socket gate (spec §4.2, §5, §6)", () => {
  it("C11: a socket request without a valid client header is refused before any route, and books nothing", async () => {
    const w = await workspace(); const panel = await boot(w);
    for (const headers of [{} as Record<string, string>, { "x-orca-client": "web" }, { "x-orca-client": "cli:" }]) {
      const res = await overSocket(panel.socketPath!, "GET", "/api/control/summary", headers);
      expect(res.status).toBe(400);
      expect(JSON.parse(res.text).error.code).toBe("control-client-invalid");
    }
    const repo = controlRepoKey("proj");
    const res = await overSocket(panel.socketPath!, "POST", `/api/control/repositories/${repo}/workspace-mode`, {}, { commandId: "no-header", expectedRevision: 0, payload: { workspaceMode: "clone" } });
    expect(res.status).toBe(400);
    expect((await ledger(w.state)).map((row) => row.id)).not.toContain("no-header");
  });

  it("C11: a bad header is refused before the body is parsed", async () => {
    const w = await workspace(); const panel = await boot(w);
    const res = await overSocket(panel.socketPath!, "POST", "/api/control/requirements", {}, undefined);
    expect(JSON.parse(res.text).error.code).toBe("control-client-invalid");
  });

  it("C9: set-limit over the socket is refused by name and books nothing; over the Web it is not", async () => {
    const w = await workspace(); const panel = await boot(w);
    const res = await send(panel, "groups/g1/set-limit", { commandId: "lim-1", expectedRevision: 0, payload: { limit: amount } });
    expect(res.status).toBe(403);
    expect(JSON.parse(res.text).error).toMatchObject({ code: "control-verb-human-only", retryable: false });
    expect((await ledger(w.state)).map((row) => row.id)).not.toContain("lim-1");
    const web = await webPost(panel, "groups/g1/set-limit", { commandId: "lim-2", expectedRevision: 0, payload: { limit: amount } });
    expect(((await web.json()) as { error: { code: string } }).error.code).not.toBe("control-verb-human-only");
  });

  it("C10: requirement-open with limit and proposal-edit with proposedGroupLimit are refused; without the field they are not", async () => {
    const w = await workspace(); const panel = await boot(w);
    const repoId = controlRepoKey("proj");
    const withLimit = await send(panel, "requirements", { commandId: "ro-1", expectedRevision: 0, payload: { groupId: "g2", repoId, idea: "x", limit: amount } });
    expect(JSON.parse(withLimit.text).error.code).toBe("control-field-human-only");
    const edit = await send(panel, "groups/g2/proposal/edit", { commandId: "pe-1", expectedRevision: 0, payload: { baseProposalVersion: 1, operations: [], proposedGroupLimit: amount } });
    expect(JSON.parse(edit.text).error.code).toBe("control-field-human-only");
    const without = await send(panel, "requirements", { commandId: "ro-2", expectedRevision: 0, payload: { groupId: "g3", repoId, idea: "x" } });
    expect(JSON.parse(without.text).error?.code ?? "accepted").not.toBe("control-field-human-only");
    const editWithout = await send(panel, "groups/g2/proposal/edit", { commandId: "pe-2", expectedRevision: 0, payload: { baseProposalVersion: 1, operations: [] } });
    expect(JSON.parse(editWithout.text).error?.code ?? "accepted").not.toBe("control-field-human-only");
    expect((await ledger(w.state)).map((row) => row.id)).not.toContain("ro-1");
    expect((await ledger(w.state)).map((row) => row.id)).not.toContain("pe-1");
  });

  it("C12: rows carry the client; a Web command retried over the socket replays and keeps 'web'", async () => {
    const w = await workspace(); const panel = await boot(w, [], { port: true });
    const repo = controlRepoKey("proj");
    const first = await send(panel, `repositories/${repo}/workspace-mode`, { commandId: "ws-socket", expectedRevision: 0, payload: { workspaceMode: "clone" } }, "cli:claude");
    expect(first.status).toBe(200);
    const webEnvelope = { commandId: "ws-web", expectedRevision: 1, payload: { workspaceMode: "worktree" } };
    const web = await webPost(panel, `repositories/${repo}/workspace-mode`, webEnvelope);
    expect(web.status).toBe(200);
    const webBody = await web.text();
    // Same commandId and payload on the other channel: the raw command is identical (actorId is the panel operator on both), so a replay.
    const replay = await send(panel, `repositories/${repo}/workspace-mode`, webEnvelope, "mcp:other");
    expect(replay.status).toBe(200);
    expect(replay.text).toBe(webBody);
    const rows = await ledger(w.state);
    expect(rows.find((row) => row.id === "ws-socket")?.client).toBe("cli:claude");
    expect(rows.find((row) => row.id === "ws-web")?.client).toBe("web");
  });
});
