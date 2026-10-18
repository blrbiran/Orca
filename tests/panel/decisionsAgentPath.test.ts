import { mkdtemp, realpath, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { describe, expect, it } from "vitest";
import { readCorrections } from "../../src/corrections/store.js";
import { WebControlService } from "../../src/control/webService.js";
import { registerControlReadRoutes, verifyControlJsonBody, type ControlReadApiDeps } from "../../src/panel/controlApi.js";
import { bindControlSocket, buildControlSocketApp } from "../../src/panel/controlSocket.js";
import type { Principal } from "../../src/panel/permissions.js";
import { driverHarness, git } from "../control/fixtures/driverHarness.js";
import { overSocket } from "./fixtures/socketPanel.js";

// Control run decisions plan Task 11 Step 5, ledger spec §10.7's "agent path": an agent on the control socket reads a
// group's pending decisions, cannot approve or reject them, and an owner over the Web can. Every assertion reads a
// route's answer or the corrections store (a mkdtemp dir, Rule 17), never a value the test wrote itself.
const LANDED = ["landed", "settled"];
const tier0 = (n: number) => ({
  question: `q${n}`, chose: `c${n}`, alternatives: [{ option: "o", why_not: "w" }], because: "b",
  undo: { how: "revert it", cost: "c", blast_radius: "r" }, scope: "task", kind: "interface",
});
const UNDO = `git revert --no-edit ${"e".repeat(40)}`;
type Pending = { pendingId: string; state: string; undoHow: string | null };
type View = { pendingCount: number; tasks: Array<{ runs: Array<{ runId: string; pending: Pending[]; decisions: Array<{ id: string }> }> }> };

describe("the agent path to pending decisions (control run decisions Task 11, §10.7)", { timeout: 60_000 }, () => {
  it("an agent reads the pending items but is refused approve and reject; an owner's Web posts succeed", async () => {
    const t = await driverHarness([{ taskId: "a" }], { decisions: () => [tier0(0), tier0(1)] });
    const correctionsDir = await mkdtemp(join(tmpdir(), "orca-corrections-"));
    const socketDir = await realpath(await mkdtemp(join(tmpdir(), "dap-")));
    let closeWeb = async (): Promise<void> => {};
    let closeSocket = async (): Promise<void> => {};
    try {
      const runId = await t.claim();
      await t.until(t.driver(), () => LANDED.includes(t.body(runId).state));
      git(t.repo, "remote", "add", "origin", "https://example.invalid/o/r.git");
      const service = new WebControlService({
        ...t.h.deps, knownRepository: (repoId: string) => repoId === "repo", resolveRepository: () => t.repo,
        correctionsDir, correctionsBy: "owner@example.invalid",
      });
      const deps: ControlReadApiDeps = { store: t.h.store, epoch: "epoch", config: { readView: async () => ({}) } as never, service };

      // The Web channel, as the login gate leaves it for the panel's owner.
      const web = express();
      web.use((_req, res, next) => { res.locals.orcaPrincipal = { kind: "user", userId: "o", name: "o", roles: ["owner"] } satisfies Principal; next(); });
      web.use(express.json({ verify: verifyControlJsonBody }));
      registerControlReadRoutes(web, deps, "web");
      const server = createServer(web);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      closeWeb = () => new Promise<void>((resolve) => server.close(() => resolve()));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("address");
      const base = `http://127.0.0.1:${address.port}`;

      const socketPath = join(socketDir, "control.sock");
      const bound = await bindControlSocket(buildControlSocketApp(deps), socketPath);
      if (!("close" in bound)) throw new Error(`socket not bound: ${bound.code}: ${bound.detail}`);
      closeSocket = bound.close;

      // The agent reads the group's decisions on the socket and sees both refused items waiting.
      const read = await overSocket(socketPath, "GET", "/api/control/groups/g/decisions", { "x-orca-client": "mcp:reader" });
      expect(read.status).toBe(200);
      const seen = JSON.parse(read.text) as View;
      const pending = seen.tasks.flatMap((task) => task.runs).find((run) => run.runId === runId)!.pending;
      expect({ count: seen.pendingCount, pending: pending.map((p) => [p.pendingId, p.state]) })
        .toEqual({ count: 2, pending: [[`pending-${runId}-0`, "pending"], [`pending-${runId}-1`, "pending"]] });

      // Its approve and reject are refused by name, before anything is booked.
      const revision = async (): Promise<number> =>
        ((await (await fetch(`${base}/api/control/groups/g`)).json()) as { summary: { commandRevision: number } }).summary.commandRevision;
      const agentApprove = await overSocket(socketPath, "POST", "/api/control/groups/g/decisions/approve", { "x-orca-client": "mcp:reader" },
        { commandId: "dap-agent-approve", expectedRevision: await revision(), payload: { pendingId: pending[0]!.pendingId, undoHow: UNDO } });
      const agentReject = await overSocket(socketPath, "POST", "/api/control/groups/g/decisions/reject", { "x-orca-client": "mcp:reader" },
        { commandId: "dap-agent-reject", expectedRevision: await revision(), payload: { pendingId: pending[1]!.pendingId } });
      expect({
        approve: [agentApprove.status, JSON.parse(agentApprove.text).error?.code],
        reject: [agentReject.status, JSON.parse(agentReject.text).error?.code],
      }).toEqual({ approve: [403, "control-verb-human-only"], reject: [403, "control-verb-human-only"] });

      // The owner's Web posts, as the panel sends them (Approve with an edited undo.how, Reject with no line).
      const post = async (path: string, commandId: string, payload: unknown) => {
        const res = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ commandId, expectedRevision: await revision(), payload }) });
        return [res.status, ((await res.json()) as { result?: { kind: string } }).result?.kind];
      };
      expect(await post("/api/control/groups/g/decisions/approve", "dap-owner-approve", { pendingId: pending[0]!.pendingId, undoHow: UNDO }))
        .toEqual([200, "pending-decision-approved"]);
      expect(await post("/api/control/groups/g/decisions/reject", "dap-owner-reject", { pendingId: pending[1]!.pendingId }))
        .toEqual([200, "pending-decision-rejected"]);

      // The agent's next read shows both settled by the owner, and the rejection is a correction in the store.
      const after = JSON.parse((await overSocket(socketPath, "GET", "/api/control/groups/g/decisions", { "x-orca-client": "mcp:reader" })).text) as View;
      const run = after.tasks.flatMap((task) => task.runs).find((r) => r.runId === runId)!;
      expect({ count: after.pendingCount, pending: run.pending.map((p) => [p.pendingId, p.state]), approved: run.decisions.map((d) => d.id) }).toEqual({
        count: 0, pending: [[`pending-${runId}-0`, "approved"], [`pending-${runId}-1`, "rejected"]], approved: [`${runId}/agent-0`],
      });
      expect((await readCorrections(correctionsDir)).map((row) => [row.runId, row.pendingId, row.kind])).toEqual([[runId, `pending-${runId}-1`, "wrong"]]);
    } finally {
      await closeSocket(); await closeWeb();
      await rm(socketDir, { recursive: true, force: true }); await rm(correctionsDir, { recursive: true, force: true });
      await t.h.dispose();
    }
  });
});
