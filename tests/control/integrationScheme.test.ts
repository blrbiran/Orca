import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sha256Canonical } from "../../src/control/canonicalJson.js";
import { readBudgetProposal } from "../../src/control/queries.js";
import { readDraft } from "../../src/control/requirementRecords.js";
import type { ControlStore } from "../../src/control/store.js";
import { WebControlService } from "../../src/control/webService.js";
import { writeRepositorySettingsBody } from "../../src/control/workspaceSettings.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { VALID_SPLIT } from "./fixtures/requirementOutputs.js";
import { webFixture } from "./fixtures/web.js";
import { applySetIntegrationScheme, type SetIntegrationSchemeCommand } from "../../src/control/integrationCommands.js";
import {
  checkBranchName, checkScheme, githubRepoOf, newGroupIntegration, preflightScheme, readGroupIntegration, readIntegrationDefault, schemeHash,
  validBranchName, validRemoteName, type GroupIntegration, type IntegrationScheme,
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

// ---------------------------------------------------------------------------------------------------------------------
// Task 2: the group's copy, set-group-integration, approval at confirm (integration spec §3.1-§3.3, §4).

const LOCAL: IntegrationScheme = { delivery: "local", trigger: "task", method: "merge", target: "main" };
const groupBody = (store: ControlStore, id = "g"): Record<string, unknown> =>
  JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id=?").get(id)!.body)) as Record<string, unknown>;
const writeGroupBody = (store: ControlStore, body: Record<string, unknown>, id = "g") =>
  store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(body), id);
const gitIn = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args], { cwd, stdio: "pipe" }).toString();

/**
 * The fixture's group "g" over a real repository: `main` with one commit, `origin` a local bare copy of it. The service
 * resolves the plan's repository to it, as the panel's trusted config does.
 */
async function groupOver(integration?: IntegrationScheme) {
  const h = await webFixture(undefined, undefined, integration === undefined ? {} : { integration });
  const repo = join(h.root, "repo"), bare = join(h.root, "origin.git");
  gitIn(h.root, "init", "-q", "-b", "main", repo);
  gitIn(repo, "commit", "-q", "--allow-empty", "-m", "base");
  gitIn(h.root, "init", "-q", "--bare", bare);
  gitIn(repo, "remote", "add", "origin", bare);
  gitIn(repo, "push", "-q", "origin", "main");
  const service = new WebControlService({ ...h.deps, resolveRepository: () => repo });
  const setGroup = (scheme: IntegrationScheme) => service.setGroupIntegration(h.command("set-group-integration", { integration: scheme }));
  return { ...h, repo, bare, service, setGroup };
}

describe("the group's copy of the scheme (integration spec §3.1)", () => {
  it("import copies a non-keep repository default into the group body and view, unfrozen", async () => {
    const h = await groupOver(PB); try {
      const expected = newGroupIntegration(PB)!;
      expect(expected).toMatchObject({ scheme: PB, schemeHash: schemeHash(PB), frozen: false, state: "idle", transient: 0 });
      expect(groupBody(h.store).integration).toEqual(expected);
      expect(readGroupIntegration(groupBody(h.store))).toEqual(expected);
      expect(readControlGroup(h.store, "epoch", "g").integration).toEqual({
        scheme: PB, schemeHash: schemeHash(PB), frozen: false, state: "idle", reason: null, lastIntegrated: null, integratedCommit: null, pr: null,
      });
    } finally { await h.dispose(); }
  });

  it("import with no default (keep) writes no integration key into the body or the view", async () => {
    const h = await groupOver(); try {
      expect(Object.hasOwn(groupBody(h.store), "integration")).toBe(false);
      expect(Object.hasOwn(readControlGroup(h.store, "epoch", "g"), "integration")).toBe(false);
      expect(readGroupIntegration(groupBody(h.store))).toBeNull();
    } finally { await h.dispose(); }
  });

  it("a requirement group's split acceptance copies the default too, and writes nothing for keep", async () => {
    for (const scheme of [PB, null] as const) {
      const x = await requirementHarness({ answers: [{ purpose: "split", output: VALID_SPLIT }], startAt: "split" });
      try {
        await x.until(() => readDraft(x.store, "r", 1).state === "awaiting-review");
        if (scheme !== null) writeRepositorySettingsBody(x.store, "repo", { workspaceMode: "worktree", revision: 1, integration: scheme });
        expect(await x.service.acceptRequirementDraft(x.command("requirement-draft-accept", { draftNo: 1, draftHash: readDraft(x.store, "r", 1).draftHash! })))
          .toMatchObject({ result: { kind: "requirement-draft-accepted" } });
        const body = groupBody(x.store, "r");
        if (scheme === null) expect(Object.hasOwn(body, "integration")).toBe(false);
        else expect(body.integration).toEqual(newGroupIntegration(scheme));
      } finally { await x.dispose(); }
    }
  });

  it("newGroupIntegration is null for keep; a stored record that does not parse blocks the group by name", () => {
    expect(newGroupIntegration({ delivery: "keep" })).toBeNull();
    expect(readGroupIntegration({ groupId: "g" })).toBeNull();
    expect(() => readGroupIntegration({ integration: { ...newGroupIntegration(PB)!, state: "pushing" } })).toThrow("recovery-blocked:group-integration-invalid");
  });
});

