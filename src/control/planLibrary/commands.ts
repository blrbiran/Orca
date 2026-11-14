/**
 * Scheduled flows and groups spec 2026-10-24 §5.3, §5.6, §11.1: the library verbs. Each is one command on the
 * `@plan-library` scope (revision 0, plan B2); its own checks guard it (an entry id derived from the command id, versions
 * appended only, archive refused while pinned). Everything -- reading the source, validating it as an import would,
 * writing -- happens inside the ledger's transaction, so a refusal books its code and writes nothing, and a replay answers
 * the first outcome. `by`/`via` are the route's attribution (the person and the channel), stored on each version.
 */
import { createHash } from "node:crypto";
import { readGroupAgentOverrides } from "../agentFreeze.js";
import type { PanelPartialSelection, PartialSelection } from "../agentSelection.js";
import { panelPartialSelectionSchema } from "../schema.js";
import { readArchivedPlan } from "../queries.js";
import { effectiveTaskLabels, readTaskLabelState } from "../labels.js";
import { effectivePlan, workBodyOf } from "../taskAmendments.js";
import type { ControlPlanV1 } from "../webProtocol.js";
import { applyWebCommand, preflightWebCommand, type WebCommandContext } from "../commandLedger.js";
import { commandAttributionFor } from "../commandClient.js";
import { requirementDraftHash } from "../requirementDraftHash.js";
import { ControlError } from "../errors.js";
import { readDraft, readRequirementGroup } from "../requirementRecords.js";
import type { ControlStore } from "../store.js";
import type { CommandErrorBodyV1, CommandSuccessV1, RawAuthorityCommandV1 } from "../webProtocol.js";
import { schedulerControlPlanSourceOf } from "../../scheduler/planFile.js";
import { canonicalPlanDoc, docFromArchivedPlan, docFromSource } from "./codec.js";
import { appendVersion, archiveEntry, insertEntry, readEntry, type LibraryOrigin } from "./store.js";

export const PLAN_LIBRARY_VERBS = ["plan-library-save", "plan-library-import", "plan-library-archive"] as const;
export type PlanLibraryCommand = Extract<RawAuthorityCommandV1, { verb: (typeof PLAN_LIBRARY_VERBS)[number] }>;
type Result = Extract<CommandSuccessV1["result"], { kind: `plan-library-${string}` }>;

export interface PlanLibraryDeps {
  store: ControlStore;
  /** A registered repository's path (the panel's trusted config); throws control-target-not-allowed for an unknown one. */
  resolveRepository?: (repoId: string) => string;
  now?: () => Date;
}

/** Plan B3: a new entry's id, deterministic under replay. */
export const libraryEntryId = (commandId: string): string => `pl-${createHash("sha256").update(commandId, "utf8").digest("hex").slice(0, 16)}`;

function success(context: WebCommandContext, result: Result): { status: number; body: CommandSuccessV1 } {
  return { status: 200, body: {
    schema: "orca-command-success-v1", commandId: context.rawCommand.commandId, actorId: context.rawCommand.actorId,
    verb: context.rawCommand.verb, target: context.rawCommand.target,
    // The `@plan-library` scope has revision 0 and no projection (commandLedger.ts settingRevision).
    commandRevision: context.currentCommandRevision, projectionSeq: null,
    effectivePayloadHash: context.effectivePayloadHash, authorityCommandHash: context.authorityCommandHash, result,
  } };
}

function repositoryPath(deps: PlanLibraryDeps, repoId: string): string {
  if (deps.resolveRepository === undefined) throw new ControlError("control-target-not-allowed");
  return deps.resolveRepository(repoId);
}

/**
 * Issue #154 (session 3cfc2e73; spec 2026-10-24 Correction of that session): a group is saved as it now runs, not as it
 * was imported -- each loop task's recipe as its set-task-loop amendment left it (effectivePlan) and each task's labels
 * as set-task-labels left them (effectiveTaskLabels; an empty result is omitted, as the archive omits it). The origin
 * keeps the archive's planHash: it names the group's identity, not the bytes saved.
 */
