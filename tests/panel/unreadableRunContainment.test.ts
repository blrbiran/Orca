import express from "express";
import { createServer } from "node:http";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerControlReadRoutes } from "../../src/panel/controlApi.js";
import type { Principal } from "../../src/panel/permissions.js";
import { quotaProbeWorld } from "../control/fixtures/quotaProbeWorld.js";
import { overSocket } from "./fixtures/socketPanel.js";

/**
 * Tester #348, the deeper point (controller agrees): one run whose stored body the strict run read schema cannot decode
 * made every task of its group unreadable and unactionable, though the run belonged to one task or to none. Now the group
 * view reads; the run is named once on the group (`unreadableRuns`: its work item, its task or null, why) and on the task
 * that owns it; every other task reads as before; `group brief` names it. Containment changes only what the read views
 * show: the command routes never read the view schema (before #348 the 423 on `task retry` came from the CLI's pre-read
 * GET), and per the review ruling (session 4389b15f, 2026-11-18) they still do not -- a command naming that run is
 * answered as before #348. The next unknown key is simulated by adding one (`futureKey`) to a stored body.
 */
const agent: Principal = { kind: "agent", client: "mcp:test" };
const headers = { "x-orca-client": "mcp:test" };
type View = { summary: { commandRevision: number }; runs: Array<{ runId: string }>; unreadableRuns?: unknown;
  workItems: Array<{ taskId: string; currentRunId: string | null; progress?: unknown; unreadableRuns?: unknown }> };

describe("a run the read schema cannot decode stays with its own task (#348)", { timeout: 240_000 }, () => {
  it("the group view and brief read, the run is named on its task or the group, and commands are answered as before #348", async () => {
    const w = await quotaProbeWorld({ tasks: [{ taskId: "a", agent: { agent: "codex" } }, { taskId: "b", dependsOn: ["a"], agent: { agent: "codex" } }], failing: ["a"] });
    const app = express(); app.use(express.json());
    app.use((_req, res, next) => { res.locals.orcaPrincipal = agent; next(); });
    registerControlReadRoutes(app, { store: w.t.h.store, epoch: "epoch", config: { readView: async () => ({}) } as never, service: w.t.service }, "socket");
    const server = createServer(app), socketPath = join(w.t.h.root, "c.sock");
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    const db = w.t.h.store.db;
    const withFutureKey = (runId: string) => db.prepare("UPDATE runs SET body=json_set(body,'$.futureKey',1) WHERE id=?").run(runId);
    const withoutFutureKey = (runId: string) => db.prepare("UPDATE runs SET body=json_remove(body,'$.futureKey') WHERE id=?").run(runId);
    const read = async (path: string) => { const answer = await overSocket(socketPath, "GET", path, headers); expect(answer.status, `${path}: ${answer.text}`).toBe(200); return JSON.parse(answer.text) as Record<string, unknown>; };
    try {
      w.restEnds();
      await w.pass();
      const [probe] = w.probes();
      const failedRun = w.failed.a!;
      const unknownKey = "Unrecognized key(s) in object: 'futureKey'";

      // 1. A run no task owns (the probe's): the group names it; both tasks read as before.
      withFutureKey(probe!.runId);
      // mutation: runDecode blocks again on a schema miss -> groups/g answers 423, red
      const groupOnly = await read("/api/control/groups/g") as unknown as View;
      const probeEntry = { runId: probe!.runId, workItemId: probe!.workItemId, taskId: null, reason: `run-invalid:${probe!.runId}:${unknownKey}` };
      expect(groupOnly.unreadableRuns).toEqual([probeEntry]);
      expect(groupOnly.runs.map((run) => run.runId)).not.toContain(probe!.runId);
      expect(groupOnly.runs.map((run) => run.runId)).toContain(failedRun);
      for (const item of groupOnly.workItems) expect(item, item.taskId).not.toHaveProperty("unreadableRuns");
      // mutation: drop unreadableRuns from the brief route -> no key, red
      expect((await read("/api/control/groups/g/brief")).unreadableRuns).toEqual([probeEntry]);
      withoutFutureKey(probe!.runId);

      // 2. Task a's current run: a's view names it (and shows no progress); b reads as before; the brief names task a.
      withFutureKey(failedRun);
      const owned = await read("/api/control/groups/g") as unknown as View;
      const failedEntry = { runId: failedRun, workItemId: "a", taskId: "a", reason: `run-invalid:${failedRun}:${unknownKey}` };
      expect(owned.unreadableRuns).toEqual([failedEntry]);
      const [a, b] = owned.workItems;
      // mutation: leave unreadableRuns off the work item view -> a carries none, red
      expect(a).toMatchObject({ taskId: "a", currentRunId: failedRun, progress: null, unreadableRuns: [{ runId: failedRun, reason: failedEntry.reason }] });
      expect(b).toMatchObject({ taskId: "b" });
      expect(b).not.toHaveProperty("unreadableRuns");
      expect((await read("/api/control/groups/g/brief")).unreadableRuns).toEqual([failedEntry]);
      // Ruling: human approved necessary criteria changes this round (session 4389b15f, 2026-11-18)
      // Review ruling: the command routes do not read the view schema, so a command naming the run is answered as before #348.
      // mutation: refuse a command naming a run the view schema cannot decode (the dropped guard) -> 423, red
      const retry = await overSocket(socketPath, "POST", "/api/control/groups/g/retry-task", headers,
        { commandId: "retry-unreadable", expectedRevision: owned.summary.commandRevision, payload: { taskId: "a", runId: failedRun } });
      expect(retry.status, retry.text).toBe(200);
      withoutFutureKey(failedRun);

      // 3. Once the run reads again, nothing is named.
      const clean = await read("/api/control/groups/g") as unknown as View;
      expect(clean).not.toHaveProperty("unreadableRuns");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve()));
      await w.t.h.dispose();
    }
  });
});
