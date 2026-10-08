// Integration spec §6.1 steps 2, 3, 6 and §10: a process death after any outward action of the integration pass, then a
// restart, publishes nothing twice -- no second push, no second PR, no second commit on a local target -- and settles the
// same record a pass that never crashed settles. Every delivery is run at every crash point it reaches, once with the
// crash and once without (the control), in two worlds built from the same fixed-date commits so their hashes agree.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { __setRunChildForTests, spawnRunChild } from "../../src/control/integrationGit.js";
import { integratePendingGroups, type IntegrationCrashPoint, type IntegrationDeps } from "../../src/control/integrationPass.js";
import { newGroupIntegration, readGroupIntegration, type GroupIntegration, type IntegrationScheme } from "../../src/control/integrationScheme.js";
import type { ControlStore } from "../../src/control/store.js";
import { controlWorkspaceRoots, unsetInheritedGitEnv } from "../../src/control/workspace.js";
import { webFixture } from "./fixtures/web.js";

const FAKE_GH = join(import.meta.dirname, "fixtures", "fakeGh.mjs");
const GITHUB_URL = "https://github.com/o/r.git";
// Fixed dates: the fixture's commits (base, landings) get the same hash in every world.
const FIXED = { GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" };

const g = (cwd: string, args: string[], options: { input?: string; env?: NodeJS.ProcessEnv } = {}): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args],
    { cwd, encoding: "utf8", stdio: "pipe", input: options.input, env: { ...process.env, ...unsetInheritedGitEnv(), ...FIXED, ...options.env } }).trim();

const groupBody = (store: ControlStore): Record<string, unknown> =>
  JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;
const writeGroupBody = (store: ControlStore, body: Record<string, unknown>) => store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(body));
const record = (store: ControlStore): GroupIntegration => readGroupIntegration(groupBody(store))!;

