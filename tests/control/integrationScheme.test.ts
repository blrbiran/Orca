import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applySetIntegrationScheme, type SetIntegrationSchemeCommand } from "../../src/control/integrationCommands.js";
import {
  checkBranchName, checkScheme, githubRepoOf, readIntegrationDefault, schemeHash, validBranchName, validRemoteName, type IntegrationScheme,
} from "../../src/control/integrationScheme.js";
import { applySetWorkspaceMode, readWorkspaceSetting, type SetWorkspaceModeCommand } from "../../src/control/workspaceSettings.js";
import { openTestStore } from "./fixtures/store.js";

// Integration spec §3.1: the repository default lives in the repository_settings body next to workspaceMode, under the
// body's one revision; absent means keep, and both setters read-modify-write the whole body.
const PB: IntegrationScheme = { delivery: "push-branch", trigger: "task", target: "main", remote: "origin" };
const cmd = (integration: IntegrationScheme, expectedRevision = 0, commandId = `int-${expectedRevision}`, repoId = "repo"): SetIntegrationSchemeCommand => ({
  schema: "orca-raw-command-v1", commandId, expectedRevision, actorId: "human", verb: "set-integration-scheme",
  target: { kind: "repository", repoId }, payload: { integration },
});
const modeCmd = (workspaceMode: "worktree" | "clone", expectedRevision: number): SetWorkspaceModeCommand => ({
  schema: "orca-raw-command-v1", commandId: `mode-${expectedRevision}`, expectedRevision, actorId: "human", verb: "set-workspace-mode",
  target: { kind: "repository", repoId: "repo" }, payload: { workspaceMode },
});
const known = (repoId: string) => repoId === "repo";
const errorCode = (result: unknown): string => (result as { error?: { code: string } }).error?.code ?? "applied";
const body = (h: Awaited<ReturnType<typeof openTestStore>>): Record<string, unknown> =>
  JSON.parse(String(h.store.db.prepare("SELECT body FROM repository_settings WHERE repo_id='repo'").get()!.body)) as Record<string, unknown>;

describe("the repository's integration default (integration spec §3.1)", () => {
  it("reads keep when the settings body has no integration, and the workspace reader tolerates one that does", async () => {
    const h = await openTestStore(); try {
      const deps = { store: h.store, knownRepository: known };
      expect(readIntegrationDefault(h.store, "repo")).toEqual({ scheme: { delivery: "keep" }, revision: 0 });
      expect(applySetIntegrationScheme(deps, cmd(PB))).toMatchObject({
        verb: "set-integration-scheme", commandRevision: 1, projectionSeq: null, result: { kind: "integration-scheme-set", repoId: "repo", integration: PB },
      });
      expect(readWorkspaceSetting(h.store, "repo")).toEqual({ workspaceMode: "worktree", revision: 1 });
      expect(readIntegrationDefault(h.store, "repo")).toEqual({ scheme: PB, revision: 1 });
    } finally { await h.dispose(); }
  });

  it("each setter keeps the other's field (read-modify-write)", async () => {
    const h = await openTestStore(); try {
      const deps = { store: h.store, knownRepository: known };
      applySetIntegrationScheme(deps, cmd(PB));
      expect(errorCode(applySetWorkspaceMode(deps, modeCmd("clone", 1)))).toBe("applied");
      expect(readIntegrationDefault(h.store, "repo")).toEqual({ scheme: PB, revision: 2 });
      expect(readWorkspaceSetting(h.store, "repo")).toEqual({ workspaceMode: "clone", revision: 2 });
      const local: IntegrationScheme = { delivery: "local", trigger: "group", method: "squash", target: "main" };
      expect(errorCode(applySetIntegrationScheme(deps, cmd(local, 2)))).toBe("applied");
      expect(readWorkspaceSetting(h.store, "repo")).toEqual({ workspaceMode: "clone", revision: 3 });
      expect(readIntegrationDefault(h.store, "repo")).toEqual({ scheme: local, revision: 3 });
    } finally { await h.dispose(); }
  });

  it("setting keep removes the field from the body, and setting keep again is a no-op", async () => {
    const h = await openTestStore(); try {
      const deps = { store: h.store, knownRepository: known };
      applySetIntegrationScheme(deps, cmd(PB));
      expect(Object.keys(body(h))).toContain("integration");
      expect(applySetIntegrationScheme(deps, cmd({ delivery: "keep" }, 1))).toMatchObject({ result: { kind: "integration-scheme-set", integration: { delivery: "keep" } } });
      expect(body(h)).toEqual({ workspaceMode: "worktree", revision: 2 });
      expect(readIntegrationDefault(h.store, "repo")).toEqual({ scheme: { delivery: "keep" }, revision: 2 });
      expect(errorCode(applySetIntegrationScheme(deps, cmd({ delivery: "keep" }, 2)))).toBe("no-op-command");
      expect(errorCode(applySetIntegrationScheme({ store: h.store, knownRepository: known }, cmd({ delivery: "keep" }, 0, "fresh", "repo")))).toBe("revision-conflict");
    } finally { await h.dispose(); }
  });

  it("refuses the scheme it already has, an unknown repository, and a failed check by name, writing nothing", async () => {
    const h = await openTestStore(); try {
      const deps = { store: h.store, knownRepository: known };
      expect(errorCode(applySetIntegrationScheme(deps, cmd({ delivery: "keep" })))).toBe("no-op-command");
      expect(errorCode(applySetIntegrationScheme(deps, cmd(PB, 0, "elsewhere", "elsewhere")))).toBe("control-target-not-allowed");
      const refused = applySetIntegrationScheme(deps, cmd(PB, 0, "bad"), "remote-missing");
      expect(refused).toEqual({ error: { code: "integration-invalid", message: "integration-invalid:remote-missing", commandRevision: 0, evidenceIds: [], retryable: false } });
      expect(h.store.db.prepare("SELECT COUNT(*) AS n FROM repository_settings").get()!.n).toBe(0);
      expect(errorCode(applySetIntegrationScheme(deps, cmd(PB, 0, "set")))).toBe("applied");
      expect(errorCode(applySetIntegrationScheme(deps, cmd(PB, 1, "again")))).toBe("no-op-command");
    } finally { await h.dispose(); }
  });

  it("refuses a body whose integration does not parse, as it refuses any broken settings body", async () => {
    const h = await openTestStore(); try {
      h.store.db.prepare("INSERT INTO repository_settings(repo_id,body) VALUES ('repo',?)").run(JSON.stringify({ workspaceMode: "worktree", revision: 1, integration: { delivery: "rebase" } }));
      expect(() => readIntegrationDefault(h.store, "repo")).toThrow("repository-settings-invalid");
      expect(() => readWorkspaceSetting(h.store, "repo")).toThrow("repository-settings-invalid");
    } finally { await h.dispose(); }
  });
});

