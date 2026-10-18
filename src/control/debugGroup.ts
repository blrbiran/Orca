import { stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { deriveFixRunId } from "../corrections/fields.js";
import { DECISION_NOT_FOUND } from "../corrections/originalDecision.js";
import { projectKeyOf } from "../corrections/projectKey.js";
import { CorrectRejection } from "../corrections/rejection.js";
import type { Correction } from "../corrections/schema.js";
import { readCorrections } from "../corrections/store.js";
import { CORRECTION_WITHDRAWALS_UNREADABLE, readWithdrawals, withdrawnIds } from "../corrections/withdrawals.js";
import type { PartialSelection } from "./agentSelection.js";
import type { ArchiveGroupCommand } from "./archiveGroup.js";
import { isGroupArchived } from "./archivedMark.js";
import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { withCommandContext } from "./commandClient.js";
import { applyWebCommand, preflightWebCommand, type WebCommandContext } from "./commandLedger.js";
import { correctionClosedAtRef } from "./correctionState.js";
import { collectDebugInput, PENDING_DECISION_NOT_FOUND, type DebugInputV1 } from "./debugInput.js";
import { buildDebugPlanSource, DEBUG_TEST_DIRS, debugPlanId } from "./debugPlan.js";
import { ControlError } from "./errors.js";
import { describeError, groupStopped } from "./executionDriver.js";
import { findDecision, integrationTargetRef } from "./ledgerAtRef.js";
import { normalizeControlPlan, writeImportedPlan } from "./planImport.js";
import { readVersions } from "./queries.js";
import { writeCanonicalRecord } from "./snapshot.js";
import type { ControlStore } from "./store.js";
import type { WebCommandResult, WebServiceDeps } from "./webService.js";
import type { CommandSuccessV1, RawAuthorityCommandV1 } from "./webProtocol.js";

/**
 * Debug-task design §4.1, §12.2 / plan Task 6: one recorded correction opens one independent debug group, spending
 * nothing (no estimate row, no wake). The group is `debug-<correctionId>`, then `debug-<correctionId>-2`, … on Reopen;
 * its body carries the debug mark below, so idempotency is a lookup and the panel can label it.
 */
export type CorrectionDebugOpenCommand = Extract<RawAuthorityCommandV1, { verb: "correction-debug-open" }>;

/** Declared here (null at open); Task 9 fills it when the debug run's landing closes the correction. */
export type ClosingRecord = { state: "written"; relPath: string; fixRunId: string } | { state: "refused"; reason: string }
  | { state: "chose-instead-missing" } | { state: "closed-by-human-first"; commit: string };

export interface DebugMark {
  correctionId: string; ordinal: number; inputHash: string; missing: DebugInputV1["missing"];
  agentFallback: { original: PartialSelection; reason: string } | null; undoHow: string | null; closing: ClosingRecord | null;
}

const closingSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("written"), relPath: z.string().min(1), fixRunId: z.string().min(1) }).strict(),
  z.object({ state: z.literal("refused"), reason: z.string().min(1) }).strict(),
  z.object({ state: z.literal("chose-instead-missing") }).strict(),
  z.object({ state: z.literal("closed-by-human-first"), commit: z.string().min(1) }).strict(),
]);
const debugMarkSchema = z.object({
  correctionId: z.string().min(1), ordinal: z.number().int().positive(), inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  missing: z.array(z.enum(["run", "base", "attemptSha", "objects", "contract"])),
  agentFallback: z.object({
    original: z.object({ agent: z.string().optional(), model: z.string().optional(), contextWindow: z.string().optional() }).strict(),
    reason: z.string().min(1),
  }).strict().nullable(),
  undoHow: z.string().min(1).nullable(), closing: closingSchema.nullable(),
}).strict();

/** A group body's debug mark; null on a group no correction opened. A mark that does not parse blocks by name, as the archive mark does. */
export function readDebugMark(group: unknown): DebugMark | null {
  if (typeof group !== "object" || group === null || !Object.hasOwn(group, "debug")) return null;
  const parsed = debugMarkSchema.safeParse((group as { debug: unknown }).debug);
  if (!parsed.success) throw new ControlError("recovery-blocked", "debug-mark-invalid");
  return parsed.data as DebugMark;
}