describe("set-group-integration (integration spec §3.1, §3.3)", () => {
  it("before confirm: edits the copy, replaces it, and keep removes the key", async () => {
    const h = await groupOver(); try {
      expect(await h.setGroup(LOCAL)).toMatchObject({ verb: "set-group-integration", result: { kind: "group-integration-set", groupId: "g", integration: LOCAL } });
      expect(groupBody(h.store).integration).toEqual(newGroupIntegration(LOCAL));
      expect(errorCode(await h.setGroup(PB))).toBe("applied");
      expect(groupBody(h.store).integration).toEqual(newGroupIntegration(PB));
      expect(errorCode(await h.setGroup(PB))).toBe("no-op-command");
      expect(errorCode(await h.setGroup({ delivery: "keep" }))).toBe("applied");
      expect(Object.hasOwn(groupBody(h.store), "integration")).toBe(false);
      expect(errorCode(await h.setGroup({ delivery: "keep" }))).toBe("no-op-command");
    } finally { await h.dispose(); }
  });

  it("refuses a failed setter check by name and a clarifying group, writing nothing", async () => {
    const h = await groupOver(); try {
      expect(await h.setGroup({ ...PB, remote: "nowhere" })).toMatchObject({ error: { code: "integration-invalid", message: "integration-invalid:remote-missing" } });
      expect(Object.hasOwn(groupBody(h.store), "integration")).toBe(false);
      writeGroupBody(h.store, { ...groupBody(h.store), status: "clarifying" });
      expect(errorCode(await h.setGroup(LOCAL))).toBe("group-state-invalid");
      expect(Object.hasOwn(groupBody(h.store), "integration")).toBe(false);
    } finally { await h.dispose(); }
  });

  it("after confirm: the command is the approval -- frozen, idle, pending cleared, history kept", async () => {
    const h = await groupOver(PB); try {
      const approved = readControlGroup(h.store, "epoch", "g").integration!.schemeHash;
      expect(errorCode(await h.service.confirm(h.command("confirm", { ...(await h.confirmPayload()), integrationHash: approved })))).toBe("applied");
      const sha = (c: string) => c.repeat(40);
      const running = { ...(groupBody(h.store).integration as GroupIntegration), state: "blocked" as const, reason: "remote-unreachable", lastIntegrated: sha("a"),
        integratedCommit: sha("b"), pending: { schemeHash: schemeHash(PB), tip: sha("c"), base: sha("d"), new: sha("e") }, retryAfter: 123, transient: 2 };
      writeGroupBody(h.store, { ...groupBody(h.store), integration: running });
      const next: IntegrationScheme = { ...PB, trigger: "group" };
      expect(errorCode(await h.setGroup(next))).toBe("applied");
      expect(groupBody(h.store).integration).toEqual({ ...running, scheme: next, schemeHash: schemeHash(next), frozen: true, state: "idle", reason: null, pending: null, retryAfter: null, transient: 0 });
    } finally { await h.dispose(); }
  });

  it("an unfrozen group's keep -> scheme stays unfrozen; a confirmed keep group's new scheme is frozen at once", async () => {
    const h = await groupOver(); try {
      expect(errorCode(await h.service.confirm(h.command("confirm", await h.confirmPayload())))).toBe("applied");
      expect(errorCode(await h.setGroup(PB))).toBe("applied");
      expect(groupBody(h.store).integration).toEqual({ ...newGroupIntegration(PB), frozen: true });
    } finally { await h.dispose(); }
  });

  it("is refused integration-busy while a resolution runs, and resets a conflict to idle", async () => {
    const h = await groupOver(PB); try {
      const base = groupBody(h.store).integration as GroupIntegration;
      writeGroupBody(h.store, { ...groupBody(h.store), integration: { ...base, state: "resolving" } });
      expect(errorCode(await h.setGroup(LOCAL))).toBe("integration-busy");
      expect((groupBody(h.store).integration as GroupIntegration).state).toBe("resolving");
      const conflict = { attempt: 1, key: "k", base: "a".repeat(40), tip: "b".repeat(40), paths: ["x"] };
      writeGroupBody(h.store, { ...groupBody(h.store), integration: { ...base, state: "conflict", reason: "integration-conflict", conflict } });
      expect(errorCode(await h.setGroup(LOCAL))).toBe("applied");
      expect(groupBody(h.store).integration).toMatchObject({ scheme: LOCAL, state: "idle", reason: null, conflict: null });
    } finally { await h.dispose(); }
  });
});

