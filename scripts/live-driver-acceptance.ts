// Live acceptance of the execution driver (spec docs/superpowers/specs/2026-09-25-execution-driver-design.md,
// §1 "real codex live acceptance belongs to the human"). One soft Web group, one task, driven from import to
// settle through the assembled control runtime -- the same service, wake pump and driver loop `orca panel`
// mounts, without HTTP -- against a real ccloop build (ORCA_CCLOOP_BIN, containing C1-C4) and either real
// codex or ccloop's scripted fake codex. Exit 0 only if every check in `checks` holds; summary.json in
// --output records each check, the ledger, and every usage number copied from ccloop's evidence.
//
// This SPENDS MONEY with --codex: nothing here caps dollars. The caps are tokens and time, all soft or
// best-effort: the contract tokenBudget (checked at phase end), the group token limit (a breach blocks new
// work, it does not stop a running phase), codex timeoutMs per phase, and the outer --deadline-ms watchdog,
// which kills every codex process group ccloop registered.
//
// Rule 17: Orca's own writes all go under --output (ORCA_CONTROL_DIR, ORCA_CORRECTIONS_DIR); ~/.orca is
// snapshotted and must not change. HOME is NOT relocated: real codex reads its credentials and config from
// ~/.codex and writes its own logs there (accepted by the human, 2026-09-25, session af3dc0d3).
//
// usage: tsx scripts/live-driver-acceptance.ts --ccloop-bin <abs dist/cli.js> --output <new dir>
//          (--codex <abs codex binary> --model <name> | --fake | --claude <abs claude binary> --model <name> | --fake-claude)
//          [--group-tokens 300000] [--task-tokens 150000] [--task-attempts 1] [--active-ms 600000]
//          [--call-usd 2] [--deadline-ms 900000] [--context-window 1000000] [--scenario single|conflict|deadline]
//
// --context-window sets the operator's contextWindow for the agent (claude: 1000000 is `--model <model>[1m]`, spelled
// by ccloop). --scenario conflict runs two tasks that both append a line to the same file from the same base, so the
// second to land conflicts and is reconciled by `ccloop run --agents` under the group's reconcile slot.
//
// --scenario deadline (claude kinds only; Orca claude stream usage (2026-09-27), spec §6.4): the one path that round
// exists for, run end to end. One task writes five files one at a time, so its execute is still running once claude
// has closed its first message; the script then issues handoff-stop with a deadline 2 s out, so ccloop cuts that
// execute instead of waiting for it. The cut phase answers no tokenUsage, only the usage ccloop's runner observed in
// the stream (observed-usage.json); Orca must book it (the run is not usage-unknown), park the run recoverable, and
// the panel's resume must continue it to a landing. Every step reads what D1 in tests/control/agentSelectionE2E.test.ts
// reads, and the checks fail -- not pass by accident -- if the execute finished before the deadline.
//
// Ruling review 2026-09-27 (paid claude round): --claude runs the real claude CLI. HOME is again NOT relocated (claude
// reads its OAuth login from the keychain under the real HOME), but the installation's command isolates the call from
// the person's own Claude Code setup and caps it in dollars (CLAUDE_ISOLATION below), and every CLAUDE* variable this
// process inherited (a Claude Code session's messaging socket, session id, entrypoint) is removed before anything
// starts, so the nested claude neither joins that session nor believes it runs inside one. scripts/claude-tee.mjs keeps
// each call's raw `-p` output, whose total_cost_usd and cache counts the summary copies (ccloop keeps only
// input/output tokens). Since Orca claude stream usage (2026-09-27) ccloop runs claude with
// `--output-format stream-json`, so that output is NDJSON and the envelope is its last `type: "result"` line.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { canonicalBytes } from "../src/control/canonicalJson.js";
import { resolveGroupSelections } from "../src/control/agentFreeze.js";
import { readDriverRun } from "../src/control/executionDriver.js";
import { readArchivedPlan, readBudgetProposal } from "../src/control/queries.js";
import { assembleControlRuntime, type ControlRuntime } from "../src/panel/controlAssembly.js";
import { controlRepoKey, resolveControlOptions } from "../src/panel/controlOptions.js";
import { readControlGroup } from "../src/panel/controlViews.js";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]!;
    if (!key.startsWith("--")) throw new Error(`unexpected argument ${key}`);
    if (key === "--fake") { out.fake = "1"; continue; }
    if (key === "--fake-claude") { out["fake-claude"] = "1"; continue; }
    const value = argv[++i];
    if (value === undefined) throw new Error(`${key} needs a value`);
    out[key.slice(2)] = value;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const fake = args.fake === "1";
