/**
 * Tester follow-up E §9 (D21): registering a project lets Orca and its agents write in a new directory, so only a person
 * does it. The Web's `POST /api/projects` is an owner's (a member: `owner-required`); `orca project add` reaches the same
 * handler over the control socket with an owner's person token, and a run Orca dispatched is refused it, token or not.
 * Every refusal leaves the projects file as it was. Rule 17: the projects file, the accounts and the person token are in
 * this criterion's temp root (ORCA_PROJECTS_FILE, ORCA_CONTROL_DIR, ORCA_PERSON_DIR), never the person's ~/.orca.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PERSON_TOKEN_SCHEMA } from "../../src/commands/person.js";
import { controlRoot } from "../../src/panel/controlOptions.js";
import { createPanelServer, parsePanelArgs, type StartedPanel } from "../../src/panel/server.js";
import { cli } from "../commands/fixtures/fakePanel.js";
import { seedUser, sessionFor, TEST_PASSWORD } from "./fixtures/auth.js";
import { overSocket } from "./fixtures/socketPanel.js";

const started: StartedPanel[] = [];
afterEach(async () => { while (started.length) await started.pop()!.close(); });

function world() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pa-")));
  const gitRepo = (name: string): string => {
    const dir = join(root, name); mkdirSync(dir);
    execFileSync("git", ["-c", "init.defaultBranch=main", "init", "-q"], { cwd: dir });
    return dir;
  };
  const file = join(root, "home", "projects.json");
  mkdirSync(join(root, "home"));
  writeFileSync(file, JSON.stringify({ version: 1, projects: [] }));
  const env: NodeJS.ProcessEnv = { ...process.env, ORCA_CONTROL_DIR: join(root, "control"), ORCA_CORRECTIONS_DIR: join(root, "corrections"), ORCA_PROJECTS_FILE: file };
  delete env.ORCA_CCLOOP_BIN; delete env.ORCA_AGENTS_TABLE; delete env.ORCA_DISPATCHED_RUN;
  return { root, gitRepo, file, env, state: join(root, "s") };
}
type World = ReturnType<typeof world>;

async function boot(w: World, args: string[] = ["--projects-file", w.file]) {
  const panel = await createPanelServer(parsePanelArgs(["--by", "tester", "--port", "0", "--control-state-dir", w.state, ...args], w.env), w.env);
  started.push(panel);
  const socket = async (body: unknown, headers: Record<string, string> = {}) => {
    const answer = await overSocket(join(w.state, "control.sock"), "POST", "/api/control/projects", { "x-orca-client": "cli:test", ...headers }, body);
    const parsed = JSON.parse(answer.text) as { error?: { code: string }; code?: string; project?: { projectKey: string } };
    return [answer.status, parsed.error?.code ?? parsed.code ?? parsed.project?.projectKey ?? "?"];
  };
  const personToken = async (name: string): Promise<string> => {
    const answer = await overSocket(join(w.state, "control.sock"), "POST", "/api/control/person/login", { "x-orca-client": "cli:test" }, { name, password: TEST_PASSWORD });
    return (JSON.parse(answer.text) as { token: string }).token;
  };
  return { panel, socket, personToken };
}

const registered = (w: World): string[] => (JSON.parse(readFileSync(w.file, "utf8")) as { projects: Array<{ id: string }> }).projects.map((p) => p.id);

describe("POST /api/projects is an owner's (tester follow-up E §9, D21)", { timeout: 60_000 }, () => {
  it("refuses a member owner-required and writes nothing; an owner adds the project", async () => {
    const w = world();
    const { panel } = await boot(w);
    const repo = w.gitRepo("web");
    const add = async (role: "owner" | "member", name: string) => {
      const res = await (await sessionFor(panel, w.env, name, role)).fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Web", path: repo }) });
      return [res.status, (await res.json() as { code?: string; project?: { projectKey: string } })];
    };
    // mutation: drop the Web route's projectAddRefusal call -> [201, {project}], red
    expect(await add("member", "amy")).toEqual([403, { code: "owner-required", message: "only an owner registers a project" }]);
    expect(registered(w)).toEqual([]);
    const [status, body] = await add("owner", "olga");
    expect([status, (body as { project?: { projectKey: string } }).project?.projectKey]).toEqual([201, "web"]);
    expect(registered(w)).toEqual(["web"]);
  });
});

/**
 * Tester follow-up F §3 (D21): renaming a project and reordering a multi project's folders (`PATCH /api/projects/:id`)
 * take the add's gate -- the Web hides these controls from a member, and the server refuses one that asks anyway.
 */
