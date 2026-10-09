// Integration spec §5, §6.1-§6.3, §6.5: the integration pass against real git -- a bare remote, a target repository
// cloned from it, and landings made on `orca/g` with plumbing (no ccloop). Each case names the spec line it pins.
// Real git children (and the driver harness) take seconds under load, so every describe allows a minute.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, statSync, utimesSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readGroupActivity } from "../../src/control/activity.js";
import { createExecutionDriver, DriverCrash } from "../../src/control/executionDriver.js";
import { __setRunChildForTests, remoteTip, spawnRunChild } from "../../src/control/integrationGit.js";
import { integratePendingGroups, type IntegrationDeps } from "../../src/control/integrationPass.js";
import { newGroupIntegration, readGroupIntegration, schemeHash, type GroupIntegration, type IntegrationScheme } from "../../src/control/integrationScheme.js";
import type { ControlStore } from "../../src/control/store.js";
import { WebControlService } from "../../src/control/webService.js";
import { controlWorkspaceRoots, unsetInheritedGitEnv } from "../../src/control/workspace.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { webFixture } from "./fixtures/web.js";

// As driverHarness's `git`: no GIT_* of the test process's own, and no hook of the test repositories runs for the setup.
const g = (cwd: string, args: string[], options: { input?: string; env?: NodeJS.ProcessEnv } = {}): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args],
    { cwd, encoding: "utf8", stdio: "pipe", input: options.input, env: { ...process.env, ...unsetInheritedGitEnv(), ...options.env } }).trim();

const groupBody = (store: ControlStore): Record<string, unknown> =>
  JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;
const writeGroupBody = (store: ControlStore, body: Record<string, unknown>) => store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(body));
const record = (store: ControlStore): GroupIntegration => readGroupIntegration(groupBody(store))!;
const setRecord = (store: ControlStore, integration: GroupIntegration) => writeGroupBody(store, { ...groupBody(store), integration });

const PB: IntegrationScheme = { delivery: "push-branch", trigger: "task", target: "main", remote: "origin" };
const LOCAL_MERGE: IntegrationScheme = { delivery: "local", trigger: "task", method: "merge", target: "main" };
const LOCAL_SQUASH: IntegrationScheme = { delivery: "local", trigger: "task", method: "squash", target: "main" };
const PT_MERGE: IntegrationScheme = { delivery: "push-target", trigger: "task", method: "merge", target: "main", remote: "origin" };

/** A commit on `ref` of `repo` whose tree is its parent's with `files` written, made with plumbing (no checkout). */
function commitOn(repo: string, ref: string, files: Record<string, string>, message: string): string {
  const parent = g(repo, ["rev-parse", ref]);
  const env = { GIT_INDEX_FILE: join(repo, ".git", `orca-test-index-${process.pid}`) };
  g(repo, ["read-tree", parent], { env });
  for (const [path, text] of Object.entries(files)) {
    const blob = g(repo, ["hash-object", "-w", "--stdin"], { input: text });
    g(repo, ["update-index", "--add", "--cacheinfo", `100644,${blob},${path}`], { env });
  }
  const tree = g(repo, ["write-tree"], { env });
  const commit = g(repo, ["commit-tree", tree, "-p", parent, "-m", message]);
  g(repo, ["update-ref", ref, commit, parent]);
  return commit;
}

/**
 * The fixture's group "g" (imported, one task "a") with a frozen integration; a bare remote `remote.git` whose `main`
 * holds f.txt; the target repository `target` cloned from it, `orca/g` created from its HEAD as the driver does.
 */
