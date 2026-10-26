// O9 of the multi-directory projects spec (docs/superpowers/specs/2026-10-24-multi-directory-projects-design.md §18 O9,
// §3.3, §20 O7): one requirement on a repo + repo + folder project driven end to end by a real agent, through the
// assembled control runtime -- the same service, wake pump and driver `orca panel` mounts, without HTTP. Then one forced
// `partial`, answered by `retry-rest`.
//
// The project is three members in registered order: the git repositories `alpha` and `beta`, then the plain folder
// `notes`. The one requirement raises both packages to 0.2.0 and writes notes/VERSION; the split is accepted only when a
// single task's `writes` spans at least two members, because a task writing one member never exercises ccloop's `--add-dir`
// (a draft that splits the release per directory is handed back with requirement-draft-feedback, at most --max-drafts),
// and when every write's checks read the delivered file rather than `git status`/`git diff` (a new file is untracked when
// the checks run, so a diff-based check of it can only fail -- one such draft is handed back the same way).
// Acceptance freezes each repository member's `local` integration scheme and the folder's `place`.
//
// The forced partial is deterministic and uses the driver's own crash seam: the first landing publishes `alpha`, the
// harness then moves `beta`'s main to a sibling commit (a "person" change) and throws DriverCrash. The runtime is closed
// as a process death, assembled again, and its recovery replays the journaled plan: alpha is recorded as landed, beta
// fails `multi-dir-target-moved`, and the landing is `partial` with alpha kept. The harness answers `multi-dir-landing`
// `retry-rest`; the next round pre-checks only the unlanded members and lands them.
//
// Observes, per member, what the spec asks: the work item's `writes` span the members; the work run's `drive.dirs` holds a
// prepared workspace per member (extra ones under `<stateDir>.workspaces/<runId>.dir-<key>`); the landed target of each
// member holds the change (alpha and beta's main, the notes folder's VERSION); for claude, the tee'd argv carries
// `--add-dir` with the extra workspaces.
//
// This SPENDS MONEY with --codex/--claude/--omp. Caps: claude's own --max-budget-usd (--call-usd), the group's token
// grant (--group-tokens / --task-tokens), the agent's per-phase timeout frozen in the installation, and the outer
// --deadline-ms watchdog, which kills every process group ccloop registered. --fake-omp spends nothing but cannot run the
// work phase (the fixture writes only in the primary's cwd); with --stop-after-export it validates open -> clarify ->
// split -> accept -> estimate -> export without starting anything.
//
// Rule 17: Orca's own writes all go under --output (ORCA_CONTROL_DIR, ORCA_CORRECTIONS_DIR, ORCA_VAULT_DIR); ~/.orca is
// snapshotted and must not change. ccloop's cache (CCLOOP_CACHE_DIR) defaults to <output>/ccloop-cache. HOME is not
// relocated (claude reads its OAuth login from the keychain); for omp the caller passes a private --omp-config-dir.
//
// usage: tsx scripts/live-multi-dir-acceptance.ts --ccloop-bin <abs dist/cli.js> --output <new dir>
//          (--codex <abs codex binary> --model <name> | --claude <abs claude binary> --model <name>
//           | --omp <abs omp binary> --model <provider/model> --omp-config-dir <private absolute directory> | --fake-omp)
//          [--call-usd 2] [--deadline-ms 3600000] [--max-rounds 4] [--max-drafts 4] [--context-window 1000000]
//          [--group-tokens 3000000] [--task-tokens 1000000] [--stop-after-export] [--no-partial]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { resolveGroupSelections } from "../src/control/agentFreeze.js";
import { DriverCrash, type CrashPoint } from "../src/control/executionDriver.js";
import { createMultiDirProjects } from "../src/control/multiGroup.js";
import { readMultiLanding } from "../src/control/multiLandingRecord.js";
import { readArchivedPlan, readBudgetProposal, readEstimateRecord } from "../src/control/queries.js";
import { latestDraft, readDraft, readDrafts, readRequirementGroup, readRound, readRounds, taskWrites } from "../src/control/requirementRecords.js";
import { readCanonicalRecord } from "../src/control/snapshot.js";
import { readWebGroup } from "../src/control/webService.js";
import { writeRepositorySettingsBody } from "../src/control/workspaceSettings.js";
import { assembleControlRuntime, type ControlRuntime } from "../src/panel/controlAssembly.js";
import { controlRepoKey, resolveControlOptions } from "../src/panel/controlOptions.js";

const VALUE_FLAGS = new Set(["ccloop-bin", "output", "codex", "claude", "omp", "model", "omp-config-dir", "call-usd", "deadline-ms",
  "max-rounds", "max-drafts", "context-window", "group-tokens", "task-tokens"]);
function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]!;
    if (!key.startsWith("--")) throw new Error(`unexpected argument ${key}`);
    if (key === "--fake-omp") { out["fake-omp"] = "1"; continue; }
    if (key === "--stop-after-export") { out["stop-after-export"] = "1"; continue; }
    if (key === "--no-partial") { out["no-partial"] = "1"; continue; }
    if (!VALUE_FLAGS.has(key.slice(2))) throw new Error(`unknown flag ${key}`);
    const value = argv[++i];
    if (value === undefined) throw new Error(`${key} needs a value`);
    out[key.slice(2)] = value;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const ccloopBin = args["ccloop-bin"], output = args.output;
