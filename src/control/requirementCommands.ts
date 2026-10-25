import type { BudgetAmount } from "./tokenPolicy.js";
import { requirementHost } from "./clarifyHost.js";
import { createHash } from "node:crypto";
import { readGroupAgentOverrides } from "./agentFreeze.js";
import { applyWebCommand, preflightWebCommand } from "./commandLedger.js";
import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { dimensions } from "./commands.js";
import { ControlError } from "./errors.js";
import type { DirProjectOf } from "./dirGroup.js";
import { DirFolderMissing, freezeDirWorkspace, type FrozenDirWorkspace } from "./dirWorkspace.js";
import { freezeMultiDir, dirTargetRepoId, multiDirOf, type FrozenMultiDir, type MultiDirProjectOf } from "./multiGroup.js";
import { estimatorCompatibility } from "./estimatorCompatibility.js";
import { singleCallOutputBound } from "./estimator.js";
import {
  estimatorSlotFor, normalizeControlPlan, writeImportedPlan, type AsyncImportDeps, type ImportDefaults, type ImportDeps, type PreparedEstimatorSlot,
} from "./planImport.js";
import type { ExecutionProfileRouter, FrozenProfile } from "./profiles.js";
import { activeChain, chainRounds, reviseRound } from "./clarifyChain.js";
import { routedAttributionFor } from "./commandClient.js";
import { renderRequirementDocument } from "./requirementDocument.js";
import {
  clarifyLimits, insertClarifyingGroup, latestDraft, latestRound, newDraft, newRound, queueRequirementCall, readDraft, readRequirementGroup, readRounds, saveRequirementGroup,
  writeDraft, writeRound,
} from "./requirementRecords.js";
import { writeCanonicalRecord } from "./snapshot.js";
import { schedulerControlPlanSourceOf } from "../scheduler/planFile.js";
import { expandMultiSplitDraft, orderWrites, type SplitPlanFile } from "./requirementSplit.js";
import { REQUIREMENT_LIMIT_DEFAULT, type MultiSplitOutput } from "./requirementSchemas.js";
import { commandSuccess, readStopIntent } from "./stopIntent.js";
import type { ControlStore } from "./store.js";
import type { AdmissionGate } from "./admissionGate.js";
import type { Amount } from "./types.js";
import type { CommandLookupV1, RawAuthorityCommandV1 } from "./webProtocol.js";

export type RequirementOpenCommand = Extract<RawAuthorityCommandV1, { verb: "requirement-open" }>;
export type RequirementAnswerCommand = Extract<RawAuthorityCommandV1, { verb: "requirement-answer" }>;
export type RequirementConsensusCommand = Extract<RawAuthorityCommandV1, { verb: "requirement-consensus" }>;
export type RequirementDraftFeedbackCommand = Extract<RawAuthorityCommandV1, { verb: "requirement-draft-feedback" }>;
export type RequirementDraftAcceptCommand = Extract<RawAuthorityCommandV1, { verb: "requirement-draft-accept" }>;
export type RequirementClarifyMoreCommand = Extract<RawAuthorityCommandV1, { verb: "requirement-clarify-more" }>;
export type RequirementClassifyCommand = Extract<RawAuthorityCommandV1, { verb: "requirement-classify" }>;
export type RequirementReviseCommand = Extract<RawAuthorityCommandV1, { verb: "requirement-revise" }>;
type Result = CommandLookupV1["body"];
export interface RequirementCommandDeps {
  store: ControlStore; admissionGate?: AdmissionGate; profileRouter: ExecutionProfileRouter; defaults: () => ImportDefaults | null;
  knownRepository?: (repoId: string) => boolean; now?: () => Date;
  /** Dir-requirements spec §5.1: the registered `dir` project a repo id names; absent, every project is a repository. */
  dirProjectOf?: DirProjectOf;
  /** Multi-directory projects spec §5.2: the members of the multi-dir project a repo id names, or null. */
  multiDirProjectOf?: MultiDirProjectOf;
}
type EffectiveOpenPayload = { groupId: string; repoId: string; idea: string; limit: BudgetAmount; agent: Record<string, unknown> | null; contentLanguage: "en" | "zh" };