async function world(scheme: IntegrationScheme, options: { checkedOutOther?: boolean } = {}) {
  const h = await webFixture();
  const bare = join(h.root, "remote.git"), repo = join(h.root, "target"), other = join(h.root, "other");
  g(h.root, ["init", "-q", "--bare", "-b", "main", bare]);
  g(h.root, ["init", "-q", "-b", "main", repo]);
  await writeFile(join(repo, "f.txt"), "one\ntwo\nthree\n");
  g(repo, ["add", "f.txt"]); g(repo, ["commit", "-qm", "base"]);
  g(repo, ["remote", "add", "origin", bare]);
  g(repo, ["push", "-q", "origin", "main"]);
  g(repo, ["fetch", "-q", "origin"]);
  if (options.checkedOutOther) g(repo, ["checkout", "-q", "-b", "other"]);
  g(repo, ["update-ref", "refs/heads/orca/g", "HEAD"]);
  g(h.root, ["clone", "-q", bare, other]);
  setRecord(h.store, { ...newGroupIntegration(scheme)!, frozen: true });
  let clock = 1_000_000;
  const deps = (extra: Partial<IntegrationDeps> = {}): IntegrationDeps => ({
    store: h.store, roots: controlWorkspaceRoots(h.store.stateDir), admissionGate: h.deps.admissionGate, repoPathOf: () => repo,
    now: () => clock, ghBin: "/nonexistent/gh", stopped: () => false, ...extra,
  });
  const land = (files: Record<string, string>, message = "land") => commitOn(repo, "refs/heads/orca/g", files, message);
  /** Another clone pushes a commit onto the remote's `branch`. */
  const pushFromOther = (branch: string, files: Record<string, string>): string => {
    g(other, ["fetch", "-q", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
    g(other, ["update-ref", `refs/heads/${branch}`, `refs/remotes/origin/${branch}`]);
    const commit = commitOn(other, `refs/heads/${branch}`, files, `other on ${branch}`);
    g(other, ["push", "-q", "origin", `${commit}:refs/heads/${branch}`]);
    return commit;
  };
  const service = new WebControlService({ ...h.deps });
  return {
    ...h, bare, repo, other, deps, land, pushFromOther, service,
    pass: (extra: Partial<IntegrationDeps> = {}) => integratePendingGroups(deps(extra)),
    remote: (branch: string): string | null => { try { return g(bare, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]); } catch { return null; } },
    record: () => record(h.store),
    setClock: (at: number) => { clock = at; }, clock: () => clock,
  };
}

/** Every git (or gh) child the pass starts, by argv, still run for real. */
function spyChildren(): string[][] {
  const calls: string[][] = [];
  __setRunChildForTests((bin, args, opts) => { calls.push([bin, ...args]); return spawnRunChild(bin, args, opts); });
  return calls;
}
afterEach(() => { __setRunChildForTests(null); vi.unstubAllEnvs(); });

const parents = (repo: string, commit: string): string[] => g(repo, ["rev-list", "--parents", "-n", "1", commit]).split(" ").slice(1);

describe("push-branch (integration spec §3, §6.1 step 4)", { timeout: 60_000 }, () => {
  it("1: each landing reaches the remote's orca/g; with no new landing the pass reads one ref and pushes nothing", async () => {
    const w = await world(PB); try {
      const calls = spyChildren();
      // orca/g was made from HEAD: there is no landed work yet.
      expect(await w.pass()).toBe(false);
      expect(w.remote("orca/g")).toBeNull();
      expect(calls.map((call) => call[1])).toEqual(["rev-parse", "rev-parse", "merge-base"]);
      const first = w.land({ "a.txt": "a\n" });
      expect(await w.pass()).toBe(true);
      expect(w.remote("orca/g")).toBe(first);
      expect(w.record()).toMatchObject({ lastIntegrated: first, integratedCommit: first, pending: null, state: "idle", transient: 0 });
      const second = w.land({ "b.txt": "b\n" });
      expect(await w.pass()).toBe(true);
      expect(w.remote("orca/g")).toBe(second);
      expect(w.record().lastIntegrated).toBe(second);
      calls.length = 0;
      expect(await w.pass()).toBe(false);
      expect(calls).toEqual([["git", "rev-parse", "--verify", "--quiet", "refs/heads/orca/g^{commit}"]]);
    } finally { await w.dispose(); }
  });

  it("9: a remote orca/g someone else pushed to blocks integration-work-branch-diverged and is not overwritten", async () => {
    const w = await world(PB); try {
      w.land({ "a.txt": "a\n" });
      await w.pass();
      const theirs = w.pushFromOther("orca/g", { "theirs.txt": "x\n" });
      w.land({ "b.txt": "b\n" });
      expect(await w.pass()).toBe(true);
      expect(w.record()).toMatchObject({ state: "blocked", reason: "integration-work-branch-diverged", pending: null });
      expect(w.remote("orca/g")).toBe(theirs);
    } finally { await w.dispose(); }
  });
});

describe("local (integration spec §6.2, §6.3)", { timeout: 60_000 }, () => {
  it("2: merge into a target no worktree has checked out: a --no-ff merge (old main, tip), then one whose second parent is the new tip", async () => {
    const w = await world(LOCAL_MERGE, { checkedOutOther: true }); try {
      const oldMain = g(w.repo, ["rev-parse", "main"]);
      const first = w.land({ "a.txt": "a\n" });
      expect(await w.pass()).toBe(true);
      const merged = g(w.repo, ["rev-parse", "main"]);
      expect(parents(w.repo, merged)).toEqual([oldMain, first]);
      expect(w.record()).toMatchObject({ lastIntegrated: first, integratedCommit: merged, state: "idle" });
      const second = w.land({ "b.txt": "b\n" });
      expect(await w.pass()).toBe(true);
      expect(parents(w.repo, g(w.repo, ["rev-parse", "main"]))).toEqual([merged, second]);
      // The person's checkout was never touched, and the integration workspace is gone.
      expect(g(w.repo, ["symbolic-ref", "HEAD"])).toBe("refs/heads/other");
      expect(existsSync(join(`${w.store.stateDir}.workspaces`, "integrate-g"))).toBe(false);
      expect(g(w.repo, ["worktree", "list", "--porcelain"])).not.toContain("integrate-g");
    } finally { await w.dispose(); }
  });

  it("3: squash is one commit on old main with merge-tree's tree; after the person edits a line the first landing touched, the next squash keeps the edit", async () => {
    const w = await world(LOCAL_SQUASH, { checkedOutOther: true }); try {
      const oldMain = g(w.repo, ["rev-parse", "main"]);
      const first = w.land({ "f.txt": "ONE\ntwo\nthree\n" });
      w.land({ "a.txt": "a\n" });
      const tip = g(w.repo, ["rev-parse", "orca/g"]);
      expect(await w.pass()).toBe(true);
      const squashed = g(w.repo, ["rev-parse", "main"]);
      expect(parents(w.repo, squashed)).toEqual([oldMain]);
      expect(g(w.repo, ["rev-parse", `${squashed}^{tree}`])).toBe(g(w.repo, ["merge-tree", "--write-tree", oldMain, tip]));
      expect(g(w.repo, ["log", "-1", "--format=%s", squashed])).toBe("orca: integrate g (2 landings)");
      expect(first).not.toBe(tip);
      // The person rewrites the very line the first landing changed.
      const person = commitOn(w.repo, "refs/heads/main", { "f.txt": "PERSON\ntwo\nthree\n" }, "person");
      w.land({ "b.txt": "b\n" });
      expect(await w.pass()).toBe(true);
      expect(w.record()).toMatchObject({ state: "idle", conflict: null });
      const next = g(w.repo, ["rev-parse", "main"]);
      expect(parents(w.repo, next)).toEqual([person]);
      expect(g(w.repo, ["show", `${next}:f.txt`])).toBe("PERSON\ntwo\nthree");
      expect(g(w.repo, ["show", `${next}:b.txt`])).toBe("b");
    } finally { await w.dispose(); }
  });

  it("a conflict records state conflict with the attempt, dispatches nothing and leaves main alone; retry tries again as attempt 2", async () => {
    const w = await world(LOCAL_MERGE, { checkedOutOther: true }); try {
      const tip = w.land({ "f.txt": "A\ntwo\nthree\n" });
      const main = commitOn(w.repo, "refs/heads/main", { "f.txt": "B\ntwo\nthree\n" }, "person");
      expect(await w.pass()).toBe(true);
      expect(w.record()).toMatchObject({ state: "conflict", reason: "integration-conflict", pending: null,
        conflict: { attempt: 1, key: "integrate-g-1", base: main, tip, paths: ["f.txt"] } });
      expect(g(w.repo, ["rev-parse", "main"])).toBe(main);
      expect(w.store.db.prepare("SELECT COUNT(*) AS n FROM runs").get()!.n).toBe(0);
      expect(existsSync(join(`${w.store.stateDir}.workspaces`, "integrate-g"))).toBe(false);
      expect(await w.pass()).toBe(false);
      expect(w.service.retryIntegration(w.command("retry-integration", {}))).toMatchObject({ result: { kind: "integration-retried", groupId: "g" } });
      expect(w.record()).toMatchObject({ state: "idle", reason: null });
      expect(await w.pass()).toBe(true);
      expect(w.record().conflict).toMatchObject({ attempt: 2, key: "integrate-g-2" });
    } finally { await w.dispose(); }
  });

  it("7 (H5): a clean checked-out target is fast-forwarded in place; a dirty one blocks and not one byte of it changes", async () => {
    const w = await world(LOCAL_MERGE); try {
      w.land({ "a.txt": "a\n" });
      expect(await w.pass()).toBe(true);
      expect(readFileSync(join(w.repo, "a.txt"), "utf8")).toBe("a\n");
      expect(g(w.repo, ["status", "--porcelain", "--untracked-files=all"])).toBe("");
      expect(g(w.repo, ["rev-parse", "HEAD"])).toBe(w.record().integratedCommit);
      await writeFile(join(w.repo, "notes.txt"), "the person's own notes\n");
      const main = g(w.repo, ["rev-parse", "main"]);
      w.land({ "b.txt": "b\n" });
      const before = snapshot(w.repo);
      expect(await w.pass()).toBe(true);
      expect(w.record()).toMatchObject({ state: "blocked", reason: "integration-worktree-dirty", pending: null });
      expect(snapshot(w.repo)).toEqual(before);
      expect(g(w.repo, ["rev-parse", "main"])).toBe(main);
    } finally { await w.dispose(); }
  });
});

describe("ssh (final review Minor 6)", { timeout: 60_000 }, () => {
  /** The environment the runner was handed for each git child that talks to a remote. */
  function spyNetworkEnv(): (Record<string, string> | undefined)[] {
    const seen: (Record<string, string> | undefined)[] = [];
    __setRunChildForTests((bin, args, opts) => {
      if (bin === "git" && args.includes("ls-remote")) seen.push(opts.env);
      return spawnRunChild(bin, args, opts);
    });
    return seen;
  }

  it("a remote's git child never prompts over ssh unless the person set their own ssh command, which is then left alone", async () => {
    const w = await world(PB); try {
      vi.stubEnv("GIT_SSH_COMMAND", "");
      let seen = spyNetworkEnv();
      expect(await remoteTip(w.repo, "origin", "main")).not.toBeNull();
      expect(seen.map((env) => env?.GIT_SSH_COMMAND)).toEqual(["ssh -o BatchMode=yes"]);
      // The repository's own core.sshCommand: GIT_SSH_COMMAND would override it, so none is set.
      g(w.repo, ["config", "core.sshCommand", "ssh -i /the/persons/key"]);
      seen = spyNetworkEnv();
      await remoteTip(w.repo, "origin", "main");
      expect(seen).toHaveLength(1);
      expect(seen[0]?.GIT_SSH_COMMAND).toBeUndefined();
      // The person's GIT_SSH_COMMAND reaches the child (the runner drops every other inherited GIT_* variable).
      g(w.repo, ["config", "--unset", "core.sshCommand"]);
      vi.stubEnv("GIT_SSH_COMMAND", "ssh -F /the/persons/config");
      seen = spyNetworkEnv();
      await remoteTip(w.repo, "origin", "main");
      expect(seen.map((env) => env?.GIT_SSH_COMMAND)).toEqual(["ssh -F /the/persons/config"]);
    } finally { await w.dispose(); }
  });

  it("the runner sets exactly the variables it is handed over its own environment, and no GIT_SSH_COMMAND of its own", async () => {
    vi.stubEnv("GIT_SSH_COMMAND", "inherited");
    const echo = ["-c", 'printf %s "${GIT_SSH_COMMAND-unset}"'];
    expect((await spawnRunChild("sh", echo, { cwd: "/" })).stdout).toBe("unset");
    expect((await spawnRunChild("sh", echo, { cwd: "/", env: { GIT_SSH_COMMAND: "ssh -o BatchMode=yes" } })).stdout).toBe("ssh -o BatchMode=yes");
  });
});

describe("the person's index (final review M-T3)", { timeout: 60_000 }, () => {
  it("H5's cleanliness check does not rewrite the checked-out worktree's index, even with its stat cache out of date", async () => {
    const w = await world(LOCAL_MERGE); try {
      w.land({ "a.txt": "a\n" });
      // A tracked file whose content is unchanged but whose mtime is not what the index recorded: a plain `git status`
      // refreshes that entry and writes the index back. The untracked file makes the check block, so nothing else runs.
      utimesSync(join(w.repo, "f.txt"), new Date("2001-01-01T00:00:00Z"), new Date("2001-01-01T00:00:00Z"));
      await writeFile(join(w.repo, "notes.txt"), "the person's own notes\n");
      const index = () => createHash("sha256").update(readFileSync(join(w.repo, ".git", "index"))).digest("hex");
      const before = index();
      expect(await w.pass()).toBe(true);
      expect(w.record()).toMatchObject({ state: "blocked", reason: "integration-worktree-dirty" });
      expect(index()).toBe(before);
    } finally { await w.dispose(); }
  });
});

/** sha256 of every file in the worktree (not .git) and git's status. */
function snapshot(repo: string): { files: Record<string, string>; status: string } {
  const files: Record<string, string> = {};
  const walk = (dir: string, prefix: string) => {
    for (const name of readdirSync(dir).sort()) {
      if (prefix === "" && name === ".git") continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path, `${prefix}${name}/`);
      else files[`${prefix}${name}`] = createHash("sha256").update(readFileSync(path)).digest("hex");
    }
  };
  walk(repo, "");
  return { files, status: g(repo, ["status", "--porcelain", "--untracked-files=all"]) };
}

