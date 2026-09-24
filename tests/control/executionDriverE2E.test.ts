import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { canonicalBytes } from "../../src/control/canonicalJson.js";
import { DriverCrash, type CrashPoint } from "../../src/control/executionDriver.js";
import { readArchivedPlan, readBudgetProposal } from "../../src/control/queries.js";
import { assembleControlRuntime, type ControlRuntime } from "../../src/panel/controlAssembly.js";
import { controlRepoKey, resolveControlOptions } from "../../src/panel/controlOptions.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { profileSnapshot } from "./fixtures/web.js";

/**
 * Execution driver spec §7.2 E1, E2, W1, T1 and R1 against the real ccloop build (ORCA_CCLOOP_BIN, which
 * must contain ccloop changes C1-C3) and its scripted fake codex. Everything is relocated under a
 * temporary root. The honest claim these support (deviation D1): with fake codex, a soft group, and an
 * estimator whose estimate is blocked-capability because contextWindowTokens is null, Web dispatch runs
 * from confirm to settle and lands on orca/<groupId>. Not "Web dispatch works".
 */
const realBinary = process.env.ORCA_CCLOOP_BIN;
const roots: string[] = [];
// Retried: every scenario shuts its runtime down in a finally, but a shutdown does not wait for a
// background reconciliation `ccloop run` (the Task 6 deferral), so after a failed E1 that child can
// still be writing under the root when this runs. A passing scenario leaves no child behind.
afterAll(async () => { for (const root of roots) await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });

const g = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8" }).trim();
const sha256 = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

/** ccloop's canonicalHash (ccloop src/control/protocol.ts:172-192): keys sorted by localeCompare, JSON, sha256. */
function ccloopHash(value: unknown): string {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical)
    : item !== null && typeof item === "object"
      ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, canonical(nested)]))
      : item;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

/** What the shipped ccloop answers (pinned in webCcloopSmoke.test.ts); a null window blocks the estimate (D1). */
const CCLOOP_CAPABILITIES = {
  usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable",
  handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null,
} as const;

interface Task { taskId: string; dependsOn?: string[]; targetPaths: string[]; requiredChecks?: string[]; verifierType?: "agent" | "command" }