const baseId = (correctionId: string): string => `debug-${correctionId}`;
const idOf = (correctionId: string, ordinal: number): string => (ordinal === 1 ? baseId(correctionId) : `${baseId(correctionId)}-${ordinal}`);

/** Every debug group of the correction, in ordinal order (the groups whose mark names it). */
export function debugGroupIds(store: ControlStore, correctionId: string): string[] {
  const base = baseId(correctionId), prefix = `${base}-`;
  return store.db.prepare("SELECT id,body FROM groups WHERE id=? OR substr(id,1,?)=?").all(base, prefix.length, prefix)
    .flatMap((row) => {
      const mark = readDebugMark(JSON.parse(String(row.body)));
      return mark !== null && mark.correctionId === correctionId ? [{ id: String(row.id), ordinal: mark.ordinal }] : [];
    })
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((group) => group.id);
}

/** Controller's call 9: a debug group is live unless it is archived or stopped (any stop intent, a pause included). */
export function debugGroupLive(store: ControlStore, groupId: string): boolean {
  return !isGroupArchived(store, groupId) && !groupStopped(store, groupId);
}

/**
 * The route's target (as recovery-retry's resolver, a store read): no debug group yet → `debug-<id>`; otherwise the
 * newest, unless `reopen` asks for the next one and the newest is not live. A reopen while the newest is live targets
 * the newest, which refuses it (debug-group-not-reopenable) in its own scope. The open's transaction asks this again.
 */
export function debugGroupIdFor(store: ControlStore, correctionId: string, reopen: boolean): string {
  const ids = debugGroupIds(store, correctionId);
  const newest = ids.at(-1);
  if (newest === undefined) return baseId(correctionId);
  if (!reopen || debugGroupLive(store, newest)) return newest;
  return idOf(correctionId, ids.length + 1);
}

/** Amendment 2 (withdraw): the correction's live debug groups, each with whether a task run has started in it. */
export function liveDebugGroups(store: ControlStore, correctionId: string): Array<{ groupId: string; started: boolean }> {
  return debugGroupIds(store, correctionId).filter((groupId) => debugGroupLive(store, groupId)).map((groupId) => ({
    groupId,
    // A task's run, not an estimate's (an estimate run has taskId null, singleCallLedger.ts).
    started: store.db.prepare("SELECT 1 FROM runs WHERE group_id=? AND json_extract(body,'$.taskId') IS NOT NULL LIMIT 1").get(groupId) !== undefined,
  }));
}

export type WithdrawnDebugGroup = { groupId: string; state: "archived" | "started: left running" };

/**
 * Withdraw Amendment 2: on a correction's withdrawal (the row is already written), each live debug group that has not
 * started a task run is archived through the archive-group verb, as the panel's operator; a started one is left running
 * and named. The first archive refused stops the walk and is returned, so the route answers it beside the withdrawal.
 */
export function archiveUnstartedDebugGroups(
  deps: { store: ControlStore; service: { archiveGroup(command: ArchiveGroupCommand): WebCommandResult } },
  correctionId: string, actor: { actorId: string; principal: string },
): { debugGroups: WithdrawnDebugGroup[]; failure: { groupId: string; code: string; message: string } | null } {
  const debugGroups: WithdrawnDebugGroup[] = [];
  for (const { groupId, started } of liveDebugGroups(deps.store, correctionId)) {
    if (started) { debugGroups.push({ groupId, state: "started: left running" }); continue; }
    // A correction is withdrawn once, so one command id per correction and group is enough.
    const command: ArchiveGroupCommand = {
      schema: "orca-raw-command-v1", commandId: `withdraw-${correctionId}-archive`, actorId: actor.actorId,
      expectedRevision: readVersions(deps.store, groupId).commandRevision, verb: "archive-group", target: { kind: "group", groupId }, payload: {},
    };
    const outcome = withCommandContext(command.commandId, { client: "web", principal: actor.principal }, () => deps.service.archiveGroup(command));
    if ("error" in outcome) return { debugGroups, failure: { groupId, code: outcome.error.code, message: outcome.error.message } };
    debugGroups.push({ groupId, state: "archived" });
  }
  return { debugGroups, failure: null };
}

export interface DebugOpenDeps extends WebServiceDeps { listRepositories: () => Array<{ repoId: string; path: string }> }