describe("trigger group (integration spec §5)", { timeout: 60_000 }, () => {
  it("4: landings while the group is incomplete wait; once every task is done, one integration carries them", async () => {
    const w = await world({ ...PB, trigger: "group" }); try {
      w.land({ "a.txt": "a\n" });
      const tip = w.land({ "b.txt": "b\n" });
      expect(await w.pass()).toBe(false);
      expect(w.remote("orca/g")).toBeNull();
      const work = JSON.parse(String(w.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body)) as Record<string, unknown>;
      expect(work.kind).toBe("task");
      w.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='a'").run(JSON.stringify({ ...work, status: "done" }));
      // A run still active (or reconciling) in the group: not complete yet.
      w.store.db.prepare("INSERT INTO runs VALUES ('r-live','g','a',1,1,'{}')").run();
      expect(await w.pass()).toBe(false);
      w.store.db.prepare("UPDATE runs SET active=0 WHERE id='r-live'").run();
      expect(await w.pass()).toBe(true);
      expect(w.remote("orca/g")).toBe(tip);
      expect(w.record().lastIntegrated).toBe(tip);
    } finally { await w.dispose(); }
  });
});

describe("push-target (integration spec §6.1 step 4, §6.5)", { timeout: 60_000 }, () => {
  it("5: integrates on top of a remote main another clone advanced; moved once between fetch and push recomputes; moved twice blocks", async () => {
    const w = await world(PT_MERGE); try {
      const advanced = w.pushFromOther("main", { "theirs.txt": "t\n" });
      const first = w.land({ "a.txt": "a\n" });
      expect(await w.pass()).toBe(true);
      const merged = w.remote("main")!;
      expect(parents(w.bare, merged)).toEqual([advanced, first]);
      expect(w.record()).toMatchObject({ lastIntegrated: first, integratedCommit: merged, state: "idle" });

      const second = w.land({ "b.txt": "b\n" });
      let moves = 0, moved = "";
      expect(await w.pass({ beforePublish: async () => { if (moves++ === 0) moved = w.pushFromOther("main", { "m1.txt": "1\n" }); } })).toBe(true);
      expect(moves).toBe(2);
      expect(parents(w.bare, w.remote("main")!)).toEqual([moved, second]);
      expect(w.record()).toMatchObject({ lastIntegrated: second, state: "idle", pending: null });

      w.land({ "c.txt": "c\n" });
      let always = 0;
      expect(await w.pass({ beforePublish: async () => { always += 1; w.pushFromOther("main", { [`m${always + 1}.txt`]: "x\n" }); } })).toBe(true);
      expect(always).toBe(2);
      expect(w.record()).toMatchObject({ state: "blocked", reason: "integration-target-moved", pending: null, lastIntegrated: second });
    } finally { await w.dispose(); }
  });

  it("6: a remote that refuses the push (a protected branch) blocks integration-push-refused with git's message", async () => {
    const w = await world(PT_MERGE); try {
      await writeFile(join(w.bare, "hooks", "pre-receive"), "#!/bin/sh\necho 'main is protected' >&2\nexit 1\n", { mode: 0o755 });
      const main = w.remote("main");
      w.land({ "a.txt": "a\n" });
      expect(await w.pass()).toBe(true);
      expect(w.record()).toMatchObject({ state: "blocked", pending: null });
      expect(w.record().reason).toMatch(/^integration-push-refused:.*pre-receive hook declined/);
      expect(w.remote("main")).toBe(main);
    } finally { await w.dispose(); }
  });

  it("10: the target branch gone from the remote blocks integration-target-missing; the remote gone blocks integration-remote-missing", async () => {
    const w = await world(PT_MERGE); try {
      w.land({ "a.txt": "a\n" });
      g(w.bare, ["update-ref", "-d", "refs/heads/main"]);
      expect(await w.pass()).toBe(true);
      expect(w.record()).toMatchObject({ state: "blocked", reason: "integration-target-missing" });
      expect(w.service.retryIntegration(w.command("retry-integration", {}))).toMatchObject({ result: { kind: "integration-retried" } });
      g(w.repo, ["remote", "remove", "origin"]);
      expect(await w.pass()).toBe(true);
      expect(w.record()).toMatchObject({ state: "blocked", reason: "integration-remote-missing" });
    } finally { await w.dispose(); }
  });

  it("drops what it was recording when the group's scheme changed while it ran (spec §6.1 step 6)", async () => {
    const w = await world(PT_MERGE); try {
      w.land({ "a.txt": "a\n" });
      const next: IntegrationScheme = { ...PT_MERGE, trigger: "group" };
      expect(await w.pass({ beforePublish: async () => { setRecord(w.store, { ...w.record(), scheme: next, schemeHash: schemeHash(next), pending: null }); } })).toBe(false);
      expect(w.record()).toMatchObject({ scheme: next, lastIntegrated: null, integratedCommit: null, pending: null, state: "idle" });
    } finally { await w.dispose(); }
  });
});

