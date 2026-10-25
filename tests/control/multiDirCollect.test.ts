/**
 * Multi-directory projects spec §7.2-§7.4, criterion M8, against the pinned ccloop (ORCA_CCLOOP_BIN) and its scripted fake
 * agent: C commits each written directory's result repository and keeps one attempt sha per directory; the primary's sha
 * stays in `drive.attemptSha`; an out-of-bounds write in an extra directory blocks `out-of-bounds:<key>:<paths>`; the
 * criteria base re-run is not started (no `debugRepro`, no `criteriaBase`) and the landing's flag says so.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { criteriaFlagOf } from "../../src/control/driverLanding.js";
import { readDriverRun } from "../../src/control/executionDriver.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import type { ControlRuntime } from "../../src/panel/controlAssembly.js";
import { ccloopWorlds, g, realBinary, startGroup, workRuns, type World } from "./fixtures/ccloopWorld.js";

const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-multi-collect-", epochPrefix: "epoch-multi-collect-" });
afterAll(removeRoots);

const state = (runtime: ControlRuntime, runId: string): string | undefined =>
  workRuns(runtime).find((run) => run.runId === runId)?.body.state;
const driveOf = (runtime: ControlRuntime, runId: string): Record<string, any> =>
  workRuns(runtime).find((run) => run.runId === runId)!.body.drive;

/** Rounds by hand (no pump): a multi run stops being driven as soon as C is done, before D (a later task). */
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