/** A commit on `ref` of `repo` whose tree is its parent's with `files` written, made with plumbing (no checkout). */
function commitOn(repo: string, ref: string, files: Record<string, string>, message: string): string {
  const parent = g(repo, ["rev-parse", ref]);
  const env = { GIT_INDEX_FILE: join(repo.endsWith(".git") ? repo : join(repo, ".git"), `orca-test-index-${process.pid}`) };
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
 * The fixture's group "g" (one task, done) with a frozen record of `scheme`. A bare remote whose every ref update is
 * logged (`core.logAllRefUpdates=always`), reached through a GitHub-shaped `origin` URL (`insteadOf`), so `github-pr`
 * names a GitHub repository and every other delivery uses the same transport. The target repository has `other`
 * checked out, so a `local` integration moves `main` by `update-ref` without touching a worktree.
 */
async function world(scheme: IntegrationScheme) {
  const h = await webFixture();
  const bare = join(h.root, "remote.git"), repo = join(h.root, "target"), ghDir = join(h.root, "gh");
  g(h.root, ["init", "-q", "--bare", "-b", "main", bare]);
  g(bare, ["config", "core.logAllRefUpdates", "always"]);
  g(h.root, ["init", "-q", "-b", "main", repo]);
  writeFileSync(join(repo, "f.txt"), "one\ntwo\nthree\n");
  g(repo, ["add", "f.txt"]); g(repo, ["commit", "-qm", "base"]);
  g(repo, ["remote", "add", "origin", GITHUB_URL]);
  g(repo, ["config", `url.${bare}.insteadOf`, GITHUB_URL]);
  g(repo, ["push", "-q", "origin", "main"]);
  g(repo, ["fetch", "-q", "origin"]);
  g(repo, ["checkout", "-q", "-b", "other"]);
  g(repo, ["update-ref", "refs/heads/orca/g", "main"]);
  await mkdir(ghDir);
  writeFileSync(join(ghDir, "state.json"), JSON.stringify({ prs: [], authOk: true, refuseDraft: false, fail: {} }));
  writeGroupBody(h.store, { ...groupBody(h.store), integration: { ...newGroupIntegration(scheme)!, frozen: true } });
  // The group is complete, so a `github-pr` integration opens its draft and marks it ready in the same pass.
  const work = JSON.parse(String(h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body)) as Record<string, unknown>;
  expect(work.kind).toBe("task");
  h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='a'").run(JSON.stringify({ ...work, status: "done" }));
  const deps = (extra: Partial<IntegrationDeps>): IntegrationDeps => ({
    store: h.store, roots: controlWorkspaceRoots(h.store.stateDir), admissionGate: h.deps.admissionGate, repoPathOf: () => repo,
    now: () => 1_000_000, ghBin: FAKE_GH, stopped: () => false, ...extra,
  });
  return {
    ...h, bare, repo,
    /** One pass with this world's fake gh; every git and gh child it starts is appended to `children`. */
    pass: async (children: string[][], extra: Partial<IntegrationDeps> = {}) => {
      vi.stubEnv("FAKE_GH_DIR", ghDir);
      __setRunChildForTests((bin, args, opts) => { children.push([bin, ...args]); return spawnRunChild(bin, args, opts); });
      try { return await integratePendingGroups(deps(extra)); } finally { __setRunChildForTests(null); }
    },
    ghCalls: (): string[] => {
      const path = join(ghDir, "calls.jsonl");
      return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter((line) => line.length > 0).map((line) => (JSON.parse(line) as { argv: string[] }).argv.slice(0, 2).join(" ")) : [];
    },
    land: (files: Record<string, string>) => commitOn(repo, "refs/heads/orca/g", files, "land"),
    record: () => record(h.store),
  };
}
type World = Awaited<ReturnType<typeof world>>;
afterEach(() => { __setRunChildForTests(null); vi.unstubAllEnvs(); });

/** Where a delivery publishes: the repository and ref an integration moves. */
function publishedRef(w: World, scheme: IntegrationScheme): { repo: string; ref: string } {
  if (scheme.delivery === "local") return { repo: w.repo, ref: "refs/heads/main" };
  if (scheme.delivery === "push-target") return { repo: w.bare, ref: "refs/heads/main" };
  return { repo: w.bare, ref: "refs/heads/orca/g" };
}
/** How many times `ref` of `repo` was updated, from its reflog (0 when it does not exist yet). */
function updates(repo: string, ref: string): number {
  try { return g(repo, ["reflog", "show", "--format=%H", ref]).split("\n").filter((line) => line.length > 0).length; } catch { return 0; }
}
/**
 * A commit as what makes it, without its dates: tree, parents and subject. The pass's own commits (a merge, a squash)
 * carry the time they were made, so two worlds agree on them only by content; the fixture's commits agree by hash.
 */
function shape(repo: string, commit: string | null): string | null {
  return commit === null ? null : g(repo, ["show", "-s", "--format=%T %P %s", commit]);
}
/** The record as the two worlds can compare it (§4's fields; `integratedCommit` by shape). */
function settled(w: World, scheme: IntegrationScheme) {
  const at = w.record(), where = publishedRef(w, scheme);
  return {
    record: { state: at.state, reason: at.reason, pending: at.pending, lastIntegrated: at.lastIntegrated, integratedCommit: shape(where.repo, at.integratedCommit),
      pr: at.pr, conflict: at.conflict, retryAfter: at.retryAfter, transient: at.transient },
    published: shape(where.repo, g(where.repo, ["rev-parse", "--verify", "--quiet", where.ref])),
  };
}

const LANDING = { "a.txt": "a\n", "f.txt": "ONE\ntwo\nthree\n" };
const crashAt = (point: IntegrationCrashPoint) => (at: IntegrationCrashPoint) => { if (at === point) throw new Error(`crash ${at}`); };

const CASES: [string, IntegrationScheme, IntegrationCrashPoint[]][] = [
  ["local merge", { delivery: "local", trigger: "task", method: "merge", target: "main" }, ["after-pending", "after-publish"]],
  ["local squash", { delivery: "local", trigger: "task", method: "squash", target: "main" }, ["after-pending", "after-publish"]],
  ["push-target merge", { delivery: "push-target", trigger: "task", method: "merge", target: "main", remote: "origin" }, ["after-pending", "after-publish"]],
  ["push-target squash", { delivery: "push-target", trigger: "task", method: "squash", target: "main", remote: "origin" }, ["after-pending", "after-publish"]],
  ["push-branch", { delivery: "push-branch", trigger: "task", target: "main", remote: "origin" }, ["after-pending", "after-publish"]],
  ["github-pr", { delivery: "github-pr", trigger: "task", target: "main", remote: "origin" }, ["after-pending", "after-publish", "after-pr-create", "after-pr-ready"]],
];
const ROWS = CASES.flatMap(([name, scheme, points]) => points.map((point) => [name, point, scheme] as const));

describe("a crash after each outward action, then a restart (integration spec §6.1 steps 2, 3, 6)", { timeout: 60_000 }, () => {
  it.each(ROWS)("%s, crash %s: published once, recorded as if it never crashed", async (_name, point, scheme) => {
    const control = await world(scheme), crashed = await world(scheme);
    try {
      const controlChildren: string[][] = [];
      const tip = control.land(LANDING);
      const where = publishedRef(control, scheme);
      const before = updates(where.repo, where.ref);
      expect(await control.pass(controlChildren)).toBe(true);
      expect(control.record()).toMatchObject({ state: "idle", lastIntegrated: tip, pending: null });

      const children: string[][] = [];
      expect(crashed.land(LANDING)).toBe(tip);
      expect(updates(publishedRef(crashed, scheme).repo, where.ref)).toBe(before);
      await expect(crashed.pass(children, { crash: crashAt(point) })).rejects.toThrow(`crash ${point}`);
      // The crash left the write-ahead record and nothing settled.
      expect(crashed.record()).toMatchObject({ state: "idle", lastIntegrated: null, pending: { tip } });
      expect(await crashed.pass(children)).toBe(true);

      // Same target and same record as the pass that never crashed.
      expect(settled(crashed, scheme)).toEqual(settled(control, scheme));
      // The published ref moved exactly as often as the control's (once), across the crash and the restart.
      const controlUpdates = updates(where.repo, where.ref) - before;
      expect(controlUpdates).toBe(1);
      expect(updates(publishedRef(crashed, scheme).repo, where.ref) - before).toBe(controlUpdates);
      // No second push, by child: as many as the control started (one for a remote delivery, none for local).
      const pushes = (list: string[][]) => list.filter((child) => child[0] === "git" && child.includes("push")).length;
      expect(pushes(controlChildren)).toBe(scheme.delivery === "local" ? 0 : 1);
      expect(pushes(children)).toBe(pushes(controlChildren));
      // Exactly one PR opened and at most one ready, as in the control.
      if (scheme.delivery === "github-pr") {
        expect(control.ghCalls().filter((each) => each === "pr create")).toHaveLength(1);
        expect(crashed.ghCalls().filter((each) => each === "pr create")).toHaveLength(1);
        expect(crashed.ghCalls().filter((each) => each === "pr ready").length).toBeLessThanOrEqual(1);
        expect(crashed.record().pr).toEqual({ url: "https://github.com/o/r/pull/1", number: 1, ready: true });
      }
    } finally { await control.dispose(); await crashed.dispose(); }
  });

  // spec §6.1 step 2, "equals or contains": the target moved past the published `new` before the restart.
  it.each([
    ["local squash", { delivery: "local", trigger: "task", method: "squash", target: "main" }],
    ["push-target squash", { delivery: "push-target", trigger: "task", method: "squash", target: "main", remote: "origin" }],
  ] as [string, IntegrationScheme][])("%s, crash after-publish, then someone commits on the target: the restart adds no second commit", async (_name, scheme) => {
    const w = await world(scheme); try {
      const tip = w.land(LANDING);
      await expect(w.pass([], { crash: crashAt("after-publish") })).rejects.toThrow("crash after-publish");
      const published = w.record().pending!.new;
      const where = publishedRef(w, scheme);
      const person = commitOn(where.repo, where.ref, { "person.txt": "p\n" }, "person");
      const before = updates(where.repo, where.ref);
      const children: string[][] = [];
      expect(await w.pass(children)).toBe(true);
      expect(g(where.repo, ["rev-parse", where.ref])).toBe(person);
      expect(updates(where.repo, where.ref)).toBe(before);
      expect(children.filter((child) => child.includes("push"))).toEqual([]);
      expect(w.record()).toMatchObject({ state: "idle", lastIntegrated: tip, integratedCommit: published, pending: null });
    } finally { await w.dispose(); }
  });
});