describe("a remote that does not answer (integration spec §6.5, review focus 4)", { timeout: 60_000 }, () => {
  it("8: times out, stays idle and backs off 30 s, then 60 s, returning within 3 s each time", async () => {
    vi.stubEnv("ORCA_INTEGRATION_TIMEOUT_MS", "500");
    const w = await world(PB); try {
      g(w.repo, ["config", "protocol.ext.allow", "always"]);
      g(w.repo, ["config", "remote.origin.url", "ext::sh -c sleep% 5"]);
      w.land({ "a.txt": "a\n" });
      let started = Date.now();
      expect(await w.pass()).toBe(false);
      expect(Date.now() - started).toBeLessThan(3000);
      expect(w.record()).toMatchObject({ state: "idle", retryAfter: w.clock() + 30_000, transient: 1 });
      // Not due again until the backoff has passed.
      expect(await w.pass()).toBe(false);
      expect(w.record().transient).toBe(1);
      w.setClock(w.clock() + 30_000);
      started = Date.now();
      expect(await w.pass()).toBe(false);
      expect(Date.now() - started).toBeLessThan(3000);
      expect(w.record()).toMatchObject({ state: "idle", retryAfter: w.clock() + 60_000, transient: 2 });
      // The doubling stops at 10 minutes.
      setRecord(w.store, { ...w.record(), transient: 10, retryAfter: null });
      expect(await w.pass()).toBe(false);
      expect(w.record()).toMatchObject({ retryAfter: w.clock() + 600_000, transient: 11 });
    } finally { await w.dispose(); }
  });

  it("8 (driver): a group's run still lands and settles while its integration keeps timing out", async () => {
    vi.stubEnv("ORCA_INTEGRATION_TIMEOUT_MS", "500");
    const t = await driverHarness([{ taskId: "a" }]); try {
      g(t.repo, ["config", "protocol.ext.allow", "always"]);
      g(t.repo, ["remote", "add", "origin", "ext::sh -c sleep% 5"]);
      setRecord(t.h.store, { ...newGroupIntegration(PB)!, frozen: true });
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "settled");
      expect(record(t.h.store)).toMatchObject({ state: "idle", transient: 1, lastIntegrated: null });
      expect(record(t.h.store).retryAfter).toBeGreaterThan(Date.now());
    } finally { await t.h.dispose(); }
  });
});

