import { join } from "node:path";
import { attributionText, routedAttributionFor } from "./commandClient.js";
import { ZodError } from "zod";
import { closeExistingCorrection, closeStoredCorrection, refuseChoseInsteadConflict, requireGitRoot, type ClosingRows } from "../corrections/correct.js";
import { deriveCoarseRows, derivePendingRows } from "../corrections/derive.js";
import { correctionTargetOf, describeCorrectionTarget } from "../corrections/target.js";
import { readOriginalDecision } from "../corrections/originalDecision.js";
import { correctionRowFrom, recordNewCorrection } from "../corrections/record.js";
import { CorrectRejection } from "../corrections/rejection.js";
import { namesDecision, type Correction } from "../corrections/schema.js";
import { readCorrections } from "../corrections/store.js";
import { readWithdrawals, withdrawCorrection, withdrawnIds } from "../corrections/withdrawals.js";
import { applyWebCommand, preflightWebCommand, type WebCommandContext } from "./commandLedger.js";
import { debugGroupIds, debugGroupLive, repositoryOf, type WithdrawnDebugGroup } from "./debugGroup.js";
import { ControlError, durableCommandErrorStatus, type KnownControlErrorCode } from "./errors.js";
import { readPendingDecision } from "./pendingDecisions.js";
import { readRun } from "./budget.js";
import type { ControlStore } from "./store.js";
import type { WebCommandResult, WebServiceDeps } from "./webService.js";
import type { CommandSuccessV1, RawAuthorityCommandV1 } from "./webProtocol.js";

/**
 * Debug task plan Task 11 (design §12.4): recording, closing and withdrawing a correction are the human's acts, so the
 * three are human-only verbs (VERB_ACCESS) on the `@corrections` scope, whose revision is always 0. Everything is done
 * before the transaction (the corrections store and git are not the control DB); the transaction books the outcome, so a
 * replay answers it without writing again. `by` is the panel's resolved identity (cross-plan resolution 1), never the
 * command's actorId, which the command row keeps.
 */
export type CorrectionRecordCommand = Extract<RawAuthorityCommandV1, { verb: "correction-record" }>;
export type CorrectionCloseCommand = Extract<RawAuthorityCommandV1, { verb: "correction-close" }>;
export type CorrectionWithdrawCommand = Extract<RawAuthorityCommandV1, { verb: "correction-withdraw" }>;

/**
 * What only the panel knows, handed to the control service by the panel (server.ts → controlAssembly.ts): the project key
 * `/api/corrections` records under, its clock, and its review marks. The panel routes call the same functions
 * (src/panel/api.ts panelCorrections), so a correction recorded or withdrawn either way leaves the same rows.
 */
export interface PanelCorrections {
  /** The panel's project key of a configured repository (`--repo` key or registry slug); null when it holds none. */
  projectKeyOf(repoId: string): string | null;
  now(): Date;
  /**
   * POST /api/corrections/withdraw's precondition, one function for the route and the verb (decisions review withdraw
   * spec §5.2): the correction's decision must be one the panel's discovery lists, and then the ids that same scan sees
   * closed (an `overturned` row in a discovered ledger names them). The closed set is only sound for a listed decision.
   */
  withdrawPrecondition(correctionId: string): Promise<{ kind: "not-listed"; projectKey: string; decisionId: string } | { kind: "ok"; closed: ReadonlySet<string> }>;
  /** POST /api/corrections's `reviewed` mark, written after the correction (decisions review withdraw §5.4 rests on it). */
  markReviewed(row: { projectKey: string; decisionId: string; by: string }): Promise<void>;
  /** POST /api/corrections/withdraw's §5.4 step: the review goes with the correction unless another open one of `by`'s remains. */
  withdrawReview(row: { projectKey: string; decisionId: string; by: string }, closed: ReadonlySet<string>): Promise<"written" | "duplicate" | "skipped">;
}

type CorrectionResult = Extract<CommandSuccessV1["result"], { kind: "correction-recorded" | "correction-closed" | "correction-withdrawn" }>;
type Command = CorrectionRecordCommand | CorrectionCloseCommand | CorrectionWithdrawCommand;

