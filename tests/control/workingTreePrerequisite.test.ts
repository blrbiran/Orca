import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prerequisiteDone } from "../../src/control/groupEdges.js";
import { integratePendingGroups, type IntegrationDeps } from "../../src/control/integrationPass.js";
import { newGroupIntegration } from "../../src/control/integrationScheme.js";
import { controlWorkspaceRoots, unsetInheritedGitEnv } from "../../src/control/workspace.js";
import { webFixture } from "./fixtures/web.js";

/**
 * Tester #434: a `working-tree` delivery that the checkout REFUSED (paths the person had edited) left the group reading
 * `state=done landed=true` everywhere: `deliversLocally` counted only `local` and the dir/multi shapes, so
 * `prerequisiteDone` answered true without ever looking at the integration record, and `group brief` carried only the
 * `full-suite-not-set` warning. The person believed the files were delivered; the integration was blocked and nothing had
 * been written.
 */
const gRaw = (cwd: string, args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args],
    { cwd, encoding: "utf8", stdio: "pipe", env: { ...process.env, ...unsetInheritedGitEnv() } });
const g = (cwd: string, args: string[]) => gRaw(cwd, args).trim();
afterEach(() => { vi.unstubAllEnvs(); });

async function world() {
  const h = await webFixture();
  const repo = join(h.root, "checkout");
  mkdirSync(repo);
  g(repo, ["init", "-q", "-b", "main"]);
  writeFileSync(join(repo, "a.txt"), "one\n");
  g(repo, ["add", "-A"]); g(repo, ["commit", "-qm", "base"]);
  const base = g(repo, ["rev-parse", "HEAD"]);
  g(repo, ["update-ref", "refs/heads/orca/g", base]);
  const body = (): Record<string, unknown> => JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;
  h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...body(), integration: { ...newGroupIntegration({ delivery: "working-tree" })!, frozen: true } }));
  h.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES ('run-a','g','a',1,0,?)")
    .run(JSON.stringify({ runId: "run-a", groupId: "g", workItemId: "a", taskId: "a", phase: "work", state: "settled", drive: { base } }));
  const commitOn = (ops: Record<string, string>): string => {
    const parent = g(repo, ["rev-parse", "refs/heads/orca/g"]);
    const env = { GIT_INDEX_FILE: join(repo, ".git", `wtp-index-${process.pid}`) };
    execFileSync("git", ["read-tree", parent], { cwd: repo, env: { ...process.env, ...unsetInheritedGitEnv(), ...env } });
    for (const [path, text] of Object.entries(ops)) {
      const oid = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: repo, input: text, encoding: "utf8" }).trim();
      execFileSync("git", ["update-index", "--add", "--cacheinfo", `100644,${oid},${path}`], { cwd: repo, env: { ...process.env, ...unsetInheritedGitEnv(), ...env } });
    }
    const tree = execFileSync("git", ["write-tree"], { cwd: repo, env: { ...process.env, ...unsetInheritedGitEnv(), ...env }, encoding: "utf8" }).trim();
    const commit = execFileSync("git", ["commit-tree", tree, "-p", parent, "-m", "land"], { cwd: repo, encoding: "utf8" }).trim();
    g(repo, ["update-ref", "refs/heads/orca/g", commit]);
    return commit;
  };
  const deps = (): IntegrationDeps => ({ store: h.store, roots: controlWorkspaceRoots(h.store.stateDir), admissionGate: h.deps.admissionGate,
    repoPathOf: () => repo, now: () => 1_000_000, ghBin: "/nonexistent/gh", stopped: () => false });
  /** Task done and accepted, as the driver leaves a finished group. */
  const finish = (): void => {
    for (const row of h.store.db.prepare("SELECT id, body FROM work_items WHERE group_id='g'").all())
      h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id=?").run(JSON.stringify({ ...JSON.parse(String(row.body)), status: "done" }), String(row.id));
    h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...body(), status: "done",
      acceptance: { tip: null, result: "not-needed", why: "single-landing", commands: [], at: 1, fullSuite: { command: null, suggestion: null, exits: [], flaky: false } } }));
  };
  return { ...h, repo, commitOn, deps, finish, body };
}

