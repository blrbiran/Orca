import { randomUUID } from "node:crypto";
import { add, subtract } from "./budget.js";
import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { fits, zero } from "./commands.js";
import { ControlError } from "./errors.js";
import { activeChain, chainRounds, supersededForPrompt } from "./clarifyChain.js";
import { requirementHost } from "./clarifyHost.js";
import { buildClarifyPrompt, CLARIFY_JSON_SCHEMA, classifyClarifyOutput } from "./requirementClarify.js";
import { renderRequirementDocument } from "./requirementDocument.js";
import { buildRepositoryOverview, dividedOverviewLimits, type ProjectOverview, type RepositoryOverview } from "./requirementOverview.js";
import { dirWorkspaceOf, groupRepoId } from "./dirGroup.js";
import { flowVaultRepoId } from "../flow/groups.js";
import { dirTargetRepoId, multiDirOf, type FrozenMultiDir } from "./multiGroup.js";
import { DirFolderMissing, importFolder, openDirWorkspace } from "./dirWorkspace.js";
import {
  clarifyingLedger, clarifyLimits, latestDraft, latestRound, newDraft, queueRequirementCall, readDraft, readDrafts, readRequirementGroup, readRound, readRounds,
  saveRequirementGroup, writeDraft, writeRound, type RequirementGroup,
} from "./requirementRecords.js";
import { MAX_AUTO_RETRIES, multiSplitOutputSchema, REQUIREMENT_CALL_GRANT, splitOutputSchema, type CallRecord, type DraftBody, type RequirementWaiting } from "./requirementSchemas.js";
import {
  buildSplitPrompt, expandMultiSplitDraft, expandSplitDraft, SPLIT_JSON_SCHEMA, SPLIT_JSON_SCHEMA_MULTI, validateMultiSplitDraft, validateSplitDraft,
  type SplitPlanFile,
} from "./requirementSplit.js";
import { assertCallUsageBooked, closeSingleCall, insertSingleCallRun, verifyStoppedSingleCall, type StoppedSingleCallRun } from "./singleCallLedger.js";
import { singleCallClaimRowOf } from "./singleCall.js";
import type { SingleCallHandler, SingleCallPrepareDeps, SingleCallRequest, SingleCallRunRow } from "./singleCallPurposes.js";
import { writeCanonicalRecord } from "./snapshot.js";
import { clearSpendCapBlock, gateClaim } from "./spendCaps.js";
import type { AdmissionGate } from "./admissionGate.js";
import type { ControlStore } from "./store.js";

/** Spec 2026-10-15 ccloop error codes §4.5: ccloop refused before spawning (books 0); the same envelope would be refused again. */
export const PRE_SPAWN_REFUSALS: ReadonlySet<string> = new Set(["omp-single-call-cap-exceeded", "omp-single-call-unavailable"]);

/**
 * N1 spec §5.2, §7 and §8: a requirement's call -- a round's clarify call or a draft's split call --
 * claimed from its durable wake, prepared at A2 with the repository overview, and settled into the clarifying group's
 * own ledger (never releaseRunReserve's legacy branch, survey S28). The claim and settlement plumbing every single call
 * shares lives in singleCallLedger.ts (PR-I4); the ledger mirror is clarifyingLedger's (PR-I5).
 */

export type RequirementTarget = { kind: "round" | "draft"; no: number; workItemId: string; purpose: "clarify" | "split" };
/** A call's overview: a single-repository call names one commit; a multi-directory call one per member key. */
export type RunOverview = { hash: string } & ({ commit: string } | { commits: Record<string, string> });
export interface SettledRun extends StoppedSingleCallRun { overview?: RunOverview | null }

/** DR4: `round-<n>` is a clarify call, `draft-<n>` a split call. */
export function targetOf(workItemId: string): RequirementTarget {
  const match = /^(round|draft)-([1-9]\d*)$/.exec(workItemId);
  if (!match) throw new ControlError("recovery-blocked", `requirement-work-item:${workItemId}`);
  const kind = match[1] as "round" | "draft";
  return { kind, no: Number(match[2]), workItemId, purpose: kind === "round" ? "clarify" : "split" };
}