/** A CorrectRejection keeps its own code (each one is booked in errors.ts); anything else is not a refusal and escapes. */
function asControlError(error: unknown): unknown {
  if (error instanceof CorrectRejection && durableCommandErrorStatus(error.code) !== null) {
    return new ControlError(error.code as KnownControlErrorCode, error.message);
  }
  // The ledger writer refuses a line with a plain Error (src/ledger/writer.ts) whose message starts "refusing to append"
  // in every refusal it makes; it exports no code, and giving it one would touch every throw there, so the prefix is
  // matched. An undo.how the tier-0 gate refuses is the human's to fix, not a 500.
  if (error instanceof Error && !(error instanceof ControlError) && error.message.startsWith("refusing to append")) {
    return new ControlError("closing-row-refused", error.message);
  }
  return error;
}

const codeOf = (error: unknown): string =>
  error instanceof CorrectRejection || error instanceof ControlError ? error.code
    : typeof (error as { code?: unknown })?.code === "string" ? String((error as { code: string }).code) : "panel-internal-error";

function success(context: WebCommandContext, result: CorrectionResult): { status: number; body: CommandSuccessV1 } {
  return { status: 200, body: {
    schema: "orca-command-success-v1", commandId: context.rawCommand.commandId, actorId: context.rawCommand.actorId,
    verb: context.rawCommand.verb, target: context.rawCommand.target,
    // The scope has no revision and no projection (commandLedger.ts settingRevision).
    commandRevision: context.currentCommandRevision, projectionSeq: null,
    effectivePayloadHash: context.effectivePayloadHash, authorityCommandHash: context.authorityCommandHash, result,
  } };
}

/** A replay or a stale revision answers before anything is written; otherwise `prepare` runs and its outcome is booked. */
async function run(store: ControlStore, command: Command, prepare: () => Promise<CorrectionResult>): Promise<WebCommandResult> {
  const replay = preflightWebCommand<WebCommandResult>(store, command); if (replay) return replay.body;
  let result: CorrectionResult;
  try { result = await prepare(); }
  catch (failure) {
    const error = asControlError(failure);
    return applyWebCommand<WebCommandResult>(store, { rawCommand: command, expand: () => { throw error; }, apply: () => { throw error; } }).body;
  }
  return applyWebCommand<WebCommandResult>(store, {
    rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }), authorityChanged: false,
    apply: (context) => success(context, result),
  }).body;
}

function configured(deps: WebServiceDeps): { dir: string; by: string; panel: PanelCorrections } {
  const { correctionsDir: dir, correctionsBy: by, panelCorrections: panel } = deps;
  if (dir === undefined || by === undefined || panel === undefined) throw new ControlError("corrections-store-unconfigured");
  return { dir, by, panel };
}

/** As correctionState.ts: a store line that does not parse refuses by name. */
async function readCorrectionsOrRefuse(dir: string): Promise<Correction[]> {
  try { return await readCorrections(dir); }
  catch (error) {
    if (error instanceof SyntaxError || error instanceof ZodError) throw new ControlError("corrections-store-unreadable", error instanceof ZodError ? error.issues[0]?.message ?? "row invalid" : error.message);
    throw error;
  }
}

/**
 * `/api/corrections` as a verb: the same row (correctionRowFrom, the panel's key, clock and identity), then the same
 * `reviewed` mark. The panel route checks the decision against its discovery; here the repository's ledger answers, as
 * `orca dev correct`'s close-new reads it (original-decision-not-found), so no junk row is recorded against a typo.
 */
export function applyCorrectionRecord(deps: WebServiceDeps, command: CorrectionRecordCommand): Promise<WebCommandResult> {
  return run(deps.store, command, async () => {
    const { dir, by, panel } = configured(deps);
    const { repoId, decisionId, runId, kind, because, chose_instead, again } = command.payload;
    const projectKey = panel.projectKeyOf(repoId);
    const repository = (deps.listRepositories?.() ?? []).find((candidate) => candidate.repoId === repoId);
    if (projectKey === null || repository === undefined) throw new ControlError("correction-repository-unknown", repoId);
    // Flow engine spec §13.3: a bare-run target must be a run this control store holds (readRun refuses run-not-found).
    // A repository-only one names nothing further to check.
    if (decisionId !== undefined && runId === undefined) await readOriginalDecision(join(repository.path, ".decisions"), decisionId);
    if (runId !== undefined) readRun(deps.store, runId);
    // recordNewCorrection reads the store too; a line that does not parse is refused by name, not a 500.
    await readCorrectionsOrRefuse(dir);
    // CLI v2 spec §16: the routed person and channel; a call that skips the routes records the panel's identity, as before.
    const routed = routedAttributionFor(command.commandId);
    const stored = await recordNewCorrection(dir, correctionRowFrom({
      projectKey, decisionId, runId, kind, ...(chose_instead === undefined ? {} : { chose_instead }), because, by: routed?.by ?? by,
      ...(routed === null ? {} : { via: routed.via }),
    }, () => panel.now()), { again: again === true });
    // As the panel route (its ruling J6): a refused correction never reaches this line; a failed mark is answered beside
    // the recorded correction, never as if nothing was written. Only a decision is reviewed (the reviews file is keyed by it).
    if (decisionId !== undefined) {
      try { await panel.markReviewed({ projectKey, decisionId, by }); }
      catch (error) { throw new ControlError("correction-recorded-unreviewed", `${stored.id}:reviewed-mark:${codeOf(error)}`); }
    }
    return { kind: "correction-recorded", correctionId: stored.id };
  });
}

