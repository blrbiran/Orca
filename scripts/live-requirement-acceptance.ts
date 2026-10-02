// N1 spec §12.5 paid run (docs/superpowers/specs/2026-10-02-requirement-to-split-design.md): one small requirement end
// to end under real claude on a scratch repository, n = 1. Driven through the assembled control runtime -- the same
// service, wake pump and driver `orca panel` mounts, without HTTP -- as scripts/live-driver-acceptance.ts drives a
// plan group: open -> rounds (every question answered with its recommended answer, every glossary entry and ADR
// accepted: the panel's "accept all recommended") -> consensus -> split (automatic retries are the product's) ->
// accept the first draft awaiting review -> export -> estimate -> confirm the estimate's own proposal -> start ->
// land on orca/<groupId>. Exit 0 only if every check in `checks` holds; summary.json in --output records each
// check, every round's questions and answers, every draft, the landed history and claude's own total_cost_usd.
//
// This SPENDS MONEY. Caps: claude's own --max-budget-usd per call (--call-usd), the requirement's token limit (the
// product default), --max-rounds (consensus is called on the round that reaches it), the estimate's soft budget, and
// the outer --deadline-ms watchdog, which kills every process group ccloop registered.
//
// Rule 17: Orca's own writes all go under --output (ORCA_CONTROL_DIR, ORCA_CORRECTIONS_DIR); ~/.orca is snapshotted
// and must not change. HOME is NOT relocated (claude reads its OAuth login from the keychain); the installation's
// command isolates each call from the person's own Claude Code setup (CLAUDE_ISOLATION, the same arguments as
// live-driver-acceptance.ts) and every inherited CLAUDE* variable is removed first.
//
// usage: tsx scripts/live-requirement-acceptance.ts --ccloop-bin <abs dist/cli.js> --output <new dir>
//          --claude <abs claude binary> --model <name> [--call-usd 2] [--max-rounds 4] [--deadline-ms 2700000]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { resolveGroupSelections } from "../src/control/agentFreeze.js";
import { readArchivedPlan, readBudgetProposal, readEstimateRecord } from "../src/control/queries.js";
import { readDraft, readDrafts, readRequirementGroup, readRound, readRounds } from "../src/control/requirementRecords.js";
import { readCanonicalRecord } from "../src/control/snapshot.js";
import { readWebGroup } from "../src/control/webService.js";
import { assembleControlRuntime, type ControlRuntime } from "../src/panel/controlAssembly.js";
import { controlRepoKey, resolveControlOptions } from "../src/panel/controlOptions.js";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]!;
    if (!key.startsWith("--")) throw new Error(`unexpected argument ${key}`);
    const value = argv[++i];
    if (value === undefined) throw new Error(`${key} needs a value`);
    out[key.slice(2)] = value;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const { output, model } = args;
const ccloopBin = args["ccloop-bin"], claude = args.claude;
if (!ccloopBin || !isAbsolute(ccloopBin) || !output || !claude || !isAbsolute(claude) || !model) throw new Error("--ccloop-bin, --claude (absolute), --model and --output are required");
for (const key of Object.keys(process.env)) if (key.startsWith("CLAUDE") && key !== "CLAUDE_CONFIG_DIR") delete process.env[key];
if (existsSync(output)) throw new Error(`refusing an existing --output ${output}`);
const callUsd = String(args["call-usd"] ?? "2");
const maxRounds = Number(args["max-rounds"] ?? 4);
const deadlineMs = Number(args["deadline-ms"] ?? 2_700_000);
const CLAUDE_ISOLATION = ["--permission-mode", "acceptEdits", "--no-session-persistence", "--setting-sources", "project,local", "--strict-mcp-config", "--disable-slash-commands", "--settings", '{"autoMemoryEnabled":false}', "--max-budget-usd", callUsd];
const IDEA = "Add a truncate helper to textkit: it shortens a string to a maximum length and marks the cut with an ellipsis. It needs tests, like slugify has.";