/** The call a clarifying group is waiting for: the latest round while there is no consensus, else the latest draft. */
export function pendingRequirementCall(store: ControlStore, groupId: string): RequirementTarget | null {
  const group = readRequirementGroup(store, groupId);
  if (group.status !== "clarifying") return null;
  if (group.requirement.consensus === null) {
    const round = latestRound(store, groupId);
    return round?.state === "drafting" ? targetOf(`round-${round.roundNo}`) : null;
  }
  const draft = latestDraft(store, groupId);
  return draft?.state === "drafting" ? targetOf(`draft-${draft.draftNo}`) : null;
}

/** PR-I5: the clarifying ledger mirror after `reserved` moved; usage booking keeps `usageUnknown` (budget.ts). */
function syncLedger(group: RequirementGroup): void {
  group.ledger = clarifyingLedger(group.limit, group.used, group.reserved, group.ledger.usageUnknown);
}

function setWaiting(store: ControlStore, groupId: string, target: RequirementTarget, waiting: RequirementWaiting | null): void {
  if (target.kind === "round") { const round = readRound(store, groupId, target.no); if (round.waiting !== waiting) writeRound(store, groupId, { ...round, waiting }); }
  else { const draft = readDraft(store, groupId, target.no); if (draft.waiting !== waiting) writeDraft(store, groupId, { ...draft, waiting }); }
}

/**
 * A requirement call's contract row is keyed by work item (DR4), so each attempt of a round or draft replaces the
 * previous attempt's; an earlier attempt's run is inactive by then (preflight scan m15) and nothing reads its contract
 * again. Its claim row is keyed by run (singleCallClaimRowOf), so it is never replaced (final review finding 1).
 */