/**
 * Cross-plan resolution 2: a pending-target correction is closed by hand here (not by the CLI) with ONE `decision` row,
 * design §12.3's, written from the refused entry in the control store with the human's undo; no `overturned` row, since
 * no ledger row exists to overturn.
 */
function pendingClosing(store: ControlStore, row: Correction, choseInstead: string | undefined, undo: { how: string; cost?: string; blastRadius?: string }, attributed?: string): ClosingRows {
  refuseChoseInsteadConflict(row, choseInstead);
  const target = correctionTargetOf(row);
  // Flow engine spec §13.4 (W-COR): a repository-only or bare-run correction closes the same way, one decision row and
  // no overturned; closed by hand, no located decision is cited.
  if (target.kind === "run" || target.kind === "repository") {
    return {
      message: `ledger: close ${row.id} after ${row.by}'s correction of ${describeCorrectionTarget(row)}`,
      rows: (chose, at, runId) => [deriveCoarseRows({ correction: row, choseInstead: chose, undo, at, runId, authored: undefined, located: null, ...(attributed === undefined ? {} : { attributed }) }).decision],
    };
  }
  const pending = readPendingDecision(store, row.pendingId!);
  if (pending === null) throw new ControlError("original-pending-decision-not-found", row.pendingId);
  return {
    message: `ledger: close ${row.pendingId} after ${row.by}'s correction ${row.id}`,
    rows: (chose, at, runId) => [derivePendingRows({ correction: row, pending: pending.entry, choseInstead: chose, undo, at, runId, authored: undefined, ...(attributed === undefined ? {} : { attributed }) }).decision],
  };
}

/**
 * The UI's manual close: `orca dev correct --close` (closeExistingCorrection, the same guards in the same order) in the
 * repository the correction's projectKey names, committed on its current branch. Refused debug-group-active while any
 * debug group of the correction is live (design §12.1; a draft counts): two closings would land two closing rows.
 */
export function applyCorrectionClose(deps: WebServiceDeps, command: CorrectionCloseCommand): Promise<WebCommandResult> {
  return run(deps.store, command, async () => {
    const dir = deps.correctionsDir;
    if (dir === undefined) throw new ControlError("corrections-store-unconfigured");
    const { correctionId, choseInstead, undoHow, undoCost, undoBlastRadius } = command.payload;
    const correction = (await readCorrectionsOrRefuse(dir)).find((row) => row.id === correctionId);
    if (correction === undefined) throw new ControlError("correction-not-found");
    const repository = await repositoryOf({ listRepositories: deps.listRepositories ?? (() => []), repoIdOfProjectKey: deps.repoIdOfProjectKey }, correction.projectKey);
    if (repository === null) throw new ControlError("correction-repository-unknown", correction.projectKey);
    // A withdrawn correction is refused as withdrawn even while a started debug group of it is still live: that is the
    // truer answer (closeStoredCorrection checks it again under the lock).
    if (withdrawnIds(await readWithdrawals(dir)).has(correctionId)) throw new ControlError("correction-withdrawn");
    // Accepted window (as prepareRejection's, decisionCommands.ts): a debug group opened between this read and the
    // commit below is not seen; and two concurrent closes under one command id both prepare, the repo lock and
    // alreadyCommitted keep them to one landing, and the ledger books the first answer.
    const live = debugGroupIds(deps.store, correctionId).filter((groupId) => debugGroupLive(deps.store, groupId));
    if (live.length > 0) throw new ControlError("debug-group-active", live.join(","));
    await requireGitRoot(repository.path);
    const undo = { how: undoHow, ...(undoCost === undefined ? {} : { cost: undoCost }), ...(undoBlastRadius === undefined ? {} : { blastRadius: undoBlastRadius }) };
    // CLI v2 spec §16 (review I3): the routed person and channel on the closing row; a call that skips the routes writes
    // the rows as before (no line), as correction-record keeps a row without `via`.
    const routed = routedAttributionFor(command.commandId);
    const attributed = routed === null ? undefined : `closed ${attributionText(routed)} correction-close ${command.commandId}`;
    const input = { repo: repository.path, correctionId, choseInstead, undo, dir, ...(attributed === undefined ? {} : { attributed }) };
    const closed = namesDecision(correction)
      ? await closeExistingCorrection(input)
      : await closeStoredCorrection(input, async (row) => pendingClosing(deps.store, row, choseInstead, undo, attributed));
    return { kind: "correction-closed", correctionId, relPath: closed.relPath, alreadyClosed: closed.alreadyClosed };
  });
}