const nowOf = (deps: { now?: () => Date }) => (deps.now ?? (() => new Date()))();
const invalid = (detail: string): never => { throw new ControlError("group-state-invalid", detail); };
const sameIds = (given: readonly string[], expected: readonly string[]) =>
  given.length === expected.length && new Set(given).size === given.length && expected.every((id) => given.includes(id));
function admitted<T>(deps: { admissionGate?: AdmissionGate }, action: () => T): T {
  const release = deps.admissionGate?.enter();
  try { return action(); } finally { release?.(); }
}
function clarifying(store: ControlStore, groupId: string) {
  const group = readRequirementGroup(store, groupId);
  if (group.status !== "clarifying") invalid("not-clarifying");
  return group;
}
/**
 * Final review finding 5: a stopped group, or one with a stop still open, takes no answer, consensus or feedback -- each
 * would queue a call the stop holds -- as accept refuses it (controller ruling (b) below). recovery-retry lifts the stop.
 */
function notStopped(store: ControlStore, group: { groupId: string; stopped: boolean }): void {
  if (group.stopped || readStopIntent(store, group.groupId) !== null) throw new ControlError("group-stopped");
}

/** Spec §11.1 item 1 (DR7, DR13, DR24): the agent is resolved outside the transaction and frozen inside it. */
export async function applyRequirementOpen(deps: RequirementCommandDeps, command: RequirementOpenCommand): Promise<Result> {
  // The admission gate is held across the probe's await, as createEstimate holds it (webService.ts).
  const release = deps.admissionGate?.enter();
  try {
    const replay = preflightWebCommand<Result>(deps.store, command);
    if (replay) return replay.body;
    let profile: FrozenProfile, slot: PreparedEstimatorSlot, estimateMode: "strict" | "soft";
    let dirWorkspace: FrozenDirWorkspace | undefined;
    let multiDir: FrozenMultiDir | undefined;
    try {
      // Multi-directory projects spec §5.2: a multi-dir project's list is frozen now, from realpaths (a read, no vault yet).
      // A multi group carries no single-folder `dirWorkspace`.
      const multiProject = deps.multiDirProjectOf?.(command.payload.repoId) ?? null;
      if (multiProject !== null) multiDir = freezeMultiDir(command.payload.repoId, multiProject.dirs);
      // Dir-requirements spec §5.1: on a `dir` project the folder is frozen now (a realpath: a read, no vault yet).
      else {
        const dirProject = deps.dirProjectOf?.(command.payload.repoId) ?? null;
        if (dirProject !== null) {
          try { dirWorkspace = await freezeDirWorkspace(dirProject.path); }
          catch (error) { throw error instanceof DirFolderMissing ? new ControlError("dir-folder-missing", error.message) : error; }
        }
      }
      const defaults = deps.defaults();
      if (!defaults?.estimatorProfileId || !defaults.estimatorProfileHash) throw new ControlError("control-estimator-unconfigured");
      estimateMode = defaults.estimateMode;
      profile = deps.profileRouter.resolve("budget-estimate", defaults.estimatorProfileId, defaults.estimatorProfileHash);
      slot = await estimatorSlotFor({ store: deps.store, profileRouter: deps.profileRouter }, command.actorId, command.payload.agent === undefined ? {} : { estimator: command.payload.agent }, profile);
    } catch (error) {
      return applyWebCommand<Result>(deps.store, { rawCommand: command, expand: () => { throw error; }, apply: () => { throw error; } }).body;
    }
    const now = nowOf(deps);
    return applyWebCommand<Result>(deps.store, {
      rawCommand: command,
      expand: () => ({ ...command, schema: "orca-authority-command-v1", payload: {
        groupId: command.payload.groupId, repoId: command.payload.repoId, idea: command.payload.idea,
        limit: command.payload.limit ?? { ...REQUIREMENT_LIMIT_DEFAULT }, agent: command.payload.agent ?? null, contentLanguage: command.payload.contentLanguage ?? "en",
      } }),
      apply: (context) => {
        const payload = context.effectiveCommand.payload as EffectiveOpenPayload;
        if (!(deps.knownRepository?.(payload.repoId) ?? false)) throw new ControlError("group-project-binding-required");
        if (deps.store.db.prepare("SELECT id FROM groups WHERE id=?").get(payload.groupId)) throw new ControlError("group-already-exists");
        // Issue #73: ccloop's stderr from a failed probe follows its code, as `<code>: <detail>` (web/src/ccloopCodes.ts).
        const probeDetail = slot.observation.probeFailureDetail;
        if (slot.outcome.kind !== "frozen") throw new ControlError("agent-selection-rejected", `estimator:${slot.outcome.code}${probeDetail === undefined ? "" : `: ${probeDetail}`}`);
        const preflight = profile.snapshot.profile.estimatorPreflight;
        if (!preflight) throw new ControlError("control-estimator-unconfigured");
        const compatibility = estimatorCompatibility(slot.observation, estimateMode);
        if (!compatibility.compatible) throw new ControlError("agent-selection-rejected", `estimator:${compatibility.reasonCodes.join(",")}`);
        const requirementId = sha256Canonical({ groupId: payload.groupId, commandId: command.commandId }).slice(0, 32);
        insertClarifyingGroup(deps.store, {
          groupId: payload.groupId, repoId: payload.repoId, idea: payload.idea, limit: payload.limit, contentLanguage: payload.contentLanguage,
          createdOn: now.toISOString().slice(0, 10), requirementId, profile: { profileId: profile.snapshot.profile.profileId, profileHash: profile.profileHash },
          agentSlot: slot.outcome.slot, agentOverrides: payload.agent === null ? {} : { estimator: payload.agent }, maxOutputTokens: singleCallOutputBound(preflight.maxOutputTokens, slot.observation.resolution),
          ...(dirWorkspace === undefined ? {} : { dirWorkspace }),
          ...(multiDir === undefined ? {} : { multiDir }),
        });
        writeRound(deps.store, payload.groupId, newRound(1));
        const wakeId = queueRequirementCall(deps.store, payload.groupId, `open-${context.nextCommandRevision}`);
        return commandSuccess(context, { kind: "requirement-opened", groupId: payload.groupId, requirementId, roundNo: 1, wakeId }, 201);
      },
    }).body;
  } finally { release?.(); }
}