function upsertOutbox(store: ControlStore, id: string, kind: string, body: unknown): void {
  store.db.prepare("INSERT INTO outbox(id,kind,body,delivered) VALUES (?,?,?,1) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(id, kind, canonicalBytes(body).toString("utf8"));
}

/**
 * N1 spec §5.2 and DR14: claim the call the group is waiting for, in the wake handler's transaction. A grant that no
 * longer fits the remaining limit is not claimed: the round or draft waits with requirement-budget-exhausted. Nor is
 * any call claimed while the ledger's usage is unknown (final review finding 3): its settlement could never book, so
 * the call would be paid for and lost; the round or draft waits with requirement-usage-unknown. As on a plan group
 * (webDispatch.ts "usage-unknown"), version 1 has no command that clears unknown usage, so that wait is final.
 */
export function claimRequirementCallInTransaction(store: ControlStore, groupId: string, at: number = Date.now()): "claimed" | "nothing" | "waiting" | "held" | "capped" {
  const outcome = claimOrWait(store, groupId, at);
  // Accounts spec §6.3.1: a call that is not claimed for another reason (held, nothing due, a limit wait) no longer waits on a cap.
  if (outcome !== "claimed" && outcome !== "capped") clearSpendCapBlock(store, groupId, "requirement-call");
  return outcome;
}

function claimOrWait(store: ControlStore, groupId: string, at: number): "claimed" | "nothing" | "waiting" | "held" | "capped" {
  const group = readRequirementGroup(store, groupId);
  if (group.status !== "clarifying") return "nothing";
  if (group.stopped || store.db.prepare("SELECT group_id FROM stop_intents WHERE group_id=?").get(groupId)) return "held";
  const target = pendingRequirementCall(store, groupId);
  if (target === null) return "nothing";
  if (store.db.prepare("SELECT id FROM runs WHERE group_id=? AND work_item_id=? AND active=1").get(groupId, target.workItemId)) return "nothing";
  if (group.ledger.usageUnknown) { setWaiting(store, groupId, target, "requirement-usage-unknown"); return "waiting"; }
  const reserved = add(group.reserved, REQUIREMENT_CALL_GRANT);
  if (!fits(group.used, reserved, group.limit)) { setWaiting(store, groupId, target, "requirement-budget-exhausted"); return "waiting"; }
  // Accounts spec §6.3.1, D9: a call over a spend cap is not claimed; the wake stays pending and the block is on the view.
  if (!gateClaim(store, groupId, REQUIREMENT_CALL_GRANT.tokens, at, "requirement-call")) return "capped";
  setWaiting(store, groupId, target, null);
  const attempt = (target.kind === "round" ? readRound(store, groupId, target.no).calls : readDraft(store, groupId, target.no).calls).length + 1;
  const slot = group.requirement.agentSlot, profile = group.requirement.profile;
  const contract = { schema: "orca-requirement-call-contract-v1", groupId, requirementId: group.requirement.requirementId, purpose: target.purpose,
    workItemId: target.workItemId, attempt, grant: { work: { ...REQUIREMENT_CALL_GRANT }, handoff: zero() }, profile, configHash: slot.configHash };
  const contractHash = sha256Canonical(contract);
  writeCanonicalRecord(store, groupId, contractHash, canonicalBytes(contract).toString("utf8"));
  upsertOutbox(store, `single-call-contract:${groupId}:${target.workItemId}`, "single-call-contract", { groupId, workItemId: target.workItemId, contractHash });
  const runId = `run-${randomUUID()}`;
  const { envelopeHash } = insertSingleCallRun(store, {
    groupId, workItemId: target.workItemId, runId, ownerToken: randomUUID(), purpose: target.purpose, identity: { estimateId: null, overview: null },
    graphVersion: 1, targetVersion: attempt, commandId: target.workItemId, slot, agentCapabilities: slot.capabilities, workGrant: REQUIREMENT_CALL_GRANT, profile,
    claimIdentity: `single-call:${groupId}:${target.workItemId}:${attempt}`, derivedContractHash: contractHash,
  });
  const claimRow = singleCallClaimRowOf("single-call", groupId, target.workItemId, runId);
  store.db.prepare("INSERT INTO outbox(id,kind,body,delivered) VALUES (?,?,?,1)").run(claimRow.id, claimRow.kind, canonicalBytes({ groupId, workItemId: target.workItemId, runId, envelopeHash }).toString("utf8"));
  group.reserved = reserved;
  syncLedger(group);
  saveRequirementGroup(store, group);
  return "claimed";
}

/** The pump's `requirement-call` handler: true when the wake's effect is in place; a held or spend-capped group keeps the wake pending. */
export async function claimRequirementCall(deps: { store: ControlStore; admissionGate?: AdmissionGate }, groupId: string): Promise<boolean> {
  const release = deps.admissionGate?.enter();
  try {
    const outcome = deps.store.transaction(() => claimRequirementCallInTransaction(deps.store, groupId));
    return outcome !== "held" && outcome !== "capped";
  }
  finally { release?.(); }
}

/**
 * Multi-directory projects spec §6.3: a multi group's overview is composed of one overview per member; a single group's
 * is the one repository's. The discriminant lets the run record name either one commit or one per member key.
 */
type BuiltOverview = { canonicalJson: string; hash: string }
  & ({ kind: "repository"; overview: RepositoryOverview } | { kind: "project"; project: ProjectOverview });

/**
 * A2 (spec §6): the overview of HEAD's commit, built from the target repository. Only this half is caught by the
 * handler as `repository-path`: a resolveRepository refusal, or any failure of the build (git, export, cache).
 * Task 5: overview builds are safe only one at a time (the builder sweeps every tmp-* directory). This runs only from
 * the driver's A2 (executionDriver.ts stepA2SingleCall), and the driver's pass visits its runs one after another and a
 * re-entrant round joins the pass in flight (createExecutionDriver), so no two builds overlap.
 * Dir-requirements spec §6.1-§6.2: the target is the group's (groupRepoId); a dir group's is its folder's vault, and its
 * overview is of an import of the folder (the newest one while the folder is unchanged, so the cache hits) -- HEAD is
 * never read, and the folder's own `.decisions/` is left out (importFolder).
 * Multi-directory projects spec §6.3: a multi group builds one overview per member in registered order -- a `repo`
 * member from HEAD, a `dir` member from its import commit -- each cached under its own dir target id, and composes them.
 */
async function buildOverviewFor(deps: SingleCallPrepareDeps, run: SingleCallRunRow, group: RequirementGroup): Promise<BuiltOverview> {
  const multi = multiDirOf(group);
  if (multi !== null) {
    const limits = dividedOverviewLimits(multi.dirs.length);
    const registry = deps.multiDirProjectOf?.(multi.project) ?? null;
    const dirs: ProjectOverview["dirs"] = [];
    for (const member of multi.dirs) {
      let repoId: string;
      let commit: string | undefined;
      if (member.kind === "dir") {
        const dirWorkspace = member.dirWorkspace;
        if (dirWorkspace === undefined || deps.env === undefined) throw new Error("orca: a dir member's call needs the driver's env ($ORCA_VAULT_DIR)");
        repoId = flowVaultRepoId(dirWorkspace.vaultId);
        ({ commit } = await importFolder(await openDirWorkspace(deps.env, dirWorkspace), { reuseUnchanged: true, baseRef: null }));
      } else {
        repoId = member.repoId;
      }
      const repo = deps.resolveRepository(repoId);
      const built = await buildRepositoryOverview({ repo, repoId, stateDir: deps.store.stateDir, runId: run.runId, astGrepBin: deps.astGrepBin ?? null, limits, ...(commit === undefined ? {} : { commit }) });
      // The registry names a member; a group whose multi project is no longer registered names it by its key.
      const name = registry?.dirs.find((dir) => dir.key === member.key)?.name ?? member.key;
      dirs.push({ key: member.key, name, kind: member.kind, primary: dirs.length === 0, overview: built.overview });
    }
    const project: ProjectOverview = { schema: "orca-project-overview-v1", dirs };
    return { kind: "project", canonicalJson: canonicalBytes(project).toString("utf8"), hash: sha256Canonical(project), project };
  }
  const repoId = groupRepoId(deps.store, run.groupId);
  const repo = deps.resolveRepository(repoId);
  const frozen = dirWorkspaceOf(group);
  let commit: string | undefined;
  if (frozen !== null) {
    if (deps.env === undefined) throw new Error("orca: a dir group's call needs the driver's env ($ORCA_VAULT_DIR)");
    ({ commit } = await importFolder(await openDirWorkspace(deps.env, frozen), { reuseUnchanged: true, baseRef: null }));
  }
  const built = await buildRepositoryOverview({ repo, repoId, stateDir: deps.store.stateDir, runId: run.runId, astGrepBin: deps.astGrepBin ?? null, ...(commit === undefined ? {} : { commit }) });
  return { kind: "repository", ...built };
}

/** The overview stored with the group and named on the run, before the prompt is built. A store fault here is not the repository's. */
function storeOverview(deps: SingleCallPrepareDeps, run: SingleCallRunRow, built: Awaited<ReturnType<typeof buildOverviewFor>>): void {
  const release = deps.admissionGate?.enter();
  try {
    deps.store.transaction(() => {
      writeCanonicalRecord(deps.store, run.groupId, built.hash, built.canonicalJson);
      const row = deps.store.db.prepare("SELECT body FROM runs WHERE id=?").get(run.runId);
      if (!row) throw new ControlError("run-not-found");
      const body = JSON.parse(String(row.body)) as Record<string, unknown>;
      body.overview = built.kind === "project"
        ? { hash: built.hash, commits: Object.fromEntries(built.project.dirs.map((dir) => [dir.key, dir.overview.commit])) }
        : { hash: built.hash, commit: built.overview.commit };
      deps.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(body), run.runId);
    });
  } finally { release?.(); }
}

