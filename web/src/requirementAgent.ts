/**
 * Issue #220: the agent and model a requirement call will use, shown on the form before it is sent. This mirrors the
 * server exactly: requirement-open and requirement-set-agent resolve the estimator slot with the person's pick as the
 * group's estimator layer and no plan (src/control/requirementCommands.ts -> estimatorSlotFor in planImport.ts), through
 * slotLayers("estimator") and resolveSelection in src/control/agentSelection.ts. tests/panel/requirementAgentParity.test.ts
 * holds it to that code.
 *
 * The rule, lowest layer first: the operator's default agent; then either the operator's estimator role (when it sets any
 * field) or the operator's own worker default; then the person's pick. The agent is the last layer that names one. The
 * model is the highest layer's whose effective agent is that agent, else the operator's per-agent model for it, else null:
 * left for ccloop, i.e. the installation's own default.
 */
import type { OperatorPreferencesV1 } from "./controlTypes.js";

type Layer = { agent?: string; model?: string };
export type RequirementSelection = { agent: string; model: string | null };

function resolve(layers: readonly Layer[], perAgent: OperatorPreferencesV1["perAgent"]): RequirementSelection | null {
  const effective: Array<string | undefined> = [];
  let running: string | undefined;
  for (const layer of layers) {
    if (layer.agent !== undefined) running = layer.agent;
    effective.push(running);
  }
  if (running === undefined) return null;
  const agent = running;
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const model = layers[index]!.model;
    if (effective[index] === agent && model !== undefined) return { agent, model };
  }
  const own = Object.hasOwn(perAgent, agent) ? perAgent[agent] : undefined;
  return { agent, model: own?.model ?? null };
}

/**
 * `chosen` is the agent picked on the form (undefined: "your default"); null when no layer names an agent. `installed`: the
 * installation ids, when read -- #246: with no pick and no layer naming an agent, exactly one installed agent is the one
 * requirement-open picks (src/control/agentSelection.ts soleInstalledAgent); none or several, or not read, picks nothing.
 */
export function requirementSelection(prefs: OperatorPreferencesV1, chosen: string | undefined, installed?: readonly string[]): RequirementSelection | null {
  const resolved = layeredSelection(prefs, chosen);
  return resolved === null && chosen === undefined && installed?.length === 1 ? layeredSelection(prefs, installed[0]) : resolved;
}

function layeredSelection(prefs: OperatorPreferencesV1, chosen: string | undefined): RequirementSelection | null {
  const operator: Layer = prefs.defaultAgent === undefined ? {} : { agent: prefs.defaultAgent };
  const role = prefs.estimator ?? {};
  const roleConcrete = Object.values(role).some((value) => value !== undefined);
  const primary = resolve([operator], prefs.perAgent);
  const middle: Layer = roleConcrete
    ? { ...(role.agent === undefined ? {} : { agent: role.agent }), ...(role.model === undefined ? {} : { model: role.model }) }
    : primary === null ? {} : { agent: primary.agent, ...(primary.model === null ? {} : { model: primary.model }) };
  return resolve([operator, middle, chosen === undefined ? {} : { agent: chosen }], prefs.perAgent);
}
