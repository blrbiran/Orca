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
//          (--codex <abs codex binary> --model <name> | --fake)
//          [--group-tokens 300000] [--task-tokens 150000] [--deadline-ms 900000]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { canonicalBytes } from "../src/control/canonicalJson.js";
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
if (fake === (args.codex !== undefined)) throw new Error("give exactly one of --codex <abs path> --model <name>, or --fake");
if (!fake && (!isAbsolute(args.codex!) || !args.model)) throw new Error("--codex must be absolute and --model is required");
if (existsSync(output)) throw new Error(`refusing an existing --output ${output}`);
const groupTokens = Number(args["group-tokens"] ?? 300_000);
const taskTokens = Number(args["task-tokens"] ?? 150_000);
const deadlineMs = Number(args["deadline-ms"] ?? 900_000);

const g = (cwd: string, ...rest: string[]): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...rest], { cwd, encoding: "utf8" }).trim();
const sha256 = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

/** ccloop's canonicalHash (ccloop src/control/protocol.ts): keys sorted by localeCompare, JSON, sha256. */
function ccloopHash(value: unknown): string {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical)
    : item !== null && typeof item === "object"
      ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([l], [r]) => l.localeCompare(r)).map(([k, v]) => [k, canonical(v)]))
      : item;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
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
g(repo, "commit", "-qm", "base");

const marker = join(root, "codex-marker.json");
const scriptPath = join(root, "codex-script.json");
await writeFile(scriptPath, JSON.stringify({ a: { files: { "answer.txt": "42\n" } } }));
const fakeCodex = resolve(dirname(ccloopBin), "..", "tests", "fixtures", "fake-codex.mjs");
const adapter = fake
  ? { command: [process.execPath, fakeCodex, "script", marker, scriptPath], model: "fixture-model", budgetMode: "soft", sandbox: "workspace-write", timeoutMs: 120_000, killGraceMs: 5_000 }
  : { command: [args.codex!], model: args.model!, budgetMode: "soft", sandbox: "workspace-write", timeoutMs: 120_000, killGraceMs: 5_000 };
const adapterPath = join(root, "adapter.json");
await writeFile(adapterPath, JSON.stringify(adapter), { mode: 0o600 });

const check = 'test "$(cat answer.txt)" = 42';
const contract = {
  objective: { taskId: "a", goal: "Create a file named answer.txt at the repository root whose entire content is the characters 42 followed by one newline. Change no other file.", successCondition: "answer.txt holds exactly 42 and a newline", nonGoals: ["changing any file other than answer.txt"] },
  context: { repoPath: repo, targetPaths: ["answer.txt"], relevantDocs: [], buildTestCommands: [check], constraints: [] },
  executionPolicy: { autonomyLevel: "L2", maxAttempts: 1, perAttemptTimeoutMs: 420_000, totalRuntimeBudgetMs: 600_000, tokenBudget: taskTokens, worktreeRequired: true, partialOutcomeRecoveryWindowMs: 1_000 },
  safetyPolicy: { allowlistPaths: [], denylistPaths: [], maxFilesTouched: 1, humanGateConditions: [] },
  verification: { verifierType: "agent", requiredChecks: [check], rejectOn: ["failure"], evidenceRequired: [] },
  escalationAndExit: { escalationTargets: [], pauseOn: [], stopOn: [], terminalStates: ["succeeded", "blocked_waiting_human", "exhausted", "cancelled", "failed"] },
};
const contractPath = join(root, "contract-a.json");
await writeFile(contractPath, canonicalBytes(contract));
// The trusted control config requires the plan file inside its repository (controlConfig.ts, control-path-escape).
const planPath = join(repo, "plan.json");
await writeFile(planPath, JSON.stringify({ targetRepo: repo, ccloopBin, runsDir: join(root, "unused-runs"), workBranch: "orca/unused", policy: "local-merge", ledgerMode: "out-of-repo", goal: "live acceptance", successConditions: ["answer.txt holds 42"], tasks: [{ taskId: "a", contract: contractPath, dependsOn: [], targetVersion: 1, configHash: ccloopHash(adapter) }] }));

// The shipped ccloop's capability answer; a null context window makes the estimate blocked-capability (spec §11 D1).
const profilePath = join(root, "profile.json");
await writeFile(profilePath, JSON.stringify({
  schema: "orca-execution-profile-snapshot-v1",
  profile: { profileId: "all", allowedWorkKinds: ["budget-estimate", "goal-review", "handoff", "task"], adapter: "codex", adapterConfigRef: "adapter", modelPolicyRef: "policy", contextTokenizer: null, workMaxOutputTokens: 1000,
    capabilities: { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null },
    estimatorPreflight: { instructionVersion: "1", schemaVersion: "budget-estimate-v1", maxOutputTokens: 64_000, framingTokenOverhead: 17, tokenizer: { kind: "utf8-upper-bound", numerator: 2, denominator: 3, proofRef: "proof" } } },
  resolved: { adapterConfigContentHash: "a".repeat(64), modelPolicyContentHash: "b".repeat(64), proofDocumentContentHashes: ["c".repeat(64)], adapterImplementationHash: "d".repeat(64), adapterProtocolVersion: "1", tokenizerArtifactHashes: [], secretValueHashes: [] },
}));

