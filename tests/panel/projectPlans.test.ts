/**
 * In-repo plan path spec 2026-10-21 (#65; triage ruling "登记计划是信任边界 … 路径限在项目仓库内、文件记哈希", session
 * 308b874c "同意"): the person registers a plan file of a project from the panel. Registering is the trust act, so it is
 * kept to what the person can see in their own repository: the real path inside the project, a git-tracked file, and
 * the digest of exactly the bytes they registered.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createProjectRegistry, ProjectRegistryError, type RegistryControl } from "../../src/panel/projectRegistry.js";
import { readProjectsFile, writeProjectsFile, type ProjectsFileV1 } from "../../src/panel/projectsFile.js";
import { controlRepoKey } from "../../src/panel/controlOptions.js";

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

function world(options: { control?: boolean } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "plans-")));
  const git = (dir: string, ...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "ignore"] });
  const gitRepo = (name: string): string => {
    const dir = join(root, name);
    mkdirSync(dir);
    git(dir, "-c", "init.defaultBranch=main", "init", "-q");
    return dir;
  };
  /** A file written and `git add`ed (tracked); `track: false` leaves it untracked. */
  const put = (repo: string, rel: string, text: string, track = true): void => {
    mkdirSync(join(repo, rel, ".."), { recursive: true });
    writeFileSync(join(repo, rel), text);
    if (track) git(repo, "add", "--", rel);
  };
  const file = join(root, "home", "projects.json");
  const calls: string[] = [];
  const control: RegistryControl = {
    check: () => {},
    add: (e) => { calls.push(`add:${e.repoId}`); },
    rename: () => {},
    checkPlan: (e) => { if (e.planId.includes("refused")) throw new Error("control-path-escape"); },
    addPlan: (e) => { calls.push(`plan:${e.planId}:${e.repoId}:${e.displayName}:${e.path}:${e.sha256}`); },
  };
  const repos: Array<{ projectKey: string; path: string }> = [];
  const boot = (config: ProjectsFileV1 | null) => {
    if (config !== null) writeProjectsFile(file, config);
    for (const p of config?.projects ?? []) repos.push({ projectKey: p.id, path: p.path });
    return createProjectRegistry({ file, boot: readProjectsFile(file), repos, control: options.control === false ? null : control });
  };
  const code = (f: () => unknown): string => { try { f(); return "none"; } catch (e) { return e instanceof ProjectRegistryError ? `${e.status}:${e.code}` : `other:${(e as Error).message}`; } };
  const filed = (): ProjectsFileV1 => { const read = readProjectsFile(file); if (read.kind !== "valid") throw new Error(read.kind); return read.config; };
  return { root, gitRepo, put, file, calls, boot, code, filed };
}