/** Spec §11.1 item 2 (DR10, DR11): every question answered, every proposal decided; the next round only while the frontier is open. */
export function applyRequirementAnswer(deps: RequirementCommandDeps, command: RequirementAnswerCommand): Result {
  return admitted(deps, () => applyWebCommand<Result>(deps.store, {
    rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    apply: (context) => {
      const id = command.target.groupId, payload = command.payload;
      notStopped(deps.store, clarifying(deps.store, id));
      // After consensus the latest round is never awaiting answers (consensus closes it), so this check also refuses that.
      const round = latestRound(deps.store, id);
      if (round === null || round.roundNo !== payload.roundNo || round.state !== "awaiting-answers" || round.result === null) return invalid("round-not-awaiting-answers");
      const result = round.result;
      if (!sameIds(payload.answers.map((a) => a.id), result.questions.map((q) => q.id))) invalid("answers");
      if (!sameIds(payload.glossaryDecisions.map((d) => d.id), result.glossary.map((e) => e.id))) invalid("glossary-decisions");
      if (!sameIds(payload.adrDecisions.map((d) => d.id), result.adrs.map((a) => a.id))) invalid("adr-decisions");
      const given = new Map(payload.answers.map((a) => [a.id, a]));
      const answers = result.questions.map((q) => {
        const a = given.get(q.id)!;
        return { id: q.id, kind: a.kind, text: a.kind === "text" ? a.text : q.recommendedAnswer };
      });
      writeRound(deps.store, id, { ...round, state: "answered", answers, glossaryDecisions: payload.glossaryDecisions, adrDecisions: payload.adrDecisions, answeredAt: nowOf(deps).toISOString() });
      // Clarify caps spec §3.3: at the round cap clarification stops as at an empty frontier; requirement-clarify-more grants one more.
      // Flow engine spec §10.3: the cap counts chain positions, not round numbers (a revision appends a higher number).
      const chainLength = activeChain(readRounds(deps.store, id)).chain.length;
      if (result.frontierEmpty || chainLength >= clarifyLimits(deps.store, readRequirementGroup(deps.store, id)).roundCap) {
        return commandSuccess(context, { kind: "requirement-answered", roundNo: round.roundNo, nextRoundNo: null, wakeId: null });
      }
      writeRound(deps.store, id, newRound(round.roundNo + 1));
      const wakeId = queueRequirementCall(deps.store, id, `answer-${context.nextCommandRevision}`);
      return commandSuccess(context, { kind: "requirement-answered", roundNo: round.roundNo, nextRoundNo: round.roundNo + 1, wakeId });
    },
  }).body);
}