describe("names (integration spec §8)", () => {
  it.each(["main", "feat/x", "release-1.2", "a_b"])("accepts branch %j", (name) => expect(validBranchName(name)).toBe(true));
  it.each(["-x", "a..b", "a@{1}", "a//b", "a/", "a.", "a.lock", "", "x".repeat(201), "a b", "a~1", "/a"])("refuses branch %j", (name) => {
    expect(validBranchName(name)).toBe(false);
  });
  it.each(["origin", "up-stream.2"])("accepts remote %j", (name) => expect(validRemoteName(name)).toBe(true));
  it.each(["--upload-pack=x", "a b", "", "a/b", "x".repeat(101)])("refuses remote %j", (name) => expect(validRemoteName(name)).toBe(false));
});

describe("schemeHash (integration spec §3.2)", () => {
  it("is stable over key order and differs per field", () => {
    const reordered = JSON.parse('{"remote":"origin","target":"main","trigger":"task","delivery":"push-branch"}') as IntegrationScheme;
    expect(schemeHash(reordered)).toBe(schemeHash(PB));
    expect(schemeHash(PB)).toMatch(/^[a-f0-9]{64}$/);
    const variants: IntegrationScheme[] = [
      { ...PB, target: "dev" }, { ...PB, remote: "upstream" }, { ...PB, trigger: "group" }, { ...PB, delivery: "github-pr" },
    ];
    for (const variant of variants) expect(schemeHash(variant)).not.toBe(schemeHash(PB));
  });
});

describe("githubRepoOf (integration spec §3.3)", () => {
  it("parses the three URL shapes and refuses others", () => {
    for (const url of ["https://github.com/o/r", "https://github.com/o/r.git", "git@github.com:o/r.git", "git@github.com:o/r", "ssh://git@github.com/o/r", "ssh://git@github.com/o/r.git"]) {
      expect(githubRepoOf(url), url).toEqual({ host: "github.com", slug: "o/r" });
    }
    for (const url of ["https://gitlab.com/o/r.git", "git@gitlab.com:o/r.git", "https://github.com/o", "https://github.com/o/r/extra", "/srv/repo.git", "", "https://github.com.evil.example/o/r"]) {
      expect(githubRepoOf(url), url).toBeNull();
    }
  });
});

describe("checkScheme (integration spec §3.3)", () => {
  let root: string, repo: string;
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
  beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "orca-int-")));
    repo = join(root, "repo");
    execFileSync("git", ["init", "-q", repo]);
    git("remote", "add", "origin", "git@github.com:o/r.git");
    git("remote", "add", "lab", "https://gitlab.com/o/r.git");
    // The identity is the raw configured URL, not one an insteadOf rule rewrites (controller clarification).
    git("config", "url.https://github.com/.insteadOf", "https://gitlab.com/");
  });
  afterAll(async () => { await rm(root, { recursive: true, force: true }); });

  it("accepts keep without running git, even for a path that is no repository", async () => {
    expect(await checkScheme(join(root, "missing"), { delivery: "keep" })).toBeNull();
  });
  it("accepts a valid scheme of each delivery", async () => {
    expect(await checkScheme(repo, { delivery: "local", trigger: "task", method: "merge", target: "main" })).toBeNull();
    expect(await checkScheme(repo, { delivery: "push-target", trigger: "group", method: "squash", target: "main", remote: "origin" })).toBeNull();
    expect(await checkScheme(repo, PB)).toBeNull();
    expect(await checkScheme(repo, { ...PB, delivery: "github-pr" })).toBeNull();
  });
  it("names the failing check", async () => {
    expect(await checkScheme(repo, { delivery: "local", trigger: "task", method: "merge", target: "a..b" })).toBe("target-name");
    expect(await checkScheme(repo, { ...PB, remote: "--upload-pack=x" })).toBe("remote-name");
    expect(await checkScheme(repo, { ...PB, remote: "nowhere" })).toBe("remote-missing");
    expect(await checkScheme(repo, { ...PB, delivery: "github-pr", remote: "lab" })).toBe("remote-not-github");
  });
  it("checkBranchName adds git's own check-ref-format to the pattern", async () => {
    expect(await checkBranchName(repo, "feat/x")).toBe(true);
    expect(await checkBranchName(repo, "a..b")).toBe(false);
    // The pattern admits it; git's --branch refuses it.
    expect(validBranchName("HEAD")).toBe(true);
    expect(await checkBranchName(repo, "HEAD")).toBe(false);
  });
});