async function world(tasks: Task[], script: Record<string, { files: Record<string, string> }>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-driver-e2e-")));
  roots.push(root);
  const repo = join(root, "target");
  await mkdir(repo);
  g(repo, "init", "-q", "-b", "main");
  await writeFile(join(repo, "shared.txt"), "base\n");
  g(repo, "add", "shared.txt");
  g(repo, "commit", "-qm", "base");
  const marker = join(root, "codex-marker.json");
  const scriptPath = join(root, "codex-script.json");
  await writeFile(scriptPath, JSON.stringify(script));
  const fakeCodex = resolve(dirname(realBinary!), "..", "tests", "fixtures", "fake-codex.mjs");
  const adapter = { command: [process.execPath, fakeCodex, "script", marker, scriptPath], model: "fixture-model", budgetMode: "soft", sandbox: "workspace-write", timeoutMs: 120_000, killGraceMs: 5_000 };
  const adapterPath = join(root, "adapter.json");
  await writeFile(adapterPath, JSON.stringify(adapter), { mode: 0o600 });
  const contracts = join(root, "contracts");
  await mkdir(contracts);
  const planTasks = [];
  for (const task of tasks) {
    const checks = task.requiredChecks ?? ["true"];
    // Agent by default, so the verify phase's provider call is exercised; E1's task c and T1 use a
    // command verifier, whose verify phase calls no provider. Before ccloop C4 (9a91d2b) that phase
    // reported null usage, Orca booked it as unknown work usage and the run could not settle
    // (settle-incomplete, measured against ccloop 5c05ed3); C4 reports 0.
    const contract = {
      objective: { taskId: task.taskId, goal: `write ${task.targetPaths.join(", ")}`, successCondition: "the files hold the scripted text", nonGoals: [] },
      context: { repoPath: repo, targetPaths: task.targetPaths, relevantDocs: [], buildTestCommands: checks, constraints: [] },
      executionPolicy: { autonomyLevel: "L2", maxAttempts: 1, perAttemptTimeoutMs: 120_000, totalRuntimeBudgetMs: 240_000, tokenBudget: 100_000, worktreeRequired: true, partialOutcomeRecoveryWindowMs: 1_000 },
      safetyPolicy: { allowlistPaths: [], denylistPaths: [], maxFilesTouched: 2, humanGateConditions: [] },
      verification: { verifierType: task.verifierType ?? "agent", requiredChecks: checks, rejectOn: ["failure"], evidenceRequired: [] },
      escalationAndExit: { escalationTargets: [], pauseOn: [], stopOn: [], terminalStates: ["succeeded", "blocked_waiting_human", "exhausted", "cancelled", "failed"] },
    };
    const path = join(contracts, `${task.taskId}.json`);
    await writeFile(path, canonicalBytes(contract));
    planTasks.push({ taskId: task.taskId, contract: path, dependsOn: task.dependsOn ?? [], targetVersion: 1, configHash: ccloopHash(adapter) });
  }
  const planPath = join(repo, "plan.json");
  await writeFile(planPath, JSON.stringify({ targetRepo: repo, ccloopBin: realBinary, runsDir: join(root, "unused-runs"), workBranch: "orca/unused", policy: "local-merge", ledgerMode: "out-of-repo", goal: "ship", successConditions: ["the files hold the scripted text"], tasks: planTasks }));
  const snapshot = profileSnapshot();
  snapshot.profile.capabilities = { ...CCLOOP_CAPABILITIES };
  const profilePath = join(root, "profile.json");
  await writeFile(profilePath, JSON.stringify(snapshot));
  const repoId = controlRepoKey("e2e");
  const repos = [{ projectKey: "e2e", path: repo }];
  const env: NodeJS.ProcessEnv = { ORCA_CONTROL_DIR: join(root, "control"), ORCA_CCLOOP_BIN: realBinary!, ORCA_CCLOOP_ADAPTER_CONFIG: adapterPath };
  const { rejection, ...control } = resolveControlOptions(["--plan", `plan=${repoId}=${planPath}`, "--profile", profilePath, "--estimator-profile", "all", "--estimate-mode", "soft", "--control-wake-ms", "50"], env, repos);
  if (rejection !== null) throw new Error(rejection);
  let epoch = 0;
  // Every runtime this world booted and has not closed; `teardown` shuts each down and closes it, so a
  // failing scenario leaves no pump or driver running into the next one.
  const live = new Set<ControlRuntime>();
  const boot = async (driverCrash?: (point: CrashPoint) => void): Promise<ControlRuntime> => {
    const runtime = await assembleControlRuntime({ control, repos, epoch: `epoch-e2e-${++epoch}`, env, driverCrash });
    if (runtime === null) throw new Error("the control plane did not assemble");
    live.add(runtime);
    await runtime.recover();
    return runtime;
  };
  /** A process death: no shutdown, just the store let go. */
  const die = (runtime: ControlRuntime): void => { live.delete(runtime); runtime.close(); };
  const teardown = async (): Promise<void> => {
    for (const runtime of live) {
      live.delete(runtime);
      try { await runtime.shutdown(); } finally { runtime.close(); }
    }
  };
  const calls = (): string[] => existsSync(`${marker}.calls`) ? readFileSync(`${marker}.calls`, "utf8").trim().split("\n") : [];
  const human = () => ({ symbolic: g(repo, "symbolic-ref", "HEAD"), head: g(repo, "rev-parse", "HEAD"), index: sha256(join(repo, ".git", "index")), file: readFileSync(join(repo, "shared.txt"), "utf8"), status: g(repo, "status", "--porcelain") });
  const worktrees = (): string[] => g(repo, "worktree", "list", "--porcelain").split("\n").filter((line) => line.startsWith("worktree "));
  /** Commits orca/g gained over main along its first parent: one per landing. */
  const landings = (): number => Number(g(repo, "rev-list", "--first-parent", "--count", "main..refs/heads/orca/g"));
  return { root, repo, repoId, boot, die, teardown, calls, human, worktrees, landings };
}

const raw = (runtime: ControlRuntime, commandId: string, verb: string, payload: unknown, target: unknown = { kind: "group", groupId: "g" }) => ({
  schema: "orca-raw-command-v1", commandId, actorId: "human", verb, target, payload,
  // A new group, and a repository setting nobody has set yet, are both at revision 0.
  expectedRevision: verb === "import-plan" || verb === "set-workspace-mode" ? 0 : Number(runtime.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision),
}) as never;

