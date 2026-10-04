/**
 * Project registry spec §4 with §12 C1: file mode is entered by --projects-file (the real `orca panel` adds it when
 * no --repo/--root is given); command-line mode is unchanged; the API reads and writes through the registry.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { controlRepoKey } from "../../src/panel/controlOptions.js";
import { createPanelServer, panelArgsWithDefaultProjects, parsePanelArgs, type StartedPanel } from "../../src/panel/server.js";
import { readProjectsFile } from "../../src/panel/projectsFile.js";

const started: StartedPanel[] = [];
afterEach(async () => { while (started.length) await started.pop()!.close(); });

function world() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "file-mode-")));
  const gitRepo = (name: string): string => {
    const dir = join(root, name); mkdirSync(dir);
    execFileSync("git", ["-c", "init.defaultBranch=main", "init", "-q"], { cwd: dir });
    return dir;
  };
  const file = join(root, "home", "projects.json");
  const env: NodeJS.ProcessEnv = { ...process.env, ORCA_CONTROL_DIR: join(root, "control"), ORCA_CORRECTIONS_DIR: join(root, "corrections"), ORCA_PROJECTS_FILE: file };
  delete env.ORCA_CCLOOP_BIN; delete env.ORCA_AGENTS_TABLE;
  return { root, gitRepo, file, env };
}
async function boot(args: string[], env: NodeJS.ProcessEnv) {
  const panel = await createPanelServer(parsePanelArgs(["--by", "tester", "--port", "0", ...args], env), env);
  started.push(panel);
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${panel.url}${path}`, { method, headers: { "x-orca-token": panel.token, ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
  return { panel, call };
}

describe("file mode", () => {
  it("B1: a missing file is an empty project list with the control plane mounted under <controlRoot>/panel", async () => {
    const w = world();
    const opts = parsePanelArgs(["--by", "tester", "--projects-file", w.file], w.env);
    expect(opts.repos).toEqual([]);
    expect(opts.control.enabled).toBe(true);
    expect(opts.control.stateDir).toBe(join(w.root, "control", "panel"));
  });

  it("B2: the file's controlStateDir and projects are used; --control-state-dir still wins", async () => {
    const w = world();
    const a = w.gitRepo("a");
    mkdirSync(join(w.root, "home"));
    writeFileSync(w.file, JSON.stringify({ version: 1, controlStateDir: join(w.root, "state"), projects: [{ id: "a", name: "A", path: a }] }));
    const opts = parsePanelArgs(["--by", "tester", "--projects-file", w.file], w.env);
    expect(opts.repos).toEqual([{ projectKey: "a", path: a }]);
    expect(opts.control.stateDir).toBe(join(w.root, "state"));
    expect(parsePanelArgs(["--by", "tester", "--projects-file", w.file, "--control-state-dir", join(w.root, "x")], w.env).control.stateDir).toBe(join(w.root, "x"));
  });

  it("B3: an invalid file refuses to start; --projects-file with --repo or --root is refused", () => {
    const w = world();
    mkdirSync(join(w.root, "home"));
    writeFileSync(w.file, "{");
    const code = (args: string[]): string => { try { parsePanelArgs(["--by", "t", ...args], w.env); return "none"; } catch (e) { return (e as { code: string }).code; } };
    expect(code(["--projects-file", w.file])).toBe("projects-file-invalid");
    expect(code(["--projects-file", w.file, "--repo", `a=${w.root}`])).toBe("projects-file-with-repo");
    expect(code(["--projects-file", w.file, "--root", w.root])).toBe("projects-file-with-repo");
    expect(code(["--projects-file", ""])).toBe("malformed-projects-file-argument");
  });

  it("B4: add and rename over HTTP take effect with no restart, in the API and in the control config", async () => {
    const w = world();
    const { call } = await boot(["--projects-file", w.file], w.env);
    expect((await call("GET", "/api/projects")).body).toEqual({ source: "file", editable: true, projects: [], pendingRestart: [], fileError: null });
    const repo = w.gitRepo("web");
    const added = await call("POST", "/api/projects", { name: "Web", path: repo });
    expect(added).toEqual({ status: 201, body: { project: { projectKey: "web", name: "Web", path: repo, controlRepoId: controlRepoKey("web") } } });
    const config = await call("GET", "/api/control/config");
    expect((config.body.repositories as unknown[])).toEqual([{ repoId: controlRepoKey("web"), displayName: "Web" }]);
    const renamed = await call("PATCH", "/api/projects/web", { name: "Web App" });
    expect(renamed.status).toBe(200);
    expect(((await call("GET", "/api/control/config")).body.repositories as unknown[])).toEqual([{ repoId: controlRepoKey("web"), displayName: "Web App" }]);
    const read = readProjectsFile(w.file);
    expect(read.kind === "valid" && read.config.projects).toEqual([{ id: "web", name: "Web App", path: repo }]);
  });

  it("B5: refusals come back with their status and code", async () => {
    const w = world();
    const { call } = await boot(["--projects-file", w.file], w.env);
    expect(await call("POST", "/api/projects", { name: "X", path: join(w.root, "absent") })).toMatchObject({ status: 422, body: { code: "project-path-missing" } });
    expect(await call("POST", "/api/projects", { name: 1, path: "/x" })).toMatchObject({ status: 400, body: { code: "panel-bad-request" } });
    expect(await call("PATCH", "/api/projects/none", { name: "X" })).toMatchObject({ status: 404, body: { code: "project-unknown" } });
  });

  it("B6: two concurrent adds both land", async () => {
    const w = world();
    const { call } = await boot(["--projects-file", w.file], w.env);
    const [one, two] = await Promise.all([call("POST", "/api/projects", { name: "One", path: w.gitRepo("one") }), call("POST", "/api/projects", { name: "Two", path: w.gitRepo("two") })]);
    expect([one.status, two.status]).toEqual([201, 201]);
    const read = readProjectsFile(w.file);
    expect(read.kind === "valid" && read.config.projects.map((p) => p.id).sort()).toEqual(["one", "two"]);
  });
});

describe("command-line mode", () => {
  it("C1: --repo answers source command-line, editable false, and refuses add and rename", async () => {
    const w = world();
    const repo = w.gitRepo("proj");
    const { call } = await boot(["--repo", `proj=${repo}`], w.env);
    expect((await call("GET", "/api/projects")).body).toEqual({
      source: "command-line", editable: false, pendingRestart: [], fileError: null,
      projects: [{ projectKey: "proj", name: "proj", path: repo, controlRepoId: controlRepoKey("proj") }],
    });
    expect(await call("POST", "/api/projects", { name: "X", path: repo })).toMatchObject({ status: 409, body: { code: "projects-from-command-line" } });
    expect(await call("PATCH", "/api/projects/proj", { name: "X" })).toMatchObject({ status: 409, body: { code: "projects-from-command-line" } });
  });
});

describe("process boundary", () => {
  it("D1: the real orca panel adds --projects-file only when none of --repo, --root, --projects-file is given", () => {
    const env = { ORCA_PROJECTS_FILE: "/x/p.json" };
    expect(panelArgsWithDefaultProjects(["--by", "a"], env)).toEqual(["--by", "a", "--projects-file", "/x/p.json"]);
    for (const flag of ["--repo", "--root", "--projects-file"]) expect(panelArgsWithDefaultProjects(["--by", "a", flag, "v"], env)).toEqual(["--by", "a", flag, "v"]);
  });
});
