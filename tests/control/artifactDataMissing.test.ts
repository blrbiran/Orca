import express from "express";
import { createServer } from "node:http";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { latestRunSnapshot } from "../../src/control/acceptAttempt.js";
import { readArtifact, writeArtifact } from "../../src/control/archive.js";
import { withCommandContext } from "../../src/control/commandClient.js";
import { settlementArtifact } from "../../src/control/usageSettlement.js";
import { registerControlReadRoutes } from "../../src/panel/controlApi.js";
import type { Principal } from "../../src/panel/permissions.js";
import { readControlGroup, readRunEntry, readRunEvidence } from "../../src/panel/controlViews.js";
import { evidenceMissingLines } from "../../src/commands/domains/reads.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { openTestStore } from "./fixtures/store.js";
import { overSocket } from "../panel/fixtures/socketPanel.js";

/**
 * Tester #469 (spec docs/superpowers/specs/2026-11-24-artifact-integrity-design.md, "Review and revisions", step 1): an
 * artifact whose row is present and whose bytes are gone -- its directory removed, or only its `data` file -- is a named
 * `artifact-data-missing`, not a raw ENOENT (control-internal-error). View paths render and name the missing evidence (a
 * closed run's closure reads `evidence-missing`); decision paths still refuse, by name; archiving the group is the exit.
 * Every criterion here was seen RED on main b2058bfe for the reason its comment names (session 5d3d0c09).
 */
type T = Awaited<ReturnType<typeof driverHarness>>;
type Removal = "directory" | "data";
const remove = (stateDir: string, id: string, what: Removal) =>
  rm(what === "directory" ? join(stateDir, "artifacts", id) : join(stateDir, "artifacts", id, "data"), { recursive: true });
const reportId = (t: T, runId: string): string =>
  JSON.parse(String(t.h.store.db.prepare("SELECT body FROM outbox WHERE id=? AND kind='report'").get(`report:${runId}`)!.body)).source.artifactId;
const errorOf = async (work: () => unknown): Promise<{ code?: unknown; detail?: unknown; message?: unknown }> => {
  try { await work(); } catch (error) { return error as { code?: unknown; detail?: unknown }; }
  throw new Error("expected a refusal");
};

async function closedFailure() {
  const t = await driverHarness([{ taskId: "a", targetPaths: ["a"] }], { behaviour: () => "failed", sealedOwnerProof: true, tokenPolicy: "optional-v1" });
  const runId = await t.claim(), driver = t.driver();
  await t.until(driver, () => t.body(runId).state === "blocked");
  const closed = t.service.closeRun(t.h.command("close-run", { runId }));
  if ("error" in closed) throw new Error(JSON.stringify(closed));
  await t.until(driver, () => t.body(runId).drive.cleanedUp === true);
  return { t, runId, driver };
}

describe("tester #469: both readers name missing bytes", () => {
  // RED on main: readArtifact let lstat's/assertRegular's ENOENT escape raw; settlementArtifact threw ENOENT too.
  it.each(["directory", "data"] as const)("readArtifact and settlementArtifact refuse a removed %s as artifact-data-missing:<id>", async (what) => {
    const h = await openTestStore(); try {
      const ref = await writeArtifact(h.store, "gone-1", Buffer.from("evidence"));
      await remove(h.store.stateDir, "gone-1", what);
      expect(await errorOf(() => readArtifact(h.store, ref))).toMatchObject({ code: "artifact-data-missing", detail: "gone-1" });
      expect(await errorOf(() => settlementArtifact(h.store, ref))).toMatchObject({ code: "artifact-data-missing", detail: "gone-1" });
      // Tampering is not "missing": a hash the row does not hold stays artifact-hash-mismatch.
      expect(await errorOf(() => readArtifact(h.store, { ...ref, hash: "0".repeat(64) }))).toMatchObject({ code: "artifact-hash-mismatch" });
    } finally { await h.dispose(); }
  });
});

