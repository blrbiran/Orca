// Live acceptance of the panel's HTTP path (goal.md §4 near-term item 4: "Web dispatch to a real ccloop opens a run").
// scripts/live-driver-acceptance.ts drives the same control runtime in-process, without HTTP; this one starts a real
// `orca panel` process and does every step a person does in the browser over its HTTP API, with its one-time token:
// set the operator's agent preference, import the plan, edit the proposal's caps, confirm, start -- then reads only
// the group view the page reads, until the one task lands or the watchdog fires. Exit 0 only if every check in
// `checks` holds; summary.json in --output records each check, every HTTP status, and every usage and dollar number
// copied from ccloop's evidence and claude's own result envelopes.
//
// One soft group, one task (answer.txt holds 42), one claude installation. --fake-claude runs ccloop's scripted fake
// and spends nothing; --claude runs the real claude CLI with the isolation live-driver-acceptance.ts uses (ruling
// review 2026-09-27) and claude's own per-call dollar ceiling (--call-usd). A plan, an execute and a verify are three
// calls, so the ceiling for the run is about three times --call-usd; claude enforces it, best-effort, per call.
// `usdWithinCap` checks the summed reported cost against --cap-usd after the fact.
//
// Rule 17: every Orca write goes under --output (ORCA_CONTROL_DIR, ORCA_CORRECTIONS_DIR); ~/.orca is snapshotted and
// must not change. HOME is NOT relocated for the panel: real claude reads its login from the keychain under it.
//
// usage: tsx scripts/live-panel-http-acceptance.ts --ccloop-bin <abs dist/cli.js> --output <new dir>
//          (--claude <abs claude binary> --model <name> | --fake-claude)
//          [--call-usd 0.6] [--cap-usd 2] [--deadline-ms 900000] [--task-tokens 1000000]
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { canonicalBytes } from "../src/control/canonicalJson.js";
import { controlRepoKey } from "../src/panel/controlOptions.js";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]!;
    if (!key.startsWith("--")) throw new Error(`unexpected argument ${key}`);
    if (key === "--fake-claude") { out["fake-claude"] = "1"; continue; }
    const value = argv[++i];
    if (value === undefined) throw new Error(`${key} needs a value`);
    out[key.slice(2)] = value;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const ccloopBin = args["ccloop-bin"];
const output = args.output;
if (!ccloopBin || !isAbsolute(ccloopBin) || !output) throw new Error("--ccloop-bin <absolute> and --output <new dir> are required");
const fakeClaude = args["fake-claude"] === "1";
if (fakeClaude === (args.claude !== undefined)) throw new Error("give exactly one of --claude <abs path> --model <name> or --fake-claude");
if (!fakeClaude && (!isAbsolute(args.claude!) || !args.model)) throw new Error("--claude must be absolute and --model is required");
for (const key of Object.keys(process.env)) if (key.startsWith("CLAUDE") && key !== "CLAUDE_CONFIG_DIR") delete process.env[key];
if (existsSync(output)) throw new Error(`refusing an existing --output ${output}`);
const taskTokens = Number(args["task-tokens"] ?? 1_000_000);
const deadlineMs = Number(args["deadline-ms"] ?? 900_000);
const callUsd = String(args["call-usd"] ?? "0.6");
const capUsd = Number(args["cap-usd"] ?? 2);
const groupTokens = taskTokens * 3;
const activeMs = 600_000;
// The same isolation live-driver-acceptance.ts gives the real claude call (see CLAUDE_ISOLATION there).
const CLAUDE_ISOLATION = ["--permission-mode", "acceptEdits", "--no-session-persistence", "--setting-sources", "project,local", "--strict-mcp-config", "--disable-slash-commands", "--settings", '{"autoMemoryEnabled":false}', "--max-budget-usd", callUsd];