describe("confirm binds the approval to the scheme the owner saw (integration spec §3.2)", () => {
  it("a non-keep group: no hash or a stale hash is unapproved; the view's hash confirms and freezes the copy", async () => {
    const h = await groupOver(PB); try {
      const payload = await h.confirmPayload();
      expect(errorCode(await h.service.confirm(h.command("confirm", payload)))).toBe("integration-unapproved");
      expect(errorCode(await h.service.confirm(h.command("confirm", { ...payload, integrationHash: schemeHash(LOCAL) })))).toBe("integration-unapproved");
      expect(readBudgetProposal(h.store, "g").state).toBe("editable");
      const seen = readControlGroup(h.store, "epoch", "g").integration!.schemeHash;
      expect(await h.service.confirm(h.command("confirm", { ...payload, integrationHash: seen }))).toMatchObject({ result: { kind: "confirmed" } });
      expect(groupBody(h.store).integration).toEqual({ ...newGroupIntegration(PB), frozen: true });
      expect(readControlGroup(h.store, "epoch", "g").integration).toMatchObject({ frozen: true });
    } finally { await h.dispose(); }
  });

  it("reopening the proposal drops the approval with every other confirmation-time fact", async () => {
    const h = await groupOver(PB); try {
      const seen = readControlGroup(h.store, "epoch", "g").integration!.schemeHash;
      expect(errorCode(await h.service.confirm(h.command("confirm", { ...(await h.confirmPayload()), integrationHash: seen })))).toBe("applied");
      expect(h.service.editProposal(h.command("proposal-edit", { baseProposalVersion: 1, operations: [{ target: { scope: "task", taskId: "a", allocation: "work", dimension: "tokens" }, value: 2000000, provenance: "human" }] })))
        .toMatchObject({ result: { proposalVersion: 2 } });
      expect(groupBody(h.store).integration).toEqual(newGroupIntegration(PB));
    } finally { await h.dispose(); }
  });

  it("a keep group: a hash is unapproved; without one it confirms as before, the field adding no bytes to its hashes", async () => {
    const h = await groupOver(); try {
      const payload = await h.confirmPayload();
      expect(errorCode(await h.service.confirm(h.command("confirm", { ...payload, integrationHash: schemeHash(PB) })))).toBe("integration-unapproved");
      const command = h.command("confirm", payload);
      expect(Object.hasOwn(command.payload, "integrationHash")).toBe(false);
      const result = await h.service.confirm(command);
      expect(result).toMatchObject({ result: { kind: "confirmed" } });
      // The ledger's own identity for this command object (applyWebCommand: sha256Canonical of the effective command).
      expect((result as { authorityCommandHash: string }).authorityCommandHash).toBe(sha256Canonical({ ...command, schema: "orca-authority-command-v1" }));
      expect((result as { effectivePayloadHash: string }).effectivePayloadHash).toBe(sha256Canonical(payload));
      expect(Object.hasOwn(groupBody(h.store), "integration")).toBe(false);
    } finally { await h.dispose(); }
  });

  it("refuses integration-preflight-failed naming the check, before freezing anything", async () => {
    const h = await groupOver(PB); try {
      gitIn(h.repo, "remote", "remove", "origin");
      const seen = readControlGroup(h.store, "epoch", "g").integration!.schemeHash;
      expect(await h.service.confirm(h.command("confirm", { ...(await h.confirmPayload()), integrationHash: seen })))
        .toMatchObject({ error: { code: "integration-preflight-failed", message: "integration-preflight-failed:remote-missing" } });
      expect(readBudgetProposal(h.store, "g").state).toBe("editable");
      expect((groupBody(h.store).integration as GroupIntegration).frozen).toBe(false);
    } finally { await h.dispose(); }
  });
});