/** Import, confirm soft, optionally widen the token ceiling, start -- through the assembled service. */
async function startGroup(runtime: ControlRuntime, repoId: string, raiseTokens = 0): Promise<void> {
  const imported = await runtime.service.importPlan(raw(runtime, "import", "import-plan", { groupId: "g", repoId, planId: "plan" }));
  expect(imported).toMatchObject({ result: { kind: "imported", estimateState: "blocked-capability" } });
  const hash = runtime.router.list()[0]!.profileHash;
  const confirmed = runtime.service.confirm(raw(runtime, "confirm", "confirm", {
    planHash: readArchivedPlan(runtime.store, "g").planHash, proposalVersion: readBudgetProposal(runtime.store, "g").proposalVersion, budgetMode: "soft",
    profileIds: { estimator: "all", worker: "all", handoff: "all", goalReview: "all" }, profileHashes: { estimator: hash, worker: hash, handoff: hash, goalReview: hash },
    contextPolicy: { handoffAtContextTokens: null },
  }));
  expect("error" in confirmed ? confirmed.error : "confirmed").toBe("confirmed");
  if (raiseTokens > 0) {
    const limit = readControlGroup(runtime.store, runtime.epoch, "g").ledger.groupLimit;
    const raised = runtime.service.setLimit(raw(runtime, "raise", "set-limit", { limit: { ...limit, tokens: limit.tokens + raiseTokens } }));
    expect("error" in raised ? raised.error : "raised").toBe("raised");
  }
  const started = await runtime.service.start(raw(runtime, "start", "start", {}));
  expect("error" in started ? started.error : "started").toBe("started");
}

interface RunRow { runId: string; task: string; body: Record<string, any> }
const workRuns = (runtime: ControlRuntime): RunRow[] => runtime.store.db.prepare("SELECT id,work_item_id,body FROM runs WHERE group_id='g' ORDER BY id").all()
  .map((row) => ({ runId: String(row.id), task: String(row.work_item_id), body: JSON.parse(String(row.body)) }))
  .filter((row) => row.body.phase === "work");
const workStatus = (runtime: ControlRuntime, taskId: string): string =>
  JSON.parse(String(runtime.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body)).status;

async function until(predicate: () => boolean, ms: number, what: string, poll = 100): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, poll));
  }
}

/** A run that stopped moving on its own is a failure to report by its reason, not a timeout to wait out. */
function noBlocked(runtime: ControlRuntime): void {
  const blocked = workRuns(runtime).filter((run) => run.body.state === "blocked");
  if (blocked.length > 0) throw new Error(`blocked: ${blocked.map((run) => `${run.task}=${run.body.drive?.blockedReason}`).join(", ")}`);
}

/** Every file and directory under `dir`, relative, sorted. */
function tree(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" }).sort();
}