const ccloopBin = args["ccloop-bin"];
const output = args.output;
if (!ccloopBin || !isAbsolute(ccloopBin) || !output) throw new Error("--ccloop-bin <absolute> and --output <new dir> are required");
const fakeClaude = args["fake-claude"] === "1";
const modes = [fake, args.codex !== undefined, fakeClaude, args.claude !== undefined].filter(Boolean).length;
if (modes !== 1) throw new Error("give exactly one of --codex <abs path> --model <name>, --fake, --claude <abs path> --model <name>, or --fake-claude");
const live = args.codex ?? args.claude;
if (live !== undefined && (!isAbsolute(live) || !args.model)) throw new Error("--codex/--claude must be absolute and --model is required");
const kind: "codex" | "claude" = args.claude !== undefined || fakeClaude ? "claude" : "codex";
const isFake = fake || fakeClaude;
for (const key of Object.keys(process.env)) if (key.startsWith("CLAUDE") && key !== "CLAUDE_CONFIG_DIR") delete process.env[key];
if (existsSync(output)) throw new Error(`refusing an existing --output ${output}`);
const groupTokens = Number(args["group-tokens"] ?? 300_000);
const taskTokens = Number(args["task-tokens"] ?? 150_000);
const deadlineMs = Number(args["deadline-ms"] ?? 900_000);
// deadline: the continuation is a second attempt and session of the same task, so a grant of one leaves it nothing
// and the task stays held (observed 2026-09-27 under --fake-claude); two is its default, an explicit value still wins.
const taskAttempts = Number(args["task-attempts"] ?? (args.scenario === "deadline" ? 2 : 1));
const activeMs = Number(args["active-ms"] ?? 600_000);
const callUsd = String(args["call-usd"] ?? "2");
const contextWindow = args["context-window"] === undefined ? undefined : Number(args["context-window"]);
if (contextWindow !== undefined && (!Number.isSafeInteger(contextWindow) || contextWindow <= 0)) throw new Error("--context-window must be a positive integer");
const scenario = args.scenario ?? "single";
if (scenario !== "single" && scenario !== "conflict" && scenario !== "deadline") throw new Error("--scenario is single, conflict or deadline");
// The deadline scenario reads what ccloop's claude runner observed in the stream; codex has no such file.
if (scenario === "deadline" && kind !== "claude") throw new Error("--scenario deadline needs --claude or --fake-claude");
/**
 * The real claude call, isolated from the person's own Claude Code setup: no user settings (so no hooks and no
 * plugins, which would also record this session), no MCP servers, no skills, no session written under ~/.claude,
 * no auto-memory directory made under ~/.claude/projects at start-up, edits accepted but nothing else, and claude's
 * own dollar ceiling per call -- the arguments `ccloop agents detect` drafts for claude. These go in the installation's
 * command, which ccloop puts before `-p` and which is outside configHash (ruling review R1).
 */
const CLAUDE_ISOLATION = ["--permission-mode", "acceptEdits", "--no-session-persistence", "--setting-sources", "project,local", "--strict-mcp-config", "--disable-slash-commands", "--settings", '{"autoMemoryEnabled":false}', "--max-budget-usd", callUsd];

const g = (cwd: string, ...rest: string[]): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...rest], { cwd, encoding: "utf8" }).trim();
const sha256 = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

/**
 * Agent selection spec §4.2: the version `ccloop agents detect` would record -- the first `\d+.\d+.\d+(-…)?` in the
 * stdout of `[...command, "--version"]`. The configHash is never computed here: ccloop answers it (spec I3).
 */
function versionOf(command: string[]): string {
  // Orca ruling review R28 (2026-09-27, wave 5 m-2): a synchronous probe that hangs cannot be interrupted by any
  // timer on this thread, so it carries its own bound (ccloop's probeVersion uses the same 10 s).
  const printed = execFileSync(command[0]!, [...command.slice(1), "--version"], { encoding: "utf8", input: "", timeout: 10_000, killSignal: "SIGKILL" });
  const match = /\d+\.\d+\.\d+(-[\w.]+)?/.exec(printed);
  if (!match) throw new Error(`no version in ${JSON.stringify(printed)}`);
  return match[0];
}

/** Every path under `dir` with its size and mtime, so a touch shows up, not only a new file. */
function snapshot(dir: string): string[] {
  if (!existsSync(dir)) return ["<absent>"];
  const rows = [`. ${statSync(dir).mtimeMs}`];
  for (const rel of readdirSync(dir, { recursive: true, encoding: "utf8" }).sort()) {
    const s = statSync(join(dir, rel));
    rows.push(`${rel} ${s.isDirectory() ? "d" : s.size} ${s.mtimeMs}`);
  }
  return rows;
}

/** Files named `name` anywhere under `dir`. */
function findAll(dir: string, name: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((rel) => rel.split("/").pop() === name).map((rel) => join(dir, rel)).sort();
}

const root = await realpath(await mkdir(output, { recursive: true, mode: 0o700 }).then(() => output));
const repo = join(root, "target");
await mkdir(repo);
g(repo, "init", "-q", "-b", "main");
await writeFile(join(repo, "README.md"), "live acceptance target\n");
g(repo, "add", "README.md");
if (scenario === "conflict") { await writeFile(join(repo, "shared.txt"), "base\n"); g(repo, "add", "shared.txt"); }
g(repo, "commit", "-qm", "base");