/**
 * Ce (spec §5.1 "complete in the store") for both requirement purposes: the stop and usage checks every single call
 * shares (singleCallLedger.ts), the unused grant given back to the clarifying ledger, the call recorded with its
 * purpose's outcome.
 */
export function settleRequirementCall(
  deps: { store: ControlStore; admissionGate?: AdmissionGate }, runRow: SingleCallRunRow, commitTerminal: () => void,
  record: (store: ControlStore, group: RequirementGroup, target: RequirementTarget, run: SettledRun) => void,
): void {
  const release = deps.admissionGate?.enter();
  try {
    deps.store.transaction(() => settleRequirementCallInTransaction(deps.store, runRow, commitTerminal, record));
  } finally { release?.(); }
}

/**
 * Spec 2026-10-27 single-call unknown usage §9 R2: the settlement's core, inside the caller's transaction -- the driver's
 * (settleRequirementCall above) or a usage settlement's (singleCallSettlement.ts), which share it rather than copy it.
 */
export function settleRequirementCallInTransaction(
  store: ControlStore, runRow: SingleCallRunRow, commitTerminal: () => void,
  record: (store: ControlStore, group: RequirementGroup, target: RequirementTarget, run: SettledRun) => void,
): void {
  const receiptId = `single-call-result:${runRow.groupId}:${runRow.runId}`;
  if (store.db.prepare("SELECT id FROM outbox WHERE id=? AND kind='single-call-result'").get(receiptId)) return;
  commitTerminal();
  const row = store.db.prepare("SELECT id,active,body FROM runs WHERE id=?").get(runRow.runId);
  if (!row) throw new ControlError("run-not-found");
  const run: SettledRun = verifyStoppedSingleCall(store, row, { groupId: runRow.groupId, workItemId: runRow.workItemId, workGrant: REQUIREMENT_CALL_GRANT }, "requirement-call-ledger");
  const group = readRequirementGroup(store, run.groupId);
  assertCallUsageBooked(group, run, "requirement-usage-unknown");
  group.reserved = subtract(group.reserved, run.remaining.work);
  syncLedger(group);
  record(store, group, targetOf(run.workItemId), run);
  saveRequirementGroup(store, group);
  closeSingleCall(store, run.runId, { id: receiptId, kind: "single-call-result", body: { groupId: run.groupId, runId: run.runId } });
}

