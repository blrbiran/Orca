/**
 * Dir-requirements spec §6.5, §7, §8, §10, criterion D5 (plan Task 4; its placement assertions Task 5b):
 * a requirement opened on a registered `dir` project runs end to end through the assembled panel -- its pump, the real
 * execution driver and the pinned ccloop build (ORCA_CCLOOP_BIN) with ccloop's CLI-level fakes (fake claude answers the
 * single calls from a queue; fake codex in mode `reported` writes answer.txt and reports one decision) -- with the
 * folder's vault as the target repository:
 * - open → two clarify rounds → consensus → split → accept → export → estimate → confirm → the automatic start;
 * - both tasks land on the vault's `orca/<g>`, and every landing records its new tip as `placement.landedTip` in the
 *   write that records it (observed at each landing's crash point: the value before is the previous landing's tip);
 * - the placement pass then writes the landed work into the folder: answer.txt, and none of Orca's own paths (no
 *   `.decisions/` file of the group's, no `.orca/requirements/` document);
 * - the decisions view (the panel's route) lists the landed decision with `where: "group-branch"`, reads the group
 *   branch only, and never a folder's own `.decisions/` file, which stays byte-equal;
 * - the group has no integration record although its project's repo id has a non-keep default, and the integration
 *   pass runs no git child for it.
 * Pattern: tests/flow/vaultDriverProbe.test.ts (C14) and tests/control/requirementE2E.test.ts.
 *
 * The last describe pins `ledgerSources` for a dir group on a bare repository directly (no ccloop): the group branch
 * only, and a base holding a `.decisions/` file is a broken invariant (`recovery-blocked`).
 *
 * Rule 17: HOME and the XDG roots are relocated for the describe (relocateHome); ORCA_VAULT_DIR, ORCA_CONTROL_DIR and
 * ORCA_PROJECTS_FILE point under temporary roots, in the runtime's env and in process.env.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterAll, describe, expect, it, vi } from "vitest";
import { resolveGroupSelections } from "../../src/control/agentFreeze.js";
import { sha256Canonical } from "../../src/control/canonicalJson.js";
import { readPlacement } from "../../src/control/dirGroup.js";
import type { CrashPoint } from "../../src/control/executionDriver.js";
import { integratePendingGroups } from "../../src/control/integrationPass.js";
import { ledgerSources } from "../../src/control/ledgerAtRef.js";
import { normalizeControlPlan } from "../../src/control/planImport.js";
import { readArchivedPlan, readBudgetProposal, readEstimateRecord } from "../../src/control/queries.js";
import { CLARIFY_PROMPT_HEAD } from "../../src/control/requirementClarify.js";
import { readDraft, readRequirementGroup, readRound } from "../../src/control/requirementRecords.js";
import { SPLIT_PROMPT_HEAD } from "../../src/control/requirementSplit.js";
import type { ControlStore } from "../../src/control/store.js";
import { controlWorkspaceRoots } from "../../src/control/workspace.js";
import { writeRepositorySettingsBody } from "../../src/control/workspaceSettings.js";
import { vaultKeyOf } from "../../src/flow/vault/paths.js";
import { registerControlReadRoutes, verifyControlJsonBody, type ControlReadApiDeps } from "../../src/panel/controlApi.js";
import type { ControlRuntime } from "../../src/panel/controlAssembly.js";
import { controlRepoKey } from "../../src/panel/controlOptions.js";
import type { Principal } from "../../src/panel/permissions.js";
import { schedulerControlPlanSourceOf } from "../../src/scheduler/planFile.js";
import { ccloopWorlds, g, noBlocked, raw, realBinary, until, workRuns } from "./fixtures/ccloopWorld.js";
import { ROUND_ONE, ROUND_TWO, VALID_SPLIT } from "./fixtures/requirementOutputs.js";
import { openTestStore } from "./fixtures/store.js";

const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-dir-requirement-e2e-", epochPrefix: "epoch-dir-requirement-e2e-" });
const ownRoots: string[] = [];
afterAll(async () => { await removeRoots(); for (const root of ownRoots) await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });

const DECISION = {
  question: "Where does the answer go?", chose: "answer.txt", alternatives: [{ option: "README.md", why_not: "the folder's own" }], because: "it is asked for",
  undo: { how: `git revert --no-edit ${"b".repeat(40)}`, cost: "small", blast_radius: "answer.txt" }, scope: "file", kind: "implementation", importance: "major",
};
/** The folder's own ledger line: a decision Orca never wrote, so it must never be read as one of the group's. */
const OWN_LEDGER = `${JSON.stringify({ ev: "decision", id: "own-folder-decision-1", question: "mine", chose: "mine" })}\n`;
/**
 * VALID_SPLIT with both tasks independent, so both start from the document commit and each attempt adds answer.txt (a
 * dependent task would start on the first landing, find answer.txt already "42" and have no change to land).
 */