const marker = join(root, "codex-marker.json");
const scriptPath = join(root, "codex-script.json");
// The fakes' answers, keyed by task (the reconciliation's key is `reconcile-<self>-<other>`, whichever lands second).
// deadline: the execute answers only after 120 s but streams one closed message first (usageBeforeDelay), so it is
// cut with observed usage; the fake keys the continuation run as `a#continuation`.
const NUMBERS = ["one", "two", "three", "four", "five"];
const numberFiles = Object.fromEntries(NUMBERS.map((word) => [`${word}.txt`, `${word}\n`]));
await writeFile(scriptPath, JSON.stringify(scenario === "single" ? { a: { files: { "answer.txt": "42\n" } } } : scenario === "deadline" ? {
  a: { files: numberFiles, delayMs: { execute: 120_000 }, usageBeforeDelay: true }, "a#continuation": { files: numberFiles },
} : {
  a: { files: { "shared.txt": "base\nA\n" } }, b: { files: { "shared.txt": "base\nB\n" } },
  "reconcile-a-b": { files: { "shared.txt": "base\nA\nB\n" } }, "reconcile-b-a": { files: { "shared.txt": "base\nA\nB\n" } },
}));
const fakeCodex = resolve(dirname(ccloopBin), "..", "tests", "fixtures", "fake-codex.mjs");
const fakeClaudeCli = resolve(dirname(ccloopBin), "..", "tests", "fixtures", "fake-claude-cli.mjs");
const claudeRaw = join(root, "claude-raw");
// Agent selection spec §4.2, §6.6: one installation in an agents table handed over as ORCA_AGENTS_TABLE; the
// model is a selection field (the operator's preference below), and confirmation freezes ccloop's configHash for it.
const codexCommand = fake ? [process.execPath, fakeCodex, "script", marker, scriptPath] : [args.codex ?? ""];
// Both claude modes go through the tee, so the argv each call received is observed the same way.
const claudeTee = [process.execPath, resolve(import.meta.dirname, "claude-tee.mjs"), claudeRaw];
const claudeCommand = fakeClaude
  ? [...claudeTee, process.execPath, fakeClaudeCli, "script", marker, scriptPath]
  : [...claudeTee, args.claude ?? "", ...CLAUDE_ISOLATION];
const tablePath = join(root, "agents.json");
const installation = kind === "codex"
  ? { kind: "codex", command: codexCommand, version: versionOf(codexCommand), configDir: null, timeoutMs: 120_000, killGraceMs: 5_000, sandbox: "workspace-write", budgetMode: "soft" }
  : { kind: "claude", command: claudeCommand, version: versionOf(claudeCommand), configDir: null, timeoutMs: 600_000, killGraceMs: 5_000 };
await writeFile(tablePath, JSON.stringify({ schema: "ccloop-agents-table-v1", installations: { [kind]: installation } }), { mode: 0o600 });

type LiveTask = { taskId: string; files: string[]; goal: string; successCondition: string; check: string };
const tasks: LiveTask[] = scenario === "single"
  ? [{ taskId: "a", files: ["answer.txt"], goal: "Create a file named answer.txt at the repository root whose entire content is the characters 42 followed by one newline. Change no other file.", successCondition: "answer.txt holds exactly 42 and a newline", check: 'test "$(cat answer.txt)" = 42' }]
  : scenario === "deadline"
  ? [{ taskId: "a", files: Object.keys(numberFiles),
    goal: "Create five files one.txt, two.txt, three.txt, four.txt and five.txt at the repository root, one at a time, each holding its own number word and a newline (one.txt holds one, two.txt holds two, and so on). Change no other file.",
    successCondition: "each of one.txt ... five.txt holds exactly its own number word and a newline",
    check: NUMBERS.map((word) => `test "$(cat ${word}.txt)" = ${word}`).join(" && ") }]
  : ["A", "B"].map((line) => ({
    taskId: line.toLowerCase(), files: ["shared.txt"],
    goal: `Append one line containing exactly the single character ${line} to the end of shared.txt at the repository root. Keep every existing line unchanged and in its place. Change no other file.`,
    successCondition: `shared.txt still holds its existing lines and also a line that is exactly ${line}`,
    check: `grep -qx base shared.txt && grep -qx ${line} shared.txt`,
  }));
const taskIds = tasks.map((task) => task.taskId);
const planTasks = [];
for (const task of tasks) {
  const contract = {
    objective: { taskId: task.taskId, goal: task.goal, successCondition: task.successCondition, nonGoals: [`changing any file other than ${task.files.join(", ")}`] },
    context: { repoPath: repo, targetPaths: task.files, relevantDocs: [], buildTestCommands: [task.check], constraints: [] },
    executionPolicy: { autonomyLevel: "L2", maxAttempts: 1, perAttemptTimeoutMs: 420_000, totalRuntimeBudgetMs: 600_000, tokenBudget: taskTokens, worktreeRequired: true, partialOutcomeRecoveryWindowMs: 1_000 },
    safetyPolicy: { allowlistPaths: [], denylistPaths: [], maxFilesTouched: task.files.length, humanGateConditions: [] },
    verification: { verifierType: "agent", requiredChecks: [task.check], rejectOn: ["failure"], evidenceRequired: [] },
    escalationAndExit: { escalationTargets: [], pauseOn: [], stopOn: [], terminalStates: ["succeeded", "blocked_waiting_human", "exhausted", "cancelled", "failed"] },
  };
  const contractPath = join(root, `contract-${task.taskId}.json`);
  await writeFile(contractPath, canonicalBytes(contract));
  planTasks.push({ taskId: task.taskId, contract: contractPath, dependsOn: [], targetVersion: 1 });
}
// The trusted control config requires the plan file inside its repository (controlConfig.ts, control-path-escape).
const planPath = join(repo, "plan.json");
await writeFile(planPath, JSON.stringify({ targetRepo: repo, ccloopBin, runsDir: join(root, "unused-runs"), workBranch: "orca/unused", policy: "local-merge", ledgerMode: "out-of-repo", goal: "live acceptance", successConditions: tasks.map((task) => task.successCondition), tasks: planTasks }));