/** Clarify caps spec §3.3: clarification has stopped (no consensus; the latest round answered, not closed by consensus). The person grants exactly one more round. */
export function applyRequirementClarifyMore(deps: RequirementCommandDeps, command: RequirementClarifyMoreCommand): Result {
  return admitted(deps, () => applyWebCommand<Result>(deps.store, {
    rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    apply: (context) => {
      const id = command.target.groupId, group = clarifying(deps.store, id);
      notStopped(deps.store, group);
      if (group.requirement.consensus !== null) invalid("consensus-reached");
      const round = latestRound(deps.store, id);
      if (round === null || round.roundNo !== command.payload.roundNo || round.state !== "answered" || round.closedByConsensus) return invalid("round-not-stopped");
      const nextRoundNo = round.roundNo + 1;
      // §10.3: the grant is a chain length (the cap compares chain positions), one past the current chain.
      group.requirement.roundsGranted = activeChain(readRounds(deps.store, id)).chain.length + 1;
      saveRequirementGroup(deps.store, group);
      writeRound(deps.store, id, newRound(nextRoundNo));
      const wakeId = queueRequirementCall(deps.store, id, `clarify-more-${context.nextCommandRevision}`);
      return commandSuccess(context, { kind: "requirement-clarify-more", roundNo: round.roundNo, nextRoundNo, wakeId });
    },
  }).body);
}

/**
 * Flow engine spec §10.3 (Issue #76, W-76): revise an answered round on the active chain. Round k is never changed: row
 * n+1 is appended `{revises: k}` with round k's result and the new answers; a reached consensus is withdrawn and a draft
 * awaiting review (or queued) is closed `rejected` (`requirement-revised`); below the cap one clarify call drafts the
 * next round on the chain, carrying the superseded rounds' answers unless excluded (requirementCalls.ts).
 */
