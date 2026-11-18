import { afterAll, describe, expect, it, vi } from "vitest";
import { join, resolve } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { readGroup, saveGroup, readWork } from "../../src/control/queries.js";
import { readArtifact } from "../../src/control/archive.js";
import { exportResumeBundle } from "../../src/control/resumeBundle.js";
import type { ArtifactRef } from "../../src/control/types.js";
import { latestRequestForRun, writeHandoffRequest } from "../../src/control/stopIntent.js";
import type { ControlRuntime } from "../../src/panel/controlAssembly.js";
import { ccloopWorlds, realBinary, startGroup, workRuns, until } from "./fixtures/ccloopWorld.js";

const worlds = ccloopWorlds({ rootPrefix: "orca-allowance-held-", epochPrefix: "allowance-held-" });
afterAll(worlds.removeRoots);

describe.skipIf(!realBinary)("parked allowance settlement in a held group (#213)", () => {
  worlds.relocateHome("orca-allowance-held-home-");

  it("settles an existing run after the group becomes blocked, without another provider call", async () => {
    const world = await worlds.world(
      [{ taskId: "a", targetPaths: ["answer.txt"], loop: { goal: "write answer", successCondition: "answer is 42", targetPaths: ["answer.txt"], checks: ["test -f answer.txt"], tokenBudget: 5_000_000 } }],
      { a: { files: { "answer.txt": "42\n" } } },
      // Ruling (2026-11-12, tester follow-up H): 「这次批准改写所有必要的判据。」 -- token-allowance parking happens only in a group created before the follow-up G
      // release (spec G §2.2, §2.6: an expectation-model run has no grant to park at); this world is created as one.
      { tokenPolicy: "optional-v1", preRelease: true },
    );
    (world.agentsTable.installations.codex.command as string[]).splice(1, 0, resolve("tests/control/fixtures/fake-token-codex.mjs"));
    await writeFile(world.table, JSON.stringify(world.agentsTable));
    let runtime: ControlRuntime;
    runtime = await world.boot(undefined, port => ({ ...port, async collect(...args) {
      const report = await port.collect(...args);
      if (report.terminal?.waitingCause === "token-allowance") {
        runtime.store.transaction(() => {
          const group = readGroup(runtime.store, "g");
          group.status = "blocked";
          saveGroup(runtime.store, group);
        });
      }
      return report;
    } }));
    try {
      await startGroup(runtime, world.repoId, 0, async () => {
        runtime.store.db.prepare("INSERT INTO spend_caps VALUES ('all','total',1900000,0,'human')").run();
      });
      runtime.startPump(50);
      try {
        await until(() => workRuns(runtime).some(run => run.body.state === "settled-recoverable"), 20_000, "parked allowance settles despite held group");
      } catch (error) {
        throw new Error(`${String(error)}; state=${JSON.stringify({ group: readGroup(runtime.store, "g").status, runs: workRuns(runtime).map(run => ({ state: run.body.state, drive: run.body.drive, highWater: run.body.highWater })), calls: world.calls() })}`);
      }
      expect(readGroup(runtime.store, "g").status).toBe("blocked");
      expect(readWork(runtime.store, "g", "a").status).toBe("ready");
      expect(world.calls()).toEqual(["plan"]);
      expect(workRuns(runtime)).toHaveLength(1);
      // Change-sized runs spec 2026-11-19 §5.4.1 (P0-3, O7): an allowance park keeps ccloop's attempt worktree under
      // <sourceDir>/run/worktrees; the run's newest archive files none of it as logs. Mutation M3.1: drop the exclusion, red.
      const parked = workRuns(runtime)[0]!;
      const sourceDir = (parked.body.drive as { sourceDir: string }).sourceDir;
      expect(readdirSync(join(sourceDir, "run", "worktrees")).length).toBeGreaterThan(0);
      const archiveRow = runtime.store.db.prepare("SELECT body FROM outbox WHERE kind='archive' AND json_extract(body,'$.runId')=? ORDER BY rowid DESC LIMIT 1").get(parked.runId) as { body: string };
      const manifestRef = (JSON.parse(archiveRow.body) as { artifacts: ArtifactRef[] }).artifacts.find(ref => ref.artifactId.startsWith("archive-"))!;
      const manifest = JSON.parse((await readArtifact(runtime.store, manifestRef)).toString()) as { logs: Array<{ path: string }> };
      expect(manifest.logs.map(entry => entry.path).filter(path => path === "run/worktrees" || path.startsWith("run/worktrees/"))).toEqual([]);
      // Change-sized runs spec 2026-11-19 §5.6 (P0-7): the allowance settle removed the result copy its complete archive
      // holds, and the continuation still exports from that archive alone. Mutation M6.6: drop the allowance removal, red.
      expect((JSON.parse(archiveRow.body) as { missing: string[] }).missing).toEqual([]);
      expect(existsSync(join(sourceDir, "repo"))).toBe(false);
      const checkpointId = String(runtime.store.db.prepare("SELECT id FROM checkpoints WHERE run_id=?").get(parked.runId)!.id);
      expect((await exportResumeBundle(runtime.store, { predecessorRunId: parked.runId, newSourceDir: join(sourceDir, "..", `${parked.runId}-continuation`) })).checkpointId).toBe(checkpointId);
    } finally { await world.teardown(); }
  }, 30_000);

  it("yields a parked allowance to a handoff request arriving while the checkpoint is persisted", async () => {
    const world = await worlds.world(
      [{ taskId: "a", targetPaths: ["answer.txt"], loop: { goal: "write answer", successCondition: "answer is 42", targetPaths: ["answer.txt"], checks: ["test -f answer.txt"], tokenBudget: 5_000_000 } }],
      { a: { files: { "answer.txt": "42\n" } } },
      // Ruling (2026-11-12, tester follow-up H): 「这次批准改写所有必要的判据。」 -- token-allowance parking happens only in a group created before the follow-up G
      // release (spec G §2.2, §2.6: an expectation-model run has no grant to park at); this world is created as one.
      { tokenPolicy: "optional-v1", preRelease: true },
    );
    (world.agentsTable.installations.codex.command as string[]).splice(1, 0, resolve("tests/control/fixtures/fake-token-codex.mjs"));
    await writeFile(world.table, JSON.stringify(world.agentsTable));
    const runtime = await world.boot();
    try {
      await startGroup(runtime, world.repoId, 0, async () => {
        runtime.store.db.prepare("INSERT INTO spend_caps VALUES ('all','total',1900000,0,'human')").run();
      });
      const transaction = runtime.store.transaction.bind(runtime.store);
      let inserted = false;
      const spy = vi.spyOn(runtime.store, "transaction").mockImplementation(((operation: () => unknown) => {
        const run = workRuns(runtime)[0];
        if (!inserted && run?.body.state === "accepted" && existsSync(join(runtime.store.stateDir, "checkpoints", run.runId, `allowance-${run.runId}.json`))) {
          inserted = true;
          transaction(() => writeHandoffRequest(runtime.store, { requestId: "handoff-during-allowance", runId: run.runId, state: "request-pending", deadlineAt: "2099-01-01T00:00:00.000Z", phaseAttemptOrdinal: 2, failureCode: null, evidenceIds: [] }, "g"));
        }
        return transaction(operation);
      }) as typeof runtime.store.transaction);
      try {
        runtime.startPump(50);
        await until(() => inserted, 20_000, "handoff request inserted at checkpoint commit");
        await runtime.driver!.stop();
        const run = workRuns(runtime)[0]!;
        expect(latestRequestForRun(runtime.store, "g", run.runId)).toMatchObject({ requestId: "handoff-during-allowance" });
        expect(run.body.state).not.toBe("settled-recoverable");
        expect(run.body.checkpointId).toBeNull();
        expect(readWork(runtime.store, "g", "a").status).not.toBe("ready");
        expect(Number(runtime.store.db.prepare("SELECT active FROM runs WHERE id=?").get(run.runId)!.active)).toBe(1);
      } finally { spy.mockRestore(); }
    } finally { await world.teardown(); }
  }, 30_000);
});
