/**
 * Multi-directory projects spec §8.1-§8.2 and §10, criterion M9, against the pinned ccloop: every written directory
 * lands on its own work branch, with the run's ledger only in the group primary's commit -- a ledger-only commit on the
 * primary's tip when the primary was not written. A death after the first compare-and-swap replays without merging the
 * first directory again; a conflict in any directory swaps nothing and blocks by that directory's name.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { writeArtifact } from "../../src/control/archive.js";
import { landedUnrecorded } from "../../src/control/driverHandoff.js";
import { DriverCrash, readDriverRun, savedReport } from "../../src/control/executionDriver.js";
import { listFlaggedDecisions } from "../../src/control/flaggedDecisions.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import type { ControlRuntime } from "../../src/panel/controlAssembly.js";
import { ccloopWorlds, g, realBinary, startGroup, workRuns, type World } from "./fixtures/ccloopWorld.js";

const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-multi-landing-", epochPrefix: "epoch-multi-landing-" });
afterAll(removeRoots);

const LANDED = ["landed", "settled"];
const DECISION = {
  question: "q", chose: "c", alternatives: [{ option: "o", why_not: "w" }], because: "b",
  undo: { how: `git revert --no-edit ${"b".repeat(40)}`, cost: "c", blast_radius: "r" },
  scope: "task", kind: "interface",
};

const state = (runtime: ControlRuntime, runId: string): string | undefined =>
  workRuns(runtime).find((run) => run.runId === runId)?.body.state;
const driveOf = (runtime: ControlRuntime, runId: string): Record<string, any> =>
  workRuns(runtime).find((run) => run.runId === runId)!.body.drive;

/** Rounds by hand (no pump): the driver's steps, one round at a time, so each stop is a stop. */
async function driveUntil(runtime: ControlRuntime, predicate: () => boolean, ms: number, what: string): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await runtime.driver!.round();
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!predicate()) throw new Error(`timed out waiting for ${what}`);
}

/** The world with a second directory, and the expanded contract a multi split would freeze: repoKey "main", extra "alpha". */
async function multiWorld(): Promise<World> {
  const w = await world([{ taskId: "a", targetPaths: ["**"] }], { a: { files: {}, delayMs: { plan: 4_000 } } },
    { multiRepo: { projectKey: "alpha", dirName: "alpha" } });
  // The extra contract's targetPaths name `src/**`; the fake agent writes into existing directories only.
  await mkdir(join(w.multiRepo!, "src"));
  await writeFile(join(w.multiRepo!, "src", ".gitkeep"), "");
  await writeFile(join(w.multiRepo!, "src", "check.ts"), "export const check = 1;\n");
  g(w.multiRepo!, "add", "src/.gitkeep", "src/check.ts");
  g(w.multiRepo!, "commit", "-qm", "src");
  const contractPath = join(w.root, "contracts", "a.json");
  const contract = JSON.parse(await readFile(contractPath, "utf8")) as { context: Record<string, unknown> };
  contract.context.repoKey = "main";
  contract.context.additionalRepos = [{ key: "alpha", repoPath: w.multiRepo, targetPaths: ["src/**"], allowlistPaths: [], requiredChecks: ["true"] }];
  await writeFile(contractPath, JSON.stringify(contract));
  return w;
}

/**
 * An ordinary contract rooted at the extra, as a one-directory write set is frozen (O5 keeps such a contract unchanged).
 * Its required check names `src/check.ts`, so a change to that file is only classifiable through the contract's own checks.
 */
async function contractRootedAtAlpha(w: World): Promise<void> {
  const path = join(w.root, "contracts", "a.json");
  const contract = JSON.parse(await readFile(path, "utf8")) as { context: Record<string, unknown>; verification: { requiredChecks: string[] } };
  delete contract.context.additionalRepos;
  delete contract.context.repoKey;
  contract.context.repoPath = w.multiRepo!;
  contract.context.targetPaths = ["src/**"];
  contract.verification.requiredChecks = ["true src/check.ts"];
  await writeFile(path, JSON.stringify(contract));
}

