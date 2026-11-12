/**
 * #246 (human: 「#246 => 同意」): requirement-open with no agent named, when no layer names one, picks the one installed
 * agent (src/control/agentSelection.ts soleInstalledAgent, then the same estimator resolution with it as the pick). The
 * New requirement form's "your default" line (web/src/requirementAgent.ts) must show what the server will run -- the
 * same agent and model -- or it promises one call and runs another (#220). This holds the mirror to the server's code over
 * every combination of preferences, pick and installed list.
 */
import { describe, expect, it } from "vitest";
import { resolveSelection, slotLayers, soleInstalledAgent } from "../../src/control/agentSelection.js";
import type { OperatorPreferences } from "../../src/control/agentSelection.js";
import { ControlError } from "../../src/control/errors.js";
import { requirementSelection } from "../../web/src/requirementAgent.js";

/** The server's requirement-open resolution: the person's pick, else the sole installed agent, as the estimator layer. */
function server(prefs: OperatorPreferences, chosen: string | undefined, installed: readonly string[]): { agent: string; model: string | null } | null {
  const pick = chosen ?? soleInstalledAgent(prefs, installed);
  try {
    const { partial } = resolveSelection(slotLayers("estimator", prefs, pick === undefined ? {} : { estimator: { agent: pick } }), prefs.perAgent);
    return { agent: partial.agent!, model: partial.model ?? null };
  } catch (error) {
    if (error instanceof ControlError && error.code === "agent-unselected") return null;
    throw error;
  }
}

const defaults: Array<string | undefined> = [undefined, "a"];
const perAgents: Array<OperatorPreferences["perAgent"]> = [{}, { a: { model: "ma" } }, { b: { model: "mb" } }];
const estimators: Array<OperatorPreferences["estimator"]> = [undefined, { agent: "b" }, { model: "x" }];
const picks: Array<string | undefined> = [undefined, "a", "b"];
const installs: string[][] = [[], ["a"], ["b"], ["a", "b"]];

describe("the requirement agent mirror picks the sole installed agent as the server does (#246)", () => {
  it("resolves the same agent and model as the server for every combination", () => {
    let compared = 0;
    for (const defaultAgent of defaults) for (const perAgent of perAgents) for (const estimator of estimators) for (const chosen of picks) for (const installed of installs) {
      const prefs: OperatorPreferences = { ...(defaultAgent === undefined ? {} : { defaultAgent }), perAgent, ...(estimator === undefined ? {} : { estimator }) };
      expect(requirementSelection(prefs, chosen, installed), JSON.stringify({ prefs, chosen, installed })).toEqual(server(prefs, chosen, installed));
      compared += 1;
    }
    expect(compared).toBe(defaults.length * perAgents.length * estimators.length * picks.length * installs.length);
  });

  it("picks the one installed agent, with the operator's model for it, only when nothing names one", () => {
    expect(requirementSelection({ perAgent: { b: { model: "mb" } } }, undefined, ["b"])).toEqual({ agent: "b", model: "mb" });
    expect(requirementSelection({ perAgent: {} }, undefined, ["a", "b"])).toBeNull();
    expect(requirementSelection({ perAgent: {} }, undefined, [])).toBeNull();
    expect(requirementSelection({ defaultAgent: "a", perAgent: {} }, undefined, ["b"])).toEqual({ agent: "a", model: null });
  });
});
