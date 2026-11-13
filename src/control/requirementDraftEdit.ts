import type { AdmissionGate } from "./admissionGate.js";
import { applyWebCommand, preflightWebCommand } from "./commandLedger.js";
import { sha256Canonical } from "./canonicalJson.js";
import { ControlError } from "./errors.js";
import { multiDirOf } from "./multiGroup.js";
import { evaluateSplit, type SplitEvaluation } from "./requirementCalls.js";
import { latestDraft, readDraft, readDrafts, readRequirementGroup, writeDraft } from "./requirementRecords.js";
import type { DraftBody, MultiSplitOutput, SplitOutput } from "./requirementSchemas.js";
import type { SplitPlanFile } from "./requirementSplit.js";
import type { SingleCallPrepareDeps, SingleCallRunRow } from "./singleCallPurposes.js";
import { impliedPathsOutsideTargets } from "./splitImpliedPaths.js";
import { parallelCandidates } from "./splitParallel.js";
import { commandSuccess, readRunBody, readStopIntent } from "./stopIntent.js";
import type { ControlStore } from "./store.js";
import type { CommandLookupV1, RawAuthorityCommandV1 } from "./webProtocol.js";

export type RequirementDraftEditCommand = Extract<RawAuthorityCommandV1, { verb: "requirement-draft-edit" }>;
type Result = CommandLookupV1["body"];
type Output = SplitOutput | MultiSplitOutput;
type Edit = RequirementDraftEditCommand["payload"]["edit"];
export interface RequirementDraftEditDeps {
  store: ControlStore; admissionGate?: AdmissionGate;
  /** A multi-directory group's members are resolved as accept resolves them; absent, such a group's edit is refused. */
  resolveRepository?: (repoId: string) => string;
}

const invalid = (detail: string): never => { throw new ControlError("group-state-invalid", detail); };

/** The draft the edit names: the latest, awaiting review, with the hash the person read (as accept checks it). */
function reviewed(store: ControlStore, groupId: string, payload: RequirementDraftEditCommand["payload"]): DraftBody & { output: Output; plan: Record<string, unknown> } {
  const group = readRequirementGroup(store, groupId);
  if (group.status !== "clarifying") invalid("not-clarifying");
  if (group.stopped || readStopIntent(store, groupId) !== null) throw new ControlError("group-stopped");
  const draft = latestDraft(store, groupId);
  if (draft === null || draft.draftNo !== payload.draftNo || draft.state !== "awaiting-review" || draft.output === null || draft.plan === null) return invalid("draft-not-awaiting-review");
  if (sha256Canonical(draft.plan) !== payload.draftHash) throw new ControlError("plan-version-conflict", "draft-hash");
  return draft as DraftBody & { output: Output; plan: Record<string, unknown> };
}

/**
 * Tester follow-up K (Rule 5: code edits, from code's own hints only): the split with every listed parallel candidate's
 * dependsOn edge dropped (#284), or with one listed implied path added to the task's targets (#265) -- in a multi split,
 * to the task's write in the directory the path's first writer lists it in (a new write there when it has none). Returns
 * the edited output and the line the superseded draft keeps as its feedback.
 */
export function editedSplit(output: Output, edit: Edit): { output: Output; note: string } {
  const copy = structuredClone(output) as Output;
  const tasks = copy.tasks as Array<Output["tasks"][number]>;
  if (edit.kind === "apply-parallel-candidates") {
    const pairs = parallelCandidates(output);
    if (pairs.length === 0) return invalid("draft-edit-no-parallel-candidates");
    for (const task of tasks) task.dependsOn = task.dependsOn.filter((before) => !pairs.some((pair) => pair.after === task.taskId && pair.before === before));
    return { output: copy, note: `person edit: dropped dependsOn ${pairs.map((pair) => `${pair.before} -> ${pair.after}`).join(", ")} (parallel candidates)` };
  }
  const entry = impliedPathsOutsideTargets(output).find((hint) => hint.taskId === edit.taskId && hint.path === edit.path);
  if (entry === undefined) return invalid(`draft-edit-not-an-implied-path:${edit.taskId}:${edit.path}`);
  const task = tasks.find((candidate) => candidate.taskId === edit.taskId)!;
  if ("writes" in task) {
    const writer = (tasks as MultiSplitOutput["tasks"]).find((candidate) => candidate.taskId === entry.writers[0])!;
    const dir = writer.writes.find((write) => write.targetPaths.some((path) => path.replace(/\/+$/, "") === entry.path || path === entry.path))?.dir ?? writer.writes[0]!.dir;
    const own = task.writes.find((write) => write.dir === dir);
    if (own === undefined) task.writes.push({ dir, targetPaths: [entry.path], checks: [] });
    else own.targetPaths.push(entry.path);
  } else task.targetPaths.push(entry.path);
  return { output: copy, note: `person edit: added ${entry.path} to ${edit.taskId}'s target paths (implied path)` };
}

