import { sha256Canonical } from "./canonicalJson.js";
import { ControlError } from "./errors.js";
import type { CapabilityViewV1 } from "./webProtocol.js";

/**
 * Agent selection spec §6.3. Pure layered resolution: which agent, and which model and context window the
 * layers chose for THAT agent. It never fills descriptor defaults (spec §3 I3: materialisation lives only in
 * ccloop); a field no layer chose is left out and ccloop fills it, which `descriptorProvenance` then labels.
 */
export type ContextWindow = "agent-default" | number;
export interface AgentSelection { agent: string; model: string; contextWindow: ContextWindow }
export interface PartialSelection { agent?: string; model?: string; contextWindow?: ContextWindow }
/** Ruling review R7: a panel layer; null masks the same field of the plan layer at the same level. */
export interface PanelPartialSelection { agent?: string | null; model?: string | null; contextWindow?: ContextWindow | null }
export type LayerName =
  | "operator" | "operator-estimator" | "operator-reconcile"
  | "group-plan" | "group" | "group-estimator" | "group-reconcile-plan" | "group-reconcile" | "task-plan" | "task";
export type ProvenanceSource = LayerName | "operator-agent" | "descriptor";
export interface SelectionLayer { name: LayerName; partial: PartialSelection }
export interface OperatorPreferences {
  defaultAgent?: string;
  perAgent: Record<string, { model?: string; contextWindow?: ContextWindow }>;
  estimator?: PartialSelection;
  reconcile?: PartialSelection;
}
/** The panel's own layers of a group (ruling review R7: the plan's layers are no longer copied in). */
export interface GroupAgentOverrides { worker?: PanelPartialSelection; estimator?: PanelPartialSelection; reconcile?: PanelPartialSelection }
/** The plan file's layers of a group and of one task (spec §6.2 layers 2 and 3, plan half). */
export interface PlanAgentLayers { group?: PartialSelection; reconcile?: PartialSelection; task?: PartialSelection }
export type Slot = "worker" | "estimator" | "reconcile";
type Field = "agent" | "model" | "contextWindow";
type Provenance = Record<Field, ProvenanceSource | null>;

export interface AgentResolution { selection: AgentSelection; configHash: string; timeoutMs: number; killGraceMs: number; capabilities: CapabilityViewV1 }
export interface FrozenSlot extends AgentResolution { partial: PartialSelection; provenance: Record<Field, ProvenanceSource> }

/** A panel layer without its nulls: what it itself chooses. */
function panelChoices(panel: PanelPartialSelection | undefined): PartialSelection {
  const out: PartialSelection = {};
  if (typeof panel?.agent === "string") out.agent = panel.agent;
  if (typeof panel?.model === "string") out.model = panel.model;
  if (panel?.contextWindow !== undefined && panel.contextWindow !== null) out.contextWindow = panel.contextWindow;
  return out;
}

/**
 * Ruling review R7 (human ruling 2026-09-27, overturning spec §13.1 D2): one level (group, group reconcile, task) is
 * two layers, the plan's below the panel's, merged per field by resolveSelection like any other pair of layers. A
 * panel field that is null means "as if the plan had not written this field at this level": the plan layer loses it
 * and the value is inherited from below as usual. A null agent drops the plan's whole layer, since its model and
 * context were chosen for the agent being masked.
 */
export function levelLayers(planName: LayerName, panelName: LayerName, plan: PartialSelection | undefined, panel: PanelPartialSelection | undefined): SelectionLayer[] {
  const fromPlan: PartialSelection = panel?.agent === null ? {} : { ...(plan ?? {}) };
  for (const field of ["model", "contextWindow"] as const) if (panel?.[field] === null) delete fromPlan[field];
  return [{ name: planName, partial: fromPlan }, { name: panelName, partial: panelChoices(panel) }];
}

