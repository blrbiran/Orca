import { describe, expect, it } from "vitest";
import {
  descriptorProvenance, resolveSelection, selectionsHash, selectionsHashV2, slotLayers,
  type FrozenSlot, type OperatorPreferences, type SelectionLayer,
} from "../../src/control/agentSelection.js";
import { unavailableCapabilities } from "../../src/control/profiles.js";

// Agent selection spec §6.3 (formal definition) and the §12 I8 rulings (a)-(e). Each `it` pins one ruling;
// the operator/group/task literals are the spec's own example agents (claude, codex) and default models.

const layer = (name: SelectionLayer["name"], partial: SelectionLayer["partial"]): SelectionLayer => ({ name, partial });
const prefs = (patch: Partial<OperatorPreferences> = {}): OperatorPreferences => ({ perAgent: {}, ...patch });

describe("resolveSelection follows the spec §6.3 formal definition", () => {
  it("inherits the group primary selection for an unconfigured estimator", () => {
    const operator = prefs({ defaultAgent: "A", perAgent: { A: { model: "A-m" }, B: { model: "B-default" } } });
    const result = resolveSelection(slotLayers("estimator", operator, { worker: { agent: "B", model: "B-m", contextWindow: 128000 } }), operator.perAgent);
    expect(result.partial).toEqual({ agent: "B", model: "B-m", contextWindow: 128000 });
    expect(result.provenance).toEqual({ agent: "group-primary", model: "group-primary", contextWindow: "group-primary" });
  });

  it("keeps a partial operator estimator override associated with its operator agent", () => {
    const operator = prefs({ defaultAgent: "A", perAgent: { A: { model: "A-default" } }, estimator: { model: "A-m" } });
    const result = resolveSelection(slotLayers("estimator", operator, { worker: { agent: "B", model: "B-m" } }), operator.perAgent);
    expect(result.partial).toEqual({ agent: "A", model: "A-m" });
    expect(result.provenance).toEqual({ agent: "operator", model: "operator-estimator", contextWindow: null });
  });

  it("applies a group model-only estimator override over the group primary agent", () => {
    const operator = prefs({ defaultAgent: "A" });
    const result = resolveSelection(slotLayers("estimator", operator, { worker: { agent: "B", model: "B-m" }, estimator: { model: "B-x" } }), operator.perAgent);
    expect(result.partial).toEqual({ agent: "B", model: "B-x" });
    expect(result.provenance).toEqual({ agent: "group-primary", model: "group-estimator", contextWindow: null });
  });

  it("uses the effective plan worker as the group primary and isolates an explicit estimator agent switch", () => {
    const operator = prefs({ defaultAgent: "A", perAgent: { C: { model: "C-m" } } });
    const primary = resolveSelection(slotLayers("estimator", operator, {}, undefined, { group: { agent: "B", model: "B-m" } }), operator.perAgent);
    expect(primary.partial).toEqual({ agent: "B", model: "B-m" });
    const switched = resolveSelection(slotLayers("estimator", operator, { worker: { agent: "B", model: "B-m" }, estimator: { agent: "C" } }), operator.perAgent);
    expect(switched.partial).toEqual({ agent: "C", model: "C-m" });
  });
  it("(a) a task that repeats the upper layer's agent keeps the model the upper layer set for that agent", () => {
    const result = resolveSelection([
      layer("operator", { agent: "claude" }),
      layer("group", { agent: "claude", model: "claude-group-model" }),
      layer("task", { agent: "claude" }),
    ], {});
    expect(result.partial).toEqual({ agent: "claude", model: "claude-group-model" });
    expect(result.provenance).toEqual({ agent: "task", model: "group", contextWindow: null });
  });

  it("switching agent drops the model another agent was given, falling back to that agent's own operator default", () => {
    // The spec's reason for eff(l_i) === A: operator default claude, task switched to codex must not resolve
    // to codex + claude-opus-5-5.
    const result = resolveSelection([
      layer("operator", { agent: "claude" }),
      layer("group", { agent: "claude", model: "claude-opus-5-5" }),
      layer("task", { agent: "codex" }),
    ], { codex: { model: "gpt-6-sol" } });
    expect(result.partial).toEqual({ agent: "codex", model: "gpt-6-sol" });
    expect(result.provenance).toEqual({ agent: "task", model: "operator-agent", contextWindow: null });
  });

  it("(b) the context window follows the same rule as the model", () => {
    const upper = [layer("operator", { agent: "claude" }), layer("group", { agent: "claude", contextWindow: 1_000_000 })];
    expect(resolveSelection([...upper, layer("task", { agent: "claude" })], {}).partial)
      .toEqual({ agent: "claude", contextWindow: 1_000_000 });
    const switched = resolveSelection([...upper, layer("task", { agent: "codex" })], { claude: { contextWindow: 1_000_000 } });
    expect(switched.partial).toEqual({ agent: "codex" });
    expect(switched.provenance).toEqual({ agent: "task", model: null, contextWindow: null });
  });

  it("(c) each slot has the spec's layer order, lowest priority first", () => {
    const operator = prefs({ defaultAgent: "claude", estimator: { model: "e" }, reconcile: { model: "r" } });
    const group = { worker: { model: "w" }, estimator: { model: "ge" }, reconcile: { model: "gr" } };
    // Rewritten for ruling review R7 (human ruling 2026-09-27): each group or task level is the plan's layer under the
    // panel's; with no plan layers given they are empty, and the order is otherwise the spec's.
    expect(slotLayers("worker", operator, group, { model: "t" })).toEqual([
      layer("operator", { agent: "claude" }), layer("group-plan", {}), layer("group", { model: "w" }), layer("task-plan", {}), layer("task", { model: "t" }),
    ]);
    expect(slotLayers("estimator", operator, group)).toEqual([
      layer("operator", { agent: "claude" }), layer("operator-estimator", { model: "e" }), layer("group-estimator", { model: "ge" }),
    ]);
    expect(slotLayers("reconcile", operator, group)).toEqual([
      layer("operator", { agent: "claude" }), layer("operator-reconcile", { model: "r" }), layer("group-plan", {}), layer("group", { model: "w" }),
      layer("group-reconcile-plan", {}), layer("group-reconcile", { model: "gr" }),
    ]);
    // An operator with no default agent contributes an empty layer, not an `agent: undefined` key.
    expect(slotLayers("worker", prefs(), {})[0]).toEqual(layer("operator", {}));
  });

  it("(d) a group-level value always beats an operator-level one, and any layer beats the per-agent default", () => {
    const operator = prefs({ defaultAgent: "claude", perAgent: { claude: { model: "per-agent" } }, estimator: { model: "operator-estimator" } });
    const estimator = resolveSelection(slotLayers("estimator", operator, { estimator: { model: "group-estimator" } }), operator.perAgent);
    expect(estimator.partial).toEqual({ agent: "claude", model: "group-estimator" });
    expect(estimator.provenance.model).toBe("group-estimator");
    const worker = resolveSelection(slotLayers("worker", operator, { worker: { model: "group-worker" } }), operator.perAgent);
    expect(worker.partial.model).toBe("group-worker");
    const defaulted = resolveSelection(slotLayers("worker", operator, {}), operator.perAgent);
    expect(defaulted.partial).toEqual({ agent: "claude", model: "per-agent" });
    expect(defaulted.provenance).toEqual({ agent: "operator", model: "operator-agent", contextWindow: null });
  });

  it("(e) no layer naming an agent is agent-unselected, even when models are given", () => {
    expect(() => resolveSelection([layer("operator", {}), layer("group", { model: "m" }), layer("task", {})], { claude: { model: "x" } }))
      .toThrow("agent-unselected");
  });

  it("reads per-agent defaults only as own keys, never through the prototype", () => {
    const perAgent = Object.create({ inherited: { model: "leaked" } }) as OperatorPreferences["perAgent"];
    expect(resolveSelection([layer("operator", { agent: "inherited" })], perAgent).partial).toEqual({ agent: "inherited" });
  });
});

