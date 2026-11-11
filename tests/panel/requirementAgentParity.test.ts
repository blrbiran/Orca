/**
 * Issue #220: the New requirement form shows the agent and model a requirement call will use before it is sent. The
 * browser cannot ask the server, so web/src/requirementAgent.ts mirrors the server's resolution. This holds the mirror to
 * the server's own code over every combination of the inputs that decide it: requirement-open and requirement-set-agent
 * resolve the estimator slot with the person's pick as the group's estimator layer and no plan
 * (src/control/requirementCommands.ts -> estimatorSlotFor, src/control/planImport.ts).
 *
 * A mirror that drifts (e.g. reads defaults before perAgent, or keeps a model chosen for another agent) shows one model
 * and runs another: the false promise #220 is about.
 */
import { describe, expect, it } from "vitest";
import { resolveSelection, slotLayers } from "../../src/control/agentSelection.js";
import type { OperatorPreferences, PartialSelection } from "../../src/control/agentSelection.js";
import { ControlError } from "../../src/control/errors.js";
import { requirementSelection } from "../../web/src/requirementAgent.js";

function server(prefs: OperatorPreferences, chosen: PartialSelection | undefined): { agent: string; model: string | null } | null {
  try {
    const { partial } = resolveSelection(slotLayers("estimator", prefs, chosen === undefined ? {} : { estimator: chosen }), prefs.perAgent);
    return { agent: partial.agent!, model: partial.model ?? null };
  } catch (error) {
    if (error instanceof ControlError && error.code === "agent-unselected") return null;
    throw error;
  }
}

const defaults: Array<string | undefined> = [undefined, "a"];
const perAgents: Array<OperatorPreferences["perAgent"]> = [
  {}, { a: { model: "ma" } }, { b: { model: "mb" } }, { a: { model: "ma" }, b: { model: "mb" }, c: { contextWindow: 1000 } }, { a: { contextWindow: 2000 } },
];
const estimators: Array<PartialSelection | undefined> = [
  undefined, {}, { agent: "a" }, { agent: "b" }, { model: "x" }, { agent: "b", model: "x" }, { contextWindow: 1000 }, { agent: "a", model: "x" },
];
const picks: Array<PartialSelection | undefined> = [undefined, { agent: "a" }, { agent: "b" }, { agent: "c" }];

describe("the requirement agent mirror matches the server (#220)", () => {
  it("resolves the same agent and model as the server for every combination", () => {
    let compared = 0;
    for (const defaultAgent of defaults) for (const perAgent of perAgents) for (const estimator of estimators) for (const chosen of picks) {
      const prefs: OperatorPreferences = { ...(defaultAgent === undefined ? {} : { defaultAgent }), perAgent, ...(estimator === undefined ? {} : { estimator }) };
      expect(requirementSelection(prefs, chosen?.agent), JSON.stringify({ prefs, chosen })).toEqual(server(prefs, chosen));
      compared += 1;
    }
    expect(compared).toBe(defaults.length * perAgents.length * estimators.length * picks.length);
  });

  // The cases the form's words depend on, named so a red says which rule broke.
  it("takes the operator's per-agent model before the installation's default, and only for that agent", () => {
    expect(requirementSelection({ defaultAgent: "a", perAgent: { a: { model: "ma" } } }, undefined)).toEqual({ agent: "a", model: "ma" });
    expect(requirementSelection({ defaultAgent: "a", perAgent: { a: { model: "ma" } } }, "b")).toEqual({ agent: "b", model: null });
    expect(requirementSelection({ perAgent: {} }, undefined)).toBeNull();
  });
});
