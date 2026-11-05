/**
 * Quota failover spec 2026-11-03 §3 and §8 (human rulings, session e2ad4802): a confirmed task's agent installation may be
 * switched between runs -- by a person retrying a failed task on another installation, or by orca-auto when the run ended
 * with ccloop's `quota` cause. Agent selection spec §3 I1 says a run carries its work item's frozen selection byte for
 * byte; after a switch, the runs claimed before it carry the selection that was frozen then. Each switch is kept on the
 * work item (`agentSwitches`, append-only): the run that was current when it happened and the selection it replaced.
 * The confirmed execution snapshot, the authority for the frozen selection, is re-issued with only that task's entry
 * replaced (as setTaskLoop re-issues it for a changed contract); older snapshots are kept.
 */
import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { frozenWorkAgent, type FrozenWorkAgent } from "./agentFreeze.js";
import { ControlError } from "./errors.js";
import { readBudgetProposal, readWork, saveWork } from "./queries.js";
import { readWebGroup, saveWebAuthority } from "./estimateSettlement.js";
import { executionSnapshotSchema } from "./webProtocol.js";
import { readCanonicalRecord, writeCanonicalRecord } from "./snapshot.js";
import { intersectCapabilities } from "./profiles.js";
import type { ExecutionPort } from "./executionPort.js";
import type { ControlStore } from "./store.js";

/** Who chose the new installation: a person's retry on another agent, or orca-auto's quota failover. */
export type SwitchSource = "task" | "failover";
export interface AgentSwitchRecord { afterRunId: string; previous: FrozenWorkAgent; by: string; at: number; reason: "person" | "quota" }

/** The work item's switch history; anything malformed is treated as no history (the comparisons then stay strict). */
export function agentSwitchesOf(work: unknown): AgentSwitchRecord[] {
  const list = (work as { agentSwitches?: unknown } | null)?.agentSwitches;
  return Array.isArray(list) ? list as AgentSwitchRecord[] : [];
}

/**
 * I1 with switches: the selection `run` must carry. Runs are ordered by the work item's lineage; a run at or before a
 * switch's `afterRunId` carries that switch's `previous` (the first such switch), a later run the current selection.
 */
export function runAgentAgrees(work: unknown, run: unknown): boolean {
  try {
    const runId = (run as { runId?: unknown }).runId;
    const lineage = (work as { lineageRunIds?: unknown }).lineageRunIds;
    let expected: FrozenWorkAgent = frozenWorkAgent(work);
    const switches = agentSwitchesOf(work);
    if (switches.length > 0 && typeof runId === "string" && Array.isArray(lineage)) {
      const at = lineage.indexOf(runId);
      const owner = switches.find((entry) => { const index = lineage.indexOf(entry.afterRunId); return at >= 0 && index >= 0 && at <= index; });
      if (owner !== undefined) expected = owner.previous;
    }
    return canonicalBytes(frozenWorkAgent(run)).equals(canonicalBytes(expected));
  } catch { return false; }
}

/**
 * Before the transaction (ccloop is asked asynchronously): the six frozen fields the task would carry on `installation`,
 * frozen as confirm freezes a task -- ccloop's resolution of the installation alone (model and window are its
 * defaults), capabilities intersected with the confirmed worker profile's declaration.
 */
export async function resolveAgentSwitch(
  deps: { store: ControlStore; port: Pick<ExecutionPort, "resolveAgent">; profileRouter: { resolve(kind: "task", id: string, hash: string): { snapshot: { profile: { capabilities: Parameters<typeof intersectCapabilities>[0] } } } } },
  groupId: string, installation: string, source: SwitchSource,
): Promise<FrozenWorkAgent> {
  const proposal = readBudgetProposal(deps.store, groupId);
  if (proposal.state !== "confirmed" || !proposal.executionSnapshotHash) throw new ControlError("group-state-invalid");
  const snapshot = executionSnapshotSchema.parse(JSON.parse(readCanonicalRecord(deps.store, proposal.executionSnapshotHash)));
  const worker = deps.profileRouter.resolve("task", snapshot.profiles.worker.profileId, snapshot.profiles.worker.profileHash).snapshot.profile.capabilities;
  const resolution = await deps.port.resolveAgent({ agent: installation });
  if (resolution.selection.agent !== installation) throw new ControlError("control-response-invalid", "agent-switch-resolution");
  return {
    agent: resolution.selection, agentProvenance: { agent: source, model: "descriptor", contextWindow: "descriptor" },
    configHash: resolution.configHash, timeoutMs: resolution.timeoutMs, killGraceMs: resolution.killGraceMs,
    agentCapabilities: intersectCapabilities(worker, resolution.capabilities),
  } as FrozenWorkAgent;
}

/**
 * Inside the retry's transaction, after its identity checks: the task's work item takes `next`, its switch is recorded,
 * and the confirmed snapshot is re-issued with only this task's agent entry replaced. A task with skills is refused
 * (its skill set was checked against the frozen agent's kind at confirm); so is a switch to the installation it is on.
 */
export function applyAgentSwitch(store: ControlStore, groupId: string, taskId: string, runId: string, next: FrozenWorkAgent, by: string, reason: AgentSwitchRecord["reason"]): { from: string; to: string } {
  const work = readWork(store, groupId, taskId) as unknown as Record<string, unknown>;
  const previous = frozenWorkAgent(work);
  if (previous.agent.agent === next.agent.agent) throw new ControlError("task-not-retryable", "agent-unchanged");
  const group = readWebGroup(store, groupId), proposal = readBudgetProposal(store, groupId);
  if (proposal.state !== "confirmed" || !proposal.executionSnapshotHash) throw new ControlError("group-state-invalid");
  const snapshot = executionSnapshotSchema.parse(JSON.parse(readCanonicalRecord(store, proposal.executionSnapshotHash)));
  if (snapshot.skills?.some((entry) => entry.taskId === taskId)) throw new ControlError("task-not-retryable", "agent-switch-skills");
  const entry = snapshot.agents.tasks.find((row) => row.taskId === taskId);
  if (!entry) throw new ControlError("recovery-blocked");
  const { taskId: _taskId, ...frozenEntry } = entry;
  if (sha256Canonical(frozenEntry) !== sha256Canonical(previous)) throw new ControlError("recovery-blocked");
  const rebuilt = structuredClone(snapshot);
  rebuilt.agents.tasks = rebuilt.agents.tasks.map((row) => row.taskId === taskId ? { taskId, ...next } : row);
  const parsed = executionSnapshotSchema.parse(rebuilt);
  const canonicalJson = canonicalBytes(parsed).toString("utf8"), hash = sha256Canonical(parsed);
  writeCanonicalRecord(store, groupId, hash, canonicalJson);
  proposal.executionSnapshotHash = hash;
  saveWebAuthority(store, group, proposal);
  const record: AgentSwitchRecord = { afterRunId: runId, previous, by, at: store.now(), reason };
  Object.assign(work, next, { agentSwitches: [...agentSwitchesOf(work), record] });
  saveWork(store, groupId, work as never);
  return { from: previous.agent.agent, to: next.agent.agent };
}
