/**
 * Project registry spec §5 / §12 C2–C4: the registry is the one writer of the projects file inside the panel, and
 * the one thing that changes the running project list. Hand edits are picked up by a signature check on read;
 * additions and renames apply, removals and path changes wait for a restart and say so.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createProjectRegistry, ProjectRegistryError, type RegistryControl } from "../../src/panel/projectRegistry.js";
import { readProjectsFile, writeProjectsFile, type ProjectsFileV1 } from "../../src/panel/projectsFile.js";
import { controlRepoKey } from "../../src/panel/controlOptions.js";

function world() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "registry-")));
  const gitRepo = (name: string): string => {
    const dir = join(root, name);
    mkdirSync(dir);
    execFileSync("git", ["-c", "init.defaultBranch=main", "init", "-q"], { cwd: dir });
    return dir;
  };
  const file = join(root, "home", "projects.json");
  const calls: string[] = [];
  const control: RegistryControl = {
    check: (e) => { if (e.path.includes("refused")) throw new Error("control-path-escape"); },
    add: (e) => { calls.push(`add:${e.repoId}:${e.displayName}`); },
    rename: (id, name) => { calls.push(`rename:${id}:${name}`); },
  };
  const repos: Array<{ projectKey: string; path: string }> = [];
  const boot = (config: ProjectsFileV1 | null) => {
    if (config !== null) writeProjectsFile(file, config);
    for (const p of config?.projects ?? []) repos.push({ projectKey: p.id, path: p.path });
    return createProjectRegistry({ file, boot: readProjectsFile(file), repos, control });
  };
  const code = (f: () => unknown): string => { try { f(); return "none"; } catch (e) { return e instanceof ProjectRegistryError ? `${e.status}:${e.code}` : `other:${(e as Error).message}`; } };
  return { root, gitRepo, file, calls, repos, boot, code };
}
const handEdit = (file: string, config: ProjectsFileV1): void => { writeFileSync(file, JSON.stringify(config)); };

describe("the project registry", () => {
  it("R1: add writes the file, joins the running list and the live repos array, and tells the control plane", () => {
    const w = world();
    const reg = w.boot(null);
    const path = w.gitRepo("web-app");
    const added = reg.add("Web App", path);
    expect(added).toEqual({ id: "web-app", name: "Web App", path });
    const read = readProjectsFile(w.file);
    expect(read.kind === "valid" && read.config).toEqual({ version: 1, projects: [{ id: "web-app", name: "Web App", path }] });
    expect(reg.list()).toEqual({ source: "file", editable: true, projects: [added], pendingRestart: [], fileError: null });
    expect(w.repos).toEqual([{ projectKey: "web-app", path }]);
    expect(w.calls).toEqual([`add:${controlRepoKey("web-app")}:Web App`]);
  });

  it("R2: rename writes the file and changes only the name, everywhere", () => {
    const w = world();
    const path = w.gitRepo("orca");
    const reg = w.boot({ version: 1, projects: [{ id: "orca", name: "orca", path }] });
    expect(reg.rename("orca", "Orca Web")).toEqual({ id: "orca", name: "Orca Web", path });
    const read = readProjectsFile(w.file);
    expect(read.kind === "valid" && read.config.projects).toEqual([{ id: "orca", name: "Orca Web", path }]);
    expect(reg.list().projects).toEqual([{ id: "orca", name: "Orca Web", path }]);
    expect(w.repos).toEqual([{ projectKey: "orca", path }]);
    expect(w.calls).toEqual([`rename:${controlRepoKey("orca")}:Orca Web`]);
  });

  it("R3: tells the control plane the file's names at construction", () => {
    const w = world();
    const path = w.gitRepo("orca");
    w.boot({ version: 1, projects: [{ id: "orca", name: "Orca Web", path }] });
    expect(w.calls).toEqual([`rename:${controlRepoKey("orca")}:Orca Web`]);
  });

  it("R4: refuses each bad add by name, writing nothing", () => {
    const w = world();
    const repo = w.gitRepo("repo");
    const reg = w.boot({ version: 1, projects: [{ id: "repo", name: "Repo", path: repo }] });
    mkdirSync(join(w.root, "plain"));
    mkdirSync(join(repo, "sub"));
    symlinkSync(repo, join(w.root, "alias"));
    const refused = w.gitRepo("refused-one");
    expect(w.code(() => reg.add("x", join(w.root, "absent")))).toBe("422:project-path-missing");
    expect(w.code(() => reg.add("x", "relative/path"))).toBe("422:project-path-missing");
    expect(w.code(() => reg.add("x", join(w.root, "plain")))).toBe("422:project-path-not-repository-root");
    expect(w.code(() => reg.add("x", join(repo, "sub")))).toBe("422:project-path-not-repository-root");
    expect(w.code(() => reg.add("x", join(w.root, "alias")))).toBe("409:project-path-taken");
    expect(w.code(() => reg.add("   ", w.gitRepo("other")))).toBe("422:project-name-invalid");
    expect(w.code(() => reg.add("Repo", w.gitRepo("third")))).toBe("409:project-name-taken");
    expect(w.code(() => reg.add("ok", refused))).toBe("422:project-path-refused");
    const read = readProjectsFile(w.file);
    expect(read.kind === "valid" && read.config.projects.map((p) => p.id)).toEqual(["repo"]);
    // Only the construction-time rename (the file names "repo" "Repo"); no refused add reached the control plane.
    expect(w.calls).toEqual([`rename:${controlRepoKey("repo")}:Repo`]);
  });

  it("R5: a project added by hand shows up on the next list(), with no restart", () => {
    const w = world();
    const a = w.gitRepo("a");
    const reg = w.boot({ version: 1, projects: [{ id: "a", name: "A", path: a }] });
    const b = w.gitRepo("b");
    handEdit(w.file, { version: 1, projects: [{ id: "a", name: "A", path: a }, { id: "b", name: "B", path: b }] });
    expect(reg.list().projects.map((p) => p.id)).toEqual(["a", "b"]);
    expect(w.repos.map((r) => r.projectKey)).toEqual(["a", "b"]);
    expect(w.calls).toEqual([`rename:${controlRepoKey("a")}:A`, `add:${controlRepoKey("b")}:B`]);
  });

  it("R6: removals, path changes and a controlStateDir change wait for a restart and are named", () => {
    const w = world();
    const a = w.gitRepo("a"); const b = w.gitRepo("b"); const moved = w.gitRepo("moved");
    const reg = w.boot({ version: 1, projects: [{ id: "a", name: "A", path: a }, { id: "b", name: "B", path: b }] });
    handEdit(w.file, { version: 1, controlStateDir: "/elsewhere", projects: [{ id: "b", name: "B", path: moved }] });
    const view = reg.list();
    expect(view.pendingRestart).toEqual(["controlStateDir", "path:b", "removed:a"]);
    expect(view.projects).toEqual([{ id: "a", name: "A", path: a }, { id: "b", name: "B", path: b }]);
    unlinkSync(w.file);
    expect(reg.list().pendingRestart).toEqual(["removed:a", "removed:b"]);
  });

  it("R7: a broken file keeps the last good list and says why; a hand-added bad project is named, not added", () => {
    const w = world();
    const a = w.gitRepo("a");
    const reg = w.boot({ version: 1, projects: [{ id: "a", name: "A", path: a }] });
    writeFileSync(w.file, "{ not json");
    expect(reg.list().fileError).toMatch(/not JSON/);
    expect(reg.list().projects.map((p) => p.id)).toEqual(["a"]);
    expect(w.code(() => reg.add("x", w.gitRepo("x")))).toBe("409:projects-file-invalid");
    handEdit(w.file, { version: 1, projects: [{ id: "a", name: "A", path: a }, { id: "bad", name: "Bad", path: join(w.root, "nowhere") }] });
    const view = reg.list();
    expect(view.fileError).toMatch(/^project bad: /);
    expect(view.projects.map((p) => p.id)).toEqual(["a"]);
  });

  it("R8: an add after a hand edit keeps the hand edit", () => {
    const w = world();
    const a = w.gitRepo("a");
    const reg = w.boot({ version: 1, projects: [{ id: "a", name: "A", path: a }] });
    handEdit(w.file, { version: 1, projects: [{ id: "a", name: "Hand", path: a }] });
    reg.add("C", w.gitRepo("c"));
    const read = readProjectsFile(w.file);
    expect(read.kind === "valid" && read.config.projects.map((p) => `${p.id}:${p.name}`)).toEqual(["a:Hand", "c:C"]);
  });

  it("R9: a write whose base moved under it is refused, never a silent overwrite", () => {
    const w = world();
    const a = w.gitRepo("a");
    let reg: ReturnType<typeof w.boot>;
    // topLevel runs after the registry's read and before its write: a hand edit lands in between.
    const c = w.gitRepo("c");
    writeProjectsFile(w.file, { version: 1, projects: [{ id: "a", name: "A", path: a }] });
    w.repos.push({ projectKey: "a", path: a });
    reg = createProjectRegistry({
      file: w.file, boot: readProjectsFile(w.file), repos: w.repos, control: null,
      topLevel: (dir) => { handEdit(w.file, { version: 1, projects: [{ id: "a", name: "Raced", path: a }] }); return dir; },
    });
    expect(w.code(() => reg.add("C", c))).toBe("409:projects-file-changed");
    const read = readProjectsFile(w.file);
    expect(read.kind === "valid" && read.config.projects).toEqual([{ id: "a", name: "Raced", path: a }]);
  });

  it("R10: two adds in a row both land", () => {
    const w = world();
    const reg = w.boot(null);
    reg.add("One", w.gitRepo("one"));
    reg.add("Two", w.gitRepo("two"));
    const read = readProjectsFile(w.file);
    expect(read.kind === "valid" && read.config.projects.map((p) => p.id)).toEqual(["one", "two"]);
  });

  it("R11: rename refusals", () => {
    const w = world();
    const a = w.gitRepo("a"); const b = w.gitRepo("b");
    const reg = w.boot({ version: 1, projects: [{ id: "a", name: "A", path: a }, { id: "b", name: "B", path: b }] });
    expect(w.code(() => reg.rename("zzz", "X"))).toBe("404:project-unknown");
    expect(w.code(() => reg.rename("a", " "))).toBe("422:project-name-invalid");
    expect(w.code(() => reg.rename("a", "B"))).toBe("409:project-name-taken");
    expect(reg.rename("a", "A")).toEqual({ id: "a", name: "A", path: a });
  });

  it("R12: a stored path that is itself a symlink to a directory already named is still taken", () => {
    const w = world();
    const repo = w.gitRepo("repo");
    symlinkSync(repo, join(w.root, "via-link"));
    const reg = w.boot({ version: 1, projects: [{ id: "repo", name: "Repo", path: repo }] });
    handEdit(w.file, { version: 1, projects: [{ id: "repo", name: "Repo", path: join(w.root, "via-link") }] });
    expect(w.code(() => reg.add("Again", repo))).toBe("409:project-path-taken");
  });
});