describe("the driver runs the pass (integration spec §5)", { timeout: 60_000 }, () => {
  it("pushes the landed tip after the run lands, and a crash after the write-ahead record is finished by the next driver", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const bare = join(t.h.root, "remote.git");
      g(t.h.root, ["init", "-q", "--bare", bare]);
      g(t.repo, ["remote", "add", "origin", bare]);
      g(t.repo, ["push", "-q", "origin", "main"]);
      setRecord(t.h.store, { ...newGroupIntegration(PB)!, frozen: true });
      const runId = await t.claim();
      const crashing = createExecutionDriver({ ...t.deps, crash: (at) => { if (at === "after-pending") throw new DriverCrash(at); } });
      for (let i = 0; i < 60 && crashing.crashed === null; i += 1) await crashing.round();
      expect(crashing.crashed).toBe("after-pending");
      const tip = g(t.repo, ["rev-parse", "refs/heads/orca/g"]);
      expect(record(t.h.store).pending).toMatchObject({ tip, new: tip });
      await t.until(t.driver(), () => record(t.h.store).lastIntegrated !== null && t.body(runId).state === "settled");
      expect(g(bare, ["rev-parse", "refs/heads/orca/g"])).toBe(record(t.h.store).lastIntegrated);
      expect(record(t.h.store)).toMatchObject({ pending: null, state: "idle" });
    } finally { await t.h.dispose(); }
  });
});

