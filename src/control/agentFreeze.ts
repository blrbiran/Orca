import { readAgentPreferences } from "./agentPreferences.js";
import { descriptorProvenance, resolveSelection, selectionsHash, slotLayers, type AgentResolution, type FrozenSlot, type GroupAgentOverrides, type PartialSelection } from "./agentSelection.js";
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
  outcome: { kind: "resolved"; frozen: FrozenSlot } | { kind: "rejected"; code: string };
}
export interface GroupSelectionResolution {
  proposalVersion: number;
  groupOverrides: GroupAgentOverrides;
  taskOverrides: Record<string, PartialSelection | null>;
  /** Sorted by key. */
  slots: SlotResolution[];
  /** Null iff any slot was rejected. */
  selectionsHash: string | null;
}

type Resolved = ReturnType<typeof resolveSelection>;
type SlotPartial = { key: string; slot: "worker" | "reconcile"; taskId: string | null } & ({ resolved: Resolved } | { code: "agent-unselected" });

function invalid(detail: string): never { throw new ControlError("recovery-blocked", detail); }

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
  const overrides = groupAgentOverridesSchema.safeParse((JSON.parse(String(row.body)) as { agentOverrides?: unknown }).agentOverrides ?? {});
  if (!overrides.success) invalid("agent-overrides-invalid");
  const groupOverrides = overrides.data as GroupAgentOverrides;
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
 * slot's outcome (W6-11); a transient port failure is thrown, so it is retried rather than frozen as a rejection.
 */
export async function resolveGroupSelections(
  deps: { store: ControlStore; port: Pick<ExecutionPort, "resolveAgent"> },
  groupId: string,
  operatorId: string,
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
      if ((nonDurableControlErrorClassifications as Record<string, string>)[error.code] === "transient") throw error;
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

/** Per slot key, the partial it was resolved from (or its refusal): a resolution compared with the layers as they are now. */
export function answeredPartials(resolution: GroupSelectionResolution): Array<[string, PartialSelection | string]> {
  return resolution.slots.map((slot) => [slot.key, slot.outcome.kind === "resolved" ? slot.outcome.frozen.partial : slot.outcome.code]);
}
export function currentPartials(store: ControlStore, groupId: string, operatorId: string): Array<[string, PartialSelection | string]> {
  return groupSelectionPartials(store, groupId, operatorId).slots.map((slot) => [slot.key, "code" in slot ? slot.code : slot.resolved.partial]);
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