export function applyRequirementRevise(deps: RequirementCommandDeps, command: RequirementReviseCommand): Result {
  return admitted(deps, () => applyWebCommand<Result>(deps.store, {
    rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    apply: (context) => {
      const id = command.target.groupId, payload = command.payload;
      const group = readRequirementGroup(deps.store, id);
      if (group.requirement.acceptedDraftNo !== null) throw new ControlError("requirement-already-accepted");
      if (group.status !== "clarifying") invalid("not-clarifying");
      notStopped(deps.store, group);
      // The requirement host keeps one clarify step execution; another step's rounds belong to the flow host (Task 8).
      if ((payload.stepKey ?? "clarify") !== "clarify" || (payload.execSeq ?? 1) !== 1) invalid("step-execution");
      if (deps.store.db.prepare("SELECT id FROM runs WHERE group_id=? AND active=1").get(id)) invalid("call-in-flight");
      const rounds = readRounds(deps.store, id);
      const now = nowOf(deps).toISOString();
      const routed = routedAttributionFor(command.commandId);
      const by = routed?.by ?? command.actorId;
      // Shared with the flow host (clarifyChain.ts): the checks, in order, and the appended row.
      const revision = reviseRound(rounds, payload, { at: now, by, ...(routed === null ? {} : { via: routed.via }) });
      if ("refusal" in revision) {
        if (revision.refusal === "revision-unchanged") throw new ControlError("revision-unchanged");
        return invalid(revision.refusal);
      }
      const { revised: round, row, chainBefore: chain, newChainLength } = revision;
      const result = round.result!;
      const revisionNo = row.roundNo;
      writeRound(deps.store, id, row);
      // A later round on the chain whose call is queued but not claimed drafts nothing now: it is superseded.
      for (const later of rounds.filter((r) => chain.slice(chain.indexOf(round.roundNo) + 1).includes(r.roundNo) && r.state === "drafting")) {
        writeRound(deps.store, id, { ...later, state: "interrupted", waiting: null });
      }
      // Re-advance: the consensus (if any) is withdrawn and the draft that followed it no longer follows the requirement.
      const consensusWithdrawn = group.requirement.consensus !== null;
      if (consensusWithdrawn) {
        group.requirement = { ...group.requirement, consensus: null, consensusWithdrawn: { at: now, by, revisedRound: round.roundNo } };
        saveRequirementGroup(deps.store, group);
      }
      const draft = latestDraft(deps.store, id);
      if (draft !== null && (draft.state === "awaiting-review" || draft.state === "drafting")) {
        writeDraft(deps.store, id, { ...draft, state: "rejected", waiting: null, reasonCode: "requirement-revised" });
      }
      if (result.frontierEmpty || newChainLength >= clarifyLimits(deps.store, readRequirementGroup(deps.store, id)).roundCap) {
        return commandSuccess(context, { kind: "requirement-revised", roundNo: revisionNo, revises: round.roundNo, consensusWithdrawn, nextRoundNo: null, wakeId: null });
      }
      writeRound(deps.store, id, newRound(revisionNo + 1));
      const wakeId = queueRequirementCall(deps.store, id, `revise-${context.nextCommandRevision}`);
      return commandSuccess(context, { kind: "requirement-revised", roundNo: revisionNo, revises: round.roundNo, consensusWithdrawn, nextRoundNo: revisionNo + 1, wakeId });
    },
  }).body);
}

/** Clarify caps spec §3.1: the person's class, kept beside the model's (round 1's result keeps the model's as written). */
export function applyRequirementClassify(deps: RequirementCommandDeps, command: RequirementClassifyCommand): Result {
  return admitted(deps, () => applyWebCommand<Result>(deps.store, {
    rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    apply: (context) => {
      const id = command.target.groupId, group = clarifying(deps.store, id);
      if (group.requirement.consensus !== null) invalid("consensus-reached");
      const { scope, clarity } = command.payload;
      const current = group.requirement.classOverride;
      if (current !== undefined && current.scope === scope && current.clarity === clarity) throw new ControlError("no-op-command");
      group.requirement.classOverride = { scope, clarity };
      saveRequirementGroup(deps.store, group);
      return commandSuccess(context, { kind: "requirement-classified", scope, clarity });
    },
  }).body);
}

const CONSENSUS_ROUND_STATES: readonly string[] = ["answered", "awaiting-answers", "failed", "interrupted"];