describe("descriptorProvenance: what ccloop filled in is the descriptor's", () => {
  it("labels every field the partial left empty as descriptor and keeps the layer for the rest", () => {
    const { partial, provenance } = resolveSelection([layer("operator", { agent: "claude" }), layer("task", { contextWindow: 1_000_000 })], {});
    expect(descriptorProvenance(partial, { agent: "claude", model: "claude-opus-5-5", contextWindow: 1_000_000 }, provenance))
      .toEqual({ agent: "operator", model: "descriptor", contextWindow: "task" });
  });

  it("refuses an answer that did not echo a requested field verbatim (spec §4.6, M5)", () => {
    const { partial, provenance } = resolveSelection([layer("operator", { agent: "claude", model: "opus" })], {});
    expect(() => descriptorProvenance(partial, { agent: "claude", model: "claude-opus-5-5", contextWindow: "agent-default" }, provenance))
      .toThrow("agent-selection-invalid");
  });
});

describe("selectionsHash binds exactly what the operator saw (spec §6.4 step 3)", () => {
  const slot = (configHash: string, model = "m"): FrozenSlot => ({
    partial: { agent: "claude" }, provenance: { agent: "operator", model: "descriptor", contextWindow: "descriptor" },
    selection: { agent: "claude", model, contextWindow: "agent-default" }, configHash, timeoutMs: 1_800_000, killGraceMs: 5_000,
    capabilities: unavailableCapabilities,
  });

  it("is independent of key order and changes with any slot's partial, selection or configHash", () => {
    const base = selectionsHash({ "task:a": slot("a".repeat(64)), reconcile: slot("b".repeat(64)) });
    expect(selectionsHash({ reconcile: slot("b".repeat(64)), "task:a": slot("a".repeat(64)) })).toBe(base);
    expect(selectionsHash({ "task:a": slot("c".repeat(64)), reconcile: slot("b".repeat(64)) })).not.toBe(base);
    expect(selectionsHash({ "task:a": slot("a".repeat(64), "other"), reconcile: slot("b".repeat(64)) })).not.toBe(base);
    expect(selectionsHash({ "task:a": { ...slot("a".repeat(64)), partial: { agent: "claude", model: "m" } }, reconcile: slot("b".repeat(64)) })).not.toBe(base);
  });

  it("covers only partial, selection and configHash: provenance and limits are derived, not chosen", () => {
    const base = selectionsHash({ "task:a": slot("a".repeat(64)) });
    expect(selectionsHash({ "task:a": { ...slot("a".repeat(64)), provenance: { agent: "task", model: "task", contextWindow: "task" }, timeoutMs: 1, killGraceMs: 0 } })).toBe(base);
  });

  it("uses a new hash domain for new freezes while preserving the historical v1 hash", () => {
    const slots = { "task:a": slot("a".repeat(64)) };
    expect(selectionsHash(slots)).toBe("528669a1193ba50998a5e5a2fe5aff72cc0309b0235fef86c983a6c1c862528b");
    expect(selectionsHashV2(slots)).not.toBe(selectionsHash(slots));
  });
});