const PARALLEL_SPLIT = { ...VALID_SPLIT, tasks: VALID_SPLIT.tasks.map((task) => ({ ...task, dependsOn: [] })), notes: "Two independent tasks." };
const LOCAL = { delivery: "local", trigger: "task", method: "merge", target: "main" } as const;
const estimateFor = (planHash: string) => ({ schema: "budget-estimate-v1", planHash, groupRationale: "two small tasks",
  goalReviewReserve: { tokens: 50_000, activeMs: 60_000, attempts: 1, sessions: 1 },
  tasks: ["exporter", "images"].map((taskId) => ({ taskId, complexity: "S", confidence: "high", work: { tokens: 180_000, activeMs: 200_000, attempts: 1, sessions: 1 },
    handoff: { tokens: 10_000, activeMs: 30_000, attempts: 0, sessions: 0 }, rationale: "one new file", assumptions: ["the file does not exist yet"] })) });
const answerAll = (runtime: ControlRuntime, roundNo: number, commandId: string) => {
  const result = readRound(runtime.store, "g", roundNo).result!;
  return runtime.service.answerRequirement(raw(runtime, commandId, "requirement-answer", { roundNo,
    answers: result.questions.map((q) => ({ id: q.id, kind: "recommended" })), glossaryDecisions: result.glossary.map((e) => ({ id: e.id, accept: true })), adrDecisions: result.adrs.map((a) => ({ id: a.id, accept: true })) }));
};
/** As requirementE2E.test.ts: the plan hash the accept will archive, so the estimate's queued answer can echo it. */
const planHashOfDraft = (runtime: ControlRuntime, draftNo: number): string => {
  const stored = readDraft(runtime.store, "g", draftNo).plan as { targetRepo: string };
  return sha256Canonical(normalizeControlPlan({ ...schedulerControlPlanSourceOf(stored, stored.targetRepo), repoId: readRequirementGroup(runtime.store, "g").requirement.repoId, planId: `requirement-draft-${draftNo}` }));
};
const bodyOf = (store: ControlStore): Record<string, unknown> => JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));

