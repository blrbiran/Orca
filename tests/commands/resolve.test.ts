// CLI v2 spec §4 "Ids" and "Project" (plan Task 1): a prefix that names two ids is an error that lists them; nested
// registered repositories resolve to the deepest root that holds cwd; --project beats cwd.
import { mkdir, mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EntryRejection } from "../../src/entry/envelope.js";
import { resolveId, resolveProject, type ProjectRef } from "../../src/commands/resolve.js";

const refusal = (fn: () => unknown): EntryRejection => {
  try { fn(); } catch (error) { if (error instanceof EntryRejection) return error; throw error; }
  throw new Error("expected a refusal");
};

describe("resolveId (spec §4 Ids)", () => {
  it("takes an exact id, else a unique prefix", () => {
    expect(resolveId("group", "abc1", ["abc1", "abc10"])).toBe("abc1");
    expect(resolveId("group", "abc10", ["abc1", "abc10", "zz"])).toBe("abc10");
    expect(resolveId("group", "z", ["abc1", "zz"])).toBe("zz");
  });

  it("a prefix that names two ids is id-ambiguous and lists both", () => {
    const error = refusal(() => resolveId("group", "abc", ["abc1", "abc2", "x"]));
    expect(error.code).toBe("id-ambiguous");
    expect(error.message).toContain("abc1");
    expect(error.message).toContain("abc2");
    expect(error.message).not.toContain(" x");
  });

  it("a prefix that names nothing is id-not-found", () => {
    expect(refusal(() => resolveId("task", "q", ["abc"])).code).toBe("id-not-found");
  });
});

describe("resolveProject (spec §4 Project)", () => {
  async function tree() {
    const root = await realpath(await mkdtemp(join(tmpdir(), "orca-resolve-")));
    for (const dir of ["r/sub/x", "other"]) await mkdir(join(root, dir), { recursive: true });
    const projects: ProjectRef[] = [
      { repoId: "outer", projectKey: "outer", path: join(root, "r") },
      { repoId: "inner", projectKey: "inner", path: join(root, "r/sub") },
      { repoId: "lone", projectKey: "lone", path: join(root, "other") },
    ];
    return { root, projects };
  }

  it("nested registered repositories: the deepest root that holds cwd wins", async () => {
    const { root, projects } = await tree();
    expect(resolveProject(projects, join(root, "r/sub/x"), undefined).repoId).toBe("inner");
    expect(resolveProject(projects, join(root, "r"), undefined).repoId).toBe("outer");
  });

  it("--project (an id, a project key or a path) beats cwd", async () => {
    const { root, projects } = await tree();
    expect(resolveProject(projects, join(root, "r/sub/x"), "lone").repoId).toBe("lone");
    expect(resolveProject(projects, join(root, "r/sub/x"), join(root, "r")).repoId).toBe("outer");
    expect(refusal(() => resolveProject(projects, root, "nope")).code).toBe("project-not-found");
  });

  it("cwd outside every repository: the only one, else project-ambiguous listing them", async () => {
    const { root, projects } = await tree();
    expect(resolveProject([projects[2]!], root, undefined).repoId).toBe("lone");
    const error = refusal(() => resolveProject(projects, root, undefined));
    expect(error.code).toBe("project-ambiguous");
    for (const id of ["outer", "inner", "lone"]) expect(error.message).toContain(id);
  });
});

// Issue 146 (session 3cfc2e73): a multi project's row carries its primary member's path for display only (multi spec
// §4.2). Resolving by that path made the answer depend on how the keys sort -- a multi whose key sorts first captured
// every cwd inside its primary member. Both sort orders are pinned, since either one alone passes by luck.
describe("resolveProject never finds a multi project by a path (issue 146)", () => {
  async function multi(multiKey: string) {
    const root = await realpath(await mkdtemp(join(tmpdir(), "orca-resolve-multi-")));
    for (const dir of ["backend/src", "frontend"]) await mkdir(join(root, dir), { recursive: true });
    const projects: ProjectRef[] = [
      { repoId: "repo-backend", projectKey: "backend", path: join(root, "backend") },
      { repoId: "repo-frontend", projectKey: "frontend", path: join(root, "frontend") },
      { repoId: "multi-x", projectKey: multiKey, path: join(root, "backend"), kind: "multi", dirs: ["backend", "frontend"] },
    ];
    // The panel lists rows sorted by project key, so the multi's place depends on its name.
    projects.sort((a, b) => a.projectKey.localeCompare(b.projectKey));
    return { root, projects };
  }

  it.each([["app"], ["zz-app"]])("multi key %j: a cwd inside the primary member is the member repository", async (key) => {
    const { root, projects } = await multi(key);
    expect(resolveProject(projects, join(root, "backend/src"), undefined).repoId).toBe("repo-backend");
    expect(resolveProject(projects, join(root, "backend"), undefined).repoId).toBe("repo-backend");
  });

  it.each([["app"], ["zz-app"]])("multi key %j: --project <a member's path> is the member repository", async (key) => {
    const { root, projects } = await multi(key);
    expect(resolveProject(projects, root, join(root, "backend")).repoId).toBe("repo-backend");
    expect(resolveProject(projects, root, join(root, "backend/src")).repoId).toBe("repo-backend");
  });

  it("--project <the multi's id or key> is the multi", async () => {
    const { root, projects } = await multi("app");
    expect(resolveProject(projects, join(root, "backend/src"), "multi-x").projectKey).toBe("app");
    expect(resolveProject(projects, join(root, "backend/src"), "app").repoId).toBe("multi-x");
  });
});
