/**
 * Flow engine spec §5.1 (package 0): a project entry may say `kind: "dir"` -- a plain folder the person owns, worked on
 * through a vault, never required to be a git repository. Absent means `repo`, so every file written before this field
 * existed still parses and is written back byte for byte (the person's file is never rewritten into a new shape).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { controlRepoKey } from "../../src/panel/controlOptions.js";
import { projectKindOf, readProjectsFile, writeProjectsFile } from "../../src/panel/projectsFile.js";
import { createPanelServer, parsePanelArgs, type StartedPanel } from "../../src/panel/server.js";
import { sessionFor } from "./fixtures/auth.js";

const started: StartedPanel[] = [];
afterEach(async () => { while (started.length) await started.pop()!.close(); });

const dir = (): string => mkdtempSync(join(tmpdir(), "projects-kind-"));

describe("projects.json entry kind (flow spec §5.1)", () => {
  it("K1: a file written before `kind` existed parses and re-saves byte-equal, and its entries read as repo", () => {
    const file = join(dir(), "projects.json");
    const text = `${JSON.stringify({ version: 1, projects: [{ id: "orca", name: "orca", path: "/abs/orca" }] }, null, 2)}\n`;
    writeFileSync(file, text);
    const read = readProjectsFile(file);
    expect(read.kind).toBe("valid");
    if (read.kind !== "valid") return;
    // Absent stays absent: a default filled in at parse time would add `"kind": "repo"` on the next write.
    expect("kind" in read.config.projects[0]!).toBe(false);
    expect(projectKindOf(read.config.projects[0]!)).toBe("repo");
    writeProjectsFile(file, read.config);
    expect(readFileSync(file, "utf8")).toBe(text);
  });

  it("K2: kind dir validates for a folder that is not a git repository", () => {
    const root = dir();
    const folder = join(root, "articles");
    mkdirSync(folder);
    const file = join(root, "projects.json");
    writeFileSync(file, JSON.stringify({ version: 1, projects: [{ id: "articles", name: "Articles", path: folder, kind: "dir" }] }));
    const read = readProjectsFile(file);
    expect(read.kind).toBe("valid");
    if (read.kind !== "valid") return;
    expect(projectKindOf(read.config.projects[0]!)).toBe("dir");
  });

  it("K3: an explicit kind repo is kept as written", () => {
    const file = join(dir(), "projects.json");
    writeFileSync(file, JSON.stringify({ version: 1, projects: [{ id: "orca", name: "orca", path: "/abs/orca", kind: "repo" }] }));
    const read = readProjectsFile(file);
    expect(read.kind === "valid" ? read.config.projects[0] : null).toEqual({ id: "orca", name: "orca", path: "/abs/orca", kind: "repo" });
  });

  it("K4: any other kind is refused by name, not read as repo", () => {
    const file = join(dir(), "projects.json");
    writeFileSync(file, JSON.stringify({ version: 1, projects: [{ id: "orca", name: "orca", path: "/abs/orca", kind: "bogus" }] }));
    const read = readProjectsFile(file);
    expect(read.kind).toBe("invalid");
    expect(read.kind === "invalid" ? read.reason : "").toMatch(/^projects\.0\.kind: /);
  });
});

describe("the panel's project list (flow spec §5.1, §22)", () => {
  it("K5: a dir entry is listed with kind dir; a repo entry's row is unchanged (no kind field)", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "projects-kind-panel-")));
    const repo = join(root, "repo");
    mkdirSync(repo);
    execFileSync("git", ["-c", "init.defaultBranch=main", "init", "-q"], { cwd: repo });
    const folder = join(root, "articles");
    mkdirSync(folder);
    const file = join(root, "home", "projects.json");
    mkdirSync(join(root, "home"));
    writeFileSync(file, JSON.stringify({ version: 1, projects: [{ id: "articles", name: "Articles", path: folder, kind: "dir" }, { id: "repo", name: "Repo", path: repo }] }));
    const env: NodeJS.ProcessEnv = { ...process.env, ORCA_CONTROL_DIR: join(root, "control"), ORCA_CORRECTIONS_DIR: join(root, "corrections"), ORCA_PROJECTS_FILE: file, ORCA_VAULT_DIR: join(root, "vault") };
    delete env.ORCA_CCLOOP_BIN; delete env.ORCA_AGENTS_TABLE;
    const panel = await createPanelServer(parsePanelArgs(["--by", "tester", "--port", "0", "--projects-file", file], env), env);
    started.push(panel);
    const res = await (await sessionFor(panel, env)).fetch("/api/projects", { method: "GET" });
    const body = await res.json() as { projects: unknown[] };
    expect(body.projects).toEqual([
      { projectKey: "articles", name: "Articles", path: folder, kind: "dir", controlRepoId: controlRepoKey("articles") },
      { projectKey: "repo", name: "Repo", path: repo, controlRepoId: controlRepoKey("repo") },
    ]);
  });
});