describe("who integrates (integration spec §5, ruling R7) and retry (§6.5)", { timeout: 60_000 }, () => {
  it("12: a person-paused group is not due; a budget-blocked group still integrates", async () => {
    const w = await world(PB); try {
      const tip = w.land({ "a.txt": "a\n" });
      // Before an owner's confirm the copy is not frozen: nothing is integrated.
      setRecord(w.store, { ...w.record(), frozen: false });
      expect(await w.pass()).toBe(false);
      setRecord(w.store, { ...w.record(), frozen: true });
      w.store.db.prepare("INSERT INTO stop_intents VALUES ('g','pause',1,'{}')").run();
      expect(await w.pass()).toBe(false);
      expect(w.remote("orca/g")).toBeNull();
      w.store.db.prepare("DELETE FROM stop_intents WHERE group_id='g'").run();
      writeGroupBody(w.store, { ...groupBody(w.store), status: "blocked" });
      expect(await w.pass()).toBe(true);
      expect(w.remote("orca/g")).toBe(tip);
    } finally { await w.dispose(); }
  });

  it("11: retry-integration moves blocked to idle and refuses an idle integration (or a group without one) integration-not-blocked", async () => {
    const w = await world(PB); try {
      const code = (result: unknown) => (result as { error?: { code: string } }).error?.code ?? "applied";
      expect(code(w.service.retryIntegration(w.command("retry-integration", {})))).toBe("integration-not-blocked");
      setRecord(w.store, { ...w.record(), state: "blocked", reason: "integration-push-refused:x", retryAfter: 5, transient: 3 });
      expect(code(w.service.retryIntegration(w.command("retry-integration", {})))).toBe("applied");
      expect(w.record()).toMatchObject({ state: "idle", reason: null, retryAfter: null, transient: 0 });
      expect(code(w.service.retryIntegration(w.command("retry-integration", {})))).toBe("integration-not-blocked");
      const { integration: _gone, ...keep } = groupBody(w.store);
      writeGroupBody(w.store, keep);
      expect(code(w.service.retryIntegration(w.command("retry-integration", {})))).toBe("integration-not-blocked");
    } finally { await w.dispose(); }
  });
});

describe("more of the failure table and the due rule (integration spec §5, §6.3, §6.5)", { timeout: 60_000 }, () => {
  it("push-branch: a remote removed blocks remote-missing; a path that is no repository blocks push-refused; a network error backs off", async () => {
    const w = await world(PB); try {
      w.land({ "a.txt": "a\n" });
      g(w.repo, ["remote", "remove", "origin"]);
      expect(await w.pass()).toBe(true);
      expect(w.record()).toMatchObject({ state: "blocked", reason: "integration-remote-missing", pending: null });
      w.service.retryIntegration(w.command("retry-integration", {}));
      g(w.repo, ["remote", "add", "origin", join(w.root, "no-such-remote.git")]);
      expect(await w.pass()).toBe(true);
      expect(w.record()).toMatchObject({ state: "blocked" });
      expect(w.record().reason).toMatch(/^integration-push-refused:.*does not appear to be a git repository/);
      w.service.retryIntegration(w.command("retry-integration", {}));
      g(w.repo, ["config", "protocol.ext.allow", "always"]);
      g(w.repo, ["config", "remote.origin.url", "ext::sh -c echo% fatal:% Could% not% resolve% host:% example.invalid% 1>&2"]);
      expect(await w.pass()).toBe(false);
      expect(w.record()).toMatchObject({ state: "idle", retryAfter: w.clock() + 30_000, transient: 1 });
    } finally { await w.dispose(); }
  });

  it("push-target: a network error on the fetch backs off instead of blocking", async () => {
    const w = await world(PT_MERGE); try {
      w.land({ "a.txt": "a\n" });
      g(w.repo, ["config", "protocol.ext.allow", "always"]);
      g(w.repo, ["config", "remote.origin.url", "ext::sh -c echo% fatal:% Could% not% resolve% host:% example.invalid% 1>&2"]);
      expect(await w.pass()).toBe(false);
      expect(w.record()).toMatchObject({ state: "idle", retryAfter: w.clock() + 30_000, transient: 1, pending: null });
    } finally { await w.dispose(); }
  });

  it("local: a missing target blocks target-missing; a target moved under the swap is recomputed once; a locked ref backs off", async () => {
    const w = await world(LOCAL_MERGE, { checkedOutOther: true }); try {
      const first = w.land({ "a.txt": "a\n" });
      let moved = "";
      expect(await w.pass({ beforePublish: async () => { if (moved === "") moved = commitOn(w.repo, "refs/heads/main", { "p.txt": "p\n" }, "person"); } })).toBe(true);
      expect(parents(w.repo, g(w.repo, ["rev-parse", "main"]))).toEqual([moved, first]);
      w.land({ "b.txt": "b\n" });
      const main = g(w.repo, ["rev-parse", "main"]);
      const lock = join(w.repo, ".git", "refs", "heads", "main.lock");
      expect(await w.pass({ beforePublish: async () => { await writeFile(lock, ""); } })).toBe(false);
      expect(w.record()).toMatchObject({ state: "idle", transient: 1, retryAfter: w.clock() + 30_000 });
      expect(g(w.repo, ["rev-parse", "main"])).toBe(main);
      execFileSync("rm", ["-f", lock]);
      g(w.repo, ["branch", "-D", "main"]);
      w.setClock(w.clock() + 30_000);
      expect(await w.pass()).toBe(true);
      expect(w.record()).toMatchObject({ state: "blocked", reason: "integration-target-missing" });
    } finally { await w.dispose(); }
  });

  it("H5: a checked-out target whose HEAD moved past what was computed blocks integration-not-fast-forward, untouched", async () => {
    const w = await world(LOCAL_MERGE); try {
      w.land({ "a.txt": "a\n" });
      let head = "";
      expect(await w.pass({ beforePublish: async () => {
        await writeFile(join(w.repo, "p.txt"), "p\n"); g(w.repo, ["add", "p.txt"]); g(w.repo, ["commit", "-qm", "person"]); head = g(w.repo, ["rev-parse", "HEAD"]);
      } })).toBe(true);
      expect(w.record()).toMatchObject({ state: "blocked", reason: "integration-not-fast-forward", pending: null });
      expect(g(w.repo, ["rev-parse", "HEAD"])).toBe(head);
      expect(g(w.repo, ["status", "--porcelain", "--untracked-files=all"])).toBe("");
    } finally { await w.dispose(); }
  });

  it("a target that already contains the tip is recorded as integrated without a new commit", async () => {
    const w = await world(LOCAL_MERGE, { checkedOutOther: true }); try {
      w.land({ "a.txt": "a\n" });
      await w.pass();
      const integrated = w.record().integratedCommit!;
      const tip = w.land({ "b.txt": "b\n" });
      // The person merged the new landing into main themselves.
      const theirs = g(w.repo, ["commit-tree", `${tip}^{tree}`, "-p", integrated, "-p", tip, "-m", "person merge"]);
      g(w.repo, ["update-ref", "refs/heads/main", theirs]);
      expect(await w.pass()).toBe(true);
      expect(w.record()).toMatchObject({ lastIntegrated: tip, integratedCommit: integrated, state: "idle", pending: null });
      expect(g(w.repo, ["rev-parse", "main"])).toBe(theirs);
    } finally { await w.dispose(); }
  });

  it("squash: a conflict is recorded as for merge, naming the paths", async () => {
    const w = await world(LOCAL_SQUASH, { checkedOutOther: true }); try {
      const tip = w.land({ "f.txt": "A\ntwo\nthree\n" });
      const main = commitOn(w.repo, "refs/heads/main", { "f.txt": "B\ntwo\nthree\n" }, "person");
      expect(await w.pass()).toBe(true);
      expect(w.record()).toMatchObject({ state: "conflict", reason: "integration-conflict", conflict: { attempt: 1, base: main, tip, paths: ["f.txt"] } });
      expect(g(w.repo, ["rev-parse", "main"])).toBe(main);
    } finally { await w.dispose(); }
  });

  it("a scheme changed while the target moved ends the integration there, without recomputing for the old scheme", async () => {
    const w = await world(PT_MERGE); try {
      w.land({ "a.txt": "a\n" });
      const next: IntegrationScheme = { ...PT_MERGE, trigger: "group" };
      let calls = 0;
      expect(await w.pass({ beforePublish: async () => {
        calls += 1;
        if (calls === 1) { setRecord(w.store, { ...w.record(), scheme: next, schemeHash: schemeHash(next) }); w.pushFromOther("main", { "m.txt": "m\n" }); }
      } })).toBe(false);
      expect(calls).toBe(1);
      expect(w.record()).toMatchObject({ scheme: next, lastIntegrated: null });
      expect(w.record().pending).not.toBeNull();
    } finally { await w.dispose(); }
  });

  it("a stopped driver or a draining panel integrates nothing; a record that does not parse is skipped by name", async () => {
    const w = await world(PB); try {
      w.land({ "a.txt": "a\n" });
      const calls = spyChildren();
      expect(await w.pass({ stopped: () => true })).toBe(false);
      const gate = { enter: () => () => undefined, beginDrain: () => ({ beforeWriterTransaction: Promise.resolve() }), draining: true };
      expect(await w.pass({ admissionGate: gate })).toBe(false);
      expect(calls).toEqual([]);
      const good = w.record();
      writeGroupBody(w.store, { ...groupBody(w.store), integration: { ...good, state: "sideways" } });
      expect(await w.pass()).toBe(false);
      expect(calls).toEqual([]);
      setRecord(w.store, good);
      expect(await w.pass()).toBe(true);
    } finally { await w.dispose(); }
  });

  it("before the first integration, a tip the remote-tracking target already contains is no landed work either", async () => {
    const w = await world(PB, { checkedOutOther: true }); try {
      g(w.repo, ["branch", "-D", "main"]);
      expect(await w.pass()).toBe(false);
      expect(w.remote("orca/g")).toBeNull();
    } finally { await w.dispose(); }
  });
});