/** Spec §11.1 item 3 (DR10): the person agrees; open branches and unanswered questions go into the document. Draft 1 is queued. */
export function applyRequirementConsensus(deps: RequirementCommandDeps, command: RequirementConsensusCommand): Result {
  return admitted(deps, () => applyWebCommand<Result>(deps.store, {
    rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    apply: (context) => {
      const id = command.target.groupId, group = clarifying(deps.store, id);
      notStopped(deps.store, group);
      if (group.requirement.consensus !== null) invalid("consensus-reached");
      const round = latestRound(deps.store, id);
      if (round === null || round.roundNo !== command.payload.roundNo || !CONSENSUS_ROUND_STATES.includes(round.state)) return invalid("round-state");
      // Invariant guarded (unreachable by design, kept as a guard): a round in CONSENSUS_ROUND_STATES has no active run --
      // a round's call is claimed only while it is drafting (pendingRequirementCall), and every way out of drafting
      // (settlement, interruption) closes the run in the same transaction. Should that ever stop holding, consensus must not start a draft
      // beside a call still in flight, so this refuses rather than trusting the round state.
      if (deps.store.db.prepare("SELECT id FROM runs WHERE group_id=? AND active=1").get(id)) invalid("call-in-flight");
      const understood = chainRounds(readRounds(deps.store, id)).filter((r) => r.result !== null);
      if (understood.length === 0) invalid("no-understanding-yet");
      const now = nowOf(deps).toISOString();
      let openQuestions: string[] = [];
      if (round.state === "awaiting-answers") {
        openQuestions = round.result!.questions.map((q) => q.id);
        writeRound(deps.store, id, { ...round, state: "answered", closedByConsensus: true, answers: [], glossaryDecisions: [], adrDecisions: [], answeredAt: now });
      }
      // Flow engine spec §10.1: what consensus does is the requirement host's (draft 1 and its split call, unchanged).
      const wakeId = requirementHost(deps.store, group).onConsensus({ roundNo: round.roundNo, at: now, openBranches: understood.at(-1)!.result!.openBranches, openQuestions, tag: `consensus-${context.nextCommandRevision}` })!;
      return commandSuccess(context, { kind: "requirement-consensus", roundNo: round.roundNo, draftNo: 1, wakeId });
    },
  }).body);
}

/** Spec §11.1 item 4 (DR9): the person sends a draft back in their own words; the next draft starts a fresh retry count. */
export function applyRequirementDraftFeedback(deps: RequirementCommandDeps, command: RequirementDraftFeedbackCommand): Result {
  return admitted(deps, () => applyWebCommand<Result>(deps.store, {
    rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    apply: (context) => {
      const id = command.target.groupId;
      notStopped(deps.store, clarifying(deps.store, id));
      const draft = latestDraft(deps.store, id);
      if (draft === null || draft.draftNo !== command.payload.draftNo || draft.state !== "awaiting-review") return invalid("draft-not-awaiting-review");
      writeDraft(deps.store, id, { ...draft, state: "rejected", feedback: command.payload.feedback });
      writeDraft(deps.store, id, newDraft(draft.draftNo + 1, 0));
      const wakeId = queueRequirementCall(deps.store, id, `feedback-${context.nextCommandRevision}`);
      return commandSuccess(context, { kind: "requirement-draft-rejected", draftNo: draft.draftNo, nextDraftNo: draft.draftNo + 1, wakeId });
    },
  }).body);
}

/**
 * N1 spec §9.1: one transaction -- freeze the document, import the stored plan into this group (clarifying -> draft),
 * carry the clarifying spend over, record each work item's traces, and queue the export. The estimator slot is
 * resolved before it, under the admission gate, as requirement-open resolves its own.
 */