describe.skipIf(!realBinary)("the execution driver against real ccloop (spec §7.2)", { timeout: 420_000 }, () => {
  // Rule 17: every ccloop child (control calls, its detached worker, the reconciliation `ccloop run`,
  // fake codex, git) inherits this worker's environment, so HOME and the XDG roots are moved to an
  // empty temporary directory for the whole file, and each scenario must leave it empty.
  const saved: Record<string, string | undefined> = {};
  const HOME_KEYS = ["HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME"] as const;
  let fakeHome = "";
  beforeAll(async () => {
    fakeHome = await realpath(await mkdtemp(join(tmpdir(), "orca-driver-e2e-home-")));
    roots.push(fakeHome);
    for (const key of HOME_KEYS) saved[key] = process.env[key];
    process.env.HOME = fakeHome;
    for (const key of HOME_KEYS.slice(1)) process.env[key] = join(fakeHome, key.toLowerCase());
  });
  afterAll(() => { for (const key of HOME_KEYS) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });
  afterEach(() => { expect(tree(fakeHome)).toEqual([]); });

  it("E1: three tasks, two in conflict and one dependent, from confirm to settle on orca/<group>, spending no more than planned", async () => {
    const w = await world([
      { taskId: "a", targetPaths: ["shared.txt"] }, { taskId: "b", targetPaths: ["shared.txt"] },
      // Fix round 1 (controller ruling): the production-common command verifier goes through to settle.
      { taskId: "c", dependsOn: ["a"], targetPaths: ["c.txt"], verifierType: "command" },
    ], {
      a: { files: { "shared.txt": "A\n" } }, b: { files: { "shared.txt": "B\n" } }, c: { files: { "c.txt": "C\n" } },
      "reconcile-a-b": { files: { "shared.txt": "A\nB\n" } }, "reconcile-b-a": { files: { "shared.txt": "A\nB\n" } },
    });
    const before = w.human();
    const runtime = await w.boot(); try {
      // Deviation D12: the default reserve cannot afford a reconciliation until another run settles.
      await startGroup(runtime, w.repoId, 10_000_000);
      runtime.startPump(50);
      await until(() => { noBlocked(runtime); return ["a", "b", "c"].every((id) => workStatus(runtime, id) === "done") && workRuns(runtime).every((run) => run.body.drive?.cleanedUp === true); }, 360_000, "every task to settle");
      const runs = workRuns(runtime);
      expect(runs.map((run) => run.body.state)).toEqual(["settled", "settled", "settled"]);
      expect(readControlGroup(runtime.store, runtime.epoch, "g").runs.map((run) => run.state)).toEqual(["settled-recoverable", "settled-recoverable", "settled-recoverable"]);
      expect(g(w.repo, "show", "refs/heads/orca/g:shared.txt")).toBe("A\nB");
      expect(g(w.repo, "show", "refs/heads/orca/g:c.txt")).toBe("C");
      const reconciled = runs.filter((run) => run.body.drive.reconcile !== null);
      expect(reconciled).toHaveLength(1);
      // Spec §3.5: a settled, landed run's own workspace is removed; everything else is kept as the scene.
      // What is left is exactly the reconciled run's conflict copy and its reconciliation runs directory
      // (the synthesized contract and ccloop's loop state), and no worktree but the person's.
      const reconciledId = reconciled[0]!.runId;
      expect(readdirSync(`${runtime.store.stateDir}.workspaces`).sort()).toEqual([`conflict-${reconciledId}`, `reconcile-${reconciledId}`]);
      expect(w.worktrees()).toEqual([`worktree ${w.repo}`]);
      expect(g(w.repo, "log", "-1", "--format=%s", reconciled[0]!.body.drive.landedCommit)).toMatch(/^orca: land run-.* \(reconciled with [ab]\)$/);
      const a = runs.find((run) => run.task === "a")!, c = runs.find((run) => run.task === "c")!;
      expect(() => g(w.repo, "merge-base", "--is-ancestor", a.body.drive.landedCommit, c.body.drive.base)).not.toThrow();
      // Four ccloop runs (three tasks, one reconciliation), each planning and executing once. Only a and b
      // have an agent verifier, which calls the provider once each; c's command verifier and the
      // synthesized reconciliation contract's (src/scheduler/reconcile.ts) call none. 4 + 4 + 2 = 10.
      const phases = w.calls();
      expect(phases).toHaveLength(10);
      expect(["plan", "execute", "verify"].map((phase) => phases.filter((call) => call === phase).length)).toEqual([4, 4, 2]);
      expect(w.human()).toEqual(before);
      // Controller ruling (Task 7): a real settle publishes -- each run's projection and task handoff,
      // and every group handoff, reach delivered=1, with no publish failure left on any run.
      const delivered = (id: string): unknown => runtime.store.db.prepare("SELECT delivered FROM outbox WHERE id=?").get(id);
      for (const run of runs) {
        expect(run.body.drive.publishError).toBe(null);
        expect(delivered(`projection:${run.body.checkpointId}`)).toEqual({ delivered: 1 });
        expect(delivered(`task-handoff:g:${run.task}:${run.body.checkpointId}`)).toEqual({ delivered: 1 });
      }
      const groupHandoffs = runtime.store.db.prepare("SELECT delivered FROM outbox WHERE kind='group-handoff'").all().map((row) => Number(row.delivered));
      expect(groupHandoffs.length).toBeGreaterThan(0);
      expect(groupHandoffs.every((value) => value === 1)).toBe(true);
      expect(runtime.store.dispatchBlocked).toBe(false);
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });

  it.each(["worktree", "clone"] as const)("E2/W1: in %s mode the run's workspace exists while it runs and is gone once it settles", async (mode) => {
    const w = await world([{ taskId: "a", targetPaths: ["shared.txt"] }], { a: { files: { "shared.txt": "A\n" } } });
    const runtime = await w.boot(); try {
      if (mode === "clone") {
        const set = await runtime.service.setWorkspaceMode(raw(runtime, "mode", "set-workspace-mode", { workspaceMode: "clone" }, { kind: "repository", repoId: w.repoId }));
        expect(set).toMatchObject({ result: { kind: "workspace-mode-set", workspaceMode: "clone" } });
      }
      await startGroup(runtime, w.repoId);
      runtime.startPump(50);
      let seen = false;
      await until(() => {
        noBlocked(runtime);
        const run = workRuns(runtime)[0];
        const drive = run?.body.drive;
        if (drive?.prepared === true && run!.body.state !== "settled") {
          expect(drive.workspaceMode).toBe(mode);
          if (mode === "worktree") expect(g(w.repo, "worktree", "list", "--porcelain").split("\n")).toContain(`worktree ${drive.workspacePath}`);
          else expect(statSync(join(drive.workspacePath, ".git")).isDirectory()).toBe(true);
          seen = true;
        }
        return seen && drive?.cleanedUp === true;
      }, 240_000, "the run to settle", 20);
      const drive = workRuns(runtime)[0]!.body.drive;
      expect(existsSync(drive.workspacePath)).toBe(false);
      expect(w.worktrees()).toEqual([`worktree ${w.repo}`]);
      // The clean one-task run's end state, which R1 compares against: one landing on orca/g.
      expect(w.landings()).toBe(1);
      expect(readdirSync(`${runtime.store.stateDir}.workspaces`)).toEqual([]);
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });

  it("T1: a run whose checks fail ends blocked by its terminal, and orca/<group> does not move", async () => {
    const w = await world([{ taskId: "a", targetPaths: ["shared.txt"], requiredChecks: ["false"], verifierType: "command" }], { a: { files: { "shared.txt": "A\n" } } });
    const runtime = await w.boot(); try {
      await startGroup(runtime, w.repoId);
      runtime.startPump(50);
      await until(() => workRuns(runtime)[0]?.body.state === "blocked", 240_000, "the run to block");
      const drive = workRuns(runtime)[0]!.body.drive;
      expect(drive.blockedAt).toBe("C");
      expect(drive.blockedReason).toMatch(/^terminal:(failed|exhausted|blocked_waiting_human|cancelled)$/);
      expect(g(w.repo, "rev-parse", "refs/heads/orca/g")).toBe(g(w.repo, "rev-parse", "main"));
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });

  it.each(["A2-after-workspace", "B-after-accept", "C-after-terminal", "D-after-cas", "E-after-acceptance"] as const)(
    "R1 %s: a death between an external action and its record ends where a clean run ends, spending no more", async (point) => {
      const w = await world([{ taskId: "a", targetPaths: ["shared.txt"] }], { a: { files: { "shared.txt": "A\n" } } });
      const before = w.human();
      try {
        const first = await w.boot((at) => { if (at === point) throw new DriverCrash(at); });
        await startGroup(first, w.repoId);
        first.startPump(50);
        await until(() => first.driver?.crashed === point, 240_000, `the crash at ${point}`);
        w.die(first);
        const second = await w.boot();
        expect(second.store.dispatchBlocked).toBe(false);
        second.startPump(50);
        await until(() => { noBlocked(second); return workStatus(second, "a") === "done" && workRuns(second)[0]?.body.drive?.cleanedUp === true; }, 240_000, "the run to settle after the restart");
        expect(w.calls()).toEqual(["plan", "execute", "verify"]);
        expect(readdirSync(`${second.store.stateDir}.runs`)).toHaveLength(1);
        expect(g(w.repo, "show", "refs/heads/orca/g:shared.txt")).toBe("A");
        // Measured independently of the driver's own cleanedUp flag: the end state E2's clean run ends in --
        // one landing (a D-after-cas replay that landed twice would show two), no worktree but the
        // person's, an empty workspaces root, and the person's checkout untouched.
        expect(w.landings()).toBe(1);
        expect(w.worktrees()).toEqual([`worktree ${w.repo}`]);
        expect(readdirSync(`${second.store.stateDir}.workspaces`)).toEqual([]);
        expect(w.human()).toEqual(before);
        expect(second.store.dispatchBlocked).toBe(false);
        expect(await second.shutdown()).toBe(true);
      } finally { await w.teardown(); }
    });
});