const g = (cwd: string, ...rest: string[]): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...rest], { cwd, encoding: "utf8" }).trim();
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
// The scratch target: a tiny ES-module package with one helper and its node:test file.
const repo = join(root, "target");
await mkdir(join(repo, "src"), { recursive: true });
await mkdir(join(repo, "test"));
await writeFile(join(repo, "README.md"), "# textkit\n\nSmall string helpers. Run the tests with `npm test` (node:test, no dependencies).\n");
await writeFile(join(repo, "package.json"), JSON.stringify({ name: "textkit", version: "0.1.0", type: "module", scripts: { test: "node --test" } }, null, 2) + "\n");
await writeFile(join(repo, "src", "slugify.mjs"), "/** Lower-case words joined by hyphens. */\nexport function slugify(text) {\n  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, \"-\").replace(/^-+|-+$/g, \"\");\n}\n");
await writeFile(join(repo, "test", "slugify.test.mjs"), "import { test } from \"node:test\";\nimport assert from \"node:assert/strict\";\nimport { slugify } from \"../src/slugify.mjs\";\n\ntest(\"slugify joins words with hyphens\", () => {\n  assert.equal(slugify(\" Hello, World! \"), \"hello-world\");\n});\n");
g(repo, "init", "-q", "-b", "main");
g(repo, "add", "-A");
g(repo, "commit", "-qm", "textkit with slugify");
const baseCommit = g(repo, "rev-parse", "HEAD");

const claudeRaw = join(root, "claude-raw");
const claudeCommand = [process.execPath, resolve(import.meta.dirname, "claude-tee.mjs"), claudeRaw, claude, ...CLAUDE_ISOLATION];
const installation = { kind: "claude", command: claudeCommand, version: versionOf(claudeCommand), configDir: null, timeoutMs: 600_000, killGraceMs: 5_000 };
const tablePath = join(root, "agents.json");
await writeFile(tablePath, JSON.stringify({ schema: "ccloop-agents-table-v1", installations: { claude: installation } }), { mode: 0o600 });
// resolveControlOptions needs a plan file inside the repository; it has no tasks and is never imported (the
// requirement's group is opened, not imported). Untracked, so the overview (HEAD's tree) never sees it.
const planPath = join(repo, "plan.json");
await writeFile(planPath, JSON.stringify({ targetRepo: repo, ccloopBin, runsDir: join(root, "unused-runs"), workBranch: "orca/unused", policy: "local-merge", ledgerMode: "out-of-repo", goal: "unused", successConditions: ["unused"], tasks: [] }));
const profilePath = join(root, "profile.json");
await writeFile(profilePath, JSON.stringify({
  schema: "orca-execution-profile-snapshot-v2",
  profile: { profileId: "all", allowedWorkKinds: ["budget-estimate", "goal-review", "handoff", "task"], contextTokenizer: null, workMaxOutputTokens: 1000,
    capabilities: { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: 1_000_000, requestBoundProof: null },
    estimatorPreflight: { instructionVersion: "1", schemaVersion: "budget-estimate-v1", maxOutputTokens: 64_000, framingTokenOverhead: 17, tokenizer: { kind: "utf8-upper-bound", numerator: 2, denominator: 3, proofRef: "proof" } } },
  resolved: { proofDocumentContentHashes: ["c".repeat(64)], tokenizerArtifactHashes: [], secretValueHashes: [] },
}));

const orcaHome = join(homedir(), ".orca");
const orcaHomeBefore = snapshot(orcaHome);
const claudeProjects = join(homedir(), ".claude", "projects");
const claudeProjectsList = (): string[] => existsSync(claudeProjects) ? readdirSync(claudeProjects).sort() : ["<absent>"];
const claudeProjectsBefore = claudeProjectsList();

const repoId = controlRepoKey("live");
const repos = [{ projectKey: "live", path: repo }];
const env: NodeJS.ProcessEnv = { ORCA_CONTROL_DIR: join(root, "control"), ORCA_CORRECTIONS_DIR: join(root, "corrections"), ORCA_CCLOOP_BIN: ccloopBin, ORCA_AGENTS_TABLE: tablePath };
process.env.ORCA_CORRECTIONS_DIR = env.ORCA_CORRECTIONS_DIR;
const { rejection, ...control } = resolveControlOptions(["--plan", `plan=${repoId}=${planPath}`, "--profile", profilePath, "--estimator-profile", "all", "--estimate-mode", "soft", "--control-wake-ms", "200"], env, repos);
if (rejection !== null) throw new Error(rejection);