if (!ccloopBin || !isAbsolute(ccloopBin) || !output) throw new Error("--ccloop-bin <absolute> and --output <new dir> are required");
const fakeOmp = args["fake-omp"] === "1";
const modes = [args.codex !== undefined, args.claude !== undefined, args.omp !== undefined, fakeOmp].filter(Boolean).length;
if (modes !== 1) throw new Error("give exactly one of --codex <abs> --model <name>, --claude <abs> --model <name>, --omp <abs> --model <selector> --omp-config-dir <abs>, or --fake-omp");
const live = args.codex ?? args.claude ?? args.omp;
if (live !== undefined && (!isAbsolute(live) || !args.model)) throw new Error("--codex/--claude/--omp must be absolute and --model is required");
if (args.omp !== undefined && (!args["omp-config-dir"] || !isAbsolute(args["omp-config-dir"]))) throw new Error("--omp-config-dir must be absolute");
const kind: "codex" | "claude" | "omp" = args.omp !== undefined || fakeOmp ? "omp" : args.claude !== undefined ? "claude" : "codex";
for (const key of Object.keys(process.env)) if (key.startsWith("CLAUDE") && key !== "CLAUDE_CONFIG_DIR") delete process.env[key];
if (existsSync(output)) throw new Error(`refusing an existing --output ${output}`);
const stopAfterExport = args["stop-after-export"] === "1";
const forcePartial = args["no-partial"] !== "1";
// The fixture writes only in the primary's cwd, so it cannot hold the three members' checks; refusing early is honest.
if (fakeOmp && !stopAfterExport) throw new Error("--fake-omp cannot run the work phase; add --stop-after-export to validate open through export");
const callUsd = String(args["call-usd"] ?? "2");
const deadlineMs = Number(args["deadline-ms"] ?? 3_600_000);
const maxRounds = Number(args["max-rounds"] ?? 4);
const maxDrafts = Number(args["max-drafts"] ?? 4);
const groupTokens = Number(args["group-tokens"] ?? 3_000_000);
const taskTokens = Number(args["task-tokens"] ?? 1_000_000);
// omp has no context option in ccloop (the preference is never sent); claude's 1M is `--model <model>[1m]`; codex has no
// preference either (a codex contextWindow preference is refused), so the window below is the profile's declaration and
// ccloop's observed window wins wherever it states one (intersectCapabilities, human ruling R7).
const contextWindow = Number(args["context-window"] ?? 1_000_000);
if (!Number.isSafeInteger(contextWindow) || contextWindow <= 0) throw new Error("--context-window must be a positive integer");
const CLAUDE_ISOLATION = ["--permission-mode", "acceptEdits", "--no-session-persistence", "--setting-sources", "project,local", "--strict-mcp-config", "--disable-slash-commands", "--settings", '{"autoMemoryEnabled":false}', "--max-budget-usd", callUsd];

const IDEA = "Release 0.2.0 across the whole project. In alpha's package.json and in beta's package.json set the version field to 0.2.0, "
  + "and add a file VERSION at the root of the notes folder whose entire content is the characters 0.2.0 followed by one newline. "
  + "It is one release: one task changes all three directories together. Change no other file. "
  + "Every member is worked on inside a git working tree, the notes folder too, so verify a file by reading its contents; "
  + "never prove a directory's contents by listing it, since a working tree also holds .git, and never by git status or git diff, "
  + "since a new file is untracked and the change is uncommitted when the checks run.";
const FEEDBACK = "This is one release across the whole project: make it one task whose writes list all three directories (alpha, beta and notes), "
  + "one entry per directory, rather than one task per directory. Do not change the requirement's scope.";
// A check that inspects git state instead of the file is not a check of what was delivered: at verify time a new file is
// untracked (`git diff` says nothing about it) and the change is not committed (`git status` describes an edit in flight).
const FEEDBACK_CHECKS = "Keep it one task whose writes list all three directories, and make each write's checks verify the delivered file's contents: "
  + "parse package.json, and compare VERSION's bytes (`printf '0.2.0\\n' | cmp - VERSION` or `grep -qx 0.2.0 VERSION`). "
  + "Do not use `git status` or `git diff`: a newly written file is untracked and the change is not committed when the checks run, "
  + "so they say nothing about the delivered contents. Do not change the requirement's scope.";

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
const sha256File = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

const root = await realpath(await mkdir(output, { recursive: true, mode: 0o700 }).then(() => output));
// Rule 17: ccloop's catalog cache and its private agent homes stay under --output unless the caller chose a cache.
const ccloopCacheDir = process.env.CCLOOP_CACHE_DIR || join(root, "ccloop-cache");
process.env.CCLOOP_CACHE_DIR = ccloopCacheDir;

// alpha: a tiny package whose main is checked out, so its `local` landing is a fast-forward of a checked-out branch.
// beta: the same package, its main NOT checked out (a parking branch is), so its landing is a compare-and-swap update-ref
// and the person's sibling commit below can move main without dirtying a worktree.
const alpha = join(root, "alpha"), beta = join(root, "beta"), notes = join(root, "notes");
await mkdir(alpha); await mkdir(beta); await mkdir(join(notes, "posts"), { recursive: true });
const pkg = (name: string): string => JSON.stringify({ name, version: "0.1.0", private: true }, null, 2) + "\n";
await writeFile(join(alpha, "README.md"), "# alpha\n\nThe alpha package.\n");
await writeFile(join(alpha, "package.json"), pkg("alpha"));
await writeFile(join(beta, "README.md"), "# beta\n\nThe beta package.\n");
await writeFile(join(beta, "package.json"), pkg("beta"));
await writeFile(join(notes, "README.md"), "# Notes\n\nRelease notes for the whole project.\n");
await writeFile(join(notes, "posts", "first.md"), "first post\n");
for (const dir of [alpha, beta]) { g(dir, "init", "-q", "-b", "main"); g(dir, "add", "-A"); g(dir, "commit", "-qm", `${dir === alpha ? "alpha" : "beta"} 0.1.0`); }
const alphaBase = g(alpha, "rev-parse", "refs/heads/main"), betaBase = g(beta, "rev-parse", "refs/heads/main");
g(beta, "checkout", "-q", "-b", "parked");

const alphaRepoId = controlRepoKey("alpha"), betaRepoId = controlRepoKey("beta"), notesRepoId = controlRepoKey("notes"), multiRepoId = controlRepoKey("release");
const members = [
  { key: "alpha", name: "Alpha package", repoId: alphaRepoId, kind: "repo" as const, path: alpha },
  { key: "beta", name: "Beta package", repoId: betaRepoId, kind: "repo" as const, path: beta },
  { key: "notes", name: "Notes folder", repoId: notesRepoId, kind: "dir" as const, path: notes },
];
const repos = [{ projectKey: "alpha", path: alpha }, { projectKey: "beta", path: beta }, { projectKey: "notes", path: notes, kind: "dir" as const }];
const multiDirProjects = createMultiDirProjects();
multiDirProjects.add({ repoId: multiRepoId, dirs: members });