/** Spec §6.3 layer order per slot, lowest priority first (R7: each group or task level is plan, then panel). */
export function slotLayers(slot: Slot, prefs: OperatorPreferences, group: GroupAgentOverrides, task?: PanelPartialSelection, plan: PlanAgentLayers = {}): SelectionLayer[] {
  const operator: SelectionLayer = { name: "operator", partial: prefs.defaultAgent === undefined ? {} : { agent: prefs.defaultAgent } };
  if (slot === "worker") return [operator, ...levelLayers("group-plan", "group", plan.group, group.worker), ...levelLayers("task-plan", "task", plan.task, task)];
  if (slot === "estimator") {
    // Ruling R8 keeps D1: the plan has no estimator layer; a null in the panel's is simply no choice.
    return [operator, { name: "operator-estimator", partial: prefs.estimator ?? {} }, { name: "group-estimator", partial: panelChoices(group.estimator) }];
  }
  return [
    operator, { name: "operator-reconcile", partial: prefs.reconcile ?? {} },
    ...levelLayers("group-plan", "group", plan.group, group.worker), ...levelLayers("group-reconcile-plan", "group-reconcile", plan.reconcile, group.reconcile),
  ];
}

/**
 * eff(l_i) = l_i.agent ?? eff(l_{i-1}); A = eff(l_n) (undefined ⇒ agent-unselected); for model and
 * contextWindow, the highest-priority layer whose effective agent is A and that gives the field, else
 * perAgent[A], else left for ccloop. Switching agent therefore drops what was chosen for another agent.
 */
export function resolveSelection(layers: SelectionLayer[], perAgent: OperatorPreferences["perAgent"]): { partial: PartialSelection; provenance: Provenance } {
  const effective: Array<string | undefined> = [];
  let running: string | undefined;
  let agentSource: LayerName | null = null;
  for (const layer of layers) {
    if (layer.partial.agent !== undefined) { running = layer.partial.agent; agentSource = layer.name; }
    effective.push(running);
  }
  if (running === undefined) throw new ControlError("agent-unselected");
  const agent = running;
  const partial: PartialSelection = { agent };
  const provenance: Provenance = { agent: agentSource, model: null, contextWindow: null };
  const own = Object.hasOwn(perAgent, agent) ? perAgent[agent] : undefined;
  for (const field of ["model", "contextWindow"] as const) {
    let value: string | ContextWindow | undefined;
    for (let index = layers.length - 1; index >= 0; index -= 1) {
      const candidate = layers[index]!.partial[field];
      if (effective[index] === agent && candidate !== undefined) { value = candidate; provenance[field] = layers[index]!.name; break; }
    }
    if (value === undefined && own?.[field] !== undefined) { value = own[field]; provenance[field] = "operator-agent"; }
    if (value === undefined) continue;
    if (field === "model") partial.model = value as string;
    else partial.contextWindow = value as ContextWindow;
  }
  return { partial, provenance };
}

/**
 * Spec §6.3 / §4.6 (M5): ccloop echoes every requested field verbatim, so a field the partial left out and
 * the answer filled is the descriptor's. A requested field answered differently is refused, not relabelled.
 */
export function descriptorProvenance(partial: PartialSelection, resolved: AgentSelection, provenance: Provenance): Record<Field, ProvenanceSource> {
  const labelled = {} as Record<Field, ProvenanceSource>;
  for (const field of ["agent", "model", "contextWindow"] as const) {
    const requested = partial[field];
    if (requested === undefined) { labelled[field] = "descriptor"; continue; }
    if (requested !== resolved[field]) throw new ControlError("agent-selection-invalid", `echo:${field}`);
    const source = provenance[field];
    if (source === null) throw new ControlError("agent-selection-invalid", `provenance:${field}`);
    labelled[field] = source;
  }
  return labelled;
}

/** Spec §6.4 step 3: per slot key, the canonical hash of exactly {partial, selection, configHash}. */
export function selectionsHash(slots: Record<string, FrozenSlot>): string {
  const bound: Record<string, { partial: PartialSelection; selection: AgentSelection; configHash: string }> = {};
  for (const key of Object.keys(slots)) {
    const slot = slots[key]!;
    bound[key] = { partial: slot.partial, selection: slot.selection, configHash: slot.configHash };
  }
  return sha256Canonical(bound);
}