const orcaHome = join(homedir(), ".orca");
const orcaHomeBefore = snapshot(orcaHome);
const human = () => ({ symbolic: g(repo, "symbolic-ref", "HEAD"), head: g(repo, "rev-parse", "HEAD"), index: sha256(join(repo, ".git", "index")), status: g(repo, "status", "--porcelain") });
const humanBefore = human();

const repoId = controlRepoKey("live");
const repos = [{ projectKey: "live", path: repo }];
const env: NodeJS.ProcessEnv = { ORCA_CONTROL_DIR: join(root, "control"), ORCA_CORRECTIONS_DIR: join(root, "corrections"), ORCA_CCLOOP_BIN: ccloopBin, ORCA_CCLOOP_ADAPTER_CONFIG: adapterPath };
process.env.ORCA_CORRECTIONS_DIR = env.ORCA_CORRECTIONS_DIR;
const { rejection, ...control } = resolveControlOptions(["--plan", `plan=${repoId}=${planPath}`, "--profile", profilePath, "--estimator-profile", "all", "--estimate-mode", "soft", "--control-wake-ms", "200"], env, repos);
if (rejection !== null) throw new Error(rejection);

const raw = (runtime: ControlRuntime, commandId: string, verb: string, payload: unknown) => ({
  schema: "orca-raw-command-v1", commandId, actorId: "human", verb, target: { kind: "group", groupId: "g" }, payload,
  expectedRevision: verb === "import-plan" ? 0 : Number(runtime.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision),
}) as never;
const workRun = (runtime: ControlRuntime) => runtime.store.db.prepare("SELECT id,body FROM runs WHERE group_id='g' ORDER BY id").all()
  .map((row) => ({ runId: String(row.id), body: JSON.parse(String(row.body)) })).find((row) => row.body.phase === "work");
const workStatus = (runtime: ControlRuntime): string =>
  JSON.parse(String(runtime.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body)).status;

const checks: Record<string, boolean> = {};
const summary: Record<string, unknown> = { mode: fake ? "fake" : "live", model: adapter.model, groupTokens, taskTokens, deadlineMs, startedAt: new Date().toISOString(), root };
const runtime = await assembleControlRuntime({ control, repos, epoch: "epoch-live-1", env });
if (runtime === null) throw new Error("the control plane did not assemble");
const runsRoot = `${runtime.store.stateDir}.runs`;
let timedOut = false;
try {
  await runtime.recover();
  const imported = await runtime.service.importPlan(raw(runtime, "import", "import-plan", { groupId: "g", repoId, planId: "plan" }));
  summary.imported = imported;
  // A blocked-capability estimate leaves complex-1m-default allocations (task work 3M tokens, 3 attempts), and
  // confirm derives the contract's tokenBudget/maxAttempts/totalRuntimeBudgetMs from them, overriding the
  // contract's own. So the caps go in here, before confirm, as a human's proposal-edit -- the Web path.
  // Nothing in src/ starts a goal-review run; its allocation only holds reserve, so it is squeezed to 1.
  const dims = (taskId: string, allocation: "work" | "handoff", values: Record<string, number>) =>
    Object.entries(values).map(([dimension, value]) => ({ target: { scope: "task", taskId, allocation, dimension }, value, provenance: "human" }));
  const edited = runtime.service.editProposal(raw(runtime, "caps", "proposal-edit", {
    baseProposalVersion: readBudgetProposal(runtime.store, "g").proposalVersion,
    operations: [
      ...dims("a", "work", { tokens: taskTokens, attempts: 1, sessions: 1, activeMs: 600_000 }),
      ...dims("a", "handoff", { tokens: 0 }),
      { target: { scope: "goal-review", dimension: "tokens" }, value: 1, provenance: "human" },
    ],
    proposedGroupLimit: { ...readBudgetProposal(runtime.store, "g").groupLimit, tokens: groupTokens },
  }));
  if ("error" in edited) throw new Error(`proposal-edit refused: ${JSON.stringify(edited.error)}`);
  const hash = runtime.router.list()[0]!.profileHash;
  const confirmed = runtime.service.confirm(raw(runtime, "confirm", "confirm", {
    planHash: readArchivedPlan(runtime.store, "g").planHash, proposalVersion: readBudgetProposal(runtime.store, "g").proposalVersion, budgetMode: "soft",
    profileIds: { estimator: "all", worker: "all", handoff: "all", goalReview: "all" }, profileHashes: { estimator: hash, worker: hash, handoff: hash, goalReview: hash },
    contextPolicy: { handoffAtContextTokens: null },
  }));
  if ("error" in confirmed) throw new Error(`confirm refused: ${JSON.stringify(confirmed.error)}`);
  summary.confirmedLedger = readControlGroup(runtime.store, runtime.epoch, "g").ledger;
  summary.proposal = readBudgetProposal(runtime.store, "g");
  const started = await runtime.service.start(raw(runtime, "start", "start", {}));
  if ("error" in started) throw new Error(`start refused: ${JSON.stringify(started.error)}`);
  runtime.startPump(200);

  const deadline = Date.now() + deadlineMs;
  for (;;) {
    const run = workRun(runtime);
    if (run?.body.state === "blocked") break;
    if (workStatus(runtime) === "done" && run?.body.drive?.cleanedUp === true) break;
    if (Date.now() > deadline) { timedOut = true; break; }
    await new Promise((r) => setTimeout(r, 1000));
  }
} finally {
  summary.shutdown = await runtime.shutdown().catch((e: unknown) => `threw: ${String(e)}`);
  // Outer watchdog: whatever the ending, no codex process group ccloop registered may outlive this script.
  const killed: number[] = [];
  for (const file of findAll(runsRoot, "process.json")) {
    const { pgid } = JSON.parse(readFileSync(file, "utf8")) as { pgid: number };
    try { process.kill(-pgid, "SIGKILL"); killed.push(pgid); } catch { /* already gone */ }
  }
  summary.killedProcessGroups = killed;
}