export type ArchiveDebugGroups = (correctionId: string) => { debugGroups: WithdrawnDebugGroup[]; failure: { groupId: string | null; code: string; message: string } | null };

/**
 * Withdraw Amendment 7: the author's withdraw as a verb, in POST /api/corrections/withdraw's order: withdrawCorrection
 * (the same store function), then each unstarted live debug group archived (Amendment 2, here where the control store
 * is at hand), then the review taken with it (§5.4). The membership guard and closed-ness are the panel route's own
 * (panel.withdrawPrecondition), taken before the store lock as the route takes them. A step after the withdrawal that fails is answered beside it, never as
 * nothing written.
 */
export function applyCorrectionWithdraw(deps: WebServiceDeps, command: CorrectionWithdrawCommand, archive: ArchiveDebugGroups): Promise<WebCommandResult> {
  return run(deps.store, command, async () => {
    const { dir, by, panel } = configured(deps);
    // The helper reads the store too; a line that does not parse is refused by name here first.
    await readCorrectionsOrRefuse(dir);
    let precondition: Awaited<ReturnType<PanelCorrections["withdrawPrecondition"]>>;
    // The route answers its scan's gate refusal 409 by name (a MetricsRejection); the verb books it the same way.
    try { precondition = await panel.withdrawPrecondition(command.payload.correctionId); }
    catch (error) {
      if (typeof (error as { code?: unknown })?.code !== "string") throw error;
      throw new ControlError("correction-closed-state-unknown", codeOf(error));
    }
    if (precondition.kind === "not-listed") throw new ControlError("decision-not-found", `${precondition.decisionId} in ${precondition.projectKey}`);
    const { closed } = precondition;
    // CLI v2 spec §16 (controller's call, session b37f7ce9): the requester is the routed person -- the account on the Web,
    // the panel owner on the socket -- and may withdraw a row recorded in their name; the panel owner (`by`) may withdraw any.
    const routed = routedAttributionFor(command.commandId);
    const requester = routed?.by ?? by;
    const { correction } = await withdrawCorrection(dir, { correctionId: command.payload.correctionId, by: requester, owner: by, at: panel.now().toISOString(), isClosed: (c) => closed.has(c.id), ...(routed === null ? {} : { via: routed.via }) });
    let settled: ReturnType<ArchiveDebugGroups>;
    try { settled = archive(correction.id); }
    catch (error) { settled = { debugGroups: [], failure: { groupId: null, code: codeOf(error), message: error instanceof Error ? error.message : String(error) } }; }
    let review: "written" | "duplicate" | "skipped";
    // The review mark is the correction's author's (§5.4), whoever withdrew it.
    try { review = await panel.withdrawReview({ projectKey: correction.projectKey, decisionId: correction.decisionId, by: correction.by }, closed); }
    catch (error) { throw new ControlError("correction-withdrawn-incomplete", `${correction.id}:review-withdrawal:${codeOf(error)}`); }
    if (settled.failure !== null) throw new ControlError("correction-withdrawn-incomplete", `${correction.id}:debug-group-archive:${settled.failure.groupId ?? "(unknown)"}:${settled.failure.code}`);
    return { kind: "correction-withdrawn", correctionId: correction.id, review, debugGroups: settled.debugGroups };
  });
}