/**
 * Same spec §9 R2: whether a requirement call's round or draft has moved on (it is no longer drafting, or the group no
 * longer clarifying), so its purpose would refuse to record the call (recordClarify / recordSplit); a usage settlement
 * then closes the call through interruptRequirementCall instead.
 */
export function requirementCallTargetMoved(store: ControlStore, run: SingleCallRunRow): boolean {
  const group = readRequirementGroup(store, run.groupId), target = targetOf(run.workItemId);
  if (group.status !== "clarifying") return true;
  return (target.kind === "round" ? readRound(store, run.groupId, target.no).state : readDraft(store, run.groupId, target.no).state) !== "drafting";
}

export const callOf = (run: SettledRun, outcome: CallRecord["outcome"], reason: string | null): CallRecord => ({
  runId: run.runId, overviewHash: run.overview?.hash ?? null,
  commit: run.overview !== undefined && run.overview !== null && "commit" in run.overview ? run.overview.commit : null,
  usage: run.cumulative.work, outcome, reason,
});

/** Spec §7.3 and H7: a valid round awaits answers; an invalid one is retried at most twice, then fails. */
function recordClarify(store: ControlStore, group: RequirementGroup, target: RequirementTarget, run: SettledRun, rawOutput: unknown, failure: string | null): void {
  const round = readRound(store, group.groupId, target.no);
  if (round.state !== "drafting") throw new ControlError("recovery-blocked", "requirement-round-moved");
  const rounds = readRounds(store, group.groupId);
  // Human ruling (tester feedback round 2026-10-28): code numbers a round's ids by its chain position, as the prompt's
  // limits line (CLARIFY_HANDLER.prepare) and the document do -- one numbering; a drafting round is always on the chain.
  const chain = activeChain(rounds).chain, position = chain.indexOf(round.roundNo);
  // Review I1 (session a9f9d6de): a superseded row keeps its stored ids, which a chain round at the same position now
  // repeats, so only the chain's earlier rounds' questions can be depended on -- one id, one question.
  const earlierQuestionIds = rounds.filter((r) => chain.indexOf(r.roundNo) !== -1 && chain.indexOf(r.roundNo) < position).flatMap((r) => r.result?.questions.map((q) => q.id) ?? []);
  const classified = classifyClarifyOutput(rawOutput, { roundNo: position === -1 ? round.roundNo : position + 1, requirementId: group.requirement.requirementId, earlierQuestionIds, classification: clarifyLimits(store, group).effective });
  round.calls = [...round.calls, failure !== null ? callOf(run, "failed", failure) : callOf(run, classified.ok ? "valid" : "invalid", classified.ok ? null : classified.reason)];
  if (classified.ok) {
    Object.assign(round, { result: classified.result, state: "awaiting-answers", lastInvalidReason: null });
    if (round.roundNo === 1) group.requirement.slug = classified.result.slug;
    // Task 10a: the latest round that gave a title wins; a round without one keeps the earlier title.
    if (classified.result.title !== undefined) group.requirement.title = classified.result.title;
  } else if (round.retries < MAX_AUTO_RETRIES && (failure === null || !PRE_SPAWN_REFUSALS.has(failure))) {
    Object.assign(round, { retries: round.retries + 1, lastInvalidReason: classified.reason });
    queueRequirementCall(store, group.groupId, `retry-${run.runId}`);
  } else {
    Object.assign(round, { state: "failed", reasonCode: "clarify-output-invalid", lastInvalidReason: classified.reason });
  }
  writeRound(store, group.groupId, round);
}

/**
 * Stop (stopIntent.ts terminaliseRun, inside the request's settlement): the call ended under a stop proof, its usage
 * already booked by collection. Its round or draft is interrupted and the unused grant given back. The group stays
 * stopped with its completed handoff intent; DR15's recovery-retry (Task 9) lifts both and re-queues the round.
 */
