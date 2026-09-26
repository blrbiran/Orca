import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, expect } from "vitest";
import { canonicalBytes } from "../../../src/control/canonicalJson.js";
import { resolveGroupSelections } from "../../../src/control/agentFreeze.js";
import type { CrashPoint } from "../../../src/control/executionDriver.js";
import { readArchivedPlan, readBudgetProposal } from "../../../src/control/queries.js";
import { assembleControlRuntime, type ControlRuntime } from "../../../src/panel/controlAssembly.js";
import { controlRepoKey, resolveControlOptions } from "../../../src/panel/controlOptions.js";
import { readControlGroup } from "../../../src/panel/controlViews.js";
import { profileSnapshot } from "./web.js";

/**
 * The real-ccloop world shared by executionDriverE2E.test.ts (execution driver spec §7.2) and
 * handoffE2E.test.ts (handoff delivery spec §9.2), moved here from the former so the latter imports it
 * rather than copying it (handoff delivery preflight I11). A target repository, a scripted fake codex
 * from the ccloop build ORCA_CCLOOP_BIN points at, a plan, a profile and control options, all under a
 * temporary root; `boot` assembles a control runtime over them.
 *
 * Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the fake codex is an
 * installation in an agents table (`<root>/agents.json`, spec §4.2) handed over as ORCA_AGENTS_TABLE, and every
 * configHash comes from ccloop's own resolution of a selection against that table (spec I3) -- the local copy of
 * ccloop's canonical hash this file used to carry is gone.
 */
export const realBinary = process.env.ORCA_CCLOOP_BIN;

export const g = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8" }).trim();
const sha256 = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

/**
 * What `ccloop agents detect` would record as an installation's version: the first `\d+.\d+.\d+(-…)?` in the stdout
 * of `[...command, "--version"]` (agent selection plan T1's probeVersion rule). The fakes answer `--version` without
 * logging a call.
 */
export function versionOf(command: string[]): string {
  const printed = execFileSync(command[0]!, [...command.slice(1), "--version"], { encoding: "utf8", input: "" });
  const match = /\d+\.\d+\.\d+(-[\w.]+)?/.exec(printed);
  if (!match) throw new Error(`no version in ${JSON.stringify(printed)}`);
  return match[0];
}

/** What the shipped ccloop answers (pinned in webCcloopSmoke.test.ts); a null window blocks the estimate (D1). */
const CCLOOP_CAPABILITIES = {
  usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable",
  handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null,
} as const;

export interface Task { taskId: string; dependsOn?: string[]; targetPaths: string[]; requiredChecks?: string[]; verifierType?: "agent" | "command" }
/**
 * One fake codex script entry: the files execute writes; ccloop C5 adds how long each phase sleeps first,
 * and ccloop C-3 whether the phase reports its usage before that sleep.
 */
export interface ScriptEntry { files: Record<string, string>; delayMs?: { plan?: number; execute?: number; verify?: number }; usageBeforeDelay?: boolean }

/** The codex installation's killGraceMs in every world; handoffE2E's G scenario tells it apart from HANDOFF_EXTRA_GRACE_MS alone. */
export const KILL_GRACE_MS = 5_000;

export type World = Awaited<ReturnType<ReturnType<typeof ccloopWorlds>["world"]>>;

/**
 * One file's worlds: `rootPrefix` names their temporary roots, `epochPrefix` the epochs `boot` assembles
 * under. `removeRoots` is for the file's `afterAll`; `relocateHome` is called inside the file's describe.
 */