/** Everything read before the transaction: the frozen input, where it came from, and the agent the plan names. */
interface Prepared { input: DebugInputV1; repoId: string; repoPath: string; existingTestDirs: string[]; agent: PartialSelection | undefined; agentFallback: DebugMark["agentFallback"] }

/** Task 3's refusals (CorrectRejection) and the withdrawals reader's, as the durable codes they are booked under. */
function asControlError(error: unknown): unknown {
  if (!(error instanceof CorrectRejection)) return error;
  if (error.code === DECISION_NOT_FOUND) return new ControlError("original-decision-not-found", error.message);
  if (error.code === PENDING_DECISION_NOT_FOUND) return new ControlError("original-pending-decision-not-found", error.message);
  if (error.code === CORRECTION_WITHDRAWALS_UNREADABLE) return new ControlError("correction-withdrawals-unreadable", error.message);
  return error;
}

/** The configured repository whose projectKey is the correction's; one without a keyable remote cannot be it. */
async function repositoryOf(deps: DebugOpenDeps, projectKey: string): Promise<{ repoId: string; path: string } | null> {
  for (const repository of deps.listRepositories()) {
    let key: string;
    try { key = await projectKeyOf(repository.path); }
    catch (error) { if (error instanceof CorrectRejection) continue; throw error; }
    if (key === projectKey) return repository;
  }
  return null;
}

async function existingTestDirs(repoPath: string): Promise<string[]> {
  const found: string[] = [];
  for (const dir of DEBUG_TEST_DIRS) if ((await stat(join(repoPath, dir)).catch(() => null))?.isDirectory()) found.push(dir);
  return found;
}

/** The guard order: store, row, withdrawn, repository, the frozen input, closed, integrated; then the agent. */
async function prepare(deps: DebugOpenDeps, command: CorrectionDebugOpenCommand): Promise<Prepared> {
  // Ruling C5 (Rule 17): no fallback to the environment's store; a service started without it refuses by name.
  const dir = deps.correctionsDir;
  if (dir === undefined) throw new ControlError("corrections-store-unconfigured");
  const { correctionId } = command.payload;
  const correction: Correction | undefined = (await readCorrections(dir)).find((row) => row.id === correctionId);
  if (correction === undefined) throw new ControlError("correction-not-found");
  // Amendment 1: a withdrawn correction is not open work; refused before its input is frozen.
  if (withdrawnIds(await readWithdrawals(dir)).has(correctionId)) throw new ControlError("correction-withdrawn");
  const repository = await repositoryOf(deps, correction.projectKey);
  if (repository === null) throw new ControlError("correction-repository-unknown", correction.projectKey);
  const input = await collectDebugInput({ store: deps.store, repoPath: repository.path }, correction);
  // Ruling C1: closed means the integration target of the original run's group (HEAD without one) holds the closing row.
  const { id: _id, ...row } = correction;
  const ref = (input.originalRun === null ? null : await integrationTargetRef(deps.store, input.originalRun.groupId)) ?? "HEAD";
  if (await correctionClosedAtRef(repository.path, ref, correctionId, deriveFixRunId(row, correctionId))) throw new ControlError("correction-already-closed", ref);
  // Ruling C2: the debug branch starts at HEAD (workspace.ts ensureWorkBranch), so the decision must be in HEAD's
  // ledger; found only in the working tree, on a group branch or on a target HEAD lacks, landing's check 5 would fail
  // after a paid run. A pending target names no ledger line.
  if (input.decision !== null && await findDecision(repository.path, [{ where: "target", ref: "HEAD" }], input.decision.id) === null) {
    throw new ControlError("correction-decision-not-integrated", `${input.decision.id}@${input.decisionWhere}`);
  }
  // Design §4.4: the original claim's agent and model, re-resolved now; a selection ccloop refuses falls back to the
  // operator's layers (no plan layer) and the mark says why.
  let agent: PartialSelection | undefined;
  let agentFallback: DebugMark["agentFallback"] = null;
  if (input.originalRun !== null) {
    const original = { agent: input.originalRun.agent.agent, model: input.originalRun.agent.model };
    try { await deps.port.resolveAgent(original); agent = original; }
    catch (error) { agentFallback = { original, reason: describeError(error) }; }
  }
  return { input, repoId: repository.repoId, repoPath: repository.path, existingTestDirs: await existingTestDirs(repository.path), agent, agentFallback };
}