/**
 * The run whose overview the draft was judged against: the latest valid split call of this draft or, for a draft a
 * person's edit made (it has no call), of the draft it was edited from.
 */
function judgedRun(store: ControlStore, groupId: string, draftNo: number): SingleCallRunRow {
  for (const draft of readDrafts(store, groupId).filter((candidate) => candidate.draftNo <= draftNo).reverse()) {
    const call = [...draft.calls].reverse().find((candidate) => candidate.outcome === "valid");
    if (call !== undefined) return { ...readRunBody(store, call.runId), runId: call.runId, groupId } as unknown as SingleCallRunRow;
    if (draft.calls.length > 0) break;
  }
  throw new ControlError("recovery-blocked", "requirement-overview-missing");
}

/**
 * Tester follow-up K: a person's edit of a draft awaiting review. The edited split is re-validated exactly as a model's
 * split is (evaluateSplit: every hand-back check, the layers, and the implicit edges of intersecting write sets, which
 * accept turns into dependsOn -- #268), against the overview commit the draft was judged at. A valid result supersedes
 * the draft (rejected, the edit as its feedback) and becomes the next draft, awaiting review; an invalid one is refused
 * with its reasons and changes nothing. Never applied without this command.
 */
export async function applyRequirementDraftEdit(deps: RequirementDraftEditDeps, command: RequirementDraftEditCommand): Promise<Result> {
  const release = deps.admissionGate?.enter();
  try {
    const replay = preflightWebCommand<Result>(deps.store, command);
    if (replay) return replay.body;
    const id = command.target.groupId;
    let edited: { output: Output; note: string }, evaluation: SplitEvaluation;
    try {
      const draft = reviewed(deps.store, id, command.payload);
      edited = editedSplit(draft.output, command.payload.edit);
      const stored = draft.plan as unknown as SplitPlanFile;
      const multi = multiDirOf(readRequirementGroup(deps.store, id)) !== null;
      if (multi && deps.resolveRepository === undefined) throw new ControlError("control-target-not-allowed");
      // The plan's own targetRepo, ccloopBin and runsDir: the edited plan differs from the reviewed one only by the edit.
      const evalDeps = { store: deps.store, resolveRepository: multi ? deps.resolveRepository! : () => stored.targetRepo, ccloopBin: stored.ccloopBin, roots: { runsRoot: stored.runsDir } };
      evaluation = await evaluateSplit(evalDeps as unknown as SingleCallPrepareDeps, judgedRun(deps.store, id, draft.draftNo), edited.output);
      if (!evaluation.ok) invalid(`draft-edit-invalid:${evaluation.reasons.join("; ")}`);
    } catch (error) {
      return applyWebCommand<Result>(deps.store, { rawCommand: command, expand: () => { throw error; }, apply: () => { throw error; } }).body;
    }
    return applyWebCommand<Result>(deps.store, {
      rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
      apply: (context) => {
        // Checked again inside the transaction: the draft may have moved while the repository was read.
        const draft = reviewed(deps.store, id, command.payload);
        if (deps.store.db.prepare("SELECT id FROM runs WHERE group_id=? AND active=1").get(id)) invalid("call-in-flight");
        writeDraft(deps.store, id, { ...readDraft(deps.store, id, draft.draftNo), state: "rejected", waiting: null, feedback: edited.note });
        writeDraft(deps.store, id, { draftNo: draft.draftNo + 1, state: "awaiting-review", autoRetry: 0, waiting: null, feedback: null, output: evaluation.output, plan: evaluation.plan as Record<string, unknown> | null,
          draftHash: evaluation.draftHash, reasons: evaluation.reasons, layers: evaluation.layers, implicitEdges: evaluation.implicitEdges, reasonCode: null, calls: [] });
        return commandSuccess(context, { kind: "requirement-draft-edited", draftNo: draft.draftNo, nextDraftNo: draft.draftNo + 1 });
      },
    }).body;
  } finally { release?.(); }
}
