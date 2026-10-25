/**
 * Multi-directory projects spec §5.4 and §12, criterion M19: no site reads one repository for a multi group -- the body
 * says it has none, the primary is named nowhere by accident, cleanup removes every written directory's workspace and its
 * incoming ref, and the checks pass skips a multi id by name instead of resolving it to a member every round.
 */
import { readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, dirname, join } from "node:path";
import express from "express";
import { afterAll, describe, expect, it, vi } from "vitest";
import { writeArtifact } from "../../src/control/archive.js";
import { groupRepoId } from "../../src/control/dirGroup.js";
import { ControlError } from "../../src/control/errors.js";
import { savedReport } from "../../src/control/executionDriver.js";
import { dirTargetRepoId, multiPrimaryRepoId } from "../../src/control/multiGroup.js";
import type { ControlStore } from "../../src/control/store.js";
import { WebControlService } from "../../src/control/webService.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { registerControlReadRoutes, verifyControlJsonBody, type ControlReadApiDeps } from "../../src/panel/controlApi.js";
import type { ControlRuntime } from "../../src/panel/controlAssembly.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { webFixture } from "./fixtures/web.js";
import { ccloopWorlds, g, realBinary, startGroup, workRuns, type World } from "./fixtures/ccloopWorld.js";

const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-multi-sites-", epochPrefix: "epoch-multi-sites-" });
afterAll(removeRoots);

/** A frozen two-directory body: "main" (the primary) and "alpha". */
const MULTI = { project: "multi", landing: null, dirs: [
  { key: "main", repoId: "repo", kind: "repo" }, { key: "alpha", repoId: "alpha", kind: "repo" },
] };

function freezeBody(store: ControlStore, groupId: string, patch: (body: Record<string, any>) => void): void {
  const body = JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!.body));
  patch(body);
  store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(body), groupId);
}

const code = (run: () => unknown): string | undefined => {
  try { run(); return undefined; }
  catch (error) { return error instanceof ControlError ? error.code : `not-a-control-error:${(error as Error).message}`; }
};

describe("the sites that used to assume one repository (M19)", () => {
  it("refuses to name a single repository for a multi group, and names the primary on purpose", async () => {
    const h = await webFixture();
    try {
      freezeBody(h.store, "g", (body) => { body.multiDir = MULTI; });
      expect(code(() => groupRepoId(h.store, "g"))).toBe("multi-dir-group-no-single-repo");
      expect(multiPrimaryRepoId(h.store, "g")).toBe("repo");
      expect(dirTargetRepoId(h.store, "g", "alpha")).toBe("alpha");
    } finally { await h.dispose(); }
  });

  it("skips a multi id in the checks pass instead of resolving it to a member every round", async () => {
    const h = await webFixture();
    try {
      freezeBody(h.store, "g", (body) => { body.plan.repoId = "multi"; });
      const resolved: string[] = [];
      const service = new WebControlService({
        ...h.deps, multiDirRepoId: (repoId: string) => repoId === "multi",
        resolveRepository: (repoId: string) => { resolved.push(repoId); throw new ControlError("multi-dir-no-single-path", repoId); },
      });
      const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      try { await service.checksPass(); } finally { stderr.mockRestore(); }
      expect(resolved).toEqual([]);
      expect(stderr.mock.calls.map((call) => String(call[0])).filter((line) => line.includes("multi-dir-no-single-path"))).toEqual([]);
    } finally { await h.dispose(); }
  });

  it("reads a multi group's decisions from the primary directory", { timeout: 60_000 }, async () => {
    const t = await driverHarness([{ taskId: "a" }], { decisions: () => [{
      question: "q", chose: "c", alternatives: [{ option: "o", why_not: "w" }], because: "b",
      undo: { how: `git revert --no-edit ${"b".repeat(40)}`, cost: "c", blast_radius: "r" }, scope: "task", kind: "interface",
    }] });
    try {
      const runId = await t.claim();
      await t.until(t.driver(), () => ["landed", "settled"].includes(t.body(runId).state));
      freezeBody(t.h.store, "g", (body) => { body.multiDir = MULTI; });
      const service = new WebControlService({ ...t.h.deps, knownRepository: (id: string) => id === "repo", resolveRepository: () => t.repo });
      const deps: ControlReadApiDeps = { store: t.h.store, epoch: "epoch", config: { readView: async () => ({}) } as never, service };
      const app = express();
      app.use((_req, res, next) => { res.locals.orcaPrincipal = { kind: "user", userId: "u", name: "u", roles: ["member"] }; next(); });
      app.use(express.json({ verify: verifyControlJsonBody }));
      registerControlReadRoutes(app, deps, "web");
      const server = createServer(app);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("address");
        const answer = await fetch(`http://127.0.0.1:${address.port}/api/control/groups/g/decisions`);
        const body = await answer.json() as { tasks: Array<{ runs: Array<{ runId: string; decisions: Array<{ id: string; where: string }> }> }> };
        expect(answer.status).toBe(200);
        expect(body.tasks.flatMap((task) => task.runs).find((run) => run.runId === runId)!.decisions.map((row) => [row.id, row.where]))
          .toEqual([[`${runId}/agent-0`, "group-branch"]]);
      } finally { await new Promise((resolve) => server.close(resolve)); }
    } finally { await t.h.dispose(); }
  });
});