// The shipped ccloop's capability answer; a null context window makes the estimate blocked-capability (spec §11 D1).
const profilePath = join(root, "profile.json");
await writeFile(profilePath, JSON.stringify({
  schema: "orca-execution-profile-snapshot-v2",
  profile: { profileId: "all", allowedWorkKinds: ["budget-estimate", "goal-review", "handoff", "task"], contextTokenizer: null, workMaxOutputTokens: 1000,
    capabilities: { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null },
    estimatorPreflight: { instructionVersion: "1", schemaVersion: "budget-estimate-v1", maxOutputTokens: 64_000, framingTokenOverhead: 17, tokenizer: { kind: "utf8-upper-bound", numerator: 2, denominator: 3, proofRef: "proof" } } },
  resolved: { proofDocumentContentHashes: ["c".repeat(64)], tokenizerArtifactHashes: [], secretValueHashes: [] },
}));

const orcaHome = join(homedir(), ".orca");
const orcaHomeBefore = snapshot(orcaHome);
// Only the entries directly under ~/.claude/projects: claude's own session files elsewhere may legitimately move.
const claudeProjects = join(homedir(), ".claude", "projects");
const claudeProjectsList = (): string[] => existsSync(claudeProjects) ? readdirSync(claudeProjects).sort() : ["<absent>"];
const claudeProjectsBefore = claudeProjectsList();
const human = () => ({ symbolic: g(repo, "symbolic-ref", "HEAD"), head: g(repo, "rev-parse", "HEAD"), index: sha256(join(repo, ".git", "index")), status: g(repo, "status", "--porcelain") });
const humanBefore = human();

const repoId = controlRepoKey("live");
const repos = [{ projectKey: "live", path: repo }];
const env: NodeJS.ProcessEnv = { ORCA_CONTROL_DIR: join(root, "control"), ORCA_CORRECTIONS_DIR: join(root, "corrections"), ORCA_CCLOOP_BIN: ccloopBin, ORCA_AGENTS_TABLE: tablePath };
process.env.ORCA_CORRECTIONS_DIR = env.ORCA_CORRECTIONS_DIR;
const { rejection, ...control } = resolveControlOptions(["--plan", `plan=${repoId}=${planPath}`, "--profile", profilePath, "--estimator-profile", "all", "--estimate-mode", "soft", "--control-wake-ms", "200"], env, repos);
if (rejection !== null) throw new Error(rejection);

const raw = (runtime: ControlRuntime, commandId: string, verb: string, payload: unknown, target: unknown = { kind: "group", groupId: "g" }) => ({
  schema: "orca-raw-command-v1", commandId, actorId: "human", verb, target, payload,
  expectedRevision: verb === "import-plan" || verb === "set-agent-preferences" ? 0 : Number(runtime.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision),
}) as never;
const workRuns = (runtime: ControlRuntime) => runtime.store.db.prepare("SELECT id,work_item_id,body FROM runs WHERE group_id='g' ORDER BY id").all()
  .map((row) => ({ runId: String(row.id), task: String(row.work_item_id), body: JSON.parse(String(row.body)) })).filter((row) => row.body.phase === "work");
const workItem = (runtime: ControlRuntime, taskId: string) =>
  JSON.parse(String(runtime.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body));
const allDone = (runtime: ControlRuntime): boolean => taskIds.every((id) => workItem(runtime, id).status === "done");

const blocked = (runtime: ControlRuntime): boolean => workRuns(runtime).some((run) => run.body.state === "blocked");
const settledAll = (runtime: ControlRuntime): boolean => {
  const runs = workRuns(runtime);
  return allDone(runtime) && runs.length > 0 && runs.every((run) => run.body.drive?.cleanedUp === true);
};
const requestState = (runtime: ControlRuntime, requestId: string): string =>
  String(runtime.store.db.prepare("SELECT state FROM handoff_requests WHERE id=?").get(requestId)!.state);
/** deadline: the first work run's execute observation, once it holds a closed message (D1's `inExecute`, observed instead of scripted). */
const closedObservation = (): { path: string; total: unknown } | null => {
  for (const path of findEvidence("observed-usage.json").filter((file) => /\/claude\/1\/execute\/call-[^/]+\/observed-usage\.json$/.test(file))) {
    try {
      const observed = JSON.parse(readFileSync(path, "utf8")) as { openMessage?: unknown; total?: unknown };
      if (observed.openMessage === false) return { path, total: observed.total };
    } catch { /* written by rename, but a foreign or partial file is simply not yet the answer */ }
  }
  return null;
};

