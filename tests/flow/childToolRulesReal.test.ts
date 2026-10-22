/**
 * Found in the Task 18 acceptance: every step that landed showed no tool-rule report and no `tool-rule:*` flag (the run
 * page's C17 rows), although ccloop wrote one for each (`run/tool-rules.json`) and collect answered it. The driver keeps
 * the report on the drive record only for a run that failed; the child port read it from there. A landed child's report
 * is read from its saved collect report, so the step shows the rules and the flags they give.
 */
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { toolRuleFlags } from "../../src/flow/kinds/work.js";
import { readFlowRun } from "../../src/flow/views.js";
import { getFlowRun, listExecutions } from "../../src/flow/store.js";
import { ccloopWorlds, realBinary, until } from "../control/fixtures/ccloopWorld.js";
import { flowRunWorld } from "./fixtures/flowCcloopWorld.js";

const OFFLINE = {
  yaml: `format: orca-flow-v1
id: offline
workspace: {kind: dir}
roles:
  writer: {tier: low, suggest: {agent: codex}}
steps:
  - {id: write, kind: work, role: writer, prompt: prompts/write.md, tools: {network: false}}
`,
  assets: { "prompts/write.md": "Write answer.txt.\n" },
};

const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-child-rules-", epochPrefix: "epoch-child-rules-" });
afterAll(removeRoots);

describe.skipIf(!realBinary)("a landed step's tool-rule report (T18 acceptance finding)", { timeout: 300_000 }, () => {
  relocateHome("orca-child-rules-home-");

  it("is kept on the execution with the flags it gives", async () => {
    const vaults = await realpath(await mkdtemp(join(tmpdir(), "orca-child-rules-vaults-")));
    const w = await world([], {}, { claudeScript: {}, declaredContextWindowTokens: 1_000_000, env: { ORCA_VAULT_DIR: vaults } });
    const f = await flowRunWorld(w, { templates: { offline: OFFLINE }, folder: { "notes.md": "notes\n" } });
    try {
      const { runtime, flowRunId } = await f.start("builtin/offline");
      runtime.startPump(50);
      await until(() => {
        const stuck = listExecutions(runtime.store, flowRunId).find((e) => e.state === "failed" || e.state === "parked");
        if (stuck !== undefined) throw new Error(`${stuck.stepKey}#${stuck.seq} ${stuck.state}: ${JSON.stringify(stuck.body)}`);
        return getFlowRun(runtime.store, flowRunId)!.state === "done";
      }, 180_000, "the run to complete", 100);
      const view = readFlowRun(runtime.store, flowRunId) as { steps: Array<{ stepKey: string; latest: { state: string; flags: string[]; toolRules: { schema: string; rules: Array<{ rule: { kind: string }; status: string }> } | null } }> };
      const write = view.steps.find((s) => s.stepKey === "write")!.latest;
      expect(write.state).toBe("done");
      expect(write.toolRules?.schema).toBe("ccloop-tool-rules-report-v1");
      // Fake codex runs under codex's sandbox, which enforces network: false; the flags are the report's (C17).
      expect(write.toolRules!.rules.find((r) => r.rule.kind === "network")?.status).toBe("enforced");
      expect(write.flags).toEqual(toolRuleFlags(write.toolRules as never));
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });
});