export async function applyRequirementDraftAccept(
  deps: AsyncImportDeps & { admissionGate?: AdmissionGate; now?: () => Date },
  command: RequirementDraftAcceptCommand,
): Promise<Result> {
  const release = deps.admissionGate?.enter();
  try {
    const replay = preflightWebCommand<Result>(deps.store, command);
    if (replay) return replay.body;
    const id = command.target.groupId;
    let defaults: ImportDefaults, profile: FrozenProfile, slot: PreparedEstimatorSlot;
    try {
      const configured = deps.defaults();
      if (!configured?.estimatorProfileId || !configured.estimatorProfileHash) throw new ControlError("control-estimator-unconfigured");
      defaults = configured;
      profile = deps.profileRouter.resolve("budget-estimate", configured.estimatorProfileId, configured.estimatorProfileHash);
      const draft = readDraft(deps.store, id, command.payload.draftNo);
      const stored = draft.plan as { targetRepo: string } | null;
      const planAgent = stored === null ? undefined : schedulerControlPlanSourceOf(stored, stored.targetRepo).agent;
      slot = await estimatorSlotFor({ store: deps.store, profileRouter: deps.profileRouter }, command.actorId, readGroupAgentOverrides(readRequirementGroup(deps.store, id)), profile, planAgent);
    } catch (error) {
      return applyWebCommand<Result>(deps.store, { rawCommand: command, expand: () => { throw error; }, apply: () => { throw error; } }).body;
    }
    const now = nowOf(deps);
    return applyWebCommand<Result>(deps.store, {
      rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
      apply: (context) => {
        const group = clarifying(deps.store, id);
        // Controller ruling (b): a stopped group, or one with a stop still open, is not imported (as continuation.ts refuses).
        if (group.stopped || readStopIntent(deps.store, id) !== null) throw new ControlError("group-stopped");
        // Controller ruling (a): the carried `used` must be exact; unknown usage is refused as the Web ledger refuses it.
        if (group.ledger.usageUnknown) throw new ControlError("recovery-blocked", "requirement-usage-unknown");
        const draft = readDraft(deps.store, id, command.payload.draftNo);
        // plan/output are always set on a draft awaiting review (recordSplit); those two conditions only narrow the types.
        if (draft.state !== "awaiting-review" || draft.plan === null || draft.output === null) return invalid("draft-not-awaiting-review");
        // DR12: the hash names the expanded plan the person reviewed. It is checked against the bytes imported below (the
        // stored expansion, never a re-derivation), so a stored hash that no longer names those bytes is refused too.
        if (sha256Canonical(draft.plan) !== command.payload.draftHash) throw new ControlError("plan-version-conflict", "draft-hash");
        if (deps.store.db.prepare("SELECT id FROM runs WHERE group_id=? AND active=1").get(id) || dimensions.some((d) => group.reserved[d] !== 0)) invalid("call-in-flight");
        // 1. Freeze the document: rendered from the records now, stored once, named by its hash (spec §4.3, §10).
        const text = renderRequirementDocument({ groupId: id, requirement: group.requirement, rounds: chainRounds(readRounds(deps.store, id)), acceptedSplit: draft.output });
        const record = { schema: "orca-requirement-document-v1", text }, recordHash = sha256Canonical(record);
        writeCanonicalRecord(deps.store, id, recordHash, canonicalBytes(record).toString("utf8"));
        const documentSha256 = createHash("sha256").update(text, "utf8").digest("hex");
        // DR21: the export commit is dated at the freeze; Task 11's export reads `frozenAt`.
        group.requirement = { ...group.requirement, acceptedDraftNo: draft.draftNo, document: { sha256: documentSha256, recordHash, frozenAt: now.toISOString() },
          export: { state: "pending", path: null, commit: null, parent: null, detail: null } };
        // 2. Import the stored plan into this group (spec §9.1: a stored plan instead of an allowlisted file; DR23 planId).
        const stored = draft.plan as unknown as SplitPlanFile;
        const planId = `requirement-draft-${draft.draftNo}`;
        const source = schedulerControlPlanSourceOf(stored, stored.targetRepo);
        // Multi-directory projects spec §6.4: the frozen contracts are re-expanded here, with every member's path resolved
        // now, so the archived contracts name the directories' current targets and the ccloop primary's repoKey. The
        // model's split is the source (`writes`); a resolver-less accept cannot name those targets.
        const multi = multiDirOf(group);
        const keys = multi === null ? [] : multi.dirs.map((member) => member.key);
        const paths = new Map<string, string>();
        if (multi !== null) {
          if (deps.resolveRepository === undefined) throw new ControlError("control-target-not-allowed");
          for (const member of multi.dirs) paths.set(member.key, deps.resolveRepository(dirTargetRepoId(deps.store, id, member.key)));
        }
        const expanded = multi === null ? null : expandMultiSplitDraft(draft.output as MultiSplitOutput, {
          targetRepo: [...paths.values()][0]!, ccloopBin: stored.ccloopBin, runsDir: stored.runsDir, groupId: id,
          statement: source.goal, successConditions: source.successConditions,
          dirs: [...paths].map(([key, path]) => ({ key, path })),
        });
        const tasks = expanded === null ? source.tasks : source.tasks.map((task) => {
          const contract = expanded.contracts.get(task.taskId);
          if (contract === undefined) throw new ControlError("recovery-blocked", `multi-dir-contract:${task.taskId}`);
          return { ...task, originalContract: contract, originalContractCanonicalJson: canonicalBytes(contract).toString("utf8"), originalContractHash: sha256Canonical(contract) };
        });
        // Multi-directory projects spec §6.4: delivery is the multi landing, so the group gets no integration record.
        const plan = normalizeControlPlan({ ...source, tasks, repoId: group.requirement.repoId, planId });
        const importDeps: ImportDeps = { ...deps, defaults: () => defaults, estimatorSlot: slot.outcome, estimatorLayerAuthority: slot.layerAuthority,
          estimatorObservation: (selected) => { if (selected !== profile) throw new ControlError("profile-changed"); return slot.observation; } };
        const writes = multi === null ? undefined : Object.fromEntries((draft.output as MultiSplitOutput).tasks.map((task) => [task.taskId,
          orderWrites(task.writes, keys).map((write) => ({ dir: write.dir, targetPaths: [...write.targetPaths], checks: [...write.checks] }))]));
        const { estimateId, preflight } = writeImportedPlan(importDeps, { groupId: id, repoId: group.requirement.repoId, planId, plan, actorId: command.actorId, commandId: command.commandId, at: now.getTime(),
          estimatorProfileId: defaults.estimatorProfileId, estimatorProfileHash: defaults.estimatorProfileHash, estimateMode: defaults.estimateMode,
          ...(multi === null ? {} : { integration: null }) },
          { existingBody: { ...group }, used: group.used, usageUnknown: group.ledger.usageUnknown, traces: Object.fromEntries(draft.output.tasks.map((task) => [task.taskId, task.traces])),
            ...(writes === undefined ? {} : { writes }) });
        // Tester round 2 spec §6.2.1 (ruling H3): the agent the person picked on New requirement (the estimator override)
        // becomes the group's worker default -- an ordinary panel layer, still editable -- unless a worker override exists
        // or the accepted plan names a group agent (the panel layer would mask it). Seeded after the import, whose
        // estimator slot was resolved (and is checked) against the layers as they were; requirements opened before this
        // change get it too.
        const overrides = readGroupAgentOverrides(group);
        if (overrides.estimator !== undefined && overrides.worker === undefined && plan.agent?.agent === undefined) {
          const imported = JSON.parse(String(deps.store.db.prepare("SELECT body FROM groups WHERE id=?").get(id)!.body)) as Record<string, unknown>;
          imported.agentOverrides = { ...readGroupAgentOverrides(imported), worker: overrides.estimator };
          deps.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(imported), id);
        }
        writeDraft(deps.store, id, { ...draft, state: "accepted" });
        // 3. The export has git side effects, so the driver performs it (DR14).
        const exportWakeId = `scheduler-wake:${id}:requirement-export`;
        deps.store.db.prepare("INSERT INTO scheduler_wakes(id,group_id,kind,body,delivered) VALUES (?,?,'requirement-export',?,0) ON CONFLICT(id) DO NOTHING")
          .run(exportWakeId, id, canonicalBytes({ groupId: id }).toString("utf8"));
        deps.beforeCommit?.();
        return commandSuccess(context, { kind: "requirement-draft-accepted", draftNo: draft.draftNo, estimateId, estimateState: preflight.state, documentSha256, exportWakeId });
      },
    }).body;
  } finally { release?.(); }
}
