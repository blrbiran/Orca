/**
 * Flow engine spec §16.2, §21 C17 (H32): a step's `tools` reach the child contract's `executionPolicy.toolRules` exactly
 * as ccloop's per-contract tool rules spec §2/§9 spell them, and a step without `tools` gives a contract byte-equal to
 * the one built today (no `toolRules` key at all -- ccloop: "absent leaves the contract byte-identical"). A dropped or
 * widened rule would let an agent run what the template did not allow, so every rule is compared, not counted.
 */
import { describe, expect, it } from "vitest";
import { canonicalBytes } from "../../src/control/canonicalJson.js";
import { buildFlowStepPlanSource, DEFAULT_CHANGED_GATE } from "../../src/control/flowStepPlan.js";
import { toolRulesSchema } from "../../src/control/toolRules.js";
import { stepToolsToToolRules } from "../../src/flow/toolRulesMap.js";
import { flowStepSchema, type FlowStep } from "../../src/flow/template/schema.js";

const work = (extra: Record<string, unknown> = {}): FlowStep => flowStepSchema.parse({ id: "write", kind: "work", prompt: "prompts/write.md", ...extra });
const build = (step: FlowStep, more: Partial<Parameters<typeof buildFlowStepPlanSource>[0]> = {}) => buildFlowStepPlanSource({
  flowRunId: "fr-1", step, seq: 1, baseCommit: "a".repeat(40), vaultPath: "/vault/x.git", promptEnvelope: "Do the work.\n", gates: [], ...more,
});
const contractOf = (plan: ReturnType<typeof build>): Record<string, any> => JSON.parse(plan.tasks[0]!.originalContractCanonicalJson);

describe("step tools to ccloop tool rules (C17)", () => {
  it("maps exact and prefix commands, network and secrets exactly, in order", () => {
    const rules = stepToolsToToolRules({ commands: [{ exact: "npm test" }, { prefix: "md2wechat " }], network: true, secrets: ["WECHAT_APPID", "WECHAT_SECRET"] });
    expect(rules).toEqual({ commands: [{ kind: "exact", value: "npm test" }, { kind: "prefix", value: "md2wechat " }], network: true, secretEnv: ["WECHAT_APPID", "WECHAT_SECRET"] });
    expect(toolRulesSchema.safeParse(rules).success).toBe(true);
  });
  it("fills what the step leaves out with the closed defaults: no commands, no network, no secrets", () => {
    expect(stepToolsToToolRules({})).toEqual({ commands: [], network: false, secretEnv: [] });
    expect(stepToolsToToolRules({ commands: [{ exact: "ls" }] })).toEqual({ commands: [{ kind: "exact", value: "ls" }], network: false, secretEnv: [] });
  });
  it("a step's tools reach the child contract's executionPolicy.toolRules exactly", () => {
    const tools = { commands: [{ exact: "npm test" }, { prefix: "git status" }], secrets: ["TOKEN"] };
    const contract = contractOf(build(work({ tools })));
    expect(contract.executionPolicy.toolRules).toEqual({ commands: [{ kind: "exact", value: "npm test" }, { kind: "prefix", value: "git status" }], network: false, secretEnv: ["TOKEN"] });
  });
  it("a step without tools gives a contract byte-equal to the one built with no rules: no toolRules key", () => {
    const plain = build(work()).tasks[0]!;
    expect(plain.originalContractCanonicalJson.includes("toolRules")).toBe(false);
    const ruled = contractOf(build(work({ tools: { network: true } })));
    delete ruled.executionPolicy.toolRules;
    expect(canonicalBytes(ruled).toString("utf8")).toBe(plain.originalContractCanonicalJson);
  });
});

describe("the flow step plan (§6.2)", () => {
  it("is one task `step` on the vault, the whole tree, no dependencies, the gates as its checks", () => {
    const plan = build(work(), { gates: ["test -f out.md"] });
    expect(plan.tasks.map((t) => [t.taskId, t.dependencyTaskIds])).toEqual([["step", []]]);
    const contract = contractOf(plan);
    expect(contract.context.repoPath).toBe("/vault/x.git");
    expect(contract.context.targetPaths).toEqual(["**"]);
    expect(contract.context.buildTestCommands).toEqual(["test -f out.md"]);
    expect(contract.verification.requiredChecks).toEqual(["test -f out.md"]);
    expect(contract.objective.goal).toContain("Do the work.");
  });
  it("without template gates a non-effect step is held to the default gate: the attempt changed at least one path", () => {
    const contract = contractOf(build(work()));
    expect(contract.verification.requiredChecks).toEqual([DEFAULT_CHANGED_GATE("a".repeat(40))]);
    expect(DEFAULT_CHANGED_GATE("a".repeat(40))).toContain("a".repeat(40));
  });
});

describe("the collected tool-rule report (C17)", () => {
  it("is stored per execution; detected, recorded-only network and refused rules flag it red", async () => {
    const { fakeChildPort } = await import("./fixtures/childPort.js");
    const { flowWorld } = await import("./fixtures/flowWorld.js");
    const { childGroupIdOf } = await import("../../src/flow/kinds/work.js");
    const children = fakeChildPort();
    const w = await flowWorld({ w: { yaml: `format: orca-flow-v1
id: w
workspace: {kind: dir}
steps:
  - {id: write, kind: work, prompt: p.md, tools: {commands: [{exact: "npm test"}], network: false, secrets: [TOKEN]}}
`, assets: { "p.md": "Write.\n" } } }, { children: children.port }); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/w" });
      await w.advance();
      const id = childGroupIdOf(flowRunId, "write", 1);
      expect(JSON.parse(children.opened.get(id)!.plan.tasks[0]!.originalContractCanonicalJson).executionPolicy.toolRules)
        .toEqual({ commands: [{ kind: "exact", value: "npm test" }], network: false, secretEnv: ["TOKEN"] });
      const report = { schema: "ccloop-tool-rules-report-v1" as const, agentKind: "omp" as const, baseline: "b", rules: [
        { rule: { kind: "exact" as const, value: "npm test" }, status: "detected" as const, reason: null, phases: ["execute" as const] },
        { rule: { kind: "commands-closed" as const }, status: "recorded-only" as const, reason: null, phases: ["execute" as const] },
        { rule: { kind: "network" as const, value: false }, status: "recorded-only" as const, reason: null, phases: ["execute" as const] },
        { rule: { kind: "secretEnv" as const, name: "TOKEN" }, status: "refused" as const, reason: "no env filter", phases: ["execute" as const] },
      ] };
      children.land(id, { "a.md": "a\n" }, { toolRules: report });
      await w.advance();
      const body = w.latest(flowRunId, "write")!.body as { record: { toolRules: unknown }; flags: string[] };
      expect(body.record.toolRules).toEqual(report);
      expect(body.flags).toEqual(["tool-rule:detected", "tool-rule:recorded-only", "tool-rule:refused"]);
    } finally { await w.dispose(); }
  });
});