function effectiveSavedPlan(store: ControlStore, groupId: string, archived: ControlPlanV1): ControlPlanV1 {
  const plan = effectivePlan(store, groupId, archived);
  // Issue #164: the panel's group layers (proposal-set-agent), folded into the plan's at the same level.
  const overrides = readGroupAgentOverrides(JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!.body)));
  const { agent: _agent, reconcileAgent: _reconcile, ...planRest } = plan;
  const agent = foldAgentLayer(plan.agent, overrides.worker), reconcileAgent = foldAgentLayer(plan.reconcileAgent, overrides.reconcile);
  return { ...planRest, ...(agent ? { agent } : {}), ...(reconcileAgent ? { reconcileAgent } : {}), tasks: plan.tasks.map((task) => {
    const work = workBodyOf(store, groupId, task.taskId);
    if (work === null) return task;
    const { labels } = effectiveTaskLabels(readTaskLabelState(work), task.labels);
    const override = panelPartialSelectionSchema.nullable().safeParse((work as { agentOverride?: unknown }).agentOverride ?? null);
    if (!override.success) throw new ControlError("recovery-blocked", `agent-override-invalid:${task.taskId}`);
    const taskAgent = foldAgentLayer(task.agent, override.data as PanelPartialSelection | null);
    const { labels: _archived, agent: _taskAgent, ...rest } = task;
    return { ...rest, ...(taskAgent ? { agent: taskAgent } : {}), ...(labels.length > 0 ? { labels } : {}) };
  }) };
}

/**
 * Issue #164 (session f958ec3f): one level's plan layer with the panel's layer at that level folded over it, so a group
 * imported from the saved document resolves as this one does with no panel layer of its own (agentSelection.ts
 * levelLayers, ruling review R7): a null agent drops the plan's layer; a null field drops the plan's field; a panel
 * agent other than the plan's drops the plan's model and context window, which were chosen for another agent (when the
 * plan names no agent, for whichever the layers below give -- dropped too, rather than pinned to an agent they may not
 * fit); the panel's own choices win. Undefined when nothing is left.
 */
function foldAgentLayer(plan: PartialSelection | undefined, panel: PanelPartialSelection | null | undefined): PartialSelection | undefined {
  if (panel === undefined || panel === null) return plan;
  const kept: PartialSelection = panel.agent === null || (typeof panel.agent === "string" && panel.agent !== plan?.agent) ? {} : { ...(plan ?? {}) };
  for (const field of ["model", "contextWindow"] as const) if (panel[field] === null) delete kept[field];
  if (typeof panel.agent === "string") kept.agent = panel.agent;
  if (typeof panel.model === "string") kept.model = panel.model;
  if (panel.contextWindow !== undefined && panel.contextWindow !== null) kept.contextWindow = panel.contextWindow;
  return Object.keys(kept).length > 0 ? kept : undefined;
}

