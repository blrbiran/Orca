/**
 * Flow engine spec §5.1, §5.2, §6.2 (plan Task 10): what the control plane needs to know about a flow group. A group
 * whose body carries a `flow` block is a flow run's parent or one of its hidden `work` children. On a `dir` workspace:
 *
 * - the target repository is the run's vault, never the person's folder (repository resolution maps the vault's
 *   repository id `flow-vault:<vaultId>` to `$ORCA_VAULT_DIR/<vaultId>.git`);
 * - a child's work branch starts at its composition (`flow.baseCommit`, §5.3);
 * - delivery is `keep`, fixed by code: no integration pass, `set-group-integration` refused `flow-group-delivery-fixed`;
 * - a landing writes the run's decisions to `flow_decisions`, never a `.decisions/` file (§6.2).
 *
 * Children are hidden from the summary and the kanban, and hold no running-group slot (the parent does).
 */
import { join } from "node:path";
import type { ControlStore } from "../control/store.js";
import { vaultDir } from "./vault/paths.js";

export interface FlowGroupBlock {
  role: "parent" | "child";
  flowRunId: string;
  parentGroupId?: string;
  stepKey?: string;
  seq?: number;
  baseCommit?: string;
  effectRecordId?: string | null;
}

export const FLOW_VAULT_REPO_PREFIX = "flow-vault:";
export const FLOW_GROUP_DELIVERY_FIXED = "flow-group-delivery-fixed";

export function flowBlockOf(body: unknown): FlowGroupBlock | null {
  const flow = (body as { flow?: unknown } | null)?.flow;
  if (typeof flow !== "object" || flow === null) return null;
  const block = flow as Partial<FlowGroupBlock>;
  return (block.role === "parent" || block.role === "child") && typeof block.flowRunId === "string" ? block as FlowGroupBlock : null;
}

function groupBodyOf(store: ControlStore, groupId: string): unknown {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  if (row === undefined) return null;
  try { return JSON.parse(String(row.body)); } catch { return null; }
}

/** The flow block of a group and its run's workspace; null for a group that is not a flow group. */
export function flowGroupOf(store: ControlStore, groupId: string): (FlowGroupBlock & { workspaceKind: string; vaultId: string | null }) | null {
  const block = flowBlockOf(groupBodyOf(store, groupId));
  if (block === null) return null;
  const run = store.db.prepare("SELECT workspace, vault_id FROM flow_runs WHERE id=?").get(block.flowRunId);
  if (run === undefined) return null;
  const workspace = JSON.parse(String(run.workspace)) as { kind?: unknown };
  return { ...block, workspaceKind: String(workspace.kind), vaultId: run.vault_id === null ? null : String(run.vault_id) };
}

/** §5.1: every flow group, parent and child, on a `dir` workspace. */
export function isDirFlowGroup(store: ControlStore, groupId: string): boolean {
  return flowGroupOf(store, groupId)?.workspaceKind === "dir";
}

export const flowVaultRepoId = (vaultId: string): string => `${FLOW_VAULT_REPO_PREFIX}${vaultId}`;

/** §5.2: the vault's repository id resolves to the vault; any other id is not this resolver's (null). */
export function vaultPathOfRepoId(env: NodeJS.ProcessEnv, repoId: string): string | null {
  if (!repoId.startsWith(FLOW_VAULT_REPO_PREFIX)) return null;
  const vaultId = repoId.slice(FLOW_VAULT_REPO_PREFIX.length);
  if (!/^[0-9a-f]{64}$/.test(vaultId)) return null;
  return join(vaultDir(env), `${vaultId}.git`);
}

/** §6.2 repository resolution: a `dir` flow group's target is its run's vault; null for any other group. */
export function flowGroupRepoId(store: ControlStore, groupId: string): string | null {
  const group = flowGroupOf(store, groupId);
  return group === null || group.workspaceKind !== "dir" || group.vaultId === null ? null : flowVaultRepoId(group.vaultId);
}

/** SQL: the `flow.role` of the group row `alias` ('parent', 'child'), NULL for any other group or a body that does not parse. */
export const flowRoleSql = (alias: string): string => `(CASE WHEN json_valid(${alias}.body) THEN json_extract(${alias}.body,'$.flow.role') END)`;

/** §5.3: a child's work branch starts at the composition it was opened on. */
export function flowChildStartPoint(store: ControlStore, groupId: string): string | null {
  const block = flowBlockOf(groupBodyOf(store, groupId));
  return block?.role === "child" && typeof block.baseCommit === "string" ? block.baseCommit : null;
}