export function interruptRequirementCall(store: ControlStore, groupId: string, run: SettledRun): void {
  const group = readRequirementGroup(store, groupId);
  group.reserved = subtract(group.reserved, run.remaining.work);
  syncLedger(group);
  const target = targetOf(run.workItemId), call = callOf(run, "interrupted", null);
  if (target.kind === "round") {
    const round = readRound(store, groupId, target.no);
    if (round.state === "drafting") writeRound(store, groupId, { ...round, state: "interrupted", calls: [...round.calls, call] });
  } else {
    const draft = readDraft(store, groupId, target.no);
    if (draft.state === "drafting") writeDraft(store, groupId, { ...draft, state: "interrupted", calls: [...draft.calls, call] });
  }
  saveRequirementGroup(store, group);
}

/**
 * A2 for both requirement purposes: the round or draft must still be drafting, the overview is built and stored, then
 * the purpose writes its prompt. Every call of a requirement asks for the frozen output cap (DR8).
 */
async function prepareRequirementCall(
  deps: SingleCallPrepareDeps, run: SingleCallRunRow, responseSchema: Readonly<Record<string, unknown>>,
  stillDrafting: (target: RequirementTarget) => boolean,
  promptOf: (group: RequirementGroup, target: RequirementTarget, built: Awaited<ReturnType<typeof buildOverviewFor>>) => string,
): Promise<SingleCallRequest | { blocked: string }> {
  const group = readRequirementGroup(deps.store, run.groupId);
  const target = targetOf(run.workItemId);
  if (group.status !== "clarifying" || !stillDrafting(target)) return { blocked: "requirement-call-target-moved" };
  // A resolveRepository refusal or a failed build is repository-shaped and named on the run; recovery-retry re-runs A2.
  let built: Awaited<ReturnType<typeof buildOverviewFor>>;
  // Dir-requirements spec §6.2: a dir group's folder that is gone or moved is named as such (`dir-folder-missing:<detail>`).
  try { built = await buildOverviewFor(deps, run, group); }
  catch (error) { return { blocked: error instanceof DirFolderMissing ? `dir-folder-missing:${error.message}` : "repository-path" }; }
  // Outside the catch: a draining panel or a store fault ends the round as any other step's does.
  storeOverview(deps, run, built);
  return { prompt: promptOf(group, target, built), responseSchema: responseSchema as Record<string, unknown>, maxOutputTokens: group.requirement.maxOutputTokens };
}

export const CLARIFY_HANDLER: SingleCallHandler = {
  purpose: "clarify",
  async prepare(deps, run) {
    return prepareRequirementCall(deps, run, CLARIFY_JSON_SCHEMA, (target) => readRound(deps.store, run.groupId, target.no).state === "drafting", (group, target, built) => {
      const limits = clarifyLimits(deps.store, group);
      // Flow engine spec §10.3: the earlier rounds are the active chain's; the round is numbered by its chain position;
      // superseded rounds go in as earlier answers that may still apply, unless a revision excluded them.
      const rounds = readRounds(deps.store, run.groupId), { chain } = activeChain(rounds);
      const position = chain.indexOf(target.no);
      return buildClarifyPrompt({ idea: group.requirement.idea, contentLanguage: group.requirement.contentLanguage, overview: built,
        earlier: chainRounds(rounds).filter((r) => r.roundNo !== target.no), retryReason: readRound(deps.store, run.groupId, target.no).lastInvalidReason,
        limits: { roundNo: position === -1 ? target.no : position + 1, classification: limits.effective, roundCap: limits.roundCap },
        superseded: supersededForPrompt(rounds), frame: requirementHost(deps.store, group).background() });
    });
  },
  classify: classifyClarifyOutput,
  complete(deps, run, rawOutput, commitTerminal, failure = null) {
    settleRequirementCall(deps, run, commitTerminal, (store, group, target, settled) => recordClarify(store, group, target, settled, rawOutput, failure));
  },
  completeInTransaction(store, run, rawOutput, commitTerminal, failure = null) {
    settleRequirementCallInTransaction(store, run, commitTerminal, (inner, group, target, settled) => recordClarify(inner, group, target, settled, rawOutput, failure));
  },
  usageUnknownReason: "requirement-usage-unknown",
};

