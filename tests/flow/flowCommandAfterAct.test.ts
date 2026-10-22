/**
 * Review finding M4: a flow verb acts in the kernel, then the ledger books what it did. When the act succeeded (the run
 * started) but advancing the run afterwards failed, the command is still what it did -- booked as `flow-started` with
 * the run id, so a retry finds the run instead of reporting a failure for a run that exists -- and the failure is the
 * run's, recorded on it.
 */
import { describe, expect, it } from "vitest";
import { WebControlService } from "../../src/control/webService.js";
import type { FlowChildPort } from "../../src/flow/kinds/work.js";
import { childGroupIdOf } from "../../src/flow/kinds/work.js";
import { getFlowRun } from "../../src/flow/store.js";
import { fakeChildPort } from "./fixtures/childPort.js";
import { flowWorld } from "./fixtures/flowWorld.js";

const ONE = { one: { yaml: "format: orca-flow-v1\nid: one\nworkspace: {kind: dir}\nsteps:\n  - {id: write, kind: work, prompt: p.md}\n", assets: { "p.md": "Write.\n" } } };

describe("a flow command whose run failed to advance after the act (M4)", () => {
  it("is booked as the run it started; the error is on the run", async () => {
    const children = (): FlowChildPort => ({ open: async () => { throw new Error("driver unavailable"); }, status: async () => null });
    const w = await flowWorld(ONE, { children }); try {
      const service = new WebControlService({ store: w.store, port: {} as never, profileRouter: {} as never, trustedConfig: {} as never, flowDeps: () => w.deps,
        flowProjects: () => [{ repoId: "articles-00000000", path: w.folder }] } as never);
      const command = { schema: "orca-raw-command-v1", commandId: "start-1", actorId: "owner", expectedRevision: 0, verb: "flow-start", target: { kind: "flows" }, payload: { template: "one", dir: w.folder, params: {} } } as never;
      const answer = await service.flowCommand(command) as { result?: { kind: string; flowRunId: string }; error?: unknown };
      expect(answer.error).toBeUndefined();
      expect(answer.result).toMatchObject({ kind: "flow-started" });
      expect((getFlowRun(w.store, answer.result!.flowRunId)!.body as { lastError?: { message: string } }).lastError?.message).toBe("driver unavailable");
      // A retry of the same command is answered from the booking: the same run.
      expect(((await service.flowCommand(command)) as { result?: { flowRunId: string } }).result?.flowRunId).toBe(answer.result!.flowRunId);
    } finally { await w.dispose(); }
  });

  it("an answer taken, then the revision's start failing: booked as answered, the error on the run", async () => {
    const children = fakeChildPort();
    const w = await flowWorld(ONE, { children: children.port }); try {
      const service = new WebControlService({ store: w.store, port: {} as never, profileRouter: {} as never, trustedConfig: {} as never, flowDeps: () => w.deps,
        flowProjects: () => [{ repoId: "articles-00000000", path: w.folder }] } as never);
      const { flowRunId } = await w.start({ templateRef: "builtin/one" });
      await w.advance();
      children.land(childGroupIdOf(flowRunId, "write", 1), {}, { flow: { needs: { kind: "input", question: "Which title?" } } as never });
      await w.advance();
      expect(w.latest(flowRunId, "write")).toMatchObject({ state: "needs-person" });
      children.failNextOpen();
      const answer = await service.flowCommand({ schema: "orca-raw-command-v1", commandId: "answer-1", actorId: "owner", expectedRevision: 0, verb: "flow-answer", target: { kind: "flows" },
        payload: { runId: flowRunId, stepKey: "write", text: "The tea break" } } as never) as { result?: { kind: string }; error?: unknown };
      expect(answer.error).toBeUndefined();
      expect(answer.result).toMatchObject({ kind: "flow-answered", answer: "needs" });
      expect((getFlowRun(w.store, flowRunId)!.body as { lastError?: { message: string } }).lastError?.message).toMatch(/crash after the dispatch/);
    } finally { await w.dispose(); }
  });
});