/** The frozen directories and the split's writes, written after confirmation and before start. */
function freeze(w: World, runtime: ControlRuntime, written: readonly ("main" | "alpha")[]): void {
  const group = JSON.parse(String(runtime.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;
  group.multiDir = { project: "multi", landing: null, dirs: [
    { key: "main", repoId: w.repoId, kind: "repo" }, { key: "alpha", repoId: w.multiRepoId, kind: "repo" },
  ] };
  runtime.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(group));
  const claims = { main: ["**"], alpha: ["src/**"] } as const;
  const row = runtime.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!;
  const work = JSON.parse(String(row.body)) as Record<string, unknown>;
  work.writes = written.map((dir) => ({ dir, targetPaths: [...claims[dir]], checks: [] }));
  runtime.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='a'").run(JSON.stringify(work));
}

/** Start, claim without a pump, wait for A2, then write the script whose execute writes the real attempt worktrees. */
async function collect(
  w: World, runtime: ControlRuntime, written: readonly ("main" | "alpha")[],
  files: (sourceDir: string) => Record<string, string>,
): Promise<string> {
  await startGroup(runtime, w.repoId, 0, async () => freeze(w, runtime, written));
  const delivered = await deliverScheduledStart({ store: runtime.store, profileRouter: runtime.router, admissionGate: runtime.admissionGate }, "g");
  if (delivered.kind !== "claimed") throw new Error(`claim refused: ${JSON.stringify(delivered)}`);
  const runId = delivered.runId;
  await driveUntil(runtime, () => {
    const run = workRuns(runtime).find((candidate) => candidate.runId === runId);
    if (run?.body.state === "blocked") throw new Error(`blocked before A2: ${String(run.body.drive?.blockedReason)}`);
    return run?.body.drive?.prepared === true;
  }, 60_000, "A2 prepared");
  // The script is re-read at each phase; plan waits, so execute sees these files (primary relative, extra absolute).
  await writeFile(join(w.root, "codex-script.json"), JSON.stringify({ a: { delayMs: { plan: 4_000 }, files: files(driveOf(runtime, runId).sourceDir) } }));
  await driveUntil(runtime, () => state(runtime, runId) === "collected" || state(runtime, runId) === "blocked", 300_000, "collection");
  return runId;
}

/** The fake agent reports no decisions; the landing's ledger proves itself with one written into the saved report. */
async function injectDecision(runtime: ControlRuntime, runId: string): Promise<void> {
  const report = await savedReport(runtime.store, runId);
  const source = await writeArtifact(runtime.store, "multi-dir-decisions-report", Buffer.from(JSON.stringify({ ...report, decisions: [DECISION] })));
  runtime.store.db.prepare("UPDATE outbox SET body=? WHERE id=?").run(JSON.stringify({ source }), `report:${runId}`);
}

/** A commit on the repository's work branch that changes `path` -- a sibling landing this run's attempt conflicts with. */
function commitToWorkBranch(repo: string, groupId: string, path: string, contents: string): string {
  const gitDir = join(repo, ".git"), index = join(gitDir, `orca-test-index-${randomUUID()}`);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    const old = g(repo, "rev-parse", `refs/heads/${groupId}`);
    execFileSync("git", ["read-tree", old], { cwd: repo, env });
    const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: repo, env, input: contents, encoding: "utf8" }).trim();
    execFileSync("git", ["update-index", "--add", "--cacheinfo", `100644,${blob},${path}`], { cwd: repo, env });
    const tree = execFileSync("git", ["write-tree"], { cwd: repo, env, encoding: "utf8" }).trim();
    const commit = execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit-tree", tree, "-p", old, "-m", "sibling landing"],
      { cwd: repo, env, encoding: "utf8" }).trim();
    g(repo, "update-ref", `refs/heads/${groupId}`, commit, old);
    return commit;
  } finally { rmSync(index, { force: true }); }
}