describe("tester #469: a row whose data is gone does not poison a later write of the same content", () => {
  // RED on main for "data": observeDuplicate refused artifact-id-conflict:<id>:data-missing, failing a live run's write.
  // Mutation: drop the restore branch in archive.ts publishOnce -> the "data" row goes red again.
  it.each(["directory", "data"] as const)("rewriting the same bytes after the %s was removed restores the file", async (what) => {
    const h = await openTestStore(); try {
      const bytes = Buffer.from("same content");
      const ref = await writeArtifact(h.store, "poison-1", bytes);
      await remove(h.store.stateDir, "poison-1", what);
      await expect(writeArtifact(h.store, "poison-1", bytes)).resolves.toEqual(ref);
      expect((await readArtifact(h.store, ref)).equals(bytes)).toBe(true);
      expect((await readFile(join(h.store.stateDir, "artifacts", "poison-1", "data"))).equals(bytes)).toBe(true);
    } finally { await h.dispose(); }
  });

  it("other bytes under that id stay refused: the row's hash is the only one restored", async () => {
    const h = await openTestStore(); try {
      await writeArtifact(h.store, "poison-2", Buffer.from("first"));
      await remove(h.store.stateDir, "poison-2", "data");
      expect(await errorOf(() => writeArtifact(h.store, "poison-2", Buffer.from("second")))).toMatchObject({ code: "artifact-id-conflict", detail: "poison-2:data-missing" });
    } finally { await h.dispose(); }
  });
});

describe("tester #469: a group whose closed run lost its evidence still renders (the tester's shape)", { timeout: 120_000 }, () => {
  // RED on main: readControlGroup threw recovery-blocked:run-closure-invalid:<run> (group show), readRunEntry the same
  // (run show), readRunEvidence a raw ENOENT (control-internal-error). Mutation: make runViews block again on an invalid
  // closure (drop terminalClosureEvidenceMissing's branch) -> red.
  it.each([["report", "directory"], ["report", "data"], ["stopProof", "data"]] as const)("the %s's %s removed: views render and name it, decisions refuse by name, archive is the exit", async (which, what) => {
    const { t, runId } = await closedFailure(); try {
      const id = which === "report" ? reportId(t, runId) : t.body(runId).terminalClosure.stopProof.artifactId as string;
      await remove(t.h.store.stateDir, id, what);

      const groupRun = readControlGroup(t.h.store, "epoch-test", "g").runs.find((run) => run.runId === runId)!;
      expect(groupRun).toMatchObject({ closure: "evidence-missing", evidenceMissing: [id] });
      expect(groupRun).not.toHaveProperty("terminalClosed");
      expect(readRunEntry(t.h.store, "epoch-test", runId).run).toMatchObject({ closure: "evidence-missing", evidenceMissing: [id] });
      // The evidence list renders (the manifest's own missing entry is pinned by the route criterion below).
      expect((await readRunEvidence(t.h.store, runId)).entries.length).toBeGreaterThan(0);
      // The CLI line names the run, the id and the exit.
      expect(evidenceMissingLines("g", [groupRun])).toEqual([expect.stringContaining(`run ${runId} (closed`)]);
      expect(evidenceMissingLines("g", [groupRun])[0]).toContain(`${id} -- `);
      expect(evidenceMissingLines("g", [groupRun])[0]).toContain("orca group archive g");

      // Decision paths stay strict and name the missing evidence; nothing moves.
      const before = t.body(runId);
      expect(t.service.closeRun(t.h.command("close-run", { runId }))).toMatchObject({ error: { code: "run-closure-invalid", message: `run-closure-invalid:artifact-data-missing:${id}` } });
      expect(t.service.retryTask(t.h.command("retry-task", { taskId: "a" }))).toMatchObject({ error: { code: "recovery-blocked", message: `recovery-blocked:retry-closure-invalid:artifact-data-missing:${id}` } });
      expect(t.body(runId)).toEqual(before);

      // The exit the hint names: the group archives (archiveGroup.ts refuseArchive reads no run evidence).
      await t.service.pauseDispatch(t.h.command("pause-dispatch", {}));
      expect(t.service.archiveGroup(t.h.command("archive-group", {}))).toMatchObject({ result: { kind: "archived", groupId: "g" } });
    } finally { await t.h.dispose(); }
  });

  // The README's other exit: an open (not closed) failed run whose report bytes are gone cannot be closed, and is retried.
  it("an open failed run whose report bytes are gone: close-run refuses naming them, the task retries", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "failed", sealedOwnerProof: true, tokenPolicy: "optional-v1" }); try {
      const runId = await t.claim(), driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "blocked");
      const id = reportId(t, runId);
      await remove(t.h.store.stateDir, id, "data");
      expect(t.service.closeRun(t.h.command("close-run", { runId }))).toMatchObject({ error: { code: "run-closure-evidence", message: `run-closure-evidence:artifact-data-missing:${id}` } });
      expect(t.service.retryTask(t.h.command("retry-task", { taskId: "a" }))).toMatchObject({ result: { kind: "task-retried", fromRunId: runId } });
    } finally { await t.h.dispose(); }
  });

  // Tampering is not "missing": with every byte present, a forged marker is refused as before.
  it("a forged marker over present evidence is still run-closure-invalid", async () => {
    const { t, runId } = await closedFailure(); try {
      t.h.store.transaction(() => {
        const body = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body));
        body.terminalClosure.highWater += 1;
        t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(body), runId);
      });
      expect(() => readControlGroup(t.h.store, "epoch-test", "g")).toThrow(/run-closure-invalid/);
    } finally { await t.h.dispose(); }
  });
});

