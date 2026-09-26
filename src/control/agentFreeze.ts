import { readAgentPreferences } from "./agentPreferences.js";
import { descriptorProvenance, resolveSelection, selectionsHash, slotLayers, type AgentResolution, type FrozenSlot, type GroupAgentOverrides, type PartialSelection, type ProvenanceSource } from "./agentSelection.js";
import { canonicalBytes } from "./canonicalJson.js";
import { ControlError, nonDurableControlErrorClassifications } from "./errors.js";
import type { ExecutionPort } from "./executionPort.js";
import { readArchivedPlan, readBudgetProposal } from "./queries.js";
import type { ControlStore } from "./store.js";
import { frozenTaskAgentSchema, groupAgentOverridesSchema, partialSelectionSchema } from "./webProtocol.js";

/**
 * Agent selection spec §6.4 (W6-1/W6-2): the slots a confirmation freezes -- one worker slot per task, keyed
 * `task:<taskId>`, and the group's reconcile slot, keyed `reconcile`. The estimator is frozen at import and on each
 * re-estimate instead, so it is not one of them and not in the selectionsHash.
 */
export const RECONCILE_SLOT_KEY = "reconcile";
export const taskSlotKey = (taskId: string): string => `task:${taskId}`;

export interface SlotResolution {
  key: string;
  slot: "worker" | "reconcile";
  taskId: string | null;
  /**
   * `unavailable` (wave 3 ruling I-1): a transient failure to ask ccloop about this slot -- only a preview records it;
   * a confirm rethrows it so the command is retried rather than bound to a resolution it could not complete.
   */
  outcome: { kind: "resolved"; frozen: FrozenSlot } | { kind: "rejected"; code: string } | { kind: "unavailable"; code: string };
}
export interface GroupSelectionResolution {
  proposalVersion: number;
  groupOverrides: GroupAgentOverrides;
  taskOverrides: Record<string, PartialSelection | null>;
  /** Sorted by key. */
  slots: SlotResolution[];
  /** Null iff any slot was not resolved. */
  selectionsHash: string | null;
}

type Resolved = ReturnType<typeof resolveSelection>;
type SlotPartial = { key: string; slot: "worker" | "reconcile"; taskId: string | null } & ({ resolved: Resolved } | { code: "agent-unselected" });

function invalid(detail: string): never { throw new ControlError("recovery-blocked", detail); }

/**
 * A group record's own selection layers (spec §6.2). A stored value that is not a valid overrides document is the
 * store's damage, refused as recovery-blocked -- never as a malformed request (wave 3 M-1).
 */
export function readGroupAgentOverrides(group: unknown): GroupAgentOverrides {
  const overrides = groupAgentOverridesSchema.safeParse((group as { agentOverrides?: unknown }).agentOverrides ?? {});
  if (!overrides.success) invalid("agent-overrides-invalid");
  return overrides.data as GroupAgentOverrides;
}

/**
 * The synchronous half of spec §6.4 step 1: each slot's partial from the layers as stored now (W6-16: the
 * preferences of the operator who confirms). confirm runs it again inside its transaction to prove nothing moved.
 */
export function groupSelectionPartials(store: ControlStore, groupId: string, operatorId: string): {
  proposalVersion: number; groupOverrides: GroupAgentOverrides; taskOverrides: Record<string, PartialSelection | null>; slots: SlotPartial[];
} {
  const prefs = readAgentPreferences(store, operatorId).preferences;
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  if (!row) throw new ControlError("group-not-found");
  const groupOverrides = readGroupAgentOverrides(JSON.parse(String(row.body)));
  const plan = readArchivedPlan(store, groupId).plan;
  const proposalVersion = readBudgetProposal(store, groupId).proposalVersion;
  const attempt = (resolve: () => Resolved): { resolved: Resolved } | { code: "agent-unselected" } => {
    try { return { resolved: resolve() }; }
    catch (error) {
      if (error instanceof ControlError && error.code === "agent-unselected") return { code: "agent-unselected" };
      throw error;
    }
  };
  const taskOverrides: Record<string, PartialSelection | null> = {};
  const slots: SlotPartial[] = [];
  for (const task of plan.tasks) {
    const workRow = store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id=?").get(groupId, task.taskId);
    if (!workRow) invalid(`work-item-missing:${task.taskId}`);
    const stored = (JSON.parse(String(workRow.body)) as { agentOverride?: unknown }).agentOverride ?? null;
    const override = stored === null ? null : partialSelectionSchema.safeParse(stored);
    if (override !== null && !override.success) invalid(`agent-override-invalid:${task.taskId}`);
    const partial = override === null ? null : override.data as PartialSelection;
    taskOverrides[task.taskId] = partial;
    slots.push({ key: taskSlotKey(task.taskId), slot: "worker", taskId: task.taskId,
      ...attempt(() => resolveSelection(slotLayers("worker", prefs, groupOverrides, partial ?? undefined), prefs.perAgent)) });
  }
  slots.push({ key: RECONCILE_SLOT_KEY, slot: "reconcile", taskId: null, ...attempt(() => resolveSelection(slotLayers("reconcile", prefs, groupOverrides), prefs.perAgent)) });
  slots.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
  return { proposalVersion, groupOverrides, taskOverrides, slots };
}

