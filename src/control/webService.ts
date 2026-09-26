import { z } from "zod";
import { randomUUID, createHash } from "node:crypto";
import { applyWebCommand, preflightWebCommand, type WebCommandContext } from "./commandLedger.js";
import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { dimensions, zero } from "./commands.js";
import { ControlError } from "./errors.js";
import { buildBudgetEstimateRequest, ESTIMATE_GRANT, GOAL_REVIEW, TASK_HANDOFF, TASK_WORK, provenance, residual, safeNumber, sumAmounts, persistEstimateArtifacts, estimateCapabilityDegraded, validateEstimateOutput } from "./estimator.js";
import { prepareExecutionSnapshot } from "./executionSnapshot.js";
import { answeredPartials, currentPartials, RECONCILE_SLOT_KEY, resolveGroupSelections, taskSlotKey, type GroupSelectionResolution } from "./agentFreeze.js";
import type { ExecutionPort } from "./executionPort.js";
import { estimatorSlotFor, importControlPlanAsync, rejectedEstimatorRequest, type AsyncImportDeps, type ImportCommand } from "./planImport.js";
import { intersectCapabilities } from "./profiles.js";
import type { FrozenSlot } from "./agentSelection.js";
import { readArchivedPlan, readBudgetProposal, readEstimateRecord, type BudgetProposalRecord } from "./queries.js";
import { amountSchema } from "./schema.js";
import { writeCanonicalRecord, readCanonicalRecord } from "./snapshot.js";
import { dispatchEnvelopeSchema, estimateExecutionContractSchema, groupAgentOverridesSchema } from "./webProtocol.js";
import { scheduleStart, type StartCommand } from "./webDispatch.js";
import { applyHandoffStop, applyPauseDispatch, applyRecoveryRetry, applyResumeDispatch, type HandoffStopCommand, type PauseCommand, type RecoveryRetryCommand, type ResumeDispatchCommand, type StopDeps } from "./stopIntent.js";
import { applyContinueTask, applyResumeFromHandoff, type ContinueTaskCommand, type ResumeFromHandoffCommand } from "./continuation.js";
import { applySetWorkspaceMode, type SetWorkspaceModeCommand } from "./workspaceSettings.js";
import { applySetAgentPreferences, type SetAgentPreferencesCommand } from "./agentPreferences.js";
import { recordProjectionChange } from "./projectionJournal.js";
import type { Amount } from "./types.js";
import type { ControlStore } from "./store.js";
import type { CommandLookupV1, CommandSuccessV1, EffectiveProposalEditPayload, RawAuthorityCommandV1, ProfileBindingV1 } from "./webProtocol.js";
import type { AdmissionGate } from "./admissionGate.js";
import { budgetBalance } from "./budget.js";

export type ProposalEditCommand = Extract<RawAuthorityCommandV1, { verb: "proposal-edit" }>;
export type ReestimateCommand = Extract<RawAuthorityCommandV1, { verb: "estimate" }>;
export type ConfirmCommand = Extract<RawAuthorityCommandV1, { verb: "confirm" }>;
export type SetLimitCommand = Extract<RawAuthorityCommandV1, { verb: "set-limit" }>;
export type ProposalSetAgentCommand = Extract<RawAuthorityCommandV1, { verb: "proposal-set-agent" }>;
export type WebCommandResult = CommandLookupV1["body"];
export interface WebServiceDeps extends AsyncImportDeps {
  admissionGate?: AdmissionGate; now?: () => Date; knownRepository?: (repoId: string) => boolean;
  /** Agent selection spec §6.4 (W6-19): the same port the panel's profiles use; confirm resolves selections through it. */
  port: Pick<ExecutionPort, "resolveAgent">;
}
interface EstimateRun { runId: string; groupId: string; workItemId: string; phase: string; state: string; claimOrdinal: null; providerAttemptOrdinal: number; remaining: { work: Amount; handoff: Amount }; cumulative: { work: Amount; handoff: Amount }; unknown: { work: boolean; handoff: boolean }; [key: string]: unknown }