/** Runs `body` with a `git` first on PATH that logs each invocation (one line per call) and then runs the real git. */
async function countingGit<T>(dir: string, body: () => Promise<T>): Promise<{ value: T; calls: number }> {
  const real = execFileSync("/bin/sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  const log = join(dir, "calls");
  mkdirSync(dir, { recursive: true });
  writeFileSync(log, "");
  writeFileSync(join(dir, "git"), `#!/bin/sh\necho "$*" >> "${log}"\nexec "${real}" "$@"\n`);
  chmodSync(join(dir, "git"), 0o755);
  const saved = process.env.PATH;
  process.env.PATH = `${dir}:${saved ?? ""}`;
  try { const value = await body(); return { value, calls: readFileSync(log, "utf8").split("\n").filter((line) => line.length > 0).length }; }
  finally { process.env.PATH = saved; }
}

/** The panel's read routes over the runtime (the decisions route among them), as the Web reaches them. */
async function serveReadRoutes(runtime: ControlRuntime) {
  const deps: ControlReadApiDeps = { store: runtime.store, epoch: runtime.epoch, config: { readView: async () => ({}) } as never, service: runtime.service };
  const app = express();
  app.use((_req, res, next) => { res.locals.orcaPrincipal = { kind: "user", userId: "u", name: "u", roles: ["owner"] } satisfies Principal; next(); });
  app.use(express.json({ verify: verifyControlJsonBody }));
  registerControlReadRoutes(app, deps, "web");
  const server = createServer(app);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("address");
  return {
    get: async (path: string) => { const res = await fetch(`http://127.0.0.1:${address.port}${path}`); return { status: res.status, body: await res.json() as unknown }; },
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

describe.skipIf(!realBinary)("a requirement on a dir project, end to end against real ccloop (D5)", { timeout: 420_000 }, () => {
  relocateHome("orca-dir-requirement-e2e-home-");

  it("lands both tasks on the vault's orca/<g>, records each landed tip, places them into the folder, lists the landed decision from the group branch, and never integrates", async () => {
    const own = await realpath(await mkdtemp(join(tmpdir(), "orca-dir-requirement-e2e-own-")));
    ownRoots.push(own);
    const folder = join(own, "notes"), vaults = join(own, "vaults"), projectsFile = join(own, "projects.json");
    mkdirSync(join(folder, "src"), { recursive: true });
    mkdirSync(join(folder, ".decisions"));
    writeFileSync(join(folder, "README.md"), "# Notes\nA note-taking tool.\n");
    writeFileSync(join(folder, "src", "a.ts"), "export const a = 1;\n");
    writeFileSync(join(folder, ".decisions", "own.jsonl"), OWN_LEDGER);
    const ownBefore = readFileSync(join(folder, ".decisions", "own.jsonl"));
    vi.stubEnv("ORCA_VAULT_DIR", vaults);
    vi.stubEnv("ORCA_PROJECTS_FILE", projectsFile);
    const w = await world([], {}, { claudeScript: {}, declaredContextWindowTokens: 1_000_000, env: { ORCA_VAULT_DIR: vaults, ORCA_PROJECTS_FILE: projectsFile },
      extraRepos: [{ projectKey: "notes", path: folder, kind: "dir" }] });
    vi.stubEnv("ORCA_CONTROL_DIR", join(w.root, "control"));
    // Fake codex in mode `reported` (as flowCcloopWorld.ts sets it): its execute writes answer.txt ("42") and reports DECISION.
    const codex = w.agentsTable.installations.codex!;
    const command = codex.command as string[];
    codex.command = [command[0]!, command[1]!, "reported", command[3]!];
    writeFileSync(w.table, JSON.stringify(w.agentsTable), { mode: 0o600 });
    writeFileSync(`${command[3]!}.reported.json`, JSON.stringify({ decisions: [DECISION] }));
    const queue = [
      { match: CLARIFY_PROMPT_HEAD, output: ROUND_ONE }, { match: CLARIFY_PROMPT_HEAD, output: ROUND_TWO }, { match: SPLIT_PROMPT_HEAD, output: PARALLEL_SPLIT },
    ];
    writeFileSync(w.claudeScriptPath, JSON.stringify({ "single-call-queue": queue }));
    const real = realpathSync(folder).normalize("NFC");
    const vault = join(vaults, `${vaultKeyOf(real)}.git`);
    const repoId = controlRepoKey("notes");
    // Every work-branch move of a landing, observed at its crash point (after the swap, before the write that records it).
    const moves: Array<{ point: CrashPoint; tip: string; landedTipBefore: string | null }> = [];
    let store: ControlStore | null = null;
    const runtime = await w.boot((point) => {
      if (point !== "D-after-cas" && point !== "E-after-ledger-cas") return;
      moves.push({ point, tip: g(vault, "rev-parse", "refs/heads/orca/g"), landedTipBefore: readPlacement(bodyOf(store!).placement)?.landedTip ?? null });
    });
    store = runtime.store;
    let routes: Awaited<ReturnType<typeof serveReadRoutes>> | null = null;
    try {
      const prefs = await runtime.service.setAgentPreferences(raw(runtime, "prefs", "set-agent-preferences",
        { preferences: { defaultAgent: "codex", perAgent: {}, estimator: { agent: "claude", contextWindow: 1_000_000 } } }, { kind: "operator", operatorId: "human" }));
      expect("error" in prefs ? prefs.error : "set").toBe("set");
      // The project's repo id has a non-keep default (set-integration-scheme refuses it on a dir project, so written here):
      // a dir group must still get no integration record.
      writeRepositorySettingsBody(runtime.store, repoId, { workspaceMode: "worktree", revision: 1, integration: LOCAL });
      const opened = await runtime.service.openRequirement({ schema: "orca-raw-command-v1", commandId: "open", actorId: "human", expectedRevision: 0, verb: "requirement-open",
        target: { kind: "group", groupId: "g" }, payload: { groupId: "g", repoId, idea: "Let people export their notes as Markdown.", contentLanguage: "en" } } as never);
      expect(opened).toMatchObject({ result: { kind: "requirement-opened" } });
      expect(bodyOf(runtime.store).dirWorkspace).toEqual({ dir: real, vaultId: vaultKeyOf(real) });
      runtime.startPump(50);
      await until(() => readRound(runtime.store, "g", 1).state === "awaiting-answers", 90_000, "round 1", 50);
      answerAll(runtime, 1, "answer-1");
      await until(() => readRound(runtime.store, "g", 2).state === "awaiting-answers", 90_000, "round 2", 50);
      expect(answerAll(runtime, 2, "answer-2")).toMatchObject({ result: { nextRoundNo: null } });
      expect(runtime.service.requirementConsensus(raw(runtime, "consensus", "requirement-consensus", { roundNo: 2 }))).toMatchObject({ result: { draftNo: 1 } });
      await until(() => { try { return readDraft(runtime.store, "g", 1).state === "awaiting-review"; } catch { return false; } }, 90_000, "draft 1", 50);
      const planHash = planHashOfDraft(runtime, 1);
      writeFileSync(w.claudeScriptPath, JSON.stringify({ "single-call-queue": [...queue, { match: "budget-estimate-request-v1", output: estimateFor(planHash) }] }));
      const accepted = await runtime.service.acceptRequirementDraft(raw(runtime, "accept", "requirement-draft-accept", { draftNo: 1, draftHash: readDraft(runtime.store, "g", 1).draftHash! }));
      expect(accepted).toMatchObject({ result: { kind: "requirement-draft-accepted", estimateState: "queued" } });
      expect(readArchivedPlan(runtime.store, "g").planHash).toBe(planHash);
      // §7: no integration record, though the repo id's default is local.
      expect(Object.hasOwn(bodyOf(runtime.store), "integration")).toBe(false);
      const estimateId = (accepted as { result: { estimateId: string } }).result.estimateId;
      await until(() => readEstimateRecord(runtime.store, "g", estimateId).state === "ready" && readRequirementGroup(runtime.store, "g").requirement.export.state === "done", 120_000, "the estimate and the export", 50);
      const documentCommit = readRequirementGroup(runtime.store, "g").requirement.export.commit!;
      expect(g(vault, "rev-parse", "refs/heads/orca/g")).toBe(documentCommit);
      expect(readPlacement(bodyOf(runtime.store).placement)).toMatchObject({ landedTip: documentCommit });
      // The pinned legacy peer is exercised with explicit finite task ceilings through the owner API (as requirementE2E).
      if ((await runtime.port.readFeatures?.())?.tokenPolicy !== "optional-v1") {
        for (const task of readArchivedPlan(runtime.store, "g").plan.tasks) {
          const work = readBudgetProposal(runtime.store, "g").allocations.find((a) => a.ownerId === task.taskId && a.bucket === "work")!.amount;
          expect(await runtime.service.setTaskLoop(raw(runtime, `finite-${task.taskId}`, "set-task-loop", { baseLoopVersion: 0, plan: task.loop!.planId, inputs: task.loop!.inputs,
            work: { tokens: 3_000_000, activeMs: work.activeMs, attempts: work.attempts } }, { kind: "task", groupId: "g", taskId: task.taskId }))).not.toHaveProperty("error");
        }
      }
      const selections = await resolveGroupSelections({ store: runtime.store, port: runtime.port }, "g", "human");
      const profile = runtime.router.list()[0]!, hash = profile.profileHash;
      const confirmed = await runtime.service.confirm(raw(runtime, "confirm", "confirm", { planHash: readArchivedPlan(runtime.store, "g").planHash, proposalVersion: readBudgetProposal(runtime.store, "g").proposalVersion,
        budgetMode: "soft", profileIds: { estimator: "all", worker: "all", handoff: "all", goalReview: "all" }, profileHashes: { estimator: hash, worker: hash, handoff: hash, goalReview: hash },
        contextPolicy: { handoffAtContextTokens: profile.snapshot.profile.capabilities.contextWindowTokens }, selectionsHash: selections.selectionsHash }));
      expect("error" in confirmed ? confirmed.error : "confirmed").toBe("confirmed");
      const taskStatus = (taskId: string): string => JSON.parse(String(runtime.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body)).status;
      // A timeout names where each task and run stood, not only that time ran out.
      await until(() => { noBlocked(runtime); return ["exporter", "images"].every((taskId) => taskStatus(taskId) === "done")
        && workRuns(runtime).every((run) => run.body.drive?.cleanedUp === true); }, 300_000, "both tasks to land", 100)
        .catch((error: Error) => { throw new Error(`${error.message}; tasks ${JSON.stringify(["exporter", "images"].map(taskStatus))}; runs ${JSON.stringify(workRuns(runtime).map((run) => [run.task, run.body.state, run.body.drive?.blockedReason ?? null, run.body.drive?.cleanedUp ?? null]))}; group ${JSON.stringify({ status: bodyOf(runtime.store).status })}`); });

      // Both landings are on the vault's orca/g, each the work-branch move its run recorded.
      const tip = g(vault, "rev-parse", "refs/heads/orca/g");
      const firstParent = g(vault, "rev-list", "--first-parent", `${documentCommit}..${tip}`).split("\n");
      const runs = workRuns(runtime);
      expect(runs.map((run) => run.task).sort()).toEqual(["exporter", "images"]);
      const moved = runs.map((run) => run.body.drive.landedCommit ?? run.body.drive.ledgerCommit);
      for (const [index, run] of runs.entries()) {
        expect(run.body.drive.targetRepo).toBe(vault);
        expect(firstParent).toContain(moved[index]);
      }
      expect(g(vault, "show", "refs/heads/orca/g:answer.txt")).toBe("42");
      // §6.5: each landing recorded its tip in the write that recorded the move: at the second move's crash point the
      // record holds the first move's tip, and at the end the last one's; the export's document commit came before both.
      expect(moves.map((move) => move.tip).sort()).toEqual([...moved].sort());
      expect(moves.map((move) => move.landedTipBefore)).toEqual([documentCommit, moves[0]!.tip]);
      expect(moves[1]!.tip).toBe(tip);
      expect(readPlacement(bodyOf(runtime.store).placement)).toMatchObject({ state: "idle", landedTip: tip });

      // §10: the decisions view, through the panel's route, reads the group branch of the vault only.
      expect(await ledgerSources(runtime.store, vault, "g")).toEqual([{ where: "group-branch", ref: "refs/heads/orca/g" }]);
      routes = await serveReadRoutes(runtime);
      const view = await routes.get("/api/control/groups/g/decisions");
      expect(view.status).toBe(200);
      const decisions = (view.body as { tasks: Array<{ runs: Array<{ decisions: Array<{ question: string; where: string }> }> }> }).tasks
        .flatMap((task) => task.runs.flatMap((run) => run.decisions));
      expect(decisions.filter((decision) => decision.question === DECISION.question).map((decision) => decision.where)).toEqual(["group-branch", "group-branch"]);
      expect(JSON.stringify(view.body)).not.toContain("own-folder-decision-1");
      // The folder's own ledger file is untouched, and no landing commit in the vault carries it.
      expect(readFileSync(join(folder, ".decisions", "own.jsonl")).equals(ownBefore)).toBe(true);
      expect(g(vault, "ls-tree", "-r", "--name-only", tip, "--", ".decisions/").split("\n")).not.toContain(".decisions/own.jsonl");
      // §8: the driver's placement pass writes the landed work into the folder: both tasks' file (answer.txt), and none of
      // Orca's own paths -- no `.decisions/` file of the group's (the folder's own ledger file is all that is there) and no
      // `.orca/requirements/` document.
      await until(() => readPlacement(bodyOf(runtime.store).placement)?.tip === tip, 60_000, "the placement of both landings", 100);
      expect(readPlacement(bodyOf(runtime.store).placement)).toMatchObject({ state: "idle", tip, landedTip: tip, pending: null, changed: [], unwritable: [] });
      expect(readFileSync(join(folder, "answer.txt"), "utf8").trim()).toBe("42");
      expect(readdirSync(join(folder, ".decisions"))).toEqual(["own.jsonl"]);
      expect(existsSync(join(folder, ".orca"))).toBe(false);
      expect(g(vault, "for-each-ref", "refs/orca/group/g/pending")).toBe("");

      expect(await runtime.shutdown()).toBe(true);
      // §7: no integration record, and the integration pass runs no git child for the group.
      expect(Object.hasOwn(bodyOf(runtime.store), "integration")).toBe(false);
      const asked: string[] = [];
      const { value: integrated, calls } = await countingGit(join(own, "count"), () => integratePendingGroups({
        store: runtime.store, roots: controlWorkspaceRoots(runtime.store.stateDir), now: () => Date.now(), ghBin: "gh", stopped: () => false,
        repoPathOf: (id) => { asked.push(id); throw new Error("no repository is resolved for a dir group"); },
      }));
      expect(integrated).toBe(false);
      expect(calls).toBe(0);
      expect(asked).toEqual([]);
    } finally { await routes?.close(); vi.unstubAllEnvs(); await w.teardown(); }
  });
});

describe("a dir group's ledger sources (§10)", () => {
  /** A bare repository (as a vault) with `refs/orca/group/g/base` at a commit holding `files`, and a dir group "g" row. */
  async function vaultWith(files: Record<string, string> | null) {
    const root = await realpath(await mkdtemp(join(tmpdir(), "orca-dir-ledger-sources-")));
    ownRoots.push(root);
    const vault = join(root, "vault.git");
    execFileSync("git", ["init", "-q", "--bare", vault]);
    if (files !== null) {
      const lines = Object.entries(files).map(([path, text]) => {
        const blob = execFileSync("git", ["--git-dir", vault, "hash-object", "-w", "--stdin"], { input: text, encoding: "utf8" }).trim();
        const [dir, name] = path.split("/");
        return { dir: name === undefined ? null : dir!, entry: `100644 blob ${blob}\t${name ?? path}` };
      });
      const top = lines.filter((line) => line.dir === null).map((line) => line.entry);
      const nested = lines.filter((line) => line.dir !== null);
      if (nested.length > 0) {
        const sub = execFileSync("git", ["--git-dir", vault, "mktree"], { input: `${nested.map((line) => line.entry).join("\n")}\n`, encoding: "utf8" }).trim();
        top.push(`040000 tree ${sub}\t${nested[0]!.dir}`);
      }
      const tree = execFileSync("git", ["--git-dir", vault, "mktree"], { input: `${top.join("\n")}\n`, encoding: "utf8" }).trim();
      const commit = execFileSync("git", ["--git-dir", vault, "-c", "user.name=t", "-c", "user.email=t@t", "commit-tree", tree, "-m", "orca: import"], { encoding: "utf8" }).trim();
      execFileSync("git", ["--git-dir", vault, "update-ref", "refs/orca/group/g/base", commit]);
    }
    const h = await openTestStore();
    h.store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES ('g',0,1,?)")
      .run(JSON.stringify({ groupId: "g", dirWorkspace: { dir: "/nowhere/notes", vaultId: "e".repeat(64) }, integration: { scheme: LOCAL } }));
    return { vault, store: h.store, dispose: h.dispose };
  }

  it("answers the group branch only, also before any base exists, and refuses a base that holds a .decisions/ file", async () => {
    for (const [files, answer] of [
      [{ "README.md": "# Notes\n" }, "group-branch"],
      [null, "group-branch"],
      [{ "README.md": "# Notes\n", ".decisions/own.jsonl": OWN_LEDGER }, "recovery-blocked"],
    ] as const) {
      const v = await vaultWith(files); try {
        if (answer === "group-branch") expect(await ledgerSources(v.store, v.vault, "g")).toEqual([{ where: "group-branch", ref: "refs/heads/orca/g" }]);
        else await expect(ledgerSources(v.store, v.vault, "g")).rejects.toMatchObject({ code: "recovery-blocked", message: expect.stringContaining("dir-base-holds-decisions") });
      } finally { await v.dispose(); }
    }
  });
});
