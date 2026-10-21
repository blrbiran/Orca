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