function success(context: WebCommandContext, groupId: string, correctionId: string, created: boolean): { status: number; body: CommandSuccessV1 } {
  return { status: created ? 201 : 200, body: {
    schema: "orca-command-success-v1", commandId: context.rawCommand.commandId, actorId: context.rawCommand.actorId,
    verb: context.rawCommand.verb, target: context.rawCommand.target,
    // An existing group is returned unchanged: no revision bump and no projection change (authorityChanged below).
    commandRevision: created ? context.nextCommandRevision : context.currentCommandRevision,
    projectionSeq: created ? context.nextProjectionSeq : context.currentProjectionSeq,
    effectivePayloadHash: context.effectivePayloadHash, authorityCommandHash: context.authorityCommandHash,
    result: { kind: "debug-group-opened", groupId, correctionId, created },
  } };
}

/**
 * Every read happens before the transaction (plan Task 6 Step 3); a refusal found there is booked through the
 * `expand: () => { throw error }` pattern (webService.ts createEstimate). Inside it: the target again, then the plan
 * import with no estimate (Task 5), the frozen input as a canonical record, and the mark, in one update.
 */
export async function applyCorrectionDebugOpen(deps: DebugOpenDeps, command: CorrectionDebugOpenCommand): Promise<WebCommandResult> {
  const replay = preflightWebCommand<WebCommandResult>(deps.store, command); if (replay) return replay.body;
  const groupId = command.target.groupId;
  const { correctionId, reopen = false, undoHow } = command.payload;
  let prepared: Prepared;
  try { prepared = await prepare(deps, command); }
  catch (failure) {
    const error = asControlError(failure);
    return applyWebCommand<WebCommandResult>(deps.store, { rawCommand: command, expand: () => { throw error; }, apply: () => { throw error; } }).body;
  }
  return applyWebCommand<WebCommandResult>(deps.store, {
    rawCommand: command,
    expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    authorityChanged: (outcome) => "result" in outcome.body && outcome.body.result.kind === "debug-group-opened" && outcome.body.result.created,
    apply: (context) => {
      // The store may have moved since the route resolved the target (another open, a stop, an archive).
      if (debugGroupIdFor(deps.store, correctionId, reopen) !== groupId) throw new ControlError("plan-version-conflict", "debug-group-target-moved");
      const existing = deps.store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
      if (existing !== undefined) {
        if (readDebugMark(JSON.parse(String(existing.body)))?.correctionId !== correctionId) throw new ControlError("group-already-exists");
        // The resolver targets an existing group on reopen only while it is live.
        if (reopen) throw new ControlError("debug-group-not-reopenable");
        return success(context, groupId, correctionId, false);
      }
      const { input, repoId, repoPath } = prepared;
      const inputJson = canonicalBytes(input).toString("utf8"), inputHash = sha256Canonical(input);
      const planId = debugPlanId(groupId);
      const plan = normalizeControlPlan({ ...buildDebugPlanSource(input, { repoPath, existingTestDirs: prepared.existingTestDirs, agent: prepared.agent }), repoId, planId });
      const defaults = deps.defaults();
      writeImportedPlan({
        ...deps, estimatorSlot: { kind: "rejected", partial: null, code: "control-estimator-unconfigured" },
        estimatorObservation: () => { throw new ControlError("control-estimator-unconfigured"); },
      }, {
        groupId, repoId, planId, plan, actorId: context.rawCommand.actorId, commandId: context.rawCommand.commandId,
        estimatorProfileId: defaults?.estimatorProfileId ?? null, estimatorProfileHash: defaults?.estimatorProfileHash ?? null, estimateMode: defaults?.estimateMode ?? "strict",
      }, null, { estimate: "deferred" });
      writeCanonicalRecord(deps.store, groupId, inputHash, inputJson);
      const mark: DebugMark = {
        correctionId, ordinal: groupId === baseId(correctionId) ? 1 : Number(groupId.slice(baseId(correctionId).length + 1)),
        inputHash, missing: [...input.missing], agentFallback: prepared.agentFallback, undoHow: undoHow ?? null, closing: null,
      };
      const body = JSON.parse(String(deps.store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!.body)) as Record<string, unknown>;
      deps.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify({ ...body, debug: mark }), groupId);
      deps.beforeCommit?.();
      return success(context, groupId, correctionId, true);
    },
  }).body;
}