describe("registering an in-repository plan file (spec 2026-10-21, #65)", () => {
  it("P1: a tracked file inside the project is written with its digest and joins the control plane; re-registering after an edit refreshes the digest under the same id", () => {
    const w = world();
    const repo = w.gitRepo("app");
    w.put(repo, "plans/build.json", "{\"v\":1}\n");
    const reg = w.boot({ version: 1, projects: [{ id: "app", name: "App", path: repo }] });
    const plan = reg.addPlan("app", "plans/build.json");
    expect(plan).toEqual({ id: "app.plans-build.json", path: "plans/build.json", sha256: sha("{\"v\":1}\n") });
    expect(w.filed().projects).toEqual([{ id: "app", name: "App", path: repo, plans: [plan] }]);
    expect(w.calls).toEqual([`plan:app.plans-build.json:${controlRepoKey("app")}:plans/build.json:${join(repo, "plans/build.json")}:${plan.sha256}`]);
    w.put(repo, "plans/build.json", "{\"v\":2}\n");
    const again = reg.addPlan("app", "./plans//build.json");
    expect(again).toEqual({ id: "app.plans-build.json", path: "plans/build.json", sha256: sha("{\"v\":2}\n") });
    expect(w.filed().projects[0]!.plans).toEqual([again]);
    expect(w.calls.at(-1)).toBe(`plan:app.plans-build.json:${controlRepoKey("app")}:plans/build.json:${join(repo, "plans/build.json")}:${again.sha256}`);
  });

  it("P2: refuses each unsafe registration by name and writes nothing", () => {
    const w = world();
    const repo = w.gitRepo("app");
    const other = w.gitRepo("other");
    w.put(repo, "plans/ok.json", "{}");
    w.put(repo, "plans/loose.json", "{}", false);
    w.put(other, "outside.json", "{}");
    symlinkSync(join(other, "outside.json"), join(repo, "plans", "link.json"));
    w.put(repo, "plans/refused.json", "{}");
    const reg = w.boot({ version: 1, projects: [{ id: "app", name: "App", path: repo }] });
    const before = readProjectsFile(w.file).hash;
    expect(w.code(() => reg.addPlan("app", "plans/loose.json"))).toBe("422:plan-not-tracked");
    expect(w.code(() => reg.addPlan("app", "../other/outside.json"))).toBe("422:plan-path-outside-project");
    expect(w.code(() => reg.addPlan("app", "plans/link.json"))).toBe("422:plan-path-outside-project");
    expect(w.code(() => reg.addPlan("app", join(repo, "plans/ok.json")))).toBe("422:plan-path-invalid");
    expect(w.code(() => reg.addPlan("app", "plans"))).toBe("422:plan-path-missing");
    expect(w.code(() => reg.addPlan("app", "plans/none.json"))).toBe("422:plan-path-missing");
    expect(w.code(() => reg.addPlan("nope", "plans/ok.json"))).toBe("404:project-unknown");
    expect(w.code(() => reg.addPlan("app", "plans/refused.json"))).toBe("422:plan-path-refused");
    expect(readProjectsFile(w.file).hash).toBe(before);
    expect(w.calls).toEqual([]);
    const off = world({ control: false });
    const offRepo = off.gitRepo("app");
    off.put(offRepo, "p.json", "{}");
    const offReg = off.boot({ version: 1, projects: [{ id: "app", name: "App", path: offRepo }] });
    expect(off.code(() => offReg.addPlan("app", "p.json"))).toBe("409:plans-need-control");
  });

  it("P3: at boot, filed plans join the control plane; a plan that is no longer tracked is skipped and named; a hand edit of plans waits for a restart", () => {
    const w = world();
    const repo = w.gitRepo("app");
    w.put(repo, "a.json", "{}");
    w.put(repo, "b.json", "{}", false);
    const plans = [{ id: "app.a.json", path: "a.json", sha256: sha("{}") }, { id: "app.b.json", path: "b.json", sha256: sha("{}") }];
    const reg = w.boot({ version: 1, projects: [{ id: "app", name: "App", path: repo, plans }] });
    expect(w.calls).toEqual([`plan:app.a.json:${controlRepoKey("app")}:a.json:${join(repo, "a.json")}:${sha("{}")}`]);
    const listed = reg.list();
    expect(listed.fileError).toContain("app.b.json");
    expect(listed.pendingRestart).toEqual([]);
    writeFileSync(w.file, JSON.stringify({ version: 1, projects: [{ id: "app", name: "App", path: repo, plans: [plans[0]] }] }));
    expect(reg.list().pendingRestart).toEqual(["plans:app"]);
    expect(w.calls).toHaveLength(1);
  });

  it("P4: the file schema refuses a plan path that is absolute or climbs out, and duplicate plan ids", () => {
    const w = world();
    const repo = w.gitRepo("app");
    const bad = (plans: unknown) => { writeFileSync(w.file, JSON.stringify({ version: 1, projects: [{ id: "app", name: "App", path: repo, plans }] })); return readProjectsFile(w.file).kind; };
    mkdirSync(join(w.root, "home"), { recursive: true });
    const digest = sha("x");
    expect(bad([{ id: "app.a", path: "/abs.json", sha256: digest }])).toBe("invalid");
    expect(bad([{ id: "app.a", path: "x/../../up.json", sha256: digest }])).toBe("invalid");
    // Already normal, so only the ".." segment rule catches it.
    expect(bad([{ id: "app.a", path: "../up.json", sha256: digest }])).toBe("invalid");
    expect(bad([{ id: "app.a", path: "a.json", sha256: "nothex" }])).toBe("invalid");
    expect(bad([{ id: "app.a", path: "a.json", sha256: digest }, { id: "app.a", path: "b.json", sha256: digest }])).toBe("invalid");
    expect(bad([{ id: "app.a", path: "a.json", sha256: digest }])).toBe("valid");
  });
});