const run = workRun(runtime);
summary.run = run === undefined ? null : { runId: run.runId, state: run.body.state, drive: run.body.drive };
const ledger = readControlGroup(runtime.store, runtime.epoch, "g").ledger;
summary.ledger = ledger;
const delivered = (id: string): unknown => runtime.store.db.prepare("SELECT delivered FROM outbox WHERE id=?").get(id);

// Usage copied from ccloop's retained codex evidence: the turn.completed row of each provider call.
const calls = findAll(runsRoot, "events.jsonl").filter((file) => file.includes("/codex/")).map((file) => {
  const completed = readFileSync(file, "utf8").split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((row) => row.type === "turn.completed");
  const usage = completed.at(-1)?.usage ?? null;
  const phase = file.split("/codex/")[1]!.split("/")[1]!;
  return { phase, file, usage, total: usage === null ? null : Number(usage.input_tokens) + Number(usage.output_tokens) };
});
summary.providerCalls = calls;
const ccloopTotal = calls.reduce((sum, call) => sum + (call.total ?? 0), 0);
summary.ccloopReportedTokens = ccloopTotal;

// The spend cap as ccloop itself received it, not as Orca meant it.
const policies = findAll(runsRoot, "loop-contract.json").map((file) => JSON.parse(readFileSync(file, "utf8")).executionPolicy);
summary.ccloopExecutionPolicies = policies;
checks.ccloopPolicyCapped = policies.length === 1 && policies[0].tokenBudget === taskTokens && policies[0].maxAttempts === 1;
checks.notTimedOut = !timedOut;
checks.runSettled = run?.body.state === "settled";
checks.workDone = workStatus(runtime) === "done";
checks.cleanedUp = run?.body.drive?.cleanedUp === true;
let landed: string | null = null;
try { landed = execFileSync("git", ["show", "refs/heads/orca/g:answer.txt"], { cwd: repo, encoding: "utf8" }); } catch { landed = null; }
summary.landedAnswer = landed;
checks.landedBytes = landed === "42\n";
checks.onlyAnswerChanged = (() => { try { return g(repo, "diff", "--name-only", "main", "refs/heads/orca/g") === "answer.txt"; } catch { return false; } })();
checks.humanUntouched = JSON.stringify(human()) === JSON.stringify(humanBefore);
checks.dispatchNotBlocked = runtime.store.dispatchBlocked === false;
checks.published = run !== undefined && run.body.drive?.publishError === null
  && JSON.stringify(delivered(`projection:${run.body.checkpointId}`)) === JSON.stringify({ delivered: 1 })
  && JSON.stringify(delivered(`task-handoff:g:a:${run.body.checkpointId}`)) === JSON.stringify({ delivered: 1 });
checks.threeProviderCalls = JSON.stringify(calls.map((call) => call.phase).sort()) === JSON.stringify(["execute", "plan", "verify"]);
checks.everyCallHasUsage = calls.length > 0 && calls.every((call) => call.total !== null && call.total > 0);
checks.ledgerKnown = ledger.usageUnknown === false;
checks.ledgerMatchesCcloop = ledger.used.tokens === ccloopTotal;
checks.orcaHomeUntouched = JSON.stringify(snapshot(orcaHome)) === JSON.stringify(orcaHomeBefore);
if (fake) checks.fakeCallsExact = existsSync(`${marker}.calls`) && readFileSync(`${marker}.calls`, "utf8").trim().split("\n").join(",") === "plan,execute,verify";
checks.shutdownClean = summary.shutdown === true;

summary.checks = checks;
summary.finishedAt = new Date().toISOString();
runtime.close();
await writeFile(join(root, "summary.json"), JSON.stringify(summary, null, 2), { mode: 0o600 });
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
console.log(JSON.stringify({ summary: join(root, "summary.json"), ccloopReportedTokens: ccloopTotal, ledgerUsedTokens: ledger.used.tokens, failed }, null, 2));
process.exit(failed.length === 0 ? 0 : 1);
