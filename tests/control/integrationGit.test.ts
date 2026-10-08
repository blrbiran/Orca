// Integration spec §5, §6.1-§6.3, §6.5: the integration pass against real git -- a bare remote, a target repository
// cloned from it, and landings made on `orca/g` with plumbing (no ccloop). Each case names the spec line it pins.
// Real git children (and the driver harness) take seconds under load, so every describe allows a minute.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createExecutionDriver, DriverCrash } from "../../src/control/executionDriver.js";
import { __setRunChildForTests, spawnRunChild } from "../../src/control/integrationGit.js";
import { integratePendingGroups, type IntegrationDeps } from "../../src/control/integrationPass.js";
import { newGroupIntegration, readGroupIntegration, schemeHash, type GroupIntegration, type IntegrationScheme } from "../../src/control/integrationScheme.js";
import type { ControlStore } from "../../src/control/store.js";
import { WebControlService } from "../../src/control/webService.js";
import { controlWorkspaceRoots } from "../../src/control/workspace.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { webFixture } from "./fixtures/web.js";

const g = (cwd: string, args: string[], options: { input?: string; env?: NodeJS.ProcessEnv } = {}): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8", stdio: "pipe", input: options.input, env: { ...process.env, ...options.env } }).trim();

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