const DECISION = {
  question: "q", chose: "c", alternatives: [{ option: "o", why_not: "w" }], because: "b",
  undo: { how: `git revert --no-edit ${"b".repeat(40)}`, cost: "c", blast_radius: "r" },
  scope: "task", kind: "interface",
};

const state = (runtime: ControlRuntime, runId: string): string | undefined =>
  workRuns(runtime).find((run) => run.runId === runId)?.body.state;
const driveOf = (runtime: ControlRuntime, runId: string): Record<string, any> =>
  workRuns(runtime).find((run) => run.runId === runId)!.body.drive;

/** Rounds by hand (no pump), so a stop is observed as a stop. */
async function driveUntil(runtime: ControlRuntime, predicate: () => boolean, ms: number, what: string): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await runtime.driver!.round();
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!predicate()) throw new Error(`timed out waiting for ${what}`);
}

/** The world with a second directory, and the expanded contract a multi split would freeze. */
async function multiWorld(): Promise<World> {
  const w = await world([{ taskId: "a", targetPaths: ["**"] }], { a: { files: {}, delayMs: { plan: 4_000 } } },
    { multiRepo: { projectKey: "alpha", dirName: "alpha" } });
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

/** The frozen directories and the split's writes, written after confirmation and before start. */
function freeze(w: World, runtime: ControlRuntime): void {
  freezeBody(runtime.store, "g", (body) => {
    body.multiDir = { project: "multi", landing: null, dirs: [
      { key: "main", repoId: w.repoId, kind: "repo" }, { key: "alpha", repoId: w.multiRepoId, kind: "repo" },
    ] };
  });
  const row = runtime.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!;
  const work = JSON.parse(String(row.body)) as Record<string, unknown>;
  work.writes = [{ dir: "main", targetPaths: ["**"], checks: [] }, { dir: "alpha", targetPaths: ["src/**"], checks: [] }];
  runtime.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='a'").run(JSON.stringify(work));
}

/** Start, claim without a pump, wait for A2, then write the script whose execute writes both attempt worktrees. */
async function collect(w: World, runtime: ControlRuntime, files: (sourceDir: string) => Record<string, string>): Promise<string> {
  await startGroup(runtime, w.repoId, 0, async () => freeze(w, runtime));
  const delivered = await deliverScheduledStart({ store: runtime.store, profileRouter: runtime.router, admissionGate: runtime.admissionGate }, "g");
  if (delivered.kind !== "claimed") throw new Error(`claim refused: ${JSON.stringify(delivered)}`);
  const runId = delivered.runId;
  await driveUntil(runtime, () => {
    const run = workRuns(runtime).find((candidate) => candidate.runId === runId);
    if (run?.body.state === "blocked") throw new Error(`blocked before A2: ${String(run.body.drive?.blockedReason)}`);
    return run?.body.drive?.prepared === true;
  }, 60_000, "A2 prepared");
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

describe.skipIf(!realBinary)("cleanup of a multi run's workspaces (§7.1, M19)", { timeout: 420_000 }, () => {
  relocateHome("orca-multi-sites-home-");

  it("removes every written directory's workspace and its incoming ref", async () => {
    const w = await multiWorld();
    const runtime = await w.boot();
    const runId = await collect(w, runtime, (sourceDir) => ({
      "shared.txt": "A\n", [join(sourceDir, "run", "dirs", "attempt-1", "alpha", "src", "a.ts")]: "export const a = 1;\n",
    })).catch(async (error) => { w.die(runtime); await w.teardown(); throw error; });
    try {
      await injectDecision(runtime, runId);
      await driveUntil(runtime, () => state(runtime, runId) === "settled" && driveOf(runtime, runId).cleanedUp === true, 120_000, "settled and cleaned");
      const drive = driveOf(runtime, runId);
      expect(drive.dirs.map((dir: { key: string }) => dir.key)).toEqual(["main", "alpha"]);
      expect(drive.cleanedUp).toBe(true);
      expect(drive.cleanupError).toBe(null);
      // §7.1: the flat leaves are named after the run; both are gone, as is the skills snapshot and the run's source.
      const workspacesRoot = dirname(drive.workspacePath);
      expect(readdirSync(workspacesRoot).filter((entry) => entry.includes(runId))).toEqual([]);
      expect(drive.dirs.map((dir: { workspacePath: string }) => basename(dir.workspacePath))).toEqual([runId, `${runId}.dir-alpha`]);
      // Every written directory's incoming ref is deleted -- in both repositories.
      for (const repo of [w.repo, w.multiRepo!]) expect(g(repo, "for-each-ref", "refs/orca/incoming")).toBe("");
      // The work branches stay: cleanup never touches orca/<groupId>.
      expect(g(w.repo, "rev-parse", "--verify", "refs/heads/orca/g")).toMatch(/^[0-9a-f]{40}$/);
      expect(g(w.multiRepo!, "rev-parse", "--verify", "refs/heads/orca/g")).toMatch(/^[0-9a-f]{40}$/);
    } finally { await w.teardown(); }
  });
});
