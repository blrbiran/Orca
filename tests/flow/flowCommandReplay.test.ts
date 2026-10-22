import { describe, expect, it } from "vitest";
import { WebControlService } from "../../src/control/webService.js";
import { getFlowRun, listMessages } from "../../src/flow/store.js";
import { flowWorld } from "./fixtures/flowWorld.js";

/**
 * Flow engine spec §14.2 (plan Task 15): a flow verb acts in the kernel before the ledger books it, so a command whose
 * answer was lost (the panel died between the act and the booking) is sent again with the same id. The second send must
 * not act twice: the start finds the run it started, the message is deduped by the command id, the pool is raised once.
 * Simulated by deleting the booked row between the two sends.
 */
const TPL = { yaml: "format: orca-flow-v1\nid: t\nparams:\n  idea: {type: longtext, required: true}\nworkspace: {kind: dir}\nsteps:\n  - {id: write, kind: draft, prompt: p.md}\n", assets: { "p.md": "Write.\n" } };
let n = 0;
const raw = (verb: string, payload: unknown, commandId = `cmd-${++n}`) => ({ schema: "orca-raw-command-v1", commandId, actorId: "owner", expectedRevision: 0, verb, target: { kind: "flows" }, payload }) as never;

describe("a flow command sent again after a lost answer acts once", () => {
  it("start, message and pool raise", async () => {
    const w = await flowWorld({ t: TPL }); try {
      const service = new WebControlService({ store: w.store, port: {} as never, profileRouter: {} as never, trustedConfig: {} as never, flowDeps: () => w.deps,
        // Review finding I4 (Ruling: 这次批准改写所有必要的判据 (b37f7ce9)): a flow starts only on a registered dir project.
        flowProjects: () => [{ repoId: "articles-00000000", path: w.folder }] } as never);
      const lose = (commandId: string) => w.store.db.prepare("DELETE FROM commands WHERE id=?").run(commandId);
      const send = async (command: never) => (await service.flowCommand(command)) as { result?: Record<string, unknown>; error?: { code: string } };

      const start = raw("flow-start", { template: "t", dir: w.folder, params: { idea: "tea" } });
      const first = await send(start);
      lose((start as { commandId: string }).commandId);
      const again = await send(start);
      expect(again.result).toEqual(first.result);
      expect(w.store.db.prepare("SELECT COUNT(*) AS n FROM flow_runs").get()!.n).toBe(1);
      const runId = String(first.result!.flowRunId);

      const feedback = raw("flow-message", { runId, kind: "command", target: { kind: "run" }, body: { command: "pause" } });
      expect((await send(feedback)).result).toMatchObject({ deduped: false });
      lose((feedback as { commandId: string }).commandId);
      expect((await send(feedback)).result).toMatchObject({ deduped: true });
      expect(listMessages(w.store, runId).filter((m) => (m.body as { command?: string }).command === "pause")).toHaveLength(1);

      const pool = raw("flow-pool", { runId, raiseTokens: 1000 });
      const before = getFlowRun(w.store, runId)!.poolTokens;
      await send(pool);
      lose((pool as { commandId: string }).commandId);
      await send(pool);
      expect(getFlowRun(w.store, runId)!.poolTokens).toBe(before + 1000);
    } finally { await w.dispose(); }
  });
});