const revision = (runtime: ControlRuntime): number => Number(runtime.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()?.revision ?? 0);
const raw = (runtime: ControlRuntime, commandId: string, verb: string, payload: unknown, target: unknown = { kind: "group", groupId: "g" }) => ({
  schema: "orca-raw-command-v1", commandId, actorId: "human", verb, target, payload, expectedRevision: verb === "set-agent-preferences" ? 0 : revision(runtime),
}) as never;
const workRuns = (runtime: ControlRuntime) => runtime.store.db.prepare("SELECT id,work_item_id,body FROM runs WHERE group_id='g' ORDER BY id").all()
  .map((row) => ({ runId: String(row.id), task: String(row.work_item_id), body: JSON.parse(String(row.body)) })).filter((row) => row.body.phase === "work");
const workItems = (runtime: ControlRuntime) => runtime.store.db.prepare("SELECT id,body FROM work_items WHERE group_id='g' ORDER BY id").all()
  .map((row) => ({ id: String(row.id), body: JSON.parse(String(row.body)) as { status: string; kind?: string } }));

const checks: Record<string, boolean> = {};
const summary: Record<string, unknown> = { idea: IDEA, model, callUsd, maxRounds, deadlineMs, installationVersion: installation.version, baseCommit, startedAt: new Date().toISOString(), root };
const deadline = Date.now() + deadlineMs;
let timedOut = false;
/** Polls `done` until it holds (true) or the watchdog fires (false). `fail` ends the wait early (false). */
const waitFor = async (what: string, done: () => boolean, fail: () => boolean = () => false): Promise<boolean> => {
  for (;;) {
    if (done()) return true;
    if (fail()) { summary.stoppedWaitingFor = what; return false; }
    if (Date.now() > deadline) { timedOut = true; summary.stoppedWaitingFor = what; return false; }
    await new Promise((r) => setTimeout(r, 500));
  }
};
const log = (line: string) => process.stdout.write(`${new Date().toISOString()} ${line}\n`);

