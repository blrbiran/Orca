// Integration spec §3.1, §3.3, §3.4: the repository's integration default over HTTP. Setting it is human-only (an agent
// on the socket and a member over the Web are refused by name and book nothing); an owner's is checked against the
// repository before the transaction and read back from its own GET.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { controlRepoKey, controlRoot } from "../../src/panel/controlOptions.js";
import type { StartedPanel } from "../../src/panel/server.js";
import { login, seedUser, sessionFor } from "./fixtures/auth.js";
import { boot, overSocket, useSocketPanels, workspace } from "./fixtures/socketPanel.js";

useSocketPanels();

const ids = (state: string): string[] => {
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
  const db = new DatabaseSync(join(state, "control.sqlite"), { readOnly: true });
  try { return (db.prepare("SELECT id FROM commands ORDER BY id").all() as Array<{ id: string }>).map((row) => row.id); } finally { db.close(); }
};
const LOCAL = { delivery: "local", trigger: "task", method: "merge", target: "main" };
const PUSH = { delivery: "push-branch", trigger: "task", target: "main", remote: "origin" };

async function setUp() {
  const w = await workspace();
  execFileSync("git", ["init", "-q", w.repo]);
  const panel = await boot(w, [], { port: true });
  const repo = controlRepoKey("proj");
  const owner = await sessionFor(panel, w.env);
  const post = (route: string, envelope: unknown) =>
    owner.fetch(`/api/control/${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(envelope) });
  return { w, panel, repo, owner, post };
}

describe("the repository integration default over HTTP (integration spec §3.4)", () => {
  it("refuses an agent on the socket and a member over the Web by name, and books nothing", async () => {
    const { w, panel, repo } = await setUp();
    seedUser(controlRoot(w.env), "amy", "member");
    const amy = await login(panel.url, "amy");
    const route = `/api/control/repositories/${repo}/integration`;
    const socket = await overSocket((panel as StartedPanel).socketPath!, "POST", route, { "x-orca-client": "cli:test" }, { commandId: "int-a", expectedRevision: 0, payload: { integration: LOCAL } });
    expect([socket.status, JSON.parse(socket.text).error.code]).toEqual([403, "control-verb-human-only"]);
    const member = await amy.fetch(route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId: "int-m", expectedRevision: 0, payload: { integration: LOCAL } }) });
    expect([member.status, ((await member.json()) as { error: { code: string } }).error.code]).toEqual([403, "control-verb-human-only"]);
    expect(ids(w.state).filter((id) => id.startsWith("int-"))).toEqual([]);
  });

  it("reads keep at revision 0, sets an owner's scheme, reads it back, and leaves the workspace read's shape alone", async () => {
    const { repo, owner, post } = await setUp();
    expect(await (await owner.fetch(`/api/control/repositories/${repo}/integration`)).json())
      .toEqual({ schema: "orca-repository-integration-v1", repoId: repo, integration: { delivery: "keep" }, revision: 0 });
    const set = await post(`repositories/${repo}/integration`, { commandId: "int-o", expectedRevision: 0, payload: { integration: LOCAL } });
    expect([set.status, ((await set.json()) as { result: unknown }).result]).toEqual([200, { kind: "integration-scheme-set", repoId: repo, integration: LOCAL }]);
    expect(await (await owner.fetch(`/api/control/repositories/${repo}/integration`)).json())
      .toEqual({ schema: "orca-repository-integration-v1", repoId: repo, integration: LOCAL, revision: 1 });
    expect(await (await owner.fetch(`/api/control/repositories/${repo}/workspace`)).json())
      .toEqual({ schema: "orca-repository-workspace-v1", repoId: repo, workspaceMode: "worktree", revision: 1 });
  });

  it("refuses a scheme whose remote the repository does not have as integration-invalid naming the check, before writing", async () => {
    const { repo, owner, post } = await setUp();
    const set = await post(`repositories/${repo}/integration`, { commandId: "int-x", expectedRevision: 0, payload: { integration: PUSH } });
    expect([set.status, ((await set.json()) as { error: unknown }).error]).toEqual([400, { code: "integration-invalid", message: "integration-invalid:remote-missing", commandRevision: 0, evidenceIds: [], retryable: false }]);
    expect(await (await owner.fetch(`/api/control/repositories/${repo}/integration`)).json()).toMatchObject({ integration: { delivery: "keep" }, revision: 0 });
  });

  it("answers an unknown repository 404 on read", async () => {
    const { owner } = await setUp();
    const read = await owner.fetch("/api/control/repositories/elsewhere/integration");
    expect([read.status, ((await read.json()) as { error: { code: string } }).error.code]).toEqual([404, "control-target-not-allowed"]);
  });
});
