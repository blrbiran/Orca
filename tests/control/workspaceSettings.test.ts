import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openControlStore } from "../../src/control/store.js";
import { applySetWorkspaceMode, readWorkspaceSetting, type SetWorkspaceModeCommand } from "../../src/control/workspaceSettings.js";
import { createAdmissionGate } from "../../src/control/admissionGate.js";
import { openTestStore } from "./fixtures/store.js";

// Execution driver spec §3.2 / criterion W1 (store half): a per-repository workspace mode under its
// own revision; no row means worktree.
const command = (commandId: string, expectedRevision: number, workspaceMode: "worktree" | "clone", repoId = "repo"): SetWorkspaceModeCommand => ({
  schema: "orca-raw-command-v1", commandId, expectedRevision, actorId: "human", verb: "set-workspace-mode",
  target: { kind: "repository", repoId }, payload: { workspaceMode },
});
const known = (repoId: string) => repoId === "repo";

describe("repository workspace mode (execution driver §3.2)", () => {
  it("reads worktree at revision 0 when nothing was ever set", async () => {
    const h = await openTestStore(); try {
      expect(readWorkspaceSetting(h.store, "repo")).toEqual({ workspaceMode: "worktree", revision: 0 });
    } finally { await h.dispose(); }
  });

  it("sets clone under the setting's own revision, with no projection, in the repository's ledger scope", async () => {
    const h = await openTestStore(); try {
      const result = applySetWorkspaceMode({ store: h.store, admissionGate: createAdmissionGate(), knownRepository: known }, command("mode-1", 0, "clone"));
      expect(result).toMatchObject({ schema: "orca-command-success-v1", verb: "set-workspace-mode", commandRevision: 1, projectionSeq: null, result: { kind: "workspace-mode-set", repoId: "repo", workspaceMode: "clone" } });
      expect(readWorkspaceSetting(h.store, "repo")).toEqual({ workspaceMode: "clone", revision: 1 });
      expect(h.store.db.prepare("SELECT group_id,scope_kind,scope_id FROM commands WHERE id='mode-1'").get()).toEqual({ group_id: "@repository:repo", scope_kind: "repository", scope_id: "repo" });
    } finally { await h.dispose(); }
  });

  it("refuses a stale revision by name and leaves the setting alone", async () => {
    const h = await openTestStore(); try {
      const deps = { store: h.store, knownRepository: known };
      applySetWorkspaceMode(deps, command("mode-1", 0, "clone"));
      const stale = applySetWorkspaceMode(deps, command("mode-2", 0, "worktree"));
      expect(stale).toEqual({ error: { code: "revision-conflict", message: "The command revision is stale.", commandRevision: 1, evidenceIds: [], retryable: false } });
      expect(readWorkspaceSetting(h.store, "repo")).toEqual({ workspaceMode: "clone", revision: 1 });
    } finally { await h.dispose(); }
  });

  it("refuses a repository this panel was not configured with, and writes no setting", async () => {
    const h = await openTestStore(); try {
      const refused = applySetWorkspaceMode({ store: h.store, knownRepository: known }, command("mode-x", 0, "clone", "elsewhere"));
      expect("error" in refused ? refused.error.code : "applied").toBe("control-target-not-allowed");
      expect(h.store.db.prepare("SELECT COUNT(*) AS n FROM repository_settings").get()!.n).toBe(0);
    } finally { await h.dispose(); }
  });

  it("refuses setting the mode a repository already has", async () => {
    const h = await openTestStore(); try {
      const refused = applySetWorkspaceMode({ store: h.store, knownRepository: known }, command("mode-same", 0, "worktree"));
      expect("error" in refused ? refused.error.code : "applied").toBe("no-op-command");
      expect(readWorkspaceSetting(h.store, "repo")).toEqual({ workspaceMode: "worktree", revision: 0 });
    } finally { await h.dispose(); }
  });

  it("replays a repeated command id without a second write", async () => {
    const h = await openTestStore(); try {
      const deps = { store: h.store, knownRepository: known };
      const first = applySetWorkspaceMode(deps, command("mode-1", 0, "clone"));
      expect(applySetWorkspaceMode(deps, command("mode-1", 0, "clone"))).toEqual(first);
      expect(readWorkspaceSetting(h.store, "repo")).toEqual({ workspaceMode: "clone", revision: 1 });
    } finally { await h.dispose(); }
  });

  it("migrates a version 3 store by adding the settings table", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "orca-migrate-4-")));
    try {
      const first = await openControlStore({ stateDir: join(root, "state") });
      first.db.exec("DROP TABLE repository_settings");
      first.db.prepare("UPDATE meta SET value='3' WHERE key='schemaVersion'").run();
      first.close();
      const second = await openControlStore({ stateDir: join(root, "state") });
      expect(second.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()!.value).toBe("4");
      expect(readWorkspaceSetting(second, "repo")).toEqual({ workspaceMode: "worktree", revision: 0 });
      second.close();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