const g = (cwd: string, ...rest: string[]): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...rest], { cwd, encoding: "utf8" }).trim();
const sha256 = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");
function versionOf(command: string[]): string {
  const printed = execFileSync(command[0]!, [...command.slice(1), "--version"], { encoding: "utf8", input: "", timeout: 10_000, killSignal: "SIGKILL" });
  const match = /\d+\.\d+\.\d+(-[\w.]+)?/.exec(printed);
  if (!match) throw new Error(`no version in ${JSON.stringify(printed)}`);
  return match[0];
}
function snapshot(dir: string): string[] {
  if (!existsSync(dir)) return ["<absent>"];
  const rows = [`. ${statSync(dir).mtimeMs}`];
  for (const rel of readdirSync(dir, { recursive: true, encoding: "utf8" }).sort()) {
    const s = statSync(join(dir, rel));
    rows.push(`${rel} ${s.isDirectory() ? "d" : s.size} ${s.mtimeMs}`);
  }
  return rows;
}
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

const marker = join(root, "claude-marker.json");
const scriptPath = join(root, "claude-script.json");
await writeFile(scriptPath, JSON.stringify({ a: { files: { "answer.txt": "42\n" } } }));
const fakeClaudeCli = resolve(dirname(ccloopBin), "..", "tests", "fixtures", "fake-claude-cli.mjs");
const claudeRaw = join(root, "claude-raw");
const claudeTee = [process.execPath, resolve(import.meta.dirname, "claude-tee.mjs"), claudeRaw];
const claudeCommand = fakeClaude
  ? [...claudeTee, process.execPath, fakeClaudeCli, "script", marker, scriptPath]
  : [...claudeTee, args.claude!, ...CLAUDE_ISOLATION];
const tablePath = join(root, "agents.json");
const installation = { kind: "claude", command: claudeCommand, version: versionOf(claudeCommand), configDir: null, timeoutMs: 600_000, killGraceMs: 5_000 };
await writeFile(tablePath, JSON.stringify({ schema: "ccloop-agents-table-v1", installations: { claude: installation } }), { mode: 0o600 });

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
const planPath = join(repo, "plan.json");
await writeFile(planPath, JSON.stringify({ targetRepo: repo, ccloopBin, runsDir: join(root, "unused-runs"), workBranch: "orca/unused", policy: "local-merge", ledgerMode: "out-of-repo", goal: "live acceptance", successConditions: [contract.objective.successCondition], tasks: [{ taskId: "a", contract: contractPath, dependsOn: [], targetVersion: 1 }] }));
// The shipped ccloop's capability answer; a null context window makes the estimate blocked-capability, so no
// estimator call is made and the three worker calls are the whole spend.
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
const claudeProjects = join(homedir(), ".claude", "projects");
const claudeProjectsList = (): string[] => existsSync(claudeProjects) ? readdirSync(claudeProjects).sort() : ["<absent>"];
const claudeProjectsBefore = claudeProjectsList();
const human = () => ({ symbolic: g(repo, "symbolic-ref", "HEAD"), head: g(repo, "rev-parse", "HEAD"), index: sha256(join(repo, ".git", "index")), status: g(repo, "status", "--porcelain") });
const humanBefore = human();