const checks: Record<string, boolean> = {};
const summary: Record<string, unknown> = { mode: isFake ? "fake" : "live", kind, scenario, contextWindow: contextWindow ?? null, agents: null as unknown, groupTokens, taskTokens, taskAttempts, activeMs, deadlineMs, installationCommand: installation.command, installationVersion: installation.version, startedAt: new Date().toISOString(), root };
const runtime = await assembleControlRuntime({ control, repos, epoch: "epoch-live-1", env });
if (runtime === null) throw new Error("the control plane did not assemble");
const runsRoot = `${runtime.store.stateDir}.runs`;
// A reconciliation's `ccloop run` keeps its evidence (and registers its process groups) under the workspaces dir,
// not the runs dir; every count and the watchdog below cover both.
const evidenceRoots = [runsRoot, `${runtime.store.stateDir}.workspaces`];
const findEvidence = (name: string): string[] => evidenceRoots.flatMap((dir) => findAll(dir, name));
let timedOut = false;
let firstRunId: string | null = null;
let observedPath: string | null = null;
let handoffState: string | null = null;
try {
  await runtime.recover();
  const imported = await runtime.service.importPlan(raw(runtime, "import", "import-plan", { groupId: "g", repoId, planId: "plan" }));
  summary.imported = imported;
  // Agent selection spec §6.2 layer 1: the operator's default is the table's codex installation, with --model when live.
  const preferences = await runtime.service.setAgentPreferences(raw(runtime, "preferences", "set-agent-preferences",
    { preferences: { defaultAgent: kind, perAgent: { [kind]: { ...(isFake ? {} : { model: args.model! }), ...(contextWindow === undefined ? {} : { contextWindow }) } } } }, { kind: "operator", operatorId: "human" }));
  if ("error" in preferences) throw new Error(`set-agent-preferences refused: ${JSON.stringify(preferences.error)}`);
  // A blocked-capability estimate leaves complex-1m-default allocations (task work 3M tokens, 3 attempts), and
  // confirm derives the contract's tokenBudget/maxAttempts/totalRuntimeBudgetMs from them, overriding the
  // contract's own. So the caps go in here, before confirm, as a human's proposal-edit -- the Web path.
  // Nothing in src/ starts a goal-review run; its allocation only holds reserve, so it is squeezed to 1.
  const dims = (taskId: string, allocation: "work" | "handoff", values: Record<string, number>) =>
    Object.entries(values).map(([dimension, value]) => ({ target: { scope: "task", taskId, allocation, dimension }, value, provenance: "human" }));
  const edited = runtime.service.editProposal(raw(runtime, "caps", "proposal-edit", {
    baseProposalVersion: readBudgetProposal(runtime.store, "g").proposalVersion,
    operations: [
      ...taskIds.flatMap((id) => [...dims(id, "work", { tokens: taskTokens, attempts: taskAttempts, sessions: taskAttempts, activeMs }), ...dims(id, "handoff", { tokens: 0 })]),
      { target: { scope: "goal-review", dimension: "tokens" }, value: 1, provenance: "human" },
    ],
    proposedGroupLimit: { ...readBudgetProposal(runtime.store, "g").groupLimit, tokens: groupTokens },
  }));
  if ("error" in edited) throw new Error(`proposal-edit refused: ${JSON.stringify(edited.error)}`);
  const hash = runtime.router.list()[0]!.profileHash;
  // Spec §6.4: confirmation freezes ccloop's answer for the selections this preview resolved.
  const selections = await resolveGroupSelections({ store: runtime.store, port: runtime.port }, "g", "human");
  const confirmed = await runtime.service.confirm(raw(runtime, "confirm", "confirm", {
    planHash: readArchivedPlan(runtime.store, "g").planHash, proposalVersion: readBudgetProposal(runtime.store, "g").proposalVersion, budgetMode: "soft",
    profileIds: { estimator: "all", worker: "all", handoff: "all", goalReview: "all" }, profileHashes: { estimator: hash, worker: hash, handoff: hash, goalReview: hash },
    contextPolicy: { handoffAtContextTokens: null }, selectionsHash: selections.selectionsHash,
  }));
  if ("error" in confirmed) throw new Error(`confirm refused: ${JSON.stringify(confirmed.error)}`);
  summary.agents = Object.fromEntries(taskIds.map((id) => [id, workItem(runtime, id).agent]));
  summary.confirmedLedger = readControlGroup(runtime.store, runtime.epoch, "g").ledger;
  summary.proposal = readBudgetProposal(runtime.store, "g");
  const started = await runtime.service.start(raw(runtime, "start", "start", {}));
  if ("error" in started) throw new Error(`start refused: ${JSON.stringify(started.error)}`);
  runtime.startPump(200);

  const deadline = Date.now() + deadlineMs;
  /** Polls `done` until it holds (true), a run is blocked or the work already settled (false), or the watchdog fires. */
  const waitFor = async (done: () => boolean, pollMs: number): Promise<boolean> => {
    for (;;) {
      if (done()) return true;
      if (blocked(runtime) || settledAll(runtime)) return false;
      if (Date.now() > deadline) { timedOut = true; return false; }
      await new Promise((r) => setTimeout(r, pollMs));
    }
  };
  let settle = true;
  if (scenario === "deadline") {
    settle = false;
    // Stop only once claude has closed a message inside execute, so the cut phase has usage to report.
    if (await waitFor(() => closedObservation() !== null, 200)) {
      const observed = closedObservation()!;
      observedPath = observed.path;
      firstRunId = workRuns(runtime)[0]!.runId;
      const stopAt = Date.now();
      summary.stopAt = { at: new Date(stopAt).toISOString(), observedTotal: observed.total, observedPath: observed.path, runId: firstRunId };
      const stopped = await runtime.service.handoffStop(raw(runtime, "stop", "handoff-stop", { handoffDeadlineAt: new Date(stopAt + 2_000).toISOString() }));
      if ("error" in stopped || stopped.result.kind !== "handoff-stopped") throw new Error(`handoff-stop refused: ${JSON.stringify(stopped)}`);
      const [requestId] = stopped.result.requestIds;
      summary.handoffRequestIds = stopped.result.requestIds;
      if (requestId !== undefined) {
        await waitFor(() => ["settled-recoverable", "settled-unrecoverable", "outcome-unknown"].includes(requestState(runtime, requestId)), 200);
        handoffState = requestState(runtime, requestId);
        summary.handoffRequestState = handoffState;
        summary.handoffSettledMs = Date.now() - stopAt;
      }
      if (handoffState === "settled-recoverable") {
        // The panel's rule (web/src/ControlGroupView.tsx `continuableRuns`), as D1's panelSelections applies it.
        const view = readControlGroup(runtime.store, runtime.epoch, "g");
        const selections = view.runs.flatMap((run) => {
          if (run.taskId === null || run.continuable !== true) return [];
          const checkpoint = view.checkpoints.find((candidate) => candidate.runId === run.runId && candidate.state !== "unknown");
          return checkpoint ? [{ taskId: run.taskId, predecessorRunId: run.runId, checkpointId: checkpoint.checkpointId }] : [];
        });
        summary.resumeSelections = selections;
        const resumed = await runtime.service.resumeFromHandoff(raw(runtime, "resume", "resume-from-handoff", { selections }));
        summary.resumed = "error" in resumed ? resumed.error : resumed.result.kind;
        settle = !("error" in resumed);
      }
    }
  }
  if (settle) await waitFor(() => false, 1000);
} finally {
  summary.shutdown = await runtime.shutdown().catch((e: unknown) => `threw: ${String(e)}`);
  // Outer watchdog: whatever the ending, no codex process group ccloop registered may outlive this script.
  const killed: number[] = [];
  for (const file of findEvidence("process.json")) {
    const { pgid } = JSON.parse(readFileSync(file, "utf8")) as { pgid: number };
    try { process.kill(-pgid, "SIGKILL"); killed.push(pgid); } catch { /* already gone */ }
  }
  summary.killedProcessGroups = killed;
}

