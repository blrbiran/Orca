// Integration spec §7: a conflict is materialised for an agent and nothing is dispatched; an owner's
// resolve-integration-conflict is the approval; the pass spawns a ccloop resolution run, books its usage run-less, and
// finishes the integration with the right commit shape. The first describe is real git with a stand-in `runTask` (no
// ccloop); the second is the real ccloop build (ORCA_CCLOOP_BIN) and its scripted fake codex.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { applyResolveIntegrationConflict } from "../../src/control/integrationCommands.js";
import { prepareResolution, recordIntegrationUsage } from "../../src/control/integrationResolve.js";
import { integratePendingGroups, type IntegrationDeps } from "../../src/control/integrationPass.js";
import { newGroupIntegration, readGroupIntegration, type GroupIntegration, type IntegrationScheme } from "../../src/control/integrationScheme.js";
import { readConfirmedTaskExecution } from "../../src/control/executionSnapshot.js";
import type { ControlStore } from "../../src/control/store.js";
import { WebControlService } from "../../src/control/webService.js";
import { controlWorkspaceRoots, unsetInheritedGitEnv } from "../../src/control/workspace.js";
import type { ControlRuntime } from "../../src/panel/controlAssembly.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { loopDirOf } from "../../src/scheduler/ccloopRunner.js";
import { ccloopWorlds, g as cg, raw, realBinary, startGroup, until } from "./fixtures/ccloopWorld.js";
import { webFixture } from "./fixtures/web.js";

const g = (cwd: string, args: string[], options: { input?: string; env?: NodeJS.ProcessEnv } = {}): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args],
    { cwd, encoding: "utf8", stdio: "pipe", input: options.input, env: { ...process.env, ...unsetInheritedGitEnv(), ...options.env } }).trim();

const groupBody = (store: ControlStore): Record<string, unknown> =>
  JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;
const writeGroupBody = (store: ControlStore, body: Record<string, unknown>) => store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(body));
const record = (store: ControlStore): GroupIntegration => readGroupIntegration(groupBody(store))!;
/** The confirmed contract of task "a": the resolution's budget is the landing reconciliation's (the sides' largest). */
const policyOf = (store: ControlStore) => readConfirmedTaskExecution(store, "g", "a").contract.executionPolicy;
const code = (result: unknown): string => (result as { error?: { code: string } }).error?.code ?? "applied";
const parents = (repo: string, commit: string): string[] => g(repo, ["rev-list", "--parents", "-n", "1", commit]).split(" ").slice(1);

const LOCAL_MERGE: IntegrationScheme = { delivery: "local", trigger: "task", method: "merge", target: "main" };
const LOCAL_SQUASH: IntegrationScheme = { delivery: "local", trigger: "task", method: "squash", target: "main" };

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

type RunTaskCall = { plan: Record<string, unknown>; task: { taskId: string; contract: string }; base: string; runId: string; options: Record<string, unknown> };

/**
 * The fixture's group "g" (one task "a"), confirmed, then given a frozen integration; a target repository whose HEAD is
 * `other`, so `main` moves by compare-and-swap; `orca/g` made from HEAD as the driver does. The resolution's `runTask`
 * is a stand-in that records its call and, unless told otherwise, never finishes (a run still going).
 */
async function world(scheme: IntegrationScheme, options: { requiredChecks?: string[] } = {}) {
  const h = await webFixture(undefined, [{ taskId: "a" }], options.requiredChecks === undefined ? {} : { requiredChecks: options.requiredChecks });
  const repo = join(h.root, "target");
  g(h.root, ["init", "-q", "-b", "main", repo]);
  await writeFile(join(repo, "f.txt"), "one\ntwo\nthree\n");
  g(repo, ["add", "f.txt"]); g(repo, ["commit", "-qm", "base"]);
  g(repo, ["checkout", "-q", "-b", "other"]);
  g(repo, ["update-ref", "refs/heads/orca/g", "HEAD"]);
  const service = new WebControlService({ ...h.deps, resolveRepository: () => repo });
  expect(code(await service.confirm(h.command("confirm", await h.confirmPayload())))).toBe("applied");
  writeGroupBody(h.store, { ...groupBody(h.store), integration: { ...newGroupIntegration(scheme)!, frozen: true } });
  const roots = controlWorkspaceRoots(h.store.stateDir);
  const calls: RunTaskCall[] = [];
  let runTask = async (...args: unknown[]): Promise<never> => {
    const [plan, task, base, runId, opts] = args as [RunTaskCall["plan"], RunTaskCall["task"], string, string, RunTaskCall["options"]];
    calls.push({ plan, task, base, runId, options: opts });
    // A live process: this test runner's own pid.
    (opts.onSpawn as (pid: number) => void)(process.pid);
    return new Promise<never>(() => undefined);
  };
  const reconciling = new Map<string, Promise<void>>();
  const deps = (extra: Partial<IntegrationDeps> = {}): IntegrationDeps => ({
    store: h.store, roots, admissionGate: h.deps.admissionGate, repoPathOf: () => repo, now: () => 1_000_000, ghBin: "/nonexistent/gh", stopped: () => false,
    resolution: { ccloopBin: "/nonexistent/ccloop", agentsTablePath: "/nonexistent/agents.json", reconciling, runTask: (...args) => runTask(...args) }, ...extra,
  });
  const land = (files: Record<string, string>) => commitOn(repo, "refs/heads/orca/g", files, "land");
  const person = (files: Record<string, string>) => commitOn(repo, "refs/heads/main", files, "person");
  const raise = (tokens: number) => {
    const limit = readControlGroup(h.store, "epoch-test", "g").ledger.groupLimit;
    expect(code(service.setLimit(h.command("set-limit", { limit: { ...limit, tokens: limit.tokens + tokens } })))).toBe("applied");
  };
  return {
    ...h, repo, roots, service, calls, reconciling, land, person, raise,
    pass: (extra: Partial<IntegrationDeps> = {}) => integratePendingGroups(deps(extra)),
    record: () => record(h.store),
    resolve: () => service.resolveIntegrationConflict(h.command("resolve-integration-conflict", {})),
    copyOf: (attempt: number) => join(roots.workspacesRoot, `integration-conflict-g-${attempt}`),
    setRunTask: (next: typeof runTask) => { runTask = next; },
    /** The spawned resolution's terminal loop state, as ccloop writes it (the stand-in run never does). */
    loopState: async (state: Record<string, unknown>) => {
      const resolution = record(h.store).resolution!;
      const loopDir = loopDirOf(join(resolution.runsDir, resolution.reconcileRunId), resolution.reconcileRunId);
      await mkdir(loopDir, { recursive: true });
      await writeFile(join(loopDir, "loop-state.json"), JSON.stringify(state));
      reconciling.clear();
    },
    /** What ccloop leaves for a finished attempt: its clone of the copy with `refs/ccloop/<key>/attempts/1` on the result. */
    attempt: (files: Record<string, string>): string => {
      const resolution = record(h.store).resolution!, key = resolution.reconcileRunId;
      const clone = join(resolution.runsDir, key, "repo");
      g(h.root, ["clone", "-q", "--no-checkout", resolution.copyPath, clone]);
      g(clone, ["update-ref", `refs/ccloop/${key}/attempts/1`, resolution.conflictCommit]);
      return commitOn(clone, `refs/ccloop/${key}/attempts/1`, files, "attempt");
    },
  };
}