const repoId = controlRepoKey("live");
const controlDir = join(root, "control");
const orcaRoot = resolve(import.meta.dirname, "..");
const panel = spawn(join(orcaRoot, "node_modules", ".bin", "tsx"), [join(orcaRoot, "src", "cli.ts"), "panel", "--by", "live-acceptance",
  "--repo", `live=${repo}`, "--plan", `plan=${repoId}=${planPath}`, "--profile", profilePath,
  "--estimator-profile", "all", "--estimate-mode", "soft", "--control-wake-ms", "200"], {
  cwd: orcaRoot,
  env: { ...process.env, ORCA_CONTROL_DIR: controlDir, ORCA_CORRECTIONS_DIR: join(root, "corrections"), ORCA_CCLOOP_BIN: ccloopBin, ORCA_AGENTS_TABLE: tablePath },
  stdio: ["ignore", "pipe", "pipe"],
});
let panelStdout = "";
let panelStderr = "";
panel.stderr.on("data", (chunk: Buffer) => { panelStderr += chunk.toString("utf8"); });
const panelExit = new Promise<{ code: number | null; signal: string | null }>((done) => panel.on("exit", (code, signal) => done({ code, signal })));
const ready = await new Promise<{ url: string; token: string }>((done, fail) => {
  const timer = setTimeout(() => fail(new Error(`the panel did not print ready in 60 s; stderr: ${panelStderr}`)), 60_000);
  panel.stdout.on("data", (chunk: Buffer) => {
    panelStdout += chunk.toString("utf8");
    const match = /orca-panel ready url=(\S+) token=([0-9a-f]+)/.exec(panelStdout);
    if (match) { clearTimeout(timer); done({ url: match[1]!.replace(/\/$/, ""), token: match[2]! }); }
  });
  panel.on("exit", () => fail(new Error(`the panel exited before ready; stderr: ${panelStderr}`)));
});