describe("PATCH /api/projects/:id is an owner's (tester follow-up F §3, D21)", { timeout: 60_000 }, () => {
  it("refuses a member's rename and folder order owner-required and changes nothing; an owner renames", async () => {
    const w = world();
    const { panel } = await boot(w);
    const owner = await sessionFor(panel, w.env, "olga", "owner");
    const member = await sessionFor(panel, w.env, "amy", "member");
    const post = (body: unknown) => owner.fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await post({ name: "Web", path: w.gitRepo("web") })).status).toBe(201);
    expect((await post({ name: "Api", path: w.gitRepo("api") })).status).toBe(201);
    expect((await post({ name: "Shop", dirs: ["web", "api"] })).status).toBe(201);
    const before = readFileSync(w.file, "utf8");
    const patch = async (who: typeof owner, id: string, body: unknown) => {
      const res = await who.fetch(`/api/projects/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return [res.status, (await res.json() as { code?: string }).code ?? "ok"];
    };
    // mutation: drop the PATCH route's projectAddRefusal call -> [200, "ok"] on both, red
    expect(await patch(member, "web", { name: "Renamed" })).toEqual([403, "owner-required"]);
    expect(await patch(member, "shop", { dirs: ["api", "web"] })).toEqual([403, "owner-required"]);
    expect(readFileSync(w.file, "utf8")).toBe(before);
    expect(await patch(owner, "web", { name: "Renamed" })).toEqual([200, "ok"]);
    expect((JSON.parse(readFileSync(w.file, "utf8")) as { projects: Array<{ id: string; name: string }> }).projects.find((p) => p.id === "web")?.name).toBe("Renamed");
  });
});

describe("orca project add over the control socket (tester follow-up E §9, D21)", { timeout: 60_000 }, () => {
  it("wants an owner's person token, refuses a run Orca dispatched with one or without, and writes only for the owner", async () => {
    const w = world();
    const { socket, personToken } = await boot(w);
    seedUser(controlRoot(w.env), "olga", "owner");
    seedUser(controlRoot(w.env), "amy", "member");
    const owner = { "x-orca-person-token": await personToken("olga") };
    const member = { "x-orca-person-token": await personToken("amy") };
    const MARKER = { "x-orca-dispatched-run": "run-1" };
    const body = { name: "Web", path: w.gitRepo("web") };
    // mutation: drop the socket route's projectAddRefusal call -> [201, "web"] on the first, red
    expect(await socket(body)).toEqual([403, "control-person-token-required"]);
    expect(await socket(body, MARKER)).toEqual([403, "control-dispatched-run-refused"]);
    // mutation: drop the dispatched-run branch of projectAddRefusal -> [201, "web"], red
    expect(await socket(body, { ...owner, ...MARKER })).toEqual([403, "control-dispatched-run-refused"]);
    // mutation: make the person branch return null for any token -> [201, "web"], red
    expect(await socket(body, member)).toEqual([403, "owner-required"]);
    expect(registered(w)).toEqual([]);
    expect(await socket(body, owner)).toEqual([201, "web"]);
    expect(registered(w)).toEqual(["web"]);
    // The Web route's own handler and validation (addProject): a taken name or path, a bad body, a multi of registered ids.
    expect(await socket(body, owner)).toEqual([409, "project-name-taken"]);
    expect(await socket({ ...body, name: "Web two" }, owner)).toEqual([409, "project-path-taken"]);
    expect(await socket({ name: "X" }, owner)).toEqual([400, "panel-bad-request"]);
    expect(await socket({ name: "Api", path: w.gitRepo("api") }, owner)).toEqual([201, "api"]);
    expect(await socket({ name: "Shop", dirs: ["web", "api"] }, owner)).toEqual([201, "shop"]);
  });

  it("a panel whose projects come from the command line refuses an owner by name", async () => {
    const w = world();
    const repo = w.gitRepo("web");
    const { socket, personToken } = await boot(w, ["--repo", `web=${repo}`]);
    seedUser(controlRoot(w.env), "olga", "owner");
    expect(await socket({ name: "Other", path: w.gitRepo("other") }, { "x-orca-person-token": await personToken("olga") })).toEqual([409, "projects-from-command-line"]);
  });

  it("end to end: `orca project add --as-person` with an owner's stored token registers the repository at a path relative to cwd", async () => {
    const w = world();
    const { personToken } = await boot(w);
    seedUser(controlRoot(w.env), "olga", "owner");
    const repo = w.gitRepo("web");
    const personDir = join(w.root, "person");
    mkdirSync(personDir, { mode: 0o700 });
    writeFileSync(join(personDir, "token.json"), JSON.stringify({ schema: PERSON_TOKEN_SCHEMA, token: await personToken("olga"), sid: "s", user: "olga", expiresAt: Date.now() + 60_000 }), { mode: 0o600 });
    const env = { ORCA_PERSON_DIR: personDir, ORCA_PANEL_DIR: "/nonexistent/panel", ORCA_PROJECTS_FILE: w.file };
    const without = await cli(["project", "add", "Web", "--path", "web"], w.state, { cwd: w.root, env });
    expect([without.code, without.stderr]).toEqual([2, "orca: control-person-token-required: orca project add wants a person: log in with `orca auth login` and resend it with --as-person, or add the project in the Web UI.\n"]);
    const out = await cli(["project", "add", "Web", "--path", "web", "--as-person"], w.state, { cwd: w.root, env });
    expect([out.code, out.stdout, out.stderr]).toEqual([0, `added project web (repo): ${repo}\n`, ""]);
    expect(registered(w)).toEqual(["web"]);
  });
});