/** An `ext::` remote that writes git's words for a failure to stderr and exits 128 (nothing leaves the machine). */
const failingRemote = (words: string): string => `ext::sh -c echo% ${words.replace(/ /g, "% ")}% 1>&2;% exit% 128`;

describe("fix round 1: remote failures, the person's worktrees, one timeout per remote per round", { timeout: 60_000 }, () => {
  const AUTH = "fatal: Authentication failed for https://example.invalid/r.git/";
  const HTTP_403 = "fatal: unable to access https://example.invalid/r.git/: The requested URL returned error: 403";

  it("I2: an auth failure refuses by name on the push-branch push, the push-target fetch and the re-entry ls-remote", async () => {
    const pb = await world(PB); try {
      g(pb.repo, ["config", "protocol.ext.allow", "always"]);
      g(pb.repo, ["config", "remote.origin.url", failingRemote(AUTH)]);
      const tip = pb.land({ "a.txt": "a\n" });
      expect(await pb.pass()).toBe(true);
      expect(pb.record()).toMatchObject({ state: "blocked", pending: null });
      expect(pb.record().reason).toMatch(/^integration-push-refused:.*Authentication failed/);
      // Re-entry: a write-ahead record of this scheme makes the pass ask the remote with ls-remote first.
      setRecord(pb.store, { ...pb.record(), state: "idle", reason: null, pending: { schemeHash: pb.record().schemeHash, tip, base: tip, new: tip } });
      const calls = spyChildren();
      expect(await pb.pass()).toBe(true);
      expect(calls.find((call) => call[1] === "push")).toBeUndefined();
      expect(calls.some((call) => call[1] === "ls-remote")).toBe(true);
      expect(pb.record().reason).toMatch(/^integration-push-refused:.*Authentication failed/);
    } finally { await pb.dispose(); }
    const pt = await world(PT_MERGE); try {
      g(pt.repo, ["config", "protocol.ext.allow", "always"]);
      g(pt.repo, ["config", "remote.origin.url", failingRemote(AUTH)]);
      pt.land({ "a.txt": "a\n" });
      expect(await pt.pass()).toBe(true);
      expect(pt.record()).toMatchObject({ state: "blocked", pending: null });
      expect(pt.record().reason).toMatch(/^integration-push-refused:.*Authentication failed/);
    } finally { await pt.dispose(); }
  });

  it("I3: an HTTP 403 (a revoked token) blocks instead of backing off forever", async () => {
    const w = await world(PB); try {
      g(w.repo, ["config", "protocol.ext.allow", "always"]);
      g(w.repo, ["config", "remote.origin.url", failingRemote(HTTP_403)]);
      w.land({ "a.txt": "a\n" });
      expect(await w.pass()).toBe(true);
      expect(w.record()).toMatchObject({ state: "blocked", retryAfter: null, transient: 0 });
      expect(w.record().reason).toMatch(/^integration-push-refused:.*error: 403/);
    } finally { await w.dispose(); }
  });

  it("I1: a person's worktree whose directory is gone is still registered after an integration that used a workspace", async () => {
    const w = await world(LOCAL_MERGE, { checkedOutOther: true }); try {
      const theirs = join(w.root, "person-wt");
      g(w.repo, ["worktree", "add", "-q", "-b", "pw", theirs]);
      rmSync(theirs, { recursive: true, force: true });
      w.land({ "a.txt": "a\n" });
      expect(await w.pass()).toBe(true);
      expect(w.record().state).toBe("idle");
      expect(g(w.repo, ["worktree", "list", "--porcelain"])).toContain("person-wt");
    } finally { await w.dispose(); }
  });

  it("M1: two due groups on one hanging remote cost one timeout in a round; the second group is left for the next round", async () => {
    vi.stubEnv("ORCA_INTEGRATION_TIMEOUT_MS", "500");
    const w = await world(PB); try {
      const body = groupBody(w.store);
      w.store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES ('h',?,?,?)")
        .run(Number(body.revision ?? 1), Number(body.graphVersion ?? 1), JSON.stringify({ ...body, groupId: "h" }));
      g(w.repo, ["update-ref", "refs/heads/orca/h", "HEAD"]);
      w.land({ "a.txt": "a\n" });
      commitOn(w.repo, "refs/heads/orca/h", { "h.txt": "h\n" }, "land h");
      const count = join(w.root, "remote-hits");
      g(w.repo, ["config", "protocol.ext.allow", "always"]);
      g(w.repo, ["config", "remote.origin.url", `ext::sh -c echo% hit>>${count};% sleep% 5`]);
      const started = Date.now();
      expect(await w.pass()).toBe(false);
      expect(Date.now() - started).toBeLessThan(1500);
      expect(readFileSync(count, "utf8")).toBe("hit\n");
      expect(w.record()).toMatchObject({ transient: 1 });
      const h = readGroupIntegration(JSON.parse(String(w.store.db.prepare("SELECT body FROM groups WHERE id='h'").get()!.body)))!;
      expect(h).toMatchObject({ transient: 0, retryAfter: null, state: "idle", lastIntegrated: null });
    } finally { await w.dispose(); }
  });
});