const runs = workRuns(runtime);
summary.runs = runs.map((run) => ({ runId: run.runId, task: run.task, state: run.body.state, drive: run.body.drive }));
const ledger = readControlGroup(runtime.store, runtime.epoch, "g").ledger;
summary.ledger = ledger;
const delivered = (id: string): unknown => runtime.store.db.prepare("SELECT delivered FROM outbox WHERE id=?").get(id);

// Usage copied from ccloop's retained evidence. codex: the turn.completed row of each provider call. claude: the
// runner's answer in stdout.json, whose tokenUsage is input + output as ccloop books it; a call cut before it answered
// (no tokenUsage) books what the runner observed in the stream, observed-usage.json's total (Orca claude stream usage
// (2026-09-27), spec §6.4), marked `observed`. `aborted` and `endedAt` come from ccloop's outcome.json, so the
// deadline scenario can order the continuation after the cut.
type Call = { role: string; phase: string; file: string; usage: unknown; total: number | null; observed?: boolean; aborted?: boolean; endedAt?: number };
const calls: Call[] = kind === "codex"
  ? findEvidence("events.jsonl").filter((file) => file.includes("/codex/")).map((file) => {
    const completed = readFileSync(file, "utf8").split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((row) => row.type === "turn.completed");
    const usage = completed.at(-1)?.usage ?? null;
    const phase = file.split("/codex/")[1]!.split("/")[1]!;
    return { role: file.includes("/reconcile-") ? "reconcile" : "worker", phase, file, usage, total: usage === null ? null : Number(usage.input_tokens) + Number(usage.output_tokens) };
  })
  : findEvidence("stdout.json").filter((file) => file.includes("/claude/")).map((file) => {
    const text = readFileSync(file, "utf8");
    let answer: { tokenUsage?: number; usageEvidence?: unknown } | null = null;
    try { answer = text.trim() === "" ? null : JSON.parse(text); } catch { answer = null; }
    const phase = file.split("/claude/")[1]!.split("/")[1]!;
    const dir = dirname(file);
    const outcomePath = join(dir, "outcome.json");
    const outcome = existsSync(outcomePath) ? JSON.parse(readFileSync(outcomePath, "utf8")) as { reason?: string } : null;
    const base = { role: file.includes("/reconcile-") ? "reconcile" : "worker", phase, file, aborted: outcome?.reason === "aborted", endedAt: existsSync(outcomePath) ? statSync(outcomePath).mtimeMs : undefined };
    if (typeof answer?.tokenUsage === "number") return { ...base, usage: answer.usageEvidence ?? null, total: answer.tokenUsage, observed: false };
    let observed: { total?: unknown } | null = null;
    try { observed = JSON.parse(readFileSync(join(dir, "observed-usage.json"), "utf8")); } catch { observed = null; }
    return { ...base, usage: observed, total: typeof observed?.total === "number" ? observed.total : null, observed: observed !== null };
  });