/** What Ce of a split judged, before its transaction: the parsed output, its expansion and every reason (spec §8.2-§8.4). */
interface SplitEvaluation extends Omit<DraftBody, "draftNo" | "state" | "autoRetry" | "waiting" | "feedback" | "reasonCode" | "calls" | "plan"> {
  schemaValid: boolean; ok: boolean; plan: SplitPlanFile | null;
}

/**
 * Multi-directory projects spec §6.4: a multi group's split answer, parsed with multiSplitOutputSchema, expanded per
 * task against the directories it names and validated with every reason code's own check. The run's overview must name
 * one commit per member; a member it does not name is a recovery block, as a single call's missing commit is.
 */
async function evaluateMultiSplit(deps: SingleCallPrepareDeps, run: SingleCallRunRow, multi: FrozenMultiDir, rawOutput: unknown): Promise<SplitEvaluation> {
  const parsed = multiSplitOutputSchema.safeParse(rawOutput);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { schemaValid: false, ok: false, output: null, plan: null, draftHash: null, reasons: [`schema:${issue?.path.join(".") ?? ""}:${issue?.message ?? "invalid"}`], layers: null, implicitEdges: null };
  }
  const overview = (run as { overview?: RunOverview | null }).overview ?? null;
  if (overview === null || !("commits" in overview)) throw new ControlError("recovery-blocked", "requirement-overview-missing");
  const rounds = chainRounds(readRounds(deps.store, run.groupId));
  const latest = rounds.filter((round) => round.result !== null).at(-1)?.result ?? null;
  if (latest === null) throw new ControlError("recovery-blocked", "requirement-understanding-missing");
  const adrIds = rounds.flatMap((round) => (round.adrDecisions ?? []).filter((decision) => decision.accept).map((decision) => decision.id));
  const paths = new Map<string, string>(), commits = new Map<string, string>();
  for (const member of multi.dirs) {
    const commit = overview.commits[member.key];
    if (commit === undefined) throw new ControlError("recovery-blocked", "requirement-overview-missing");
    paths.set(member.key, deps.resolveRepository(dirTargetRepoId(deps.store, run.groupId, member.key)));
    commits.set(member.key, commit);
  }
  const dirs = [...paths].map(([key, path]) => ({ key, path }));
  const expanded = expandMultiSplitDraft(parsed.data, { targetRepo: dirs[0]!.path, ccloopBin: deps.ccloopBin, runsDir: deps.roots.runsRoot, groupId: run.groupId,
    statement: latest.statement, successConditions: latest.acceptanceCriteria.map((criterion) => criterion.text), dirs });
  const validated = await validateMultiSplitDraft({ output: parsed.data, plan: expanded.plan, contracts: expanded.contracts, expandReasons: expanded.reasons, paths, commits,
    criterionIds: latest.acceptanceCriteria.map((criterion) => criterion.id), adrIds });
  // DR12: the hash is of the expanded plan, the bytes the person reviews; a draft with a reason keeps neither.
  return validated.ok
    ? { schemaValid: true, output: parsed.data, plan: expanded.plan, draftHash: sha256Canonical(expanded.plan), ...validated }
    : { schemaValid: true, output: parsed.data, plan: null, draftHash: null, ...validated };
}

/**
 * Evaluated outside the transaction (it reads the target repositories at the commits A2's overview named); its result is
 * what `complete` records. A call that failed with no output is schema-invalid (Task 6 ruling: it uses a retry).
 */