describe("tester #469: no view route answers control-internal-error for missing bytes", { timeout: 120_000 }, () => {
  // RED on main: groups/g and runs/<run> answered 423 recovery-blocked, runs/<run>/evidence 500 control-internal-error.
  // The routes are enumerated from the registered table, not a hand list, so a new GET under a group or a run is covered.
  it("every GET under /api/control/groups/:groupId and /api/control/runs/:runId answers without control-internal-error", async () => {
    const { t, runId } = await closedFailure(); try {
      // The report (closure evidence, not listed in the manifest) and the snapshot (listed in it) both lose their bytes.
      await remove(t.h.store.stateDir, reportId(t, runId), "data");
      const id = latestRunSnapshot(t.h.store, runId)!.artifactId;
      await remove(t.h.store.stateDir, id, "data");
      const listed = (await readRunEvidence(t.h.store, runId)).entries;
      expect(listed.filter((entry) => "missing" in entry)).toEqual([expect.objectContaining({ evidenceId: id, missing: true, byteLength: null })]);
      expect(listed.some((entry) => !("missing" in entry))).toBe(true);
      const agent: Principal = { kind: "agent", client: "mcp:test" };
      const app = express(); app.use(express.json());
      app.use((_req, res, next) => { res.locals.orcaPrincipal = agent; next(); });
      registerControlReadRoutes(app, { store: t.h.store, epoch: "epoch-test", config: { readView: async () => ({}) } as never, service: t.service }, "socket");
      const server = createServer(app), socketPath = join(t.h.root, "c.sock");
      await new Promise<void>((resolve) => server.listen(socketPath, resolve));
      try {
        const stack = (app as unknown as { router: { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> } }).router.stack;
        const paths = stack.flatMap((layer) => layer.route?.methods.get === true ? [layer.route.path] : [])
          .filter((path) => path.startsWith("/api/control/groups/:groupId") || path.startsWith("/api/control/runs/:runId"));
        expect(paths).toContain("/api/control/runs/:runId/evidence");
        const answers: Record<string, { status: number; code?: string }> = {};
        for (const path of paths) {
          const concrete = path.replace(":groupId", "g").replace(":runId", runId).replace(":artifactId", id).replace(":taskId", "a")
            .replace(/:[A-Za-z]+/g, "x");
          const answer = await overSocket(socketPath, "GET", concrete, { "x-orca-client": "mcp:test" });
          let code: string | undefined;
          try { code = (JSON.parse(answer.text) as { error?: { code?: string } }).error?.code; } catch { code = undefined; }
          answers[path] = { status: answer.status, ...(code === undefined ? {} : { code }) };
        }
        expect(Object.entries(answers).filter(([, answer]) => answer.status >= 500 || answer.code === "control-internal-error")).toEqual([]);
        expect(answers["/api/control/groups/:groupId"]?.status).toBe(200);
        expect(answers["/api/control/groups/:groupId/brief"]?.status).toBe(200);
        expect(answers["/api/control/runs/:runId"]?.status).toBe(200);
        expect(answers["/api/control/runs/:runId/evidence"]?.status).toBe(200);
        // The bytes themselves: a named 409, not a 500.
        expect(answers["/api/control/runs/:runId/evidence/:artifactId/content"]).toEqual({ status: 409, code: "artifact-data-missing" });
      } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
    } finally { await t.h.dispose(); }
  });
});

