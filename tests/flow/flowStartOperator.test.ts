/**
 * Found in the Task 18 acceptance (sandbox panel, `--by acceptor`): `orca flow start` was refused
 * `flow-profiles-unresolved:call agent: agent-unselected` although the operator had set claude as the default agent. The
 * parent's confirmation read agent preferences under the run's `by` -- the attribution's person name -- while preferences
 * are stored under the command's operator (`actorId`, the panel's operator id), which is also where a requirement's calls
 * read them (requirementCommands.ts). The start now hands the kernel the command's operator, and the confirmation reads
 * the estimator layer there; `by` stays the run's accountable person.
 */
import { describe, expect, it } from "vitest";
import { withCommandContext } from "../../src/control/commandClient.js";
import { WebControlService } from "../../src/control/webService.js";
import { flowWorld } from "./fixtures/flowWorld.js";

const TPL = { yaml: "format: orca-flow-v1\nid: t\nworkspace: {kind: dir}\nsteps:\n  - {id: write, kind: draft, prompt: p.md}\n", assets: { "p.md": "Write.\n" } };

describe("flow-start confirms the parent with the command's operator (T18 acceptance finding)", () => {
  it("a CLI start by person ann on operator op-1 asks the confirmation for op-1's preferences, and books ann", async () => {
    const asked: Array<Record<string, unknown>> = [];
    const w = await flowWorld({ t: TPL }, { confirmParent: async (input) => { asked.push(input as never); return { call: null, children: null }; } }); try {
      const service = new WebControlService({ store: w.store, port: {} as never, profileRouter: {} as never, trustedConfig: {} as never, flowDeps: () => w.deps, flowProjects: () => [{ repoId: "posts-1a2b3c4d", path: w.folder }] } as never);
      const command = { schema: "orca-raw-command-v1", commandId: "start-1", actorId: "op-1", expectedRevision: 0, verb: "flow-start", target: { kind: "flows" }, payload: { template: "t", dir: w.folder, params: {} } } as never;
      const answer = await withCommandContext("start-1", { client: "cli", principal: "agent:cli", attribution: { by: "ann", via: "cli:cli" } }, () => service.flowCommand(command)) as { error?: unknown };
      expect(answer.error).toBeUndefined();
      expect(asked).toHaveLength(1);
      expect(asked[0]).toMatchObject({ operatorId: "op-1", by: "ann" });
    } finally { await w.dispose(); }
  });
});