async function evaluateSplit(deps: SingleCallPrepareDeps, run: SingleCallRunRow, rawOutput: unknown): Promise<SplitEvaluation> {
  const group = readRequirementGroup(deps.store, run.groupId);
  const multi = multiDirOf(group);
  if (multi !== null) return evaluateMultiSplit(deps, run, multi, rawOutput);
  const parsed = splitOutputSchema.safeParse(rawOutput);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { schemaValid: false, ok: false, output: null, plan: null, draftHash: null, reasons: [`schema:${issue?.path.join(".") ?? ""}:${issue?.message ?? "invalid"}`], layers: null, implicitEdges: null };
  }
  const overview = (run as { overview?: RunOverview | null }).overview ?? null;
  if (overview === null || !("commit" in overview)) throw new ControlError("recovery-blocked", "requirement-overview-missing");
  const rounds = chainRounds(readRounds(deps.store, run.groupId));
  const latest = rounds.filter((round) => round.result !== null).at(-1)?.result ?? null;
  if (latest === null) throw new ControlError("recovery-blocked", "requirement-understanding-missing");
  const adrIds = rounds.flatMap((round) => (round.adrDecisions ?? []).filter((decision) => decision.accept).map((decision) => decision.id));
  // Dir-requirements spec §6.3: the group's target -- a dir group's vault, so targetRepo and the path check are the vault's.
  const repo = deps.resolveRepository(groupRepoId(deps.store, run.groupId));
  const plan = expandSplitDraft(parsed.data, { targetRepo: repo, ccloopBin: deps.ccloopBin, runsDir: deps.roots.runsRoot, groupId: run.groupId, statement: latest.statement, acceptanceCriteria: latest.acceptanceCriteria });
  const validated = await validateSplitDraft({ output: parsed.data, plan, repo, commit: overview.commit, criterionIds: latest.acceptanceCriteria.map((criterion) => criterion.id), adrIds });
  // DR12: the hash is of the expanded plan, the bytes the person reviews.
  return { schemaValid: true, output: parsed.data, plan, draftHash: sha256Canonical(plan), ...validated };
}

/** Spec §8.3 and H7 (DR9): a valid draft awaits review; an invalid one becomes `invalid` and the next draft is drafted, at most twice. */
function recordSplit(store: ControlStore, group: RequirementGroup, target: RequirementTarget, run: SettledRun, ev: SplitEvaluation, failure: string | null): void {
  const draft = readDraft(store, group.groupId, target.no);
  if (draft.state !== "drafting") throw new ControlError("recovery-blocked", "requirement-draft-moved");
  draft.calls = [...draft.calls, failure !== null ? callOf(run, "failed", failure) : callOf(run, ev.ok ? "valid" : "invalid", ev.ok ? null : ev.reasons.join("; "))];
  Object.assign(draft, { output: ev.output, plan: ev.ok ? ev.plan : null, draftHash: ev.ok ? ev.draftHash : null, reasons: ev.reasons, layers: ev.layers, implicitEdges: ev.implicitEdges });
  if (ev.ok) draft.state = "awaiting-review";
  else if (draft.autoRetry < MAX_AUTO_RETRIES && (failure === null || !PRE_SPAWN_REFUSALS.has(failure))) {
    draft.state = "invalid";
    writeDraft(store, group.groupId, draft);
    writeDraft(store, group.groupId, newDraft(draft.draftNo + 1, draft.autoRetry + 1));
    queueRequirementCall(store, group.groupId, `retry-${run.runId}`);
    return;
  } else {
    Object.assign(draft, { state: "failed", reasonCode: ev.schemaValid ? "split-validation-exhausted" : "split-output-invalid" });
  }
  writeDraft(store, group.groupId, draft);
}

export const SPLIT_HANDLER: SingleCallHandler = {
  purpose: "split",
  async prepare(deps, run) {
    // Multi-directory projects spec §6.4: a multi group's split names writes per directory, in the multi schema.
    const multi = multiDirOf(readRequirementGroup(deps.store, run.groupId)) !== null;
    return prepareRequirementCall(deps, run, multi ? SPLIT_JSON_SCHEMA_MULTI : SPLIT_JSON_SCHEMA, (target) => readDraft(deps.store, run.groupId, target.no).state === "drafting", (group, target, built) =>
      buildSplitPrompt({
        document: renderRequirementDocument({ groupId: run.groupId, requirement: group.requirement, rounds: chainRounds(readRounds(deps.store, run.groupId)), acceptedSplit: null }),
        overview: built, earlierDrafts: readDrafts(deps.store, run.groupId).filter((draft) => draft.draftNo < target.no), ...(multi ? { multi: true } : {}),
      }));
  },
  evaluate: evaluateSplit,
  classify: validateSplitDraft,
  complete(deps, run, evaluation, commitTerminal, failure = null) {
    settleRequirementCall(deps, run, commitTerminal, (store, group, target, settled) => recordSplit(store, group, target, settled, evaluation as SplitEvaluation, failure));
  },
  completeInTransaction(store, run, evaluation, commitTerminal, failure = null) {
    settleRequirementCallInTransaction(store, run, commitTerminal, (inner, group, target, settled) => recordSplit(inner, group, target, settled, evaluation as SplitEvaluation, failure));
  },
  usageUnknownReason: "requirement-usage-unknown",
};