const ledgerSchema = z.object({ groupLimit: amountSchema, used: amountSchema, committedRemaining: amountSchema, explicitUnallocatedReserve: amountSchema, budgetDeficit: amountSchema, usageUnknown: z.boolean() }).strict();
const groupSchema = z.object({ groupId: z.string(), status: z.enum(["draft", "ready", "running", "review", "done", "blocked"]), stopped: z.boolean(), used: amountSchema, reserved: amountSchema, limit: amountSchema, ledger: ledgerSchema }).passthrough();
type Group = z.infer<typeof groupSchema>;
const same = (a: unknown, b: unknown) => canonicalBytes(a).equals(canonicalBytes(b));
function identifyRawEstimateOutput(value: unknown): { rawHash: string; rawIdentity: string; canonicalJson: string | null } {
  try {
    const bytes = canonicalBytes(value), canonicalJson = bytes.toString("utf8");
    return { rawHash: createHash("sha256").update(bytes).digest("hex"), rawIdentity: `canonical-json:${canonicalJson}`, canonicalJson };
  } catch (error) {
    if (!(error instanceof ControlError) || error.code !== "control-non-canonical-json") throw error;
  }
  const seen = new Map<object, number>();
  const encode = (item: unknown): unknown => {
    if (item === null) return ["null"];
    if (typeof item === "boolean" || typeof item === "string") return [typeof item, item];
    if (typeof item === "number") return ["number", Object.is(item, -0) ? "-0" : String(item)];
    if (typeof item === "bigint") return ["bigint", item.toString()];
    if (typeof item === "undefined") return ["undefined"];
    if (typeof item === "symbol") return ["symbol", item.description ?? ""];
    if (typeof item === "function") return ["function", item.name];
    const prior = seen.get(item);
    if (prior !== undefined) return ["reference", prior];
    const identity = seen.size; seen.set(item, identity);
    if (Array.isArray(item)) return ["array", identity, item.map(encode)];
    const entries = Reflect.ownKeys(item).map((key, ordinal) => {
      const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
      const encodedKey = typeof key === "string" ? ["string", key] : ["symbol", key.description ?? "", ordinal];
      return [encodedKey, "value" in descriptor ? ["value", encode(descriptor.value)] : ["accessor", Boolean(descriptor.get), Boolean(descriptor.set)]];
    });
    entries.sort((left, right) => JSON.stringify(left[0]).localeCompare(JSON.stringify(right[0])));
    return ["object", identity, entries];
  };
  const rawIdentity = `noncanonical-v1:${JSON.stringify(encode(value))}`;
  return { rawHash: createHash("sha256").update(rawIdentity).digest("hex"), rawIdentity, canonicalJson: null };
}
export function readWebGroup(store: ControlStore, groupId: string): Group {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  if (!row) throw new ControlError("group-not-found");
  try {
    const group = groupSchema.parse(JSON.parse(String(row.body)));
    if (group.groupId !== groupId || !same(group.used, group.ledger.used) || !same(group.reserved, group.ledger.committedRemaining) || !same(group.limit, group.ledger.groupLimit)) throw new Error("ledger-mismatch");
    return group;
  } catch { throw new ControlError("recovery-blocked"); }
}
function prestart(group: Group): void {
  if (group.status === "running" || group.status === "review" || group.status === "done") throw new ControlError("grant-amendment-unsupported");
  if (group.status !== "draft" && group.status !== "ready") throw new ControlError("group-state-invalid");
}
export function estimateCommitments(store: ControlStore, groupId: string): Array<{ ownerKind: "estimate"; ownerId: string; bucket: "work"; amount: Amount; fieldProvenance: ReturnType<typeof provenance> }> {
  return store.db.prepare("SELECT id FROM estimates WHERE group_id=? ORDER BY id").all(groupId).flatMap(row => {
    const estimate = readEstimateRecord(store, groupId, String(row.id));
    if (!["queued", "running", "start-unknown"].includes(estimate.state)) return [];
    let amount = estimate.grant;
    if (estimate.state !== "queued") {
      const runs = store.db.prepare("SELECT body FROM runs WHERE group_id=? AND work_item_id=? AND active=1").all(groupId, estimate.estimateId);
      if (runs.length !== 1) throw new ControlError("recovery-blocked");
      amount = amountSchema.parse(JSON.parse(String(runs[0].body)).remaining.work);
    }
    return [{ ownerKind: "estimate" as const, ownerId: estimate.estimateId, bucket: "work" as const, amount, fieldProvenance: provenance("system") }];
  });
}
export function assertKnownConservation(store: ControlStore, group: Group, proposal: BudgetProposalRecord): void {
  if (store.dispatchBlocked || group.ledger.usageUnknown) throw new ControlError("recovery-blocked");
  for (const row of store.db.prepare("SELECT body FROM runs WHERE group_id=?").all(group.groupId)) {
    const run = JSON.parse(String(row.body));
    if (!run.unknown || run.unknown.work || run.unknown.handoff) throw new ControlError("recovery-blocked");
  }
  if (!same(group.ledger.explicitUnallocatedReserve, proposal.explicitUnallocatedReserve)
    || !same(residual(group.limit, group.used, group.reserved), proposal.explicitUnallocatedReserve)
    || dimensions.some(d => group.ledger.budgetDeficit[d] !== 0)) throw new ControlError("recovery-blocked");
  const commitments = proposal.allocations.filter(a => a.ownerKind !== "reserve").map(allocation => {
    if (allocation.ownerKind === "goal-review") {
      const remaining = amountSchema.safeParse(group.reviewRemaining);
      if (!remaining.success || dimensions.some(d => remaining.data[d] > allocation.amount[d])) throw new ControlError("recovery-blocked");
      return remaining.data;
    }
    const row = store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id=?").get(group.groupId, allocation.ownerId);
    if (!row) throw new ControlError("recovery-blocked");
    const work = JSON.parse(String(row.body));
    if (["draft", "ready"].includes(work.status)) return allocation.amount;
    if (allocation.state === "terminal") return zero();
    const current = typeof work.currentRunId === "string" ? store.db.prepare("SELECT body FROM runs WHERE group_id=? AND id=? AND work_item_id=?").get(group.groupId, work.currentRunId, allocation.ownerId) : undefined;
    if (!current) throw new ControlError("recovery-blocked");
    const run = JSON.parse(String(current.body));
    const remaining = amountSchema.safeParse(run.remaining?.[allocation.bucket]);
    if (!remaining.success || dimensions.some(d => remaining.data[d] > allocation.amount[d])) throw new ControlError("recovery-blocked");
    return remaining.data;
  });
  const expected = sumAmounts([...commitments, ...estimateCommitments(store, group.groupId).map(a => a.amount)]);
  if (!same(expected, group.reserved)) throw new ControlError("recovery-blocked");
}
export function saveWebAuthority(store: ControlStore, group: Group, proposal: BudgetProposalRecord): void {
  const review = proposal.allocations.find(a => a.ownerKind === "goal-review");
  if (!review) throw new ControlError("recovery-blocked");
  group.reviewReserve = review.amount;
  if (["draft", "ready"].includes(group.status)) group.reviewRemaining = review.amount;
  group.proposal = { state: proposal.state, proposalVersion: proposal.proposalVersion, planHash: proposal.planHash, budgetMode: proposal.budgetMode, contextPolicy: proposal.contextPolicy, profiles: proposal.profiles, executionSnapshotHash: proposal.executionSnapshotHash };
  group.limit = proposal.groupLimit;
  group.reserved = group.ledger.committedRemaining;
  group.ledger = { ...group.ledger, groupLimit: proposal.groupLimit, used: group.used, explicitUnallocatedReserve: proposal.explicitUnallocatedReserve };
  store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(group), group.groupId);
  store.db.prepare("UPDATE budget_proposals SET proposal_version=?,body=? WHERE group_id=?").run(proposal.proposalVersion, canonicalBytes(proposal).toString("utf8"), group.groupId);
}
export function setReserve(proposal: BudgetProposalRecord, reserve: Amount): void {
  proposal.explicitUnallocatedReserve = reserve;
  const row = proposal.allocations.find(a => a.ownerKind === "reserve");
  if (!row) throw new ControlError("recovery-blocked");
  row.amount = reserve;
}
function success(context: WebCommandContext, result: CommandSuccessV1["result"], status = 200) {
  return { status, body: { schema: "orca-command-success-v1" as const, commandId: context.rawCommand.commandId, actorId: context.rawCommand.actorId,
    verb: context.rawCommand.verb, target: context.rawCommand.target, commandRevision: context.nextCommandRevision, projectionSeq: context.nextProjectionSeq,
    effectivePayloadHash: context.effectivePayloadHash, authorityCommandHash: context.authorityCommandHash, result } };
}
function groupId(command: RawAuthorityCommandV1): string {
  // Agent selection spec §12 I10 (plan-review P7): positively exclude the settings-scoped targets
  // (repository, operator) instead of assuming everything else carries a groupId.
  if (command.target.kind !== "group" && command.target.kind !== "task" && command.target.kind !== "run") throw new ControlError("group-not-found");
  return command.target.groupId;
}
function allocationFor(proposal: BudgetProposalRecord, target: EffectiveProposalEditPayload["operations"][number]["target"]) {
  const row = proposal.allocations.find(a => target.scope === "task" ? a.ownerKind === "task" && a.ownerId === target.taskId && a.bucket === target.allocation : a.ownerKind === "goal-review");
  if (!row) throw new ControlError("work-not-found");
  return row;
}
function verifyModelField(store: ControlStore, id: string, proposal: BudgetProposalRecord, target: EffectiveProposalEditPayload["operations"][number]["target"], value: number, estimateId: string): void {
  const estimate = readEstimateRecord(store, id, estimateId);
  if (estimate.state !== "ready" || !estimate.output || estimate.output.planHash !== proposal.planHash) throw new ControlError("proposal-version-conflict");
  const suggestion = target.scope === "goal-review" ? estimate.output.goalReviewReserve : estimate.output.tasks.find(t => t.taskId === target.taskId)?.[target.allocation];
  if (!suggestion || suggestion[target.dimension] !== value) throw new ControlError("proposal-version-conflict");
}

