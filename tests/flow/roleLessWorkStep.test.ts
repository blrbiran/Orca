/**
 * Found in the Task 18 acceptance: the built-in's `article` step names no role, and its child was never confirmed --
 * `recovery-blocked:flow-child-agent-selection-rejected` on the run, the step `running` for good. A child's plan carries
 * an agent only from its step's role (§12.3); without one the child's selection fell to the operator layer of Orca's own
 * actor, which no person ever sets. A step without a role runs on today's default selection, as an unmatched role does
 * (§12.3: the first installation the panel lists), recorded on the child's plan.
 */
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readArchivedPlan, readBudgetProposal } from "../../src/control/queries.js";
import { getFlowRun, listExecutions } from "../../src/flow/store.js";
import { ccloopWorlds, realBinary, until } from "../control/fixtures/ccloopWorld.js";
import { flowRunWorld } from "./fixtures/flowCcloopWorld.js";

const NO_ROLE = {
  yaml: `format: orca-flow-v1
id: plain
workspace: {kind: dir}
steps:
  - {id: write, kind: work, prompt: prompts/write.md}
`,
  assets: { "prompts/write.md": "Write answer.txt.\n" },
};

const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-no-role-", epochPrefix: "epoch-no-role-" });
afterAll(removeRoots);

describe.skipIf(!realBinary)("a work step without a role (T18 acceptance finding)", { timeout: 300_000 }, () => {
  relocateHome("orca-no-role-home-");

  it("is confirmed on the first installation the panel lists (today's default selection) and dispatched", async () => {
    const vaults = await realpath(await mkdtemp(join(tmpdir(), "orca-no-role-vaults-")));
    const w = await world([], {}, { claudeScript: {}, declaredContextWindowTokens: 1_000_000, env: { ORCA_VAULT_DIR: vaults } });
    const f = await flowRunWorld(w, { templates: { plain: NO_ROLE }, folder: { "notes.md": "notes\n" } });
    try {
      const { runtime, flowRunId } = await f.start("builtin/plain");
      runtime.startPump(50);
      let child: string | undefined;
      await until(() => {
        const error = (getFlowRun(runtime.store, flowRunId)!.body as { lastError?: { message: string } }).lastError;
        if (error !== undefined) throw new Error(error.message);
        child = listExecutions(runtime.store, flowRunId).find((e) => e.stepKey === "write")?.childGroupId ?? undefined;
        return child !== undefined && runtime.store.db.prepare("SELECT count(*) AS n FROM runs WHERE group_id=?").get(child)!.n !== 0;
      }, 180_000, "the child to be dispatched", 100);
      expect(readBudgetProposal(runtime.store, child!).state).toBe("confirmed");
      expect(readArchivedPlan(runtime.store, child!).plan.agent).toMatchObject({ agent: runtime.flow!.deps.agents()[0]!.agent });
      await runtime.shutdown();
    } finally { await w.teardown(); }
  });
});