/** The frozen list and the split's writes, written after confirmation and before start. */
function freeze(w: World, runtime: ControlRuntime): void {
  const group = JSON.parse(String(runtime.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;
  group.multiDir = { project: "multi", landing: null, dirs: [
    { key: "main", repoId: w.repoId, kind: "repo" }, { key: "alpha", repoId: w.multiRepoId, kind: "repo" },
  ] };
  runtime.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(group));
  const row = runtime.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!;
  const work = JSON.parse(String(row.body)) as Record<string, unknown>;
  work.writes = [{ dir: "main", targetPaths: ["**"], checks: [] }, { dir: "alpha", targetPaths: ["src/**"], checks: [] }];
  runtime.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='a'").run(JSON.stringify(work));
}

/** Start, claim without a pump, wait for A2, then write the script whose execute writes the real attempt worktrees. */
async function runToCollection(w: World, files: (sourceDir: string) => Record<string, string>): Promise<{ runtime: ControlRuntime; runId: string }> {
  const runtime = await w.boot();
  await startGroup(runtime, w.repoId, 0, async () => freeze(w, runtime));
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
  return { runtime, runId };
}

describe.skipIf(!realBinary)("collecting a multi run (§7.2)", { timeout: 420_000 }, () => {
  relocateHome("orca-multi-collect-home-");

  it("commits each directory's result repository and keeps one attempt sha per directory", async () => {
    const w = await multiWorld();
    const primary = "shared.txt", extra = (sourceDir: string): string => join(sourceDir, "run", "dirs", "attempt-1", "alpha", "src", "a.ts");
    const { runtime, runId } = await runToCollection(w, (sourceDir) => ({ [primary]: "A\n", [extra(sourceDir)]: "export const a = 1;\n" })).catch(async (error) => { await w.teardown(); throw error; });
    try {
      const body = workRuns(runtime).find((run) => run.runId === runId)!;
      expect(body.body.state).toBe("collected");
      const dirs = driveOf(runtime, runId).dirs;
      expect(dirs.map((dir: { key: string }) => dir.key)).toEqual(["main", "alpha"]);
      expect(dirs[0].attemptSha).toMatch(/^[0-9a-f]{40}$/);
      expect(dirs[1].attemptSha).toMatch(/^[0-9a-f]{40}$/);
      expect(dirs[0].attemptSha).not.toBe(dirs[1].attemptSha);
      expect(driveOf(runtime, runId).attemptSha).toBe(dirs[0].attemptSha);
      expect(driveOf(runtime, runId).outcome).toBe("succeeded");
      const resultRepo = join(body.body.drive.sourceDir, "repos", "alpha");
      expect(await readFile(join(resultRepo, "src", "a.ts"), "utf8")).toBe("export const a = 1;\n");
      expect(g(resultRepo, "show", "HEAD:src/a.ts")).toBe("export const a = 1;");
      // A2 made the extra's work branch; moving it is the landing's (a later task).
      expect(() => g(w.multiRepo!, "rev-parse", "refs/heads/orca/g")).not.toThrow();
    } finally { await w.teardown(); }
  });

  it("blocks an extra directory's out-of-bounds write by its key", async () => {
    const w = await multiWorld();
    const { runtime, runId } = await runToCollection(w, (sourceDir) => ({
      "shared.txt": "A\n", [join(sourceDir, "run", "dirs", "attempt-1", "alpha", "other.txt")]: "outside\n",
    })).catch(async (error) => { await w.teardown(); throw error; });
    try {
      expect(state(runtime, runId)).toBe("blocked");
      expect(driveOf(runtime, runId).blockedAt).toBe("C");
      expect(driveOf(runtime, runId).blockedReason).toBe("out-of-bounds:alpha:other.txt");
      // Both commits were made before the bounds were read; the blocked run keeps them as evidence.
      const dirs = driveOf(runtime, runId).dirs;
      expect(dirs.map((dir: { attemptSha: string }) => dir.attemptSha)).toEqual([expect.stringMatching(/^[0-9a-f]{40}$/), expect.stringMatching(/^[0-9a-f]{40}$/)]);
      expect(driveOf(runtime, runId).attemptSha).toBe(dirs[0].attemptSha);
    } finally { await w.teardown(); }
  });

  it("judges each directory with its own checks and says the base re-run was skipped", async () => {
    const w = await multiWorld();
    // The extra directory's own check names `src/check.js`; the primary's contract (["true"]) names no file at all.
    await writeFile(join(w.multiRepo!, "src", "check.js"), "console.log(\"check\");\n");
    g(w.multiRepo!, "add", "src/check.js");
    g(w.multiRepo!, "commit", "-qm", "check");
    const contractPath = join(w.root, "contracts", "a.json");
    const contract = JSON.parse(await readFile(contractPath, "utf8")) as { context: { additionalRepos: Array<{ requiredChecks: string[] }> } };
    contract.context.additionalRepos[0]!.requiredChecks = ["node src/check.js"];
    await writeFile(contractPath, JSON.stringify(contract));
    const { runtime, runId } = await runToCollection(w, (sourceDir) => ({
      "shared.txt": "A\n",
      // The extra's check-defining file, replaced a line for a line: a modification, not an addition or a weakening.
      [join(sourceDir, "run", "dirs", "attempt-1", "alpha", "src", "check.js")]: "console.log(\"checked\");\n",
    })).catch(async (error) => { await w.teardown(); throw error; });
    try {
      expect(state(runtime, runId)).toBe("collected");
      const drive = driveOf(runtime, runId);
      expect(drive.criteriaBase).toBe(null);
      expect(drive.debugRepro).toBe(null);
      const run = readDriverRun(runtime.store, runId);
      const flag = await criteriaFlagOf({ store: runtime.store } as never, run, join(drive.sourceDir, "repo"), new Date().toISOString());
      expect(flag).not.toBeNull();
      expect(flag!.flag.reason).toContain("base-run-skipped: multi-dir");
      expect(flag!.decision.evidence).toContain("base-run-skipped: multi-dir");
      // Only alpha's checks name `src/check.js`, so only alpha's directory is flagged -- and by its own repository.
      expect(flag!.decision.evidence).toContain("changed: src/check.js");
      // The same directory with no checks names no check file: the flag read the contract extra's checks, not the file's shape.
      const alphaRange = { base: drive.dirs[1].base, attempt: drive.dirs[1].attemptSha };
      expect(await criteriaFlagOf({ store: runtime.store } as never, run,
        join(drive.sourceDir, "repos", "alpha"), new Date().toISOString(), { ...alphaRange, checks: [] })).toBeNull();
    } finally { await w.teardown(); }
  });
});