/** Any proposal change returns it to editable: the version advances and every confirmation-time fact is dropped. */
function reopenProposal(store: ControlStore, id: string, group: Group, proposal: BudgetProposalRecord, commitments: Amount): void {
  proposal.proposalVersion = safeNumber(BigInt(proposal.proposalVersion) + 1n);
  proposal.state = "editable"; proposal.budgetMode = null; proposal.profiles = null; proposal.executionSnapshotHash = null;
  proposal.contextPolicy = { handoffAtContextTokens: null };
  proposal.allocations.forEach(a => { a.state = "draft-encumbered"; });
  group.status = "draft"; group.ledger.committedRemaining = commitments;
  for (const row of store.db.prepare("SELECT id,body FROM work_items WHERE group_id=?").all(id)) {
    const work = JSON.parse(String(row.body));
    if (work.kind !== "task") continue;
    work.status = "draft"; work.derivedContractHash = null;
    // Agent selection spec §6.4: a reopened proposal has no frozen selection; the next confirmation freezes one.
    work.configHash = null;
    for (const key of ["agent", "agentProvenance", "timeoutMs", "killGraceMs", "agentCapabilities"]) delete work[key];
    work.grant = { work: proposal.allocations.find(a => a.ownerId === row.id && a.bucket === "work")!.amount, handoff: proposal.allocations.find(a => a.ownerId === row.id && a.bucket === "handoff")!.amount };
    store.db.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id=?").run(JSON.stringify(work), id, row.id);
  }
  (group as Record<string, unknown>).reconcileSlot = null;
  saveWebAuthority(store, group, proposal);
}