const runtime = await assembleControlRuntime({ control, repos, epoch: "epoch-live-requirement-1", env });
if (runtime === null) throw new Error("the control plane did not assemble");
const evidenceRoots = [`${runtime.store.stateDir}.runs`, `${runtime.store.stateDir}.workspaces`];
try {
  await runtime.recover();
  const prefs = await runtime.service.setAgentPreferences(raw(runtime, "prefs", "set-agent-preferences",
    { preferences: { defaultAgent: "claude", perAgent: { claude: { model, contextWindow: 1_000_000 } }, estimator: { agent: "claude", model, contextWindow: 1_000_000 } } }, { kind: "operator", operatorId: "human" }));
  if ("error" in prefs) throw new Error(`set-agent-preferences refused: ${JSON.stringify(prefs.error)}`);
  const opened = await runtime.service.openRequirement({ schema: "orca-raw-command-v1", commandId: "open", actorId: "human", expectedRevision: 0, verb: "requirement-open",
    target: { kind: "group", groupId: "g" }, payload: { groupId: "g", repoId, idea: IDEA, contentLanguage: "en" } } as never);
  summary.opened = opened;
  if ("error" in (opened as object)) throw new Error(`requirement-open refused: ${JSON.stringify(opened)}`);
  runtime.startPump(200);
  log("opened; round 1 queued");

  // Rounds: answer every round with its recommendations until the model closes the frontier or maxRounds is reached.
  let roundNo = 1, consensusRound: number | null = null;
  for (;;) {
    const settled = await waitFor(`round ${roundNo}`, () => !["drafting"].includes(readRound(runtime.store, "g", roundNo).state),
      () => readRound(runtime.store, "g", roundNo).waiting !== null);
    const round = readRound(runtime.store, "g", roundNo);
    log(`round ${roundNo}: ${round.state}${round.waiting ? ` waiting ${round.waiting}` : ""}`);
    if (!settled || round.state !== "awaiting-answers") break;
    if (roundNo >= maxRounds) { consensusRound = roundNo; break; }
    const result = round.result!;
    const answered = runtime.service.answerRequirement(raw(runtime, `answer-${roundNo}`, "requirement-answer", { roundNo,
      answers: result.questions.map((q) => ({ id: q.id, kind: "recommended" })), glossaryDecisions: result.glossary.map((e) => ({ id: e.id, accept: true })), adrDecisions: result.adrs.map((a) => ({ id: a.id, accept: true })) }));
    if ("error" in answered) throw new Error(`requirement-answer refused: ${JSON.stringify(answered.error)}`);
    const next = (answered as { result: { nextRoundNo: number | null } }).result.nextRoundNo;
    if (next === null) { consensusRound = roundNo; break; }
    roundNo = next;
  }
  summary.rounds = readRounds(runtime.store, "g");
  checks.consensusReached = false;
  if (consensusRound !== null) {
    const consensus = runtime.service.requirementConsensus(raw(runtime, "consensus", "requirement-consensus", { roundNo: consensusRound }));
    summary.consensus = consensus;
    checks.consensusReached = !("error" in consensus);
    log(`consensus on round ${consensusRound}: ${JSON.stringify(consensus)}`);
  }
  checks.clarifyWithinRounds = consensusRound !== null && readRounds(runtime.store, "g").every((round) => round.state !== "failed");

  // Split: the product retries an invalid or failed draft by itself; wait for one awaiting review or for the last word.
  let accepted = false;
  if (checks.consensusReached) {
    const reviewable = () => readDrafts(runtime.store, "g").find((draft) => draft.state === "awaiting-review");
    // The last word: a reason code (the retries are spent), a wait, or an interrupted call; a failed or invalid draft
    // with retries left is followed by the next one on its own.
    const stuck = () => { const last = readDrafts(runtime.store, "g").at(-1); return last !== undefined && reviewable() === undefined && (last.reasonCode !== null || last.waiting !== null || last.state === "interrupted"); };
    await waitFor("a draft awaiting review", () => reviewable() !== undefined, stuck);
    summary.drafts = readDrafts(runtime.store, "g");
    const draft = reviewable();
    checks.draftAwaitingReview = draft !== undefined;
    if (draft !== undefined) {
      log(`draft ${draft.draftNo} awaiting review`);
      summary.usedBeforeAccept = readWebGroup(runtime.store, "g").used;
      const accept = await runtime.service.acceptRequirementDraft(raw(runtime, "accept", "requirement-draft-accept", { draftNo: draft.draftNo, draftHash: readDraft(runtime.store, "g", draft.draftNo).draftHash! }));
      summary.accept = accept;
      accepted = !("error" in accept);
      checks.accepted = accepted;
      log(`accept: ${JSON.stringify(accept)}`);
      if (accepted) checks.spendCarriedOver = JSON.stringify(readWebGroup(runtime.store, "g").used) === JSON.stringify(summary.usedBeforeAccept);
    }
  }

  if (accepted) {
    const estimateId = (summary.accept as { result: { estimateId: string } }).result.estimateId;
    const exportDone = () => readRequirementGroup(runtime.store, "g").requirement.export.state;
    await waitFor("the estimate and the export", () => !["queued", "running"].includes(readEstimateRecord(runtime.store, "g", estimateId).state) && exportDone() !== "pending");
    summary.estimate = readEstimateRecord(runtime.store, "g", estimateId);
    const requirement = readRequirementGroup(runtime.store, "g").requirement;
    summary.export = requirement.export;
    checks.estimateReady = readEstimateRecord(runtime.store, "g", estimateId).state === "ready";
    checks.exported = requirement.export.state === "done";
    log(`estimate ${readEstimateRecord(runtime.store, "g", estimateId).state}; export ${requirement.export.state}`);
    if (requirement.document) {
      const text = (JSON.parse(readCanonicalRecord(runtime.store, requirement.document.recordHash)) as { text: string }).text;
      await writeFile(join(root, "requirement-document.md"), text);
    }
    if (checks.estimateReady && checks.exported) {
      const profile = runtime.router.list()[0]!, hash = profile.profileHash;
      const selections = await resolveGroupSelections({ store: runtime.store, port: runtime.port }, "g", "human");
      summary.proposal = readBudgetProposal(runtime.store, "g");
      const confirmed = await runtime.service.confirm(raw(runtime, "confirm", "confirm", { planHash: readArchivedPlan(runtime.store, "g").planHash, proposalVersion: readBudgetProposal(runtime.store, "g").proposalVersion,
        budgetMode: "soft", profileIds: { estimator: "all", worker: "all", handoff: "all", goalReview: "all" }, profileHashes: { estimator: hash, worker: hash, handoff: hash, goalReview: hash },
        contextPolicy: { handoffAtContextTokens: profile.snapshot.profile.capabilities.contextWindowTokens }, selectionsHash: selections.selectionsHash }));
      if ("error" in confirmed) throw new Error(`confirm refused: ${JSON.stringify(confirmed.error)}`);
      const started = await runtime.service.start(raw(runtime, "start", "start", {}));
      if ("error" in started) throw new Error(`start refused: ${JSON.stringify(started.error)}`);
      log("confirmed and started");
      const tasks = () => workItems(runtime).filter((item) => item.body.kind === undefined || item.body.kind === "task");
      const landed = () => tasks().length > 0 && tasks().every((item) => item.body.status === "done") && workRuns(runtime).every((run) => run.body.drive?.cleanedUp === true);
      checks.landed = await waitFor("every task to land", landed, () => workRuns(runtime).some((run) => run.body.state === "blocked"));
      summary.workItems = workItems(runtime).map((item) => ({ id: item.id, status: item.body.status }));
      summary.workRuns = workRuns(runtime).map((run) => ({ runId: run.runId, task: run.task, state: run.body.state, cumulative: run.body.cumulative, unknown: run.body.unknown }));
      if (checks.landed) {
        const firstOnBranch = g(repo, "rev-list", "--reverse", "--first-parent", "main..refs/heads/orca/g").split("\n")[0];
        checks.documentCommitFirst = firstOnBranch === requirement.export.commit;
        summary.landedHistory = g(repo, "log", "--format=%h %s", "main..refs/heads/orca/g").split("\n");
        // The landed work, tested the way the README says, in a throwaway worktree of the branch tip.
        const check = join(root, "landed-check");
        g(repo, "worktree", "add", "-q", "--detach", check, "refs/heads/orca/g");
        try {
          summary.landedTest = execFileSync("npm", ["test"], { cwd: check, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
          checks.landedTestsPass = true;
        } catch (error) { summary.landedTest = String((error as { stdout?: string }).stdout ?? error); checks.landedTestsPass = false; }
        finally { g(repo, "worktree", "remove", "--force", check); }
      }
    }
  }
  summary.used = readWebGroup(runtime.store, "g").used;
} finally {
  summary.timedOut = timedOut;
  summary.shutdown = await runtime.shutdown().catch((e: unknown) => `threw: ${String(e)}`);
  const killed: number[] = [];
  for (const file of evidenceRoots.flatMap((dir) => findAll(dir, "process.json"))) {
    const { pgid } = JSON.parse(readFileSync(file, "utf8")) as { pgid: number };
    try { process.kill(-pgid, "SIGKILL"); killed.push(pgid); } catch { /* already gone */ }
  }
  summary.killedProcessGroups = killed;
}

// claude's own figures from each kept stream's result envelope; a call cut before its envelope has none.
const calls = existsSync(claudeRaw) ? readdirSync(claudeRaw).filter((name) => name.endsWith(".json") && !name.endsWith(".argv.json")).sort().map((name) => {
  const lines = readFileSync(join(claudeRaw, name), "utf8").trim().split("\n");
  const envelope = lines.map((line) => { try { return JSON.parse(line) as Record<string, unknown>; } catch { return null; } }).filter((value) => value?.type === "result").at(-1) ?? null;
  return { name, costUsd: envelope?.total_cost_usd ?? null, durationMs: envelope?.duration_ms ?? null, isError: envelope?.is_error ?? null, usage: envelope?.usage ?? null };
}) : [];
summary.claudeCalls = calls;
summary.claudeCostUsdSum = calls.reduce((sum, call) => sum + (typeof call.costUsd === "number" ? call.costUsd : 0), 0);
summary.claudeCallsWithoutCost = calls.filter((call) => typeof call.costUsd !== "number").length;
checks.orcaHomeUnchanged = JSON.stringify(snapshot(orcaHome)) === JSON.stringify(orcaHomeBefore);
checks.claudeProjectsUnchanged = JSON.stringify(claudeProjectsList()) === JSON.stringify(claudeProjectsBefore);
checks.mainUntouched = g(repo, "rev-parse", "main") === baseCommit;
summary.checks = checks;
summary.finishedAt = new Date().toISOString();
await writeFile(join(root, "summary.json"), JSON.stringify(summary, null, 2));
const ok = Object.values(checks).length > 0 && Object.values(checks).every(Boolean);
log(`checks ${JSON.stringify(checks)}; claude cost sum $${String(summary.claudeCostUsdSum)} over ${calls.length} calls (${String(summary.claudeCallsWithoutCost)} without a cost)`);
// A hash of the summary, so a later reader can tell the file was not edited after the run.
log(`summary.json sha256 ${createHash("sha256").update(readFileSync(join(root, "summary.json"))).digest("hex")}`);
process.exit(ok ? 0 : 1);
