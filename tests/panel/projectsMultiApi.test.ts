/**
 * Multi-directory projects spec §4.2 (M2) and §4.1's loader rule: `POST /api/projects` takes either `path` or `dirs`,
 * `PATCH` renames or replaces the order, `GET` adds a multi row while every single row keeps its shape, and a file entry
 * with a broken member reference is skipped alone and named -- every other project still loads.
 */
import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { controlRepoKey } from "../../src/panel/controlOptions.js";
import { createProjectRegistry, ProjectRegistryError, type ProjectRegistry, type RegistryControl } from "../../src/panel/projectRegistry.js";
import { PANEL_BAD_REQUEST } from "../../src/panel/rejection.js";
import { listProjects, projectsDepsOf, registerProjectRoutes } from "../../src/panel/projects.js";
import { readProjectsFile, writeProjectsFile, type MultiDirProjectEntryV1, type ProjectEntryV1, type ProjectsFileV1 } from "../../src/panel/projectsFile.js";

let server: Server | undefined;
afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

async function listen(app: express.Express): Promise<string> {
  server = createServer(app);
  await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server has no port");
  return `http://127.0.0.1:${address.port}`;
}

const root = (): string => realpathSync(mkdtempSync(join(tmpdir(), "projects-multi-api-")));
const repo = (parent: string, name: string): string => {
  const dir = join(parent, name);
  mkdirSync(dir);
  execFileSync("git", ["-c", "init.defaultBranch=main", "init", "-q"], { cwd: dir, stdio: "ignore" });
  return dir;
};

interface World { dir: string; file: string; repos: Array<{ projectKey: string; path: string }>; registry: ProjectRegistry }
function world(members: ProjectEntryV1[], multis: MultiDirProjectEntryV1[] = [], control: RegistryControl | null = null): World {
  const dir = root();
  const file = join(dir, "projects.json");
  const config: ProjectsFileV1 = { version: 1, projects: members, ...(multis.length === 0 ? {} : { multiDirProjects: multis }) };
  writeProjectsFile(file, config);
  const repos = members.map((p) => ({ projectKey: p.id, path: p.path }));
  return { dir, file, repos, registry: createProjectRegistry({ file, boot: readProjectsFile(file), repos, control }) };
}

async function apiFor(w: World): Promise<string> {
  const app = express();
  app.use(express.json());
  const deps = projectsDepsOf({ root: w.dir, repos: w.repos }, w.registry, true, (key) => (key === "shop" ? controlRepoKey("shop") : null));
  registerProjectRoutes(app, deps);
  return listen(app);
}

const refusal = async (promise: Promise<unknown>): Promise<string> => {
  try { await promise; return "none"; }
  catch (error) { return error instanceof ProjectRegistryError ? `${error.status}:${error.code}` : `other:${(error as Error).message}`; }
};

function members(pairs: Array<[string, string]>): ProjectEntryV1[] {
  return pairs.map(([id, path]) => ({ id, name: id[0]!.toUpperCase() + id.slice(1), path }));
}

function bareWorld(pairs: Array<[string, string]>, multis: MultiDirProjectEntryV1[] = [], control: RegistryControl | null = null): World {
  return world(members(pairs), multis, control);
}