// The fake omp installation is ccloop's own fixture behind a wrapper that rotates `<marker>.single-<n>.json` into
// `<marker>.single.json` before call n (n = one more than the single calls recorded), as live-driver-acceptance does.
const marker = join(root, "omp-marker.json");
const fakeOmpWrapper = join(root, "fake-omp");
if (fakeOmp) {
  const m = JSON.stringify(marker);
  await writeFile(fakeOmpWrapper, `#!/bin/sh\nn=$(( $(cat ${m}.calls 2>/dev/null | wc -l) + 1 ))\n[ -f ${m}.single-$n.json ] && mv -f ${m}.single-$n.json ${m}.single.json\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(resolve(dirname(ccloopBin), "..", "tests", "fixtures", "fake-omp.mjs"))} ${JSON.stringify(marker)} "$@"\n`, { mode: 0o700 });
  await mkdir(join(root, "omp-config"), { mode: 0o700 });
}
const ompBinary = fakeOmp ? fakeOmpWrapper : args.omp;
const ompConfigDir = fakeOmp ? join(root, "omp-config") : args["omp-config-dir"];
const claudeRaw = join(root, "claude-raw");
const claudeTee = [process.execPath, resolve(import.meta.dirname, "claude-tee.mjs"), claudeRaw];
const claudeCommand = [...claudeTee, args.claude ?? "", ...CLAUDE_ISOLATION];
const installation = kind === "omp"
  ? { kind: "omp", command: [ompBinary!], version: versionOf([ompBinary!]), configDir: ompConfigDir!, timeoutMs: fakeOmp ? 120_000 : 900_000, killGraceMs: 5_000, profile: null, defaultModel: args.model ?? "gateway/model-a" }
  : kind === "codex"
  ? { kind: "codex", command: [args.codex!], version: versionOf([args.codex!]), configDir: null, timeoutMs: 900_000, killGraceMs: 5_000, sandbox: "workspace-write", budgetMode: "soft" }
  : { kind: "claude", command: claudeCommand, version: versionOf(claudeCommand), configDir: null, timeoutMs: 600_000, killGraceMs: 5_000 };
const tablePath = join(root, "agents.json");
await writeFile(tablePath, JSON.stringify({ schema: "ccloop-agents-table-v1", installations: { [kind]: installation } }), { mode: 0o600 });

// resolveControlOptions needs a plan file inside a trusted repository; it has no tasks and is never imported (the
// requirement's group is opened, not imported). It lives in alpha's administrative directory so the person's working
// tree stays clean -- the landing pre-check refuses to fast-forward a checked-out branch over untracked files
// (multiLanding publishPrecondition, spec §9.4 step 4) -- and so alpha's overview (HEAD's tree) never sees it.
const planPath = join(alpha, ".git", "orca-plan.json");
await writeFile(planPath, JSON.stringify({ targetRepo: alpha, ccloopBin, runsDir: join(root, "unused-runs"), workBranch: "orca/unused", policy: "local-merge", ledgerMode: "out-of-repo", goal: "unused", successConditions: ["unused"], tasks: [] }));
const profilePath = join(root, "profile.json");
await writeFile(profilePath, JSON.stringify({
  schema: "orca-execution-profile-snapshot-v2",
  profile: { profileId: "all", allowedWorkKinds: ["budget-estimate", "goal-review", "handoff", "task"], contextTokenizer: null, workMaxOutputTokens: 1000,
    capabilities: { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: contextWindow, requestBoundProof: null },
    estimatorPreflight: { instructionVersion: "2", schemaVersion: "budget-estimate-v1", maxOutputTokens: 64_000, framingTokenOverhead: kind === "omp" ? 2047 : 17, tokenizer: { kind: "utf8-upper-bound", numerator: 2, denominator: 3, proofRef: "proof" } } },
  resolved: { proofDocumentContentHashes: ["c".repeat(64)], tokenizerArtifactHashes: [], secretValueHashes: [] },
}));

const orcaHome = join(homedir(), ".orca");
const orcaHomeBefore = snapshot(orcaHome);
// Real codex may append one trust entry to the person's own config; recorded (never asserted) so it can be cleaned after.
const codexConfig = join(homedir(), ".codex", "config.toml");
const codexConfigBefore = existsSync(codexConfig) ? sha256File(codexConfig) : "<absent>";
const claudeProjects = join(homedir(), ".claude", "projects");
const claudeProjectsList = (): string[] => existsSync(claudeProjects) ? readdirSync(claudeProjects).sort() : ["<absent>"];
const claudeProjectsBefore = claudeProjectsList();

const env: NodeJS.ProcessEnv = { ORCA_CONTROL_DIR: join(root, "control"), ORCA_CORRECTIONS_DIR: join(root, "corrections"), ORCA_VAULT_DIR: join(root, "vaults"),
  ORCA_CCLOOP_BIN: ccloopBin, ORCA_AGENTS_TABLE: tablePath, CCLOOP_CACHE_DIR: ccloopCacheDir };
process.env.ORCA_CORRECTIONS_DIR = env.ORCA_CORRECTIONS_DIR;
const { rejection, ...control } = resolveControlOptions(["--plan", `plan=${alphaRepoId}=${planPath}`, "--profile", profilePath, "--estimator-profile", "all", "--estimate-mode", "soft", "--control-wake-ms", "200", "--control-state-dir", join(root, "control", "panel")], env, repos);
if (rejection !== null) throw new Error(rejection);