const worktreesOf = (repo: string): string[] =>
  g(repo, "worktree", "list", "--porcelain").split("\n").filter((line) => line.startsWith("worktree ")).map((line) => line.slice("worktree ".length));

/** Whether a commit's tree holds `path`; git's own stderr stays out of the test log. */
const inTree = (repo: string, commit: string, path: string): boolean => {
  try { execFileSync("git", ["-c", "core.hooksPath=/dev/null", "cat-file", "-e", `${commit}:${path}`], { cwd: repo, stdio: "pipe" }); return true; }
  catch { return false; }
};

describe.skipIf(!realBinary)("landing a multi run (§8.1)", { timeout: 420_000 }, () => {
  relocateHome("orca-multi-landing-home-");

  it("lands every written directory with the ledger only in the primary's commit", async () => {
    const w = await multiWorld();
    const runtime = await w.boot();
    const runId = await collect(w, runtime, ["main", "alpha"], (sourceDir) => ({
      "shared.txt": "A\n", [join(sourceDir, "run", "dirs", "attempt-1", "alpha", "src", "a.ts")]: "export const a = 1;\n",
    })).catch(async (error) => { w.die(runtime); await w.teardown(); throw error; });
    try {
      await injectDecision(runtime, runId);
      await driveUntil(runtime, () => LANDED.includes(state(runtime, runId)!), 120_000, "landing");
      const drive = driveOf(runtime, runId);
      const primaryTip = g(w.repo, "rev-parse", "refs/heads/orca/g");
      const alphaTip = g(w.multiRepo!, "rev-parse", "refs/heads/orca/g");
      expect(drive.landedDirs).toEqual({ main: primaryTip, alpha: alphaTip });
      expect(drive.landedCommit).toBe(primaryTip);
      expect(drive.landingPlan).toBe(null);
      // Each landing is a merge of that directory's own attempt into its own work branch.
      expect(g(w.repo, "rev-parse", `${primaryTip}^2`)).toBe(drive.dirs[0].attemptSha);
      expect(g(w.multiRepo!, "rev-parse", `${alphaTip}^2`)).toBe(drive.dirs[1].attemptSha);
      expect(g(w.repo, "log", "-1", "--format=%s", primaryTip)).toBe(`orca: land ${runId}`);
      expect(g(w.multiRepo!, "log", "-1", "--format=%s", alphaTip)).toBe(`orca: land ${runId}`);
      expect(g(w.repo, "show", `${primaryTip}:shared.txt`)).toBe("A");
      expect(g(w.multiRepo!, "show", `${alphaTip}:src/a.ts`)).toBe("export const a = 1;");
      // spec §10: one ledger, in the primary's commit; the extra landing carries none.
      const lines = g(w.repo, "show", `${primaryTip}:.decisions/${runId}.jsonl`).split("\n").filter((line) => line.trim().length > 0);
      expect(lines.map((line) => JSON.parse(line).id)).toEqual([`${runId}/agent-0`]);
      expect(inTree(w.multiRepo!, alphaTip, `.decisions/${runId}.jsonl`)).toBe(false);
      expect(drive.stagedPending).toEqual([]);
    } finally { await w.teardown(); }
  });

  it("replays after a death past the first swap without merging the first directory again", async () => {
    const w = await multiWorld();
    const first = await w.boot((at) => { if (at === "D-after-cas") throw new DriverCrash(at); });
    const runId = await collect(w, first, ["main", "alpha"], (sourceDir) => ({
      "shared.txt": "A\n", [join(sourceDir, "run", "dirs", "attempt-1", "alpha", "src", "a.ts")]: "export const a = 1;\n",
    })).catch(async (error) => { w.die(first); await w.teardown(); throw error; });
    try {
      await injectDecision(first, runId);
      await driveUntil(first, () => first.driver?.crashed === "D-after-cas", 120_000, "the first swap's crash");
      const primaryAfterCrash = g(w.repo, "rev-parse", "refs/heads/orca/g");
      const alphaAtExport = g(w.multiRepo!, "rev-parse", "refs/heads/orca/g");
      const [main, alpha] = driveOf(first, runId).dirs;
      expect(g(w.repo, "rev-parse", `${primaryAfterCrash}^2`)).toBe(main.attemptSha);
      // §8.1 step 4: both directories were produced and journalled before the first swap.
      expect(readDriverRun(first.store, runId).drive!.landingPlan).toEqual([
        { key: "main", old: main.base, next: primaryAfterCrash }, { key: "alpha", old: alpha.base, next: expect.stringMatching(/^[0-9a-f]{40}$/) },
      ]);
      // The death came after the first swap: the second directory is still where it was.
      expect(g(w.multiRepo!, "rev-parse", "refs/heads/orca/g")).toBe(alphaAtExport);
      // closeBlocked's probe finds the unrecorded landing in the directory that swapped (review of H7, session 7753e97d).
      expect(await landedUnrecorded({} as never, readDriverRun(first.store, runId))).toBe(true);
      w.die(first);
      const second = await w.boot();
      await driveUntil(second, () => LANDED.includes(state(second, runId)!), 120_000, "the replay's landing");
      const drive = driveOf(second, runId);
      expect(drive.landedDirs.main).toBe(primaryAfterCrash);
      expect(g(w.repo, "rev-parse", "refs/heads/orca/g")).toBe(primaryAfterCrash);
      expect(g(w.multiRepo!, "rev-parse", "refs/heads/orca/g")).toBe(drive.landedDirs.alpha);
      // The replay merged the second directory's own attempt, and left the ledger only on the primary.
      expect(g(w.multiRepo!, "rev-parse", `${drive.landedDirs.alpha}^2`)).toBe(alpha.attemptSha);
      expect(inTree(w.multiRepo!, drive.landedDirs.alpha, `.decisions/${runId}.jsonl`)).toBe(false);
      // One landing per directory: the replay found the first and merged only the second.
      const landings = g(w.repo, "log", "--format=%s", `${main.base}..${primaryAfterCrash}`).split("\n").filter((line) => line === `orca: land ${runId}`);
      expect(landings).toHaveLength(1);
      expect(g(w.repo, "rev-list", "--count", "--min-parents=2", `${main.base}..${primaryAfterCrash}`)).toBe("1");
    } finally { await w.teardown(); }
  });

  it("swaps nothing and blocks by name when the second directory conflicts", async () => {
    const w = await multiWorld();
    const runtime = await w.boot();
    const runId = await collect(w, runtime, ["main", "alpha"], (sourceDir) => ({
      "shared.txt": "A\n", [join(sourceDir, "run", "dirs", "attempt-1", "alpha", "src", "a.ts")]: "export const a = 1;\n",
    })).catch(async (error) => { w.die(runtime); await w.teardown(); throw error; });
    try {
      const primaryBefore = g(w.repo, "rev-parse", "refs/heads/orca/g");
      const sibling = commitToWorkBranch(w.multiRepo!, "orca/g", "src/a.ts", "export const a = 2;\n");
      await driveUntil(runtime, () => state(runtime, runId) === "blocked" || LANDED.includes(state(runtime, runId)!), 120_000, "the conflict's block");
      const drive = driveOf(runtime, runId);
      expect(state(runtime, runId)).toBe("blocked");
      expect(drive.blockedAt).toBe("D");
      expect(drive.blockedReason).toBe("multi-dir-landing-conflict:alpha:src/a.ts");
      // Nothing swapped, in either directory, and no journal survives the block.
      expect(drive.landedCommit).toBe(null);
      expect(drive.landedDirs).toBe(null);
      expect(drive.landingPlan).toBe(null);
      // closeBlocked's probe: a multi run that swapped nothing has not landed (it used to answer "landed" for every multi
      // run, since `groupRepoId` throws for one, and left the blocked run to a person as landed).
      expect(await landedUnrecorded({} as never, readDriverRun(runtime.store, runId))).toBe(false);
      expect(g(w.repo, "rev-parse", "refs/heads/orca/g")).toBe(primaryBefore);
      expect(g(w.multiRepo!, "rev-parse", "refs/heads/orca/g")).toBe(sibling);
      for (const repo of [w.repo, w.multiRepo!]) expect(worktreesOf(repo).filter((path) => basename(path).startsWith("landing-"))).toEqual([]);
    } finally { await w.teardown(); }
  });

  it("puts the ledger on the group primary's tip when only the extra directory was written", async () => {
    const w = await multiWorld();
    await contractRootedAtAlpha(w);
    // spec §6.4: the export bases every member, written or not -- a requirement group's primary branch exists at its HEAD.
    g(w.repo, "update-ref", "refs/heads/orca/g", g(w.repo, "rev-parse", "HEAD"));
    const runtime = await w.boot();
    // `src/check.ts` is the contract's own check-defining file: changing it is a `modified` criteria change, so the
    // classification proves which contract's checks the first written directory was judged by.
    const runId = await collect(w, runtime, ["alpha"], () => ({ "src/a.ts": "export const a = 1;\n", "src/check.ts": "export const check = 2;\n" }))
      .catch(async (error) => { w.die(runtime); await w.teardown(); throw error; });
    try {
      await injectDecision(runtime, runId);
      await driveUntil(runtime, () => {
        if (state(runtime, runId) === "blocked") throw new Error(`blocked: ${String(driveOf(runtime, runId).blockedAt)} ${String(driveOf(runtime, runId).blockedReason)}`);
        return LANDED.includes(state(runtime, runId)!);
      }, 120_000, "landing");
      const drive = driveOf(runtime, runId);
      const primaryTip = g(w.repo, "rev-parse", "refs/heads/orca/g");
      const alphaTip = g(w.multiRepo!, "rev-parse", "refs/heads/orca/g");
      expect(drive.dirs.map((dir: { key: string }) => dir.key)).toEqual(["alpha"]);
      expect(drive.landedDirs).toEqual({ main: primaryTip, alpha: alphaTip });
      expect(drive.landedCommit).toBe(primaryTip);
      // A ledger-only commit: one parent, the decisions file, and none of the attempt's files.
      expect(g(w.repo, "log", "-1", "--format=%s", primaryTip)).toBe(`orca: decisions ${runId}`);
      expect(g(w.repo, "rev-list", "--parents", "-n", "1", primaryTip).split(" ")).toHaveLength(2);
      expect(g(w.repo, "show", `${primaryTip}:.decisions/${runId}.jsonl`)).toContain(`${runId}/agent-0`);
      // The first WRITTEN directory is judged by the task contract's own checks, not looked up among the extras: its
      // check-defining file's modification is classified and flagged.
      expect(g(w.repo, "show", `${primaryTip}:.decisions/${runId}.jsonl`)).toContain(`${runId}/orca-criteria`);
      const flags = listFlaggedDecisions(runtime.store, "g");
      expect(flags.map((row) => row.source)).toEqual(["test-change"]);
      expect(flags[0]!.evidence).toContain("changed: src/check.ts");
      expect(inTree(w.repo, primaryTip, "src/a.ts")).toBe(false);
      expect(g(w.multiRepo!, "log", "-1", "--format=%s", alphaTip)).toBe(`orca: land ${runId}`);
      expect(g(w.multiRepo!, "show", `${alphaTip}:src/a.ts`)).toBe("export const a = 1;");
      expect(g(w.multiRepo!, "show", `${alphaTip}:src/check.ts`)).toBe("export const check = 2;");
      expect(inTree(w.multiRepo!, alphaTip, `.decisions/${runId}.jsonl`)).toBe(false);
    } finally { await w.teardown(); }
  });

  // Review of H7 (Orca session 7753e97d) blocker: with no decision there is no ledger, so no primary commit; the run's
  // work is on alpha's branch all the same. Judged by `landedCommit` alone it settled as an empty result: no acceptance,
  // and its task `blocked` though its change landed.
  it("settles a run that landed only the extra directory and reported no decisions as done, with acceptance", async () => {
    const w = await multiWorld();
    await contractRootedAtAlpha(w);
    const primaryAtExport = g(w.repo, "rev-parse", "HEAD");
    g(w.repo, "update-ref", "refs/heads/orca/g", primaryAtExport);
    const runtime = await w.boot();
    const runId = await collect(w, runtime, ["alpha"], () => ({ "src/a.ts": "export const a = 1;\n" }))
      .catch(async (error) => { w.die(runtime); await w.teardown(); throw error; });
    try {
      await driveUntil(runtime, () => state(runtime, runId) === "settled" || state(runtime, runId) === "blocked", 180_000, "settle");
      const drive = driveOf(runtime, runId);
      const alphaTip = g(w.multiRepo!, "rev-parse", "refs/heads/orca/g");
      expect(state(runtime, runId)).toBe("settled");
      // The shape that made it look empty: no primary commit, the primary's branch unmoved, alpha landed.
      expect(drive.landedCommit).toBe(null);
      expect(drive.landedDirs).toEqual({ alpha: alphaTip });
      expect(g(w.repo, "rev-parse", "refs/heads/orca/g")).toBe(primaryAtExport);
      expect(g(w.multiRepo!, "log", "-1", "--format=%s", alphaTip)).toBe(`orca: land ${runId}`);
      // What a landed run owes: the acceptance proof, so the settle marks the task done.
      expect(runtime.store.db.prepare("SELECT id FROM outbox WHERE id=? AND kind='acceptance'").get(`acceptance:${runId}`)).toBeDefined();
      const work = JSON.parse(String(runtime.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body)) as { status: string };
      expect(work.status).toBe("done");
    } finally { await w.teardown(); }
  });

  it("replays after a death past the ledger-only commit without writing a second one", async () => {
    const w = await multiWorld();
    await contractRootedAtAlpha(w);
    g(w.repo, "update-ref", "refs/heads/orca/g", g(w.repo, "rev-parse", "HEAD"));
    const first = await w.boot((at) => { if (at === "D-after-cas") throw new DriverCrash(at); });
    const runId = await collect(w, first, ["alpha"], () => ({ "src/a.ts": "export const a = 1;\n" }))
      .catch(async (error) => { w.die(first); await w.teardown(); throw error; });
    try {
      await injectDecision(first, runId);
      await driveUntil(first, () => first.driver?.crashed === "D-after-cas", 120_000, "the ledger commit's crash");
      // The ledger-only commit is the first swap; the extra directory is still at its export base.
      const ledgerTip = g(w.repo, "rev-parse", "refs/heads/orca/g");
      const alphaAtExport = g(w.multiRepo!, "rev-parse", "refs/heads/orca/g");
      expect(g(w.repo, "log", "-1", "--format=%s", ledgerTip)).toBe(`orca: decisions ${runId}`);
      expect(g(w.multiRepo!, "rev-parse", "refs/heads/orca/g")).toBe(alphaAtExport);
      w.die(first);
      const second = await w.boot();
      await driveUntil(second, () => LANDED.includes(state(second, runId)!), 120_000, "the replay's landing");
      const drive = driveOf(second, runId);
      // The replay recognised the ledger it already wrote: the primary's tip did not move again.
      expect(drive.landedCommit).toBe(ledgerTip);
      expect(drive.landedDirs.main).toBe(ledgerTip);
      expect(g(w.repo, "rev-parse", "refs/heads/orca/g")).toBe(ledgerTip);
      expect(g(w.multiRepo!, "rev-parse", "refs/heads/orca/g")).toBe(drive.landedDirs.alpha);
      expect(g(w.multiRepo!, "rev-parse", `${drive.landedDirs.alpha}^2`)).toBe(drive.dirs[0].attemptSha);
      const ledgerCommits = g(w.repo, "log", "--first-parent", "--format=%s", ledgerTip)
        .split("\n").filter((line) => line === `orca: decisions ${runId}`);
      expect(ledgerCommits).toHaveLength(1);
    } finally { await w.teardown(); }
  });
});