// Claude's own report per call (scripts/claude-tee.mjs): dollars and cache counts ccloop does not keep. The kept
// output is stream-json NDJSON; the envelope is its LAST `type: "result"` line. A call with none (cut before it
// answered) reported no dollars: it is kept as aborted with a null cost, never estimated.
type Envelope = { type?: string; total_cost_usd?: number; usage?: Record<string, unknown>; modelUsage?: unknown; is_error?: boolean; subtype?: string; num_turns?: number; duration_ms?: number };
const rawClaude = existsSync(claudeRaw) ? readdirSync(claudeRaw).filter((name) => !name.endsWith(".argv.json")).sort().map((name) => {
  const events = readFileSync(join(claudeRaw, name), "utf8").split("\n").flatMap((line): Envelope[] => {
    try { const event = JSON.parse(line) as unknown; return event !== null && typeof event === "object" && !Array.isArray(event) ? [event as Envelope] : []; } catch { return []; }
  });
  const envelope = events.filter((event) => event.type === "result").at(-1);
  if (envelope === undefined) return { name, aborted: true, totalCostUsd: null, lines: events.length };
  return { name, aborted: false, subtype: envelope.subtype ?? null, isError: envelope.is_error ?? null, totalCostUsd: envelope.total_cost_usd ?? null, usage: envelope.usage ?? null, modelUsage: envelope.modelUsage ?? null, numTurns: envelope.num_turns ?? null, durationMs: envelope.duration_ms ?? null };
}) : [];
summary.claudeRawCalls = rawClaude;
// The --model each claude call actually received, from the tee's argv files (the agent's own record, not Orca's).
const claudeModels = existsSync(claudeRaw) ? readdirSync(claudeRaw).filter((name) => name.endsWith(".argv.json")).sort().map((name) => {
  const argv = JSON.parse(readFileSync(join(claudeRaw, name), "utf8")) as string[];
  const index = argv.indexOf("--model");
  return index < 0 ? null : argv[index + 1] ?? null;
}) : [];
summary.claudeArgvModels = claudeModels;
// The sum over the calls that reported a cost -- null, not zero, when none did (fake modes) -- and how many did not.
const costed = rawClaude.filter((call) => typeof call.totalCostUsd === "number");
summary.claudeReportedUsd = costed.length > 0 ? costed.reduce((sum, call) => sum + Number(call.totalCostUsd), 0) : null;
summary.claudeCallsWithoutCost = rawClaude.length - costed.length;
summary.providerCalls = calls;
const ccloopTotal = calls.reduce((sum, call) => sum + (call.total ?? 0), 0);
summary.ccloopReportedTokens = ccloopTotal;

// The spend cap as ccloop itself received it, not as Orca meant it.
const policies = findEvidence("loop-contract.json").map((file) => JSON.parse(readFileSync(file, "utf8")).executionPolicy);
summary.ccloopExecutionPolicies = policies;
// Every contract ccloop received -- the reconciliation's included -- is within the per-task cap.
checks.ccloopPolicyCapped = policies.length >= taskIds.length && policies.every((policy) => policy.tokenBudget <= taskTokens && policy.maxAttempts <= taskAttempts);
checks.notTimedOut = !timedOut;
// deadline: the cut run parks settled-recoverable (D1); every other run -- the continuation -- settles.
checks.runSettled = runs.length >= taskIds.length && runs.every((run) => run.body.state === (run.runId === firstRunId ? "settled-recoverable" : "settled"));
checks.workDone = allDone(runtime);
checks.cleanedUp = runs.length > 0 && runs.every((run) => run.body.drive?.cleanedUp === true);
const landedFiles = tasks[0]!.files;
const landedOf = (file: string): string | null => {
  try { return execFileSync("git", ["show", `refs/heads/orca/g:${file}`], { cwd: repo, encoding: "utf8" }); } catch { return null; }
};
const landed = landedOf(landedFiles[0]!);
summary.landedContent = scenario === "deadline" ? Object.fromEntries(landedFiles.map((file) => [file, landedOf(file)])) : landed;
// conflict: the base line first, then A and B in either order, nothing else (a reconciliation leaving markers is refused by Orca).
checks.landedBytes = scenario === "single" ? landed === "42\n"
  : scenario === "deadline" ? landedFiles.every((file) => landedOf(file) === numberFiles[file])
  : landed !== null && ["base\nA\nB\n", "base\nB\nA\n"].includes(landed);
checks.onlyTargetChanged = (() => { try { return g(repo, "diff", "--name-only", "main", "refs/heads/orca/g") === [...landedFiles].sort().join("\n"); } catch { return false; } })();
const reconciled = runs.filter((run) => run.body.drive?.reconcile != null);
summary.reconciled = reconciled.map((run) => ({ runId: run.runId, task: run.task, reconcile: run.body.drive.reconcile }));
checks.reconciledAsExpected = scenario !== "conflict" ? reconciled.length === 0 : reconciled.length === 1 && reconciled[0]!.body.drive.reconcile.outcome === "succeeded";
checks.humanUntouched = JSON.stringify(human()) === JSON.stringify(humanBefore);
checks.dispatchNotBlocked = runtime.store.dispatchBlocked === false;
// deadline: the run parked recoverable publishes no projection or task handoff for its checkpoint (the continuation's
// landing does), so for it only the publish error is checked.
checks.published = runs.length > 0 && runs.every((run) => run.body.drive?.publishError === null && (run.runId === firstRunId
  || JSON.stringify(delivered(`projection:${run.body.checkpointId}`)) === JSON.stringify({ delivered: 1 }))
  && (run.runId === firstRunId || JSON.stringify(delivered(`task-handoff:g:${run.task}:${run.body.checkpointId}`)) === JSON.stringify({ delivered: 1 })));