export function ccloopWorlds(options: { rootPrefix: string; epochPrefix: string }) {
  const roots: string[] = [];

  async function world(tasks: Task[], script: Record<string, ScriptEntry>) {
    const root = await realpath(await mkdtemp(join(tmpdir(), options.rootPrefix)));
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
    const codexCommand = [process.execPath, fakeCodex, "script", marker, scriptPath];
    const table = join(root, "agents.json");
    // Plan P13: the table object is a value of its own (returned with the world), so a later scenario can add an
    // installation to `agentsTable.installations` and rewrite `table` from it.
    const agentsTable = { schema: "ccloop-agents-table-v1", installations: {
      codex: { kind: "codex", command: codexCommand, version: versionOf(codexCommand), configDir: null, timeoutMs: 120_000, killGraceMs: KILL_GRACE_MS, sandbox: "workspace-write", budgetMode: "soft" },
    } as Record<string, Record<string, unknown>> };
    await writeFile(table, JSON.stringify(agentsTable), { mode: 0o600 });
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
      planTasks.push({ taskId: task.taskId, contract: path, dependsOn: task.dependsOn ?? [], targetVersion: 1 });
    }
    const planPath = join(repo, "plan.json");
    await writeFile(planPath, JSON.stringify({ targetRepo: repo, ccloopBin: realBinary, runsDir: join(root, "unused-runs"), workBranch: "orca/unused", policy: "local-merge", ledgerMode: "out-of-repo", goal: "ship", successConditions: ["the files hold the scripted text"], tasks: planTasks }));
    const snapshot = profileSnapshot();
    snapshot.profile.capabilities = { ...CCLOOP_CAPABILITIES };
    const profilePath = join(root, "profile.json");
    await writeFile(profilePath, JSON.stringify(snapshot));
    const repoId = controlRepoKey("e2e");
    const repos = [{ projectKey: "e2e", path: repo }];
    const env: NodeJS.ProcessEnv = { ORCA_CONTROL_DIR: join(root, "control"), ORCA_CCLOOP_BIN: realBinary!, ORCA_AGENTS_TABLE: table };
    const { rejection, ...control } = resolveControlOptions(["--plan", `plan=${repoId}=${planPath}`, "--profile", profilePath, "--estimator-profile", "all", "--estimate-mode", "soft", "--control-wake-ms", "50"], env, repos);
    if (rejection !== null) throw new Error(rejection);
    let epoch = 0;
    // Every runtime this world booted and has not closed; `teardown` shuts each down and closes it, so a
    // failing scenario leaves no pump or driver running into the next one.
    const live = new Set<ControlRuntime>();
    const boot = async (driverCrash?: (point: CrashPoint) => void): Promise<ControlRuntime> => {
      const runtime = await assembleControlRuntime({ control, repos, epoch: `${options.epochPrefix}${++epoch}`, env, driverCrash });
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
    const lines = (path: string): string[] => existsSync(path) ? readFileSync(path, "utf8").trim().split("\n") : [];
    /** One line per provider call, the phase only (fake codex's own log). */
    const calls = (): string[] => lines(`${marker}.calls`);
    /** One `<phase> <script key>` line per provider call (ccloop C5): which entry answered it. */
    const scripted = (): string[] => lines(`${marker}.tasks`);
    const human = () => ({ symbolic: g(repo, "symbolic-ref", "HEAD"), head: g(repo, "rev-parse", "HEAD"), index: sha256(join(repo, ".git", "index")), file: readFileSync(join(repo, "shared.txt"), "utf8"), status: g(repo, "status", "--porcelain") });
    const worktrees = (): string[] => g(repo, "worktree", "list", "--porcelain").split("\n").filter((line) => line.startsWith("worktree "));
    /** Commits orca/g gained over main along its first parent: one per landing. */
    const landings = (): number => Number(g(repo, "rev-list", "--first-parent", "--count", "main..refs/heads/orca/g"));
    const show = (path: string): string => g(repo, "show", `refs/heads/orca/g:${path}`);
    const tip = (): string => g(repo, "rev-parse", "refs/heads/orca/g");
    return { root, repo, repoId, table, agentsTable, boot, die, teardown, calls, scripted, human, worktrees, landings, show, tip };
  }

  const removeRoots = async (): Promise<void> => {
    for (const root of roots) await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };

  /**
   * Rule 17: every ccloop child (control calls, its detached worker, the reconciliation `ccloop run`,
   * fake codex, git) inherits this worker's environment, so HOME and the XDG roots are moved to an
   * empty temporary directory for the whole describe, and each scenario must leave it empty. Call it
   * inside the describe.
   */
  function relocateHome(homePrefix: string): void {
    const saved: Record<string, string | undefined> = {};
    const HOME_KEYS = ["HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME"] as const;
    let fakeHome = "";
    beforeAll(async () => {
      fakeHome = await realpath(await mkdtemp(join(tmpdir(), homePrefix)));
      roots.push(fakeHome);
      for (const key of HOME_KEYS) saved[key] = process.env[key];
      process.env.HOME = fakeHome;
      for (const key of HOME_KEYS.slice(1)) process.env[key] = join(fakeHome, key.toLowerCase());
    });
    afterAll(() => { for (const key of HOME_KEYS) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });
    afterEach(() => { expect(tree(fakeHome)).toEqual([]); });
  }

  return { world, removeRoots, relocateHome };
}