describe("POST /api/projects with dirs", () => {
  it("M2: creates a multi project, writes the key and answers the multi row", async () => {
    const w = bareWorld([["alpha", join(root(), "alpha")], ["beta", join(root(), "beta")]]);
    const alpha = w.repos.find((r) => r.projectKey === "alpha")!.path;
    const beta = w.repos.find((r) => r.projectKey === "beta")!.path;
    const url = await apiFor(w);
    const res = await fetch(`${url}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Shop", dirs: ["alpha", "beta"] }) });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ project: {
      projectKey: "shop", name: "Shop", path: alpha, kind: "multi",
      dirs: [{ projectKey: "alpha", kind: "repo" }, { projectKey: "beta", kind: "repo" }],
      controlRepoId: controlRepoKey("shop"),
    } });
    const read = readProjectsFile(w.file);
    expect(read.kind === "valid" && read.config.multiDirProjects).toEqual([{ id: "shop", name: "Shop", dirs: ["alpha", "beta"] }]);
    expect(read.kind === "valid" && read.config.projects.map((p) => [p.id, p.path])).toEqual([["alpha", alpha], ["beta", beta]]);

    const list = await (await fetch(`${url}/api/projects`)).json() as { projects: Array<Record<string, unknown>> };
    expect(list.projects.find((row) => row.projectKey === "alpha")).toEqual({ projectKey: "alpha", name: "Alpha", path: alpha, controlRepoId: controlRepoKey("alpha") });
    expect(list.projects.find((row) => row.projectKey === "beta")).toEqual({ projectKey: "beta", name: "Beta", path: beta, controlRepoId: controlRepoKey("beta") });
    expect(list.projects.find((row) => row.projectKey === "shop")).toEqual({
      projectKey: "shop", name: "Shop", path: alpha, kind: "multi",
      dirs: [{ projectKey: "alpha", kind: "repo" }, { projectKey: "beta", kind: "repo" }],
      controlRepoId: controlRepoKey("shop"),
    });
  });

  it("M2: path and dirs together, or neither, is 400; dirs must be an array of strings", async () => {
    const w = bareWorld([["alpha", join(root(), "alpha")], ["beta", join(root(), "beta")]]);
    const url = await apiFor(w);
    const post = (body: unknown): Promise<Response> => fetch(`${url}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    for (const body of [{ name: "Both", path: "/tmp", dirs: ["alpha", "beta"] }, { name: "Neither" }, { name: "Bad", dirs: "alpha" }, { name: "Bad", dirs: ["alpha", 3] }]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect((await res.json() as { code: string }).code).toBe(PANEL_BAD_REQUEST);
    }
    const read = readProjectsFile(w.file);
    expect(read.kind === "valid" && read.config.multiDirProjects).toBeUndefined();
  });

  it("M2: a single dir project's row keeps its kind and shape", async () => {
    const dirPath = join(root(), "folder");
    mkdirSync(dirPath);
    const w = bareWorld([["alpha", join(root(), "alpha")]]);
    writeProjectsFile(w.file, { version: 1, projects: [{ id: "alpha", name: "Alpha", path: w.repos[0]!.path }, { id: "folder", name: "Folder", path: dirPath, kind: "dir" }] });
    const registry = createProjectRegistry({ file: w.file, boot: readProjectsFile(w.file), repos: w.repos, control: null });
    const url = await apiFor({ ...w, registry });
    const list = await (await fetch(`${url}/api/projects`)).json() as { projects: Array<Record<string, unknown>> };
    expect(list.projects.find((row) => row.projectKey === "folder")).toEqual({ projectKey: "folder", name: "Folder", path: dirPath, kind: "dir", controlRepoId: null });
  });
});

describe("PATCH /api/projects/:id with dirs", () => {
  it("M2: replaces the order, changes the primary path, and still renames", async () => {
    const a = join(root(), "alpha");
    const b = join(root(), "beta");
    const w = bareWorld([["alpha", a], ["beta", b]], [{ id: "shop", name: "Shop", dirs: ["alpha", "beta"] }]);
    const url = await apiFor(w);
    const patch = (body: unknown): Promise<Response> => fetch(`${url}/api/projects/shop`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const ordered = await patch({ dirs: ["beta", "alpha"] });
    expect(ordered.status).toBe(200);
    expect(await ordered.json()).toEqual({ project: {
      projectKey: "shop", name: "Shop", path: b, kind: "multi",
      dirs: [{ projectKey: "beta", kind: "repo" }, { projectKey: "alpha", kind: "repo" }],
      controlRepoId: controlRepoKey("shop"),
    } });
    expect((readProjectsFile(w.file) as { config: ProjectsFileV1 }).config.multiDirProjects).toEqual([{ id: "shop", name: "Shop", dirs: ["beta", "alpha"] }]);
    const renamed = await patch({ name: "Shop Two" });
    expect(renamed.status).toBe(200);
    expect((await renamed.json() as { project: { name: string } }).project.name).toBe("Shop Two");
    expect(w.registry.list().multiDirProjects).toEqual([{ id: "shop", name: "Shop Two", dirs: ["beta", "alpha"] }]);
  });

  it("M2: name and dirs together, or neither, is 400", async () => {
    const w = bareWorld([["alpha", join(root(), "alpha")], ["beta", join(root(), "beta")]], [{ id: "shop", name: "Shop", dirs: ["alpha", "beta"] }]);
    const url = await apiFor(w);
    for (const body of [{ name: "Shop Two", dirs: ["alpha", "beta"] }, {}]) {
      const res = await fetch(`${url}/api/projects/shop`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      expect(res.status).toBe(400);
    }
  });
});

describe("multi rename and the primary row", () => {
  it("M2: a multi rename calls renameMulti and never the single-repository rename; a single rename still calls rename", async () => {
    const calls: string[] = [];
    const control: RegistryControl = {
      check: () => {}, add: () => {},
      rename: (repoId) => {
        calls.push(`rename:${repoId}`);
        if (repoId === controlRepoKey("shop")) throw new Error("control-target-not-allowed");
      },
      renameMulti: (repoId) => calls.push(`renameMulti:${repoId}`),
    };
    const w = bareWorld([["alpha", join(root(), "alpha")], ["beta", join(root(), "beta")]], [{ id: "shop", name: "Shop", dirs: ["alpha", "beta"] }], control);
    calls.length = 0;
    const url = await apiFor(w);
    const multi = await fetch(`${url}/api/projects/shop`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Shop Two" }) });
    expect(multi.status).toBe(200);
    expect((await multi.json() as { project: { name: string } }).project.name).toBe("Shop Two");
    expect(calls).toEqual([`renameMulti:${controlRepoKey("shop")}`]);
    expect(w.registry.list().multiDirProjects).toEqual([{ id: "shop", name: "Shop Two", dirs: ["alpha", "beta"] }]);

    calls.length = 0;
    const single = await fetch(`${url}/api/projects/alpha`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Alpha Two" }) });
    expect(single.status).toBe(200);
    expect(calls).toEqual([`rename:${controlRepoKey("alpha")}`]);
  });

  it("M2: a hand-edited multi name calls renameMulti, not the single-repository rename", () => {
    const calls: string[] = [];
    const control: RegistryControl = {
      check: () => {}, add: () => {},
      rename: (repoId) => {
        calls.push(`rename:${repoId}`);
        if (repoId === controlRepoKey("shop")) throw new Error("control-target-not-allowed");
      },
      renameMulti: (repoId) => calls.push(`renameMulti:${repoId}`),
    };
    const a = join(root(), "alpha");
    const b = join(root(), "beta");
    const w = bareWorld([["alpha", a], ["beta", b]], [{ id: "shop", name: "Shop", dirs: ["alpha", "beta"] }], control);
    calls.length = 0;
    writeProjectsFile(w.file, { version: 1, projects: [{ id: "alpha", name: "Alpha", path: a }, { id: "beta", name: "Beta", path: b }], multiDirProjects: [{ id: "shop", name: "Shop Two", dirs: ["alpha", "beta"] }] });
    const view = w.registry.list();
    expect(view.multiDirProjects).toEqual([{ id: "shop", name: "Shop Two", dirs: ["alpha", "beta"] }]);
    expect(view.fileError).toBeNull();
    expect(calls).toEqual([`renameMulti:${controlRepoKey("shop")}`]);
  });

  it("M2: a hand edit that renames a multi and drops one of its members applies the new name and keeps the multi pending", () => {
    const a = join(root(), "alpha");
    const b = join(root(), "beta");
    const calls: string[] = [];
    const control: RegistryControl = {
      check: () => {}, add: () => {}, rename: () => {},
      renameMulti: (repoId, name) => calls.push(`${repoId}:${name}`),
    };
    const w = bareWorld([["alpha", a], ["beta", b]], [{ id: "shop", name: "Shop", dirs: ["alpha", "beta"] }], control);
    calls.length = 0;
    writeProjectsFile(w.file, { version: 1, projects: [{ id: "alpha", name: "Alpha", path: a }], multiDirProjects: [{ id: "shop", name: "Shop Two", dirs: ["alpha", "beta"] }] });
    const view = w.registry.list();
    expect(view.multiDirProjects).toEqual([{ id: "shop", name: "Shop Two", dirs: ["alpha", "beta"] }]);
    expect(view.pendingRestart).toContain("multi:shop");
    expect(view.fileError).toMatch(/multi-dir-member-unknown:beta/);
    expect(calls).toEqual([`${controlRepoKey("shop")}:Shop Two`]);
  });

  it("M2: a multi primary of kind dir keeps the folder path and the member kinds on GET", async () => {
    const folder = join(root(), "folder");
    mkdirSync(folder);
    const w = world(
      [{ id: "folder", name: "Folder", path: folder, kind: "dir" }, { id: "alpha", name: "Alpha", path: join(root(), "alpha") }],
      [{ id: "shop", name: "Shop", dirs: ["folder", "alpha"] }],
    );
    const url = await apiFor(w);
    const list = await (await fetch(`${url}/api/projects`)).json() as { projects: Array<Record<string, unknown>> };
    expect(list.projects.find((row) => row.projectKey === "shop")).toEqual({
      projectKey: "shop", name: "Shop", path: folder, kind: "multi",
      dirs: [{ projectKey: "folder", kind: "dir" }, { projectKey: "alpha", kind: "repo" }],
      controlRepoId: controlRepoKey("shop"),
    });
  });
});

describe("registry multi API", () => {
  it("M2: refusals by name: too few, too many, unknown, duplicate, not single, nested, name taken", async () => {
    const paths = Array.from({ length: 9 }, (_, i) => join(root(), `p${i + 1}`));
    const w = bareWorld(paths.map((path, i) => [`p${i + 1}`, path]));
    const reg = w.registry;
    expect(await refusal(Promise.resolve().then(() => reg.addMulti("Few", ["p1"])))).toBe("422:multi-dir-too-few");
    expect(await refusal(Promise.resolve().then(() => reg.addMulti("Many", ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9"])))).toBe("422:multi-dir-too-many");
    expect(await refusal(Promise.resolve().then(() => reg.addMulti("Ghost", ["p1", "nope"])))).toBe("422:multi-dir-member-unknown:nope");
    expect(await refusal(Promise.resolve().then(() => reg.addMulti("Twice", ["p1", "p1"])))).toBe("422:multi-dir-member-duplicate:p1");
    expect(await refusal(Promise.resolve().then(() => reg.addMulti("P1", ["p1", "p2"])))).toBe("409:project-name-taken");
    reg.addMulti("Shop", ["p1", "p2"]);
    expect(await refusal(Promise.resolve().then(() => reg.addMulti("Nested", ["shop", "p3"])))).toBe("422:multi-dir-member-not-single:shop");
    expect(await refusal(Promise.resolve().then(() => reg.addMulti("Shop", ["p1", "p3"])))).toBe("409:project-name-taken");

    const nestedRoot = root();
    mkdirSync(join(nestedRoot, "outer"));
    mkdirSync(join(nestedRoot, "outer", "inner"));
    const nestedWorld = bareWorld([["outer", join(nestedRoot, "outer")], ["inner", join(nestedRoot, "outer", "inner")]]);
    expect(await refusal(Promise.resolve().then(() => nestedWorld.registry.addMulti("Nest", ["outer", "inner"])))).toBe("422:multi-dir-member-nested:outer:inner");
  });

  it("M2: setDirs applies the same checks and replaces the order", async () => {
    const w = bareWorld([["alpha", join(root(), "alpha")], ["beta", join(root(), "beta")], ["gamma", join(root(), "gamma")]], [{ id: "shop", name: "Shop", dirs: ["alpha", "beta"] }]);
    expect(await refusal(Promise.resolve().then(() => w.registry.setDirs("shop", ["alpha"])))).toBe("422:multi-dir-too-few");
    expect(await refusal(Promise.resolve().then(() => w.registry.setDirs("shop", ["alpha", "nope"])))).toBe("422:multi-dir-member-unknown:nope");
    expect(await refusal(Promise.resolve().then(() => w.registry.setDirs("alpha", ["beta", "gamma"])))).toBe("404:project-unknown");
    expect(w.registry.setDirs("shop", ["gamma", "alpha"])).toEqual({ id: "shop", name: "Shop", dirs: ["gamma", "alpha"] });
    expect((readProjectsFile(w.file) as { config: ProjectsFileV1 }).config.multiDirProjects).toEqual([{ id: "shop", name: "Shop", dirs: ["gamma", "alpha"] }]);
  });

  it("M2: nested members are refused in either order and through a symlink to the same real directory", async () => {
    const base = root();
    mkdirSync(join(base, "outer"));
    mkdirSync(join(base, "outer", "inner"));
    const nested = bareWorld([["outer", join(base, "outer")], ["inner", join(base, "outer", "inner")]]);
    expect(await refusal(Promise.resolve().then(() => nested.registry.addMulti("Nest", ["inner", "outer"])))).toBe("422:multi-dir-member-nested:inner:outer");
    expect(await refusal(Promise.resolve().then(() => nested.registry.addMulti("Nest", ["outer", "inner"])))).toBe("422:multi-dir-member-nested:outer:inner");

    const same = root();
    mkdirSync(join(same, "real"));
    symlinkSync(join(same, "real"), join(same, "alias"));
    const twin = bareWorld([["real", join(same, "real")], ["alias", join(same, "alias")]]);
    expect(twin.registry.list().fileError).toBeNull();
    expect(await refusal(Promise.resolve().then(() => twin.registry.addMulti("Twin", ["real", "alias"])))).toBe("422:multi-dir-member-nested:real:alias");
  });

  it("M2: a name starting with two dots is a plain component, not a step up", async () => {
    const base = root();
    mkdirSync(join(base, "app"));
    mkdirSync(join(base, "app", "..cache"));
    mkdirSync(join(base, "..cache"));
    const child = bareWorld([["app", join(base, "app")], ["cache", join(base, "app", "..cache")]]);
    expect(await refusal(Promise.resolve().then(() => child.registry.addMulti("Pair", ["app", "cache"])))).toBe("422:multi-dir-member-nested:app:cache");
    const sibling = bareWorld([["app", join(base, "app")], ["cache", join(base, "..cache")]]);
    expect(sibling.registry.addMulti("Siblings", ["app", "cache"])).toEqual({ id: "siblings", name: "Siblings", dirs: ["app", "cache"] });
  });

  it("M2: two spellings of one directory are one tree on a case-insensitive filesystem, two trees elsewhere", async () => {
    const base = root();
    mkdirSync(join(base, "CaseDir"));
    const upper = join(base, "CaseDir");
    const lower = join(base, "casedir");
    // The probe both branches need: on a case-insensitive filesystem the mkdir is a no-op over CaseDir.
    try { mkdirSync(lower); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const upperStat = statSync(upper);
    const lowerStat = statSync(lower);
    const w = bareWorld([["upper", upper], ["lower", lower]]);
    expect(w.registry.list().fileError).toBeNull();
    if (upperStat.dev === lowerStat.dev && upperStat.ino === lowerStat.ino) {
      expect(await refusal(Promise.resolve().then(() => w.registry.addMulti("Twin", ["upper", "lower"])))).toBe("422:multi-dir-member-nested:upper:lower");
    } else {
      expect(lowerStat.isDirectory()).toBe(true);
      expect(w.registry.addMulti("Twin", ["upper", "lower"])).toEqual({ id: "twin", name: "Twin", dirs: ["upper", "lower"] });
      expect(w.registry.list().multiDirProjects).toEqual([{ id: "twin", name: "Twin", dirs: ["upper", "lower"] }]);
    }
  });

  it("M2: a case-variant path below one tree is that tree on a case-insensitive filesystem, distinct elsewhere", async () => {
    const base = root();
    mkdirSync(join(base, "Repo"));
    mkdirSync(join(base, "Repo", "sub"));
    const upper = join(base, "Repo");
    const lower = join(base, "repo", "sub");
    // A real lowercase mirror keeps both members existing directories on a case-sensitive filesystem.
    mkdirSync(join(base, "repo"), { recursive: true });
    mkdirSync(join(base, "repo", "sub"), { recursive: true });
    const upperStat = statSync(upper);
    const mirrorStat = statSync(join(base, "repo"));
    const w = bareWorld([["upper", upper], ["lower", lower]]);
    expect(w.registry.list().fileError).toBeNull();
    if (upperStat.dev === mirrorStat.dev && upperStat.ino === mirrorStat.ino) {
      expect(await refusal(Promise.resolve().then(() => w.registry.addMulti("Nest", ["upper", "lower"])))).toBe("422:multi-dir-member-nested:upper:lower");
    } else {
      expect(statSync(lower).ino).not.toBe(upperStat.ino);
      expect(w.registry.addMulti("Nest", ["upper", "lower"])).toEqual({ id: "nest", name: "Nest", dirs: ["upper", "lower"] });
      expect(w.registry.list().multiDirProjects).toEqual([{ id: "nest", name: "Nest", dirs: ["upper", "lower"] }]);
    }
  });

  it("M2: a throwing setMultiDirs keeps the old order and retries on the next edit", () => {
    const a = join(root(), "alpha");
    const b = join(root(), "beta");
    const calls: string[] = [];
    let refuse = true;
    const control: RegistryControl = {
      check: () => {}, add: () => {}, rename: () => {},
      setMultiDirs: (repoId, dirs) => {
        if (refuse) { refuse = false; throw new Error("control-busy"); }
        calls.push(`${repoId}:${dirs.map((member) => member.key).join(",")}`);
      },
    };
    const w = bareWorld([["alpha", a], ["beta", b]], [{ id: "shop", name: "Shop", dirs: ["alpha", "beta"] }], control);
    const reordered: ProjectsFileV1 = { version: 1, projects: [{ id: "alpha", name: "Alpha", path: a }, { id: "beta", name: "Beta", path: b }], multiDirProjects: [{ id: "shop", name: "Shop", dirs: ["beta", "alpha"] }] };
    writeProjectsFile(w.file, reordered);
    const first = w.registry.list();
    expect(first.fileError).toBe("multi shop: control-busy");
    expect(first.multiDirProjects).toEqual([{ id: "shop", name: "Shop", dirs: ["alpha", "beta"] }]);
    writeProjectsFile(w.file, reordered);
    const second = w.registry.list();
    expect(second.fileError).toBeNull();
    expect(second.multiDirProjects).toEqual([{ id: "shop", name: "Shop", dirs: ["beta", "alpha"] }]);
    expect(calls).toEqual([`${controlRepoKey("shop")}:beta,alpha`]);
  });

  it("M2: a throwing renameMulti fails that entry alone and retries on the next edit", () => {
    const a = join(root(), "alpha");
    const b = join(root(), "beta");
    const c = join(root(), "gamma");
    const calls: string[] = [];
    let refuse = true;
    const control: RegistryControl = {
      check: () => {}, add: () => {}, rename: () => {},
      renameMulti: (repoId, name) => {
        if (repoId === controlRepoKey("shop") && refuse) { refuse = false; throw new Error("control-target-not-allowed"); }
        calls.push(`${repoId}:${name}`);
      },
    };
    const w = bareWorld(
      [["alpha", a], ["beta", b], ["gamma", c]],
      [{ id: "shop", name: "Shop", dirs: ["alpha", "beta"] }, { id: "store", name: "Store", dirs: ["beta", "gamma"] }],
      control,
    );
    const edited: ProjectsFileV1 = {
      version: 1,
      projects: [{ id: "alpha", name: "Alpha", path: a }, { id: "beta", name: "Beta", path: b }, { id: "gamma", name: "Gamma", path: c }],
      multiDirProjects: [{ id: "shop", name: "Shop Two", dirs: ["alpha", "beta"] }, { id: "store", name: "Store Two", dirs: ["beta", "gamma"] }],
    };
    writeProjectsFile(w.file, edited);
    const first = w.registry.list();
    expect(first.fileError).toBe("multi shop: control-target-not-allowed");
    expect(first.multiDirProjects).toEqual([
      { id: "shop", name: "Shop", dirs: ["alpha", "beta"] },
      { id: "store", name: "Store Two", dirs: ["beta", "gamma"] },
    ]);
    expect(calls).toEqual([`${controlRepoKey("store")}:Store Two`]);
    writeProjectsFile(w.file, edited);
    const second = w.registry.list();
    expect(second.fileError).toBeNull();
    expect(second.multiDirProjects?.find((multi) => multi.id === "shop")?.name).toBe("Shop Two");
  });

  it("M2: a projects-file-changed 409 leaves the file and the runtime multi list untouched", async () => {
    const a = join(root(), "alpha");
    const b = join(root(), "beta");
    const c = join(root(), "gamma");
    const calls: string[] = [];
    const control: RegistryControl = {
      check: () => {}, add: () => {}, rename: () => {},
      addMulti: (entry) => calls.push(`add:${entry.repoId}`),
      setMultiDirs: (repoId) => calls.push(`dirs:${repoId}`),
    };
    const w = bareWorld([["alpha", a], ["beta", b], ["gamma", c]], [{ id: "shop", name: "Shop", dirs: ["alpha", "beta"] }], control);
    const read = readProjectsFile(w.file);
    if (read.kind !== "valid") throw new Error("fixture is not valid");
    const registry = createProjectRegistry({ file: w.file, boot: { ...read, hash: "stale" }, repos: w.repos, control });
    calls.length = 0;
    const before = readFileSync(w.file);
    expect(await refusal(Promise.resolve().then(() => registry.addMulti("Shop Two", ["alpha", "gamma"])))).toBe("409:projects-file-changed");
    expect(await refusal(Promise.resolve().then(() => registry.setDirs("shop", ["gamma", "alpha"])))).toBe("409:projects-file-changed");
    expect(registry.list().multiDirProjects).toEqual([{ id: "shop", name: "Shop", dirs: ["alpha", "beta"] }]);
    expect(readFileSync(w.file).equals(before)).toBe(true);
    expect(calls).toEqual([]);
  });

  it("M2: add suffixes around a taken multi id and refuses a multi name", async () => {
    const w = bareWorld([["alpha", join(root(), "alpha")], ["beta", join(root(), "beta")]], [{ id: "shop", name: "Shop", dirs: ["alpha", "beta"] }]);
    const first = w.registry.add("shop", repo(w.dir, "another"));
    expect(first.id).toBe("shop-2");
    expect(await refusal(Promise.resolve().then(() => w.registry.add("Shop", repo(w.dir, "third"))))).toBe("409:project-name-taken");
  });
});

describe("single-project writes keep the multi key", () => {
  it("M2: a single add and a single rename leave multiDirProjects and its entries intact on disk", () => {
    const a = join(root(), "alpha");
    const b = join(root(), "beta");
    const w = bareWorld([["alpha", a], ["beta", b]], [{ id: "shop", name: "Shop", dirs: ["alpha", "beta"] }]);
    const onDisk = (): ProjectsFileV1 => JSON.parse(readFileSync(w.file, "utf8")) as ProjectsFileV1;
    expect(onDisk().multiDirProjects).toEqual([{ id: "shop", name: "Shop", dirs: ["alpha", "beta"] }]);

    w.registry.add("Another", repo(w.dir, "another"));
    expect(onDisk().projects.map((p) => p.id)).toEqual(["alpha", "beta", "another"]);
    expect(onDisk().multiDirProjects).toEqual([{ id: "shop", name: "Shop", dirs: ["alpha", "beta"] }]);

    w.registry.rename("alpha", "Alpha Two");
    expect(onDisk().projects.find((p) => p.id === "alpha")).toEqual({ id: "alpha", name: "Alpha Two", path: a });
    expect(onDisk().multiDirProjects).toEqual([{ id: "shop", name: "Shop", dirs: ["alpha", "beta"] }]);
  });

  it("M2: a hand edit that drops a running multi's member keeps it running until restart", () => {
    const a = join(root(), "alpha");
    const b = join(root(), "beta");
    const calls: string[] = [];
    const control: RegistryControl = { check: () => {}, add: () => {}, rename: () => {}, removeMulti: (repoId) => calls.push(repoId) };
    const invalid = bareWorld([["alpha", a], ["beta", b]], [{ id: "shop", name: "Shop", dirs: ["alpha", "beta"] }], control);
    writeProjectsFile(invalid.file, { version: 1, projects: [{ id: "alpha", name: "Alpha", path: a }, { id: "beta", name: "Beta", path: b }], multiDirProjects: [{ id: "shop", name: "Shop", dirs: ["alpha", "ghost"] }] });
    expect(invalid.registry.list().fileError).toMatch(/multi-dir-member-unknown:ghost/);
    expect(calls).toEqual([controlRepoKey("shop")]);

    calls.length = 0;
    const gone = bareWorld([["alpha", a], ["beta", b]], [{ id: "shop", name: "Shop", dirs: ["alpha", "beta"] }], control);
    writeProjectsFile(gone.file, { version: 1, projects: [{ id: "alpha", name: "Alpha", path: a }], multiDirProjects: [{ id: "shop", name: "Shop", dirs: ["alpha", "beta"] }] });
    const view = gone.registry.list();
    expect(view.fileError).toMatch(/multi-dir-member-unknown:beta/);
    expect(view.multiDirProjects).toEqual([{ id: "shop", name: "Shop", dirs: ["alpha", "beta"] }]);
    expect(view.pendingRestart).toContain("multi:shop");
    expect(calls).toEqual([]);
  });
});

describe("the loader", () => {
  it("M2: a broken multi entry is skipped alone and named; every other project and multi entry loads", () => {
    const base = root();
    mkdirSync(join(base, "a"));
    mkdirSync(join(base, "a", "sub"));
    mkdirSync(join(base, "c"));
    const calls: string[] = [];
    const control: RegistryControl = { check: () => {}, add: () => {}, rename: () => {}, addMulti: (entry) => calls.push(entry.repoId) };
    const w = bareWorld(
      [["a", join(base, "a")], ["b", join(base, "a", "sub")], ["c", join(base, "c")]],
      [
        { id: "m1", name: "M1", dirs: ["a", "c"] },
        { id: "m2", name: "M2", dirs: ["a", "ghost"] },
        { id: "m3", name: "M3", dirs: ["m1", "a"] },
        { id: "m4", name: "M4", dirs: ["a", "b"] },
      ],
      control,
    );
    const view = w.registry.list();
    expect(view.projects.map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(view.multiDirProjects).toEqual([{ id: "m1", name: "M1", dirs: ["a", "c"] }]);
    expect(view.fileError).toMatch(/multi-dir-member-unknown:ghost/);
    expect(view.fileError).toMatch(/multi-dir-member-not-single:m1/);
    expect(view.fileError).toMatch(/multi-dir-member-nested:a:b/);
    expect(calls).toEqual([controlRepoKey("m1")]);
  });

  it("M2: a member path change puts the multi project in pendingRestart instead of re-resolving", () => {
    const a = join(root(), "alpha");
    const b = join(root(), "beta");
    const c = join(root(), "gamma");
    const w = bareWorld([["alpha", a], ["beta", b]], [{ id: "shop", name: "Shop", dirs: ["alpha", "beta"] }]);
    expect(w.registry.list().pendingRestart).toEqual([]);
    writeProjectsFile(w.file, { version: 1, projects: [{ id: "alpha", name: "Alpha", path: c }, { id: "beta", name: "Beta", path: b }], multiDirProjects: [{ id: "shop", name: "Shop", dirs: ["alpha", "beta"] }] });
    const view = w.registry.list();
    expect(view.pendingRestart).toContain("multi:shop");
    expect(view.multiDirProjects).toEqual([{ id: "shop", name: "Shop", dirs: ["alpha", "beta"] }]);
  });

  it("M2: a hand edit that adds a multi entry applies at runtime", () => {
    const a = join(root(), "alpha");
    const b = join(root(), "beta");
    const w = bareWorld([["alpha", a], ["beta", b]]);
    expect(w.registry.list().multiDirProjects).toBeUndefined();
    writeFileSync(w.file, `${JSON.stringify({ version: 1, projects: [{ id: "alpha", name: "Alpha", path: a }, { id: "beta", name: "Beta", path: b }], multiDirProjects: [{ id: "shop", name: "Shop", dirs: ["alpha", "beta"] }] }, null, 2)}\n`);
    expect(w.registry.list().multiDirProjects).toEqual([{ id: "shop", name: "Shop", dirs: ["alpha", "beta"] }]);
    expect(w.registry.list().pendingRestart).toEqual([]);
  });
});

describe("the control seam", () => {
  it("M2: with the control plane on, the multi row carries the id the multi map answers", async () => {
    const asked: string[] = [];
    const w = bareWorld([["alpha", join(root(), "alpha")], ["beta", join(root(), "beta")]], [{ id: "shop", name: "Shop", dirs: ["alpha", "beta"] }]);
    const deps = projectsDepsOf({ root: w.dir, repos: w.repos }, w.registry, true,
      (key) => { asked.push(key); return key === "shop" ? controlRepoKey("shop") : null; });
    const list = await listProjects(deps) as { projects: Array<Record<string, unknown>> };
    expect(list.projects.find((row) => row.projectKey === "shop")?.controlRepoId).toBe(controlRepoKey("shop"));
    expect(asked).toEqual(["shop"]);
  });

  it("M2: with the control plane off, projectsDepsOf answers no controlRepoId and never asks the multi map", () => {
    const asked: string[] = [];
    const deps = projectsDepsOf(
      { root: root(), repos: [{ projectKey: "alpha", path: "/r/alpha" }] }, null, false,
      (key) => { asked.push(key); return controlRepoKey(key); },
    );
    expect(deps.controlRepoId("alpha")).toBeNull();
    expect(deps.multiControlRepoId).toBeUndefined();
    expect(asked).toEqual([]);
  });
});