// Workers: plan, execute, verify per task. The reconciliation: none in single, at least one call in conflict (its
// phases are recorded, not predicted).
const phasesOf = (role: string) => calls.filter((call) => call.role === role).map((call) => call.phase).sort();
if (scenario === "deadline") {
  // Recorded, not predicted: at least one execute was cut, and after the (first) cut a plan, an execute and a verify ran.
  const workers = calls.filter((call) => call.role === "worker");
  const cut = workers.filter((call) => call.phase === "execute" && call.aborted === true).map((call) => call.endedAt ?? Infinity).sort((x, y) => x - y)[0];
  const after = new Set(workers.filter((call) => cut !== undefined && call.aborted !== true && (call.endedAt ?? -Infinity) > cut).map((call) => call.phase));
  checks.providerCalls = cut !== undefined && ["plan", "execute", "verify"].every((phase) => after.has(phase)) && phasesOf("reconcile").length === 0;
} else {
  checks.providerCalls = JSON.stringify(phasesOf("worker")) === JSON.stringify(taskIds.flatMap(() => ["execute", "plan", "verify"]).sort())
    && (scenario === "single" ? phasesOf("reconcile").length === 0 : phasesOf("reconcile").length > 0);
}
if (scenario === "deadline") {
  // The execute the stop was aimed at did not finish: ccloop's own outcome for that call says it was aborted.
  const outcomePath = observedPath === null ? null : join(dirname(observedPath), "outcome.json");
  checks.executeWasCut = outcomePath !== null && existsSync(outcomePath) && JSON.parse(readFileSync(outcomePath, "utf8")).reason === "aborted";
  // What Orca booked for the cut run (D1): every work usage event known, and the last above the first.
  const workUsage = firstRunId === null ? [] : runtime.store.db.prepare("SELECT body FROM usage_events WHERE run_id=? ORDER BY seq").all(firstRunId)
    .map((row) => JSON.parse(String(row.body)) as { bucket: string; cumulative: { tokens: number } | null })
    .filter((event) => event.bucket === "work");
  summary.firstRunWorkUsage = workUsage;
  checks.observedUsageBooked = workUsage.length >= 2 && workUsage.every((event) => event.cumulative !== null)
    && workUsage.at(-1)!.cumulative!.tokens > workUsage[0]!.cumulative!.tokens;
  checks.requestRecoverable = handoffState === "settled-recoverable";
  const parked = firstRunId === null ? null : readDriverRun(runtime.store, firstRunId) as unknown as { unknown?: { work?: unknown } };
  checks.unknownWorkFalse = parked?.unknown?.work === false;
}
checks.everyCallHasUsage = calls.length > 0 && calls.every((call) => call.total !== null && call.total > 0);
checks.ledgerKnown = ledger.usageUnknown === false;
checks.ledgerMatchesCcloop = ledger.used.tokens === ccloopTotal;
checks.orcaHomeUntouched = JSON.stringify(snapshot(orcaHome)) === JSON.stringify(orcaHomeBefore);
checks.claudeProjectsUntouched = JSON.stringify(claudeProjectsList()) === JSON.stringify(claudeProjectsBefore);
if (kind === "claude") {
  // Each claude call's --model is what the frozen selection spells: `<model>[1m]` exactly when the window is 1M.
  const expected = (m: string) => contextWindow === 1_000_000 ? `${m}[1m]` : m;
  const models = Object.values(summary.agents as Record<string, { model: string }>).map((agent) => expected(agent.model));
  checks.claudeArgvModel = claudeModels.length > 0 && claudeModels.length === rawClaude.length && claudeModels.every((model) => model !== null && models.includes(model));
}
if (fake && scenario === "single") checks.fakeCallsExact = existsSync(`${marker}.calls`) && readFileSync(`${marker}.calls`, "utf8").trim().split("\n").join(",") === "plan,execute,verify";
if (fakeClaude && scenario === "single") checks.fakeCallsExact = existsSync(`${marker}.tasks`) && readFileSync(`${marker}.tasks`, "utf8").trim().split("\n").map((line) => line.split(" ")[0]).join(",") === "plan,execute,verify";
if (isFake) summary.fakeScripted = existsSync(`${marker}.tasks`) ? readFileSync(`${marker}.tasks`, "utf8").trim().split("\n") : null;
checks.shutdownClean = summary.shutdown === true;

summary.checks = checks;
summary.finishedAt = new Date().toISOString();
runtime.close();
await writeFile(join(root, "summary.json"), JSON.stringify(summary, null, 2), { mode: 0o600 });
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
console.log(JSON.stringify({ summary: join(root, "summary.json"), ccloopReportedTokens: ccloopTotal, ledgerUsedTokens: ledger.used.tokens, claudeReportedUsd: summary.claudeReportedUsd ?? null, failed }, null, 2));
process.exit(failed.length === 0 ? 0 : 1);
