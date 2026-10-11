/** Pure composition of full projection and independent sources. Never infers command eligibility. */
import type { Role } from "./auth.js";
import type { GroupSummaryV1, OverviewIssueV1, OverviewStepV1, OverviewV1, RecoveryViewV1 } from "./controlTypes.js";
import type { UncertainCommand } from "./controlState.js";
import type { ProjectV1 } from "./project.js";
import { projectName } from "./project.js";
import { inScope } from "./projectScope.js";
import type { GroupScope } from "./projectScope.js";
import type { DecisionListRow } from "./types.js";
import type { OverviewTarget } from "./overviewNavigation.js";
export type SourceStatus = "loading" | "available" | "stale" | "unavailable";
export interface OverviewSource<T> { status: SourceStatus; data: T | null; error: string | null }
export const loadingSource = <T>(): OverviewSource<T> => ({ status: "loading", data: null, error: null });
export const sourceFailure = <T>(prior: OverviewSource<T>, error: string): OverviewSource<T> => ({ data: prior.data, status: prior.data === null ? "unavailable" : "stale", error });
export interface OverviewInputs {
  projection: OverviewSource<OverviewV1>;
  todo: OverviewSource<readonly DecisionListRow[]>;
  recovery: OverviewSource<RecoveryViewV1>;
  uncertain: readonly UncertainCommand[];
  scope: GroupScope;
  projectKey: string | null;
  projects: readonly ProjectV1[] | null;
  roles: readonly Role[];
}
export interface OverviewQueueRow { key: string; kind: OverviewStepV1["kind"] | "decision-review" | "command-unknown"; reason: string; owner: string; ownerUnknown: boolean; ownerRequired: boolean; target: OverviewTarget; priority: number }
export interface OverviewProgress { group: GroupSummaryV1; owner: string; ownerUnknown: boolean; target: OverviewTarget }
export interface OverviewModel {
  progress: OverviewProgress[]; queue: OverviewQueueRow[]; issues: OverviewIssueV1[];
  sources: Array<{ kind: "progress" | "decisions" | "recovery"; status: SourceStatus; error: string | null }>;
  scopeUnavailable: boolean; complete: boolean;
}
export const recoveryIdentity = (scope: string, groupId: string, runId: string | null, code: string): string => JSON.stringify([scope, groupId, runId, code]);
function stepRecoveryIdentity(step: OverviewStepV1): string | null {
  if (step.kind !== "recovery-review") return null;
  // This is the producer's admitted semantic identity, not a guess based on a group warning.
  try { const key: unknown = JSON.parse(step.key);
    if (Array.isArray(key) && key[0] === "recovery-review" && typeof key[2] === "string") return key[2];
  } catch { /* Preserve an unfamiliar producer row separately. */ }
  return null;
}
export function deriveOverview(input: OverviewInputs): OverviewModel {
  const projection = input.projection.data;
  const groups = projection?.groups.filter((g) => g.archived !== true) ?? [];
  const ownerOf = (repoId: string | null) => {
    const entry = input.projects?.find((p) => p.controlRepoId === repoId);
    return { owner: entry ? projectName(entry) : repoId ?? "", ownerUnknown: entry === undefined };
  };
  // Unknown mappings are retained visibly, including when registry reads fail.
  const scoped = (repoId: string | null) => repoId === null || ownerOf(repoId).ownerUnknown || inScope(input.scope, repoId);
  const progress = groups.filter((g) => scoped(g.repoId)).map((group): OverviewProgress => ({ group, ...ownerOf(group.repoId), target: group.requirement !== undefined && group.state === "clarifying"
    ? { kind: "requirement", groupId: group.groupId, region: "answers" }
    : { kind: "group", groupId: group.groupId, region: group.state === "done" ? "results" : group.state === "draft" ? "preparation" : "progress", taskId: null, runId: null } }));
  const rows = new Map<string, OverviewQueueRow>();
  for (const step of projection?.steps ?? []) {
    if (step.destination.kind !== "recovery" && !scoped(step.repoId)) continue;
    const key = stepRecoveryIdentity(step) ?? `step:${step.key}`;
    const target: OverviewTarget = step.destination.kind === "recovery" ? { kind: "global-control", region: "recovery" } : step.destination;
    const priority = ["budget-review", "start-review", "requirement-answer", "requirement-review"].includes(step.kind) ? 1 : 0;
    const prior = rows.get(key);
    rows.set(key, { key, kind: step.kind, reason: step.reason, ...ownerOf(step.repoId), ownerRequired: step.ownerRequired || (prior?.ownerRequired ?? false), target, priority });
  }
  for (const blocker of input.recovery.data?.blockers ?? []) {
    const group = groups.find((g) => g.groupId === blocker.groupId);
    if (blocker.scope !== "global" && group && !scoped(group.repoId)) continue;
    const key = recoveryIdentity(blocker.scope, blocker.groupId, blocker.runId, blocker.code);
    const prior = rows.get(key);
    if (prior) continue;
    const target: OverviewTarget = blocker.scope === "global" || !group ? { kind: "global-control", region: "recovery" }
      : group.requirement !== undefined && group.state === "clarifying" ? { kind: "requirement", groupId: group.groupId, region: "problem" }
      : { kind: "group", groupId: group.groupId, region: "problem", taskId: null, runId: blocker.runId };
    rows.set(key, { key, kind: "recovery-review", reason: blocker.code, ...ownerOf(group?.repoId ?? null), ownerRequired: false, target, priority: 0 });
  }
  for (const row of input.todo.data ?? []) {
    const entry = input.projects?.find((p) => p.projectKey === row.projectKey);
    if (entry && input.scope.kind === "project" && row.projectKey !== input.projectKey) continue;
    const key = `decision:${JSON.stringify([row.projectKey, row.id])}`;
    rows.set(key, { key, kind: "decision-review", reason: row.question ?? row.id, owner: entry ? projectName(entry) : row.projectKey, ownerUnknown: entry === undefined, ownerRequired: false, target: { kind: "decision", projectKey: row.projectKey, id: row.id }, priority: 1 });
  }
  for (const command of input.uncertain) {
    if (command.parked && command.dismissed) continue;
    const group = groups.find((g) => g.groupId === command.groupId);
    if (!command.importPlan && group && !scoped(group.repoId)) continue;
    const target: OverviewTarget = command.importPlan ? { kind: "global-control", region: "import" }
      : !group ? { kind: "global-control", region: "recovery" }
      : group.requirement !== undefined && group.state === "clarifying" ? { kind: "requirement", groupId: group.groupId, region: "problem" }
      : { kind: "group", groupId: group.groupId, region: "problem", taskId: null, runId: null };
    const key = `command:${JSON.stringify([command.groupId, command.commandId])}`;
    rows.set(key, { key, kind: "command-unknown", reason: command.commandId, ...ownerOf(group?.repoId ?? null), ownerRequired: false, target, priority: 0 });
  }
  const sources = [{ kind: "progress" as const, status: input.projection.status, error: input.projection.error }, { kind: "decisions" as const, status: input.todo.status, error: input.todo.error }, { kind: "recovery" as const, status: input.recovery.status, error: input.recovery.error }];
  const issues = (projection?.issues ?? []).filter((issue) => scoped(issue.repoId));
  return { progress, queue: [...rows.values()].sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key)), issues, sources, scopeUnavailable: input.scope.kind === "unresolved", complete: sources.every((s) => s.status === "available") && issues.length === 0 && input.scope.kind !== "unresolved" };
}
