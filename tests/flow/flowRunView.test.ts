/**
 * Flow engine spec §14.1, §16.2 (plan Task 16): what the run page reads. Every execution of a step is listed with its
 * state, output and red flags, and a `work` execution carries ccloop's tool-rule report exactly as ccloop gave it --
 * for a landed child from the execution body, for a failed one from its artifact record -- so the page can show each
 * rule's status and flag `detected`, `recorded-only` network and `refused`. The run list names the run's project and
 * folder, which the kanban's flow card is scoped by.
 */
import { describe, expect, it } from "vitest";
import { childGroupIdOf } from "../../src/flow/kinds/work.js";
import { readFlowList, readFlowRun } from "../../src/flow/views.js";
import { fakeChildPort } from "./fixtures/childPort.js";
import { flowWorld } from "./fixtures/flowWorld.js";

const YAML = `format: orca-flow-v1
id: w
workspace: {kind: dir}
steps:
  - {id: write, kind: work, prompt: p.md, tools: {commands: [{exact: "npm test"}], network: false}}
`;
const report = (status: "enforced" | "detected" | "recorded-only" | "refused") => ({ schema: "ccloop-tool-rules-report-v1" as const, agentKind: "claude" as const, baseline: "b", rules: [
  { rule: { kind: "exact" as const, value: "npm test" }, status: "enforced" as const, reason: null, phases: ["execute" as const] },
  { rule: { kind: "network" as const, value: false }, status, reason: status === "refused" ? "not expressible" : null, phases: ["execute" as const] },
] });

type View = { steps: Array<{ stepKey: string; latest: { seq: number; state: string; toolRules: unknown; flags: string[]; output: { kind: string } | null } | null; executions: Array<{ seq: number; state: string; toolRules: unknown; failure: string | null }> }> };

describe("the run page's read (Task 16, §16.2)", () => {
  it("lists every execution with its output, flags and the tool-rule report ccloop gave, landed or failed", async () => {
    const children = fakeChildPort();
    const w = await flowWorld({ w: { yaml: YAML, assets: { "p.md": "Write.\n" } } }, { children: children.port });
    try {
      const { flowRunId } = await w.start({ templateRef: "builtin/w" });
      await w.advance();
      children.fail(childGroupIdOf(flowRunId, "write", 1), "gate-failed", 0, { toolRules: report("refused") });
      await w.advance();
      const failed = readFlowRun(w.store, flowRunId) as View;
      // mutation: drop the artifact record's rules -> toolRules null, red
      expect(failed.steps[0]!.latest!.toolRules).toEqual(report("refused"));
      expect(failed.steps[0]!.latest!.state).toBe("failed");
      expect(failed.steps[0]!.latest!.flags).toEqual(["tool-rule:refused"]);
    } finally { await w.dispose(); }
  });

  it("reads a landed child's report from its body, and keeps earlier executions in the list", async () => {
    const children = fakeChildPort();
    const w = await flowWorld({ w: { yaml: YAML, assets: { "p.md": "Write.\n" } } }, { children: children.port });
    try {
      const { flowRunId } = await w.start({ templateRef: "builtin/w" });
      await w.advance();
      children.land(childGroupIdOf(flowRunId, "write", 1), { "a.md": "a\n" }, { toolRules: report("detected") });
      await w.advance();
      const view = readFlowRun(w.store, flowRunId) as View;
      const step = view.steps[0]!;
      // mutation: read the report from the artifact only -> null for a commit output, red
      expect(step.latest!.toolRules).toEqual(report("detected"));
      expect(step.latest!.output!.kind).toBe("commit");
      expect(step.latest!.flags).toEqual(["tool-rule:detected"]);
      expect(step.executions.map((e) => [e.seq, e.state])).toEqual([[1, "done"]]);
      const list = readFlowList(w.store) as { runs: Array<{ flowRunId: string; projectId: string | null; dir: string | null }> };
      expect(list.runs).toEqual([expect.objectContaining({ flowRunId, projectId: null, dir: w.folder })]);
    } finally { await w.dispose(); }
  });
});