/** One conflict on line 1 of f.txt between `orca/g` and `main`, recorded by a pass. */
async function conflicted(w: Awaited<ReturnType<typeof world>>): Promise<{ tip: string; main: string }> {
  const tip = w.land({ "f.txt": "A\ntwo\nthree\n" });
  const main = w.person({ "f.txt": "B\ntwo\nthree\n" });
  expect(await w.pass()).toBe(true);
  return { tip, main };
}

describe("an integration conflict, materialised and approved (integration spec §7)", { timeout: 60_000 }, () => {
  it("merge: the conflict is re-created in an own clone and pinned in the target repository; nothing is dispatched", async () => {
    const w = await world(LOCAL_MERGE); try {
      const { tip, main } = await conflicted(w);
      expect(w.record()).toMatchObject({ state: "conflict", reason: "integration-conflict", resolution: null,
        conflict: { attempt: 1, key: "integrate-g-1", base: main, tip, paths: ["f.txt"] } });
      expect(existsSync(join(w.copyOf(1), ".git"))).toBe(true);
      // The pinned commit lives in the target repository itself, so it outlives the copy.
      const pinned = g(w.repo, ["rev-parse", "refs/orca/integration-conflict/g/1"]);
      expect(parents(w.repo, pinned)).toEqual([main, tip]);
      const text = g(w.repo, ["show", `${pinned}:f.txt`]);
      expect(text).toMatch(/^<<<<<<< /m);
      expect(text).toMatch(/^>>>>>>> /m);
      expect(text).toContain("A\n");
      expect(text).toContain("B\n");
      expect(g(w.repo, ["rev-parse", "main"])).toBe(main);
      // Nothing is dispatched without an owner's approval, however many rounds pass.
      expect(await w.pass()).toBe(false);
      expect(w.calls).toEqual([]);
      expect(w.reconciling.size).toBe(0);
    } finally { await w.dispose(); }
  });

  it("squash: the conflict is the same three-way merge of the work onto the target, pinned with its markers", async () => {
    const w = await world(LOCAL_SQUASH); try {
      const { tip, main } = await conflicted(w);
      expect(w.record()).toMatchObject({ state: "conflict", reason: "integration-conflict", conflict: { attempt: 1, base: main, tip, paths: ["f.txt"] } });
      const pinned = g(w.repo, ["rev-parse", "refs/orca/integration-conflict/g/1"]);
      expect(parents(w.repo, pinned)).toEqual([main, tip]);
      expect(g(w.repo, ["show", `${pinned}:f.txt`])).toMatch(/^<<<<<<< [^\n]*\nB\n=======\nA\n>>>>>>> /m);
      expect(w.calls).toEqual([]);
    } finally { await w.dispose(); }
  });

  it("squash: the conflict takes lastIntegrated as merge base, so a person's revert of integrated work survives in it", async () => {
    const w = await world(LOCAL_SQUASH); try {
      w.land({ "f.txt": "one\ntwo\nTHREE\n" });
      expect(await w.pass()).toBe(true);
      expect(w.record()).toMatchObject({ state: "idle", conflict: null });
      // The person reverts what the first integration carried and rewrites line 1; the next landing rewrites line 1 too.
      w.person({ "f.txt": "PERSON\ntwo\nthree\n" });
      w.land({ "f.txt": "ONE\ntwo\nTHREE\n" });
      expect(await w.pass()).toBe(true);
      expect(w.record()).toMatchObject({ state: "conflict", reason: "integration-conflict" });
      const text = g(w.repo, ["show", "refs/orca/integration-conflict/g/1:f.txt"]);
      expect(text).toMatch(/^<<<<<<< [^\n]*\nPERSON\n=======\nONE\n>>>>>>> [^\n]*\ntwo\nthree$/);
    } finally { await w.dispose(); }
  });

  it("a conflict the clone does not reproduce is named integration-conflict-unreproducible, cannot be approved, and is retried", async () => {
    const w = await world(LOCAL_MERGE); try {
      // A merge driver configured in the target repository only (its config and info/attributes are not cloned): the
      // target's merge fails, the copy's plain text merge of two different lines is clean.
      g(w.repo, ["config", "merge.fail.driver", "false"]);
      await mkdir(join(w.repo, ".git", "info"), { recursive: true });
      await writeFile(join(w.repo, ".git", "info", "attributes"), "f.txt merge=fail\n");
      w.land({ "f.txt": "ONE\ntwo\nthree\n" });
      w.person({ "f.txt": "one\ntwo\nTHREE\n" });
      expect(await w.pass()).toBe(true);
      expect(w.record()).toMatchObject({ state: "conflict", reason: "integration-conflict-unreproducible", conflict: { attempt: 1, key: "integrate-g-1" } });
      expect(existsSync(w.copyOf(1))).toBe(false);
      expect(code(await w.resolve())).toBe("integration-not-blocked");
      expect(code(w.service.retryIntegration(w.command("retry-integration", {})))).toBe("applied");
      expect(await w.pass()).toBe(true);
      expect(w.record()).toMatchObject({ state: "conflict", reason: "integration-conflict-unreproducible", conflict: { attempt: 2 } });
    } finally { await w.dispose(); }
  });

  it("resolve-integration-conflict: refused unless a materialised conflict waits, or the group cannot afford it; else resolving", async () => {
    const w = await world(LOCAL_MERGE); try {
      expect(code(await w.resolve())).toBe("integration-not-blocked");
      const { main } = await conflicted(w);
      // The copy is what the agent works in: without it there is nothing to approve.
      rmSync(w.copyOf(1), { recursive: true, force: true });
      expect(code(await w.resolve())).toBe("integration-not-blocked");
      expect(code(w.service.retryIntegration(w.command("retry-integration", {})))).toBe("applied");
      expect(await w.pass()).toBe(true);
      expect(w.record().conflict).toMatchObject({ attempt: 2, key: "integrate-g-2" });
      // As driverReconcile.test.ts: the default reserve is smaller than one task's budget.
      expect(code(await w.resolve())).toBe("reconcile-budget");
      expect(w.record().state).toBe("conflict");
      w.raise(10_000_000);
      const resolved = await w.resolve();
      expect(resolved).toMatchObject({ result: { kind: "integration-resolution-started", groupId: "g" } });
      const pinned = g(w.repo, ["rev-parse", "refs/orca/integration-conflict/g/2"]);
      expect(w.record()).toMatchObject({ state: "resolving", reason: null, conflict: { attempt: 2 },
        resolution: { reconcileRunId: "integrate-g-2", copyPath: w.copyOf(2), old: main, conflictCommit: pinned, conflictedPaths: ["f.txt"], tokenBudget: policyOf(w.store).tokenBudget,
          spawning: true, pid: null, outcome: null, attemptSha: null } });
      // The command only records the approval: the pass spawns.
      expect(w.calls).toEqual([]);
      expect(code(w.service.retryIntegration(w.command("retry-integration", {})))).toBe("integration-not-blocked");
      expect(code(await w.service.setGroupIntegration(w.command("set-group-integration", { integration: LOCAL_SQUASH })))).toBe("integration-busy");
      expect(code(await w.resolve())).toBe("integration-not-blocked");
    } finally { await w.dispose(); }
  });

  it("the approval is judged again inside its transaction: a conflict retried, or replaced by the next attempt, since it was read", async () => {
    const w = await world(LOCAL_MERGE); try {
      await conflicted(w);
      w.raise(10_000_000);
      const stale = await prepareResolution(w.store, w.roots, "g", () => w.repo);
      expect(stale).toMatchObject({ attempt: 1, copyPath: w.copyOf(1) });
      expect(code(w.service.retryIntegration(w.command("retry-integration", {})))).toBe("applied");
      expect(code(applyResolveIntegrationConflict({ store: w.store }, w.command("resolve-integration-conflict", {}), stale))).toBe("integration-not-blocked");
      expect(await w.pass()).toBe(true);
      expect(w.record()).toMatchObject({ state: "conflict", conflict: { attempt: 2 } });
      expect(code(applyResolveIntegrationConflict({ store: w.store }, w.command("resolve-integration-conflict", {}), stale))).toBe("integration-not-blocked");
      expect(code(await w.resolve())).toBe("applied");
    } finally { await w.dispose(); }
  });

  it("refuses integration-no-checks when the group's contracts carry no check to run", async () => {
    const w = await world(LOCAL_MERGE, { requiredChecks: ["  "] }); try {
      await conflicted(w);
      w.raise(10_000_000);
      expect(code(await w.resolve())).toBe("integration-no-checks");
      expect(w.record().state).toBe("conflict");
    } finally { await w.dispose(); }
  });

  it("the pass spawns the approved resolution once, in the copy, at the pinned conflict, with the synthesized contract", async () => {
    const w = await world(LOCAL_MERGE); try {
      await conflicted(w);
      w.raise(10_000_000);
      expect(code(await w.resolve())).toBe("applied");
      const resolution = w.record().resolution!;
      // A stopped driver advances nothing.
      expect(await w.pass({ stopped: () => true })).toBe(false);
      expect(w.calls).toEqual([]);
      expect(await w.pass()).toBe(true);
      expect(w.calls).toHaveLength(1);
      const call = w.calls[0]!;
      expect(call.runId).toBe("integrate-g-1");
      expect(call.base).toBe(resolution.conflictCommit);
      expect(call.plan).toMatchObject({ targetRepo: w.copyOf(1), runsDir: resolution.runsDir, workBranch: "orca/g" });
      expect(call.task).toMatchObject({ taskId: "integrate-g-1", contract: resolution.contractPath });
      expect(call.options.agentSelection).toMatchObject({ selection: (groupBody(w.store).reconcileSlot as { selection: unknown }).selection });
      const contract = JSON.parse(readFileSync(resolution.contractPath, "utf8")) as Record<string, any>;
      expect(contract.objective.taskId).toBe("integrate-g-1");
      expect(contract.objective.goal).toContain("resolve the conflict between the target branch `main` and the work of group `g`; the target branch's changes must survive");
      expect(contract.context).toMatchObject({ repoPath: w.copyOf(1), targetPaths: ["f.txt"], buildTestCommands: ["true"] });
      expect(contract.verification).toMatchObject({ verifierType: "command", requiredChecks: ["true"] });
      const policy = policyOf(w.store);
      expect(contract.executionPolicy).toMatchObject({ maxAttempts: 1, tokenBudget: policy.tokenBudget, perAttemptTimeoutMs: policy.perAttemptTimeoutMs, totalRuntimeBudgetMs: policy.totalRuntimeBudgetMs });
      expect(w.record()).toMatchObject({ state: "resolving", resolution: { spawning: true, pid: process.pid, spawnSeq: 1 } });
      // Its process is alive and recorded: later rounds wait on it.
      w.reconciling.clear();
      expect(await w.pass()).toBe(false);
      expect(w.calls).toHaveLength(1);
    } finally { await w.dispose(); }
  });

  it("an approved resolution the group can no longer afford at spawn goes back to conflict, as the next attempt", async () => {
    const w = await world(LOCAL_MERGE); try {
      await conflicted(w);
      w.raise(10_000_000);
      expect(code(await w.resolve())).toBe("applied");
      w.raise(-10_000_000);
      expect(await w.pass()).toBe(true);
      expect(w.calls).toEqual([]);
      expect(w.record()).toMatchObject({ state: "conflict", reason: "reconcile-budget", resolution: null, conflict: { attempt: 2, key: "integrate-g-2" } });
      expect(existsSync(join(w.copyOf(2), ".git"))).toBe(true);
      expect(g(w.repo, ["rev-parse", "--verify", "refs/orca/integration-conflict/g/2"])).toMatch(/^[0-9a-f]{40}$/);
    } finally { await w.dispose(); }
  });

  it("a group whose reconcile agent no longer matches its confirmed snapshot is not spawned", async () => {
    const w = await world(LOCAL_MERGE); try {
      await conflicted(w);
      w.raise(10_000_000);
      expect(code(await w.resolve())).toBe("applied");
      writeGroupBody(w.store, { ...groupBody(w.store), reconcileSlot: null });
      expect(await w.pass()).toBe(true);
      expect(w.calls).toEqual([]);
      expect(w.record()).toMatchObject({ state: "conflict", reason: "reconcile-agent-unfrozen", conflict: { attempt: 2 } });
    } finally { await w.dispose(); }
  });

  it("a resolution run that cannot be spawned goes back to conflict with the failure, as the next attempt", async () => {
    const w = await world(LOCAL_MERGE); try {
      await conflicted(w);
      w.raise(10_000_000);
      expect(code(await w.resolve())).toBe("applied");
      w.setRunTask(async () => { throw new Error("no ccloop here"); });
      expect(await w.pass()).toBe(true);
      await w.reconciling.get("integrate-g-1");
      expect(w.record()).toMatchObject({ state: "conflict", reason: "integration-resolution-spawn:no ccloop here", resolution: null, conflict: { attempt: 2 } });
    } finally { await w.dispose(); }
  });

  it("a resolution run that ends while the driver stops is left resolving, for after the restart", async () => {
    const w = await world(LOCAL_MERGE); try {
      await conflicted(w);
      w.raise(10_000_000);
      expect(code(await w.resolve())).toBe("applied");
      let stopping = false;
      w.setRunTask(async () => { stopping = true; throw new Error("killed by the shutdown"); });
      expect(await w.pass({ stopped: () => stopping })).toBe(true);
      await w.reconciling.get("integrate-g-1");
      expect(w.record()).toMatchObject({ state: "resolving", reason: null, conflict: { attempt: 1 }, resolution: { reconcileRunId: "integrate-g-1" } });
      expect(existsSync(w.copyOf(2))).toBe(false);
    } finally { await w.dispose(); }
  });

  it("a resolution that ended other than succeeded books its spend run-less and goes back to conflict", async () => {
    const w = await world(LOCAL_MERGE); try {
      await conflicted(w);
      w.raise(10_000_000);
      expect(code(await w.resolve())).toBe("applied");
      expect(await w.pass()).toBe(true);
      const resolution = w.record().resolution!;
      const loopDir = loopDirOf(join(resolution.runsDir, "integrate-g-1"), "integrate-g-1");
      await mkdir(loopDir, { recursive: true });
      await writeFile(join(loopDir, "loop-state.json"), JSON.stringify({ status: "failed", budgetSnapshot: { tokenBudgetRemaining: resolution.tokenBudget - 1_000 } }));
      const usedBefore = Number((groupBody(w.store).used as { tokens: number }).tokens);
      w.reconciling.clear();
      expect(await w.pass()).toBe(true);
      expect(w.record()).toMatchObject({ state: "conflict", reason: "integration-resolution-terminal:failed", resolution: null, conflict: { attempt: 2 } });
      expect(w.store.db.prepare("SELECT run_id,source,model,tokens,quality FROM usage_ledger WHERE group_id='g'").all())
        .toEqual([{ run_id: null, source: "run-work", model: null, tokens: 1_000, quality: "unattributed" }]);
      expect(Number((groupBody(w.store).used as { tokens: number }).tokens)).toBe(usedBefore + 1_000);
      expect(w.store.db.prepare("SELECT kind,delivered FROM outbox WHERE id='integration-usage:integrate-g-1'").get()).toEqual({ kind: "integration-usage", delivered: 1 });
    } finally { await w.dispose(); }
  });

  it("a terminal loop state with no budget snapshot books the whole budget", async () => {
    const w = await world(LOCAL_MERGE); try {
      await conflicted(w);
      w.raise(10_000_000);
      expect(code(await w.resolve())).toBe("applied");
      expect(await w.pass()).toBe(true);
      await w.loopState({ status: "cancelled" });
      expect(await w.pass()).toBe(true);
      expect(w.record()).toMatchObject({ state: "conflict", reason: "integration-resolution-terminal:cancelled" });
      expect(w.store.db.prepare("SELECT tokens FROM usage_ledger").all()).toEqual([{ tokens: policyOf(w.store).tokenBudget }]);
    } finally { await w.dispose(); }
  });

  it("a resolution whose collection fails is left resolving, logged, and collected again (its spend booked once)", async () => {
    const w = await world(LOCAL_MERGE); try {
      await conflicted(w);
      w.raise(10_000_000);
      expect(code(await w.resolve())).toBe("applied");
      expect(await w.pass()).toBe(true);
      // Succeeded, but ccloop's clone is missing: reading its attempt fails.
      await w.loopState({ status: "succeeded", budgetSnapshot: { tokenBudgetRemaining: 0 } });
      expect(await w.pass()).toBe(false);
      expect(w.record()).toMatchObject({ state: "resolving", resolution: { reconcileRunId: "integrate-g-1" } });
      expect(await w.pass()).toBe(false);
      expect(w.store.db.prepare("SELECT COUNT(*) AS n FROM usage_ledger").get()).toEqual({ n: 1 });
    } finally { await w.dispose(); }
  });

  it("a crash after the resolved integration's write-ahead record ends the pass with that record kept", async () => {
    const w = await world(LOCAL_MERGE); try {
      const { tip, main } = await conflicted(w);
      w.raise(10_000_000);
      expect(code(await w.resolve())).toBe("applied");
      expect(await w.pass()).toBe(true);
      w.attempt({ "f.txt": "B\nA\ntwo\nthree\n" });
      await w.loopState({ status: "succeeded", budgetSnapshot: { tokenBudgetRemaining: 0 } });
      await expect(w.pass({ crash: (point) => { if (point === "after-pending") throw new Error("crash at after-pending"); } })).rejects.toThrow("crash at after-pending");
      const pending = w.record().pending!;
      expect(w.record().state).toBe("resolving");
      expect(parents(w.repo, pending.new)).toEqual([main, tip]);
      expect(g(w.repo, ["show", `${pending.new}:f.txt`])).toBe("B\nA\ntwo\nthree");
      expect(g(w.repo, ["rev-parse", "main"])).toBe(main);
    } finally { await w.dispose(); }
  });

  it("a resolved integration whose target branch is gone blocks by name", async () => {
    const w = await world(LOCAL_MERGE); try {
      await conflicted(w);
      w.raise(10_000_000);
      expect(code(await w.resolve())).toBe("applied");
      expect(await w.pass()).toBe(true);
      w.attempt({ "f.txt": "B\nA\ntwo\nthree\n" });
      await w.loopState({ status: "succeeded", budgetSnapshot: { tokenBudgetRemaining: 0 } });
      g(w.repo, ["update-ref", "-d", "refs/heads/main"]);
      expect(await w.pass()).toBe(true);
      expect(w.record()).toMatchObject({ state: "blocked", reason: "integration-target-missing", resolution: null });
    } finally { await w.dispose(); }
  });

  it("recordIntegrationUsage: once per key, never reads a run, and no row for nothing spent", async () => {
    const w = await world(LOCAL_MERGE); try {
      const deps = { store: w.store, admissionGate: w.deps.admissionGate, now: () => 5 };
      const usedBefore = Number((groupBody(w.store).used as { tokens: number }).tokens);
      recordIntegrationUsage(deps, "g", "integrate-g-7", 40);
      recordIntegrationUsage(deps, "g", "integrate-g-7", 40);
      recordIntegrationUsage(deps, "g", "integrate-g-8", 0);
      expect(w.store.db.prepare("SELECT applied_at,run_id,tokens FROM usage_ledger").all()).toEqual([{ applied_at: 5, run_id: null, tokens: 40 }]);
      expect(Number((groupBody(w.store).used as { tokens: number }).tokens)).toBe(usedBefore + 40);
      expect(w.store.db.prepare("SELECT id FROM outbox WHERE kind='integration-usage' ORDER BY id").all()).toEqual([{ id: "integration-usage:integrate-g-7" }, { id: "integration-usage:integrate-g-8" }]);
    } finally { await w.dispose(); }
  });

  it("a scheme change (here to keep) removes the group's conflict copies (and only its own)", async () => {
    const w = await world(LOCAL_MERGE); try {
      await conflicted(w);
      const stranger = join(w.roots.workspacesRoot, "integration-conflict-g-x-1");
      await mkdir(stranger);
      expect(code(await w.service.setGroupIntegration(w.command("set-group-integration", { integration: { delivery: "keep" } })))).toBe("applied");
      await w.pass();
      expect(existsSync(w.copyOf(1))).toBe(false);
      expect(existsSync(stranger)).toBe(true);
    } finally { await w.dispose(); }
  });

  it("final review I1: a new target starts from scratch -- the next squash into it carries the earlier landings too", async () => {
    const w = await world(LOCAL_SQUASH); try {
      g(w.repo, ["branch", "rel", "main"]);
      const first = w.land({ "a.txt": "a\n" });
      expect(await w.pass()).toBe(true);
      expect(w.record()).toMatchObject({ state: "idle", lastIntegrated: first });
      expect(g(w.repo, ["show", "main:a.txt"])).toBe("a");
      expect(code(await w.service.setGroupIntegration(w.command("set-group-integration", { integration: { ...LOCAL_SQUASH, target: "rel" } })))).toBe("applied");
      const second = w.land({ "b.txt": "b\n" });
      expect(await w.pass()).toBe(true);
      expect(g(w.repo, ["show", "rel:a.txt"])).toBe("a");
      expect(g(w.repo, ["show", "rel:b.txt"])).toBe("b");
      expect(w.record()).toMatchObject({ state: "idle", lastIntegrated: second, integratedCommit: g(w.repo, ["rev-parse", "rel"]) });
    } finally { await w.dispose(); }
  });

  it("final review I1: a finished group switched to a new target is due at once", async () => {
    const w = await world({ ...LOCAL_SQUASH, trigger: "group" }); try {
      g(w.repo, ["branch", "rel", "main"]);
      const tip = w.land({ "a.txt": "a\n" });
      const work = JSON.parse(String(w.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body)) as Record<string, unknown>;
      w.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='a'").run(JSON.stringify({ ...work, status: "done" }));
      expect(await w.pass()).toBe(true);
      expect(w.record()).toMatchObject({ state: "idle", lastIntegrated: tip });
      expect(code(await w.service.setGroupIntegration(w.command("set-group-integration", { integration: { ...LOCAL_SQUASH, trigger: "group", target: "rel" } })))).toBe("applied");
      // No new landing: the work is still not in rel.
      expect(await w.pass()).toBe(true);
      expect(g(w.repo, ["show", "rel:a.txt"])).toBe("a");
      expect(w.record()).toMatchObject({ state: "idle", lastIntegrated: tip, integratedCommit: g(w.repo, ["rev-parse", "rel"]) });
    } finally { await w.dispose(); }
  });

  it("final review Minor 7: a new attempt's conflict removes the group's older copies (and only its own)", async () => {
    const w = await world(LOCAL_MERGE); try {
      await conflicted(w);
      const stranger = join(w.roots.workspacesRoot, "integration-conflict-g-x-1");
      await mkdir(stranger);
      expect(existsSync(join(w.copyOf(1), ".git"))).toBe(true);
      expect(code(w.service.retryIntegration(w.command("retry-integration", {})))).toBe("applied");
      expect(await w.pass()).toBe(true);
      expect(w.record().conflict).toMatchObject({ attempt: 2 });
      expect(existsSync(join(w.copyOf(2), ".git"))).toBe(true);
      expect(existsSync(w.copyOf(1))).toBe(false);
      expect(existsSync(stranger)).toBe(true);
    } finally { await w.dispose(); }
  });

  /** A resolution of the current conflict carried to the end: spawned, its attempt left as ccloop leaves it, collected. */
  async function resolveWith(w: Awaited<ReturnType<typeof world>>, files: Record<string, string>, spent: number): Promise<void> {
    expect(code(await w.resolve())).toBe("applied");
    expect(await w.pass()).toBe(true);
    w.attempt(files);
    await w.loopState({ status: "succeeded", budgetSnapshot: { tokenBudgetRemaining: policyOf(w.store).tokenBudget - spent } });
    expect(await w.pass()).toBe(true);
  }
  const usageTokens = (store: ControlStore) => store.db.prepare("SELECT tokens FROM usage_ledger WHERE group_id='g' ORDER BY rowid").all().map((row) => Number(row.tokens));

  it("final review C1: a conflict after a resolved one is a new attempt -- a new spawn, a new usage row, never the first resolution's tree", async () => {
    const w = await world(LOCAL_MERGE); try {
      const { tip } = await conflicted(w);
      w.raise(10_000_000);
      await resolveWith(w, { "f.txt": "B\nA\ntwo\nthree\n" }, 1_000);
      const first = g(w.repo, ["rev-parse", "main"]);
      expect(w.record()).toMatchObject({ state: "idle", lastIntegrated: tip, integratedCommit: first, conflict: null, resolution: null });
      // A new landing and the person's own commit conflict on line 1 again.
      const tip2 = w.land({ "f.txt": "A2\ntwo\nthree\n" });
      const main2 = w.person({ "f.txt": "C\ntwo\nthree\n" });
      expect(await w.pass()).toBe(true);
      expect(w.record()).toMatchObject({ state: "conflict", conflict: { attempt: 2, key: "integrate-g-2", base: main2, tip: tip2 } });
      expect(code(await w.resolve())).toBe("applied");
      expect(await w.pass()).toBe(true);
      // A new run for the new attempt; nothing of the first resolution was collected or published.
      expect(w.calls.map((call) => call.runId)).toEqual(["integrate-g-1", "integrate-g-2"]);
      expect(g(w.repo, ["rev-parse", "main"])).toBe(main2);
      expect(w.record()).toMatchObject({ state: "resolving", resolution: { reconcileRunId: "integrate-g-2", spawnSeq: 1 } });
      w.attempt({ "f.txt": "C\nA2\ntwo\nthree\n" });
      await w.loopState({ status: "succeeded", budgetSnapshot: { tokenBudgetRemaining: policyOf(w.store).tokenBudget - 2_000 } });
      expect(await w.pass()).toBe(true);
      const second = g(w.repo, ["rev-parse", "main"]);
      expect(parents(w.repo, second)).toEqual([main2, tip2]);
      expect(g(w.repo, ["show", `${second}:f.txt`])).toBe("C\nA2\ntwo\nthree");
      expect(w.record()).toMatchObject({ state: "idle", lastIntegrated: tip2, integratedCommit: second });
      // The second resolution's spend is booked as its own row.
      expect(usageTokens(w.store)).toEqual([1_000, 2_000]);
    } finally { await w.dispose(); }
  });

  it("final review C1: a scheme set to keep and back does not number attempts from 1 again (the booked spend counts)", async () => {
    const w = await world(LOCAL_MERGE); try {
      await conflicted(w);
      w.raise(10_000_000);
      await resolveWith(w, { "f.txt": "B\nA\ntwo\nthree\n" }, 1_000);
      expect(code(await w.service.setGroupIntegration(w.command("set-group-integration", { integration: { delivery: "keep" } })))).toBe("applied");
      expect(code(await w.service.setGroupIntegration(w.command("set-group-integration", { integration: LOCAL_MERGE })))).toBe("applied");
      w.land({ "f.txt": "A2\ntwo\nthree\n" });
      w.person({ "f.txt": "C\ntwo\nthree\n" });
      expect(await w.pass()).toBe(true);
      expect(w.record()).toMatchObject({ state: "conflict", conflict: { attempt: 2, key: "integrate-g-2" } });
      await resolveWith(w, { "f.txt": "C\nA2\ntwo\nthree\n" }, 2_000);
      expect(w.record()).toMatchObject({ state: "idle", conflict: null });
      expect(usageTokens(w.store)).toEqual([1_000, 2_000]);
    } finally { await w.dispose(); }
  });

  it("final review C1: a resolution never collects a finished run left in its runs directory before it was approved", async () => {
    const w = await world(LOCAL_MERGE); try {
      const { main } = await conflicted(w);
      w.raise(10_000_000);
      // A finished run with a clean tree already sits under the key this attempt uses (an earlier record's leftovers).
      const key = "integrate-g-1", workdir = join(w.roots.workspacesRoot, `reconcile-${key}`, key);
      await mkdir(loopDirOf(workdir, key), { recursive: true });
      await writeFile(join(loopDirOf(workdir, key), "loop-state.json"), JSON.stringify({ status: "succeeded", budgetSnapshot: { tokenBudgetRemaining: 0 } }));
      g(w.root, ["clone", "-q", "--no-checkout", w.copyOf(1), join(workdir, "repo")]);
      g(join(workdir, "repo"), ["update-ref", `refs/ccloop/${key}/attempts/1`, g(w.repo, ["rev-parse", "refs/orca/integration-conflict/g/1"])]);
      commitOn(join(workdir, "repo"), `refs/ccloop/${key}/attempts/1`, { "f.txt": "STALE\ntwo\nthree\n" }, "stale attempt");
      expect(code(await w.resolve())).toBe("applied");
      expect(await w.pass()).toBe(true);
      // Spawned, not collected: no spend booked, main untouched.
      expect(w.calls.map((call) => call.runId)).toEqual([key]);
      expect(usageTokens(w.store)).toEqual([]);
      expect(g(w.repo, ["rev-parse", "main"])).toBe(main);
      expect(w.record()).toMatchObject({ state: "resolving", resolution: { reconcileRunId: key, spawnSeq: 1 } });
    } finally { await w.dispose(); }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The real resolution run: ccloop and its scripted fake codex, whose script key is the contract's task id `integrate-g-<n>`.

const worlds = ccloopWorlds({ rootPrefix: "orca-integrate-resolve-", epochPrefix: "epoch-resolve-" });
afterAll(worlds.removeRoots);

const integrationOf = (runtime: ControlRuntime): GroupIntegration => record(runtime.store);
const MARKERS = "<<<<<<< ours\nM\n=======\nA\n>>>>>>> theirs\n";

/**
 * Start the group with a scheme after confirm, with the person's HEAD on `other` (so `orca/g` starts at the base and
 * `main` moves by compare-and-swap) and `main` already holding the person's own line 1 of shared.txt.
 */
async function startConflicting(runtime: ControlRuntime, w: Awaited<ReturnType<typeof worlds.world>>, scheme: IntegrationScheme): Promise<string> {
  let main = "";
  await startGroup(runtime, w.repoId, 10_000_000, async () => {
    cg(w.repo, "checkout", "-q", "-b", "other");
    main = commitOn(w.repo, "refs/heads/main", { "shared.txt": "M\n" }, "person");
    const set = await runtime.service.setGroupIntegration(raw(runtime, "scheme", "set-group-integration", { integration: scheme }));
    expect(code(set)).toBe("applied");
  });
  runtime.startPump(50);
  return main;
}

const scriptedKeys = (w: Awaited<ReturnType<typeof worlds.world>>): string[] => w.scripted().map((line) => line.split(" ")[1]!);

describe.skipIf(!realBinary)("an integration conflict resolved by a real ccloop run (integration spec §7)", { timeout: 420_000 }, () => {
  worlds.relocateHome("orca-integrate-resolve-home-");

  it("merge: nothing runs before approval; markers left go back to conflict; the next approval integrates (main, tip)", async () => {
    const w = await worlds.world([{ taskId: "a", targetPaths: ["shared.txt"], verifierType: "command" }], {
      a: { files: { "shared.txt": "A\n" } },
      "integrate-g-1": { files: { "shared.txt": MARKERS } },
      "integrate-g-2": { files: { "shared.txt": "M\nA\n" } },
    });
    const runtime = await w.boot(); try {
      const main = await startConflicting(runtime, w, LOCAL_MERGE);
      await until(() => integrationOf(runtime).state === "conflict", 300_000, "the conflict");
      const tip = w.tip();
      expect(integrationOf(runtime)).toMatchObject({ reason: "integration-conflict", conflict: { attempt: 1, key: "integrate-g-1", base: main, tip, paths: ["shared.txt"] } });
      expect(cg(w.repo, "show", "refs/orca/integration-conflict/g/1:shared.txt")).toMatch(/^<<<<<<< /m);
      // A few more rounds: nothing is dispatched for the conflict without an owner's approval.
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      expect(scriptedKeys(w).filter((key) => key.startsWith("integrate-"))).toEqual([]);
      expect(integrationOf(runtime)).toMatchObject({ state: "conflict", resolution: null });
      expect(code(await runtime.service.resolveIntegrationConflict(raw(runtime, "resolve-1", "resolve-integration-conflict", {})))).toBe("applied");
      await until(() => integrationOf(runtime).state === "conflict" && integrationOf(runtime).conflict?.attempt === 2, 300_000, "the first resolution to be refused");
      expect(integrationOf(runtime)).toMatchObject({ reason: "integration-markers-remaining:shared.txt", resolution: null, conflict: { key: "integrate-g-2", base: main, tip } });
      expect(cg(w.repo, "rev-parse", "main")).toBe(main);
      expect(cg(w.repo, "show", "refs/orca/integration-conflict/g/2:shared.txt")).toMatch(/^<<<<<<< /m);
      expect(code(await runtime.service.resolveIntegrationConflict(raw(runtime, "resolve-2", "resolve-integration-conflict", {})))).toBe("applied");
      await until(() => integrationOf(runtime).lastIntegrated === tip, 300_000, "the integration");
      const integrated = cg(w.repo, "rev-parse", "main");
      expect(integrationOf(runtime)).toMatchObject({ state: "idle", reason: null, integratedCommit: integrated, pending: null, conflict: null, resolution: null });
      expect(parents(w.repo, integrated)).toEqual([main, tip]);
      expect(cg(w.repo, "show", `${integrated}:shared.txt`)).toBe("M\nA");
      expect(scriptedKeys(w).filter((key) => key.startsWith("integrate-"))).toEqual(["integrate-g-1", "integrate-g-1", "integrate-g-2", "integrate-g-2"]);
      // Usage: one run-less row per resolution, each booked once under its key's outbox entry, and the ledger adds up.
      const rows = runtime.store.db.prepare("SELECT run_id,source,model,quality FROM usage_ledger WHERE group_id='g' AND run_id IS NULL").all();
      expect(rows).toEqual([1, 2].map(() => ({ run_id: null, source: "run-work", model: null, quality: "unattributed" })));
      for (const key of ["integrate-g-1", "integrate-g-2"]) {
        expect(runtime.store.db.prepare("SELECT delivered FROM outbox WHERE id=?").get(`integration-usage:${key}`)).toEqual({ delivered: 1 });
      }
      const ledgerTokens = runtime.store.db.prepare("SELECT tokens FROM usage_ledger WHERE group_id='g'").all().reduce((sum, row) => sum + Number(row.tokens), 0);
      expect(ledgerTokens).toBe(Number(runtime.store.db.prepare("SELECT json_extract(body,'$.used.tokens') AS tokens FROM groups WHERE id='g'").get()!.tokens));
      // The integration that owned them succeeded: its conflict copies are gone.
      await until(() => readdirSync(`${runtime.store.stateDir}.workspaces`).every((name) => !name.startsWith("integration-conflict-g-")), 30_000, "the copies to go");
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });

  it("squash: a base that moved during the resolution discards it; the next approval integrates one commit on the new main", async () => {
    const w = await worlds.world([{ taskId: "a", targetPaths: ["shared.txt"], verifierType: "command" }], {
      a: { files: { "shared.txt": "A\n" } },
      "integrate-g-1": { files: { "shared.txt": "M\nA\n" } },
      "integrate-g-2": { files: { "shared.txt": "M\nA\n" } },
    });
    const runtime = await w.boot(); try {
      const main = await startConflicting(runtime, w, LOCAL_SQUASH);
      await until(() => integrationOf(runtime).state === "conflict", 300_000, "the conflict");
      const tip = w.tip();
      expect(integrationOf(runtime).conflict).toMatchObject({ attempt: 1, base: main, tip });
      expect(code(await runtime.service.resolveIntegrationConflict(raw(runtime, "resolve-1", "resolve-integration-conflict", {})))).toBe("applied");
      // The person moves main (another file) before the resolution can finish: no await between the approval and this.
      const moved = commitOn(w.repo, "refs/heads/main", { "x.txt": "x\n" }, "person again");
      await until(() => integrationOf(runtime).conflict?.attempt === 2, 300_000, "the discarded resolution to conflict again");
      // Discarded: main never received the first resolution, and the new conflict is against the moved main.
      expect(cg(w.repo, "rev-parse", "main")).toBe(moved);
      expect(integrationOf(runtime)).toMatchObject({ state: "conflict", reason: "integration-conflict", conflict: { base: moved, tip } });
      expect(runtime.store.db.prepare("SELECT delivered FROM outbox WHERE id='integration-usage:integrate-g-1'").get()).toEqual({ delivered: 1 });
      expect(code(await runtime.service.resolveIntegrationConflict(raw(runtime, "resolve-2", "resolve-integration-conflict", {})))).toBe("applied");
      await until(() => integrationOf(runtime).lastIntegrated === tip, 300_000, "the integration");
      const integrated = cg(w.repo, "rev-parse", "main");
      expect(parents(w.repo, integrated)).toEqual([moved]);
      expect(cg(w.repo, "show", `${integrated}:shared.txt`)).toBe("M\nA");
      expect(cg(w.repo, "show", `${integrated}:x.txt`)).toBe("x");
      expect(integrationOf(runtime)).toMatchObject({ state: "idle", integratedCommit: integrated, conflict: null, resolution: null });
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });
});
