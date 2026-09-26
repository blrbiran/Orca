import { describe, expect, it } from "vitest";
import { levelLayers, resolveSelection, slotLayers, type OperatorPreferences } from "../../src/control/agentSelection.js";

// Ruling review R7 (human ruling 2026-09-27, overturning spec §13.1 D2): each group or task level is the plan's layer
// under the panel's, merged per field. A panel field left out inherits (the plan's value at this level, then below);
// null means "as if the plan had not written this field here" and inherits from below; a null agent drops the plan's
// whole layer at that level. Human: "没替换的部分应该用默认值吧？如果要清空默认值，应该传空值", "null 往下退到哪里 =>
// 同意你的建议" (only the same level's plan value is masked), "任务层 null 屏蔽了 task·plan 之后，组层照常生效 => 同意".
// Every expectation is a literal, resolved end to end through slotLayers and resolveSelection.

const operator: OperatorPreferences = { defaultAgent: "claude", perAgent: { claude: { model: "claude-operator-model" }, codex: { model: "gpt-6-sol" } } };
const plan = { group: { agent: "codex", model: "gpt-6-plan", contextWindow: "agent-default" as const } };
const worker = (group: Parameters<typeof slotLayers>[2], task?: Parameters<typeof slotLayers>[3], planLayers = plan) =>
  resolveSelection(slotLayers("worker", operator, group, task, planLayers), operator.perAgent);

describe("the plan and the panel at one level, merged per field (ruling review R7)", () => {
  it("uses the plan's values when the panel says nothing", () => {
    expect(worker({})).toEqual({
      partial: { agent: "codex", model: "gpt-6-plan", contextWindow: "agent-default" },
      provenance: { agent: "group-plan", model: "group-plan", contextWindow: "group-plan" },
    });
  });

  it("overrides only the field the panel gives; the rest still comes from the plan", () => {
    expect(worker({ worker: { model: "gpt-6-panel" } })).toEqual({
      partial: { agent: "codex", model: "gpt-6-panel", contextWindow: "agent-default" },
      provenance: { agent: "group-plan", model: "group", contextWindow: "group-plan" },
    });
  });

  it("drops the plan's model and context when the panel switches the agent, since they were chosen for another agent", () => {
    expect(worker({ worker: { agent: "claude" } })).toEqual({
      partial: { agent: "claude", model: "claude-operator-model" },
      provenance: { agent: "group", model: "operator-agent", contextWindow: null },
    });
  });

  it("masks one plan field with null and inherits that field from below", () => {
    expect(worker({ worker: { model: null } })).toEqual({
      partial: { agent: "codex", model: "gpt-6-sol", contextWindow: "agent-default" },
      provenance: { agent: "group-plan", model: "operator-agent", contextWindow: "group-plan" },
    });
  });

  it("drops the plan's whole layer when the panel masks its agent, falling back to the operator's agent and defaults", () => {
    expect(worker({ worker: { agent: null } })).toEqual({
      partial: { agent: "claude", model: "claude-operator-model" },
      provenance: { agent: "operator", model: "operator-agent", contextWindow: null },
    });
  });

  it("masks only the same level: a task that masks its plan agent falls back to the group level, not to the operator", () => {
    const result = worker({}, { agent: null }, { ...plan, task: { agent: "claude", model: "claude-task-plan" } } as never);
    expect(result).toEqual({
      partial: { agent: "codex", model: "gpt-6-plan", contextWindow: "agent-default" },
      provenance: { agent: "group-plan", model: "group-plan", contextWindow: "group-plan" },
    });
  });

  it("keeps the older names for the panel's layers and gives the plan's their own", () => {
    expect(levelLayers("group-plan", "group", { agent: "codex", model: "m" }, { model: null, contextWindow: "agent-default" })).toEqual([
      { name: "group-plan", partial: { agent: "codex" } },
      { name: "group", partial: { contextWindow: "agent-default" } },
    ]);
    expect(levelLayers("task-plan", "task", { agent: "codex", model: "m" }, { agent: null, model: "x" })).toEqual([
      { name: "task-plan", partial: {} },
      { name: "task", partial: { model: "x" } },
    ]);
  });

  it("merges the reconcile slot's own level the same way, above the group worker level", () => {
    const result = resolveSelection(slotLayers("reconcile", operator, { reconcile: { model: "gpt-6-reconcile-panel" } }, undefined, {
      group: { agent: "claude" }, reconcile: { agent: "codex", model: "gpt-6-reconcile-plan" },
    }), operator.perAgent);
    expect(result).toEqual({
      partial: { agent: "codex", model: "gpt-6-reconcile-panel" },
      provenance: { agent: "group-reconcile-plan", model: "group-reconcile", contextWindow: null },
    });
  });

  it("reads a null in the estimator's panel layer as no choice (the plan has no estimator layer, ruling R8)", () => {
    const result = resolveSelection(slotLayers("estimator", operator, { estimator: { agent: null, model: "e" } }), operator.perAgent);
    expect(result).toEqual({ partial: { agent: "claude", model: "e" }, provenance: { agent: "operator", model: "group-estimator", contextWindow: null } });
  });
});