export const raw = (runtime: ControlRuntime, commandId: string, verb: string, payload: unknown, target: unknown = { kind: "group", groupId: "g" }) => ({
  schema: "orca-raw-command-v1", commandId, actorId: "human", verb, target, payload,
  // A new group, and a repository setting or operator preferences nobody has set yet, are all at revision 0.
  expectedRevision: verb === "import-plan" || verb === "set-workspace-mode" || verb === "set-agent-preferences" ? 0 : Number(runtime.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision),
}) as never;

/**
 * Import, choose the world's installation as the operator's default agent, confirm soft (freezing ccloop's own answer
 * for that selection onto every task, agent selection spec §6.4), optionally widen the token ceiling, start -- through
 * the assembled service.
 */
export async function startGroup(runtime: ControlRuntime, repoId: string, raiseTokens = 0): Promise<void> {
  const imported = await runtime.service.importPlan(raw(runtime, "import", "import-plan", { groupId: "g", repoId, planId: "plan" }));
  expect(imported).toMatchObject({ result: { kind: "imported", estimateState: "blocked-capability" } });
  // Agent selection spec §6.2 layer 1: the operator's default worker is the world's installation (set after the
  // import, so the import's estimator still degrades to blocked-capability, as asserted above).
  const preferences = await runtime.service.setAgentPreferences(raw(runtime, "preferences", "set-agent-preferences", { preferences: { defaultAgent: "codex", perAgent: {} } }, { kind: "operator", operatorId: "human" }));
  expect("error" in preferences ? preferences.error : "set").toBe("set");
  const selections = await resolveGroupSelections({ store: runtime.store, port: runtime.port }, "g", "human");
  const hash = runtime.router.list()[0]!.profileHash;
  const confirmed = await runtime.service.confirm(raw(runtime, "confirm", "confirm", {
    planHash: readArchivedPlan(runtime.store, "g").planHash, proposalVersion: readBudgetProposal(runtime.store, "g").proposalVersion, budgetMode: "soft",
    profileIds: { estimator: "all", worker: "all", handoff: "all", goalReview: "all" }, profileHashes: { estimator: hash, worker: hash, handoff: hash, goalReview: hash },
    contextPolicy: { handoffAtContextTokens: null }, selectionsHash: selections.selectionsHash,
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

export interface RunRow { runId: string; task: string; body: Record<string, any> }
export const workRuns = (runtime: ControlRuntime): RunRow[] => runtime.store.db.prepare("SELECT id,work_item_id,body FROM runs WHERE group_id='g' ORDER BY id").all()
  .map((row) => ({ runId: String(row.id), task: String(row.work_item_id), body: JSON.parse(String(row.body)) }))
  .filter((row) => row.body.phase === "work");

export async function until(predicate: () => boolean, ms: number, what: string, poll = 100): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, poll));
  }
}

/** A run that stopped moving on its own is a failure to report by its reason, not a timeout to wait out. */
export function noBlocked(runtime: ControlRuntime): void {
  const blocked = workRuns(runtime).filter((run) => run.body.state === "blocked");
  if (blocked.length > 0) throw new Error(`blocked: ${blocked.map((run) => `${run.task}=${run.body.drive?.blockedReason}`).join(", ")}`);
}

/** Every file and directory under `dir`, relative, sorted. */
function tree(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" }).sort();
}
