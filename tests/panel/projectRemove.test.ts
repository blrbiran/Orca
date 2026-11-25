/**
 * Project remove spec 2026-11-25 §6 (tester #470, session 5d3d0c09). Human rulings: `orca project remove` refuses while the
 * project has groups that are not archived, naming the count and the next step; `--archive-groups` archives them through
 * `archive-group` first, then removes. §6.2 a: the name resolves against the projects file, the tester's gone-folder
 * entry included; c: archiving a gone-folder project's groups works. Rule 17: the projects file, the control store, the
 * accounts and the person token are in this criterion's temp root, never the person's ~/.orca.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { PERSON_TOKEN_SCHEMA } from "../../src/commands/person.js";
import { controlRepoKey, controlRoot } from "../../src/panel/controlOptions.js";
import { createPanelServer, parsePanelArgs, type StartedPanel } from "../../src/panel/server.js";
import { cli } from "../commands/fixtures/fakePanel.js";
import { seedUser, sessionFor, TEST_PASSWORD } from "./fixtures/auth.js";
import { overSocket } from "./fixtures/socketPanel.js";

const started: StartedPanel[] = [];
afterEach(async () => { while (started.length) await started.pop()!.close(); });

function world(projects: Array<{ id: string; name: string; dir: string }>, gone: string[] = []) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "prm-")));
  const file = join(root, "home", "projects.json");
  mkdirSync(join(root, "home"));
  const entries = projects.map((p) => {
    const dir = join(root, p.dir); mkdirSync(dir);
    execFileSync("git", ["-c", "init.defaultBranch=main", "init", "-q"], { cwd: dir });
    return { id: p.id, name: p.name, path: dir };
  });
  writeFileSync(file, JSON.stringify({ version: 1, projects: entries }));
  // The tester's case: the folder was a temp directory, gone before the panel started.
  for (const dir of gone) rmSync(join(root, dir), { recursive: true, force: true });
  const env: NodeJS.ProcessEnv = { ...process.env, ORCA_CONTROL_DIR: join(root, "control"), ORCA_CORRECTIONS_DIR: join(root, "corrections"), ORCA_PROJECTS_FILE: file };
  delete env.ORCA_CCLOOP_BIN; delete env.ORCA_AGENTS_TABLE; delete env.ORCA_DISPATCHED_RUN;
  return { root, file, env, state: join(root, "s") };
}
type World = ReturnType<typeof world>;

async function boot(w: World) {
  const panel = await createPanelServer(parsePanelArgs(["--by", "tester", "--port", "0", "--control-state-dir", w.state, "--projects-file", w.file], w.env), w.env);
  started.push(panel);
  seedUser(controlRoot(w.env), "olga", "owner");
  seedUser(controlRoot(w.env), "amy", "member");
  const sock = join(w.state, "control.sock");
  const personToken = async (name: string): Promise<string> => {
    const answer = await overSocket(sock, "POST", "/api/control/person/login", { "x-orca-client": "cli:test" }, { name, password: TEST_PASSWORD });
    return (JSON.parse(answer.text) as { token: string }).token;
  };
  const owner = { "x-orca-person-token": await personToken("olga") };
  const remove = async (id: string, body: unknown, headers: Record<string, string> = owner) => {
    const answer = await overSocket(sock, "POST", `/api/control/projects/${id}/remove`, { "x-orca-client": "cli:test", ...headers }, body);
    return { status: answer.status, body: JSON.parse(answer.text) as Record<string, any> };
  };
  const list = async () => JSON.parse((await overSocket(sock, "GET", "/api/control/projects", { "x-orca-client": "cli:test" })).text) as { projects: Array<{ projectKey: string }>; pendingRestart: string[]; missingPaths: string[] };
  return { panel, remove, list, personToken, owner };
}

/** A group of project `projectId` written into the running panel's store (as the debug-group criterion seeds runs). */
function seedGroup(w: World, groupId: string, projectId: string, status: string, extra: Record<string, unknown> = {}): void {
  const db = new DatabaseSync(join(w.state, "control.sqlite"));
  try {
    db.exec("PRAGMA busy_timeout=5000");
    db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES (?,1,1,?)").run(groupId, JSON.stringify({ groupId, status, projectKey: controlRepoKey(projectId), ...extra }));
  } finally { db.close(); }
}
function activeRun(w: World, groupId: string): void {
  const db = new DatabaseSync(join(w.state, "control.sqlite"));
  try {
    db.exec("PRAGMA busy_timeout=5000");
    db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES (?,?,?,1,1,?)").run(`run-${groupId}`, groupId, "a", JSON.stringify({ runId: `run-${groupId}`, taskId: "a", state: "running" }));
  } finally { db.close(); }
}
const archivedIn = (w: World): Record<string, boolean> => {
  const db = new DatabaseSync(join(w.state, "control.sqlite"), { readOnly: true });
  try {
    return Object.fromEntries(db.prepare("SELECT id, body FROM groups ORDER BY id").all().map((row) => [String(row.id), Object.hasOwn(JSON.parse(String(row.body)), "archived")]));
  } finally { db.close(); }
};
const filed = (w: World): string[] => (JSON.parse(readFileSync(w.file, "utf8")) as { projects: Array<{ id: string }> }).projects.map((p) => p.id);