describe("integration activity (issue-fixes spec §5.2)", { timeout: 60_000 }, () => {
  it("each result the pass records writes one integration row; a pass with nothing to do writes none", async () => {
    const w = await world(PB); try {
      const rows = () => readGroupActivity(w.store, "g", 100).filter((entry) => entry.kind === "integration").reverse().map((entry) => entry.body);
      expect(await w.pass()).toBe(false);
      expect(rows()).toEqual([]);
      w.land({ "a.txt": "a\n" });
      expect(await w.pass()).toBe(true);
      expect(rows()).toEqual([{ state: "idle", reason: null }]);
      w.pushFromOther("orca/g", { "theirs.txt": "x\n" });
      w.land({ "b.txt": "b\n" });
      expect(await w.pass()).toBe(true);
      expect(rows()).toEqual([{ state: "idle", reason: null }, { state: "blocked", reason: "integration-work-branch-diverged" }]);
    } finally { await w.dispose(); }
  });

  it("a transient failure only backs off and writes no integration row (a backoff is not a result)", async () => {
    vi.stubEnv("ORCA_INTEGRATION_TIMEOUT_MS", "500");
    const w = await world(PB); try {
      g(w.repo, ["config", "protocol.ext.allow", "always"]);
      g(w.repo, ["config", "remote.origin.url", "ext::sh -c sleep% 5"]);
      w.land({ "a.txt": "a\n" });
      expect(await w.pass()).toBe(false);
      // The pass did take the transient branch (the record backed off) ...
      expect(w.record()).toMatchObject({ state: "idle", transient: 1 });
      // ... and that branch recorded nothing.
      expect(readGroupActivity(w.store, "g", 100).filter((entry) => entry.kind === "integration")).toEqual([]);
    } finally { await w.dispose(); }
  });
});

describe("an archived group is not integrated (issue-fixes spec §6.3)", { timeout: 60_000 }, () => {
  it("skips its landed work while archived, and integrates it once unarchived", async () => {
    const w = await world(PB); try {
      const tip = w.land({ "a.txt": "a\n" });
      const archived = w.service.archiveGroup(w.command("archive-group", {}));
      if ("error" in archived) throw new Error(JSON.stringify(archived));
      expect(await w.pass()).toBe(false);
      expect(w.remote("orca/g")).toBeNull();
      w.service.unarchiveGroup(w.command("unarchive-group", {}));
      expect(await w.pass()).toBe(true);
      expect(w.remote("orca/g")).toBe(tip);
    } finally { await w.dispose(); }
  });
});