// Every request the page would make, with the header the page sends (web/src/controlApi.ts).
const http: Array<{ method: string; path: string; status: number }> = [];
async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${ready.url}${path}`, {
    method,
    headers: { "x-orca-token": ready.token, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  http.push({ method, path, status: res.status });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function command(path: string, commandId: string, expectedRevision: number, payload: unknown): Promise<unknown> {
  const answer = await call("POST", path, { commandId, expectedRevision, payload });
  if (answer.status < 200 || answer.status >= 300) throw new Error(`POST ${path} answered ${answer.status}: ${JSON.stringify(answer.body)}`);
  return answer.body;
}
const view = async (): Promise<any> => {
  const answer = await call("GET", "/api/control/groups/g");
  if (answer.status !== 200) throw new Error(`GET the group view answered ${answer.status}: ${JSON.stringify(answer.body)}`);
  return answer.body;
};

const checks: Record<string, boolean> = {};
const summary: Record<string, unknown> = { mode: fakeClaude ? "fake" : "live", installationCommand: installation.command, installationVersion: installation.version, callUsd, capUsd, deadlineMs, taskTokens, startedAt: new Date().toISOString(), root, panelUrl: ready.url };
let timedOut = false;
let last: any = null;
let failure: string | null = null;
try {
  const imported = await command("/api/control/groups/import-plan", "import", 0, { groupId: "g", repoId, planId: "plan" });
  summary.imported = imported;
  const preferences = await call("GET", "/api/control/operator/agent-preferences");
  await command("/api/control/operator/agent-preferences", "preferences", Number(preferences.body.revision),
    { preferences: { defaultAgent: "claude", perAgent: { claude: fakeClaude ? {} : { model: args.model! } } } });
  // The caps go in as the person's proposal edit before confirm, as live-driver-acceptance.ts does: a
  // blocked-capability estimate leaves default allocations far above one small task's.
  let current = await view();
  const dims = (allocation: "work" | "handoff", values: Record<string, number>) =>
    Object.entries(values).map(([dimension, value]) => ({ target: { scope: "task", taskId: "a", allocation, dimension }, value, provenance: "human" }));
  await command("/api/control/groups/g/proposal/edit", "caps", current.summary.commandRevision, {
    baseProposalVersion: current.proposal.proposalVersion,
    operations: [...dims("work", { tokens: taskTokens, attempts: 1, sessions: 1, activeMs }), ...dims("handoff", { tokens: 0 }),
      { target: { scope: "goal-review", dimension: "tokens" }, value: 1, provenance: "human" }],
    proposedGroupLimit: { ...current.ledger.groupLimit, tokens: groupTokens },
  });
  current = await view();
  const config = (await call("GET", "/api/control/config")).body;
  const profile = config.profiles.find((candidate: { profileId: string }) => candidate.profileId === "all");
  const preview = (await call("GET", "/api/control/groups/g/agent-preview")).body;
  summary.preview = preview;
  // web/src/BudgetEditor.tsx submitConfirm, field for field.
  await command("/api/control/groups/g/confirm", "confirm", current.summary.commandRevision, {
    planHash: current.plan.planHash, proposalVersion: current.proposal.proposalVersion, budgetMode: "soft",
    profileIds: { estimator: "all", worker: "all", handoff: "all", goalReview: "all" },
    profileHashes: { estimator: profile.profileHash, worker: profile.profileHash, handoff: profile.profileHash, goalReview: profile.profileHash },
    contextPolicy: { handoffAtContextTokens: null }, selectionsHash: preview.selectionsHash,
  });
  current = await view();
  summary.agent = current.workItems[0]?.agent ?? null;
  await command("/api/control/groups/g/start", "start", current.summary.commandRevision, {});
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    last = await view();
    // A run the driver settled shows as settled-recoverable (src/panel/controlViews.ts); landing is read from git.
    const runs = (last.runs as Array<{ phase: string; state: string }>).filter((run) => run.phase === "work");
    if (last.workItems[0]?.status === "completed") break;
    if (runs.some((run) => run.state === "blocked") || last.workItems[0]?.status === "blocked") break;
    if (Date.now() > deadline) { timedOut = true; break; }
    await new Promise((r) => setTimeout(r, 2_000));
  }
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
} finally {
  // The panel's own shutdown path (SIGTERM), then the outer watchdog: no process group ccloop registered may outlive
  // this script. Survivors are recorded before they are killed.
  panel.kill("SIGTERM");
  const exited = await Promise.race([panelExit, new Promise<null>((r) => setTimeout(() => r(null), 30_000))]);
  if (exited === null) panel.kill("SIGKILL");
  summary.panelExit = exited ?? "killed after 30 s";
  const survivors: number[] = [];
  for (const file of findAll(root, "process.json")) {
    const { pgid } = JSON.parse(readFileSync(file, "utf8")) as { pgid: number };
    try { process.kill(-pgid, 0); survivors.push(pgid); process.kill(-pgid, "SIGKILL"); } catch { /* already gone */ }
  }
  summary.survivingProcessGroups = survivors;
}

summary.failure = failure;
summary.http = http;
summary.panelStderr = panelStderr;
summary.finalView = last;
const work = ((last?.runs ?? []) as Array<{ runId: string; phase: string; state: string; git?: { landedCommit: string | null } | null }>).filter((run) => run.phase === "work");

// Usage copied from ccloop's retained evidence: the claude runner's answer in each call's stdout.json.
const calls = findAll(root, "stdout.json").filter((file) => file.includes("/claude/")).map((file) => {
  let answer: { tokenUsage?: number } | null = null;
  try { answer = JSON.parse(readFileSync(file, "utf8")); } catch { answer = null; }
  return { phase: file.split("/claude/")[1]!.split("/")[1]!, file, total: typeof answer?.tokenUsage === "number" ? answer.tokenUsage : null };
});
summary.providerCalls = calls;
const ccloopTotal = calls.reduce((sum, item) => sum + (item.total ?? 0), 0);
// Claude's own report per call (scripts/claude-tee.mjs): the last `type: "result"` line of each kept stdout.
const rawNames = existsSync(claudeRaw) ? readdirSync(claudeRaw).sort() : [];
const rawClaude = rawNames.filter((name) => !name.endsWith(".argv.json")).map((name) => {
  const events = readFileSync(join(claudeRaw, name), "utf8").split("\n").flatMap((line): Array<Record<string, unknown>> => {
    try { const event = JSON.parse(line) as unknown; return event !== null && typeof event === "object" && !Array.isArray(event) ? [event as Record<string, unknown>] : []; } catch { return []; }
  });
  const envelope = events.filter((event) => event.type === "result").at(-1);
  return { name, totalCostUsd: typeof envelope?.total_cost_usd === "number" ? envelope.total_cost_usd : null, isError: envelope?.is_error ?? null, usage: envelope?.usage ?? null, numTurns: envelope?.num_turns ?? null };
});
summary.claudeRawCalls = rawClaude;
const argvModels = rawNames.filter((name) => name.endsWith(".argv.json")).map((name) => {
  const argv = JSON.parse(readFileSync(join(claudeRaw, name), "utf8")) as string[];
  const index = argv.indexOf("--model");
  return index < 0 ? null : argv[index + 1] ?? null;
});
summary.claudeArgvModels = argvModels;
const costed = rawClaude.filter((item) => item.totalCostUsd !== null);
const reportedUsd = costed.length > 0 ? costed.reduce((sum, item) => sum + item.totalCostUsd!, 0) : null;
summary.claudeReportedUsd = reportedUsd;
summary.claudeCallsWithoutCost = rawClaude.length - costed.length;
summary.ccloopReportedTokens = ccloopTotal;

const landedOf = (ref: string): string | null => {
  try { return execFileSync("git", ["show", `${ref}:answer.txt`], { cwd: repo, encoding: "utf8" }); } catch { return null; }
};
checks.noFailure = failure === null;
checks.everyRequestAnswered2xx = http.length > 0 && http.every((entry) => entry.status >= 200 && entry.status < 300);
checks.notTimedOut = !timedOut;
checks.taskCompleted = last?.workItems?.[0]?.status === "completed";
const landedCommit = work[0]?.git?.landedCommit ?? null;
checks.runLanded = work.length === 1 && work[0]!.state === "settled-recoverable" && landedCommit !== null;
summary.landedCommit = landedCommit;
checks.landedCommitHolds42 = landedCommit !== null && landedOf(landedCommit) === "42\n";
checks.workBranchHolds42 = landedOf("refs/heads/orca/g") === "42\n";
checks.onlyTargetChanged = (() => { try { return g(repo, "diff", "--name-only", "main", "refs/heads/orca/g") === "answer.txt"; } catch { return false; } })();
checks.humanUntouched = JSON.stringify(human()) === JSON.stringify(humanBefore);
checks.providerCalls = JSON.stringify(calls.map((item) => item.phase).sort()) === JSON.stringify(["execute", "plan", "verify"]);
checks.everyCallHasUsage = calls.length > 0 && calls.every((item) => item.total !== null && item.total > 0);
checks.ledgerKnown = last?.ledger?.usageUnknown === false;
checks.ledgerMatchesCcloop = last?.ledger?.used?.tokens === ccloopTotal;
checks.orcaHomeUntouched = JSON.stringify(snapshot(orcaHome)) === JSON.stringify(orcaHomeBefore);
checks.claudeProjectsUntouched = JSON.stringify(claudeProjectsList()) === JSON.stringify(claudeProjectsBefore);
checks.panelExitedOnSigterm = typeof summary.panelExit === "object" && (summary.panelExit as { code: number | null }).code === 0;
checks.noSurvivingProcessGroups = (summary.survivingProcessGroups as number[]).length === 0;
if (fakeClaude) {
  checks.fakeCallsExact = existsSync(`${marker}.tasks`) && readFileSync(`${marker}.tasks`, "utf8").trim().split("\n").map((line) => line.split(" ")[0]).join(",") === "plan,execute,verify";
} else {
  checks.claudeArgvModel = argvModels.length === 3 && argvModels.every((model) => model === args.model);
  checks.everyCallCosted = rawClaude.length === 3 && costed.length === 3;
  checks.usdWithinCap = reportedUsd !== null && reportedUsd <= capUsd;
}

summary.checks = checks;
summary.finishedAt = new Date().toISOString();
await writeFile(join(root, "summary.json"), JSON.stringify(summary, null, 2), { mode: 0o600 });
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
console.log(JSON.stringify({ summary: join(root, "summary.json"), ccloopReportedTokens: ccloopTotal, ledgerUsedTokens: last?.ledger?.used?.tokens ?? null, claudeReportedUsd: reportedUsd, failed }, null, 2));
process.exit(failed.length === 0 ? 0 : 1);