describe("orca project remove (tester #470, spec 2026-11-25 §6)", { timeout: 60_000 }, () => {
  it("refuses while the project has groups not archived, naming the count by state and the next step; the file is byte-for-byte unchanged", async () => {
    const w = world([{ id: "lab", name: "Lab", dir: "lab" }, { id: "web", name: "Web", dir: "web" }]);
    const { remove } = await boot(w);
    seedGroup(w, "g1", "lab", "done");
    seedGroup(w, "g2", "lab", "done");
    seedGroup(w, "g3", "lab", "ready");
    seedGroup(w, "g4", "lab", "draft", { archived: { at: 1, actor: "human" } });
    seedGroup(w, "w1", "web", "done");
    const before = readFileSync(w.file, "utf8");
    // mutation: drop the project-has-groups refusal -> 200 and the entry gone, red
    const refused = await remove("lab", {});
    expect([refused.status, refused.body.code, refused.body.message]).toEqual([409, "project-has-groups",
      "lab has 3 groups not archived (2 done, 1 ready): archive them first, or pass --archive-groups"]);
    expect(refused.body.groups).toEqual({ notArchived: 3, byStatus: { done: 2, ready: 1 }, groupIds: ["g1", "g2", "g3"] });
    expect(refused.body.next).toEqual(["orca project remove lab --archive-groups --as-person"]);
    expect(readFileSync(w.file, "utf8")).toBe(before);
    expect(archivedIn(w)).toEqual({ g1: false, g2: false, g3: false, g4: true, w1: false });
  });

  it("--archive-groups archives each group through archive-group, then removes the mounted project; the panel names the restart", async () => {
    const w = world([{ id: "lab", name: "Lab", dir: "lab" }, { id: "web", name: "Web", dir: "web" }]);
    const { remove, list, owner } = await boot(w);
    seedGroup(w, "g1", "lab", "done");
    seedGroup(w, "g2", "lab", "ready");
    seedGroup(w, "g4", "lab", "draft", { archived: { at: 1, actor: "human" } });
    seedGroup(w, "w1", "web", "done");
    // mutation: skip the archive walk (remove at once) -> archivedGroups [] and g1/g2 unarchived, red
    const done = await remove("Lab", { archiveGroups: true });
    expect([done.status, done.body]).toEqual([200, {
      removed: { projectKey: "lab", name: "Lab", kind: "repo", path: join(w.root, "lab") },
      archivedGroups: ["g1", "g2"], archivedBefore: 1, restartNeeded: true,
      next: ["orca panel restart (the running panel holds the repository until then)", "re-add it with the same name to reattach its 3 archived groups"],
    }]);
    expect(archivedIn(w)).toEqual({ g1: true, g2: true, g4: true, w1: false });
    expect(filed(w)).toEqual(["web"]);
    const after = await list();
    expect(after.projects.map((p) => p.projectKey)).toEqual(["web"]);
    expect(after.pendingRestart).toEqual(["removed:lab"]);
    expect((await remove("lab", {})).body.code).toBe("project-unknown");
    // The control plane still holds the repository until the restart, so the same name cannot be added again before it.
    // mutation: drop the removedMounted check in add() -> the add goes on to the control plane's own refusal, red
    const again = await overSocket(join(w.state, "control.sock"), "POST", "/api/control/projects", { "x-orca-client": "cli:test", ...owner }, { name: "Lab", path: join(w.root, "lab") });
    expect([again.status, (JSON.parse(again.text) as { code?: string }).code]).toEqual([409, "project-removed-pending-restart"]);
    expect(filed(w)).toEqual(["web"]);
  });

  it("a project whose folder is gone (the tester's case): resolved from the file, its groups archive, and the warning goes at once", async () => {
    const w = world([{ id: "git-merge-lab", name: "git-merge-lab", dir: "gml" }, { id: "web", name: "Web", dir: "web" }], ["gml"]);
    const { remove, list } = await boot(w);
    expect((await list()).missingPaths).toEqual([`git-merge-lab: ${join(w.root, "gml")}`]);
    seedGroup(w, "m1", "git-merge-lab", "done");
    seedGroup(w, "m2", "git-merge-lab", "done");
    seedGroup(w, "m3", "git-merge-lab", "ready", { archived: { at: 1, actor: "human" } });
    const refused = await remove("git-merge-lab", {});
    expect([refused.status, refused.body.code]).toEqual([409, "project-has-groups"]);
    // Spec §6.2 c: archive-group reads and writes the store only; a gone folder's groups archive like any other.
    // mutation: make the groups port's archive refuse a repository the control plane does not hold -> 409, red
    const done = await remove("git-merge-lab", { archiveGroups: true });
    expect([done.status, done.body.archivedGroups, done.body.restartNeeded, done.body.next]).toEqual([200, ["m1", "m2"], false, ["re-add it with the same name to reattach its 3 archived groups"]]);
    expect(archivedIn(w)).toEqual({ m1: true, m2: true, m3: true });
    expect(filed(w)).toEqual(["web"]);
    const after = await list();
    // mutation: keep the entry in missingPaths after the remove -> the warning stays, red
    expect([after.projects.map((p) => p.projectKey), after.missingPaths, after.pendingRestart]).toEqual([["web"], [], []]);
  });

  it("a group archive refuses: the walk stops there, later groups stay as they were, the file is unchanged", async () => {
    const w = world([{ id: "lab", name: "Lab", dir: "lab" }]);
    const { remove } = await boot(w);
    seedGroup(w, "a1", "lab", "done");
    seedGroup(w, "b2", "lab", "running");
    activeRun(w, "b2");
    seedGroup(w, "c3", "lab", "done");
    const before = readFileSync(w.file, "utf8");
    const refused = await remove("lab", { archiveGroups: true });
    expect([refused.status, refused.body.code, refused.body.groupId, refused.body.refusal?.code, refused.body.archivedGroups])
      .toEqual([409, "project-group-archive-refused", "b2", "archive-run-active", ["a1"]]);
    expect(archivedIn(w)).toEqual({ a1: true, b2: false, c3: false });
    expect(readFileSync(w.file, "utf8")).toBe(before);
  });

  it("is an owner's: no token, a member's token, a dispatched run and a Web member are refused; an unknown name lists the registered ids; a multi member is refused", async () => {
    const w = world([{ id: "lab", name: "Lab", dir: "lab" }, { id: "web", name: "Web", dir: "web" }]);
    const { panel, remove, personToken, owner } = await boot(w);
    const member = { "x-orca-person-token": await personToken("amy") };
    const before = readFileSync(w.file, "utf8");
    // mutation: drop the socket route's projectAddRefusal call -> 200 and the entry gone, red
    expect((await remove("lab", {}, {})).body.error?.code).toBe("control-person-token-required");
    expect((await remove("lab", {}, {})).body.error?.message).toBe("orca project remove wants a person: log in with `orca auth login` and resend it with --as-person, or remove the project in the Web UI.");
    expect((await remove("lab", {}, member)).body.error?.code).toBe("owner-required");
    expect((await remove("lab", {}, { ...owner, "x-orca-dispatched-run": "run-1" })).body.error?.code).toBe("control-dispatched-run-refused");
    const web = async (who: "owner" | "member", name: string, id: string) => {
      const res = await (await sessionFor(panel, w.env, name, who)).fetch(`/api/projects/${id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: "{}" });
      return [res.status, (await res.json() as { code?: string }).code ?? "ok"];
    };
    // mutation: drop the DELETE route's projectAddRefusal call -> [200, "ok"], red
    expect(await web("member", "mia", "lab")).toEqual([403, "owner-required"]);
    expect(readFileSync(w.file, "utf8")).toBe(before);
    expect((await remove("nope", {})).body).toEqual({ code: "project-unknown", message: 'no registered project is "nope"; registered: lab, web' });
    expect((await remove("lab", { archiveGroups: "yes" })).status).toBe(400);
    // A multi project of both: removing a member would leave it pointing at nothing.
    const ownerWeb = await sessionFor(panel, w.env, "otto", "owner");
    expect((await ownerWeb.fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Shop", dirs: ["lab", "web"] }) })).status).toBe(201);
    expect((await remove("lab", {})).body.code).toBe("project-in-multi");
    // The Web owner removes the multi project itself (no group, nothing pending); then its member goes too.
    const res = await ownerWeb.fetch("/api/projects/shop", { method: "DELETE", headers: { "content-type": "application/json" }, body: "{}" });
    expect([res.status, (await res.json() as { restartNeeded?: boolean }).restartNeeded]).toEqual([200, false]);
    expect((await remove("lab", {})).status).toBe(200);
    expect(filed(w)).toEqual(["web"]);
  });

  it("end to end: project show and list name the gone-folder project; `orca project remove --archive-groups --as-person` removes it", async () => {
    const w = world([{ id: "git-merge-lab", name: "git-merge-lab", dir: "gml" }, { id: "web", name: "Web", dir: "web" }], ["gml"]);
    const { personToken } = await boot(w);
    seedGroup(w, "m1", "git-merge-lab", "done");
    const personDir = join(w.root, "person");
    mkdirSync(personDir, { mode: 0o700 });
    writeFileSync(join(personDir, "token.json"), JSON.stringify({ schema: PERSON_TOKEN_SCHEMA, token: await personToken("olga"), sid: "s", user: "olga", expiresAt: Date.now() + 60_000 }), { mode: 0o600 });
    const env = { ORCA_PERSON_DIR: personDir, ORCA_PANEL_DIR: "/nonexistent/panel", ORCA_PROJECTS_FILE: w.file };
    const gone = join(w.root, "gml");
    // Spec §6.2 b: `show` answers what `list` lists. mutation: drop the ProjectNotMounted throw -> project-not-found, exit 1, red
    const show = await cli(["project", "show", "git-merge-lab"], w.state, { cwd: w.root, env });
    expect([show.code, show.stdout, show.stderr]).toEqual([0, `git-merge-lab: registered, not mounted: folder not found: ${gone}\nnext: orca project remove git-merge-lab --as-person\n`, ""]);
    const shown = await cli(["project", "show", "git-merge-lab", "--json"], w.state, { cwd: w.root, env });
    expect(shown.json().body).toEqual({ schema: "orca-project-show-v1", repoId: null, projectKey: "git-merge-lab", path: gone, mounted: false, reason: "folder not found", next: ["orca project remove git-merge-lab --as-person"] });
    // Any other verb naming it is refused by name, with the same facts.
    const other = await cli(["project", "set-workspace-mode", "--mode", "clone", "--project", "git-merge-lab"], w.state, { cwd: w.root, env });
    expect([other.code, other.stderr]).toEqual([1, `orca: project-not-mounted: git-merge-lab is registered, not mounted: folder not found: ${gone} (restore the folder, or orca project remove git-merge-lab --as-person)\n`]);
    const listed = await cli(["project", "list"], w.state, { cwd: w.root, env });
    expect(listed.stdout.split("\n").filter((line) => line.startsWith("git-merge-lab") || line.startsWith("warning"))).toEqual([
      `git-merge-lab  repo  (not mounted)  ${gone}`,
      `warning: folder not found, not mounted: git-merge-lab: ${gone} (restore the folder, or orca project remove <id> --as-person)`,
    ]);
    const refused = await cli(["project", "remove", "git-merge-lab", "--as-person"], w.state, { cwd: w.root, env });
    expect([refused.code, refused.stderr]).toEqual([2, "orca: project-has-groups: git-merge-lab has 1 group not archived (1 done): archive them first, or pass --archive-groups\norca: next: orca project remove git-merge-lab --archive-groups --as-person\n"]);
    const out = await cli(["project", "remove", "git-merge-lab", "--archive-groups", "--as-person"], w.state, { cwd: w.root, env });
    expect([out.code, out.stdout, out.stderr]).toEqual([0, `removed project git-merge-lab (repo): ${gone}\narchived 1 group: m1\nnext: re-add it with the same name to reattach its 1 archived group\n`, ""]);
    expect(filed(w)).toEqual(["web"]);
    const status = await cli(["project", "list"], w.state, { cwd: w.root, env });
    expect(status.stdout).not.toContain("warning");
    // Over MCP it is refused before anything is sent.
    const mcp = await cli(["project", "remove", "web", "--as-person"], w.state, { cwd: w.root, env, client: "mcp:test" });
    expect([mcp.code, mcp.stderr.split(":")[1]?.trim()]).toEqual([1, "project-remove-not-over-mcp"]);
  });
});
