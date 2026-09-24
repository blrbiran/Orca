import { afterAll, describe, expect, it } from "vitest";
import { commandSuccessSchema, repositoryWorkspaceSchema } from "../../src/control/webProtocol.js";
import { command, createHarness, get, json } from "./fixtures/controlPanel.js";

// Execution driver spec §3.2 / criterion W1 (HTTP half).
const h = createHarness();
afterAll(async () => { await h.dispose(); });

describe("the repository workspace mode over HTTP (execution driver §3.2)", () => {
  it("reads the default, sets clone under the setting's own revision, reads it back, and refuses a stale revision by name", async () => {
    const panel = await h.boot("epoch-ws-mode", await h.workspace());
    expect(repositoryWorkspaceSchema.parse(await json(await get(panel, "/api/control/repositories/repo/workspace"))))
      .toEqual({ schema: "orca-repository-workspace-v1", repoId: "repo", workspaceMode: "worktree", revision: 0 });
    const set = await command(panel, "/api/control/repositories/repo/workspace-mode", { commandId: "ws-1", expectedRevision: 0, payload: { workspaceMode: "clone" } });
    expect(set.status).toBe(200);
    expect(commandSuccessSchema.parse(set.body)).toMatchObject({
      verb: "set-workspace-mode", target: { kind: "repository", repoId: "repo" }, commandRevision: 1, projectionSeq: null,
      result: { kind: "workspace-mode-set", repoId: "repo", workspaceMode: "clone" },
    });
    expect(await json(await get(panel, "/api/control/repositories/repo/workspace"))).toMatchObject({ workspaceMode: "clone", revision: 1 });
    const stale = await command(panel, "/api/control/repositories/repo/workspace-mode", { commandId: "ws-2", expectedRevision: 0, payload: { workspaceMode: "worktree" } });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: "revision-conflict", commandRevision: 1 });
    await panel.close();
  });

  it("refuses a repository the panel was not configured with, on read and on write", async () => {
    const panel = await h.boot("epoch-ws-unknown", await h.workspace());
    const read = await get(panel, "/api/control/repositories/elsewhere/workspace");
    expect(read.status).toBe(404);
    expect((await json(read) as { error: { code: string } }).error.code).toBe("control-target-not-allowed");
    const write = await command(panel, "/api/control/repositories/elsewhere/workspace-mode", { commandId: "ws-x", expectedRevision: 0, payload: { workspaceMode: "clone" } });
    expect(write.status).toBe(404);
    expect((write.body as { error: { code: string } }).error.code).toBe("control-target-not-allowed");
    await panel.close();
  });
});