describe("preflightScheme (integration spec §3.3)", () => {
  let root: string, repo: string, bare: string, bin: string;
  const okGh = () => join(bin, "gh-ok"), badGh = () => join(bin, "gh-bad");
  beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "orca-pre-")));
    repo = join(root, "repo"); bare = join(root, "origin.git"); bin = join(root, "bin");
    gitIn(root, "init", "-q", "-b", "main", repo);
    gitIn(repo, "commit", "-q", "--allow-empty", "-m", "base");
    gitIn(root, "init", "-q", "--bare", bare);
    gitIn(repo, "remote", "add", "origin", bare);
    gitIn(repo, "push", "-q", "origin", "main");
    gitIn(repo, "remote", "add", "gone", join(root, "no-such-remote.git"));
    // The GitHub identity is the raw URL; the fetch follows insteadOf to the local bare copy, so nothing leaves the machine.
    gitIn(repo, "remote", "add", "hub", "git@github.com:o/r.git");
    gitIn(repo, "config", `url.${bare}.insteadOf`, "git@github.com:o/r.git");
    await mkdir(bin);
    await writeFile(okGh(), `#!/bin/sh\necho "$@" >> "${join(root, "gh.log")}"\nexit 0\n`, { mode: 0o755 });
    await writeFile(badGh(), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    // A git that reports 2.39 and otherwise is the real one.
    const realGit = execFileSync("sh", ["-c", "command -v git"]).toString().trim();
    await mkdir(join(bin, "old"));
    await writeFile(join(bin, "old", "git"), `#!/bin/sh\nfor a in "$@"; do last="$a"; done\nif [ "$last" = "--version" ]; then echo "git version 2.39.5 (Apple Git-154)"; exit 0; fi\nexec "${realGit}" "$@"\n`, { mode: 0o755 });
  });
  afterAll(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

  const HUB: IntegrationScheme = { delivery: "github-pr", trigger: "task", target: "main", remote: "hub" };
  it("passes keep without git, and a scheme of each delivery whose target exists", async () => {
    expect(await preflightScheme(join(root, "missing"), { delivery: "keep" }, badGh())).toBeNull();
    expect(await preflightScheme(repo, LOCAL, badGh())).toBeNull();
    expect(await preflightScheme(repo, { delivery: "push-target", trigger: "task", method: "squash", target: "main", remote: "origin" }, badGh())).toBeNull();
    expect(await preflightScheme(repo, PB, badGh())).toBeNull();
    expect(await preflightScheme(repo, HUB, okGh())).toBeNull();
    expect(await readFile(join(root, "gh.log"), "utf8")).toBe("auth status --hostname github.com\n");
  });
  it("names the failing check", async () => {
    expect(await preflightScheme(repo, { ...PB, remote: "nowhere" }, badGh())).toBe("remote-missing");
    expect(await preflightScheme(repo, { ...PB, remote: "gone" }, badGh())).toBe("remote");
    expect(await preflightScheme(repo, { ...LOCAL, target: "dev" }, badGh())).toBe("target");
    expect(await preflightScheme(repo, { ...PB, target: "dev" }, badGh())).toBe("target");
    expect(await preflightScheme(repo, HUB, badGh())).toBe("gh-auth");
    expect(await preflightScheme(repo, { ...LOCAL, target: "a..b" }, badGh())).toBe("target-name");
  });
  it("squash needs git 2.40 (merge-tree --merge-base); merge does not", async () => {
    vi.stubEnv("PATH", `${join(bin, "old")}:${process.env.PATH ?? ""}`);
    try {
      expect(await preflightScheme(repo, { ...LOCAL, method: "squash" }, badGh())).toBe("git-version");
      expect(await preflightScheme(repo, LOCAL, badGh())).toBeNull();
    } finally { vi.unstubAllEnvs(); }
    expect(await preflightScheme(repo, { ...LOCAL, method: "squash" }, badGh())).toBeNull();
  });
});
