// Delivery tail spec D6 (tester #333, human ruling 2 of session 2026-11-17): "integrate now" skips only the backoff and the
// trigger's timing. Every task done and the acceptance satisfied are still required; an up-to-date group is refused by
// name; pressing it twice never makes a second merge commit. Real git, as integrationGit.test.ts.
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readGroupActivity } from "../../src/control/activity.js";
import { integratePendingGroups } from "../../src/control/integrationPass.js";
import { newGroupIntegration, readGroupIntegration, type GroupIntegration, type IntegrationScheme } from "../../src/control/integrationScheme.js";
import type { ControlStore } from "../../src/control/store.js";
import { WebControlService } from "../../src/control/webService.js";
import { controlWorkspaceRoots, unsetInheritedGitEnv } from "../../src/control/workspace.js";
import { webFixture } from "./fixtures/web.js";

const g = (cwd: string, args: string[], input?: string): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args],
    { cwd, encoding: "utf8", stdio: "pipe", input, env: { ...process.env, ...unsetInheritedGitEnv() } }).trim();
const body = (store: ControlStore): Record<string, unknown> => JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;
const setBody = (store: ControlStore, next: Record<string, unknown>) => store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(next));
const LOCAL_MERGE: IntegrationScheme = { delivery: "local", trigger: "group", method: "merge", target: "main" };
type Answer = { result?: { kind: string; groupId?: string }; error?: { code: string; message: string } };

async function world() {
  const h = await webFixture();
  const repo = join(h.root, "target");
  g(h.root, ["init", "-q", "-b", "main", repo]);
  await writeFile(join(repo, "f.txt"), "one\n");
  g(repo, ["add", "f.txt"]); g(repo, ["commit", "-qm", "base"]);
  g(repo, ["checkout", "-q", "-b", "other"]);
  g(repo, ["update-ref", "refs/heads/orca/g", "main"]);
  setBody(h.store, { ...body(h.store), integration: { ...newGroupIntegration(LOCAL_MERGE)!, frozen: true } });
  const service = new WebControlService({ ...h.deps, resolveRepository: () => repo });
  const now = () => (service as unknown as { store: ControlStore }).store.now();
  const pass = () => integratePendingGroups({ store: h.store, roots: controlWorkspaceRoots(h.store.stateDir), admissionGate: h.deps.admissionGate,
    repoPathOf: () => repo, now, ghBin: "/nonexistent/gh", stopped: () => false });
  const record = () => readGroupIntegration(body(h.store))!;
  const setRecord = (patch: Partial<GroupIntegration>) => setBody(h.store, { ...body(h.store), integration: { ...record(), ...patch } });
  const doneTasks = () => h.store.db.prepare("UPDATE work_items SET body=json_set(body,'$.status','done') WHERE group_id='g'").run();
  const land = (text: string) => {
    const parent = g(repo, ["rev-parse", "orca/g"]);
    const env = { ...process.env, ...unsetInheritedGitEnv(), GIT_INDEX_FILE: join(repo, ".git", "orca-test-index") };
    execFileSync("git", ["read-tree", parent], { cwd: repo, env });
    execFileSync("git", ["update-index", "--add", "--cacheinfo", `100644,${g(repo, ["hash-object", "-w", "--stdin"], text)},a.txt`], { cwd: repo, env });
    const tree = execFileSync("git", ["write-tree"], { cwd: repo, env, encoding: "utf8" }).trim();
    const commit = g(repo, ["commit-tree", tree, "-p", parent, "-m", "land"]);
    g(repo, ["update-ref", "refs/heads/orca/g", commit, parent]);
    return commit;
  };
  const integrateNow = async (): Promise<Answer> => await service.integrateNow(h.command("integrate-now", {}) as never) as Answer;
  return { ...h, repo, service, pass, record, setRecord, doneTasks, land, integrateNow };
}

describe("integrate now (#333, delivery tail D6)", { timeout: 60_000 }, () => {
  it("is refused by name when there is no delivery, the integration is not idle, or the group is not ready", async () => {
    const w = await world(); try {
      w.land("a\n");
      // mutation: drop the readiness check -> accepted while a task is not done, red
      expect((await w.integrateNow()).error).toMatchObject({ code: "integration-not-ready", message: "integration-not-ready:tasks-not-done" });
      w.doneTasks();
      w.setRecord({ state: "blocked", reason: "integration-target-moved" });
      expect((await w.integrateNow()).error).toMatchObject({ code: "integration-not-idle", message: "integration-not-idle:blocked" });
      w.setRecord({ state: "idle", reason: null });
      // Review 2026-11-17 finding 5: a failed acceptance refuses too (mutation: drop the acceptance check). The run-active refusal
      // has no fixture run here to hold; it shares groupComplete's query, pinned by deliveryTail.test.ts (D1).
      setBody(w.store, { ...body(w.store), acceptance: { tip: "a".repeat(40), result: "failed", commands: [], at: 0 } });
      expect((await w.integrateNow()).error).toMatchObject({ code: "integration-not-ready", message: "integration-not-ready:acceptance-not-satisfied" });
      const { acceptance: _a, ...noAcceptance } = body(w.store);
      setBody(w.store, noAcceptance);
      // Finding 4: the pass skips an archived or stopped group, so integrate-now refuses rather than promise (an archived
      // group by the command ledger's own guard).
      setBody(w.store, { ...body(w.store), archived: { at: 1, actor: "user:owner" } });
      expect((await w.integrateNow()).error).toMatchObject({ code: "group-archived" });
      const { archived: _ar, ...unarchived } = body(w.store);
      setBody(w.store, { ...unarchived, stopped: true });
      expect((await w.integrateNow()).error).toMatchObject({ code: "integration-not-ready", message: "integration-not-ready:stopped" });
      setBody(w.store, { ...body(w.store), stopped: false });
      const { integration: _gone, ...keep } = body(w.store);
      setBody(w.store, keep);
      expect((await w.integrateNow()).error).toMatchObject({ code: "integration-not-configured" });
    } finally { await w.dispose(); }
  });

  it("clears the backoff so the next pass integrates, and a second press finds the group up to date (one merge commit)", async () => {
    const w = await world(); try {
      const tip = w.land("a\n");
      w.doneTasks();
      w.setRecord({ retryAfter: Number.MAX_SAFE_INTEGER, transient: 3, transientReason: "remote asleep" });
      // Backing off: the pass leaves it alone.
      expect(await w.pass()).toBe(false);
      expect(g(w.repo, ["rev-parse", "main"])).not.toBe(tip);
      const answer = await w.integrateNow();
      expect(answer.result).toMatchObject({ kind: "integration-requested", groupId: "g" });
      // mutation: keep retryAfter -> the pass still skips the group, red
      expect(w.record()).toMatchObject({ retryAfter: null, transient: 0, transientReason: null });
      expect(readGroupActivity(w.store, "g", 50).filter((row) => row.kind === "integration-requested")).toHaveLength(1);
      expect(await w.pass()).toBe(true);
      const merged = g(w.repo, ["rev-parse", "main"]);
      expect(g(w.repo, ["rev-list", "--parents", "-n", "1", merged]).split(" ").slice(1)).toEqual([expect.any(String), tip]);
      // mutation: drop the up-to-date check -> accepted, red
      expect((await w.integrateNow()).error).toMatchObject({ code: "integration-up-to-date" });
      expect(await w.pass()).toBe(false);
      expect(g(w.repo, ["rev-parse", "main"])).toBe(merged);
    } finally { await w.dispose(); }
  });
});
