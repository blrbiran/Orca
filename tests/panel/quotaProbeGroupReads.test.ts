import express from "express";
import { createServer } from "node:http";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerControlReadRoutes } from "../../src/panel/controlApi.js";
import type { Principal } from "../../src/panel/permissions.js";
import { quotaProbeWorld } from "../control/fixtures/quotaProbeWorld.js";
import { overSocket } from "./fixtures/socketPanel.js";

/**
 * Tester #348: once Orca's quota probe ran in a group (quotaProbeCall.ts), every task of that group answered 423
 * `recovery-blocked:run-invalid:<probe run>:Unrecognized key(s) in object: 'quotaProbe', 'probeVerdict'` -- `task show`
 * of a task the probe had nothing to do with, and `task retry` of the probed one -- because the group view's strict run
 * schema knew neither key the probe writes. The tester's acceptance, over the socket route the CLI uses: `task show` of
 * another task reads (200), `task retry` of the probed task answers (200), and `run show` of the probe run reads its
 * purpose and verdict.
 */
const agent: Principal = { kind: "agent", client: "mcp:test" };
const headers = { "x-orca-client": "mcp:test" };

describe("a group holding a quota-probe run (#348)", { timeout: 240_000 }, () => {
  it("task show of another task and task retry of the probed task answer; run show reads the probe's purpose and verdict", async () => {
    const w = await quotaProbeWorld({ tasks: [{ taskId: "a", agent: { agent: "codex" } }, { taskId: "b", dependsOn: ["a"], agent: { agent: "codex" } }], failing: ["a"] });
    const app = express(); app.use(express.json());
    app.use((_req, res, next) => { res.locals.orcaPrincipal = agent; next(); });
    registerControlReadRoutes(app, { store: w.t.h.store, epoch: "epoch", config: { readView: async () => ({}) } as never, service: w.t.service }, "socket");
    const server = createServer(app), socketPath = join(w.t.h.root, "p.sock");
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    try {
      w.restEnds();
      await w.pass();
      const [probe, ...more] = w.probes();
      expect(more).toEqual([]);
      // The two keys the tester found on the stored body: the probe's identity and its verdict.
      expect(probe!.body).toMatchObject({ quotaProbe: { installation: "codex", restRunId: w.failed.a, forTaskId: "a" }, probeVerdict: { verdict: "back" } });

      // `orca task show g b` reads groups/g (reads.ts task show).
      const show = await overSocket(socketPath, "GET", "/api/control/groups/g", headers);
      expect(show.status, show.text).toBe(200);
      const view = JSON.parse(show.text) as { summary: { commandRevision: number }; workItems: Array<{ taskId: string }>; runs: Array<Record<string, unknown>> };
      expect(view.workItems.map((item) => item.taskId)).toEqual(["a", "b"]);
      // `orca run show <probe>` is the probe's entry in that view, plus its activity and evidence reads.
      expect(view.runs.find((run) => run.runId === probe!.runId)).toMatchObject({
        phase: "single-call", purpose: "quota-probe", probeVerdict: { verdict: "back", cause: null, detail: null, errorCode: null },
      });
      for (const path of [`/api/control/runs/${probe!.runId}/activity`, `/api/control/runs/${probe!.runId}/evidence`, "/api/control/groups/g/brief"]) {
        const read = await overSocket(socketPath, "GET", path, headers);
        expect(read.status, `${path}: ${read.text}`).toBe(200);
      }

      // `orca task retry g a`: the CLI reads the task's current run from groups/g, then posts retry-task naming it.
      const retry = await overSocket(socketPath, "POST", "/api/control/groups/g/retry-task", headers,
        { commandId: "retry-348", expectedRevision: view.summary.commandRevision, payload: { taskId: "a", runId: w.failed.a } });
      expect(retry.status, retry.text).toBe(200);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve()));
      await w.t.h.dispose();
    }
  });
});