describe("tester #469: decision paths refuse by name", { timeout: 120_000 }, () => {
  // RED on main: the refusal was a bare run-stop-proof-required, naming nothing. The view of the open run still renders.
  it("settle-usage of a run whose report bytes are gone refuses run-stop-proof-required:artifact-data-missing:<id>", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "failed-usage-unknown", sealedOwnerProof: true }); try {
      const runId = await t.claim(), driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "blocked");
      const id = reportId(t, runId);
      await remove(t.h.store.stateDir, id, "data");
      const run = t.body(runId);
      const settle = await withCommandContext("settle-469", { client: "web", principal: "user:owner" }, () => (t.service as any).settleUnknownUsage({
        schema: "orca-raw-command-v1", commandId: "settle-469", actorId: "human", expectedRevision: Number(t.h.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision),
        verb: "settle-unknown-usage", target: { kind: "group", groupId: "g" },
        payload: { taskId: "a", runId, generation: run.generation, acknowledge: run.remaining.work.tokens === null ? "release-unmetered" : "charge-remaining-grant" },
      }));
      expect(settle).toMatchObject({ error: { code: "run-stop-proof-required", message: `run-stop-proof-required:artifact-data-missing:${id}` } });
      expect(t.body(runId)).toEqual(run);
      expect(readControlGroup(t.h.store, "epoch-test", "g").runs.find((entry) => entry.runId === runId)?.unknownUsageSettlement).toMatchObject({ allowed: false, refusalReason: "run-stop-proof-required" });
    } finally { await t.h.dispose(); }
  });

  // RED on main: readArtifact's raw ENOENT was no ControlError, so the refusal said snapshot-unreadable.
  it("accept-attempt of a closed failure whose snapshot bytes are gone refuses accept-attempt-snapshot-missing:artifact-data-missing", async () => {
    const { t, runId } = await closedFailure(); try {
      const snapshot = latestRunSnapshot(t.h.store, runId)!;
      await remove(t.h.store.stateDir, snapshot.artifactId, "data");
      const answer = await withCommandContext("acc-469", { client: "web", principal: "user:owner" },
        () => t.service.acceptAttempt(t.h.command("accept-attempt", { taskId: "a", runId, note: "read it" }, "acc-469") as never));
      expect(answer).toMatchObject({ error: { code: "accept-attempt-snapshot-missing", message: "accept-attempt-snapshot-missing:artifact-data-missing" } });
      expect(t.body(runId).operatorAcceptance).toBeUndefined();
    } finally { await t.h.dispose(); }
  });

  // RED on main: a usage-settled run whose report bytes are gone made runViews block run-usage-settlement:<run>.
  it("a settled run whose report bytes are gone renders with evidenceMissing; close-run refuses naming it", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "failed-usage-unknown", sealedOwnerProof: true }); try {
      const runId = await t.claim(), driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "blocked");
      const run = t.body(runId);
      const settled = await withCommandContext("settle-469b", { client: "web", principal: "user:owner" }, () => (t.service as any).settleUnknownUsage({
        schema: "orca-raw-command-v1", commandId: "settle-469b", actorId: "human", expectedRevision: Number(t.h.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision),
        verb: "settle-unknown-usage", target: { kind: "group", groupId: "g" },
        payload: { taskId: "a", runId, generation: run.generation, acknowledge: run.remaining.work.tokens === null ? "release-unmetered" : "charge-remaining-grant" },
      }));
      if ("error" in settled) throw new Error(JSON.stringify(settled.error));
      const id = reportId(t, runId);
      await remove(t.h.store.stateDir, id, "directory");
      const view = readControlGroup(t.h.store, "epoch-test", "g").runs.find((entry) => entry.runId === runId)!;
      expect(view.evidenceMissing).toEqual([id]);
      expect(view).not.toHaveProperty("closure");
      expect(t.service.closeRun(t.h.command("close-run", { runId }))).toMatchObject({ error: { code: "run-closure-evidence", message: `run-closure-evidence:artifact-data-missing:${id}` } });
    } finally { await t.h.dispose(); }
  });
});