const checks: Record<string, boolean> = {};
const summary: Record<string, unknown> = {
  mode: fakeOmp ? "fake-omp" : "live", kind, idea: IDEA, model: args.model ?? null, contextWindow, callUsd, deadlineMs, maxRounds, maxDrafts,
  groupTokens, taskTokens, stopAfterExport, forcePartial, installationCommand: installation.command, installationVersion: installation.version,
  multiRepoId, members: members.map(({ key, name, repoId, kind: k, path }) => ({ key, name, repoId, kind: k, path })),
  bases: { alpha: alphaBase, beta: betaBase }, startedAt: new Date().toISOString(), root,
};
let timedOut = false;
const deadline = Date.now() + deadlineMs;
/** Polls `done` until it holds (true), `fail` ends it early, or the watchdog fires (both false). */
const waitFor = async (what: string, done: () => boolean, fail: () => boolean = () => false): Promise<boolean> => {
  for (;;) {
    if (done()) return true;
    if (fail()) { summary.stoppedWaitingFor = what; return false; }
    if (Date.now() > deadline) { timedOut = true; summary.stoppedWaitingFor = what; return false; }
    await new Promise((r) => setTimeout(r, 500));
  }
};
const log = (line: string): void => { process.stdout.write(`${new Date().toISOString()} ${line}\n`); };

let runtime: ControlRuntime | null = null;
let epoch = 0;
const evidenceRoots = (): string[] => runtime === null ? [] : [`${runtime.store.stateDir}.runs`, `${runtime.store.stateDir}.workspaces`];
const boot = async (driverCrash?: (point: CrashPoint) => void): Promise<ControlRuntime> => {
  const assembled = await assembleControlRuntime({ control, repos, epoch: `epoch-multi-o9-${++epoch}`, env, multiDirProjects, ...(driverCrash === undefined ? {} : { driverCrash }) });
  if (assembled === null) throw new Error("the control plane did not assemble");
  runtime = assembled;
  await assembled.recover();
  return assembled;
};
const stopRuntime = async (): Promise<void> => {
  if (runtime === null) return;
  summary.shutdown = await runtime.shutdown().catch((e: unknown) => `threw: ${String(e)}`);
  runtime.close();
  runtime = null;
};