/** Web commands only publish durable authority. Provider invocation belongs to scheduler delivery. */
export class WebControlService {
  readonly store: ControlStore;
  constructor(readonly deps: WebServiceDeps) { this.store = deps.store; }
  private mutate<T>(action: () => T): T { const release = this.deps.admissionGate?.enter(); try { return action(); } finally { release?.(); } }
  async importPlan(command: ImportCommand): Promise<WebCommandResult> {
    const release = this.deps.admissionGate?.enter(); try { return await importControlPlanAsync(this.deps, command); } finally { release?.(); }
  }
  editProposal(command: ProposalEditCommand): WebCommandResult {
    return this.mutate(() => applyWebCommand(this.store, {
      rawCommand: command,
      expand: () => ({ ...command, schema: "orca-authority-command-v1", payload: { ...command.payload, proposedGroupLimit: command.payload.proposedGroupLimit ?? null, operations: command.payload.operations.map(op => ({ ...op, estimateId: op.estimateId ?? null })) } }),
      apply: context => {
        const id = groupId(command), group = readWebGroup(this.store, id), proposal = readBudgetProposal(this.store, id);
        const payload = context.effectiveCommand.payload as EffectiveProposalEditPayload;
        if (proposal.proposalVersion !== payload.baseProposalVersion) throw new ControlError("proposal-version-conflict");
        prestart(group);
        assertKnownConservation(this.store, group, proposal);
        const seen = new Set<string>();
        const before = canonicalBytes({ allocations: proposal.allocations, limit: proposal.groupLimit });
        for (const op of payload.operations) {
          const key = canonicalBytes(op.target).toString("utf8");
          if (seen.has(key)) throw new ControlError("duplicate-proposal-target"); seen.add(key);
          const row = allocationFor(proposal, op.target);
          if (row.bucket === "work" && op.value <= 0) throw new ControlError("execution-policy-unrepresentable");
          if (op.provenance === "model") verifyModelField(this.store, id, proposal, op.target, op.value, op.estimateId!);
          if (op.provenance === "complex-1m-default") {
            const defaults = op.target.scope === "goal-review" ? GOAL_REVIEW : op.target.allocation === "work" ? TASK_WORK : TASK_HANDOFF;
            if (op.value !== defaults[op.target.dimension]) throw new ControlError("proposal-version-conflict");
          }
          row.amount[op.target.dimension] = op.value;
          row.fieldProvenance[op.target.dimension] = { provenance: op.provenance, estimateId: op.estimateId };
        }
        proposal.groupLimit = payload.proposedGroupLimit ?? proposal.groupLimit;
        const commitments = sumAmounts([...proposal.allocations.filter(a => a.ownerKind !== "reserve").map(a => a.amount), ...estimateCommitments(this.store, id).map(a => a.amount)]);
        setReserve(proposal, residual(proposal.groupLimit, group.used, commitments));
        if (before.equals(canonicalBytes({ allocations: proposal.allocations, limit: proposal.groupLimit }))) throw new ControlError("no-op-command");
        reopenProposal(this.store, id, group, proposal, commitments);
        return success(context, { kind: "proposal-edited", proposalVersion: proposal.proposalVersion });
      },
    }).body);
  }
  /** Agent selection spec §6.2 (W6-20): replace or clear one selection layer -- a proposal change like any other. */
  async proposalSetAgent(command: ProposalSetAgentCommand): Promise<WebCommandResult> {
    return this.mutate(() => applyWebCommand(this.store, {
      rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
      apply: context => {
        const id = groupId(command), group = readWebGroup(this.store, id), proposal = readBudgetProposal(this.store, id);
        const { scope, partial, baseProposalVersion } = command.payload;
        if (proposal.proposalVersion !== baseProposalVersion) throw new ControlError("proposal-version-conflict");
        prestart(group);
        assertKnownConservation(this.store, group, proposal);
        if (scope.kind === "group") {
          const overrides = groupAgentOverridesSchema.parse((group as { agentOverrides?: unknown }).agentOverrides ?? {});
          const before = canonicalBytes(overrides);
          if (partial === null) delete overrides[scope.slot];
          else overrides[scope.slot] = partial;
          if (before.equals(canonicalBytes(overrides))) throw new ControlError("no-op-command");
          (group as Record<string, unknown>).agentOverrides = overrides;
        } else {
          const row = this.store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id=?").get(id, scope.taskId);
          const work = row ? JSON.parse(String(row.body)) : null;
          if (!work || work.kind !== "task") throw new ControlError("work-not-found");
          if (canonicalBytes(work.agentOverride ?? null).equals(canonicalBytes(partial))) throw new ControlError("no-op-command");
          work.agentOverride = partial;
          this.store.db.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id=?").run(JSON.stringify(work), id, scope.taskId);
        }
        const commitments = sumAmounts([...proposal.allocations.filter(a => a.ownerKind !== "reserve").map(a => a.amount), ...estimateCommitments(this.store, id).map(a => a.amount)]);
        setReserve(proposal, residual(proposal.groupLimit, group.used, commitments));
        reopenProposal(this.store, id, group, proposal, commitments);
        return success(context, { kind: "proposal-edited", proposalVersion: proposal.proposalVersion });
      },
    }).body);
  }
  async createEstimate(command: ReestimateCommand): Promise<WebCommandResult> {
    const release = this.deps.admissionGate?.enter();
    try {
      const replay = preflightWebCommand(this.store, command); if (replay) return replay.body;
      let prepared: ReturnType<typeof buildBudgetEstimateRequest>;
      let estimatorSlot: FrozenSlot | null;
      try {
        const id = groupId(command), group = readWebGroup(this.store, id);
        const plan = readArchivedPlan(this.store, id), proposal = readBudgetProposal(this.store, id);
        if (proposal.proposalVersion !== command.payload.proposalVersion) throw new ControlError("proposal-version-conflict");
        prestart(group);
        const profile = this.deps.profileRouter.resolve("budget-estimate", command.payload.estimatorProfileId, command.payload.estimatorProfileHash);
        // Spec §6.4: a re-estimate resolves the estimator layers as they are now -- including the group's, which only
        // the panel sets (controller ruling R7) -- and freezes them for this estimate only.
        const overrides = groupAgentOverridesSchema.parse((group as { agentOverrides?: unknown }).agentOverrides ?? {});
        const slot = await estimatorSlotFor({ store: this.store, profileRouter: this.deps.profileRouter }, command.actorId, overrides, profile);
        estimatorSlot = slot.outcome.kind === "frozen" ? slot.outcome.slot : null;
        prepared = slot.outcome.kind === "rejected"
          ? rejectedEstimatorRequest(slot.outcome.code)
          : buildBudgetEstimateRequest({ planHash: plan.planHash, planCanonicalJson: plan.canonicalJson, profile, observation: slot.observation, mode: command.payload.estimateMode, exactTokenCount: this.deps.exactTokenCount });
      } catch (error) {
        return applyWebCommand<WebCommandResult>(this.store, { rawCommand: command, expand: () => { throw error; }, apply: () => { throw error; } }).body;
      }
      return applyWebCommand(this.store, {
        rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
        apply: context => {
          const id = groupId(command), group = readWebGroup(this.store, id), proposal = readBudgetProposal(this.store, id);
          if (proposal.proposalVersion !== command.payload.proposalVersion) throw new ControlError("proposal-version-conflict");
          prestart(group);
          this.deps.profileRouter.resolve("budget-estimate", command.payload.estimatorProfileId, command.payload.estimatorProfileHash);
          const estimateVersion = safeNumber(BigInt(Number(this.store.db.prepare("SELECT MAX(estimate_version) AS n FROM estimates WHERE group_id=?").get(id)?.n ?? 0)) + 1n);
          const estimateId = `estimate-${sha256Canonical({ groupId: id, planHash: proposal.planHash, version: estimateVersion }).slice(0, 24)}`;
          if (prepared.state === "queued") {
            assertKnownConservation(this.store, group, proposal);
            group.ledger.committedRemaining = sumAmounts([group.reserved, ESTIMATE_GRANT]);
            setReserve(proposal, residual(group.limit, group.used, group.ledger.committedRemaining));
          }
          const estimate = { estimateId, estimateVersion, state: prepared.state, profile: { profileId: command.payload.estimatorProfileId, profileHash: command.payload.estimatorProfileHash }, mode: command.payload.estimateMode,
            requestHash: prepared.requestHash, request: prepared.request, outputHash: null, output: null, reasonCode: prepared.reasonCode, grant: ESTIMATE_GRANT, estimatorSlot };
          this.store.db.prepare("INSERT INTO estimates(group_id,id,estimate_version,state,body) VALUES (?,?,?,?,?)").run(id, estimateId, estimateVersion, prepared.state, canonicalBytes(estimate).toString("utf8"));
          persistEstimateArtifacts(this.store, id, estimateId, prepared);
          const wakeId = prepared.state === "queued" ? `scheduler-wake:${id}:estimate:${estimateId}` : null;
          if (wakeId) this.store.db.prepare("INSERT INTO scheduler_wakes(id,group_id,kind,body,delivered) VALUES (?,?,'budget-estimate',?,0)").run(wakeId, id, JSON.stringify({ groupId: id, estimateId, planHash: proposal.planHash }));
          saveWebAuthority(this.store, group, proposal);
          return success(context, { kind: "estimate-created", estimateId, estimateVersion, estimateState: prepared.state, reasonCode: prepared.reasonCode, wakeId }, wakeId ? 202 : 200);
        },
      }).body;
    } finally { release?.(); }
  }
  /** Claim hook for durable wake delivery. It does not accept or invoke a provider. */
  async claimEstimate(id: string, estimateId: string): Promise<EstimateRun | null> {
    const release = this.deps.admissionGate?.enter();
    try {
      const initial = readEstimateRecord(this.store, id, estimateId);
      if (!["queued", "running", "start-unknown"].includes(initial.state)) return null;
      const profile = this.deps.profileRouter.resolve("budget-estimate", initial.profile.profileId, initial.profile.profileHash);
      // Spec §6.4 last paragraph: the claim probes the estimate's frozen estimator selection. An estimate without one is
      // never queued; asking `{}` lets the port refuse it, which degrades the estimate below.
      const observation = await this.deps.profileRouter.probe(profile, initial.estimatorSlot?.selection ?? {});
      return this.store.transaction(() => {
        const estimate = readEstimateRecord(this.store, id, estimateId), group = readWebGroup(this.store, id), proposal = readBudgetProposal(this.store, id);
        if (!["queued", "running", "start-unknown"].includes(estimate.state)) return null;
        const existing = this.store.db.prepare("SELECT body FROM runs WHERE group_id=? AND work_item_id=?").get(id, estimateId);
        if (existing) return JSON.parse(String(existing.body)) as EstimateRun;
        if (estimate.state !== "queued" || !estimate.request) throw new ControlError("recovery-blocked");
        prestart(group); assertKnownConservation(this.store, group, proposal);
        if (group.stopped) throw new ControlError("group-stopped");
        this.deps.profileRouter.resolve("budget-estimate", estimate.profile.profileId, estimate.profile.profileHash);
        if (estimateCapabilityDegraded(estimate.request, observation, estimate.mode)) {
          estimate.state = "blocked-capability"; estimate.reasonCode = "estimate-capability-degraded";
          group.ledger.committedRemaining = residual(group.reserved, zero(), estimate.grant);
          setReserve(proposal, residual(group.limit, group.used, group.ledger.committedRemaining));
          this.store.db.prepare("UPDATE estimates SET state=?,body=? WHERE group_id=? AND id=?").run(estimate.state, canonicalBytes(estimate).toString("utf8"), id, estimateId);
          saveWebAuthority(this.store, group, proposal); recordProjectionChange(this.store, [id]);
          return null;
        }
        const bindingRow = this.store.db.prepare("SELECT body FROM outbox WHERE id=? AND kind='estimate-contract'").get(`estimate-contract:${id}:${estimateId}`);
        if (!bindingRow) throw new ControlError("recovery-blocked");
        const binding = z.object({ groupId: z.literal(id), estimateId: z.literal(estimateId), requestHash: z.literal(estimate.requestHash), contractHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(JSON.parse(String(bindingRow.body)));
        const contract = estimateExecutionContractSchema.parse(JSON.parse(readCanonicalRecord(this.store, binding.contractHash)));
        if (contract.requestHash !== estimate.requestHash || !same(contract.profile, estimate.profile) || !same(contract.grant, estimate.grant)
          || !same(contract.estimatorCapabilities, estimate.request.estimatorCapabilities)) throw new ControlError("recovery-blocked");
        // Spec §12 C5: the estimate run's configHash is its frozen estimator selection's, never the profile hash.
        const slot = estimate.estimatorSlot;
        if (!slot) throw new ControlError("recovery-blocked", "estimator-slot-missing");
        const plan = readArchivedPlan(this.store, id), runId = `run-${randomUUID()}`, ownerToken = randomUUID(), grant = { work: estimate.grant, handoff: zero() };
        const run: EstimateRun = { runId, groupId: id, workItemId: estimateId, taskId: null, estimateId, generation: 1, graphVersion: plan.graphVersion, targetVersion: estimate.estimateVersion,
          commandId: estimateId, configHash: slot.configHash, agent: slot.selection, agentProvenance: slot.provenance, timeoutMs: slot.timeoutMs, killGraceMs: slot.killGraceMs,
          agentCapabilities: intersectCapabilities(profile.snapshot.profile.capabilities, slot.capabilities),
          grant, ownerToken, executionProfile: { workKind: "budget-estimate", ...estimate.profile }, handoffProfile: null,
          executionId: null, state: "starting", checkpointId: null, recoverable: false, remaining: structuredClone(grant), cumulative: { work: zero(), handoff: zero() }, unknown: { work: false, handoff: false },
          highWater: 0, breaches: [], handoffWorkItemId: null, phase: "estimate", claimOrdinal: null, providerAttemptOrdinal: 0, failureCode: null };
        const envelope = dispatchEnvelopeSchema.parse({ schema: "orca-dispatch-envelope-v1", phase: "estimate", groupId: id, workItemId: estimateId, runId, generation: 1,
          claimIdentity: `estimate:${id}:${estimateId}`, ownerTokenHash: createHash("sha256").update(ownerToken).digest("hex"), continuationIntentId: null, claimOrdinal: null,
          derivedContractHash: binding.contractHash, grants: grant, profiles: { estimator: estimate.profile, worker: null, handoff: null } });
        const envelopeHash = sha256Canonical(envelope); writeCanonicalRecord(this.store, id, envelopeHash, canonicalBytes(envelope).toString("utf8"));
        this.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES (?,?,?,1,1,?)").run(runId, id, estimateId, JSON.stringify(run));
        this.store.db.prepare("INSERT INTO outbox(id,kind,body,delivered) VALUES (?,'estimate-claim',?,0)").run(`estimate:${id}:${estimateId}`, canonicalBytes({ groupId: id, estimateId, runId, envelopeHash, sessionReservation: 1, attemptReservation: 0 }).toString("utf8"));
        estimate.state = "running";
        this.store.db.prepare("UPDATE estimates SET state=?,body=? WHERE group_id=? AND id=?").run(estimate.state, canonicalBytes(estimate).toString("utf8"), id, estimateId);
        recordProjectionChange(this.store, [id]); return run;
      });
    } finally { release?.(); }
  }
  /** The scheduler verifies evidence first, then commits terminal state in this same transaction. */
  completeEstimate(id: string, estimateId: string, rawOutput: unknown, commitTerminal?: () => void): void {
    this.mutate(() => this.store.transaction(() => {
      const estimate = readEstimateRecord(this.store, id, estimateId), receiptId = `estimate-result:${id}:${estimateId}`;
      const { rawHash, rawIdentity, canonicalJson: rawCanonicalJson } = identifyRawEstimateOutput(rawOutput);
      const receipt = this.store.db.prepare("SELECT body FROM outbox WHERE id=? AND kind='estimate-result'").get(receiptId);
      if (receipt) {
        const retained = JSON.parse(String(receipt.body));
        if (retained.rawHash !== rawHash || retained.rawIdentity !== rawIdentity) throw new ControlError("report-identity-conflict");
        return;
      }
      commitTerminal?.();
      if (!["running", "start-unknown"].includes(estimate.state)) throw new ControlError("start-state-conflict");
      const rows = this.store.db.prepare("SELECT id,active,body FROM runs WHERE group_id=? AND work_item_id=?").all(id, estimateId);
      if (rows.length !== 1) throw new ControlError("recovery-blocked");
      const run = JSON.parse(String(rows[0].body)) as EstimateRun;
      if (!["failed-before-provider", "settled-recoverable", "settled-restartable", "settled-unrecoverable"].includes(run.state)
        || run.groupId !== id || run.workItemId !== estimateId || run.unknown.work || run.unknown.handoff) throw new ControlError("run-stop-unconfirmed");
      amountSchema.parse(run.remaining.work); amountSchema.parse(run.cumulative.work);
      const grants = z.object({ work: amountSchema, handoff: amountSchema }).strict().safeParse(run.grant);
      if (Number(rows[0].active) !== 1 || run.runId !== String(rows[0].id) || !grants.success || !same(grants.data.work, estimate.grant)
        || !same(grants.data.handoff, zero()) || !same(run.remaining.handoff, zero()) || !same(run.cumulative.handoff, zero())
        || dimensions.some(d => run.remaining.work[d] !== Math.max(estimate.grant[d] - run.cumulative.work[d], 0))
        || this.store.db.prepare("SELECT seq FROM usage_events WHERE run_id=? AND seq>?").get(run.runId, Number(run.highWater))) throw new ControlError("recovery-blocked");
      const group = readWebGroup(this.store, id), proposal = readBudgetProposal(this.store, id), plan = readArchivedPlan(this.store, id);
      if (group.ledger.usageUnknown) throw new ControlError("recovery-blocked");
      if (dimensions.some(d => group.used[d] < run.cumulative.work[d])) throw new ControlError("recovery-blocked");
      const currentBalance = budgetBalance(group.limit, group.used, group.reserved);
      if (!same(currentBalance.reserve, proposal.explicitUnallocatedReserve) || !same(currentBalance.deficit, group.ledger.budgetDeficit)) throw new ControlError("recovery-blocked");
      let output, outputHash: string | null = null;
      try {
        output = validateEstimateOutput(rawOutput, plan.planHash, plan.plan.tasks.map(t => t.taskId));
        outputHash = sha256Canonical(output);
      }
      catch (error) {
        if (!(error instanceof ControlError)) throw error;
        output = undefined; outputHash = null;
      }
      estimate.state = output ? "ready" : "failed"; estimate.output = output ?? null; estimate.outputHash = outputHash; estimate.reasonCode = output ? null : "plan-version-conflict";
      if (rawCanonicalJson !== null) writeCanonicalRecord(this.store, id, rawHash, rawCanonicalJson);
      if (output) writeCanonicalRecord(this.store, id, estimate.outputHash!, canonicalBytes(output).toString("utf8"));
      group.ledger.committedRemaining = residual(group.reserved, zero(), run.remaining.work);
      const settledBalance = budgetBalance(group.limit, group.used, group.ledger.committedRemaining);
      group.ledger.budgetDeficit = settledBalance.deficit;
      setReserve(proposal, settledBalance.reserve);
      this.store.db.prepare("UPDATE estimates SET state=?,body=? WHERE group_id=? AND id=?").run(estimate.state, canonicalBytes(estimate).toString("utf8"), id, estimateId);
      this.store.db.prepare("UPDATE runs SET active=0 WHERE id=?").run(run.runId);
      this.store.db.prepare("INSERT INTO outbox(id,kind,body,delivered) VALUES (?,'estimate-result',?,1)").run(receiptId, canonicalBytes({ groupId: id, estimateId, runId: run.runId, rawHash, rawIdentity }).toString("utf8"));
      saveWebAuthority(this.store, group, proposal); recordProjectionChange(this.store, [id]);
    }));
  }
  async start(command: StartCommand): Promise<WebCommandResult> {
    return scheduleStart({ store: this.store, profileRouter: this.deps.profileRouter, admissionGate: this.deps.admissionGate }, command);
  }
  private stopDeps(): StopDeps {
    return { store: this.store, profileRouter: this.deps.profileRouter, admissionGate: this.deps.admissionGate, now: this.deps.now, beforeCommit: this.deps.beforeCommit };
  }
  async pauseDispatch(command: PauseCommand): Promise<WebCommandResult> {
    return applyPauseDispatch(this.stopDeps(), command) as WebCommandResult;
  }
  async handoffStop(command: HandoffStopCommand): Promise<WebCommandResult> {
    return applyHandoffStop(this.stopDeps(), command) as WebCommandResult;
  }
  async resumeDispatch(command: ResumeDispatchCommand): Promise<WebCommandResult> {
    return applyResumeDispatch(this.stopDeps(), command) as WebCommandResult;
  }
  async recoveryRetry(command: RecoveryRetryCommand): Promise<WebCommandResult> {
    return applyRecoveryRetry(this.stopDeps(), command) as WebCommandResult;
  }
  /** Execution driver spec §3.2. A panel started without the repository refuses it by name. */
  async setWorkspaceMode(command: SetWorkspaceModeCommand): Promise<WebCommandResult> {
    return applySetWorkspaceMode({ store: this.store, admissionGate: this.deps.admissionGate, knownRepository: this.deps.knownRepository ?? (() => false) }, command) as WebCommandResult;
  }
  repositoryKnown(repoId: string): boolean { return this.deps.knownRepository?.(repoId) ?? false; }
  /** Agent selection spec §6.2 layer 1: the operator's defaults, under their own revision. */
  async setAgentPreferences(command: SetAgentPreferencesCommand): Promise<WebCommandResult> {
    return applySetAgentPreferences({ store: this.store, admissionGate: this.deps.admissionGate }, command) as WebCommandResult;
  }
  async resumeFromHandoff(command: ResumeFromHandoffCommand): Promise<WebCommandResult> {
    return applyResumeFromHandoff(this.stopDeps(), command) as WebCommandResult;
  }
  async continueTask(command: ContinueTaskCommand): Promise<WebCommandResult> {
    return applyContinueTask(this.stopDeps(), command) as WebCommandResult;
  }
  /**
   * Agent selection spec §6.4 (§12 C4): resolve every slot through ccloop outside the transaction, then freeze only
   * if what was resolved is what the operator saw and no layer moved since. A slot failure is decided inside the
   * transaction, after every existing check, so the precedence of the existing error codes is unchanged.
   */
  async confirm(command: ConfirmCommand): Promise<WebCommandResult> {
    const release = this.deps.admissionGate?.enter();
    try {
      const replay = preflightWebCommand<WebCommandResult>(this.store, command); if (replay) return replay.body;
      const prepared: GroupSelectionResolution | { failure: unknown } = await resolveGroupSelections({ store: this.store, port: this.deps.port }, groupId(command), command.actorId)
        .catch((failure: unknown) => ({ failure }));
      return applyWebCommand<WebCommandResult>(this.store, {
        rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
        apply: context => {
          const id = groupId(command), group = readWebGroup(this.store, id), plan = readArchivedPlan(this.store, id), proposal = readBudgetProposal(this.store, id), payload = command.payload;
          if (payload.planHash !== plan.planHash) throw new ControlError("plan-version-conflict");
          if (payload.proposalVersion !== proposal.proposalVersion) throw new ControlError("proposal-version-conflict");
          prestart(group);
          if (proposal.state === "confirmed") throw new ControlError("no-op-command");
          assertKnownConservation(this.store, group, proposal);
          const selected = { estimator: this.deps.profileRouter.resolve("budget-estimate", payload.profileIds.estimator, payload.profileHashes.estimator), worker: this.deps.profileRouter.resolve("task", payload.profileIds.worker, payload.profileHashes.worker), handoff: this.deps.profileRouter.resolve("handoff", payload.profileIds.handoff, payload.profileHashes.handoff), goalReview: this.deps.profileRouter.resolve("goal-review", payload.profileIds.goalReview, payload.profileHashes.goalReview) };
          const window = selected.worker.snapshot.profile.capabilities.contextWindowTokens, threshold = payload.contextPolicy.handoffAtContextTokens;
          if (window === null ? threshold !== null : threshold === null || threshold > window) throw new ControlError("execution-policy-unrepresentable");
          const profiles = Object.fromEntries(Object.entries(selected).map(([slot, p]) => [slot, { profileId: p.snapshot.profile.profileId, profileHash: p.profileHash }])) as Record<keyof typeof selected, ProfileBindingV1>;
          for (const row of proposal.allocations) for (const d of dimensions) {
            const source = row.fieldProvenance[d];
            if (source.provenance !== "model") continue;
            if (row.ownerKind === "reserve") throw new ControlError("proposal-version-conflict");
            const target = row.ownerKind === "goal-review" ? { scope: "goal-review" as const, dimension: d } : { scope: "task" as const, taskId: row.ownerId, allocation: row.bucket as "work" | "handoff", dimension: d };
            verifyModelField(this.store, id, proposal, target, row.amount[d], source.estimateId!);
          }
          // Spec §6.4 step 2: any failed slot refuses the whole confirmation, named after the first one by key.
          if ("failure" in prepared) throw prepared.failure;
          const resolution: GroupSelectionResolution = prepared;
          const rejected = resolution.slots.find(slot => slot.outcome.kind === "rejected");
          if (rejected && rejected.outcome.kind === "rejected") throw new ControlError("agent-selection-rejected", `${rejected.taskId ?? RECONCILE_SLOT_KEY}:${rejected.outcome.code}`);
          // Step 3: what was resolved is what the operator saw, and the layers have not moved since (checked inside the transaction).
          if (payload.selectionsHash !== resolution.selectionsHash || resolution.proposalVersion !== proposal.proposalVersion
            || !canonicalBytes(answeredPartials(resolution)).equals(canonicalBytes(currentPartials(this.store, id, command.actorId)))) throw new ControlError("agent-selection-changed");
          const frozenOf = (key: string) => {
            const slot = resolution.slots.find(entry => entry.key === key);
            if (!slot || slot.outcome.kind !== "resolved") throw new ControlError("recovery-blocked", `slot-missing:${key}`);
            return slot.outcome.frozen;
          };
          // Spec §6.5: a task's capabilities are the worker profile's declaration intersected with ccloop's answer for its selection.
          const workerDeclared = selected.worker.snapshot.profile.capabilities;
          const agentTasks = plan.plan.tasks.map(task => {
            const frozen = frozenOf(taskSlotKey(task.taskId));
            return { taskId: task.taskId, agent: frozen.selection, agentProvenance: frozen.provenance, configHash: frozen.configHash,
              timeoutMs: frozen.timeoutMs, killGraceMs: frozen.killGraceMs, agentCapabilities: intersectCapabilities(workerDeclared, frozen.capabilities) };
          });
          const reconcileSlot = frozenOf(RECONCILE_SLOT_KEY);
          const tasks = plan.plan.tasks.map(task => {
            const work = proposal.allocations.find(a => a.ownerId === task.taskId && a.bucket === "work")!.amount;
            const handoff = proposal.allocations.find(a => a.ownerId === task.taskId && a.bucket === "handoff")!.amount;
            if (selected.handoff.snapshot.profile.capabilities.handoffExecution === "model-assisted-v1" && dimensions.some(d => handoff[d] < 1)) throw new ControlError("handoff-grant-insufficient");
            return { ...task, work, handoff };
          });
          const built = prepareExecutionSnapshot({ store: this.store, groupId: id, planHash: plan.planHash, graphVersion: plan.graphVersion, proposalVersion: proposal.proposalVersion,
            proposalIdentity: { groupId: id, planHash: plan.planHash, proposalVersion: proposal.proposalVersion }, groupLimit: proposal.groupLimit, budgetMode: payload.budgetMode, contextPolicy: payload.contextPolicy, profiles,
            allocations: [...proposal.allocations.map(({ state: _state, ...a }) => a), ...estimateCommitments(this.store, id)], tasks, agents: { tasks: agentTasks, reconcile: reconcileSlot } });
          for (const derived of built.derivedContracts) {
            writeCanonicalRecord(this.store, id, derived.derivedContractHash, derived.canonicalJson);
            const workRow = this.store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id=?").get(id, derived.taskId);
            if (!workRow) throw new ControlError("recovery-blocked");
            const work = JSON.parse(String(workRow.body));
            // Spec §6.4 step 4: the work item carries exactly what the snapshot freezes for its task.
            const { taskId: _taskId, ...frozen } = agentTasks.find(entry => entry.taskId === derived.taskId)!;
            Object.assign(work, frozen);
            work.derivedContractHash = derived.derivedContractHash; work.status = "ready"; work.claimOrdinal = 0; work.currentRunId = null; work.pendingRunId = null; work.lineageRunIds = [];
            this.store.db.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id=?").run(JSON.stringify(work), id, derived.taskId);
          }
          writeCanonicalRecord(this.store, id, built.snapshotHash, built.canonicalJson);
          (group as Record<string, unknown>).reconcileSlot = reconcileSlot;
          proposal.state = "confirmed"; proposal.budgetMode = payload.budgetMode; proposal.contextPolicy = payload.contextPolicy; proposal.profiles = profiles; proposal.executionSnapshotHash = built.snapshotHash;
          proposal.allocations.forEach(a => { a.state = "confirmed"; }); group.status = "ready"; group.budgetMode = payload.budgetMode;
          saveWebAuthority(this.store, group, proposal);
          this.deps.beforeCommit?.();
          return success(context, { kind: "confirmed", executionSnapshotHash: built.snapshotHash });
        },
      }).body;
    } finally { release?.(); }
  }
  setLimit(command: SetLimitCommand): WebCommandResult {
    return this.mutate(() => applyWebCommand(this.store, {
      rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
      apply: context => {
        const id = groupId(command), group = readWebGroup(this.store, id), proposal = readBudgetProposal(this.store, id);
        if (!["ready", "running", "review"].includes(group.status)) throw new ControlError("group-state-invalid");
        const limit = command.payload.limit;
        if (same(limit, group.limit)) throw new ControlError("no-op-command");
        // Unknown usage cannot authorize a decrease or a new allocation.
        const decreasing = dimensions.some(d => limit[d] < group.limit[d]);
        if (decreasing || !group.ledger.usageUnknown) assertKnownConservation(this.store, group, proposal);
        proposal.groupLimit = limit;
        setReserve(proposal, residual(limit, group.used, group.reserved));
        saveWebAuthority(this.store, group, proposal);
        return success(context, { kind: "limit-set", limit });
      },
    }).body);
  }
}