/** §5.3 (a), (b): the document, its project and origin from Orca's own data. Nothing is accepted or changed. */
function savedSource(store: ControlStore, source: Extract<PlanLibraryCommand, { verb: "plan-library-save" }>["payload"]["source"]): { projectId: string; raw: unknown; origin: LibraryOrigin } {
  if (source.kind === "group") {
    const archived = readArchivedPlan(store, source.groupId);
    return { projectId: archived.plan.repoId, raw: docFromArchivedPlan(effectiveSavedPlan(store, source.groupId, archived.plan)), origin: { kind: "group", groupId: source.groupId, planHash: archived.planHash } };
  }
  const group = readRequirementGroup(store, source.groupId);
  const draft = readDraft(store, source.groupId, source.draftNo);
  if ((draft.state !== "awaiting-review" && draft.state !== "accepted") || draft.plan === null) throw new ControlError("group-state-invalid", "draft-not-awaiting-review-or-accepted");
  // The same check acceptance makes (requirementCommands.ts): the hash names the stored plan the person saw.
  // ERRATUM (2026-11-14, multi-directory draft hash): it also binds the stored output used for secondary writes.
  if (draft.output === null || requirementDraftHash(draft.plan, draft.output) !== source.draftHash) throw new ControlError("plan-version-conflict", "draft-hash");
  const stored = draft.plan as { targetRepo: string };
  const plan = schedulerControlPlanSourceOf(stored, stored.targetRepo);
  // Tester follow-up E §7 (#250): acceptance seeds the agent picked on New requirement (the estimator override) as the
  // group's worker layer when no worker override exists and the plan names no group agent (requirementCommands.ts,
  // tester-round2 spec §6.2.1). The saved document gets the same seed, folded into the plan layer as a saved group's
  // panel layer is (#164), so a group imported from it resolves the agent the accepted group would.
  const overrides = readGroupAgentOverrides(group);
  const seeded = overrides.estimator !== undefined && overrides.worker === undefined && plan.agent?.agent === undefined
    ? foldAgentLayer(plan.agent, overrides.estimator) : plan.agent;
  const { agent: _agent, ...planRest } = plan;
  return { projectId: group.requirement.repoId, raw: docFromSource({ ...planRest, ...(seeded ? { agent: seeded } : {}) }),
    origin: { kind: "requirement-draft", groupId: source.groupId, draftNo: source.draftNo, draftHash: source.draftHash } };
}

/** The write both savers share: validate as an import would, then a new entry or the next version of a named one. */
function store(deps: PlanLibraryDeps, context: WebCommandContext, input: { projectId: string; name: string; entryId?: string; raw: unknown; origin: LibraryOrigin }): Result {
  const canonical = canonicalPlanDoc(input.raw, repositoryPath(deps, input.projectId));
  const command = context.rawCommand;
  const who = commandAttributionFor(command.commandId, command.actorId);
  const at = (deps.now ?? (() => new Date()))().getTime();
  let entryId = input.entryId;
  if (entryId === undefined) {
    entryId = libraryEntryId(command.commandId);
    insertEntry(deps.store, { id: entryId, projectId: input.projectId, name: input.name, by: who.by, via: who.via, at });
  } else {
    const entry = readEntry(deps.store, entryId);
    if (entry === null || entry.state !== "active") throw new ControlError("plan-library-entry-not-found", entryId);
    if (entry.projectId !== input.projectId) throw new ControlError("plan-library-project-mismatch", `${entryId} belongs to ${entry.projectId}`);
  }
  const appended = appendVersion(deps.store, { entryId, doc: canonical.bytes, origin: input.origin, by: who.by, via: who.via, at });
  return { kind: "plan-library-saved", entryId, ...appended };
}

function act(deps: PlanLibraryDeps, context: WebCommandContext): Result {
  const command = context.rawCommand as PlanLibraryCommand;
  switch (command.verb) {
    case "plan-library-save": {
      const p = command.payload;
      const { projectId, raw, origin } = savedSource(deps.store, p.source);
      return store(deps, context, { projectId, name: p.name, ...(p.entryId === undefined ? {} : { entryId: p.entryId }), raw, origin });
    }
    case "plan-library-import": {
      const p = command.payload;
      return store(deps, context, { projectId: p.projectId, name: p.name, ...(p.entryId === undefined ? {} : { entryId: p.entryId }), raw: p.doc,
        origin: { kind: "import", fileName: p.provenance.fileName, fileSha256: p.provenance.fileSha256, format: p.provenance.format } });
    }
    case "plan-library-archive": {
      const who = commandAttributionFor(command.commandId, command.actorId);
      archiveEntry(deps.store, command.payload.entryId, { ...who, at: (deps.now ?? (() => new Date()))().getTime() });
      return { kind: "plan-library-archived", entryId: command.payload.entryId };
    }
  }
}

export function applyPlanLibraryCommand(deps: PlanLibraryDeps, command: PlanLibraryCommand): CommandSuccessV1 | CommandErrorBodyV1 {
  const replay = preflightWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, command); if (replay) return replay.body;
  return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
    rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }) as never, authorityChanged: false,
    apply: (context) => success(context, act(deps, context)),
  }).body;
}