// The requirement verbs need the group's current revision; open and the operator's preferences do not (targets that
// have no group).
const groupRevision = (rt: ControlRuntime): number => Number((rt.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get() as { revision?: number } | undefined)?.revision ?? 0);
const raw = (rt: ControlRuntime, commandId: string, verb: string, payload: unknown, target: unknown = { kind: "group", groupId: "g" }) => ({
  schema: "orca-raw-command-v1", commandId, actorId: "human", verb, target, payload,
  expectedRevision: verb === "requirement-open" || verb === "set-agent-preferences" ? 0 : groupRevision(rt),
}) as never;
const setPreferences = async (rt: ControlRuntime): Promise<void> => {
  // Only claude carries a contextWindow preference: omp has no such option and ccloop refuses one for codex.
  const perAgent = kind === "claude" ? { model: args.model!, contextWindow } : args.model === undefined ? {} : { model: args.model };
  const estimator = { agent: kind, ...(args.model === undefined ? {} : { model: args.model }), ...(kind === "claude" ? { contextWindow } : {}) };
  const preferences = await rt.service.setAgentPreferences(raw(rt, "preferences", "set-agent-preferences",
    { preferences: { defaultAgent: kind, perAgent: { [kind]: perAgent }, estimator } }, { kind: "operator", operatorId: "human" }));
  if ("error" in preferences) throw new Error(`set-agent-preferences refused: ${JSON.stringify(preferences.error)}`);
};
const groupBody = (rt: ControlRuntime): Record<string, unknown> => JSON.parse(String(rt.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;
const landingOf = (rt: ControlRuntime) => {
  const multi = groupBody(rt).multiDir as { landing?: unknown } | undefined;
  return readMultiLanding(multi?.landing);
};
const workRuns = (rt: ControlRuntime) => rt.store.db.prepare("SELECT id,work_item_id,body FROM runs WHERE group_id='g' ORDER BY id").all()
  .map((row) => ({ runId: String(row.id), task: String(row.work_item_id), body: JSON.parse(String(row.body)) as { phase?: string; state?: string; drive?: { cleanedUp?: boolean; stopReason?: string; dirs?: Array<{ key: string; workspacePath: string }> } } }))
  .filter((row) => row.body.phase === "work");
const workItems = (rt: ControlRuntime) => rt.store.db.prepare("SELECT id,body FROM work_items WHERE group_id='g' ORDER BY id").all()
  .map((row) => ({ id: String(row.id), body: JSON.parse(String(row.body)) as { status: string; kind?: string } }));
const draftWrites = (output: unknown): Array<{ taskId: string; dirs: string[] }> => {
  const tasks = (output as { tasks?: Array<{ taskId?: unknown; writes?: Array<{ dir?: unknown }> }> } | null)?.tasks ?? [];
  return tasks.map((task) => ({ taskId: String(task.taskId ?? ""), dirs: (task.writes ?? []).map((write) => String(write.dir ?? "")) }));
};
const spansDirs = (rt: ControlRuntime, draftNo: number): boolean => {
  const output = readDraft(rt.store, "g", draftNo).output;
  return draftWrites(output).some((task) => task.dirs.length >= 2);
};
/** A write check phrased against `git status`/`git diff` judges an edit in flight, not the files the task delivered. */
const checksReadVcsState = (output: unknown): boolean =>
  ((output as { tasks?: Array<{ writes?: Array<{ checks?: unknown[] }> }> } | null)?.tasks ?? [])
    .flatMap((task) => task.writes ?? [])
    .flatMap((write) => (write.checks ?? []).map(String))
    .some((check) => /\bgit\s+(status|diff)\b/.test(check));
const fakeCalls = (): number => existsSync(`${marker}.calls`) ? readFileSync(`${marker}.calls`, "utf8").trim().split("\n").filter(Boolean).length : 0;
/** The fake omp's next call's answer: one assistant message_end whose text is `output`. */
let fakeSeq = 0;
const fakeAnswer = async (output: unknown): Promise<void> => {
  fakeSeq += 1;
  const usage = { input: 100 * fakeSeq, output: 20 * fakeSeq, cacheRead: 3, cacheWrite: 1, totalTokens: 120 * fakeSeq + 4, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  const selector = (installation as { defaultModel?: string }).defaultModel ?? "gateway/model-a";
  const message = { role: "assistant", content: [{ type: "text", text: JSON.stringify(output) }], provider: selector.split("/")[0], model: selector.slice(selector.indexOf("/") + 1), stopReason: "stop", usage };
  await writeFile(`${marker}.single-${fakeCalls() + 1}.json`, JSON.stringify({ rows: [{ type: "agent_start" }, { type: "message_end", message }, { type: "agent_end", isTerminal: true, yielded: true, messages: [message] }] }));
};
const CLARIFY_FAKE = {
  slug: "release-0-2-0", statement: IDEA,
  // Round 1's judgement (clarify caps §3.1): the round's questions are answered with their recommendations below.
  classification: { scope: "medium", scopeReason: "One release over three members.", clarity: "clear", clarityReason: "The version and the file are named." },
  acceptanceCriteria: [
    { id: "AC1", text: "alpha's package.json version is 0.2.0" },
    { id: "AC2", text: "beta's package.json version is 0.2.0" },
    { id: "AC3", text: "the notes folder holds VERSION with exactly 0.2.0 and one newline" },
  ],
  questions: [{ key: "one-release", question: "Is the release one atomic change across all three members?", recommendedAnswer: "Yes: one task writes all three.", why: "The idea says it is one release.", dependsOn: [] }],
  frontierEmpty: true, openBranches: [], glossary: [], adrs: [],
};
const SPLIT_FAKE = {
  notes: "one release task across the three members",
  tasks: [{
    taskId: "release", title: "Release 0.2.0 in alpha, beta and notes", labels: [],
    goal: "Set the version field in alpha/package.json and beta/package.json to 0.2.0, and add VERSION at the notes root holding 0.2.0 and a newline. Change no other file.",
    successCondition: "alpha and beta both say 0.2.0 and notes/VERSION holds 0.2.0",
    writes: [
      { dir: "alpha", targetPaths: ["package.json"], checks: ["grep -q '\"version\": \"0.2.0\"' package.json"] },
      { dir: "beta", targetPaths: ["package.json"], checks: ["grep -q '\"version\": \"0.2.0\"' package.json"] },
      { dir: "notes", targetPaths: ["VERSION"], checks: ["grep -qx 0.2.0 VERSION"] },
    ],
    dependsOn: [], traces: ["AC1", "AC2", "AC3"],
  }],
};
const estimateFake = (): unknown => ({
  schema: "budget-estimate-answer-v2",
  tasks: { release: { complexity: "S", confidence: "high", work: { tokens: taskTokens, activeMs: 600_000, attempts: 1, sessions: 1 },
    handoff: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 }, rationale: "three one-line edits", assumptions: ["the members start at 0.1.0"] } },
  goalReviewReserve: { tokens: 1, activeMs: 1, attempts: 0, sessions: 0 }, groupRationale: "one small release task",
});

const workspaceOfDirs = (run: { body: { drive?: { dirs?: Array<{ key: string; workspacePath: string }> } } }): Array<{ key: string; workspacePath: string }> => run.body.drive?.dirs ?? [];
/** `git merge-base --is-ancestor` exits 1 for "no", which execFileSync raises; the answer is the boolean. */
const isAncestor = (ancestor: string, ref: string): boolean => { try { g(beta, "merge-base", "--is-ancestor", ancestor, ref); return true; } catch { return false; } };
/** The person's later change to beta: a sibling of its base with one extra file, moved onto main by compare-and-swap. */
const moveBetaMain = (): string => {
  const main = g(beta, "rev-parse", "refs/heads/main");
  const index = join(root, "beta-person.index");
  const gitEnv = { ...process.env, GIT_INDEX_FILE: index };
  const run = (argv: string[], input?: string): string => execFileSync("git", ["-c", "user.name=person", "-c", "user.email=person@example.invalid", "-c", "core.hooksPath=/dev/null", ...argv],
    { cwd: beta, env: gitEnv, encoding: "utf8", ...(input === undefined ? {} : { input }) }).trim();
  run(["read-tree", "refs/heads/main"]);
  const blob = run(["hash-object", "-w", "--stdin"], "a later change by the person\n");
  run(["update-index", "--add", "--cacheinfo", `100644,${blob},sibling.txt`]);
  const sibling = run(["commit-tree", run(["write-tree"]), "-p", main, "-m", "a person's later change"]);
  g(beta, "update-ref", "refs/heads/main", sibling, main);
  return sibling;
};

let sibling: string | null = null, crashFired = false;
const crash = (point: CrashPoint): void => {
  if (point !== "multi-land-after-publish:alpha" || crashFired) return;
  crashFired = true;
  sibling = moveBetaMain();
  throw new DriverCrash(point);
};

let failure: unknown = null;
try {
  // Acceptance freezes the members' delivery: a repository member is `local` onto its own main unless the person set a
  // default, and the folder is `place` (requirementCommands.ts). The scratch repositories have no settings yet.
  let rt = await boot(forcePartial ? crash : undefined);
  for (const repoId of [alphaRepoId, betaRepoId]) {
    writeRepositorySettingsBody(rt.store, repoId, { workspaceMode: "worktree", revision: 1, integration: { delivery: "local", trigger: "task", method: "merge", target: "main" } });
  }
  await setPreferences(rt);
  const opened = await rt.service.openRequirement(raw(rt, "open", "requirement-open", { groupId: "g", repoId: multiRepoId, idea: IDEA, contentLanguage: "en" }));
  summary.opened = opened;
  if ("error" in opened) throw new Error(`requirement-open refused: ${JSON.stringify(opened.error)}`);
  if (fakeOmp) await fakeAnswer(CLARIFY_FAKE);
  rt.startPump(200);
  log("opened; round 1 queued");

  let roundNo = 1, consensusRound: number | null = null;
  for (;;) {
    const settled = await waitFor(`round ${roundNo}`, () => readRound(rt.store, "g", roundNo).state !== "drafting", () => readRound(rt.store, "g", roundNo).waiting !== null);
    const round = readRound(rt.store, "g", roundNo);
    log(`round ${roundNo}: ${round.state}${round.waiting ? ` waiting ${round.waiting}` : ""}`);
    if (!settled || round.state !== "awaiting-answers") break;
    if (roundNo >= maxRounds) { consensusRound = roundNo; break; }
    const result = round.result!;
    const answered = rt.service.answerRequirement(raw(rt, `answer-${roundNo}`, "requirement-answer", { roundNo,
      answers: result.questions.map((q) => ({ id: q.id, kind: "recommended" })), glossaryDecisions: result.glossary.map((e) => ({ id: e.id, accept: true })), adrDecisions: result.adrs.map((a) => ({ id: a.id, accept: true })) }));
    if ("error" in answered) throw new Error(`requirement-answer refused: ${JSON.stringify(answered.error)}`);
    const next = (answered as { result: { nextRoundNo: number | null } }).result.nextRoundNo;
    if (next === null) { consensusRound = roundNo; break; }
    roundNo = next;
  }
  summary.rounds = readRounds(rt.store, "g");
  checks.clarifyWithinRounds = consensusRound !== null && readRounds(rt.store, "g").every((round) => round.state !== "failed");
  checks.consensusReached = false;
  if (consensusRound !== null) {
    if (fakeOmp) await fakeAnswer(SPLIT_FAKE);
    const consensus = rt.service.requirementConsensus(raw(rt, "consensus", "requirement-consensus", { roundNo: consensusRound }));
    summary.consensus = consensus;
    checks.consensusReached = !("error" in consensus);
    log(`consensus on round ${consensusRound}: ${checks.consensusReached ? "reached" : JSON.stringify(consensus)}`);
  }

  // Split: a draft that does not span directories is handed back (the product's own feedback verb) and the next one
  // awaited; the product retries an invalid draft by itself.
  let accepted = false;
  if (checks.consensusReached) {
    for (let attempt = 0; attempt < maxDrafts; attempt += 1) {
      const reviewable = () => readDrafts(rt.store, "g").find((draft) => draft.state === "awaiting-review");
      const stuck = () => { const last = readDrafts(rt.store, "g").at(-1); return last !== undefined && reviewable() === undefined && (last.reasonCode !== null || last.waiting !== null || last.state === "interrupted"); };
      const arrived = await waitFor("a draft awaiting review", () => reviewable() !== undefined, stuck);
      summary.drafts = readDrafts(rt.store, "g");
      const draft = reviewable();
      if (!arrived || draft === undefined) break;
      const spans = spansDirs(rt, draft.draftNo), vcsChecks = checksReadVcsState(readDraft(rt.store, "g", draft.draftNo).output);
      if (!spans || vcsChecks) {
        log(`draft ${draft.draftNo} ${spans ? "verifies git state instead of file contents" : `does not span directories (${JSON.stringify(draftWrites(readDraft(rt.store, "g", draft.draftNo).output))})`}; asking again`);
        if (attempt === maxDrafts - 1) break;
        const feedback = rt.service.requirementDraftFeedback(raw(rt, `feedback-${draft.draftNo}`, "requirement-draft-feedback", { draftNo: draft.draftNo, feedback: spans ? FEEDBACK_CHECKS : FEEDBACK }));
        summary.lastFeedback = feedback;
        if ("error" in feedback) throw new Error(`requirement-draft-feedback refused: ${JSON.stringify(feedback.error)}`);
        continue;
      }
      log(`draft ${draft.draftNo} awaiting review and spanning directories`);
      summary.usedBeforeAccept = readWebGroup(rt.store, "g").used;
      const accept = await rt.service.acceptRequirementDraft(raw(rt, "accept", "requirement-draft-accept", { draftNo: draft.draftNo, draftHash: readDraft(rt.store, "g", draft.draftNo).draftHash! }));
      summary.accept = accept;
      accepted = !("error" in accept);
      checks.accepted = accepted;
      log(`accept: ${accepted ? "accepted" : JSON.stringify(accept)}`);
      if (accepted) {
        checks.spendCarriedOver = JSON.stringify(readWebGroup(rt.store, "g").used) === JSON.stringify(summary.usedBeforeAccept);
        summary.landingAtAccept = landingOf(rt);
      }
      break;
    }
    checks.splitSpansDirs = checks.accepted === true;
    summary.splitWrites = readDrafts(rt.store, "g").filter((draft) => draft.state === "accepted").map((draft) => draftWrites(draft.output));
  }

  if (accepted) {
    const estimateId = (summary.accept as { result: { estimateId: string } }).result.estimateId;
    if (fakeOmp) await fakeAnswer(estimateFake());
    const exportDone = () => readRequirementGroup(rt.store, "g").requirement.export.state;
    // An invalid estimate answer is retried by Orca as a new version (A2): the retry row is written in the failed one's
    // own transaction, so the chain is settled when no estimate is queued or running and the export has finished.
    const latestEstimate = (): { id: string } | undefined => rt.store.db
      .prepare("SELECT id FROM estimates WHERE group_id='g' ORDER BY estimate_version DESC LIMIT 1").get() as { id: string } | undefined;
    const unsettled = () => rt.store.db.prepare("SELECT 1 FROM estimates WHERE group_id='g' AND state IN ('queued','running') LIMIT 1").get() !== undefined;
    await waitFor("the estimate chain and the export", () => latestEstimate() !== undefined && !unsettled() && exportDone() !== "pending");
    summary.estimates = rt.store.db.prepare("SELECT id, estimate_version, state FROM estimates WHERE group_id='g' ORDER BY estimate_version").all();
    const latest = latestEstimate()?.id ?? estimateId;
    summary.estimate = readEstimateRecord(rt.store, "g", latest);
    const requirement = readRequirementGroup(rt.store, "g").requirement;
    summary.export = requirement.export;
    // O9 observes the landing, not the estimate: a failed estimate leaves the person the default proposal (soft mode),
    // which is what they would confirm. Recorded as an observation, not a check, so it does not decide the acceptance.
    summary.estimateReady = latestEstimate() !== undefined && readEstimateRecord(rt.store, "g", latest).state === "ready";
    checks.exported = requirement.export.state === "done";
    log(`estimates ${JSON.stringify(summary.estimates)}; export ${requirement.export.state}; estimate ready ${summary.estimateReady}`);
    if (requirement.document) {
      const text = (JSON.parse(readCanonicalRecord(rt.store, requirement.document.recordHash)) as { text: string }).text;
      await writeFile(join(root, "requirement-document.md"), text);
    }

    if (!stopAfterExport && checks.exported) {
      const profile = rt.router.list()[0]!, hash = profile.profileHash;
      const selections = await resolveGroupSelections({ store: rt.store, port: rt.port }, "g", "human");
      summary.proposal = readBudgetProposal(rt.store, "g");
      summary.estimateFallback = summary.estimateReady !== true;
      const confirmed = await rt.service.confirm(raw(rt, "confirm", "confirm", { planHash: readArchivedPlan(rt.store, "g").planHash, proposalVersion: readBudgetProposal(rt.store, "g").proposalVersion,
        budgetMode: "soft", profileIds: { estimator: "all", worker: "all", handoff: "all", goalReview: "all" }, profileHashes: { estimator: hash, worker: hash, handoff: hash, goalReview: hash },
        contextPolicy: { handoffAtContextTokens: profile.snapshot.profile.capabilities.contextWindowTokens }, selectionsHash: selections.selectionsHash }));
      if ("error" in confirmed) throw new Error(`confirm refused: ${JSON.stringify(confirmed.error)}`);
      const started = await rt.service.start(raw(rt, "start", "start", {}));
      if ("error" in started) throw new Error(`start refused: ${JSON.stringify(started.error)}`);
      checks.started = true;
      log("confirmed and started");

      // A wait may not outlive the work: a run blocked on a person, a work item held or blocked (a settled run whose
      // checkpoint did not complete leaves the item blocked, so no landing will ever be due), or a run that settled
      // failed and left no live successor (the auto ladder may accept a retry, which keeps this false), means the
      // landing will not come.
      const FAILED_WORK_STATES = new Set(["settled-failed", "settled-unrecoverable", "failed-before-provider"]);
      const runsBlocked = () => workRuns(rt).some((run) => run.body.state === "blocked")
        || workItems(rt).some((item) => item.body.status === "blocked" || item.body.status === "held")
        || (workRuns(rt).length > 0 && workRuns(rt).every((run) => FAILED_WORK_STATES.has(run.body.state ?? "")));
      const tasksDone = () => { const tasks = workItems(rt).filter((item) => item.body.kind === undefined || item.body.kind === "task"); return tasks.length > 0 && tasks.every((item) => item.body.status === "done"); };
      if (forcePartial) {
        const crashed = await waitFor("the landing's crash after alpha publishes", () => rt.driver?.crashed === "multi-land-after-publish:alpha" && sibling !== null, runsBlocked);
        summary.crashObserved = rt.driver?.crashed ?? null;
        summary.landingAtCrash = landingOf(rt);
        checks.crashAfterAlpha = crashed;
        if (!crashed) throw new Error(`the forced partial did not happen: landing ${JSON.stringify(summary.landingAtCrash)}; work items ${JSON.stringify(workItems(rt).map((item) => [item.id, item.body.status]))}; work runs ${JSON.stringify(workRuns(rt).map((run) => [run.task, run.body.state, run.body.drive?.stopReason ?? null]))}`);
        // A process death: no shutdown identity, just the store let go; the next boot's recovery replays the journal.
        summary.processDeath = true;
        rt.close();
        rt = await boot();
        rt.startPump(200);
      }
      const partial = await waitFor("the partial landing", () => { const landing = landingOf(rt); return landing !== null && landing.state === "partial"; },
        () => !forcePartial && (workRuns(rt).length > 0 && workRuns(rt).every((run) => run.body.drive?.cleanedUp === true) && landingOf(rt)?.state === "landed") || runsBlocked());
      let landing = landingOf(rt);
      summary.landingPartial = landing;
      if (forcePartial) {
        checks.partialObserved = partial && landing !== null && landing.state === "partial" && landing.reason === "multi-dir-target-moved:beta"
          && landing.pending !== null && JSON.stringify(landing.pending.landed) === JSON.stringify(["alpha"]);
        // The person's sibling is what beta holds now; alpha's target stays where the first publish put it.
        checks.betaMovedBeforeRetry = sibling !== null && g(beta, "rev-parse", "refs/heads/main") === sibling;
        summary.alphaMainAfterPartial = g(alpha, "rev-parse", "refs/heads/main");
        if (!checks.partialObserved) throw new Error(`no partial landing to answer: ${JSON.stringify(landing)}`);
        const retry = rt.service.multiDirLanding(raw(rt, "retry-rest", "multi-dir-landing", { action: "retry-rest" }));
        summary.retryRest = retry;
        checks.retryRestAccepted = !("error" in retry);
        if (!checks.retryRestAccepted) throw new Error(`multi-dir-landing retry-rest refused: ${JSON.stringify(retry)}`);
        log("answered retry-rest");
      }
      const landed = await waitFor("every directory to land", () => { const current = landingOf(rt); return current !== null && current.state === "landed" && current.pending === null; }, runsBlocked);
      landing = landingOf(rt);
      summary.landing = landing;
      checks.landed = landed;
      summary.workItems = workItems(rt).map((item) => ({ id: item.id, status: item.body.status }));
      summary.workRuns = workRuns(rt).map((run) => ({ runId: run.runId, task: run.task, state: run.body.state, dirs: workspaceOfDirs(run) }));
      if (landed && landing !== null) {
        // Every member's own record: the work item's writes (Orca's frozen split), the run's prepared dirs (the primary's
        // workspace and one `--add-dir` workspace per extra member), and each target's content after the landing.
        const plan = readArchivedPlan(rt.store, "g").plan;
        const writes = plan.tasks.flatMap((task) => (taskWrites(rt.store, "g", task.taskId) ?? []).map((write) => ({ taskId: task.taskId, dir: write.dir, targetPaths: write.targetPaths })));
        summary.writes = writes;
        checks.writesSpanDirs = plan.tasks.some((task) => (taskWrites(rt.store, "g", task.taskId) ?? []).length >= 2);
        const dirs = workRuns(rt).flatMap(workspaceOfDirs);
        summary.driveDirs = dirs;
        checks.extraWorkspacesPrepared = ["alpha", "beta", "notes"].every((key) => dirs.some((dir) => dir.key === key))
          && dirs.filter((dir) => dir.key !== "alpha").every((dir) => dir.workspacePath !== dirs.find((other) => other.key === "alpha")?.workspacePath);
        const alphaVersion = JSON.parse(g(alpha, "show", `refs/heads/main:package.json`) as string).version as string;
        const betaVersion = JSON.parse(g(beta, "show", "refs/heads/main:package.json") as string).version as string;
        const versionFile = existsSync(join(notes, "VERSION")) ? readFileSync(join(notes, "VERSION"), "utf8") : null;
        summary.landedContent = { alphaVersion, betaVersion, versionFile, lastLanded: landing.lastLanded };
        checks.alphaLanded = alphaVersion === "0.2.0" && landing.lastLanded.alpha !== undefined;
        checks.betaLanded = betaVersion === "0.2.0" && landing.lastLanded.beta !== undefined;
        // The contract's own check is `grep -qx 0.2.0 VERSION`, so a missing trailing newline is a pass there too.
        checks.notesLanded = (versionFile ?? "").trimEnd() === "0.2.0" && landing.lastLanded.notes !== undefined;
        // The person's sibling is still an ancestor of beta's main: the retry landed on top of it, not over it.
        checks.betaKeptPersonChange = sibling === null || isAncestor(sibling, "refs/heads/main");
        summary.landedHistory = {
          alpha: g(alpha, "log", "--format=%h %s", `${alphaBase}..refs/heads/main`).split("\n").filter(Boolean),
          beta: g(beta, "log", "--format=%h %s", `${sibling ?? betaBase}..refs/heads/main`).split("\n").filter(Boolean),
        };
      }
    }
  }
  summary.used = readWebGroup(rt.store, "g").used;
} catch (error) {
  failure = error;
  summary.workRunsAtFailure = runtime === null ? [] : workRuns(runtime).map((run) => ({ runId: run.runId, task: run.task, state: run.body.state, stopReason: run.body.drive?.stopReason ?? null }));
} finally {
  summary.timedOut = timedOut;
  const collected = evidenceRoots();
  await stopRuntime();
  // Outer watchdog: whatever the ending, no agent process group ccloop registered may outlive this script.
  const killed: number[] = [];
  for (const file of collected.flatMap((dir) => findAll(dir, "process.json"))) {
    const { pgid } = JSON.parse(readFileSync(file, "utf8")) as { pgid: number };
    try { process.kill(-pgid, "SIGKILL"); killed.push(pgid); } catch { /* already gone */ }
  }
  summary.killedProcessGroups = killed;
}

// claude's own figures from each kept stream's result envelope, its argv beside it (where --add-dir is observed).
const claudeCalls = kind === "claude" && existsSync(claudeRaw) ? readdirSync(claudeRaw).filter((name) => name.endsWith(".json") && !name.endsWith(".argv.json")).sort().map((name) => {
  const lines = readFileSync(join(claudeRaw, name), "utf8").trim().split("\n");
  const envelope = lines.map((line) => { try { return JSON.parse(line) as Record<string, unknown>; } catch { return null; } }).filter((value) => value?.type === "result").at(-1) ?? null;
  const argvPath = join(claudeRaw, name.replace(/\.json$/, ".argv.json"));
  const argv = existsSync(argvPath) ? JSON.parse(readFileSync(argvPath, "utf8")) as string[] : [];
  const at = argv.lastIndexOf("--add-dir");
  const addDirs = at < 0 ? [] : argv.slice(at + 1).filter((arg) => !arg.startsWith("-"));
  return { name, costUsd: envelope?.total_cost_usd ?? null, durationMs: envelope?.duration_ms ?? null, isError: envelope?.is_error ?? null, usage: envelope?.usage ?? null, addDirs };
}) : [];
if (kind === "claude") {
  summary.claudeCalls = claudeCalls;
  summary.claudeCostUsdSum = claudeCalls.reduce((sum, call) => sum + (typeof call.costUsd === "number" ? call.costUsd : 0), 0);
  const extraWorkspaces = (summary.driveDirs as Array<{ key: string; workspacePath: string }> | undefined)?.filter((dir) => dir.key !== "alpha").map((dir) => dir.workspacePath) ?? [];
  checks.claudeAddDir = extraWorkspaces.length > 0 && claudeCalls.some((call) => extraWorkspaces.every((path) => call.addDirs.includes(path)));
}
checks.orcaHomeUnchanged = JSON.stringify(snapshot(orcaHome)) === JSON.stringify(orcaHomeBefore);
if (kind === "claude") checks.claudeProjectsUnchanged = JSON.stringify(claudeProjectsList()) === JSON.stringify(claudeProjectsBefore);
if (kind === "codex") { summary.codexConfigBefore = codexConfigBefore; summary.codexConfigAfter = existsSync(codexConfig) ? sha256File(codexConfig) : "<absent>"; }
if (fakeOmp) { summary.fakeOmpCalls = fakeCalls(); checks.fakeOmpLaunched = fakeCalls() >= 3; }
// A run that ended early still leaves its evidence: the error and the work runs' last states go into summary.json, and
// the exit is a failure whatever the checks that were reached said.
if (failure !== null) {
  summary.error = failure instanceof Error ? `${failure.name}: ${failure.message}` : String(failure);
  checks.failure = false;
}
checks.notTimedOut = !timedOut;
summary.checks = checks;
summary.finishedAt = new Date().toISOString();
await writeFile(join(root, "summary.json"), JSON.stringify(summary, null, 2));
const ok = Object.values(checks).length > 0 && Object.values(checks).every(Boolean);
log(`checks ${JSON.stringify(checks)}`);
log(`summary.json sha256 ${sha256File(join(root, "summary.json"))}`);
process.exit(ok ? 0 : 1);