/**
 * Spec §6.4 steps 1-3 (W6-1): resolve every slot through ccloop, once per distinct partial. A named refusal is the
 * slot's outcome (W6-11). A transient port failure is thrown in `confirm` mode, so the confirm is retried rather than
 * frozen as a rejection; in `preview` mode (wave 3 ruling I-1) it is that slot's `unavailable` outcome, so the panel
 * can mark the one slot it could not resolve -- the hash is then null, so nothing can be confirmed from it.
 */
export async function resolveGroupSelections(
  deps: { store: ControlStore; port: Pick<ExecutionPort, "resolveAgent"> },
  groupId: string,
  operatorId: string,
  mode: "preview" | "confirm" = "confirm",
): Promise<GroupSelectionResolution> {
  const base = groupSelectionPartials(deps.store, groupId, operatorId);
  const answers = new Map<string, Promise<AgentResolution>>();
  const slots: SlotResolution[] = [];
  for (const entry of base.slots) {
    const identity = { key: entry.key, slot: entry.slot, taskId: entry.taskId };
    if ("code" in entry) { slots.push({ ...identity, outcome: { kind: "rejected", code: entry.code } }); continue; }
    const { partial, provenance } = entry.resolved;
    const id = canonicalBytes(partial).toString("utf8");
    if (!answers.has(id)) answers.set(id, deps.port.resolveAgent(partial));
    try {
      const resolution = structuredClone(await answers.get(id)!);
      const frozen: FrozenSlot = { ...resolution, partial, provenance: descriptorProvenance(partial, resolution.selection, provenance) };
      slots.push({ ...identity, outcome: { kind: "resolved", frozen } });
    } catch (error) {
      if (!(error instanceof ControlError)) throw error;
      // Assembly spec §3 / ruling R5 (as service.ts profiledCapabilities): "there is no port" is not a refusal of this
      // selection, so it is raised by its own name rather than recorded against the slot.
      if (error.code === "control-port-unconfigured") throw error;
      if ((nonDurableControlErrorClassifications as Record<string, string>)[error.code] === "transient") {
        if (mode === "confirm") throw error;
        slots.push({ ...identity, outcome: { kind: "unavailable", code: error.code } });
        continue;
      }
      slots.push({ ...identity, outcome: { kind: "rejected", code: error.code } });
    }
  }
  const frozen: Record<string, FrozenSlot> = {};
  for (const slot of slots) if (slot.outcome.kind === "resolved") frozen[slot.key] = slot.outcome.frozen;
  return {
    proposalVersion: base.proposalVersion, groupOverrides: base.groupOverrides, taskOverrides: base.taskOverrides, slots,
    selectionsHash: Object.keys(frozen).length === slots.length ? selectionsHash(frozen) : null,
  };
}

type AnsweredLayers = { partial: PartialSelection; provenance: Record<"agent" | "model" | "contextWindow", ProvenanceSource> } | string;

/**
 * Per slot key, the partial it was resolved from and where each field came from (or its refusal): a resolution
 * compared with the layers as they are now. The provenance is compared too, because it is frozen with the slot and a
 * layer change can move a field's source while leaving the partial -- and so the selectionsHash -- unchanged.
 */
export function answeredPartials(resolution: GroupSelectionResolution): Array<[string, AnsweredLayers]> {
  return resolution.slots.map((slot) => [slot.key, slot.outcome.kind === "resolved"
    ? { partial: slot.outcome.frozen.partial, provenance: slot.outcome.frozen.provenance } : slot.outcome.code]);
}
export function currentPartials(store: ControlStore, groupId: string, operatorId: string): Array<[string, AnsweredLayers]> {
  return groupSelectionPartials(store, groupId, operatorId).slots.map((slot) => {
    if ("code" in slot) return [slot.key, slot.code];
    // What descriptorProvenance freezes: a field no layer chose is the descriptor's.
    const { agent, model, contextWindow } = slot.resolved.provenance;
    return [slot.key, { partial: slot.resolved.partial, provenance: { agent: agent ?? "descriptor", model: model ?? "descriptor", contextWindow: contextWindow ?? "descriptor" } }];
  });
}

const frozenWorkAgentSchema = frozenTaskAgentSchema.omit({ taskId: true });
export type FrozenWorkAgent = ReturnType<typeof frozenWorkAgentSchema.parse>;

/** The six frozen fields of a work item or run (spec §6.4 step 4); anything else about the record is ignored. */
export function frozenWorkAgent(record: unknown): FrozenWorkAgent {
  const source = (record ?? {}) as Record<string, unknown>;
  const parsed = frozenWorkAgentSchema.safeParse({
    agent: source.agent, agentProvenance: source.agentProvenance, configHash: source.configHash,
    timeoutMs: source.timeoutMs, killGraceMs: source.killGraceMs, agentCapabilities: source.agentCapabilities,
  });
  if (!parsed.success) invalid("frozen-agent-invalid");
  return parsed.data;
}
