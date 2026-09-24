import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
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
// Retried: a ccloop child of a failed scenario may still be writing under the root when this runs.
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

interface Task { taskId: string; dependsOn?: string[]; targetPaths: string[]; requiredChecks?: string[] }

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
    // An agent verifier, not a command one: under "command" ccloop's verify phase calls no provider and
    // reports its usage as null, which Orca books as unknown work usage, and such a run cannot settle
    // (measured against ccloop 5c05ed3: settle-incomplete, run.unknown.work=true). Reported, not fixed here.
    const contract = {
      objective: { taskId: task.taskId, goal: `write ${task.targetPaths.join(", ")}`, successCondition: "the files hold the scripted text", nonGoals: [] },
      context: { repoPath: repo, targetPaths: task.targetPaths, relevantDocs: [], buildTestCommands: checks, constraints: [] },
      executionPolicy: { autonomyLevel: "L2", maxAttempts: 1, perAttemptTimeoutMs: 120_000, totalRuntimeBudgetMs: 240_000, tokenBudget: 100_000, worktreeRequired: true, partialOutcomeRecoveryWindowMs: 1_000 },
      safetyPolicy: { allowlistPaths: [], denylistPaths: [], maxFilesTouched: 2, humanGateConditions: [] },
      verification: { verifierType: "agent", requiredChecks: checks, rejectOn: ["failure"], evidenceRequired: [] },
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
  const boot = async (driverCrash?: (point: CrashPoint) => void): Promise<ControlRuntime> => {
    const runtime = await assembleControlRuntime({ control, repos, epoch: `epoch-e2e-${++epoch}`, env, driverCrash });
    if (runtime === null) throw new Error("the control plane did not assemble");
    await runtime.recover();
    return runtime;
  };
  const calls = (): string[] => existsSync(`${marker}.calls`) ? readFileSync(`${marker}.calls`, "utf8").trim().split("\n") : [];
  const human = () => ({ symbolic: g(repo, "symbolic-ref", "HEAD"), head: g(repo, "rev-parse", "HEAD"), index: sha256(join(repo, ".git", "index")), file: readFileSync(join(repo, "shared.txt"), "utf8"), status: g(repo, "status", "--porcelain") });
  return { root, repo, repoId, boot, calls, human };
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

describe.skipIf(!realBinary)("the execution driver against real ccloop (spec §7.2)", { timeout: 420_000 }, () => {
  it("E1: three tasks, two in conflict and one dependent, from confirm to settle on orca/<group>, spending no more than planned", async () => {
    const w = await world([
      { taskId: "a", targetPaths: ["shared.txt"] }, { taskId: "b", targetPaths: ["shared.txt"] }, { taskId: "c", dependsOn: ["a"], targetPaths: ["c.txt"] },
    ], {
      a: { files: { "shared.txt": "A\n" } }, b: { files: { "shared.txt": "B\n" } }, c: { files: { "c.txt": "C\n" } },
      "reconcile-a-b": { files: { "shared.txt": "A\nB\n" } }, "reconcile-b-a": { files: { "shared.txt": "A\nB\n" } },
    });
    const before = w.human();
    const runtime = await w.boot();
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
    expect(readdirSync(`${runtime.store.stateDir}.workspaces`).filter((name) => name.startsWith("reconcile-"))).toHaveLength(1);
    expect(g(w.repo, "log", "-1", "--format=%s", reconciled[0]!.body.drive.landedCommit)).toMatch(/^orca: land run-.* \(reconciled with [ab]\)$/);
    const a = runs.find((run) => run.task === "a")!, c = runs.find((run) => run.task === "c")!;
    expect(() => g(w.repo, "merge-base", "--is-ancestor", a.body.drive.landedCommit, c.body.drive.base)).not.toThrow();
    // Four ccloop runs (three tasks, one reconciliation), each planning and executing once. The tasks'
    // agent verifier calls the provider once each; the synthesized reconciliation contract carries a
    // command verifier (src/scheduler/reconcile.ts), which calls none. 4 + 4 + 3 = 11, and no more.
    const phases = w.calls();
    expect(phases).toHaveLength(11);
    expect(["plan", "execute", "verify"].map((phase) => phases.filter((call) => call === phase).length)).toEqual([4, 4, 3]);
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
    runtime.close();
  });

  it.each(["worktree", "clone"] as const)("E2/W1: in %s mode the run's workspace exists while it runs and is gone once it settles", async (mode) => {
    const w = await world([{ taskId: "a", targetPaths: ["shared.txt"] }], { a: { files: { "shared.txt": "A\n" } } });
    const runtime = await w.boot();
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
    const registered = g(w.repo, "worktree", "list", "--porcelain").split("\n").filter((line) => line.startsWith("worktree "));
    expect(registered).toEqual([`worktree ${w.repo}`]);
    expect(await runtime.shutdown()).toBe(true);
    runtime.close();
  });

  it("T1: a run whose checks fail ends blocked by its terminal, and orca/<group> does not move", async () => {
    const w = await world([{ taskId: "a", targetPaths: ["shared.txt"], requiredChecks: ["false"] }], { a: { files: { "shared.txt": "A\n" } } });
    const runtime = await w.boot();
    await startGroup(runtime, w.repoId);
    runtime.startPump(50);
    await until(() => workRuns(runtime)[0]?.body.state === "blocked", 240_000, "the run to block");
    const drive = workRuns(runtime)[0]!.body.drive;
    expect(drive.blockedAt).toBe("C");
    expect(drive.blockedReason).toMatch(/^terminal:(failed|exhausted|blocked_waiting_human|cancelled)$/);
    expect(g(w.repo, "rev-parse", "refs/heads/orca/g")).toBe(g(w.repo, "rev-parse", "main"));
    expect(await runtime.shutdown()).toBe(true);
    runtime.close();
  });

  it.each(["A2-after-workspace", "B-after-accept", "C-after-terminal", "D-after-cas", "E-after-acceptance"] as const)(
    "R1 %s: a death between an external action and its record ends where a clean run ends, spending no more", async (point) => {
      const w = await world([{ taskId: "a", targetPaths: ["shared.txt"] }], { a: { files: { "shared.txt": "A\n" } } });
      const first = await w.boot((at) => { if (at === point) throw new DriverCrash(at); });
      await startGroup(first, w.repoId);
      first.startPump(50);
      await until(() => first.driver?.crashed === point, 240_000, `the crash at ${point}`);
      first.close();
      const second = await w.boot();
      expect(second.store.dispatchBlocked).toBe(false);
      second.startPump(50);
      await until(() => { noBlocked(second); return workStatus(second, "a") === "done" && workRuns(second)[0]?.body.drive?.cleanedUp === true; }, 240_000, "the run to settle after the restart");
      expect(w.calls()).toEqual(["plan", "execute", "verify"]);
      expect(readdirSync(`${second.store.stateDir}.runs`)).toHaveLength(1);
      expect(g(w.repo, "show", "refs/heads/orca/g:shared.txt")).toBe("A");
      expect(second.store.dispatchBlocked).toBe(false);
      expect(await second.shutdown()).toBe(true);
      second.close();
    });
});