describe("a refused working-tree write does not read as delivered (#434)", { timeout: 120_000 }, () => {
  it("a group whose files conflicted is not done for its dependents", async () => {
    const w = await world();
    try {
      w.commitOn({ "a.txt": "theirs\n" });
      w.finish();
      // The person edited a.txt in place: the write is refused, nothing is delivered.
      writeFileSync(join(w.repo, "a.txt"), "mine\n");
      expect(await integratePendingGroups(w.deps())).toBe(true);
      const record = JSON.parse(String(w.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)).integration;
      expect(record.state).toBe("blocked");
      expect(record.reason).toMatch(/^integration-working-tree-conflict:a\.txt/);
      // mutation: deliversLocally counts only `local` -> prerequisiteDone answers true here, red
      expect(prerequisiteDone(w.store, "g")).toBe(false);
    } finally { await w.dispose(); }
  });

  it("the same group reads done once a later pass writes it", async () => {
    const w = await world();
    try {
      w.commitOn({ "a.txt": "theirs\n" });
      w.finish();
      writeFileSync(join(w.repo, "a.txt"), "mine\n");
      await integratePendingGroups(w.deps());
      expect(prerequisiteDone(w.store, "g")).toBe(false);
      // A blocked integration is deliberately not retried by the driver (integrationPass skips `state !== "idle"`):
      // the person resolves it, resets the record by name, and the next pass writes the group's files. This is the
      // same road `orca group retry-integration` takes.
      const record = JSON.parse(String(w.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)).integration;
      w.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...JSON.parse(String(w.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)), integration: { ...record, state: "idle", reason: null } }));
      writeFileSync(join(w.repo, "a.txt"), "one\n");
      expect(await integratePendingGroups(w.deps())).toBe(true);
      // mutation: localDeliveryCaughtUp were `state === "idle"` alone -> the conflict record (lastIntegrated null)
      // would read delivered, red
      const after = JSON.parse(String(w.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)).integration;
      expect(after).toMatchObject({ state: "idle", reason: null });
      expect(typeof after.lastIntegrated).toBe("string");
      expect(prerequisiteDone(w.store, "g")).toBe(true);
    } finally { await w.dispose(); }
  });

  it("a group whose tip is not written yet is not done either", async () => {
    const w = await world();
    try {
      w.finish();
      // The pass is due but has not run: nothing has been written, so dependents must wait.
      expect(prerequisiteDone(w.store, "g")).toBe(false);
      expect(await integratePendingGroups(w.deps())).toBe(true);
      expect(prerequisiteDone(w.store, "g")).toBe(true);
    } finally { await w.dispose(); }
  });

  it("a later landing accepted on a new tip is not done until that tip is written", async () => {
    const w = await world();
    try {
      w.commitOn({ "a.txt": "theirs\n" });
      w.finish();
      expect(await integratePendingGroups(w.deps())).toBe(true);
      expect(prerequisiteDone(w.store, "g")).toBe(true);
      // A second task lands and the group is accepted on that tip before the pass writes it: lastIntegrated still names
      // the first tip, so b.txt is in no checkout yet. retry-integration reaches the same window (it keeps lastIntegrated).
      const second = w.commitOn({ "b.txt": "new\n" });
      w.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...w.body(),
        acceptance: { tip: second, result: "passed", why: "multi-landing", commands: [], at: 2, fullSuite: { command: null, suggestion: null, exits: [], flaky: false } } }));
      // mutation: localDeliveryCaughtUp ignores the accepted tip (lastIntegrated !== null alone) -> true here, red
      expect(prerequisiteDone(w.store, "g")).toBe(false);
      expect(await integratePendingGroups(w.deps())).toBe(true);
      expect(prerequisiteDone(w.store, "g")).toBe(true);
    } finally { await w.dispose(); }
  });
});
